import type { ReactNode } from 'react'
import { HostStage } from '../../components/HostStage'
import { Scannee } from '../../components/Scannee'
import { SCANNEE_VIEW, type ScanneeLook } from '../../components/scanneeLook'
import { Svg } from '../../components/Svg'
import { players, type PlayerId } from '../../../../../docs/design/tokens'
import eyesUrl from '../../../../../docs/design/assets/eyes/look-right.svg'
import waitingIcon from '../../../../../docs/design/assets/icons/waiting.svg?raw'
import './scanProgress.css'

/**
 * 1人ぶんの進み具合。山道の 撮る → 送る → 解析 → 完成 に対応する。
 * waiting は送り終わって、相手の解析が終わるのを待っている（解析は1人ずつ）。
 */
export type ScanStatus = 'capturing' | 'sending' | 'waiting' | 'analyzing' | 'done'

export type ScanPlayer = {
  status: ScanStatus
  // 送られてきたコマの見た目。届く前（撮影中・送信中）は無い
  look?: ScanneeLook
}

type Props = {
  players: Record<PlayerId, ScanPlayer>
}

type StepState = 'done' | 'current' | 'todo'

// 山道の4つの丸（見本の座標）
// アイコンの大きさ・線の太さも見本に合わせる
const STEPS: { cx: number; cy: number; label: string; size: number; stroke: number; icon: ReactNode }[] = [
  {
    cx: 44,
    cy: 118,
    label: 'とる',
    size: 28,
    stroke: 2.4,
    icon: (
      <>
        <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H8l1.5-2h5L16 6h2.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
        <circle cx="12" cy="13" r="3.5" />
      </>
    ),
  },
  {
    cx: 160,
    cy: 98,
    label: 'おくる',
    size: 28,
    stroke: 2.6,
    icon: (
      <>
        <path d="M12 18V5" />
        <path d="M6.5 10.5L12 5l5.5 5.5" />
        <path d="M5 21h14" />
      </>
    ),
  },
  {
    cx: 290,
    cy: 72,
    label: 'かいせき',
    size: 30,
    stroke: 2.4,
    icon: (
      <>
        <path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z" />
        <path d="M18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
      </>
    ),
  },
  {
    cx: 420,
    cy: 44,
    label: 'できた',
    size: 28,
    stroke: 2,
    icon: (
      <>
        <ellipse cx="8" cy="12" rx="4" ry="5.5" />
        <ellipse cx="16" cy="12" rx="4" ry="5.5" />
        <circle cx="9.5" cy="12.5" r="1.4" />
        <circle cx="17.5" cy="12.5" r="1.4" />
      </>
    ),
  },
]

// 状態ごとの山道の丸。waiting は解析の丸をまだ光らせない
const STEP_STATES: Record<ScanStatus, StepState[]> = {
  capturing: ['current', 'todo', 'todo', 'todo'],
  sending: ['done', 'current', 'todo', 'todo'],
  waiting: ['done', 'done', 'todo', 'todo'],
  analyzing: ['done', 'done', 'current', 'todo'],
  done: ['done', 'done', 'done', 'done'],
}

const STATUS_LABELS: Record<ScanStatus, string> = {
  capturing: 'いま とってる',
  sending: 'いま おくってる',
  waiting: 'じゅんばんまち',
  analyzing: 'いま かいせきちゅう',
  done: 'できあがり',
}

// キラキラの星の形（assets/sparkle.svg と同じ）
const SPARK_PATH = 'M20 1l4.5 14.5L39 20l-14.5 4.5L20 39l-4.5-14.5L1 20l14.5-4.5z'

/**
 * PC：スキャン進捗画面。Scannee が「うまれる」ところを2人ぶん並べる。
 * 解析中は形が下から埋まって最後に目がパチッと開く。順番待ちは砂時計と「つぎは 2P!」。
 * 下の山道が 撮る → 送る → 解析 → 完成 の進み具合。
 * 見本：docs/design/screens/pc-02-scan-progress.html
 */
export function ScanProgressScreen({ players: scanPlayers }: Props) {
  return (
    <HostStage className="scan ss-motion">
      <svg className="scan__far" viewBox="0 0 1280 720" aria-hidden="true">
        <path
          className="scan__far-1"
          d="M0 470L110 380L210 430L330 330L460 420L560 370L690 440L810 340L950 430L1070 360L1180 410L1280 380V720H0Z"
        />
        <path
          className="scan__far-2"
          d="M0 520L150 450L290 500L410 440L560 510L720 450L870 510L1010 455L1150 500L1280 470V720H0Z"
        />
      </svg>
      <svg className="scan__sea" viewBox="0 0 1280 200" aria-hidden="true">
        <path d="M-10 70Q30 18 80 44Q120 -2 180 30Q226 -10 280 26Q330 -8 386 28Q436 -4 490 30Q540 -6 596 26Q646 -8 700 28Q750 -4 806 30Q856 -8 910 26Q960 -4 1016 30Q1066 -8 1120 26Q1170 -2 1220 32Q1260 10 1292 42V210H-10Z" />
      </svg>

      <header className="scan__title">
        <svg className="scan__spark" viewBox="0 0 40 40" aria-hidden="true">
          <path d={SPARK_PATH} />
        </svg>
        <h1 className="ss-display scan__title-text">すきゃにーが うまれるよ!</h1>
        <svg className="scan__spark scan__spark--late" viewBox="0 0 40 40" aria-hidden="true">
          <path d={SPARK_PATH} />
        </svg>
      </header>

      {(['p1', 'p2'] as const).map((id) => (
        <PlayerPanel key={id} player={id} scan={scanPlayers[id]} />
      ))}
    </HostStage>
  )
}

type PanelProps = {
  player: PlayerId
  scan: ScanPlayer
}

/** 1人ぶんのパネル。まるい窓でコマがうまれ、下の山道で進み具合を見せる */
function PlayerPanel({ player, scan }: PanelProps) {
  const label = players[player].label
  const { status, look } = scan

  return (
    <section className={`scan__panel scan__panel--${player}`} aria-label={label}>
      <div className="ss-display ss-outline-s scan__tab">{label}</div>
      <div className="scan__birth">
        <BirthContent status={status} look={look} label={label} />
      </div>
      {status === 'analyzing' && look && <div className="ss-display scan__pon">パチッ!</div>}
      {status === 'waiting' && (
        <div className="scan__next">
          <div className="ss-display scan__next-pill">つぎは {label}!</div>
        </div>
      )}
      <ProgressTrail status={status} />
    </section>
  )
}

type BirthProps = {
  status: ScanStatus
  look?: ScanneeLook
  label: string
}

/** まるい窓の中身 */
function BirthContent({ status, look, label }: BirthProps) {
  const viewBox = `0 0 ${SCANNEE_VIEW.width} ${SCANNEE_VIEW.height}`

  // 解析中：点線の輪郭の中で、下から形が埋まって最後に目が開く
  if (status === 'analyzing' && look) {
    return (
      <div className="scan__figure">
        <svg className="scan__outline" viewBox={viewBox} aria-hidden="true">
          <path className="scan__ants" d={look.outline} />
        </svg>
        <Scannee
          look={look}
          eyesUrl={eyesUrl}
          label={`${label}の コマが できていく`}
          className="scan__scannee"
          bodyClassName="scan__reveal"
          eyesClassName="scan__eyes-pop"
        />
        <div className="scan__beam" />
      </div>
    )
  }

  // できあがり：目の開いたコマ
  if (status === 'done' && look) {
    return (
      <div className="scan__figure">
        <Scannee look={look} eyesUrl={eyesUrl} label={`${label}の コマ`} className="scan__scannee" />
      </div>
    )
  }

  // それ以外は砂時計。順番待ちで形が届いていれば、うすい点線の輪郭を後ろに出す
  return (
    <>
      {status === 'waiting' && look && (
        <svg className="scan__outline scan__outline--waiting" viewBox={viewBox} aria-hidden="true">
          <path d={look.outline} />
        </svg>
      )}
      <div className="scan__hourglass">
        <Svg markup={waitingIcon} className="scan__hourglass-icon" />
      </div>
    </>
  )
}

/** 下の山道。撮る → 送る → 解析 → 完成 */
function ProgressTrail({ status }: { status: ScanStatus }) {
  const states = STEP_STATES[status]
  const summary = STEPS.filter((_, index) => states[index] === 'done')
    .map((step) => step.label)
    .join('、')

  return (
    <svg
      className="scan__trail"
      viewBox="0 0 480 150"
      role="img"
      aria-label={`しんこう: ${summary ? `${summary}。` : ''}${STATUS_LABELS[status]}`}
    >
      <path className="scan__trail-ground" d="M0 150V124Q120 92 200 98Q300 62 380 42Q430 32 480 24V150Z" />
      <path className="scan__trail-ridge" d="M0 124Q120 92 200 98Q300 62 380 42Q430 32 480 24" />
      <path className="scan__trail-path" d="M44 118Q100 110 160 100T290 74T420 44" />
      {STEPS.map((step, index) => {
        const state = states[index]
        return (
          <g key={step.label} className={`scan__step is-${state}`}>
            {state === 'current' && <circle className="scan__step-ring" cx={step.cx} cy={step.cy} r="26" />}
            <circle className="scan__step-dot" cx={step.cx} cy={step.cy} r="26" />
            <svg
              className="scan__step-icon"
              x={step.cx - step.size / 2}
              y={step.cy - step.size / 2}
              width={step.size}
              height={step.size}
              viewBox="0 0 24 24"
              strokeWidth={step.stroke}
            >
              {step.icon}
            </svg>
          </g>
        )
      })}
      {/* 終わった丸の右上にチェック */}
      {STEPS.map(
        (step, index) =>
          states[index] === 'done' && (
            <g key={step.label} transform={`translate(${step.cx + 18} ${step.cy - 24})`} className="scan__check">
              <circle r="11" />
              <path d="M-4.08 0.29l2.63 2.63L4.08-2.63" />
            </g>
          ),
      )}
    </svg>
  )
}
