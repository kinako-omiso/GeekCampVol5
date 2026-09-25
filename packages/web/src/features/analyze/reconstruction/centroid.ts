import type { ReconstructionResult } from './types.ts'

export type ModelCenter = { x: number; y: number; z: number }

export function getVolumeCentroid({ positions, indices }: ReconstructionResult): ModelCenter | null {
  let sixTimesVolume = 0
  let weightedX = 0
  let weightedY = 0
  let weightedZ = 0

  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index] * 3
    const b = indices[index + 1] * 3
    const c = indices[index + 2] * 3
    const ax = positions[a]
    const ay = positions[a + 1]
    const az = positions[a + 2]
    const bx = positions[b]
    const by = positions[b + 1]
    const bz = positions[b + 2]
    const cx = positions[c]
    const cy = positions[c + 1]
    const cz = positions[c + 2]
    const volume = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
    sixTimesVolume += volume
    weightedX += (ax + bx + cx) * volume
    weightedY += (ay + by + cy) * volume
    weightedZ += (az + bz + cz) * volume
  }

  if (!Number.isFinite(sixTimesVolume) || Math.abs(sixTimesVolume) < 1e-12) return null
  return {
    x: weightedX / (4 * sixTimesVolume),
    y: weightedY / (4 * sixTimesVolume),
    z: weightedZ / (4 * sixTimesVolume),
  }
}
