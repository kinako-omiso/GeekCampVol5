import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { PhoneCloud, PhoneStage } from '../../components/PhoneStage'
import { Svg } from '../../components/Svg'
import { calibrate, requestMotionPermission, type Baseline } from '../../lib/sensor'
import { players, type PlayerId } from '../../../../../docs/design/tokens'
import checkIcon from '../../../../../docs/design/assets/icons/check.svg?raw'
import connectedIcon from '../../../../../docs/design/assets/icons/connected.svg?raw'
import monitorIcon from '../../../../../docs/design/assets/icons/monitor.svg?raw'
import phoneLandscapeIcon from '../../../../../docs/design/assets/icons/phone-landscape.svg?raw'
import tapIcon from '../../../../../docs/design/assets/icons/tap.svg?raw'
import './join.css'

type Props = {
  player: PlayerId
  onCalibrated: (baseline: Baseline) => void
}

type Phase = 'start' | 'calibrating' | 'done' | 'denied' | 'unsupported'

const RESTART_LABELS = {
  moved: 'うごいたので やりなおし',
  portrait: 'よこもちに してね',
  rotated: 'もちかえたので やりなおし',
} as const

/**
 * スマホ：接続画面。
 * 「タッチ!」でモーション権限を要求し、水準器の泡が真ん中に来るまで静止して基準姿勢を取る。
 */
export function JoinScreen({ player, onCalibrated }: Props) {
  const [phase, setPhase] = useState<Phase>('start')
  const [progress, setProgress] = useState(0)
  const [restartLabel, setRestartLabel] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  // 画面を離れたら基準姿勢の計測を止める
  useEffect(() => () => abortRef.current?.abort(), [])

  const startCalibration = () => {
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('calibrating')
    setProgress(0)
    setRestartLabel('')

    calibrate({
      signal: controller.signal,
      onProgress: (ratio) => {
        setProgress(ratio)
        // 半分まで静止できたら、やりなおしの案内を消す
        if (ratio >= 0.5) setRestartLabel('')
      },
      onRestart: (reason) => setRestartLabel(RESTART_LABELS[reason]),
    })
      .then((baseline) => {
        onCalibrated(baseline)
        setPhase('done')
      })
      .catch(() => {
        // 画面を離れて中断したときは何もしない
      })
  }

  // iOS では requestPermission をクリックの中で直接呼ぶ必要がある
  const handleTouch = async () => {
    const result = await requestMotionPermission()
    if (result === 'granted') startCalibration()
    else setPhase(result)
  }

  return (
    <PhoneStage player={player} className="join">
      <PhoneCloud className="join__cloud join__cloud--left" />
      <PhoneCloud className="join__cloud join__cloud--right" />
      <Svg markup={connectedIcon} className="join__signal" label="つながっている" />

      {phase === 'start' && (
        <div className="join__start">
          <div className="join__who">
            <div className="ss-display join__who-label">きみは</div>
            <div className="ss-display phone-ol join__who-player">{players[player].label}</div>
          </div>
          <div className="join__action">
            <button type="button" className="join__touch" aria-label="センサーを オンにする" onClick={handleTouch}>
              <Svg markup={tapIcon} className="join__touch-icon" />
              <span className="ss-display join__touch-label">タッチ!</span>
            </button>
            <div className="join__hint">
              <span className="join__hint-key">許可</span>
              <span>が でたら おしてね</span>
            </div>
          </div>
        </div>
      )}

      {phase === 'calibrating' && (
        <div className="join__calibrating" style={{ '--progress': progress } as CSSProperties}>
          <div className="join__calibrating-title">
            <Svg markup={phoneLandscapeIcon} className="join__calibrating-icon" />
            <div className="ss-display phone-ol">よこもちで じっと…</div>
          </div>
          <div className="join__level" role="img" aria-label="すいじゅんき。まんなかに きたら OK">
            <div className="join__level-mark join__level-mark--left" />
            <div className="join__level-mark join__level-mark--right" />
            <div className="join__bubble" />
          </div>
          <div className="join__bar">
            <div className="join__bar-fill" />
          </div>
          <div className="join__restart" aria-live="polite">
            {restartLabel}
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="join__done">
          <div className="join__done-badge">
            <Svg markup={checkIcon} className="join__done-check" />
          </div>
          <div className="join__done-text">
            <div className="ss-display phone-ol join__done-ok">OK!</div>
            <div className="join__done-sub">
              <Svg markup={monitorIcon} className="join__done-monitor" />
              <span>PCを みてね!</span>
            </div>
          </div>
        </div>
      )}

      {(phase === 'denied' || phase === 'unsupported') && (
        <div className="join__error" role="alert">
          <div className="ss-display phone-ol join__error-title">
            {phase === 'denied' ? 'きょかされなかったよ' : 'かたむきが とれないよ'}
          </div>
          <div className="join__error-sub">
            {phase === 'denied' ? 'タブを とじて ひらきなおしてね' : 'べつの スマホで ためしてね'}
          </div>
        </div>
      )}
    </PhoneStage>
  )
}
