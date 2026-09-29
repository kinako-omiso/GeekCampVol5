import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import {
  controlMessageSchema,
  pairingMetadataSchema,
  type ControlMessage,
  type PairingMetadata,
  type PlayerSlot,
} from '@gikcamp/protocol'
import { createPairingMetadata } from './pairing.ts'

// 2秒ごとにheartbeatを送信し、8秒受信が無ければ切断と扱う
const HEARTBEAT_INTERVAL_MS = 2_000
const CONNECTION_TIMEOUT_MS = 8_000

// プレイヤー番号とメタデータの対応
type PairingMetadataBySlot = Record<PlayerSlot, PairingMetadata>

// イベント定義
type HostPeerSessionEvents = {
  ready: (
    hostPeerId: string,
    metadata: PairingMetadataBySlot,
  ) => void
  playerConnected: (
    slot: PlayerSlot,
    controllerPeerId: string,
  ) => void
  playerDisconnected: (slot: PlayerSlot) => void
  error: (error: Error) => void
}

export class HostPeerSession {
  private readonly peer: Peer
  private readonly events: HostPeerSessionEvents

  private readonly pairingMetadata: PairingMetadataBySlot = {
    1: createPairingMetadata(1),
    2: createPairingMetadata(2),
  }

  private readonly connections: Partial<
    Record<PlayerSlot, DataConnection>
  > = {}

  private readonly lastReceivedAt: Partial<
    Record<PlayerSlot, number>
  > = {}

  private readonly heartbeatTimer: number
  private readonly timeoutTimer: number

  constructor(events: HostPeerSessionEvents) {
    this.events = events
    this.peer = new Peer()

    this.peer.on('open', (hostPeerId) => {
      this.events.ready(hostPeerId, {
        1: { ...this.pairingMetadata[1] },
        2: { ...this.pairingMetadata[2] },
      })
    })

    this.peer.on('connection', (connection) => {
      this.handleConnection(connection)
    })

    this.peer.on('error', (error) => {
      this.events.error(error)
    })

    this.heartbeatTimer = window.setInterval(() => {
      this.broadcastHeartbeat()
    }, HEARTBEAT_INTERVAL_MS)

    this.timeoutTimer = window.setInterval(() => {
      this.disconnectTimedOutPlayers()
    }, HEARTBEAT_INTERVAL_MS)
  }

  destroy(): void {
    window.clearInterval(this.heartbeatTimer)
    window.clearInterval(this.timeoutTimer)

    this.connections[1]?.close()
    this.connections[2]?.close()
    this.peer.destroy()
  }

  private handleConnection(connection: DataConnection): void {
    if (connection.label !== 'control') {
      connection.close()
      return
    }

    const metadataResult = pairingMetadataSchema.safeParse(
      connection.metadata,
    )

    if (!metadataResult.success) {
      this.rejectConnection(connection, '接続情報が不正です')
      return
    }

    const metadata = metadataResult.data
    const expected = this.pairingMetadata[metadata.slot]

    if (metadata.token !== expected.token) {
      this.rejectConnection(connection, 'トークンが一致しません')
      return
    }

    if (this.connections[metadata.slot] !== undefined) {
      this.rejectConnection(
        connection,
        `Player ${metadata.slot} は接続済みです`,
      )
      return
    }

    connection.on('open', () => {
      this.connections[metadata.slot] = connection
      this.lastReceivedAt[metadata.slot] = performance.now()

      const accepted: ControlMessage = {
        type: 'connection-accepted',
        slot: metadata.slot,
      }

      connection.send(accepted)

      this.events.playerConnected(
        metadata.slot,
        connection.peer,
      )
    })

    connection.on('data', (data) => {
      const messageResult = controlMessageSchema.safeParse(data)

      if (!messageResult.success) {
        this.events.error(
          new Error('不正なcontrolメッセージを受信しました'),
        )
        return
      }

      this.lastReceivedAt[metadata.slot] = performance.now()
    })

    connection.on('close', () => {
      this.removeConnection(metadata.slot, connection)
    })

    connection.on('error', (error) => {
      this.events.error(error)
    })
  }

  private rejectConnection(
    connection: DataConnection,
    reason: string,
  ): void {
    const reject = () => {
      const message: ControlMessage = {
        type: 'connection-rejected',
        reason,
      }

      connection.send(message)
      queueMicrotask(() => connection.close())
    }

    if (connection.open) {
      reject()
    } else {
      connection.on('open', reject)
    }
  }

  private broadcastHeartbeat(): void {
    const message: ControlMessage = {
      type: 'heartbeat',
    }

    this.connections[1]?.send(message)
    this.connections[2]?.send(message)
  }

  private disconnectTimedOutPlayers(): void {
    const now = performance.now()

    for (const slot of [1, 2] as const) {
      const connection = this.connections[slot]
      const lastReceivedAt = this.lastReceivedAt[slot]

      if (
        connection !== undefined &&
        lastReceivedAt !== undefined &&
        now - lastReceivedAt > CONNECTION_TIMEOUT_MS
      ) {
        connection.close()
        this.removeConnection(slot, connection)
      }
    }
  }

  private removeConnection(
    slot: PlayerSlot,
    connection: DataConnection,
  ): void {
    if (this.connections[slot] !== connection) {
      return
    }

    delete this.connections[slot]
    delete this.lastReceivedAt[slot]
    this.events.playerDisconnected(slot)
  }
}