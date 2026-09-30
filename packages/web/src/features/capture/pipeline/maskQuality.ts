import type { SilhouetteMask } from '../../analyze/reconstruction/types'

export type MaskQuality = { pixels: number; fraction: number; touchesEdge: boolean; needsReview: boolean; reason: string }

export function assessMask(mask: SilhouetteMask, seed: { x: number; y: number } = { x: 0.5, y: 0.5 }): MaskQuality {
  const { width, height, data } = mask
  let pixels = 0
  let touchesEdge = false
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!data[y * width + x]) continue
    pixels += 1
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true
  }
  const fraction = pixels / (width * height)
  const seedX = Math.min(width - 1, Math.max(0, Math.floor(seed.x * width)))
  const seedY = Math.min(height - 1, Math.max(0, Math.floor(seed.y * height)))
  const containsSeed = Boolean(data[seedY * width + seedX])
  const reason = !pixels ? '対象が見つかりません' : fraction < 0.005 ? '対象が小さすぎる可能性' :
    fraction > 0.8 ? '背景を含んでいる可能性' : touchesEdge ? '輪郭が画像端に接しています' :
      !containsSeed ? '指定点がMask外です' : ''
  return { pixels, fraction, touchesEdge, needsReview: Boolean(reason), reason }
}
