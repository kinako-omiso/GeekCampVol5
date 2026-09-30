import type { SilhouetteMask } from '../../analyze/reconstruction/types'

/** 描画と物理の検証で使う非対称の Quick Scan サンプル。 */
export function createSampleMask(): SilhouetteMask {
  const width = 96
  const height = 96
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((x >= 24 && x <= 43 && y >= 15 && y <= 77) ||
          (x >= 24 && x <= 73 && y >= 53 && y <= 77)) data[y * width + x] = 1
    }
  }
  return { width, height, data }
}
