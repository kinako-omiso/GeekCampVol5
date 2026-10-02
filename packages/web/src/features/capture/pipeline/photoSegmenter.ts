import { FilesetResolver, InteractiveSegmenter } from '@mediapipe/tasks-vision'
import type { BrushMode } from '@mediapipe/tasks-vision'
import type { SilhouetteMask } from '../../analyze/reconstruction/types'

import type { SelectionStroke } from '@gikcamp/protocol'
export type { SelectionStroke } from '@gikcamp/protocol'

export type PhotoPreparationTimings = {
  modelLoadMs: number
  resizeMs: number
  setImageMs: number
  inputWidth: number
  inputHeight: number
}

export type SegmentationTimings = {
  segmentMs: number
  conversionMs: number
}

let segmenterPromise: Promise<InteractiveSegmenter> | null = null

export async function loadPhoto(file: File): Promise<HTMLCanvasElement> {
  if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選択してください。')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('写真を読み込めませんでした。別の画像を選択してください。')
  }
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('写真を処理するCanvasを作成できませんでした。')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    bitmap.close()
  }
}

export async function loadPhotoSegmenter(): Promise<InteractiveSegmenter> {
  if (!segmenterPromise) {
    const base = import.meta.env.BASE_URL
    segmenterPromise = FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`)
      .then((fileset) => InteractiveSegmenter.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: `${base}mediapipe/models/interactive_segmentation.task`,
          delegate: 'CPU',
        },
      }))
      .catch((error: unknown) => {
        segmenterPromise = null
        throw error
      })
  }
  return segmenterPromise
}

export async function setPhotoForSegmentation(canvas: HTMLCanvasElement, maxSide = 1024): Promise<PhotoPreparationTimings> {
  const modelStart = performance.now()
  const segmenter = await loadPhotoSegmenter()
  const modelLoadMs = performance.now() - modelStart

  const resizeStart = performance.now()
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height))
  let input = canvas
  if (scale < 1) {
    input = document.createElement('canvas')
    input.width = Math.max(1, Math.round(canvas.width * scale))
    input.height = Math.max(1, Math.round(canvas.height * scale))
    const context = input.getContext('2d', { alpha: false })
    if (!context) throw new Error('領域分割用のCanvasを作成できませんでした。')
    context.drawImage(canvas, 0, 0, input.width, input.height)
  }
  const resizeMs = performance.now() - resizeStart

  const setImageStart = performance.now()
  segmenter.setImage(input)
  return {
    modelLoadMs,
    resizeMs,
    setImageMs: performance.now() - setImageStart,
    inputWidth: input.width,
    inputHeight: input.height,
  }
}

export async function segmentPhoto(
  strokes: ReadonlyArray<SelectionStroke>,
  onTiming?: (timings: SegmentationTimings) => void,
): Promise<SilhouetteMask> {
  if (strokes.length === 0) throw new Error('写真上の対象物を指定してください。')
  const segmenter = await loadPhotoSegmenter()
  const segmentStart = performance.now()
  const mask = segmenter.segment(strokes.map((stroke) => ({
    brushMode: (stroke.mode === 'add' ? 1 : 2) as BrushMode,
    point: stroke.points,
    isCompleted: true,
  })))
  const segmentMs = performance.now() - segmentStart
  try {
    const conversionStart = performance.now()
    const values = mask.getAsFloat32Array()
    const data = new Uint8Array(values.length)
    for (let index = 0; index < values.length; index += 1) {
      data[index] = values[index] >= 0.5 ? 1 : 0
    }
    onTiming?.({ segmentMs, conversionMs: performance.now() - conversionStart })
    return { width: mask.width, height: mask.height, data }
  } finally {
    mask.close()
  }
}
