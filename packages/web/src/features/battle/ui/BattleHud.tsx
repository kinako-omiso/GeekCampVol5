import type { CSSProperties } from 'react'
import type { FighterStats } from '@gikcamp/protocol'
import { Svg } from '../../../components/Svg'
import { players, type PlayerId } from '../../../../../../docs/design/tokens'
import sunTimerUrl from '../../../../../../docs/design/assets/sun-timer.svg'
import heartIcon from '../../../../../../docs/design/assets/icons/heart.svg?raw'
import powerIcon from '../../../../../../docs/design/assets/icons/power.svg?raw'
import reachIcon from '../../../../../../docs/design/assets/icons/reach.svg?raw'
import speedIcon from '../../../../../../docs/design/assets/icons/speed.svg?raw'
import './battleHud.css'

/** HUD に出す1人ぶんの値 */
export type HudFighter = {
  // いまの HP。最大 HP は stats.hp
  hp: number
  stats: FighterStats
  // 顔アイコンに出すコマの画像。無いときはプレイヤー名を出す
  portraitUrl?: string
}

type Props = {
  fighters: Record<PlayerId, HudFighter>
  // 残り時間（秒）。表示は切り上げた整数
  remainingSeconds: number
}

type StatKey = Exclude<keyof FighterStats, 'hp'>

// 能力値の並び（見本の登場演出と同じ3項目）。最大 HP は HP の数字の横に出すので、ここには入れない。
// 旋回速度（turnSpeed）は表示しない
const STATS: { key: StatKey; icon: string; label: string; format: (value: number) => string }[] = [
  { key: 'attack', icon: powerIcon, label: 'パワー', format: (value) => value.toFixed(2) },
  { key: 'reach', icon: reachIcon, label: 'リーチ', format: (value) => value.toFixed(2) },
  { key: 'moveSpeed', icon: speedIcon, label: 'スピード', format: (value) => value.toFixed(2) },
]

/**
 * PC：対戦画面の HUD。Babylon の canvas の上に重ねる（HostStage の中に置く）。
 * 左に 1P・右に 2P（HP バーと能力値）、真ん中におひさまタイマー。値は props で受け取って表示するだけ。
 * 見本：docs/design/screens/pc-06-battle.html（能力値のカードは MVP 用に追加したもの）
 */
export function BattleHud({ fighters, remainingSeconds }: Props) {
  const seconds = Math.max(0, Math.ceil(remainingSeconds))

  return (
    <div className="battle-hud ss-motion">
      {(['p1', 'p2'] as const).map((id) => (
        <PlayerHud key={id} player={id} fighter={fighters[id]} />
      ))}

      <div className="battle-hud__timer" role="timer" aria-label={`のこり ${seconds}びょう`}>
        <img className="battle-hud__sun" src={sunTimerUrl} alt="" />
        <span className="ss-display battle-hud__seconds" aria-hidden="true">
          {seconds}
        </span>
      </div>
    </div>
  )
}

type PlayerHudProps = {
  player: PlayerId
  fighter: HudFighter
}

/** 1人ぶんの HUD。顔・HP の数字とバー・能力値のカード */
function PlayerHud({ player, fighter }: PlayerHudProps) {
  const label = players[player].label
  const maxHp = fighter.stats.hp
  const hp = Math.min(maxHp, Math.max(0, Math.ceil(fighter.hp)))
  const ratio = maxHp > 0 ? hp / maxHp : 0

  return (
    <section className={`battle-hud__side battle-hud__side--${player}`} aria-label={label}>
      <div className="battle-hud__main">
        <div className="battle-hud__portrait">
          {fighter.portraitUrl ? (
            <img className="battle-hud__portrait-image" src={fighter.portraitUrl} alt="" />
          ) : (
            <span className="ss-display battle-hud__portrait-label">{label}</span>
          )}
        </div>

        <div className="battle-hud__life">
          <div className="battle-hud__life-head">
            <div className="ss-display ss-outline-s battle-hud__chip">{label}</div>
            <div className="battle-hud__hp" role="meter" aria-label="HP" aria-valuemin={0} aria-valuemax={maxHp} aria-valuenow={hp}>
              <Svg markup={heartIcon} className="battle-hud__heart" />
              <span className="ss-display battle-hud__hp-value">{hp}</span>
              <span className="ss-display battle-hud__hp-max">/{maxHp}</span>
            </div>
          </div>
          <div className="battle-hud__bar" style={{ '--hp-ratio': ratio } as CSSProperties}>
            {/* 減った分を少し遅れて縮めて、どれだけ削られたかを見せる */}
            <div className="battle-hud__bar-trail" />
            <div className="battle-hud__bar-fill" />
          </div>
        </div>
      </div>

      <dl className="battle-hud__stats">
        {STATS.map((stat) => (
          <div key={stat.key} className="battle-hud__stat">
            <dt>
              <Svg markup={stat.icon} className="battle-hud__stat-icon" />
              {stat.label}
            </dt>
            <dd className="ss-display">{stat.format(fighter.stats[stat.key])}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
