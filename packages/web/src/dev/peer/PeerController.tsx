import { useEffect, useRef, useState } from 'react'
import { JoinScreen } from '../../features/join/JoinScreen'
import { PadScreen } from '../../features/pad/PadScreen'
import { PeerClient } from '../../lib/peer/peerClient'
import {
  createTiltNormalizer,
  getScreenAngle,
  subscribeOrientation,
  type Baseline,
  type TiltVector,
} from '../../lib/sensor'
import '../../../../../docs/design/tokens.css'
import './peerController.css'

/** #4 のスマホ検証。既存の接続・パッド画面を使う。 */
export function PeerController({ hostId }: { hostId: string }) {
  const clientRef = useRef<PeerClient | null>(null)
  const connectedRef = useRef(false)
  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState('通信を準備しています')
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [sensorWarning, setSensorWarning] = useState('')
  const [communicationError, setCommunicationError] = useState('')

  useEffect(() => {
    let lastReceivedAt = 0
    const client = new PeerClient({
      open: () => {
        setStatus('PCに接続しています')
        client.connect(hostId)
      },
      connected: (id) => {
        if (id !== hostId) {
          client.disconnect(id)
          return
        }
        lastReceivedAt = performance.now()
        setCommunicationError('')
        connectedRef.current = true
        setConnected(true)
        setStatus('PCに接続しました')
      },
      message: (id) => {
        if (id === hostId) lastReceivedAt = performance.now()
      },
      error: (cause) => {
        setStatus('通信エラー: ' + cause.message)
        setCommunicationError(cause.message)
      },
      close: (id) => {
        if (id !== hostId) return
        connectedRef.current = false
        setConnected(false)
        setStatus('PCとの接続が切れました')
      },
    })
    clientRef.current = client
    const heartbeatTimer = window.setInterval(() => {
      if (!clientRef.current || !connectedRef.current) return
      if (performance.now() - lastReceivedAt > 4000) {
        client.disconnect(hostId)
        return
      }
      try { client.send(hostId, { type: 'heartbeat' }) } catch { client.disconnect(hostId) }
    }, 2000)
    return () => {
      window.clearInterval(heartbeatTimer)
      client.destroy()
      clientRef.current = null
    }
  }, [hostId])

  useEffect(() => {
    if (!connected || !baseline) return
    const normalize = createTiltNormalizer(baseline)
    let latest: TiltVector = { x: 0, y: 0 }
    let lastSampleAt = 0
    let sequence = 0
    const unsubscribe = subscribeOrientation((sample) => {
      const vector = normalize(sample, getScreenAngle())
      if (!vector) {
        latest = { x: 0, y: 0 }
        setSensorWarning('横持ちの向きが変わりました。基準姿勢を取り直してください')
        return
      }
      latest = vector
      lastSampleAt = performance.now()
      setSensorWarning('')
    })
    const timer = window.setInterval(() => {
      const vector = performance.now() - lastSampleAt <= 250 ? latest : { x: 0, y: 0 }
      try {
        clientRef.current?.send(hostId, {
          type: 'motion',
          sequence,
          x: vector.x,
          y: vector.y,
        })
        sequence += 1
      } catch (cause) {
        setCommunicationError(cause instanceof Error ? cause.message : '傾きを送信できませんでした')
      }
    }, 1000 / 30)
    return () => {
      window.clearInterval(timer)
      unsubscribe()
    }
  }, [connected, baseline, hostId])

  const sendAttack = (button: 'a' | 'b') => {
    try {
      clientRef.current?.send(hostId, { type: 'attack', button })
    } catch (cause) {
      setCommunicationError(cause instanceof Error ? cause.message : 'ボタンを送信できませんでした')
    }
  }

  if (!connected) {
    return (
      <main className="peer-controller__waiting">
        <h1>PCに接続</h1>
        <p role="status">{status}</p>
        <button type="button" onClick={() => {
          setStatus('PCに再接続しています')
          clientRef.current?.connect(hostId)
        }}>再接続する</button>
      </main>
    )
  }

  return (
    <>
      {baseline
        ? <PadScreen player="p1" connected onAttack={sendAttack} />
        : <JoinScreen player="p1" connected onCalibrated={setBaseline} />}
      {(sensorWarning || communicationError) && (
        <div className="peer-controller__warning" role="alert">
          <span>{sensorWarning || communicationError}</span>
          {sensorWarning && <button type="button" onClick={() => {
            setBaseline(null)
            setSensorWarning('')
          }}>取り直す</button>}
        </div>
      )}
    </>
  )
}
