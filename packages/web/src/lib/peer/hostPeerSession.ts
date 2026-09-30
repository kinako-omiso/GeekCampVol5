import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import {
  ASSET_CHUNK_SIZE,
  assetMessageSchema,
  controlMessageSchema,
  motionMessageSchema,
  pairingMetadataSchema,
  type AssetManifest,
  type AssetMessage,
  type ControlMessage,
  type MotionMessage,
  type PairingMetadata,
  type PlayerSlot,
} from '@gikcamp/protocol'
import { createPairingMetadata } from './pairing.ts'

const HEARTBEAT_INTERVAL_MS = 2_000
const CONNECTION_TIMEOUT_MS = 8_000

type PairingMetadataBySlot = Record<PlayerSlot, PairingMetadata>
type PendingTransfer = {
  manifest: AssetManifest
  chunks: Array<ArrayBuffer | undefined>
  receivedBytes: number
}

type HostPeerSessionEvents = {
  ready: (hostPeerId: string, metadata: PairingMetadataBySlot) => void
  playerConnected: (slot: PlayerSlot, controllerPeerId: string) => void
  playerDisconnected: (slot: PlayerSlot) => void
  motionReceived: (slot: PlayerSlot, message: MotionMessage) => void
  buttonPressed: (slot: PlayerSlot, button: 'a' | 'b') => void
  assetProgress: (
    slot: PlayerSlot,
    receivedBytes: number,
    totalBytes: number,
  ) => void
  assetReceived: (
    slot: PlayerSlot,
    manifest: AssetManifest,
    blob: Blob,
  ) => void
  error: (error: Error) => void
}

export class HostPeerSession {
  private readonly peer = new Peer()
  private readonly events: HostPeerSessionEvents
  private readonly pairingMetadata: PairingMetadataBySlot = {
    1: createPairingMetadata(1),
    2: createPairingMetadata(2),
  }
  private readonly control: Partial<Record<PlayerSlot, DataConnection>> = {}
  private readonly motion: Partial<Record<PlayerSlot, DataConnection>> = {}
  private readonly asset: Partial<Record<PlayerSlot, DataConnection>> = {}
  private readonly lastReceivedAt: Partial<Record<PlayerSlot, number>> = {}
  private readonly lastSequence: Partial<Record<PlayerSlot, number>> = {}
  private readonly transfers: Partial<Record<PlayerSlot, PendingTransfer>> = {}
  private readonly heartbeatTimer: number
  private readonly timeoutTimer: number

  constructor(events: HostPeerSessionEvents) {
    this.events = events
    this.peer.on('open', (hostPeerId) => {
      this.events.ready(hostPeerId, {
        1: { ...this.pairingMetadata[1] },
        2: { ...this.pairingMetadata[2] },
      })
    })
    this.peer.on('connection', (connection) => {
      this.handleConnection(connection)
    })
    this.peer.on('error', (error) => this.events.error(error))

    this.heartbeatTimer = window.setInterval(
      () => this.broadcastHeartbeat(),
      HEARTBEAT_INTERVAL_MS,
    )
    this.timeoutTimer = window.setInterval(
      () => this.disconnectTimedOutPlayers(),
      HEARTBEAT_INTERVAL_MS,
    )
  }

  destroy(): void {
    window.clearInterval(this.heartbeatTimer)
    window.clearInterval(this.timeoutTimer)
    for (const slot of [1, 2] as const) {
      this.motion[slot]?.close()
      this.asset[slot]?.close()
      this.control[slot]?.close()
    }
    this.peer.destroy()
  }

  private handleConnection(connection: DataConnection): void {
    if (connection.label === 'control') {
      this.handleControl(connection)
    } else if (connection.label === 'motion') {
      this.handleMotion(connection)
    } else if (connection.label === 'asset') {
      this.handleAsset(connection)
    } else {
      this.closeWhenOpen(connection)
    }
  }

  private handleControl(connection: DataConnection): void {
    const metadata = this.readMetadata(connection)
    if (metadata === null) {
      this.rejectConnection(connection, '接続情報が不正です')
      return
    }

    connection.on('open', () => {
      if (this.control[metadata.slot] !== undefined) {
        this.rejectConnection(
          connection,
          `Player ${metadata.slot} は接続済みです`,
        )
        return
      }

      this.control[metadata.slot] = connection
      this.lastReceivedAt[metadata.slot] = performance.now()
      connection.send({
        type: 'connection-accepted',
        slot: metadata.slot,
      } satisfies ControlMessage)
      this.events.playerConnected(metadata.slot, connection.peer)
    })

    connection.on('data', (data) => {
      const result = controlMessageSchema.safeParse(data)
      if (!result.success) {
        this.events.error(new Error('不正なcontrolメッセージを受信しました'))
        return
      }

      this.lastReceivedAt[metadata.slot] = performance.now()
      if (result.data.type === 'attack') {
        this.events.buttonPressed(metadata.slot, result.data.button)
      }
    })
    connection.on('close', () => {
      this.removePlayer(metadata.slot, connection)
    })
    connection.on('error', (error) => this.events.error(error))
  }

  private handleMotion(connection: DataConnection): void {
    const metadata = this.readMetadata(connection)
    if (metadata === null) {
      this.closeWhenOpen(connection)
      return
    }

    connection.on('open', () => {
      if (!this.isSameController(metadata.slot, connection)) {
        connection.close()
        return
      }
      this.motion[metadata.slot]?.close()
      this.motion[metadata.slot] = connection
    })

    connection.on('data', (data) => {
      if (this.motion[metadata.slot] !== connection) {
        return
      }

      const result = motionMessageSchema.safeParse(data)
      if (!result.success) {
        this.events.error(new Error('不正なmotionメッセージを受信しました'))
        return
      }

      const previous = this.lastSequence[metadata.slot] ?? -1
      if (result.data.sequence <= previous) return
      this.lastSequence[metadata.slot] = result.data.sequence
      this.events.motionReceived(metadata.slot, result.data)
    })
    connection.on('close', () => {
      if (this.motion[metadata.slot] === connection) {
        delete this.motion[metadata.slot]
      }
    })
    connection.on('error', (error) => this.events.error(error))
  }

  private handleAsset(connection: DataConnection): void {
    const metadata = this.readMetadata(connection)
    if (metadata === null) {
      this.closeWhenOpen(connection)
      return
    }

    connection.on('open', () => {
      if (!this.isSameController(metadata.slot, connection)) {
        connection.close()
        return
      }
      this.asset[metadata.slot]?.close()
      this.asset[metadata.slot] = connection
    })

    connection.on('data', (data) => {
      if (this.asset[metadata.slot] !== connection) {
        return
      }

      const result = assetMessageSchema.safeParse(data)
      if (!result.success) {
        this.events.error(new Error('不正なassetメッセージを受信しました'))
        return
      }
      void this.handleAssetMessage(
        metadata.slot,
        connection,
        result.data,
      ).catch((error: unknown) => {
        this.events.error(
          error instanceof Error
            ? error
            : new Error('写真の受信処理に失敗しました'),
        )
      })
    })
    connection.on('close', () => {
      if (this.asset[metadata.slot] === connection) {
        delete this.asset[metadata.slot]
        delete this.transfers[metadata.slot]
      }
    })
    connection.on('error', (error) => this.events.error(error))
  }

  private async handleAssetMessage(
    slot: PlayerSlot,
    connection: DataConnection,
    message: AssetMessage,
  ): Promise<void> {
    if (message.type === 'asset-manifest') {
      const expected = Math.ceil(
        message.manifest.byteLength / ASSET_CHUNK_SIZE,
      )
      if (
        this.transfers[slot] !== undefined ||
        message.manifest.chunkCount !== expected
      ) {
        this.rejectAsset(connection, message.manifest.transferId, '転送情報が不正です')
        return
      }

      this.transfers[slot] = {
        manifest: message.manifest,
        chunks: new Array(message.manifest.chunkCount),
        receivedBytes: 0,
      }
      this.events.assetProgress(slot, 0, message.manifest.byteLength)
      connection.send({
        type: 'asset-manifest-received',
        transferId: message.manifest.transferId,
      } satisfies AssetMessage)
      return
    }

    if (message.type === 'asset-chunk') {
      const transfer = this.transfers[slot]
      if (
        transfer === undefined ||
        transfer.manifest.transferId !== message.transferId ||
        message.index >= transfer.manifest.chunkCount ||
        transfer.chunks[message.index] !== undefined ||
        message.data.byteLength === 0 ||
        message.data.byteLength > ASSET_CHUNK_SIZE ||
        transfer.receivedBytes + message.data.byteLength >
          transfer.manifest.byteLength
      ) {
        this.rejectAsset(connection, message.transferId, '写真チャンクが不正です')
        delete this.transfers[slot]
        return
      }

      transfer.chunks[message.index] = message.data
      transfer.receivedBytes += message.data.byteLength
      this.events.assetProgress(
        slot,
        transfer.receivedBytes,
        transfer.manifest.byteLength,
      )
      connection.send({
        type: 'asset-chunk-received',
        transferId: message.transferId,
        index: message.index,
      } satisfies AssetMessage)
      return
    }

    if (message.type !== 'asset-complete') return
    const transfer = this.transfers[slot]
    if (
      transfer === undefined ||
      transfer.manifest.transferId !== message.transferId ||
      transfer.receivedBytes !== transfer.manifest.byteLength ||
      transfer.chunks.some((chunk) => chunk === undefined)
    ) {
      this.rejectAsset(connection, message.transferId, '写真データが不足しています')
      delete this.transfers[slot]
      return
    }

    const bytes = new Uint8Array(transfer.manifest.byteLength)
    let offset = 0
    for (const chunk of transfer.chunks) {
      if (chunk === undefined) return
      bytes.set(new Uint8Array(chunk), offset)
      offset += chunk.byteLength
    }

    if (await sha256(bytes.buffer) !== transfer.manifest.sha256) {
      this.rejectAsset(connection, message.transferId, '写真のハッシュが一致しません')
      delete this.transfers[slot]
      return
    }

    const blob = new Blob(
      [bytes.buffer],
      { type: transfer.manifest.mimeType },
    )
    this.events.assetReceived(slot, transfer.manifest, blob)
    connection.send({
      type: 'asset-received',
      transferId: message.transferId,
    } satisfies AssetMessage)
    delete this.transfers[slot]
  }

  private readMetadata(connection: DataConnection): PairingMetadata | null {
    const result = pairingMetadataSchema.safeParse(connection.metadata)
    if (!result.success) return null
    const expected = this.pairingMetadata[result.data.slot]
    return result.data.token === expected.token ? result.data : null
  }

  private isSameController(
    slot: PlayerSlot,
    connection: DataConnection,
  ): boolean {
    return this.control[slot]?.peer === connection.peer
  }

  private rejectConnection(
    connection: DataConnection,
    reason: string,
  ): void {
    const reject = () => {
      connection.send({
        type: 'connection-rejected',
        reason,
      } satisfies ControlMessage)
      queueMicrotask(() => connection.close())
    }
    if (connection.open) reject()
    else connection.on('open', reject)
  }

  private rejectAsset(
    connection: DataConnection,
    transferId: string,
    reason: string,
  ): void {
    connection.send({
      type: 'asset-rejected',
      transferId,
      reason,
    } satisfies AssetMessage)
  }

  private closeWhenOpen(connection: DataConnection): void {
    if (connection.open) connection.close()
    else connection.on('open', () => connection.close())
  }

  private broadcastHeartbeat(): void {
    const message: ControlMessage = { type: 'heartbeat' }
    this.control[1]?.send(message)
    this.control[2]?.send(message)
  }

  private disconnectTimedOutPlayers(): void {
    const now = performance.now()
    for (const slot of [1, 2] as const) {
      const connection = this.control[slot]
      const lastReceivedAt = this.lastReceivedAt[slot]
      if (
        connection !== undefined &&
        lastReceivedAt !== undefined &&
        now - lastReceivedAt > CONNECTION_TIMEOUT_MS
      ) {
        connection.close()
        this.removePlayer(slot, connection)
      }
    }
  }

  private removePlayer(
    slot: PlayerSlot,
    connection: DataConnection,
  ): void {
    if (this.control[slot] !== connection) return
    delete this.control[slot]
    delete this.lastReceivedAt[slot]
    delete this.lastSequence[slot]
    delete this.transfers[slot]

    const motion = this.motion[slot]
    const asset = this.asset[slot]
    delete this.motion[slot]
    delete this.asset[slot]
    motion?.close()
    asset?.close()
    this.events.playerDisconnected(slot)
  }
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(
    new Uint8Array(digest),
    (value) => value.toString(16).padStart(2, '0'),
  ).join('')
}
