import { useEffect, useState, type ReactNode } from 'react'
import { stage } from '../../../../docs/design/tokens'
import './hostStage.css'

type Props = {
  className?: string
  children: ReactNode
}

const { width: STAGE_WIDTH, height: STAGE_HEIGHT } = stage.pc

// 画面に収まる倍率（縦横比は固定）
function fitScale() {
  return Math.min(window.innerWidth / STAGE_WIDTH, window.innerHeight / STAGE_HEIGHT)
}

/**
 * PC（/host）の画面の土台。1280×720 のステージを画面に合わせて拡大縮小する。
 * 中は見本（docs/design/screens/pc-*.html）と同じ 1280×720 の座標で書いてよい。余った所は空の色。
 */
export function HostStage({ className, children }: Props) {
  const [scale, setScale] = useState(fitScale)

  useEffect(() => {
    const onResize = () => setScale(fitScale())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div className="host-stage">
      <div
        className={className ? `host-stage__inner ${className}` : 'host-stage__inner'}
        style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  )
}
