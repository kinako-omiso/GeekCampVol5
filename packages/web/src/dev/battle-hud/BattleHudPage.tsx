import { useEffect, useRef, useState } from 'react'
import type { FighterStats } from '@gikcamp/protocol'
import { HostStage } from '../../components/HostStage'
import { BattleHud } from '../../features/battle/ui/BattleHud'
import { players, type PlayerId } from '../../../../../docs/design/tokens'
import mugUrl from '../../../../../docs/design/assets/sample-scannee-mug.svg'
import eraserUrl from '../../../../../docs/design/assets/sample-scannee-eraser.svg'
import '../../../../../docs/design/tokens.css'
import './battleHud.css'

// 制限時間（仕様書：60秒）
const MATCH_SECONDS = 60

// モック：能力値は docs/04-mvp.md の表示例に合わせたサンプル
const MOCK_STATS: Record<PlayerId, FighterStats> = {
  p1: { hp: 128, attack: 1.05, reach: 1.01, turnSpeed: 192, moveSpeed: 0.89 },
  p2: { hp: 110, attack: 1.2, reach: 0.89, turnSpeed: 228, moveSpeed: 1.02 },
}
const MOCK_PORTRAITS: Record<PlayerId, string> = { p1: mugUrl, p2: eraserUrl }

// モック：体当たり小・中の基本ダメージ（仕様書の値。攻撃力倍率はかけない）
const MOCK_DAMAGE = { a: 3, b: 18 } as const

function fullHp(): Record<PlayerId, number> {
  return { p1: MOCK_STATS.p1.hp, p2: MOCK_STATS.p2.hp }
}

/**
 * Issue #22 の検証ページ。#6 の物理シーンの canvas の上に対戦 HUD を重ねる。
 * HP と残り時間はモックのボタンで動かす（コマは動かさない）。
 */
export function BattleHudPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hp, setHp] = useState(fullHp)
  const [remaining, setRemaining] = useState(MATCH_SECONDS)
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [sceneError, setSceneError] = useState('')

  // 背景の 3D シーン。HUD が canvas の上に重なることを見るためだけに使う
  useEffect(() => {
    if (!canvasRef.current) return
    const abort = new AbortController()
    let dispose: (() => void) | undefined
    let cancelled = false

    void import('../../features/battle/game/physicsBattle')
      .then(async ({ mountPhysicsBattle }) => {
        if (cancelled || !canvasRef.current) return
        const battle = await mountPhysicsBattle(canvasRef.current, () => {}, abort.signal)
        if (cancelled) {
          battle.dispose()
          return
        }
        dispose = battle.dispose
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setSceneError(cause instanceof Error ? cause.message : '3D シーンを初期化できませんでした。')
      })

    return () => {
      cancelled = true
      abort.abort()
      dispose?.()
    }
  }, [])

  // モック：動いている間は終わる時刻（performance.now 基準）から残り時間を 0.1 秒ごとに出す
  useEffect(() => {
    if (endsAt === null) return
    const id = window.setInterval(() => {
      const next = Math.max(0, (endsAt - performance.now()) / 1000)
      setRemaining(next)
      if (next <= 0) setEndsAt(null)
    }, 100)
    return () => window.clearInterval(id)
  }, [endsAt])

  const toggleTimer = () => {
    if (endsAt === null) {
      setEndsAt(performance.now() + remaining * 1000)
      return
    }
    // 止めた瞬間の残り時間を取っておく（0.1 秒ごとの更新を待たない）
    setRemaining(Math.max(0, (endsAt - performance.now()) / 1000))
    setEndsAt(null)
  }

  const damage = (player: PlayerId, amount: number) =>
    setHp((prev) => ({ ...prev, [player]: Math.max(0, prev[player] - amount) }))

  const reset = () => {
    setEndsAt(null)
    setHp(fullHp())
    setRemaining(MATCH_SECONDS)
  }

  return (
    <>
      <HostStage>
        <canvas ref={canvasRef} className="battle-hud-dev__canvas" aria-label="アリーナと2体のコマ" />
        <BattleHud
          fighters={{
            p1: { hp: hp.p1, stats: MOCK_STATS.p1, portraitUrl: MOCK_PORTRAITS.p1 },
            p2: { hp: hp.p2, stats: MOCK_STATS.p2, portraitUrl: MOCK_PORTRAITS.p2 },
          }}
          remainingSeconds={remaining}
        />
      </HostStage>

      <div className="battle-hud-dev__mock">
        {(['p1', 'p2'] as const).map((id) => (
          <span key={id} className="battle-hud-dev__group">
            <button type="button" onClick={() => damage(id, MOCK_DAMAGE.a)}>
              {players[id].label} −{MOCK_DAMAGE.a}
            </button>
            <button type="button" onClick={() => damage(id, MOCK_DAMAGE.b)}>
              {players[id].label} −{MOCK_DAMAGE.b}
            </button>
          </span>
        ))}
        <button type="button" disabled={remaining <= 0} onClick={toggleTimer}>
          {endsAt === null ? 'タイマー開始' : 'タイマー停止'}
        </button>
        <button type="button" onClick={reset}>
          リセット
        </button>
        <a href="/host">トップへ戻る</a>
      </div>
      {sceneError && (
        <p className="battle-hud-dev__error" role="alert">
          {sceneError}
        </p>
      )}
    </>
  )
}
