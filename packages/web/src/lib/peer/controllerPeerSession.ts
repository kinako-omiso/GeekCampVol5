import Peer, { type DataConnection } from 'peerjs'
import { assetMessageSchema, controlMessageSchema, type AssetManifest, type ControlMessage,
  type MotionMessage, type PairingMetadata, type PlayerSlot } from '@gikcamp/protocol'
import { AssetTransport, type AssetDetails } from './assetTransport.ts'

type ControllerPeerSessionEvents = {
  connected: (slot: PlayerSlot) => void
  rejected: (reason: string) => void
  disconnected: () => void
  controlReceived?: (message: ControlMessage) => void
  assetReceived?: (manifest: AssetManifest, blob: Blob) => void
  error: (error: Error) => void
}

export class ControllerPeerSession {
  private readonly peer = new Peer()
  private hostPeerId: string
  private metadata: PairingMetadata
  private events: ControllerPeerSessionEvents
  private control?: DataConnection
  private motion?: DataConnection
  private asset?: DataConnection
  private transport?: AssetTransport
  private heartbeatTimer?: ReturnType<typeof setInterval>
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private lastReceivedAt = performance.now()
  private motionSequence = 0
  private accepted = false
  private notified = false
  private rejected = false
  private destroyed = false

  constructor(hostPeerId: string, metadata: PairingMetadata, events: ControllerPeerSessionEvents) {
    this.hostPeerId = hostPeerId; this.metadata = metadata; this.events = events
    this.peer.on('open', () => this.connectControl())
    this.peer.on('error', (error) => { events.error(error); this.disconnect() })
  }

  sendControl(message: ControlMessage): void { if (this.control?.open) this.control.send(message) }
  sendAttack(button: 'a' | 'b'): void { this.sendControl({ type: 'attack', button }) }
  sendMotion(motion: { x: number; y: number }): void {
    if (this.motion?.open) this.motion.send({ type: 'motion', sequence: this.motionSequence++, ...motion } satisfies MotionMessage)
  }
  sendPhoto(photo: Blob, dimensions: { width: number; height: number }, onProgress: (ratio: number) => void,
    scan?: AssetManifest['scan']): Promise<void> {
    return this.sendAsset(photo, { kind: 'photo', ...dimensions, scan }, onProgress).then(() => {})
  }
  sendAsset(blob: Blob, details: AssetDetails, onProgress?: (ratio: number) => void): Promise<AssetManifest> {
    return this.transport ? this.transport.send(blob, details, onProgress) : Promise.reject(new Error('アセット転送の接続がありません。'))
  }
  destroy(): void {
    this.destroyed = true
    clearTimeout(this.reconnectTimer)
    this.disconnect()
    this.peer.destroy()
  }

  private connectControl(): void {
    if (this.destroyed || this.rejected || this.control) return
    if (this.peer.disconnected) { this.peer.reconnect(); this.scheduleReconnect(); return }
    const connection = this.peer.connect(this.hostPeerId, { label: 'control', reliable: true, metadata: this.metadata })
    this.control = connection
    connection.on('open', () => {
      if (this.control !== connection) return
      this.lastReceivedAt = performance.now()
      this.heartbeatTimer = setInterval(() => {
        if (performance.now() - this.lastReceivedAt > 8_000) this.disconnect()
        else this.sendControl({ type: 'heartbeat' })
      }, 2_000)
    })
    connection.on('data', (data) => {
      if (this.control !== connection) return
      const result = controlMessageSchema.safeParse(data)
      if (!result.success) { this.events.error(new Error('不正なcontrolメッセージを受信しました。')); return }
      this.lastReceivedAt = performance.now()
      const message = result.data
      if (message.type === 'connection-accepted' && !this.accepted) {
        this.accepted = true; this.connectAuxiliaryChannels()
      } else if (message.type === 'connection-rejected') {
        this.rejected = true; this.events.rejected(message.reason); this.disconnect()
      } else this.events.controlReceived?.(message)
    })
    connection.on('close', () => { if (this.control === connection) this.disconnect() })
    connection.on('error', (error) => { if (this.control === connection) { this.events.error(error); this.disconnect() } })
    // open自体が来ない接続も再試行できるようにする。
    this.reconnectTimer = setTimeout(() => { if (!this.notified && this.control === connection) this.disconnect() }, 12_000)
  }

  private connectAuxiliaryChannels(): void {
    this.motion = this.peer.connect(this.hostPeerId, { label: 'motion', reliable: false, metadata: this.metadata })
    this.asset = this.peer.connect(this.hostPeerId, { label: 'asset', reliable: true, serialization: 'binary', metadata: this.metadata })
    const asset = this.asset
    for (const connection of [this.motion, asset]) {
      connection.on('open', () => {
        if (this.destroyed || (connection !== this.motion && connection !== this.asset)) return
        if (connection === asset) this.transport = new AssetTransport(asset, {
          received: (manifest, blob) => this.events.assetReceived?.(manifest, blob),
        })
        if (!this.notified && this.motion?.open && this.asset?.open) {
          this.notified = true; clearTimeout(this.reconnectTimer); this.events.connected(this.metadata.slot)
        }
      })
      connection.on('close', () => { if (connection === this.motion || connection === this.asset) this.disconnect() })
      connection.on('error', (error) => { if (connection === this.motion || connection === this.asset) { this.events.error(error); this.disconnect() } })
    }
    asset.on('data', (data) => {
      if (this.asset !== asset) return
      const result = assetMessageSchema.safeParse(data)
      if (!result.success) { this.events.error(new Error('不正なassetメッセージを受信しました。')); return }
      void this.transport?.receive(result.data).catch((cause: unknown) => this.events.error(
        cause instanceof Error ? cause : new Error('Maskを受信できませんでした。')))
    })
  }

  private disconnect(): void {
    const hadConnection = !!this.control
    const connections = [this.control, this.motion, this.asset]
    this.control = undefined; this.motion = undefined; this.asset = undefined
    this.accepted = false; this.notified = false; this.motionSequence = 0
    clearInterval(this.heartbeatTimer); clearTimeout(this.reconnectTimer)
    this.transport?.dispose(); this.transport = undefined
    for (const connection of connections) connection?.close()
    if (!this.destroyed && !this.rejected) {
      if (hadConnection) this.events.disconnected()
      this.scheduleReconnect()
    }
  }
  private scheduleReconnect(): void {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => this.connectControl(), 2_000)
  }
}
