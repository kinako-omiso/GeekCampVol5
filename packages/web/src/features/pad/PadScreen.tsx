import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { PhoneCloud, PhoneStage } from '../../components/PhoneStage'
import { Svg } from '../../components/Svg'
import { players, timing, type PlayerId } from '../../../../../docs/design/tokens'
import connectedIcon from '../../../../../docs/design/assets/icons/connected.svg?raw'
import dashBigIcon from '../../../../../docs/design/assets/icons/dash-big.svg?raw'
import dashSmallIcon from '../../../../../docs/design/assets/icons/dash-small.svg?raw'
import tiltIcon from '../../../../../docs/design/assets/icons/tilt.svg?raw'
import './pad.css'

type Props = {
  player: PlayerId
  connected?: boolean
  onAttack?: (button: ButtonId) => void
}

type ButtonId = 'a' | 'b'

// 見本の「ドカッ」の星（ふちなし）。B ボタンの後ろで回す
const BURST_POINTS =
  '0,-100 14.2,-53.1 42,-72.7 38.9,-38.9 93.5,-54 53.1,-14.2 90,0 53.1,14.2 88.3,51 38.9,38.9 43,74.5 14.2,53.1 0,110 -14.2,53.1 -44,76.2 -38.9,38.9 -84.9,49 -53.1,14.2 -82,0 -53.1,-14.2 -91.8,-53 -38.9,-38.9 -46,-79.7 -14.2,-53.1'

/**
 * スマホ：対戦画面（横持ちコントローラー）。
 * A は左の親指、B は右の親指。B は押したあと3秒使えない。
 * onAttack が渡された検証画面では、有効な押下を親へ通知する。
 */
export function PadScreen({ player, connected, onAttack }: Props) {
  const lastAPressRef = useRef(-Infinity)
  const [pressed, setPressed] = useState<Record<ButtonId, boolean>>({ a: false, b: false })
  // B が使えるようになる時刻（performance.now() 基準）。null ならいつでも使える
  const [cooldownEnd, setCooldownEnd] = useState<number | null>(null)
  const [remainingMs, setRemainingMs] = useState(0)
  // 使えるようになった回数。光る演出を毎回やり直すための key に使う
  const [readyCount, setReadyCount] = useState(0)

  // クールダウン中は毎フレーム残り時間を更新する
  useEffect(() => {
    if (cooldownEnd === null) return
    let frame = 0
    const tick = () => {
      const left = cooldownEnd - performance.now()
      if (left <= 0) {
        setCooldownEnd(null)
        setRemainingMs(0)
        setReadyCount((count) => count + 1)
        return
      }
      setRemainingMs(left)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [cooldownEnd])

  // クールダウンと連打間隔には同じ時計を使う
  const press = (id: ButtonId, timeStamp: number) => {
    if (connected === false || (id === 'b' && cooldownEnd !== null)) return
    if (id === 'a') {
      if (timeStamp - lastAPressRef.current < 400) return
      lastAPressRef.current = timeStamp
    }
    onAttack?.(id)
    setPressed((prev) => ({ ...prev, [id]: true }))
    if (id === 'b' && cooldownEnd === null) {
      setCooldownEnd(timeStamp + timing.bCooldown * 1000)
    }
  }
  const release = (id: ButtonId) => setPressed((prev) => ({ ...prev, [id]: false }))

  // 親指で同時に押せるように、click ではなく pointer イベントで扱う
  const handlers = (id: ButtonId) => ({
    onPointerDown: () => press(id, performance.now()),
    onPointerUp: () => release(id),
    onPointerCancel: () => release(id),
    onPointerLeave: () => release(id),
    onContextMenu: (event: MouseEvent) => event.preventDefault(),
  })

  const coolingDown = cooldownEnd !== null
  const cooldownRatio = remainingMs / (timing.bCooldown * 1000)

  return (
    <PhoneStage player={player} className="pad">
      <PhoneCloud className="pad__cloud" />

      <div className="pad__bar">
        <div className="ss-display pad__player">{players[player].label}</div>
        <Svg markup={tiltIcon} className="pad__tilt-icon" />
        <span className="pad__bar-text">かたむけて うごく</span>
        <Svg markup={connectedIcon} className={connected === false ? 'pad__signal is-disconnected' : 'pad__signal'} label={connected === false ? '未接続' : 'つながっている'} />
      </div>

      <div className="pad__buttons">
        <button
          type="button"
          className={pressed.a ? 'pad__button pad__button--a is-pressed' : 'pad__button pad__button--a'}
          aria-label="A たいあたり小"
          disabled={connected === false}
          {...handlers('a')}
        >
          <span className="ss-display pad__letter pad__letter--a">A</span>
          <span className="pad__sub">
            <Svg markup={dashSmallIcon} className="pad__sub-icon" />
            <span>ちょん!</span>
          </span>
        </button>

        <button
          type="button"
          className={pressed.b ? 'pad__button pad__button--b is-pressed' : 'pad__button pad__button--b'}
          aria-label={coolingDown ? `B たいあたり中。あと ${Math.ceil(remainingMs / 1000)} びょう` : 'B たいあたり中'}
          aria-disabled={coolingDown}
          disabled={connected === false}
          {...handlers('b')}
        >
          <svg className="pad__burst" viewBox="-120 -120 240 240" aria-hidden="true">
            <polygon points={BURST_POINTS} />
          </svg>
          <span className="ss-display pad__letter pad__letter--b">B</span>
          <span className="pad__sub">
            <Svg markup={dashBigIcon} className="pad__sub-icon pad__sub-icon--big" />
            <span>ドーン!</span>
          </span>

          {coolingDown && (
            <>
              <span className="pad__cooldown" style={{ '--cooldown': cooldownRatio } as CSSProperties} />
              <span className="ss-display pad__cooldown-count">{Math.ceil(remainingMs / 1000)}</span>
            </>
          )}
          {!coolingDown && readyCount > 0 && <span key={readyCount} className="pad__ready" />}
        </button>
      </div>
    </PhoneStage>
  )
}
