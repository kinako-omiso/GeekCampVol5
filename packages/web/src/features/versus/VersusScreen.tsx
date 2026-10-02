import { useEffect, useRef, type CSSProperties } from 'react'
import type { FighterStats } from '@gikcamp/protocol'
import { HostStage } from '../../components/HostStage'
import { Scannee } from '../../components/Scannee'
import { fighterTypeFor } from '../../components/fighterType'
import { SCANNEE_VIEW, type ScanneeLook } from '../../components/scanneeLook'
import { Svg } from '../../components/Svg'
import { players, type PlayerId } from '../../../../../docs/design/tokens'
import burstUrl from '../../../../../docs/design/assets/burst.svg'
import cloudUrl from '../../../../../docs/design/assets/cloud.svg'
import isleUrl from '../../../../../docs/design/assets/isle.svg'
import angryLeftEyesUrl from '../../../../../docs/design/assets/eyes/angry-left.svg'
import angryRightEyesUrl from '../../../../../docs/design/assets/eyes/angry-right.svg'
import flagSvg from '../../../../../docs/design/assets/flag.svg?raw'
import './versus.css'

/** VS に出す1人ぶん */
export type VersusFighter = {
  look: ScanneeLook
  stats: FighterStats
}

type Props = {
  fighters: Record<PlayerId, VersusFighter>
  // GO! まで出し終わったら呼ぶ
  onDone: () => void
}

// 見本の流れ（島が入る → VS → 3・2・1・GO!）の長さ（秒）。versus.css の keyframes の % はこの長さに対する値。
// 3・2・1・GO! は 54%（約 3.8 秒）から1コマ timing.countdownStep（0.8 秒）ずつ出る。
// 1コマの長さを変えるときは、この秒数と versus.css の % をいっしょに直す
const VERSUS_SECONDS = 7

/**
 * コマの置き方。「絵の下端を島の上にそろえ、横は島の上の同じ所を中心にする」。
 * 数字は見本のコマ（1P マグカップ・2P 消しゴム）から逆算した値。2P の島は 1P より 50px 上にある
 */
const SPOTS: Record<PlayerId, { width: number; height: number; groundY: number; centerX: number }> = {
  p1: { width: 330, height: 300, groundY: 511, centerX: 288 },
  p2: { width: 350, height: 318, groundY: 461, centerX: 1005 },
}

// VS ではキリッとした目。1P は右（相手のほう）、2P は左を向く
const EYES: Record<PlayerId, string> = { p1: angryRightEyesUrl, p2: angryLeftEyesUrl }

function place(look: ScanneeLook, player: PlayerId): CSSProperties {
  const spot = SPOTS[player]
  const scaleX = spot.width / SCANNEE_VIEW.width
  const scaleY = spot.height / SCANNEE_VIEW.height
  const { bounds } = look
  return {
    left: spot.centerX - (bounds.x + bounds.width / 2) * scaleX,
    top: spot.groundY - (bounds.y + bounds.height) * scaleY,
    width: spot.width,
    height: spot.height,
  }
}

const SPARK_PATH = 'M20 1l4.5 14.5L39 20l-14.5 4.5L20 39l-4.5-14.5L1 20l14.5-4.5z'

// 流れていく雲（見本の位置・大きさ・速さ）
const CLOUDS: { top: number; width: number; duration: number; delay: number }[] = [
  { top: 60, width: 220, duration: 14, delay: -3 },
  { top: 200, width: 160, duration: 10, delay: -7 },
  { top: 560, width: 190, duration: 12, delay: -1 },
]

// VS のまわりのキラキラ（見本の位置・大きさ・色）
const TWINKLES: { left: number; top: number; size: number; color: string; delay: number }[] = [
  { left: 470, top: 190, size: 50, color: 'var(--ss-cloud)', delay: 0 },
  { left: 780, top: 470, size: 40, color: 'var(--ss-sun)', delay: 0.4 },
  { left: 760, top: 180, size: 34, color: 'var(--ss-sun)', delay: 0.7 },
]

/**
 * PC：VS → 3・2・1・GO!。両者の島が左右から入り、真ん中に VS。そのあと雲の中の 3・2・1、GO! で対戦を始める。
 * 見本：docs/design/screens/pc-05-vs-countdown.html（見本は 7 秒ループ。ここでは1回だけ再生して onDone を呼ぶ）
 * コマはいまは 2D の絵
 */
export function VersusScreen({ fighters, onDone }: Props) {
  // 親が毎回新しい関数を渡しても、タイマーを張り直さないようにする
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    const timer = window.setTimeout(() => onDoneRef.current(), VERSUS_SECONDS * 1000)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <HostStage className="versus ss-motion">
      <div
        className="versus__scene"
        style={{ '--versus-duration': `${VERSUS_SECONDS}s` } as CSSProperties}
        role="img"
        aria-label={`${players.p1.label} たい ${players.p2.label}`}
      >
        <div className="versus__rays" aria-hidden="true" />
        {CLOUDS.map((cloud) => (
          <img
            key={cloud.top}
            className="versus__cloud"
            src={cloudUrl}
            alt=""
            style={{
              top: cloud.top,
              width: cloud.width,
              height: cloud.width / 2,
              animationDuration: `${cloud.duration}s`,
              animationDelay: `${cloud.delay}s`,
            }}
          />
        ))}

        <div className="versus__shake">
          {(['p1', 'p2'] as const).map((player) => (
            <div key={player} className={`versus__side versus__side--${player}`}>
              <Svg markup={flagSvg} className="versus__flag" />
              <img className="versus__isle" src={isleUrl} alt="" />
              <div className="versus__hop">
                <Scannee look={fighters[player].look} eyesUrl={EYES[player]} style={place(fighters[player].look, player)} />
              </div>
              <div className="ss-display versus__label">{players[player].label}</div>
              <div className="ss-display versus__type">{fighterTypeFor(fighters[player].stats)}</div>
            </div>
          ))}

          <div className="versus__center">
            <img className="versus__burst" src={burstUrl} alt="" />
            <div className="ss-display versus__vs">VS</div>
          </div>
          {TWINKLES.map((twinkle) => (
            <svg
              key={`${twinkle.left}-${twinkle.top}`}
              className="versus__twinkle"
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

        <div className="versus__scrim" />
        <div className="versus__count">
          {[3, 2, 1].map((n) => (
            <div key={n} className={`versus__number versus__number--${n}`}>
              <img className="versus__number-cloud" src={cloudUrl} alt="" />
              <span className="ss-display versus__digit">{n}</span>
            </div>
          ))}
          <div className="versus__go">
            <img className="versus__go-burst" src={burstUrl} alt="" />
            <span className="ss-display versus__go-text">GO!</span>
          </div>
        </div>
        <div className="versus__flash" />
      </div>
    </HostStage>
  )
}
