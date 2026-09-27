// peerClientクラスを用いた確認
import { useEffect, useRef, useState } from 'react'
import type { TestMessage } from '@gikcamp/protocol'
import { PeerClient } from '../../lib/peer/peerClient.ts'

// HEARTBEAT_INTERVAL_MSごとにheartbeatを送信、CONNECTION_TIMEOUT_MS秒通信が無ければ通信が切れたと判断
const HEARTBEAT_INTERVAL_MS = 2_000
const CONNECTION_TIMEOUT_MS = 4_000

export function PeerTest() {
  const clientRef = useRef<PeerClient | null>(null)
  const lastReceivedAtRef = useRef(new Map<string, number>())

  const [ownPeerId, setOwnPeerId] = useState('')
  const [parentPeerId, setParentPeerId] = useState('')
  const [connectedPeerIds, setConnectedPeerIds] = useState<string[]>([])
  const [status, setStatus] = useState('Peer IDを取得中')
  const [lastMessage, setLastMessage] = useState('')

  useEffect(() => {
    const client = new PeerClient({
      open: (peerId) => {
        setOwnPeerId(peerId)
        setStatus('接続待ち')
      },

      connected: (peerId) => {
        lastReceivedAtRef.current.set(peerId, performance.now())

        setConnectedPeerIds((peerIds) => {
          if (peerIds.includes(peerId)) {
            return peerIds
          }

          return [...peerIds, peerId]
        })

        setStatus(`${peerId} と接続中`)
      },

      message: (peerId, message) => {
        // heartbeatを含め、受信できた全メッセージを生存確認に使う
        lastReceivedAtRef.current.set(peerId, performance.now())
        setLastMessage(`${peerId}: ${JSON.stringify(message)}`)

        if (message.type === 'ping') {
          client.send(peerId, {
            type: 'pong',
            sentAt: message.sentAt,
            receivedAt: Date.now(),
          })
        }
      },

      error: (error) => {
        setStatus(`エラー: ${error.message}`)
      },

      close: (peerId) => {
        lastReceivedAtRef.current.delete(peerId)

        setConnectedPeerIds((peerIds) =>
          peerIds.filter((id) => id !== peerId),
        )

        setStatus(`${peerId} が切断しました`)
      },
    })

    clientRef.current = client

    const heartbeatTimer = window.setInterval(() => {
      client.broadcast({
        type: 'heartbeat',
      })
    }, HEARTBEAT_INTERVAL_MS)

    const timeoutTimer = window.setInterval(() => {
      const now = performance.now()

      for (const [peerId, lastReceivedAt] of lastReceivedAtRef.current) {
        if (now - lastReceivedAt > CONNECTION_TIMEOUT_MS) {
          setStatus(`${peerId} は応答がないため切断しました`)
          client.disconnect(peerId)
        }
      }
    }, HEARTBEAT_INTERVAL_MS)

    return () => {
      window.clearInterval(heartbeatTimer)
      window.clearInterval(timeoutTimer)
      client.destroy()
    }
  }, [])

  const connectToParent = () => {
    const peerId = parentPeerId.trim()

    if (peerId === '') {
      setStatus('親のPeer IDを入力してください')
      return
    }

    clientRef.current?.connect(peerId)
  }

  const sendPing = () => {
    const message: TestMessage = {
      type: 'ping',
      sentAt: Date.now(),
    }

    clientRef.current?.broadcast(message)
    setLastMessage(`送信: ${JSON.stringify(message)}`)
  }

  return (
    <main>
      <h1>PeerJS通信テスト</h1>

      <p>状態: {status}</p>

      <p>
        自分のPeer ID:
        {' '}
        {ownPeerId || '取得中...'}
      </p>

      <p>接続中のクライアント: {connectedPeerIds.length} 台</p>

      <label>
        親のPeer ID（子だけ入力）
        {' '}
        <input
          value={parentPeerId}
          onChange={(event) => {
            setParentPeerId(event.target.value)
          }}
        />
      </label>

      <div>
        <button type="button" onClick={connectToParent}>
          親へ接続
        </button>

        <button
          type="button"
          onClick={sendPing}
          disabled={connectedPeerIds.length === 0}
        >
          接続中の全員へPing送信
        </button>
      </div>

      <h2>接続中のPeer ID</h2>

      <ul>
        {connectedPeerIds.map((peerId) => (
          <li key={peerId}>{peerId}</li>
        ))}
      </ul>

      <p>
        最後のメッセージ:
        {' '}
        {lastMessage || 'なし'}
      </p>
    </main>
  )
}