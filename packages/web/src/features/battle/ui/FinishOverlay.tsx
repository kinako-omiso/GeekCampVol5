import { useEffect, useRef, type CSSProperties } from 'react'
import type { PlayerId } from '../../../../../../docs/design/tokens'
import cloudUrl from '../../../../../../docs/design/assets/cloud.svg'
import type { BattleOutcome, FinishReason } from '../game/judge'
import './finishOverlay.css'

/** ステージ（1280×720）上の点 */
export type StagePoint = { x: number; y: number }

type Props = {
  outcome: BattleOutcome
  // 最後の一撃が当たった所（ステージ座標）。衝撃の輪・星・暗転の明るい中心をここに置く。
  // 3D とつなぐまでは見本と同じ場所
  hitPoint?: StagePoint
  // 文字を見せ終わったら呼ぶ
  onDone: () => void
}

// 見本の流れ（暗転ストップ 約0.7秒 → フラッシュ → 文字がドン → 消える）の長さ（秒）。
// finishOverlay.css の keyframes の % はこの長さに対する値
const FINISH_SECONDS = 3.85

// 見本で最後の一撃が当たった所
const DEFAULT_HIT_POINT: StagePoint = { x: 660, y: 440 }

// 理由ごとの文字と大きさ（見本と同じ）
const LABELS: Record<FinishReason, { text: string; size: number }> = {
  ko: { text: 'KO!', size: 220 },
  ringOut: { text: 'おっこちた!', size: 124 },
  timeUp: { text: 'タイムアップ!', size: 112 },
}

// 星形の頂点（docs/design/assets/burst.svg と同じ）。文字のうしろでは横に引きのばすので、インラインで描く
const BURST_POINTS =
  '0,-100 14.2,-53.1 42,-72.7 38.9,-38.9 93.5,-54 53.1,-14.2 90,0 53.1,14.2 88.3,51 38.9,38.9 43,74.5 14.2,53.1 0,110 -14.2,53.1 -44,76.2 -38.9,38.9 -84.9,49 -53.1,14.2 -82,0 -53.1,-14.2 -91.8,-53 -38.9,-38.9 -46,-79.7 -14.2,-53.1'
const STAR_PATH = 'M15 2.5l3.6 7.6 8.3.9-6.2 5.6 1.8 8.2L15 20.6l-7.5 4.2 1.8-8.2-6.2-5.6 8.3-.9z'
const SPARK_PATH = 'M20 1l4.5 14.5L39 20l-14.5 4.5L20 39l-4.5-14.5L1 20l14.5-4.5z'

// 衝撃で飛び散る星（見本の飛ぶ先・大きさ・色）
const DEBRIS: { dx: number; dy: number; size: number; color: string }[] = [
  { dx: -240, dy: -200, size: 30, color: 'var(--ss-sun)' },
  { dx: -120, dy: -290, size: 26, color: 'var(--ss-cloud)' },
  { dx: 40, dy: -310, size: 30, color: 'var(--ss-sun)' },
  { dx: 180, dy: -260, size: 26, color: 'var(--ss-cloud)' },
  { dx: 290, dy: -140, size: 30, color: 'var(--ss-sun)' },
  { dx: -300, dy: -60, size: 26, color: 'var(--ss-cloud)' },
]

// 負けた側。引き分け（同時に負けた）なら両方
function losersOf({ winner }: BattleOutcome): PlayerId[] {
  if (winner === null) return ['p1', 'p2']
  return [winner === 'p1' ? 'p2' : 'p1']
}

/**
 * PC：決着の演出。対戦画面（Babylon の canvas と HUD）の上に重ね、決着の理由で表示を切り替える。
 * - KO：暗転ストップ → フラッシュ・ゆれ・衝撃の輪と星 → 「KO!」。負けた側の空に「キラーン!」
 * - 場外：同じ流れで「おっこちた!」。負けた側の下の雲に「ポフッ」
 * - 時間切れ：暗転・ゆれ・衝撃なしで止まって「タイムアップ!」
 * 見本：docs/design/screens/pc-08-finish.html（見本は 3.85 秒ループ。ここでは1回だけ再生して onDone を呼ぶ）。
 * コマが飛んでいく・落ちる動き、カメラの寄り、コマだけ明るくする暗転は 3D 側で付ける
 */
export function FinishOverlay({ outcome, hitPoint = DEFAULT_HIT_POINT, onDone }: Props) {
  const { reason } = outcome
  const label = LABELS[reason]
  // 時間切れは最後の一撃が無いので、暗転・ゆれ・衝撃を出さない
  const hasImpact = reason !== 'timeUp'
  const losers = losersOf(outcome)

  // 親が毎回新しい関数を渡しても、タイマーを張り直さないようにする
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    const timer = window.setTimeout(() => onDoneRef.current(), FINISH_SECONDS * 1000)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div
      className={`finish finish--${reason} ss-motion`}
      style={
        {
          '--finish-duration': `${FINISH_SECONDS}s`,
          '--hit-x': `${hitPoint.x}px`,
          '--hit-y': `${hitPoint.y}px`,
        } as CSSProperties
      }
    >
      <div className="finish__quake">
        {hasImpact && (
          <>
            <div className="finish__impact" aria-hidden="true">
              <div className="finish__impact-glow" />
              <div className="finish__impact-rays" />
            </div>
            <div className="finish__ring finish__ring--white" aria-hidden="true" />
            <div className="finish__ring finish__ring--sun" aria-hidden="true" />
            <svg className="finish__hit-star" viewBox="-120 -120 240 240" aria-hidden="true">
              <polygon className="finish__hit-star-outer" points={BURST_POINTS} />
              <polygon className="finish__hit-star-inner" points={BURST_POINTS} transform="scale(.58)" />
            </svg>
            {DEBRIS.map((piece) => (
              <svg
                key={`${piece.dx}-${piece.dy}`}
                className="finish__debris"
                viewBox="0 0 30 30"
                aria-hidden="true"
                style={
                  {
                    width: piece.size,
                    height: piece.size,
                    marginLeft: -piece.size / 2,
                    marginTop: -piece.size / 2,
                    fill: piece.color,
                    '--dx': `${piece.dx}px`,
                    '--dy': `${piece.dy}px`,
                  } as CSSProperties
                }
              >
                <path d={STAR_PATH} />
              </svg>
            ))}
          </>
        )}

        {reason === 'ko' &&
          losers.map((loser) => (
            <div key={loser} className={`finish__kiran finish__kiran--${loser}`} aria-hidden="true">
              <svg className="finish__kiran-star" viewBox="0 0 40 40">
                <path d={SPARK_PATH} />
              </svg>
              <div className="ss-display ss-outline-s finish__kiran-text">キラーン!</div>
            </div>
          ))}
        {reason === 'ringOut' &&
          losers.map((loser) => (
            <div key={loser} className={`finish__poff finish__poff--${loser}`} aria-hidden="true">
              <img className="finish__poff-cloud" src={cloudUrl} alt="" />
              <div className="ss-display finish__poff-text">ポフッ</div>
            </div>
          ))}

        <div className="finish__lines" aria-hidden="true">
          <div className="finish__lines-spin" />
        </div>

        <div className="finish__title">
          <div className="finish__burst finish__burst-glow" aria-hidden="true">
            <div className="finish__burst-rays" />
          </div>
          <svg
            className="finish__burst finish__burst-star"
            viewBox="-120 -120 240 240"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polygon className="finish__burst-outer" points={BURST_POINTS} />
            <polygon className="finish__burst-inner" points={BURST_POINTS} transform="scale(.6)" />
          </svg>
          <p className="ss-display finish__text" role="alert" style={{ fontSize: label.size }}>
            {label.text}
          </p>
        </div>
      </div>

      <div className="finish__bar finish__bar--top" aria-hidden="true" />
      <div className="finish__bar finish__bar--bottom" aria-hidden="true" />
      <div className="finish__flash" aria-hidden="true" />
    </div>
  )
}
