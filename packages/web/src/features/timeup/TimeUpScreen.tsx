import { useEffect, useRef, type CSSProperties } from 'react'
import { HostStage } from '../../components/HostStage'
import { Scannee } from '../../components/Scannee'
import { SCANNEE_VIEW, type ScanneeLook } from '../../components/scanneeLook'
import { Svg } from '../../components/Svg'
import { players, type PlayerId } from '../../../../../docs/design/tokens'
import crownUrl from '../../../../../docs/design/assets/crown.svg'
import mountainP1Url from '../../../../../docs/design/assets/mountain-p1.svg'
import mountainP2Url from '../../../../../docs/design/assets/mountain-p2.svg'
import sunTimerUrl from '../../../../../docs/design/assets/sun-timer.svg'
import happyEyesUrl from '../../../../../docs/design/assets/eyes/happy.svg'
import lookLeftEyesUrl from '../../../../../docs/design/assets/eyes/look-left.svg'
import lookRightEyesUrl from '../../../../../docs/design/assets/eyes/look-right.svg'
import sadEyesUrl from '../../../../../docs/design/assets/eyes/sad.svg'
import starEyesUrl from '../../../../../docs/design/assets/eyes/star.svg'
import heartIcon from '../../../../../docs/design/assets/icons/heart.svg?raw'
import phoneIcon from '../../../../../docs/design/assets/icons/phone.svg?raw'
import './timeUp.css'

/** 山くらべに出す1人ぶん */
export type TimeUpFighter = {
  look: ScanneeLook
  // 時間切れのときの HP
  hp: number
}

type Props = {
  fighters: Record<PlayerId, TimeUpFighter>
  // 勝った側。null なら引き分け（judgeBattle の結果をそのまま渡す）
  winner: PlayerId | null
  // 勝敗を見せ終わったら呼ぶ。引き分けはこの画面のままスマホで次を選ぶので、渡さなくてよい
  onDone?: () => void
}

// 見本の流れ（タイムアップ! → 山が生える → たかい ほうが かち! → かち!）の長さ（秒）。
// timeUp.css の keyframes の % はこの長さに対する値
const TIME_UP_SECONDS = 7

const IDS: PlayerId[] = ['p1', 'p2']

/**
 * 山の高さ。山の箱（520×560）の上端のステージ上の y で表す。小さいほど高い。
 * HP が多い側（引き分けなら両方）を見本の勝った山の高さにし、もう一方は HP の比で低くする。
 * 見本は HP 1 あたり約 8.5px の固定の比率だが、最大 HP（110〜128）でははみ出すので比にしている
 */
const MOUNTAIN_TOP = { highest: 233, lowest: 480 }
// HP が違うのに高さがほとんど同じにならないよう、少なくともこれだけ差をつける
const MIN_GAP = 30
// 山の箱の中での、てっぺんの平らな面の y と真ん中の x（mountain-p1/p2.svg）
const SUMMIT = { y: 44, centerX: 260 }
// 勝った山の高さの白い点線は、てっぺんより少し上（見本の値）
const LINE_ABOVE_SUMMIT = 3

function shownHp(hp: number) {
  return Math.max(0, Math.ceil(hp))
}

function mountainTops(hp: Record<PlayerId, number>): Record<PlayerId, number> {
  const high = Math.max(hp.p1, hp.p2)
  const range = MOUNTAIN_TOP.lowest - MOUNTAIN_TOP.highest
  const topOf = (value: number) => {
    if (value === high) return MOUNTAIN_TOP.highest
    const byRatio = MOUNTAIN_TOP.lowest - (high > 0 ? value / high : 0) * range
    return Math.min(MOUNTAIN_TOP.lowest, Math.max(byRatio, MOUNTAIN_TOP.highest + MIN_GAP))
  }
  return { p1: topOf(hp.p1), p2: topOf(hp.p2) }
}

// コマの置き方。絵の下端を山のてっぺんにそろえ、横はてっぺんの真ん中にする（見本のコマから逆算した大きさ）
const SCANNEE_SIZE = { width: 190, height: 173 }
const SCALE = { x: SCANNEE_SIZE.width / SCANNEE_VIEW.width, y: SCANNEE_SIZE.height / SCANNEE_VIEW.height }
// 王冠（130×100）のうち、コマの上端に重ねる分
const CROWN = { width: 130, height: 100, overlap: 35 }

function place(look: ScanneeLook) {
  const { bounds } = look
  return {
    left: SUMMIT.centerX - (bounds.x + bounds.width / 2) * SCALE.x,
    top: SUMMIT.y - (bounds.y + bounds.height) * SCALE.y,
    width: SCANNEE_SIZE.width,
    height: SCANNEE_SIZE.height,
    // 絵の上端（王冠をのせる高さ。山の箱の中の y）
    headY: SUMMIT.y - bounds.height * SCALE.y,
  }
}

const MOUNTAINS: Record<PlayerId, string> = { p1: mountainP1Url, p2: mountainP2Url }
// 結果が出る前の目（相手のほうを見る）
const IDLE_EYES: Record<PlayerId, string> = { p1: lookRightEyesUrl, p2: lookLeftEyesUrl }

// 結果が出たあとの目。勝ちはキラキラ、負けはしょんぼり、引き分けはにっこり
function resultEyes(player: PlayerId, winner: PlayerId | null) {
  if (winner === null) return happyEyesUrl
  return player === winner ? starEyesUrl : sadEyesUrl
}

const FAR_PATH = 'M0 470L110 380L210 430L330 330L460 420L560 370L690 440L810 340L950 430L1070 360L1180 410L1280 380V720H0Z'
const SEA_PATH =
  'M-10 70Q30 18 80 44Q120 -2 180 30Q226 -10 280 26Q330 -8 386 28Q436 -4 490 30Q540 -6 596 26Q646 -8 700 28Q750 -4 806 30Q856 -8 910 26Q960 -4 1016 30Q1066 -8 1120 26Q1170 -2 1220 32Q1260 10 1292 42V210H-10Z'
const SEA_SHADE_PATH =
  'M-10 130Q40 96 96 116Q150 84 210 110Q270 82 330 112Q390 86 450 114Q510 84 570 112Q630 86 690 114Q750 84 810 112Q870 86 930 114Q990 84 1050 112Q1110 86 1170 114Q1230 90 1292 110V210H-10Z'

/**
 * PC：時間切れの山くらべ。「タイムアップ!」のあと、残り HP の高さの山が雲から生えて、高い方が勝ち。
 * HP の数字と 1P/2P は山のてっぺんの横に出す。勝った山の高さに白い点線、勝った側に王冠と「かち!」。
 * 引き分けは同じ高さで「ひきわけ!」を出し、スマホで次を選ぶのを待つ。
 * 見本：docs/design/screens/pc-09-timeup.html（見本は 7 秒ループ。ここでは1回だけ再生し、最後の見た目のまま止める）
 */
export function TimeUpScreen({ fighters, winner, onDone }: Props) {
  const hp = { p1: shownHp(fighters.p1.hp), p2: shownHp(fighters.p2.hp) }
  const tops = mountainTops(hp)
  const lineTop = Math.min(tops.p1, tops.p2) + SUMMIT.y - LINE_ABOVE_SUMMIT

  // 親が毎回新しい関数を渡しても、タイマーを張り直さないようにする
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    const timer = window.setTimeout(() => onDoneRef.current?.(), TIME_UP_SECONDS * 1000)
    return () => window.clearTimeout(timer)
  }, [])

  const resultLabel =
    winner === null ? 'ひきわけ' : `${players[winner].label}の かち`

  return (
    <HostStage className="time-up ss-motion">
      <div
        className="time-up__scene"
        style={{ '--time-up-duration': `${TIME_UP_SECONDS}s` } as CSSProperties}
        role="img"
        aria-label={`タイムアップ。${players.p1.label} ${hp.p1}、${players.p2.label} ${hp.p2}。${resultLabel}`}
      >
        <svg className="time-up__far" viewBox="0 0 1280 720" aria-hidden="true">
          <path d={FAR_PATH} />
        </svg>
        <div className="time-up__reveal" aria-hidden="true">
          <div className="time-up__rays" />
        </div>
        <div className="time-up__reveal time-up__line" style={{ top: lineTop }} aria-hidden="true" />

        {IDS.map((player) => {
          const spot = place(fighters[player].look)
          const isWinner = player === winner
          return (
            <div
              key={player}
              className={`time-up__mountain time-up__mountain--${player}`}
              style={{ top: tops[player] }}
            >
              <img className="time-up__mountain-image" src={MOUNTAINS[player]} alt="" />
              <Scannee
                look={fighters[player].look}
                eyesUrl={IDLE_EYES[player]}
                style={spot}
                eyesClassName="time-up__eyes-before"
              />
              <Scannee
                look={fighters[player].look}
                eyesUrl={resultEyes(player, winner)}
                style={spot}
                bodyClassName="time-up__hidden"
                eyesClassName="time-up__eyes-after"
              />
              {isWinner && (
                <img
                  className="time-up__crown"
                  src={crownUrl}
                  alt=""
                  style={{
                    left: SUMMIT.centerX - CROWN.width / 2,
                    top: spot.headY - CROWN.height + CROWN.overlap,
                  }}
                />
              )}
              <div className="time-up__tag">
                <div className="ss-display ss-outline-s time-up__label">{players[player].label}</div>
                <div className="time-up__hp">
                  <Svg markup={heartIcon} className="time-up__heart" />
                  <span className="ss-display time-up__hp-value">{hp[player]}</span>
                </div>
              </div>
            </div>
          )
        })}

        <svg className="time-up__sea" viewBox="0 0 1280 200" aria-hidden="true">
          <path className="time-up__sea-cloud" d={SEA_PATH} />
          <path className="time-up__sea-shade" d={SEA_SHADE_PATH} />
        </svg>

        {winner !== null && (
          <div
            className={`ss-display time-up__stamp time-up__stamp--${winner}`}
            style={{ top: tops[winner] + 4 }}
            aria-hidden="true"
          >
            かち!
          </div>
        )}

        <div className="time-up__caption-row" aria-hidden="true">
          <div className="ss-display time-up__caption">たかい ほうが かち!</div>
        </div>

        {winner === null && (
          <>
            <div className="time-up__draw-row" aria-hidden="true">
              <div className="ss-display time-up__draw">ひきわけ!</div>
            </div>
            <div className="time-up__reveal time-up__next-row" aria-hidden="true">
              <div className="time-up__next">
                <Svg markup={phoneIcon} className="time-up__next-icon" />
                <span>スマホで つぎを えらんでね</span>
              </div>
            </div>
          </>
        )}

        <div className="time-up__title-row" aria-hidden="true">
          <div className="time-up__title">
            <div className="time-up__sun">
              <img className="time-up__sun-image" src={sunTimerUrl} alt="" />
              <span className="ss-display time-up__sun-seconds">0</span>
            </div>
            <div className="ss-display time-up__title-text">タイムアップ!</div>
          </div>
        </div>
        <div className="time-up__flash" aria-hidden="true" />
      </div>
    </HostStage>
  )
}
