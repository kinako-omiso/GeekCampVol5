import { HostStage } from '../../components/HostStage'
import { Scannee } from '../../components/Scannee'
import { SCANNEE_VIEW, type ScanneeLook } from '../../components/scanneeLook'
import { Svg } from '../../components/Svg'
import { players, type PlayerId } from '../../../../../docs/design/tokens'
import clapUrl from '../../../../../docs/design/assets/clap.svg'
import crownUrl from '../../../../../docs/design/assets/crown.svg'
import isleUrl from '../../../../../docs/design/assets/isle.svg'
import mountainP1Url from '../../../../../docs/design/assets/mountain-p1.svg'
import mountainP2Url from '../../../../../docs/design/assets/mountain-p2.svg'
import starEyesUrl from '../../../../../docs/design/assets/eyes/star.svg'
import happyEyesUrl from '../../../../../docs/design/assets/eyes/happy.svg'
import flagTallSvg from '../../../../../docs/design/assets/flag-tall.svg?raw'
import againIcon from '../../../../../docs/design/assets/icons/again.svg?raw'
import cameraIcon from '../../../../../docs/design/assets/icons/camera.svg?raw'
import checkIcon from '../../../../../docs/design/assets/icons/check.svg?raw'
import phoneIcon from '../../../../../docs/design/assets/icons/phone.svg?raw'
import './result.css'

import type { RematchChoice } from '@gikcamp/protocol'
export type { RematchChoice } from '@gikcamp/protocol'

type Props = {
  winner: PlayerId | 'draw'
  looks: Record<PlayerId, ScanneeLook>
  // 各プレイヤーがスマホで選んだもの。まだ選んでいなければ null
  choices: Record<PlayerId, RematchChoice | null>
}

// 選んだものの見せ方（スマホのボタンと同じアイコン）
const CHOICES: Record<RematchChoice, { icon: string; label: string }> = {
  again: { icon: againIcon, label: 'このまま!' },
  rescan: { icon: cameraIcon, label: 'あたらしく!' },
}

const MOUNTAINS: Record<PlayerId, string> = { p1: mountainP1Url, p2: mountainP2Url }

/**
 * コマの置き方。見本はコマごとに位置を合わせてあるので、ここでは
 * 「絵の下端を地面にそろえ、横は同じ所を中心にする」で同じ見え方にする。
 * 数字は見本の 1P（マグカップ）から逆算した値
 */
const WINNER = { width: 250, height: 227, groundY: 324, centerX: 404 }
const LOSER = { width: 150, height: 136, groundY: 556, centerX: 169 }
// 王冠の高さ 115px のうち、コマの上端に重ねる分
const CROWN = { height: 115, overlap: 33 }

function place(look: ScanneeLook, spot: typeof WINNER) {
  const scaleX = spot.width / SCANNEE_VIEW.width
  const scaleY = spot.height / SCANNEE_VIEW.height
  const { bounds } = look
  return {
    left: spot.centerX - (bounds.x + bounds.width / 2) * scaleX,
    top: spot.groundY - (bounds.y + bounds.height) * scaleY,
    width: spot.width,
    height: spot.height,
    // 絵の上端（王冠をのせる高さ）
    headY: spot.groundY - bounds.height * scaleY,
  }
}

// 花火（見本の位置・大きさ・色）。color が無いものは勝った側の薄い色
const FIREWORKS: { left: number; top: number; size: number; color?: string; delay: number }[] = [
  { left: 60, top: 20, size: 160, color: 'var(--ss-sun)', delay: 0 },
  { left: 326, top: 36, size: 110, delay: 0.9 },
  { left: 592, top: 196, size: 120, color: 'var(--result-pink)', delay: 0.6 },
  { left: 30, top: 190, size: 130, color: 'var(--ss-cloud)', delay: 1.1 },
  { left: 1100, top: 14, size: 140, color: 'var(--ss-sun)', delay: 0.3 },
]

// 紙ふぶき（見本と同じ並び）
const CONFETTI: { left: number; width: number; height: number; round?: boolean; color: string; duration: number; delay: number }[] = [
  { left: 4, width: 14, height: 26, color: 'var(--ss-sun)', duration: 4.2, delay: -0.4 },
  { left: 10, width: 12, height: 22, color: 'var(--ss-cloud)', duration: 3.6, delay: -2.1 },
  { left: 16, width: 16, height: 16, round: true, color: 'var(--result-pink)', duration: 4.8, delay: -1.2 },
  { left: 23, width: 12, height: 28, color: 'var(--ss-grass)', duration: 3.9, delay: -3.3 },
  { left: 30, width: 14, height: 24, color: 'var(--ss-sun)', duration: 5.1, delay: -0.9 },
  { left: 37, width: 12, height: 22, color: 'var(--ss-p1-light)', duration: 4.4, delay: -2.7 },
  { left: 44, width: 18, height: 18, round: true, color: 'var(--ss-cloud)', duration: 3.7, delay: -1.6 },
  { left: 51, width: 12, height: 26, color: 'var(--ss-sun)', duration: 4.6, delay: -3.9 },
  { left: 58, width: 14, height: 22, color: 'var(--result-pink)', duration: 3.4, delay: -0.2 },
  { left: 65, width: 12, height: 28, color: 'var(--ss-cloud)', duration: 5.3, delay: -2.4 },
  { left: 72, width: 16, height: 16, round: true, color: 'var(--ss-sun)', duration: 4.1, delay: -1.1 },
  { left: 79, width: 12, height: 24, color: 'var(--ss-grass)', duration: 3.8, delay: -3.1 },
  { left: 86, width: 14, height: 26, color: 'var(--ss-p1-light)', duration: 4.9, delay: -0.6 },
  { left: 93, width: 12, height: 22, color: 'var(--ss-sun)', duration: 3.5, delay: -2.9 },
  { left: 7, width: 12, height: 20, color: 'var(--ss-p1-light)', duration: 5.4, delay: -4.4 },
  { left: 27, width: 14, height: 26, color: 'var(--ss-cloud)', duration: 4, delay: -4.8 },
  { left: 48, width: 12, height: 22, color: 'var(--ss-grass)', duration: 4.8, delay: -4.1 },
  { left: 68, width: 14, height: 24, color: 'var(--result-pink)', duration: 3.7, delay: -4.6 },
  { left: 89, width: 16, height: 16, round: true, color: 'var(--ss-cloud)', duration: 4.4, delay: -4.9 },
]

// 星の紙ふぶき。color が無いものは勝った側の薄い色
const CONFETTI_STARS: { left: number; color?: string; duration: number; delay: number }[] = [
  { left: 12, color: 'var(--ss-sun)', duration: 4.6, delay: -1.3 },
  { left: 33, color: 'var(--ss-cloud)', duration: 3.9, delay: -3.6 },
  { left: 41, duration: 5, delay: -2.2 },
  { left: 55, color: 'var(--ss-sun)', duration: 4.2, delay: -4.2 },
  { left: 62, color: 'var(--ss-cloud)', duration: 4.8, delay: -0.7 },
  { left: 76, duration: 3.6, delay: -2.9 },
  { left: 83, color: 'var(--ss-sun)', duration: 5.2, delay: -3.3 },
  { left: 97, color: 'var(--ss-cloud)', duration: 4.3, delay: -1.8 },
]

// キラキラ（見本の位置・大きさ）
const TWINKLES: { left: number; top: number; size: number; color: string; delay: number }[] = [
  { left: 286, top: 150, size: 50, color: 'var(--ss-sun)', delay: 0 },
  { left: 650, top: 300, size: 38, color: 'var(--ss-cloud)', delay: 0.5 },
  { left: 326, top: 300, size: 32, color: 'var(--ss-cloud)', delay: 0.9 },
]

// 「1P」のうしろで回る星形
const BADGE_POINTS =
  '0,-100 14.2,-53.1 42,-72.7 38.9,-38.9 93.5,-54 53.1,-14.2 90,0 53.1,14.2 88.3,51 38.9,38.9 43,74.5 14.2,53.1 0,110 -14.2,53.1 -44,76.2 -38.9,38.9 -84.9,49 -53.1,14.2 -82,0 -53.1,-14.2 -91.8,-53 -38.9,-38.9 -46,-79.7 -14.2,-53.1'

const SPARK_PATH = 'M20 1l4.5 14.5L39 20l-14.5 4.5L20 39l-4.5-14.5L1 20l14.5-4.5z'
const STAR_PATH = 'M15 2.5l3.6 7.6 8.3.9-6.2 5.6 1.8 8.2L15 20.6l-7.5 4.2 1.8-8.2-6.2-5.6 8.3-.9z'

// 花火の粒（外側12個・内側4個）
const FIREWORK_OUTER = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * Math.PI * 2
  return { cx: Math.sin(angle) * 50, cy: -Math.cos(angle) * 50 }
})
const FIREWORK_INNER = [
  { cx: 0, cy: -28 },
  { cx: 28, cy: 0 },
  { cx: 0, cy: 28 },
  { cx: -28, cy: 0 },
]

/**
 * PC：結果画面。勝った Scannee が山のてっぺんで王冠・キラキラ目、うしろに長い旗。
 * 負けた側は左下の小島で拍手。右下に「つぎは どうする?」と各プレイヤーの選択状況（選ぶのはスマホ）。
 * 見本：docs/design/screens/pc-10-win.html
 */
export function ResultScreen({ winner, looks, choices }: Props) {
  if (winner === 'draw') return (
    <HostStage className="result result--p1 ss-motion">
      <h1 className="ss-display" style={{ textAlign: 'center', marginTop: 100, fontSize: 80 }}>ひきわけ!</h1>
      {(['p1', 'p2'] as const).map((player, index) => <Scannee key={player} look={looks[player]} eyesUrl={happyEyesUrl}
        label={`${players[player].label}の コマ`} style={{ position: 'absolute', left: 270 + index * 440, top: 270, width: 250, height: 227 }} />)}
    </HostStage>
  )
  const loser: PlayerId = winner === 'p1' ? 'p2' : 'p1'
  const winnerLabel = players[winner].label
  const winnerSpot = place(looks[winner], WINNER)
  const loserSpot = place(looks[loser], LOSER)
  const crownTop = winnerSpot.headY - CROWN.height + CROWN.overlap

  return (
    <HostStage className={`result result--${winner} ss-motion`}>
      <div className="result__rays" aria-hidden="true" />
      <div className="result__glow" aria-hidden="true" />
      <div className="result__beam result__beam--left" aria-hidden="true" />
      <div className="result__beam result__beam--right" aria-hidden="true" />
      {FIREWORKS.map((firework) => (
        <svg
          key={`${firework.left}-${firework.top}`}
          className="result__firework"
          viewBox="-60 -60 120 120"
          aria-hidden="true"
          style={{
            left: firework.left,
            top: firework.top,
            width: firework.size,
            height: firework.size,
            fill: firework.color ?? 'var(--player-light)',
            animationDelay: `${firework.delay}s`,
          }}
        >
          <g>
            {FIREWORK_OUTER.map((dot) => (
              <circle key={`${dot.cx}-${dot.cy}`} cx={dot.cx} cy={dot.cy} r="6" />
            ))}
          </g>
          <g opacity=".8">
            {FIREWORK_INNER.map((dot) => (
              <circle key={`${dot.cx}-${dot.cy}`} cx={dot.cx} cy={dot.cy} r="4" />
            ))}
          </g>
        </svg>
      ))}

      <div className="result__confetti" aria-hidden="true">
        {CONFETTI.map((piece) => (
          <div
            key={`${piece.left}-${piece.delay}`}
            className="result__confetti-piece"
            style={{
              left: `${piece.left}%`,
              width: piece.width,
              height: piece.height,
              borderRadius: piece.round ? '50%' : undefined,
              background: piece.color,
              animationDuration: `${piece.duration}s`,
              animationDelay: `${piece.delay}s`,
            }}
          />
        ))}
        {CONFETTI_STARS.map((star) => (
          <svg
            key={`${star.left}-${star.delay}`}
            className="result__confetti-piece result__confetti-star"
            viewBox="0 0 30 30"
            style={{
              left: `${star.left}%`,
              fill: star.color ?? 'var(--player-light)',
              animationDuration: `${star.duration}s`,
              animationDelay: `${star.delay}s`,
            }}
          >
            <path d={STAR_PATH} />
          </svg>
        ))}
      </div>

      {/* 勝った側：下からせり上がる山と旗、てっぺんのコマ */}
      <div className="result__rise">
        <img className="result__mountain" src={MOUNTAINS[winner]} alt="" />
        <div className="result__flag-in">
          <Svg markup={flagTallSvg} className="result__flag" />
        </div>
        <svg className="result__kira" viewBox="0 0 40 40" aria-hidden="true">
          <path d={SPARK_PATH} />
        </svg>
        <div className="result__bob">
          <Scannee
            look={looks[winner]}
            eyesUrl={starEyesUrl}
            label={`かった ${winnerLabel}の コマ`}
            style={{ left: winnerSpot.left, top: winnerSpot.top, width: winnerSpot.width, height: winnerSpot.height }}
          />
          <img className="result__crown" src={crownUrl} alt="おうかん" style={{ top: crownTop }} />
        </div>
      </div>
      {TWINKLES.map((twinkle) => (
        <svg
          key={`${twinkle.left}-${twinkle.top}`}
          className="result__twinkle"
          viewBox="0 0 40 40"
          aria-hidden="true"
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

      {/* 負けた側：小島で拍手 */}
      <img className="result__isle" src={isleUrl} alt="" />
      <Scannee
        look={looks[loser]}
        eyesUrl={happyEyesUrl}
        label={`${players[loser].label}の コマ。はくしゅしている`}
        style={{ left: loserSpot.left, top: loserSpot.top, width: loserSpot.width, height: loserSpot.height }}
      />
      <img className="result__clap" src={clapUrl} alt="はくしゅ" />

      <svg className="result__sea" viewBox="0 0 1280 200" aria-hidden="true">
        <path d="M-10 70Q30 18 80 44Q120 -2 180 30Q226 -10 280 26Q330 -8 386 28Q436 -4 490 30Q540 -6 596 26Q646 -8 700 28Q750 -4 806 30Q856 -8 910 26Q960 -4 1016 30Q1066 -8 1120 26Q1170 -2 1220 32Q1260 10 1292 42V210H-10Z" />
      </svg>

      <div className="result__badge" aria-hidden="true">
        <svg className="result__badge-star" viewBox="-120 -120 240 240">
          <polygon className="result__badge-outer" points={BADGE_POINTS} />
          <polygon className="result__badge-inner" transform="scale(.6)" points={BADGE_POINTS} />
        </svg>
      </div>
      <h1 className="result__title">
        <span className="ss-display result__winner">{winnerLabel}</span>
        <span className="ss-display result__wins">の かち!</span>
      </h1>

      <NextCard choices={choices} />

      <div className="result__flash" aria-hidden="true" />
    </HostStage>
  )
}

/** 右下の「つぎは どうする?」。「の かち!」とカードの右端をそろえてある */
function NextCard({ choices }: { choices: Record<PlayerId, RematchChoice | null> }) {
  return (
    <section className="result__next" aria-labelledby="result-next-title">
      <h2 id="result-next-title" className="ss-display result__next-title">
        つぎは どうする?
      </h2>
      {/* 選ぶたびに読み上げる */}
      <ul className="result__next-list" aria-live="polite">
        {(['p1', 'p2'] as const).map((player) => {
          const choice = choices[player]
          return (
            <li
              key={player}
              className={`result__choice result__choice--${player}${choice ? ' result__choice--decided' : ''}`}
            >
              <span className="ss-display ss-outline-s result__choice-player">{players[player].label}</span>
              {choice ? (
                <>
                  <Svg markup={CHOICES[choice].icon} className="result__choice-icon" />
                  <span className="result__choice-label">{CHOICES[choice].label}</span>
                  <Svg markup={checkIcon} className="result__choice-check" label="きまった" />
                </>
              ) : (
                <>
                  <span className="result__choice-label result__choice-label--waiting">えらんでる</span>
                  <span className="result__choice-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                </>
              )}
            </li>
          )
        })}
      </ul>
      <p className="result__next-hint">
        <Svg markup={phoneIcon} className="result__next-hint-icon" />
        スマホで えらんでね
      </p>
    </section>
  )
}
