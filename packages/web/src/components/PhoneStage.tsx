import type { ReactNode } from 'react'
import type { PlayerId } from '../../../../docs/design/tokens'
import phoneLandscapeIcon from '../../../../docs/design/assets/icons/phone-landscape.svg?raw'
import { Svg } from './Svg'
import './phoneStage.css'

type Props = {
  player: PlayerId
  className?: string
  children: ReactNode
}

/**
 * スマホ（/controller）の画面の土台。横持ち固定で画面いっぱいに広げ、背景をプレイヤー色にする。
 * 中の寸法は 844×390 を基準にした単位 --u で書く（例：calc(var(--u) * 140)）。
 */
export function PhoneStage({ player, className, children }: Props) {
  return (
    <div className={className ? `phone-stage ${className}` : 'phone-stage'} data-player={player}>
      {children}
      <div className="phone-stage__rotate" role="alert">
        <Svg markup={phoneLandscapeIcon} className="phone-stage__rotate-icon" />
        <span>よこに してね</span>
      </div>
    </div>
  )
}

/** 背景にうすく浮かべる雲（飾り） */
export function PhoneCloud({ className }: { className: string }) {
  return (
    <svg className={`phone-cloud ${className}`} viewBox="0 0 160 80" aria-hidden="true">
      <path d="M24 74C8 74 3 54 17 47C13 29 35 20 48 30C54 11 85 7 95 26C107 16 129 22 129 41C147 41 156 62 141 74Z" />
    </svg>
  )
}
