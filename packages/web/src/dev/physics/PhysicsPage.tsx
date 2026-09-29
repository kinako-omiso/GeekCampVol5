import { useEffect, useRef, useState } from 'react'
import type { PhysicsBattle } from '../../features/battle/game/physicsBattle'
import type { PlayerId } from '../../../../../docs/design/tokens'
import '../../../../../docs/design/tokens.css'
import './physics.css'

const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

export function PhysicsPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const battleRef = useRef<PhysicsBattle | null>(null)
  const [generation, setGeneration] = useState(0)
  const [ready, setReady] = useState(false)
  const [contacts, setContacts] = useState(0)
  const [out, setOut] = useState<PlayerId[]>([])
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Havok を読み込んでいます…')

  useEffect(() => {
    if (!canvasRef.current) return
    const abort = new AbortController()
    const pressed = new Set<string>()
    let battle: PhysicsBattle | null = null
    let cancelled = false

    const syncInput = () => {
      if (!battle) return
      battle.setInput('p1', {
        x: Number(pressed.has('KeyD')) - Number(pressed.has('KeyA')),
        y: Number(pressed.has('KeyW')) - Number(pressed.has('KeyS')),
      })
      battle.setInput('p2', {
        x: Number(pressed.has('ArrowRight')) - Number(pressed.has('ArrowLeft')),
        y: Number(pressed.has('ArrowUp')) - Number(pressed.has('ArrowDown')),
      })
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!movementKeys.has(event.code) && event.code !== 'KeyF' && event.code !== 'Enter') return
      if (event.code === 'Enter' && event.target instanceof HTMLButtonElement) return
      event.preventDefault()
      if (event.code === 'KeyF' || event.code === 'Enter') {
        if (!event.repeat) battle?.applyTestImpulse(event.code === 'KeyF' ? 'p1' : 'p2')
        return
      }
      pressed.add(event.code)
      syncInput()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!movementKeys.has(event.code)) return
      event.preventDefault()
      pressed.delete(event.code)
      syncInput()
    }
    const clearInput = () => {
      pressed.clear()
      syncInput()
    }
    const onVisibilityChange = () => {
      if (document.hidden) clearInput()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearInput)
    document.addEventListener('visibilitychange', onVisibilityChange)

    void import('../../features/battle/game/physicsBattle')
      .then(async ({ mountPhysicsBattle }) => {
        if (cancelled || !canvasRef.current) return
        const mounted = await mountPhysicsBattle(canvasRef.current, (event) => {
          if (cancelled) return
          if (event.type === 'contact') {
            setContacts((count) => count + 1)
          } else {
            setOut((players) => players.includes(event.player) ? players : [...players, event.player])
          }
        }, abort.signal)
        if (cancelled) {
          mounted.dispose()
          return
        }
        battle = mounted
        battleRef.current = mounted
        syncInput()
        setReady(true)
        setStatus('2体の衝突と場外を確認できます。')
        canvasRef.current?.focus()
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : '物理シーンを初期化できませんでした。')
        setStatus('初期化に失敗しました。')
      })

    return () => {
      cancelled = true
      abort.abort()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearInput)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      battle?.dispose()
      battleRef.current = null
    }
  }, [generation])

  const reset = () => {
    setReady(false)
    setContacts(0)
    setOut([])
    setError('')
    setStatus('Havok を読み込んでいます…')
    setGeneration((value) => value + 1)
  }

  return (
    <main className="physics-dev">
      <header>
        <a href="/host">トップへ戻る</a>
        <p>ISSUE #6 · 物理検証</p>
        <h1>衝突と場外判定</h1>
        <p>Quick Scan の同じサンプル形状を2体使い、Havok の衝突を確認します。</p>
      </header>

      <section className="physics-dev__scene" aria-label="3D物理の検証">
        <canvas ref={canvasRef} tabIndex={0} aria-label="2体のコマと半径6のアリーナ" />
      </section>

      <p className="physics-dev__status" role="status">{status}</p>
      {error && <p className="physics-dev__error" role="alert">{error}</p>}

      <div className="physics-dev__details">
        <section className="physics-dev__player physics-dev__player--p1">
          <h2>1P · 青</h2>
          <p>W / A / S / D で移動、F で前方へ押す</p>
          <p>場外: {out.includes('p1') ? 'あり' : 'なし'}</p>
        </section>
        <section className="physics-dev__player physics-dev__player--p2">
          <h2>2P · 赤</h2>
          <p>矢印キーで移動、Enter で前方へ押す</p>
          <p>場外: {out.includes('p2') ? 'あり' : 'なし'}</p>
        </section>
      </div>
      <div className="physics-dev__footer">
        <p>コマ同士の接触開始: <strong>{contacts}</strong> 回</p>
        <button type="button" disabled={!ready && !error} onClick={reset}>最初から試す</button>
      </div>
      <p className="physics-dev__note">F / Enter は物理検証用です。正式な A / B 攻撃や HP はこの画面では扱いません。</p>
    </main>
  )
}
