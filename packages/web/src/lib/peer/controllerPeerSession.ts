import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import {
  ASSET_CHUNK_SIZE,
  CAPTURE_VIEWS,
  MAX_ASSET_BYTES,
  assetManifestSchema,
  assetMessageSchema,
  captureInfoSchema,
  controlMessageSchema,
  type AssetManifest,
  type AssetMessage,
  type CaptureInfo,
  type CaptureSelectionStroke,
  type CaptureView,
  type ControlMessage,
  type PairingMetadata,
  type PlayerSlot,
} from '@gikcamp/protocol'

const HEARTBEAT_INTERVAL_MS = 2_000
const CONNECTION_TIMEOUT_MS = 8_000
const ASSET_MESSAGE_TIMEOUT_MS = 10_000
const ASSET_RECEIPT_TIMEOUT_MS = 30_000

type ControllerPeerSessionEvents = {
  connected: (slot: PlayerSlot) => void
  rejected: (reason: string) => void
  disconnected: () => void
  error: (error: Error) => void
}

export type CaptureShot = {
  view: CaptureView
  photo: Blob
  width: number
  height: number
}

type PendingWaiter = {
  resolve: () => void
  reject: (error: Error) => void
  timer: number
}

export class ControllerPeerSession {
  private readonly peer = new Peer()
  private readonly hostPeerId: string
  private readonly metadata: PairingMetadata
  private readonly events: ControllerPeerSessionEvents
  private control: DataConnection | undefined
  private motion: DataConnection | undefined
  private asset: DataConnection | undefined
  private readonly waiters = new Map<string, PendingWaiter>()
  private heartbeatTimer: number | undefined
  private timeoutTimer: number | undefined
  private lastReceivedAt = performance.now()
  private motionSequence = 0
  private acceptedSlot: PlayerSlot | undefined
  private motionOpen = false
  private assetOpen = false
  private connectedNotified = false
  private sendingAsset = false
  private rejected = false
  private closingAuxiliary = false
  private destroyed = false

  constructor(
    hostPeerId: string,
    metadata: PairingMetadata,
    events: ControllerPeerSessionEvents,
  ) {
    this.hostPeerId = hostPeerId
    this.metadata = metadata
    this.events = events
    this.peer.on('open', () => this.connectControl())
    this.peer.on('error', (error) => this.events.error(error))
  }

  sendAttack(button: 'a' | 'b'): void {
    if (!this.control?.open) return
    this.control.send({
      type: 'attack',
      button,
    } satisfies ControlMessage)
  }

  sendMotion(motion: { x: number; y: number }): void {
    if (!this.motion?.open) return

    this.motion.send({
      type: 'motion',
      sequence: this.motionSequence,
      x: motion.x,
      y: motion.y,
    })
    this.motionSequence += 1
  }

  // 4方向の写真を1枚ずつ順番に送る。範囲指定は正面の写真の転送情報に付ける
  async sendCapture(
    shots: ReadonlyArray<CaptureShot>,
    selection: ReadonlyArray<CaptureSelectionStroke>,
    onProgress: (ratio: number) => void,
  ): Promise<void> {
    const views = shots.map((shot) => shot.view)
    if (
      views.length !== CAPTURE_VIEWS.length ||
      CAPTURE_VIEWS.some((view) => !views.includes(view))
    ) {
      throw new Error('4方向の写真がそろっていません')
    }
    if (!selection.some((stroke) => stroke.mode === 'add')) {
      throw new Error('正面の写真で対象を指定してください')
    }

    // 写真を読み込む前に、範囲指定が正しいかを一度だけ確かめる
    const setId = crypto.randomUUID()
    const frontCapture: CaptureInfo = {
      setId,
      view: 'front',
      selection: [...selection],
    }
    if (!captureInfoSchema.safeParse(frontCapture).success) {
      throw new Error('範囲指定の内容が不正です')
    }

    for (const [index, shot] of shots.entries()) {
      await this.sendPhoto(
        shot.photo,
        { width: shot.width, height: shot.height },
        (ratio) => onProgress((index + ratio) / shots.length),
        shot.view === 'front'
          ? frontCapture
          : { setId, view: shot.view },
      )
    }
  }

  async sendPhoto(
    photo: Blob,
    dimensions: { width: number; height: number },
    onProgress: (ratio: number) => void,
    capture?: CaptureInfo,
  ): Promise<void> {
    if (this.sendingAsset) {
      throw new Error('別の写真を送信中です')
    }
    if (photo.size > MAX_ASSET_BYTES) {
      throw new Error('写真のサイズが転送上限を超えています')
    }
    if (!this.asset?.open) {
      throw new Error('写真転送の接続がありません')
    }

    this.sendingAsset = true
    const connection = this.asset
    const transferId = crypto.randomUUID()

    try {
      const bytes = await photo.arrayBuffer()
      const chunkCount = Math.ceil(
        bytes.byteLength / ASSET_CHUNK_SIZE,
      )
      const manifest: AssetManifest = {
        transferId,
        kind: 'photo',
        fileName: `${transferId}.jpg`,
        mimeType: photo.type || 'image/jpeg',
        byteLength: bytes.byteLength,
        sha256: await sha256(bytes),
        chunkCount,
        width: dimensions.width,
        height: dimensions.height,
        ...(capture === undefined ? {} : { capture }),
      }
      if (!assetManifestSchema.safeParse(manifest).success) {
        throw new Error('写真の転送情報が不正です')
      }

      onProgress(0)
      const manifestKey = `manifest:${transferId}`
      const manifestAck = this.createWaiter(
        manifestKey,
        ASSET_MESSAGE_TIMEOUT_MS,
        'PCが写真の転送情報を確認できませんでした',
      )
      try {
        await connection.send({
          type: 'asset-manifest',
          manifest,
        } satisfies AssetMessage)
      } catch (error) {
        this.clearWaiter(manifestKey)
        throw error
      }
      await manifestAck

      for (let index = 0; index < chunkCount; index += 1) {
        const start = index * ASSET_CHUNK_SIZE
        const end = Math.min(
          start + ASSET_CHUNK_SIZE,
          bytes.byteLength,
        )
        const chunkKey = `chunk:${transferId}:${index}`
        const chunkAck = this.createWaiter(
          chunkKey,
          ASSET_MESSAGE_TIMEOUT_MS,
          `写真チャンク ${index} の受信確認がありません`,
        )

        try {
          await connection.send({
            type: 'asset-chunk',
            transferId,
            index,
            data: bytes.slice(start, end),
          } satisfies AssetMessage)
        } catch (error) {
          this.clearWaiter(chunkKey)
          throw error
        }

        await chunkAck
        onProgress(((index + 1) / chunkCount) * 0.9)
      }

      const completeKey = `complete:${transferId}`
      const receipt = this.createWaiter(
        completeKey,
        ASSET_RECEIPT_TIMEOUT_MS,
        'PCから写真受信の応答がありません',
      )
      try {
        await connection.send({
          type: 'asset-complete',
          transferId,
        } satisfies AssetMessage)
      } catch (error) {
        this.clearWaiter(completeKey)
        throw error
      }

      await receipt
      onProgress(1)
    } finally {
      this.rejectTransfer(
        transferId,
        new Error('写真転送を終了しました'),
      )
      this.sendingAsset = false
    }
  }

  destroy(): void {
    this.destroyed = true
    this.closingAuxiliary = true
    this.stopHeartbeat()
    this.rejectAllWaiters(new Error('通信が終了しました'))
    this.motion?.close()
    this.asset?.close()
    this.control?.close()
    this.peer.destroy()
  }

  private connectControl(): void {
    const connection = this.peer.connect(this.hostPeerId, {
      label: 'control',
      reliable: true,
      metadata: this.metadata,
    })
    this.control = connection

    connection.on('open', () => {
      this.lastReceivedAt = performance.now()
      this.startHeartbeat()
    })

    connection.on('data', (data) => {
      const result = controlMessageSchema.safeParse(data)
      if (!result.success) {
        this.events.error(
          new Error('不正なcontrolメッセージを受信しました'),
        )
        return
      }

      this.lastReceivedAt = performance.now()
      const message = result.data

      if (
        message.type === 'connection-accepted' &&
        this.acceptedSlot === undefined
      ) {
        this.acceptedSlot = message.slot
        this.connectAuxiliaryChannels()
      } else if (message.type === 'connection-rejected') {
        this.rejected = true
        this.events.rejected(message.reason)
        connection.close()
      }
    })

    connection.on('close', () => {
      this.stopHeartbeat()
      this.closingAuxiliary = true
      this.motion?.close()
      this.asset?.close()
      this.rejectAllWaiters(new Error('PCとの接続が切れました'))

      if (!this.destroyed && !this.rejected) {
        this.events.disconnected()
      }
    })
    connection.on('error', (error) => this.events.error(error))
  }

  private connectAuxiliaryChannels(): void {
    this.motion = this.peer.connect(this.hostPeerId, {
      label: 'motion',
      reliable: false,
      metadata: this.metadata,
    })
    this.asset = this.peer.connect(this.hostPeerId, {
      label: 'asset',
      reliable: true,
      serialization: 'binary',
      metadata: this.metadata,
    })

    this.motion.on('open', () => {
      this.motionOpen = true
      this.notifyConnected()
    })
    this.asset.on('open', () => {
      this.assetOpen = true
      this.notifyConnected()
    })

    this.motion.on('close', () => {
      this.motionOpen = false
      if (!this.destroyed && !this.closingAuxiliary) {
        this.events.error(
          new Error('傾き送信の接続が切れました'),
        )
      }
    })
    this.asset.on('close', () => {
      this.assetOpen = false
      this.rejectAllWaiters(
        new Error('写真転送の接続が切れました'),
      )
      if (!this.destroyed && !this.closingAuxiliary) {
        this.events.error(
          new Error('写真転送の接続が切れました'),
        )
      }
    })

    this.motion.on('error', (error) => this.events.error(error))
    this.asset.on('error', (error) => this.events.error(error))
    this.asset.on('data', (data) => {
      const result = assetMessageSchema.safeParse(data)
      if (!result.success) {
        this.events.error(
          new Error('不正なassetメッセージを受信しました'),
        )
        return
      }

      const message = result.data
      if (message.type === 'asset-manifest-received') {
        this.resolveWaiter(`manifest:${message.transferId}`)
      } else if (message.type === 'asset-chunk-received') {
        this.resolveWaiter(
          `chunk:${message.transferId}:${message.index}`,
        )
      } else if (message.type === 'asset-received') {
        this.resolveWaiter(`complete:${message.transferId}`)
      } else if (message.type === 'asset-rejected') {
        this.rejectTransfer(
          message.transferId,
          new Error(message.reason),
        )
      }
    })
  }

  private notifyConnected(): void {
    if (
      this.connectedNotified ||
      this.acceptedSlot === undefined ||
      !this.motionOpen ||
      !this.assetOpen
    ) {
      return
    }

    this.connectedNotified = true
    this.events.connected(this.acceptedSlot)
  }

  private createWaiter(
    key: string,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<void> {
    const promise = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.waiters.delete(key)
        reject(new Error(timeoutMessage))
      }, timeoutMs)
      this.waiters.set(key, { resolve, reject, timer })
    })

    void promise.catch(() => {})
    return promise
  }

  private resolveWaiter(key: string): void {
    const waiter = this.waiters.get(key)
    if (waiter === undefined) return
    window.clearTimeout(waiter.timer)
    this.waiters.delete(key)
    waiter.resolve()
  }

  private clearWaiter(key: string): void {
    const waiter = this.waiters.get(key)
    if (waiter === undefined) return
    window.clearTimeout(waiter.timer)
    this.waiters.delete(key)
  }

  private rejectTransfer(
    transferId: string,
    error: Error,
  ): void {
    for (const [key, waiter] of this.waiters) {
      if (!key.includes(`:${transferId}`)) continue
      window.clearTimeout(waiter.timer)
      this.waiters.delete(key)
      waiter.reject(error)
    }
  }

  private rejectAllWaiters(error: Error): void {
    for (const [key, waiter] of this.waiters) {
      window.clearTimeout(waiter.timer)
      this.waiters.delete(key)
      waiter.reject(error)
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = window.setInterval(() => {
      if (this.control?.open) {
        this.control.send({
          type: 'heartbeat',
        } satisfies ControlMessage)
      }
    }, HEARTBEAT_INTERVAL_MS)

    this.timeoutTimer = window.setInterval(() => {
      if (
        performance.now() - this.lastReceivedAt >
        CONNECTION_TIMEOUT_MS
      ) {
        this.control?.close()
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      window.clearInterval(this.heartbeatTimer)
    }
    if (this.timeoutTimer !== undefined) {
      window.clearInterval(this.timeoutTimer)
    }
    this.heartbeatTimer = undefined
    this.timeoutTimer = undefined
  }
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(
    new Uint8Array(digest),
    (value) => value.toString(16).padStart(2, '0'),
  ).join('')
}
