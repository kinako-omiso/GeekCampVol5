import type { Baseline } from './calibrate'
import { toLandscapeDelta, type ScreenAngle } from './landscape'
import type { RawOrientation } from './orientation'

// 有効範囲（仕様：±60度）。これ以上傾けても ±1 で止める
export const TILT_RANGE_DEG = 60
// デッドゾーン（仕様：±5度）。これより小さい傾きは 0 とみなす
export const DEADZONE_DEG = 5
// ローパスの係数（仕様：0.2程度）。小さいほど滑らかだが反応が遅れる
export const LOW_PASS_FACTOR = 0.2

// この値より小さい出力は 0 に丸める（ローパスの減衰がいつまでも 0 にならないため）
const SNAP_TO_ZERO = 0.001

// 移動ベクトル。x: 右が正、y: 奥が正。どちらも -1〜1
export type TiltVector = { x: number; y: number }

/**
 * 基準姿勢からの傾きを -1〜1 の移動ベクトルに変換する関数を作る。
 * ローパスの状態を持つので、基準を取り直したら作り直すこと。
 * 基準を取ったときと画面の向きが違う（持ち替えた・縦持ち）ときは null を返す。
 */
export function createTiltNormalizer(baseline: Baseline) {
  let x = 0
  let y = 0

  return (orientation: RawOrientation, angle: ScreenAngle): TiltVector | null => {
    if (angle !== baseline.angle) return null

    const delta = toLandscapeDelta(
      wrapDegrees(orientation.beta - baseline.beta),
      wrapDegrees(orientation.gamma - baseline.gamma),
      angle,
    )
    if (!delta) return null

    x = snap(x + LOW_PASS_FACTOR * (shape(delta.x) - x))
    y = snap(y + LOW_PASS_FACTOR * (shape(delta.y) - y))
    return { x, y }
  }
}

// ±60度にクランプし、デッドゾーンを除いた範囲を 0〜1 に割り当てる
function shape(degrees: number): number {
  const magnitude = Math.min(Math.abs(degrees), TILT_RANGE_DEG)
  if (magnitude <= DEADZONE_DEG) return 0
  return (Math.sign(degrees) * (magnitude - DEADZONE_DEG)) / (TILT_RANGE_DEG - DEADZONE_DEG)
}

// 差分を -180〜180度に収める（beta は ±180度で折り返すため）
function wrapDegrees(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180
}

function snap(value: number): number {
  return Math.abs(value) < SNAP_TO_ZERO ? 0 : value
}
