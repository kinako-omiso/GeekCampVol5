import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import {
  controlMessageSchema,
  type ControlMessage,
  type PairingMetadata,
  type PlayerSlot,
} from '@gikcamp/protocol'

const HEARTBEAT_INTERVAL_MS = 2_000
const CONNECTION_TIMEOUT_MS = 8_000

// イベント定義
type ControllerPeerSessionEvents = {
  connected: (slot: PlayerSlot) => void
  rejected: (reason: string) => void
  disconnected: () => void
  error: (error: Error) => void
}

export class ControllerPeerSession {
  private readonly peer: Peer
  private readonly events: ControllerPeerSessionEvents
  private connection: DataConnection | undefined
  private heartbeatTimer: number | undefined
  private timeoutTimer: number | undefined
  private lastReceivedAt = performance.now()
  private destroyed = false

  constructor(
    hostPeerId: string,
    metadata: PairingMetadata,
    events: ControllerPeerSessionEvents,
  ) {
    this.events = events
    this.peer = new Peer()

    this.peer.on('open', () => {
      this.connect(hostPeerId, metadata)
    })

    this.peer.on('error', (error) => {
      this.events.error(error)
    })
  }

  destroy(): void {
    this.destroyed = true
    this.stopHeartbeat()
    this.connection?.close()
    this.peer.destroy()
  }

  private connect(
    hostPeerId: string,
    metadata: PairingMetadata,
  ): void {
    const connection = this.peer.connect(hostPeerId, {
      label: 'control',
      reliable: true,
      metadata,
    })

    this.connection = connection

    connection.on('open', () => {
      this.lastReceivedAt = performance.now()
      this.startHeartbeat()
    })

    connection.on('data', (data) => {
      const messageResult = controlMessageSchema.safeParse(data)

      if (!messageResult.success) {
        this.events.error(
          new Error('不正なcontrolメッセージを受信しました'),
        )
        return
      }

      this.lastReceivedAt = performance.now()
      const message = messageResult.data

      if (message.type === 'connection-accepted') {
        this.events.connected(message.slot)
      }

      if (message.type === 'connection-rejected') {
        this.events.rejected(message.reason)
        connection.close()
      }
    })

    connection.on('close', () => {
      this.stopHeartbeat()

      if (!this.destroyed) {
        this.events.disconnected()
      }
    })

    connection.on('error', (error) => {
      this.events.error(error)
    })
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = window.setInterval(() => {
      if (this.connection?.open) {
        const message: ControlMessage = {
          type: 'heartbeat',
        }

        this.connection.send(message)
      }
    }, HEARTBEAT_INTERVAL_MS)

    this.timeoutTimer = window.setInterval(() => {
      if (
        performance.now() - this.lastReceivedAt >
        CONNECTION_TIMEOUT_MS
      ) {
        this.connection?.close()
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