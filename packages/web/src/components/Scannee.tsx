import type { CSSProperties } from 'react'
import { SCANNEE_VIEW, type ScanneeBox, type ScanneeLook } from './scanneeLook'
import './scannee.css'

type Props = {
  look: ScanneeLook
  // assets/eyes/*.svg の URL
  eyesUrl: string
  label?: string
  className?: string
  style?: CSSProperties
  // 体・目だけに動きを付けるときのクラス
  bodyClassName?: string
  eyesClassName?: string
}

function percentBox(box: ScanneeBox): CSSProperties {
  return {
    left: `${(box.x / SCANNEE_VIEW.width) * 100}%`,
    top: `${(box.y / SCANNEE_VIEW.height) * 100}%`,
    width: `${(box.width / SCANNEE_VIEW.width) * 100}%`,
    height: `${(box.height / SCANNEE_VIEW.height) * 100}%`,
  }
}

function join(...names: (string | undefined)[]) {
  return names.filter(Boolean).join(' ')
}

/**
 * 目のついたコマ（Scannee）。体の絵の上に目を重ねる。
 * 大きさは親が決める（縦横比 220:200 の箱に入れる）。
 */
export function Scannee({ look, eyesUrl, label, className, style, bodyClassName, eyesClassName }: Props) {
  return (
    <div
      className={join('scannee', className)}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <div className={join('scannee__layer', bodyClassName)}>
        <img className="scannee__body" src={look.bodyUrl} alt="" />
      </div>
      <div className={join('scannee__layer', eyesClassName)}>
        <img className="scannee__eyes" src={eyesUrl} alt="" style={percentBox(look.eyes)} />
      </div>
    </div>
  )
}
