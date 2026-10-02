import Peer, { type DataConnection } from 'peerjs'
import { assetMessageSchema, controlMessageSchema, motionMessageSchema, pairingMetadataSchema,
  type AssetManifest, type ControlMessage, type MotionMessage, type PairingMetadata, type PlayerSlot } from '@gikcamp/protocol'
import { createPairingMetadata } from './pairing.ts'
import { AssetTransport, type AssetDetails } from './assetTransport.ts'

type HostPeerSessionEvents = {
  ready: (hostPeerId: string, metadata: Record<PlayerSlot, PairingMetadata>) => void
  playerConnected: (slot: PlayerSlot, controllerPeerId: string) => void
  playerDisconnected: (slot: PlayerSlot) => void
  motionReceived: (slot: PlayerSlot, message: MotionMessage) => void
  buttonPressed: (slot: PlayerSlot, button: 'a' | 'b') => void
  controlReceived?: (slot: PlayerSlot, message: ControlMessage) => void
  assetProgress: (slot: PlayerSlot, receivedBytes: number, totalBytes: number) => void
  assetReceived: (slot: PlayerSlot, manifest: AssetManifest, blob: Blob) => void
  error: (error: Error) => void
}

export class HostPeerSession {
  private readonly peer = new Peer()
  private events: HostPeerSessionEvents
  private pairingMetadata: Record<PlayerSlot, PairingMetadata> = { 1: createPairingMetadata(1), 2: createPairingMetadata(2) }
  private control: Partial<Record<PlayerSlot, DataConnection>> = {}
  private motion: Partial<Record<PlayerSlot, DataConnection>> = {}
  private asset: Partial<Record<PlayerSlot, DataConnection>> = {}
  private transports: Partial<Record<PlayerSlot, AssetTransport>> = {}
  private lastReceivedAt: Partial<Record<PlayerSlot, number>> = {}
  private lastSequence: Partial<Record<PlayerSlot, number>> = {}
  private notified = new Set<PlayerSlot>()
  private heartbeatTimer: ReturnType<typeof setInterval>

  constructor(events: HostPeerSessionEvents) {
    this.events = events
    this.peer.on('open', (id) => events.ready(id, this.pairingMetadata))
    this.peer.on('connection', (connection) => this.handleConnection(connection))
    this.peer.on('error', (error) => events.error(error))
    this.heartbeatTimer = setInterval(() => {
      if (this.peer.disconnected && !this.peer.destroyed) this.peer.reconnect()
      for (const slot of [1, 2] as const) {
        const connection = this.control[slot]
        if (!connection) continue
        if (performance.now() - (this.lastReceivedAt[slot] ?? 0) > 8_000) this.removePlayer(slot, connection)
        else this.sendControl(slot, { type: 'heartbeat' })
      }
    }, 2_000)
  }

  sendControl(slot: PlayerSlot, message: ControlMessage): void {
    if (this.control[slot]?.open) this.control[slot]!.send(message)
  }

  sendAsset(slot: PlayerSlot, blob: Blob, details: AssetDetails): Promise<AssetManifest> {
    const transport = this.transports[slot]
    return transport ? transport.send(blob, details) : Promise.reject(new Error('Mask返送の接続がありません。'))
  }

  destroy(): void {
    clearInterval(this.heartbeatTimer)
    for (const slot of [1, 2] as const) {
      this.transports[slot]?.dispose()
      const connections = [this.control[slot], this.motion[slot], this.asset[slot]]
      delete this.control[slot]; delete this.motion[slot]; delete this.asset[slot]
      for (const connection of connections) connection?.close()
    }
    this.peer.destroy()
  }

  private handleConnection(connection: DataConnection): void {
    const parsed = pairingMetadataSchema.safeParse(connection.metadata)
    if (!parsed.success || parsed.data.token !== this.pairingMetadata[parsed.data.slot].token ||
        !['control', 'motion', 'asset'].includes(connection.label)) {
      connection.on('open', () => {
        if (connection.label === 'control') connection.send({ type: 'connection-rejected', reason: '接続情報が不正です。' })
        connection.close()
      })
      return
    }
    const slot = parsed.data.slot
    const channels = connection.label === 'control' ? this.control : connection.label === 'motion' ? this.motion : this.asset
    connection.on('open', () => {
      if (channels[slot] || (connection.label !== 'control' && this.control[slot]?.peer !== connection.peer)) {
        if (connection.label === 'control') connection.send({ type: 'connection-rejected', reason: `Player ${slot} は接続済みです。` })
        connection.close(); return
      }
      channels[slot] = connection
      if (connection.label === 'control') {
        this.lastReceivedAt[slot] = performance.now()
        this.sendControl(slot, { type: 'connection-accepted', slot })
      } else if (connection.label === 'asset') {
        this.transports[slot] = new AssetTransport(connection, {
          progress: (received, total) => this.events.assetProgress(slot, received, total),
          received: (manifest, blob) => this.events.assetReceived(slot, manifest, blob),
        })
      }
      if (!this.notified.has(slot) && this.control[slot]?.open && this.motion[slot]?.open && this.asset[slot]?.open) {
        this.notified.add(slot)
        this.events.playerConnected(slot, connection.peer)
      }
    })
    connection.on('data', (data) => {
      if (channels[slot] !== connection) return
      if (connection.label === 'control') {
        const result = controlMessageSchema.safeParse(data)
        if (!result.success) { this.events.error(new Error('不正なcontrolメッセージを受信しました。')); return }
        this.lastReceivedAt[slot] = performance.now()
        if (result.data.type === 'attack') this.events.buttonPressed(slot, result.data.button)
        else this.events.controlReceived?.(slot, result.data)
      } else if (connection.label === 'motion') {
        const result = motionMessageSchema.safeParse(data)
        if (!result.success || result.data.sequence <= (this.lastSequence[slot] ?? -1)) return
        this.lastSequence[slot] = result.data.sequence
        this.events.motionReceived(slot, result.data)
      } else {
        const result = assetMessageSchema.safeParse(data)
        if (!result.success) { this.events.error(new Error('不正なassetメッセージを受信しました。')); return }
        void this.transports[slot]?.receive(result.data).catch((cause: unknown) => this.events.error(
          cause instanceof Error ? cause : new Error('アセットを受信できませんでした。')))
      }
    })
    connection.on('close', () => {
      if (channels[slot] === connection && this.control[slot]) this.removePlayer(slot, this.control[slot]!)
    })
    connection.on('error', (error) => {
      this.events.error(error)
      if (channels[slot] === connection && this.control[slot]) this.removePlayer(slot, this.control[slot]!)
    })
  }

  private removePlayer(slot: PlayerSlot, control: DataConnection): void {
    if (this.control[slot] !== control) return
    const connections = [control, this.motion[slot], this.asset[slot]]
    delete this.control[slot]; delete this.motion[slot]; delete this.asset[slot]
    delete this.lastSequence[slot]; delete this.lastReceivedAt[slot]
    this.transports[slot]?.dispose(); delete this.transports[slot]
    this.notified.delete(slot)
    for (const connection of connections) connection?.close()
    this.events.playerDisconnected(slot)
  }
}
