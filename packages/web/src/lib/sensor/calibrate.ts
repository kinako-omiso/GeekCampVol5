import { getScreenAngle, isLandscape, type ScreenAngle } from './landscape'
import { subscribeOrientation, type RawOrientation } from './orientation'

// 基準姿勢を取るまでに静止している時間（仕様：1秒）
export const CALIBRATION_DURATION_MS = 1000
// 静止とみなす揺れの幅（仕様：±2度以内）
export const STILLNESS_TOLERANCE_DEG = 2

export type Baseline = {
  beta: number
  gamma: number
  // 基準を取ったときの画面の向き。持ち替えたら取り直す
  angle: ScreenAngle
}

export type CalibrationOptions = {
  signal?: AbortSignal
  // 静止できている割合（0〜1）
  onProgress?: (ratio: number) => void
  // 動いた・縦持ちになったなどで、計測をやり直したとき
  onRestart?: (reason: 'moved' | 'portrait' | 'rotated') => void
}

/**
 * 横持ちで1秒間静止した姿勢を平均して、基準姿勢として返す。
 * 静止できるまで計測を続け、signal で中断すると reject する。
 */
export function calibrate(options: CalibrationOptions = {}): Promise<Baseline> {
  const { signal, onProgress, onRestart } = options

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    let samples: RawOrientation[] = []
    let angle = getScreenAngle()

    const restart = (reason: 'moved' | 'portrait' | 'rotated', sample: RawOrientation) => {
      samples = [sample]
      onProgress?.(0)
      onRestart?.(reason)
    }

    const unsubscribe = subscribeOrientation((sample) => {
      const currentAngle = getScreenAngle()
      if (!isLandscape(currentAngle)) {
        restart('portrait', sample)
        return
      }
      if (currentAngle !== angle) {
        angle = currentAngle
        restart('rotated', sample)
        return
      }

      samples.push(sample)
      if (!isStill(samples)) {
        restart('moved', sample)
        return
      }

      const elapsed = sample.timestamp - samples[0].timestamp
      onProgress?.(Math.min(elapsed / CALIBRATION_DURATION_MS, 1))
      if (elapsed < CALIBRATION_DURATION_MS) return

      cleanup()
      resolve({
        beta: average(samples.map((s) => s.beta)),
        gamma: average(samples.map((s) => s.gamma)),
        angle,
      })
    })

    const onAbort = () => {
      cleanup()
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort)

    function cleanup() {
      unsubscribe()
      signal?.removeEventListener('abort', onAbort)
    }
  })
}

// 全サンプルが平均から ±STILLNESS_TOLERANCE_DEG 以内に収まっているか
function isStill(samples: RawOrientation[]): boolean {
  const betas = samples.map((s) => s.beta)
  const gammas = samples.map((s) => s.gamma)
  return (
    Math.max(...betas) - Math.min(...betas) <= STILLNESS_TOLERANCE_DEG * 2 &&
    Math.max(...gammas) - Math.min(...gammas) <= STILLNESS_TOLERANCE_DEG * 2
  )
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}
