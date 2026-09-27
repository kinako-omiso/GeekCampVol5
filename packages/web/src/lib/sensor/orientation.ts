export type RawOrientation = {
  // alpha は徐々にずれるので計算には使わない（検証ページの表示用）
  alpha: number | null
  beta: number
  gamma: number
  // event.timeStamp（performance.now() と同じ基準のミリ秒）
  timestamp: number
}

/**
 * deviceorientation を購読する。戻り値の関数を呼ぶと購読を解除する。
 * beta / gamma が null のイベント（センサー無しの端末など）は捨てる。
 */
export function subscribeOrientation(listener: (orientation: RawOrientation) => void): () => void {
  const handler = (event: DeviceOrientationEvent) => {
    if (event.beta === null || event.gamma === null) return
    listener({
      alpha: event.alpha,
      beta: event.beta,
      gamma: event.gamma,
      timestamp: event.timeStamp,
    })
  }

  window.addEventListener('deviceorientation', handler)
  return () => window.removeEventListener('deviceorientation', handler)
}
