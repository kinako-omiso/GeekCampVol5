import type { SilhouetteMask } from '../../analyze/reconstruction/types'
import { assessMask } from './maskQuality.ts'
import type { MaskQuality } from './maskQuality'

export type ImagePixels = { width: number; height: number; data: Uint8ClampedArray }
export type NormalizedPoint = { x: number; y: number }
export type CandidatePoint = NormalizedPoint & { score: number }
export type CandidateAssessment = { quality: MaskQuality; acceptable: boolean; rank: number }

type Descriptor = { light: number; saturation: number; edge: number }
type Bounds = { left: number; top: number; right: number; bottom: number }

function pixel(image: ImagePixels, x: number, y: number) {
  const index = (Math.max(0, Math.min(image.height - 1, y)) * image.width +
    Math.max(0, Math.min(image.width - 1, x))) * 4
  const r = image.data[index], g = image.data[index + 1], b = image.data[index + 2]
  const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b)
  return { light: (r * 0.299 + g * 0.587 + b * 0.114) / 255,
    saturation: maximum ? (maximum - minimum) / maximum : 0 }
}
function descriptorAt(image: ImagePixels, x: number, y: number, radius: number): Descriptor {
  let light = 0, saturation = 0, edge = 0, count = 0
  for (let py = Math.max(1, y - radius); py <= Math.min(image.height - 2, y + radius); py += 2) {
    for (let px = Math.max(1, x - radius); px <= Math.min(image.width - 2, x + radius); px += 2) {
      const value = pixel(image, px, py)
      light += value.light; saturation += value.saturation
      edge += Math.min(1, Math.abs(pixel(image, px + 1, py).light - pixel(image, px - 1, py).light) +
        Math.abs(pixel(image, px, py + 1).light - pixel(image, px, py - 1).light))
      count += 1
    }
  }
  return count ? { light: light / count, saturation: saturation / count, edge: edge / count } :
    { light: 0, saturation: 0, edge: 0 }
}
export function maskBounds(mask: SilhouetteMask): Bounds | null {
  let left = mask.width, top = mask.height, right = -1, bottom = -1
  for (let y = 0; y < mask.height; y += 1) for (let x = 0; x < mask.width; x += 1) {
    if (!mask.data[y * mask.width + x]) continue
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
  }
  return right < 0 ? null : { left: left / mask.width, top: top / mask.height,
    right: (right + 1) / mask.width, bottom: (bottom + 1) / mask.height }
}
function referenceDescriptor(image: ImagePixels, mask: SilhouetteMask): Descriptor {
  let light = 0, saturation = 0, edge = 0, count = 0
  const step = Math.max(1, Math.floor(Math.max(image.width, image.height) / 128))
  for (let y = 1; y < image.height - 1; y += step) for (let x = 1; x < image.width - 1; x += step) {
    const mx = Math.min(mask.width - 1, Math.floor(x / image.width * mask.width))
    const my = Math.min(mask.height - 1, Math.floor(y / image.height * mask.height))
    if (!mask.data[my * mask.width + mx]) continue
    const value = descriptorAt(image, x, y, 1)
    light += value.light; saturation += value.saturation; edge += value.edge; count += 1
  }
  return count ? { light: light / count, saturation: saturation / count, edge: edge / count } :
    { light: 0, saturation: 0, edge: 0 }
}

/** 正面Maskの見た目と位置を使い、他方向で試す最大3点を選ぶ。 */
export function findCandidatePoints(reference: ImagePixels, mask: SilhouetteMask,
  target: ImagePixels, selected: NormalizedPoint): CandidatePoint[] {
  const bounds = maskBounds(mask)
  if (!bounds) return [{ ...selected, score: 0 }]
  const width = Math.max(0.05, bounds.right - bounds.left)
  const height = Math.max(0.05, bounds.bottom - bounds.top)
  const centerX = (bounds.left + bounds.right) / 2, centerY = (bounds.top + bounds.bottom) / 2
  const left = Math.max(0.02, centerX - width * 2), right = Math.min(0.98, centerX + width * 2)
  const top = Math.max(0.02, centerY - height * 2), bottom = Math.min(0.98, centerY + height * 2)
  const descriptor = referenceDescriptor(reference, mask)
  const candidates: CandidatePoint[] = []
  const columns = 17, rows = 17
  const radius = Math.max(2, Math.round(Math.min(target.width, target.height) * Math.min(width, height) * 0.1))
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const x = left + (right - left) * column / (columns - 1)
    const y = top + (bottom - top) * row / (rows - 1)
    const actual = descriptorAt(target, Math.round(x * (target.width - 1)), Math.round(y * (target.height - 1)), radius)
    const appearance = 1 - Math.min(1, Math.abs(actual.light - descriptor.light) * 1.25 +
      Math.abs(actual.saturation - descriptor.saturation) * 0.65 + Math.abs(actual.edge - descriptor.edge) * 0.25)
    const distance = Math.min(1, Math.hypot((x - centerX) / width, (y - centerY) / height))
    candidates.push({ x, y, score: appearance * 0.8 + (1 - distance) * 0.2 })
  }
  candidates.sort((a, b) => b.score - a.score)
  const selectedPoints: CandidatePoint[] = []
  const separation = Math.max(0.06, Math.min(width, height) * 0.3)
  for (const candidate of candidates) {
    if (selectedPoints.some((point) => Math.hypot(point.x - candidate.x, point.y - candidate.y) < separation)) continue
    selectedPoints.push(candidate)
    if (selectedPoints.length === 2) break
  }
  if (!selectedPoints.some((point) => Math.hypot(point.x - selected.x, point.y - selected.y) < 0.03)) {
    selectedPoints.push({ ...selected, score: 0 })
  }
  return selectedPoints.slice(0, 3)
}

export function assessCandidate(mask: SilhouetteMask, seed: NormalizedPoint,
  referenceMask: SilhouetteMask): CandidateAssessment {
  const base = assessMask(mask, seed)
  const reference = assessMask(referenceMask)
  const ratio = reference.fraction ? base.fraction / reference.fraction : 0
  const sizeProblem = ratio < 0.25 || ratio > 4
  const reason = base.reason || (sizeProblem ? '正面Maskとの面積差が大きい可能性' : '')
  const quality = { ...base, needsReview: Boolean(reason), reason }
  const acceptable = !quality.needsReview
  const rank = (base.pixels ? 1 : 0) + (base.touchesEdge ? 0 : 2) +
    (sizeProblem ? 0 : 2) + (base.reason ? 0 : 2) - Math.abs(Math.log2(Math.max(0.001, ratio))) * 0.1
  return { quality, acceptable, rank }
}
