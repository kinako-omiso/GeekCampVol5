import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { FighterStats } from '@gikcamp/protocol'
import { HostStage } from '../../components/HostStage'
import { Scannee } from '../../components/Scannee'
import { SCANNEE_VIEW, type ScanneeLook } from '../../components/scanneeLook'
import { Svg } from '../../components/Svg'
import { players, timing, type PlayerId } from '../../../../../docs/design/tokens'
import cloudUrl from '../../../../../docs/design/assets/cloud.svg'
import isleUrl from '../../../../../docs/design/assets/isle.svg'
import lookRightEyesUrl from '../../../../../docs/design/assets/eyes/look-right.svg'
import shutEyesUrl from '../../../../../docs/design/assets/eyes/shut.svg'
import powerIcon from '../../../../../docs/design/assets/icons/power.svg?raw'
import reachIcon from '../../../../../docs/design/assets/icons/reach.svg?raw'
import speedIcon from '../../../../../docs/design/assets/icons/speed.svg?raw'
import './entrance.css'

/** 登場させる1人ぶん */
export type EntranceFighter = {
  look: ScanneeLook
  stats: FighterStats
}

type Props = {
  fighters: Record<PlayerId, EntranceFighter>
  // 2人とも登場し終わったら呼ぶ
  onDone: () => void
}

// 1P → 2P の順に1人ずつ登場させる
const ORDER: PlayerId[] = ['p1', 'p2']

// 1人ぶんの長さ（秒）。見本の流れ（落下 → ドスン → パチッ → 帯 → 能力 → タイプ → 消える）をこの長さで1回流す
const ENTRANCE_SECONDS = timing.entrancePerPlayer

type StatKey = 'attack' | 'reach' | 'moveSpeed'

// 能力値の並び（見本と同じ3項目。対戦 HUD とも同じ）
const STATS: { key: StatKey; icon: string; label: string; type: string }[] = [
  { key: 'attack', icon: powerIcon, label: 'パワー', type: 'パワータイプ!' },
  { key: 'reach', icon: reachIcon, label: 'リーチ', type: 'リーチタイプ!' },
  { key: 'moveSpeed', icon: speedIcon, label: 'スピード', type: 'スピードタイプ!' },
]

// ★の数。倍率 0.80〜1.25 を5段階に分ける（docs/design/README.md「仕様書との差分」13 の案）
const STAR_RANGE = { min: 0.8, max: 1.25 }
const STAR_COUNT = 5

function starsFor(value: number) {
  if (!Number.isFinite(value)) return 1
  const ratio = (value - STAR_RANGE.min) / (STAR_RANGE.max - STAR_RANGE.min)
  return Math.min(STAR_COUNT, Math.max(1, Math.floor(ratio * STAR_COUNT) + 1))
}

// タイプ名は一番高い能力値から決める（同じ値なら STATS の並びで前のもの）
function typeFor(stats: FighterStats) {
  return STATS.reduce((best, stat) => (stats[stat.key] > stats[best.key] ? stat : best)).type
}

/**
 * コマの置き方。「絵の下端を島の上にそろえ、横は着地マークの真ん中にする」。
 * 数字は見本の 1P（マグカップ）から逆算した値
 */
const SPOT = { width: 570, height: 518, groundY: 540, centerX: 332 }

function place(look: ScanneeLook) {
  const scaleX = SPOT.width / SCANNEE_VIEW.width
  const scaleY = SPOT.height / SCANNEE_VIEW.height
  const { bounds, eyes } = look
  return {
    left: SPOT.centerX - (bounds.x + bounds.width / 2) * scaleX,
    top: SPOT.groundY - (bounds.y + bounds.height) * scaleY,
    width: SPOT.width,
    height: SPOT.height,
    // 目をパチッと開くときの中心（コマの箱の中の割合）
    '--entrance-eyes-origin': `${((eyes.x + eyes.width / 2) / SCANNEE_VIEW.width) * 100}% ${((eyes.y + eyes.height / 2) / SCANNEE_VIEW.height) * 100}%`,
  } as CSSProperties
}

const STAR_PATH = 'M15 2.5l3.6 7.6 8.3.9-6.2 5.6 1.8 8.2L15 20.6l-7.5 4.2 1.8-8.2-6.2-5.6 8.3-.9z'
const SPARK_PATH = 'M20 1l4.5 14.5L39 20l-14.5 4.5L20 39l-4.5-14.5L1 20l14.5-4.5z'
const SEA_PATH =
  'M-10 70Q30 18 80 44Q120 -2 180 30Q226 -10 280 26Q330 -8 386 28Q436 -4 490 30Q540 -6 596 26Q646 -8 700 28Q750 -4 806 30Q856 -8 910 26Q960 -4 1016 30Q1066 -8 1120 26Q1170 -2 1220 32Q1260 10 1292 42V210H-10Z'

// 着地で飛び散る星（見本の飛ぶ先・大きさ）。color が無いものはプレイヤーの薄い色
const DEBRIS: { dx: number; dy: number; size: number; color?: string }[] = [
  { dx: -260, dy: -190, size: 30, color: 'var(--ss-sun)' },
  { dx: -170, dy: -280, size: 26, color: 'var(--ss-cloud)' },
  { dx: -60, dy: -330, size: 30 },
  { dx: 90, dy: -310, size: 26, color: 'var(--ss-sun)' },
  { dx: 200, dy: -250, size: 30, color: 'var(--ss-cloud)' },
  { dx: 270, dy: -160, size: 26 },
]

// 着地のあとのキラキラ（見本の位置・大きさ）
const TWINKLES: { left: number; top: number; size: number; color: string; delay: number }[] = [
  { left: 60, top: 160, size: 46, color: 'var(--ss-sun)', delay: 0 },
  { left: 24, top: 420, size: 34, color: 'var(--ss-cloud)', delay: 0.4 },
  { left: 578, top: 200, size: 40, color: 'var(--ss-sun)', delay: 0.8 },
]

/**
 * PC：登場演出。1P → 2P の順に、コマが空から島に落ちてきて能力値とタイプを見せる。
 * 見本：docs/design/screens/pc-04-entrance.html（見本は 6 秒ループ。ここでは1人1回ずつ再生する）
 * コマはいまは 2D の絵。3D のコマ（空から落ちてきて着地する）は別 issue で差し替える
 */
export function EntranceScreen({ fighters, onDone }: Props) {
  const [index, setIndex] = useState(0)
  const player = ORDER[index]

  // 親が毎回新しい関数を渡しても、タイマーを張り直さないようにする
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (index < ORDER.length - 1) setIndex(index + 1)
      else onDoneRef.current()
    }, ENTRANCE_SECONDS * 1000)
    return () => window.clearTimeout(timer)
  }, [index])

  return (
    <HostStage
      className={`entrance entrance--${player} ss-motion`}
    >
      <div className="entrance__rays" aria-hidden="true" />
      <svg className="entrance__far" viewBox="0 0 1280 720" aria-hidden="true">
        <path d="M0 500L120 430L230 470L350 400L470 460L600 410L740 470L870 400L1000 450L1130 400L1280 440V720H0Z" />
      </svg>
      <img className="entrance__cloud entrance__cloud--high" src={cloudUrl} alt="" />
      <img className="entrance__cloud entrance__cloud--low" src={cloudUrl} alt="" />
      <svg className="entrance__sea" viewBox="0 0 1280 200" aria-hidden="true">
        <path d={SEA_PATH} />
      </svg>

      {/* プレイヤーが変わったら作り直して、演出を最初から流す */}
      <PlayerEntrance key={player} player={player} fighter={fighters[player]} />
    </HostStage>
  )
}

type PlayerEntranceProps = {
  player: PlayerId
  fighter: EntranceFighter
}

/** 1人ぶんの登場 */
function PlayerEntrance({ player, fighter }: PlayerEntranceProps) {
  const label = players[player].label
  const spot = place(fighter.look)

  return (
    <div className="entrance__scene" style={{ '--entrance-duration': `${ENTRANCE_SECONDS}s` } as CSSProperties}>
      <div className="entrance__rays2" aria-hidden="true" />
      <div className="entrance__shake">
        <div className="entrance__fade">
          <div className="entrance__band" aria-hidden="true">
            <div className="entrance__stripes" />
          </div>
          <div className="entrance__pillar" aria-hidden="true" />
          <div className="entrance__lines" aria-hidden="true" />
          <img className="entrance__isle" src={isleUrl} alt="" />
          <div className="entrance__target" aria-hidden="true" />
          <div className="entrance__ring entrance__ring--white" aria-hidden="true" />
          <div className="entrance__ring entrance__ring--player" aria-hidden="true" />
          <img className="entrance__puff entrance__puff--left" src={cloudUrl} alt="" />
          <img className="entrance__puff entrance__puff--right" src={cloudUrl} alt="" />

          <div className="entrance__drop">
            <div className="entrance__squash" style={{ transformOrigin: `${SPOT.centerX}px ${SPOT.groundY}px` }}>
              {/* 着地まではとじた目、着地のあとパチッと開く */}
              <Scannee
                look={fighter.look}
                eyesUrl={shutEyesUrl}
                label={`${label}の コマ`}
                style={spot}
                eyesClassName="entrance__eyes-shut"
              />
              <Scannee
                look={fighter.look}
                eyesUrl={lookRightEyesUrl}
                style={spot}
                bodyClassName="entrance__hidden"
                eyesClassName="entrance__eyes-open"
              />
            </div>
          </div>

          {DEBRIS.map((piece) => (
            <svg
              key={`${piece.dx}-${piece.dy}`}
              className="entrance__debris"
              viewBox="0 0 30 30"
              aria-hidden="true"
              style={
                {
                  width: piece.size,
                  height: piece.size,
                  fill: piece.color ?? 'var(--player-light)',
                  '--dx': `${piece.dx}px`,
                  '--dy': `${piece.dy}px`,
                } as CSSProperties
              }
            >
              <path d={STAR_PATH} />
            </svg>
          ))}
          <div className="entrance__after" aria-hidden="true">
            {TWINKLES.map((twinkle) => (
              <svg
                key={`${twinkle.left}-${twinkle.top}`}
                className="entrance__twinkle"
                viewBox="0 0 40 40"
                style={{
                  left: twinkle.left,
                  top: twinkle.top,
                  width: twinkle.size,
                  height: twinkle.size,
                  fill: twinkle.color,
                  animationDelay: `${twinkle.delay}s`,
                }}
              >
                <path d={SPARK_PATH} />
              </svg>
            ))}
          </div>
          <div className="ss-display entrance__dosun" aria-hidden="true">ドスン!</div>
          <div className="ss-display entrance__pachi" aria-hidden="true">パチッ!</div>

          <div className="entrance__banner">
            <svg className="entrance__banner-bg" viewBox="0 0 540 170" aria-hidden="true">
              <path d="M6 10H534L490 85L534 160H6Z" />
            </svg>
            <h1 className="entrance__title">
              <span className="ss-display ss-outline-l entrance__player">{label}</span>
              <span className="ss-display ss-outline-m entrance__enter">とうじょう!</span>
            </h1>
          </div>

          <ul className="entrance__stats">
            {STATS.map((stat, i) => {
              const stars = starsFor(fighter.stats[stat.key])
              return (
                <li
                  key={stat.key}
                  className="entrance__stat"
                  style={{ animationDelay: `${i * 0.25}s` }}
                  aria-label={`${stat.label} ほし ${stars}つ`}
                >
                  <div className="entrance__badge" aria-hidden="true">
                    <Svg markup={stat.icon} className="entrance__badge-icon" />
                  </div>
                  <svg className="entrance__stars" viewBox="0 0 150 30" aria-hidden="true">
                    {Array.from({ length: STAR_COUNT }, (_, n) => (
                      <path
                        key={n}
                        className={n < stars ? 'entrance__star entrance__star--on' : 'entrance__star'}
                        transform={`translate(${n * 30} 0)`}
                        d={STAR_PATH}
                      />
                    ))}
                  </svg>
                  <div className="entrance__stat-label" aria-hidden="true">
                    {stat.label}
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="entrance__ribbon-row">
            <p className="ss-display entrance__ribbon">
              {typeFor(fighter.stats)}
              <span className="entrance__shine" aria-hidden="true" />
            </p>
          </div>
        </div>
      </div>

      <div className="entrance__flash" aria-hidden="true" />
    </div>
  )
}
