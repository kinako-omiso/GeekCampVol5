// peerClientクラスを設定
import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import {
  isTestMessage,
  type TestMessage,
} from '@gikcamp/protocol'

export type PeerClientEvents = {
  open: (peerId: string) => void
  connected: (peerId: string) => void
  message: (peerId: string, message: TestMessage) => void
  error: (error: Error) => void
  close: (peerId: string) => void
}

export class PeerClient {
  private readonly peer: Peer
  private readonly events: PeerClientEvents
  private readonly connections = new Map<string, DataConnection>()

  constructor(events: PeerClientEvents) {
    this.events = events
    this.peer = new Peer()

    this.peer.on('open', (peerId) => {
      this.events.open(peerId)
    })

    this.peer.on('connection', (connection) => {
      this.attachConnection(connection)
    })

    this.peer.on('error', (error) => {
      this.events.error(error)
    })
  }

  connect(peerId: string): void {
    const connection = this.peer.connect(peerId, {
      reliable: true,
    })

    this.attachConnection(connection)
  }

  send(peerId: string, message: TestMessage): void {
    const connection = this.connections.get(peerId)

    if (connection === undefined || !connection.open) {
      throw new Error(`${peerId} と接続されていません`)
    }

    connection.send(message)
  }

  broadcast(message: TestMessage): void {
    for (const connection of this.connections.values()) {
      if (connection.open) {
        connection.send(message)
      }
    }
  }

  disconnect(peerId: string): void {
    const connection = this.connections.get(peerId)

    if (connection === undefined) {
      return
    }

    this.removeConnection(connection)
    connection.close()
  }

  destroy(): void {
    for (const connection of this.connections.values()) {
      connection.close()
    }

    this.connections.clear()
    this.peer.destroy()
  }

  private attachConnection(connection: DataConnection): void {
    connection.on('open', () => {
      this.connections.set(connection.peer, connection)
      this.events.connected(connection.peer)
    })

    connection.on('data', (data) => {
      if (isTestMessage(data)) {
        this.events.message(connection.peer, data)
        return
      }

      this.events.error(
        new Error('未知のメッセージを受信しました'),
      )
    })

    connection.on('close', () => {
      this.removeConnection(connection)
    })

    connection.on('error', (error) => {
      this.events.error(error)
    })
  }

  private removeConnection(connection: DataConnection): void {
    if (this.connections.get(connection.peer) !== connection) {
      return
    }

    this.connections.delete(connection.peer)
    this.events.close(connection.peer)
  }
}