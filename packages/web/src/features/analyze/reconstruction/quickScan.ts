import earcut, { deviation } from 'earcut'
import { extractNormalizedContour } from './contour.ts'
import { prepareMask } from './mask.ts'
import type { QuickScanOutput, ReconstructionResult, SilhouetteMask } from './types.ts'

const DEPTH = 0.25

export function reconstructQuickScanWithMetrics(mask: SilhouetteMask): QuickScanOutput {
  const contourStarted = performance.now()
  const contour = extractNormalizedContour(prepareMask(mask))
  const contourMs = performance.now() - contourStarted
  const meshStarted = performance.now()
  const count = contour.length
  const positions = new Float32Array(count * 6 * 3)
  const normals = new Float32Array(positions.length)
  const flat = new Float64Array(count * 2)

  for (let index = 0; index < count; index += 1) {
    const { x, y } = contour[index]
    flat[index * 2] = x
    flat[index * 2 + 1] = y
    for (let group = 0; group < 2; group += 1) {
      const offset = (group * count + index) * 3
      positions[offset] = x
      positions[offset + 1] = y
      positions[offset + 2] = group === 0 ? DEPTH / 2 : -DEPTH / 2
      normals[offset + 2] = group === 0 ? 1 : -1
    }
  }

  const cap = earcut(flat)
  if (cap.length < 3 || deviation(flat, null, 2, cap) > 0.001) {
    throw new Error('面を生成できませんでした。別の対象を選択してください。')
  }
  const indices: number[] = []
  for (let index = 0; index < cap.length; index += 3) {
    let a = cap[index]
    let b = cap[index + 1]
    let c = cap[index + 2]
    const cross = (contour[b].x - contour[a].x) * (contour[c].y - contour[a].y) - (contour[b].y - contour[a].y) * (contour[c].x - contour[a].x)
    if (cross < 0) [b, c] = [c, b]
    indices.push(a, b, c, count + c, count + b, count + a)
  }

  for (let index = 0; index < count; index += 1) {
    const current = contour[index]
    const next = contour[(index + 1) % count]
    const dx = next.x - current.x
    const dy = next.y - current.y
    const length = Math.hypot(dx, dy)
    if (length === 0) throw new Error('輪郭に重複した頂点があります。')
    const sideStart = 2 * count + 4 * index
    for (let corner = 0; corner < 4; corner += 1) {
      const point = corner < 2 ? current : next
      const offset = (sideStart + corner) * 3
      positions[offset] = point.x
      positions[offset + 1] = point.y
      positions[offset + 2] = corner % 2 === 0 ? DEPTH / 2 : -DEPTH / 2
      normals[offset] = dy / length
      normals[offset + 1] = -dx / length
    }
    indices.push(
      sideStart, sideStart + 1, sideStart + 2,
      sideStart + 2, sideStart + 1, sideStart + 3,
    )
  }

  const reconstruction: ReconstructionResult & { normals: Float32Array } = {
    positions,
    indices: Uint32Array.from(indices),
    normals,
  }
  return {
    reconstruction,
    metrics: {
      contourMs,
      meshMs: performance.now() - meshStarted,
      vertexCount: positions.length / 3,
      triangleCount: indices.length / 3,
    },
  }
}

export function reconstructQuickScan(mask: SilhouetteMask): ReconstructionResult {
  return reconstructQuickScanWithMetrics(mask).reconstruction
}
