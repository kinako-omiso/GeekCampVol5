import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { mountDevBattle, type DevBattle } from '../../features/battle/game/devBattle'
import { PeerClient } from '../../lib/peer/peerClient'
import './babylon.css'

export function BabylonPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const battleRef = useRef<DevBattle | null>(null)
  const activePeerRef = useRef<string | null>(null)
  const [peerId, setPeerId] = useState('')
  const [status, setStatus] = useState('3D画面を準備しています')
  const [error, setError] = useState('')
  const [lastInput, setLastInput] = useState('なし')
  const [inspecting, setInspecting] = useState(false)

  useEffect(() => {
    if (!canvasRef.current) return
    let battle: DevBattle
    try {
      battle = mountDevBattle(canvasRef.current)
      battleRef.current = battle
    } catch (cause) {
      queueMicrotask(() => setError(cause instanceof Error ? cause.message : '3D画面を初期化できませんでした。'))
      return
    }

    let lastDisplayAt = 0
    let lastReceivedAt = 0
    const client = new PeerClient({
      open: (id) => {
        setPeerId(id)
        setStatus('スマホの接続を待っています')
      },
      connected: (id) => {
        if (activePeerRef.current && activePeerRef.current !== id) {
          client.disconnect(id)
          return
        }
        activePeerRef.current = id
        lastReceivedAt = performance.now()
        setError('')
        setStatus('スマホが接続しました')
      },
      message: (id, message) => {
        if (id !== activePeerRef.current) return
        lastReceivedAt = performance.now()
        if (message.type === 'motion') {
          battle.setMotion({ x: message.x, y: message.y })
          if (performance.now() - lastDisplayAt > 250) {
            setLastInput('傾き x=' + message.x.toFixed(2) + ' y=' + message.y.toFixed(2))
            lastDisplayAt = performance.now()
          }
        } else if (message.type === 'attack') {
          if (battle.attack(message.button)) setLastInput(message.button.toUpperCase() + ' を受信')
        }
      },
      error: (cause) => setError(cause.message),
      close: (id) => {
        if (activePeerRef.current !== id) return
        activePeerRef.current = null
        battle.stop()
        setLastInput('なし')
        setStatus('スマホが切断しました。再接続できます')
      },
    })
    const heartbeatTimer = window.setInterval(() => {
      const id = activePeerRef.current
      if (!id) return
      if (performance.now() - lastReceivedAt > 4000) {
        client.disconnect(id)
        return
      }
      try { client.send(id, { type: 'heartbeat' }) } catch { client.disconnect(id) }
    }, 2000)
    return () => {
      window.clearInterval(heartbeatTimer)
      client.destroy()
      battle.dispose()
      battleRef.current = null
      activePeerRef.current = null
    }
  }, [])

  const phoneUrl = peerId
    ? window.location.origin + '/dev/peer?host=' + encodeURIComponent(peerId)
    : ''

  return (
    <main className="babylon-dev">
      <header>
        <p>ISSUE #4 · 3D描画とスマホ操作</p>
        <h1>3Dモデル操作テスト</h1>
        <p>Quick Scanのサンプル形状をスマホ1台で動かします。</p>
      </header>

      <section className="babylon-dev__scene" aria-label="3Dモデルの検証">
        <canvas ref={canvasRef} aria-label="Quick Scanモデルとアリーナ" />
      </section>

      <div className="babylon-dev__details">
        <section>
          <h2>表示確認</h2>
          <button type="button" onClick={() => {
            const next = !inspecting
            setInspecting(next)
            battleRef.current?.setInspecting(next)
          }}>
            {inspecting ? '操作に戻る' : '視点確認を始める'}
          </button>
          <p>{inspecting ? 'ドラッグでモデルを回転、ホイールで拡大縮小できます。' : 'カメラの方位は固定です。スマホを傾けるとモデルが動きます。'}</p>
          <p>最後の入力: {lastInput}</p>
        </section>
        <section>
          <h2>スマホ接続</h2>
          <p role="status">{status}</p>
          {error && <p className="babylon-dev__error" role="alert">{error}</p>}
          {phoneUrl && <>
            <QRCodeSVG value={phoneUrl} size={180} />
            <p>スマホでQRを読み取り、横持ちにしてください。</p>
            <a href={phoneUrl}>{phoneUrl}</a>
          </>}
        </section>
      </div>
    </main>
  )
}
