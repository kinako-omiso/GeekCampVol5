import type { ReconstructionCamera, SilhouetteMask, VisualHullOutput } from '@gikcamp/reconstruction-wasm'

export type ProjectionComparison = { width: number; height: number; pixels: Uint8Array; iou: number }

/** 正規化メッシュを撮影座標へ戻し、三角形の投影領域とMaskを比較する。 */
export function compareProjection(
  output: VisualHullOutput, camera: ReconstructionCamera, mask: SilhouetteMask, maxSide = 320,
): ProjectionComparison {
  const scale = Math.min(1, maxSide / Math.max(mask.width, mask.height))
  const width = Math.max(1, Math.round(mask.width * scale))
  const height = Math.max(1, Math.round(mask.height * scale))
  const pixels = new Uint8Array(width * height)
  const p = output.reconstruction.positions, indices = output.reconstruction.indices
  const [mx, minY, mz, span] = output.normalization
  const R = camera.rotation, t = camera.translation, K = camera.intrinsics
  const projected = new Float32Array(p.length)
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] * span + mx, y = p[i + 1] * span + minY, z = p[i + 2] * span + mz
    const cx = R[0] * x + R[1] * y + R[2] * z + t[0]
    const cy = R[3] * x + R[4] * y + R[5] * z + t[1]
    const cz = R[6] * x + R[7] * y + R[8] * z + t[2]
    projected[i] = cz > 1e-5 ? ((K[0] * cx + K[1] * cy) / cz + K[2]) * scale : NaN
    projected[i + 1] = cz > 1e-5 ? ((K[3] * cx + K[4] * cy) / cz + K[5]) * scale : NaN
    projected[i + 2] = cz
  }
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3
    if (projected[a + 2] <= 0 || projected[b + 2] <= 0 || projected[c + 2] <= 0) continue
    const ax = projected[a], ay = projected[a + 1]
    const bx = projected[b], by = projected[b + 1]
    const cx = projected[c], cy = projected[c + 1]
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)))
    const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)))
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)))
    const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)))
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (!Number.isFinite(area) || Math.abs(area) < 1e-6) continue
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5, py = y + 0.5
      const e1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
      const e2 = (cx - bx) * (py - by) - (cy - by) * (px - bx)
      const e3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx)
      if (area > 0 ? e1 >= -1e-4 && e2 >= -1e-4 && e3 >= -1e-4 :
        e1 <= 1e-4 && e2 <= 1e-4 && e3 <= 1e-4) pixels[y * width + x] = 1
    }
  }
  let intersection = 0, union = 0
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const selected = mask.data[Math.min(mask.height - 1, Math.floor((y + 0.5) / scale)) * mask.width +
      Math.min(mask.width - 1, Math.floor((x + 0.5) / scale))] !== 0
    const projectedPixel = pixels[y * width + x] !== 0
    if (selected && projectedPixel) intersection += 1
    if (selected || projectedPixel) union += 1
  }
  return { width, height, pixels, iou: union ? intersection / union : 0 }
}
