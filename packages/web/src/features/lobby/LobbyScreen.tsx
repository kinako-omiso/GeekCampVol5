import { QRCodeSVG } from 'qrcode.react'
import { HostStage } from '../../components/HostStage'
import { Svg } from '../../components/Svg'
import { colors, players, type PlayerId } from '../../../../../docs/design/tokens'
import cloudUrl from '../../../../../docs/design/assets/cloud.svg'
import summitUrl from '../../../../../docs/design/assets/summit.svg'
import flagSvg from '../../../../../docs/design/assets/flag.svg?raw'
import checkIcon from '../../../../../docs/design/assets/icons/check.svg?raw'
import phoneIcon from '../../../../../docs/design/assets/icons/phone.svg?raw'
import readyFlagIcon from '../../../../../docs/design/assets/icons/ready-flag.svg?raw'
import tiltIcon from '../../../../../docs/design/assets/icons/tilt.svg?raw'
import './lobby.css'

/** ロビーで見せる1人ぶんの状況。スマホの接続 → センサー → 準備の順に進む */
export type LobbyPlayerStatus = {
  // スマホが QR から /controller を開いて PC とつながった
  connected: boolean
  // スマホの接続画面で「タッチ!」を押し、モーション権限が許可された（基準姿勢の計測が始まる）
  sensorReady: boolean
  // 基準姿勢が取れて、スマホに「OK! PCを みてね!」が出た
  ready: boolean
}

type Props = {
  // QR に入れる URL（スマホで開く /controller）
  joinUrls: Record<PlayerId, string>
  statuses: Record<PlayerId, LobbyPlayerStatus>
}

type ChipKey = keyof LobbyPlayerStatus

const CHIPS: { key: ChipKey; icon: string; label: string }[] = [
  { key: 'connected', icon: phoneIcon, label: 'スマホ' },
  { key: 'sensorReady', icon: tiltIcon, label: 'センサー' },
  { key: 'ready', icon: readyFlagIcon, label: 'じゅんび' },
]

// 流れていく雲（見本と同じ高さ・大きさ・速さ）
const DRIFT_CLOUDS = [
  { top: 60, width: 210, duration: 70, delay: -22 },
  { top: 200, width: 150, duration: 55, delay: -44 },
  { top: 330, width: 250, duration: 85, delay: -8 },
]

// キラキラの星の形（assets/sparkle.svg と同じ）
const SPARK_PATH = 'M20 1l4.5 14.5L39 20l-14.5 4.5L20 39l-4.5-14.5L1 20l14.5-4.5z'

/**
 * PC：ロビー画面。QR を2つ出して2人の接続を待つ。
 * つながった側は QR に OK! のスタンプ、待っている側は QR が脈打つ。真ん中はめざす「てっぺん」。
 * 見本：docs/design/screens/pc-01-lobby.html
 */
export function LobbyScreen({ joinUrls, statuses }: Props) {
  return (
    <HostStage className="lobby ss-motion">
      <div className="lobby__rays" aria-hidden="true" />
      <svg className="lobby__far" viewBox="0 0 1280 720" aria-hidden="true">
        <path
          className="lobby__far-1"
          d="M0 470L110 380L210 430L330 330L460 420L560 370L690 440L810 340L950 430L1070 360L1180 410L1280 380V720H0Z"
        />
        <path
          className="lobby__far-2"
          d="M0 520L150 450L290 500L410 440L560 510L720 450L870 510L1010 455L1150 500L1280 470V720H0Z"
        />
      </svg>
      {DRIFT_CLOUDS.map((cloud) => (
        <img
          key={cloud.top}
          className="lobby__drift"
          src={cloudUrl}
          alt=""
          style={{
            top: cloud.top,
            width: cloud.width,
            animationDuration: `${cloud.duration}s`,
            animationDelay: `${cloud.delay}s`,
          }}
        />
      ))}

      <img className="lobby__summit" src={summitUrl} alt="まんなかの やま。てっぺんに はたが たっている" />
      <Svg markup={flagSvg} className="lobby__flag" />
      <svg className="lobby__spark lobby__spark--gold" viewBox="0 0 40 40" aria-hidden="true">
        <path d={SPARK_PATH} />
      </svg>
      <svg className="lobby__spark lobby__spark--white" viewBox="0 0 40 40" aria-hidden="true">
        <path d={SPARK_PATH} />
      </svg>

      <svg className="lobby__sea" viewBox="0 0 1280 200" aria-hidden="true">
        <path
          className="lobby__sea-top"
          d="M-10 70Q30 18 80 44Q120 -2 180 30Q226 -10 280 26Q330 -8 386 28Q436 -4 490 30Q540 -6 596 26Q646 -8 700 28Q750 -4 806 30Q856 -8 910 26Q960 -4 1016 30Q1066 -8 1120 26Q1170 -2 1220 32Q1260 10 1292 42V210H-10Z"
        />
        <path
          className="lobby__sea-shade"
          d="M-10 130Q40 96 96 116Q150 84 210 110Q270 82 330 112Q390 86 450 114Q510 84 570 112Q630 86 690 114Q750 84 810 112Q870 86 930 114Q990 84 1050 112Q1110 86 1170 114Q1230 90 1292 110V210H-10Z"
        />
      </svg>

      <header className="lobby__title">
        <div className="lobby__logo">
          <div className="ss-display ss-outline-m lobby__logo-sub">Scannee's</div>
          <h1 className="ss-display ss-outline-l lobby__logo-main">Summit</h1>
        </div>
        <p className="ss-display lobby__catch">もってる モノで てっぺんへ!</p>
      </header>

      {(['p1', 'p2'] as const).map((id) => (
        <PlayerBoard key={id} player={id} joinUrl={joinUrls[id]} status={statuses[id]} />
      ))}
    </HostStage>
  )
}

type BoardProps = {
  player: PlayerId
  joinUrl: string
  status: LobbyPlayerStatus
}

/** 1人ぶんの看板。QR と3つのチップ（スマホ・センサー・じゅんび） */
function PlayerBoard({ player, joinUrl, status }: BoardProps) {
  const label = players[player].label
  // つながったあと、次に待っているチップだけ点滅させる
  const nextKey = status.connected ? CHIPS.find((chip) => !status[chip.key])?.key : undefined

  return (
    <section className={`lobby__board-wrap lobby__board-wrap--${player}`} data-player={player} aria-label={label}>
      <div className="lobby__post lobby__post--left" />
      <div className="lobby__post lobby__post--right" />
      <div className="lobby__board">
        <div className={status.connected ? 'lobby__qr' : 'lobby__qr is-waiting'}>
          <QRCodeSVG
            className={status.connected ? 'lobby__qr-code is-done' : 'lobby__qr-code'}
            value={joinUrl}
            size={130}
            level="M"
            bgColor={colors.cream}
            fgColor={colors.ink}
            title={`${label}の QRコード`}
          />
          {status.connected && <div className="ss-display lobby__stamp">OK!</div>}
        </div>
        <ul className="lobby__chips">
          {CHIPS.map((chip) => {
            const done = status[chip.key]
            const className = [
              'lobby__chip',
              done ? 'is-on' : 'is-off',
              chip.key === nextKey ? 'is-next' : '',
              `lobby__chip--${chip.key}`,
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <li key={chip.key} className={className} aria-label={`${chip.label} ${done ? 'OK' : 'まだ'}`}>
                <Svg markup={chip.icon} className="lobby__chip-icon" />
                {done && (
                  <span className="lobby__tick">
                    <Svg markup={checkIcon} className="lobby__tick-icon" />
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </div>
      <div className="ss-display ss-outline-s lobby__tag">{label}</div>
    </section>
  )
}
