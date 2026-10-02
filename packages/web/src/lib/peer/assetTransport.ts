import { ASSET_CHUNK_SIZE, MAX_ASSET_BYTES, assetManifestSchema, type AssetManifest, type AssetMessage } from '@gikcamp/protocol'

type Connection = { open: boolean; send: (message: AssetMessage) => unknown; bufferSize?: number }
type Events = { progress?: (received: number, total: number) => void; received: (manifest: AssetManifest, blob: Blob) => void }
type Waiter = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
type Incoming = { manifest: AssetManifest; chunks: (ArrayBuffer | undefined)[]; bytes: number;
  timer: ReturnType<typeof setTimeout>; verifying: boolean }
export type AssetDetails = Pick<AssetManifest, 'kind' | 'width' | 'height'> & Partial<Pick<AssetManifest, 'scan' | 'fileName' | 'transferId'>>

/** 写真・Mask共通の双方向転送。チャンクごとの受信確認で送信バッファを抑える。 */
export class AssetTransport {
  private incoming: Incoming | null = null
  private waiters = new Map<string, Waiter>()
  private sending = false
  private disposed = false
  private connection: Connection
  private events: Events

  constructor(connection: Connection, events: Events) {
    this.connection = connection
    this.events = events
  }

  async send(blob: Blob, details: AssetDetails, onProgress: (ratio: number) => void = () => {}): Promise<AssetManifest> {
    if (this.sending) throw new Error('別のアセットを送信中です。')
    if (blob.size === 0 || blob.size > MAX_ASSET_BYTES) throw new Error('アセットのサイズが転送上限を超えています。')
    if (this.disposed || !this.connection.open) throw new Error('アセット転送の接続がありません。')
    this.sending = true
    const transferId = details.transferId ?? crypto.randomUUID()
    try {
      const bytes = await blob.arrayBuffer()
      const manifest = assetManifestSchema.parse({ ...details, transferId,
        fileName: details.fileName ?? `${transferId}.${details.kind === 'photo' ? 'jpg' : 'png'}`,
        mimeType: blob.type, byteLength: bytes.byteLength, chunkCount: Math.ceil(bytes.byteLength / ASSET_CHUNK_SIZE),
        sha256: await sha256(bytes) })
      onProgress(0)
      await this.sendAndWait({ type: 'asset-manifest', manifest }, `manifest:${transferId}`)
      for (let index = 0; index < manifest.chunkCount; index += 1) {
        if (this.disposed || !this.connection.open) throw new Error('転送中に接続が切れました。')
        const start = index * ASSET_CHUNK_SIZE
        await this.sendAndWait({ type: 'asset-chunk', transferId, index,
          data: bytes.slice(start, Math.min(start + ASSET_CHUNK_SIZE, bytes.byteLength)) }, `chunk:${transferId}:${index}`)
        onProgress((index + 1) / manifest.chunkCount * 0.9)
      }
      await this.sendAndWait({ type: 'asset-complete', transferId }, `complete:${transferId}`, 30_000)
      onProgress(1)
      return manifest
    } finally {
      this.rejectWaiters(new Error('転送を終了しました。'), transferId)
      this.sending = false
    }
  }

  async receive(message: AssetMessage): Promise<void> {
    if (this.disposed) return
    if (message.type === 'asset-manifest-received') { this.resolve(`manifest:${message.transferId}`); return }
    if (message.type === 'asset-chunk-received') { this.resolve(`chunk:${message.transferId}:${message.index}`); return }
    if (message.type === 'asset-received') { this.resolve(`complete:${message.transferId}`); return }
    if (message.type === 'asset-rejected') { this.rejectWaiters(new Error(message.reason), message.transferId); return }
    if (message.type === 'asset-manifest') {
      const manifest = message.manifest
      if (manifest.chunkCount !== Math.ceil(manifest.byteLength / ASSET_CHUNK_SIZE)) {
        this.reject(manifest.transferId, '転送情報が不正です。'); return
      }
      // 失敗後の再送は全体を再開し、前の途中データを破棄する。
      this.clearIncoming()
      this.incoming = { manifest, chunks: Array.from({ length: manifest.chunkCount }), bytes: 0,
        timer: setTimeout(() => {}, 0), verifying: false }
      this.refreshTimeout(this.incoming)
      this.events.progress?.(0, manifest.byteLength)
      this.connection.send({ type: 'asset-manifest-received', transferId: manifest.transferId })
      return
    }
    const incoming = this.incoming
    if (!incoming || incoming.manifest.transferId !== message.transferId) {
      this.reject(message.transferId, '転送情報が見つかりません。'); return
    }
    if (message.type === 'asset-chunk') {
      const expected = Math.min(ASSET_CHUNK_SIZE, incoming.manifest.byteLength - message.index * ASSET_CHUNK_SIZE)
      if (incoming.verifying || message.index >= incoming.manifest.chunkCount ||
          incoming.chunks[message.index] !== undefined || message.data.byteLength !== expected) {
        this.reject(message.transferId, 'チャンクの番号またはサイズが不正です。'); this.clearIncoming(); return
      }
      incoming.chunks[message.index] = message.data
      incoming.bytes += message.data.byteLength
      this.refreshTimeout(incoming)
      this.events.progress?.(incoming.bytes, incoming.manifest.byteLength)
      this.connection.send({ type: 'asset-chunk-received', transferId: message.transferId, index: message.index })
      return
    }
    if (message.type !== 'asset-complete' || incoming.verifying) return
    if (incoming.bytes !== incoming.manifest.byteLength || incoming.chunks.some((chunk) => !chunk)) {
      this.reject(message.transferId, '転送データが不足しています。'); this.clearIncoming(); return
    }
    incoming.verifying = true
    this.refreshTimeout(incoming)
    try {
      const bytes = new Uint8Array(incoming.manifest.byteLength)
      let offset = 0
      for (const chunk of incoming.chunks) { bytes.set(new Uint8Array(chunk!), offset); offset += chunk!.byteLength }
      const digest = await sha256(bytes.buffer)
      if (this.incoming !== incoming || this.disposed) return
      if (digest !== incoming.manifest.sha256) { this.reject(message.transferId, 'アセットのハッシュが一致しません。'); return }
      this.events.received(incoming.manifest, new Blob([bytes.buffer], { type: incoming.manifest.mimeType }))
      this.connection.send({ type: 'asset-received', transferId: message.transferId })
    } catch {
      if (this.incoming === incoming) this.reject(message.transferId, 'アセットの検証に失敗しました。')
    } finally { if (this.incoming === incoming) this.clearIncoming() }
  }

  dispose(): void {
    this.disposed = true
    this.clearIncoming()
    this.rejectWaiters(new Error('アセット転送の接続が切れました。'))
  }

  private sendAndWait(message: AssetMessage, key: string, timeout = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(key); reject(new Error('アセットの受信確認がありません。再送してください。')) }, timeout)
      this.waiters.set(key, { resolve, reject, timer })
      try {
        if (this.disposed || !this.connection.open) throw new Error('転送中に接続が切れました。')
        this.connection.send(message)
      } catch (cause) {
        clearTimeout(timer); this.waiters.delete(key)
        reject(cause instanceof Error ? cause : new Error('送信できませんでした。'))
      }
    })
  }
  private resolve(key: string) {
    const waiter = this.waiters.get(key)
    if (!waiter) return
    clearTimeout(waiter.timer); this.waiters.delete(key); waiter.resolve()
  }
  private rejectWaiters(error: Error, transferId?: string) {
    for (const [key, waiter] of this.waiters) {
      if (transferId && !key.split(':').includes(transferId)) continue
      clearTimeout(waiter.timer); this.waiters.delete(key); waiter.reject(error)
    }
  }
  private reject(transferId: string, reason: string) {
    if (this.connection.open) this.connection.send({ type: 'asset-rejected', transferId, reason })
  }
  private refreshTimeout(incoming: Incoming) {
    clearTimeout(incoming.timer)
    incoming.timer = setTimeout(() => {
      if (this.incoming !== incoming) return
      this.reject(incoming.manifest.transferId, 'アセット転送がタイムアウトしました。')
      this.events.progress?.(0, incoming.manifest.byteLength)
      this.clearIncoming()
    }, 10_000)
  }
  private clearIncoming() {
    if (this.incoming) clearTimeout(this.incoming.timer)
    this.incoming = null
  }
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}
