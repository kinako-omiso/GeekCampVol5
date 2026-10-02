import type { SilhouetteMask } from './reconstruction/types'
import type { ScanneeLook } from '../../components/scanneeLook'

/** 返送用Maskは寸法を保った二値PNGにする。 */
export function maskToBlob(mask: SilhouetteMask): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = mask.width; canvas.height = mask.height
  const context = canvas.getContext('2d')!
  const image = context.createImageData(mask.width, mask.height)
  for (let i = 0; i < mask.data.length; i += 1) {
    const color = mask.data[i] ? 255 : 0
    image.data.set([color, color, color, 255], i * 4)
  }
  context.putImageData(image, 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Mask画像を作れませんでした。')), 'image/png'))
}

/** 進捗・HUD・結果には、正面写真をMaskで切り抜いた実際の対象物を表示する。 */
export async function createScanLook(photo: Blob, mask: SilhouetteMask): Promise<ScanneeLook> {
  const bitmap = await createImageBitmap(photo)
  try {
    const cutout = document.createElement('canvas')
    cutout.width = mask.width; cutout.height = mask.height
    const context = cutout.getContext('2d')!
    context.drawImage(bitmap, 0, 0, mask.width, mask.height)
    const image = context.getImageData(0, 0, mask.width, mask.height)
    let minX = mask.width, minY = mask.height, maxX = 0, maxY = 0
    for (let i = 0; i < mask.data.length; i += 1) {
      if (!mask.data[i]) image.data[i * 4 + 3] = 0
      else { const x = i % mask.width, y = Math.floor(i / mask.width)
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
    }
    context.putImageData(image, 0, 0)
    const width = maxX - minX + 1, height = maxY - minY + 1
    if (width <= 0 || height <= 0) throw new Error('対象物が見つかりません。')
    const scale = Math.min(200 / width, 180 / height)
    const bounds = { x: (220 - width * scale) / 2, y: 200 - height * scale, width: width * scale, height: height * scale }
    const canvas = document.createElement('canvas'); canvas.width = 220; canvas.height = 200
    canvas.getContext('2d')!.drawImage(cutout, minX, minY, width, height, bounds.x, bounds.y, bounds.width, bounds.height)
    return { bodyUrl: canvas.toDataURL('image/png'), bounds,
      outline: `M${bounds.x} ${bounds.y}h${bounds.width}v${bounds.height}h${-bounds.width}Z`,
      eyes: { x: 75, y: bounds.y + bounds.height * 0.35, width: 70, height: 45 } }
  } finally { bitmap.close() }
}
