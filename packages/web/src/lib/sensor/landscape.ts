// 画面の回転角。90 は端末の上端が左、270 は端末の上端が右を向いた横持ち
export type ScreenAngle = 0 | 90 | 180 | 270

// 横持ちでの傾き（度）。x: 右に傾けると正、y: 奥に傾けると正
export type TiltDelta = { x: number; y: number }

/**
 * 現在の画面の回転角を返す。
 * screen.orientation が無い古い iOS では window.orientation（-90 / 0 / 90 / 180）で代用する。
 */
export function getScreenAngle(): ScreenAngle {
  const legacy = (window as { orientation?: number }).orientation
  const angle = screen.orientation?.angle ?? legacy ?? 0
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360
  return normalized as ScreenAngle
}

export function isLandscape(angle: ScreenAngle): boolean {
  return angle === 90 || angle === 270
}

/**
 * 画面の回転を購読する。戻り値の関数を呼ぶと購読を解除する。
 */
export function subscribeScreenAngle(listener: (angle: ScreenAngle) => void): () => void {
  const handler = () => listener(getScreenAngle())

  if (screen.orientation) {
    screen.orientation.addEventListener('change', handler)
    return () => screen.orientation.removeEventListener('change', handler)
  }
  window.addEventListener('orientationchange', handler)
  return () => window.removeEventListener('orientationchange', handler)
}

/**
 * 基準姿勢からの beta / gamma の差分を、横持ちの左右（x）と前後（y）に変換する。
 * 横持ちでは beta が左右、gamma が前後になり、左右どちらに倒したかで符号が反転する。
 * 縦持ちのときは null を返す。
 * 符号は理論上の値なので、iOS / Android の実機で必ず確認すること。
 */
export function toLandscapeDelta(deltaBeta: number, deltaGamma: number, angle: ScreenAngle): TiltDelta | null {
  if (angle === 90) return { x: deltaBeta, y: deltaGamma }
  if (angle === 270) return { x: -deltaBeta, y: -deltaGamma }
  return null
}
