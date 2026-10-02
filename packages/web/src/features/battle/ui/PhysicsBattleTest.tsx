import { useEffect, useRef, useState } from 'react'
import type { PhysicsBattle, PhysicsBattleOptions } from '../game/physicsBattle'
import { TEST_ATTACK_MULTIPLIERS, TEST_ATTACK_VALUE } from '../game/knockback'
import type { PlayerId } from '../../../../../../docs/design/tokens'
import '../../../../../../docs/design/tokens.css'
import './physicsBattleTest.css'

const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

type Props = {
  options?: PhysicsBattleOptions
  onBack?: () => void
}

/** キーボード入力と物理イベントの確認用。画面遷移や生成処理は呼び出し元が担当する。 */
export function PhysicsBattleTest({ options, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const battleRef = useRef<PhysicsBattle | null>(null)
  const [generation, setGeneration] = useState(0)
  const [ready, setReady] = useState(false)
  const [contacts, setContacts] = useState(0)
  const [hits, setHits] = useState<Record<PlayerId, number>>({ p1: 0, p2: 0 })
  const [lastImpulse, setLastImpulse] = useState<Record<PlayerId, number | null>>({ p1: null, p2: null })
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
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ||
          event.target instanceof HTMLSelectElement ||
          (event.code === 'Enter' && event.target instanceof HTMLButtonElement)) return
      event.preventDefault()
      if (event.code === 'KeyF' || event.code === 'Enter') {
        if (!event.repeat) battle?.triggerTestAttack(event.code === 'KeyF' ? 'p1' : 'p2')
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

    void import('../game/physicsBattle')
      .then(async ({ mountPhysicsBattle }) => {
        if (cancelled || !canvasRef.current) return
        const mounted = await mountPhysicsBattle(canvasRef.current, (event) => {
          if (cancelled) return
          if (event.type === 'contact') {
            setContacts((count) => count + 1)
          } else if (event.type === 'hit') {
            setHits((counts) => ({ ...counts, [event.attacker]: counts[event.attacker] + 1 }))
            setLastImpulse((values) => ({ ...values, [event.attacker]: event.impulse }))
          } else {
            setOut((players) => players.includes(event.player) ? players : [...players, event.player])
          }
        }, abort.signal, options)
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
  }, [generation, options])

  const reset = () => {
    setReady(false)
    setContacts(0)
    setHits({ p1: 0, p2: 0 })
    setLastImpulse({ p1: null, p2: null })
    setOut([])
    setError('')
    setStatus('Havok を読み込んでいます…')
    setGeneration((value) => value + 1)
  }

  return (
    <section className="physics-dev" aria-label="対戦フィールドの検証">
      {onBack && <button type="button" onClick={onBack}>配置調整へ戻る</button>}
      <section className="physics-dev__scene" aria-label="3D物理の検証">
        <canvas ref={canvasRef} tabIndex={0} aria-label="2体のコマと半径6のアリーナ" />
      </section>

      <p className="physics-dev__status" role="status">{status}</p>
      {error && <p className="physics-dev__error" role="alert">{error}</p>}

      <div className="physics-dev__details">
        <section className="physics-dev__player physics-dev__player--p1">
          <h2>1P · 青</h2>
          <p>W / A / S / D で移動、F で体当たり</p>
          <p>検証値: 攻撃値 {TEST_ATTACK_VALUE.toFixed(1)} × 攻撃力倍率 {TEST_ATTACK_MULTIPLIERS.p1.toFixed(1)}</p>
          <p>命中: {hits.p1} 回、追加インパルス: {lastImpulse.p1?.toFixed(1) ?? '—'}</p>
          <p>場外: {out.includes('p1') ? 'あり' : 'なし'}</p>
        </section>
        <section className="physics-dev__player physics-dev__player--p2">
          <h2>2P · 赤</h2>
          <p>矢印キーで移動、Enter で体当たり</p>
          <p>検証値: 攻撃値 {TEST_ATTACK_VALUE.toFixed(1)} × 攻撃力倍率 {TEST_ATTACK_MULTIPLIERS.p2.toFixed(1)}</p>
          <p>命中: {hits.p2} 回、追加インパルス: {lastImpulse.p2?.toFixed(1) ?? '—'}</p>
          <p>場外: {out.includes('p2') ? 'あり' : 'なし'}</p>
        </section>
      </div>
      <div className="physics-dev__footer">
        <p>コマ同士の接触開始: <strong>{contacts}</strong> 回</p>
        <button type="button" disabled={!ready && !error} onClick={reset}>最初から試す</button>
      </div>
      <p className="physics-dev__note">F / Enter は物理検証用の体当たりです。前進と命中受付は0.1秒、復帰は0.2秒です。再攻撃は0.4秒以上経過し、復帰してから可能です。正式な A / B 攻撃や HP は扱いません。</p>
    </section>
  )
}
