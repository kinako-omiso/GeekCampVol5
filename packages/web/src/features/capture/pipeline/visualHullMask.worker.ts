import { FilesetResolver, InteractiveSegmenter } from '@mediapipe/tasks-vision'
import type { BrushMode } from '@mediapipe/tasks-vision'
import { assessMask } from './maskQuality'
import { assessCandidate, findCandidatePoints } from './visualHullCandidateSearch'
import type { ImagePixels } from './visualHullCandidateSearch'
import type { MaskTimings, MaskWorkerRequest, MaskWorkerResponse } from './visualHullMaskWorkerTypes'
import type { SelectionStroke } from './photoSegmenter'

const scope = self as unknown as Worker
const images = new Map<number, ImageBitmap>()
let activeFrame: number | null = null
let cpuPromise: Promise<InteractiveSegmenter> | null = null
let queue: Promise<void> = Promise.resolve()

function createSegmenter(delegate: 'CPU' | 'GPU') {
  const base = import.meta.env.BASE_URL
  return FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`)
    .then((fileset) => InteractiveSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${base}mediapipe/models/interactive_segmentation.task`, delegate },
    }))
}
function loadCpu() {
  cpuPromise ??= createSegmenter('CPU').catch((cause: unknown) => { cpuPromise = null; throw cause })
  return cpuPromise
}
function inputFor(bitmap: ImageBitmap) {
  const start = performance.now()
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('領域分割用のCanvasを作成できませんでした。')
  context.drawImage(bitmap, 0, 0, width, height)
  return { canvas, resizeMs: performance.now() - start }
}
function pixelsFor(bitmap: ImageBitmap): ImagePixels {
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('候補探索用のCanvasを作成できませんでした。')
  context.drawImage(bitmap, 0, 0, width, height)
  return context.getImageData(0, 0, width, height)
}
function brushes(strokes: SelectionStroke[]) {
  return strokes.map((stroke) => ({
    brushMode: (stroke.mode === 'add' ? 1 : 2) as BrushMode,
    point: stroke.points,
    isCompleted: true,
  }))
}
function toMask(result: ReturnType<InteractiveSegmenter['segment']>) {
  try {
    const values = result.getAsFloat32Array()
    const data = new Uint8Array(values.length)
    for (let i = 0; i < values.length; i += 1) data[i] = values[i] >= 0.5 ? 1 : 0
    return { width: result.width, height: result.height, data }
  } finally { result.close() }
}
async function segment(frameId: number, strokes: SelectionStroke[]) {
  const totalStart = performance.now()
  const bitmap = images.get(frameId)
  if (!bitmap) throw new Error('写真が見つかりません。読み直してください。')
  if (!strokes.length) throw new Error('対象物を指定してください。')
  const modelStart = performance.now()
  const cpu = await loadCpu()
  const modelLoadMs = performance.now() - modelStart
  let resizeMs = 0,setImageMs = 0
  if (activeFrame !== frameId) {
    const input = inputFor(bitmap)
    resizeMs = input.resizeMs
    const setStart = performance.now()
    cpu.setImage(input.canvas)
    setImageMs = performance.now() - setStart
    activeFrame = frameId
  }
  const segmentStart = performance.now()
  const result = cpu.segment(brushes(strokes))
  const segmentMs = performance.now() - segmentStart
  const convertStart = performance.now()
  const mask = toMask(result)
  const conversionMs = performance.now() - convertStart
  const timings: MaskTimings = { modelLoadMs, resizeMs, setImageMs, segmentMs, conversionMs,
    totalMs: performance.now() - totalStart }
  const seed = strokes.filter((stroke) => stroke.mode === 'add').at(-1)?.points.at(-1) ?? { x: 0.5, y: 0.5 }
  return { mask, quality: assessMask(mask, seed), timings }
}
async function autoSegment(request: Extract<MaskWorkerRequest, { type: 'auto' }>) {
  const reference = images.get(request.referenceFrameId)
  const target = images.get(request.frameId)
  if (!reference || !target) throw new Error('候補探索用の写真が見つかりません。')
  const started = performance.now()
  const searchStart = performance.now()
  const candidates = findCandidatePoints(pixelsFor(reference), request.referenceMask, pixelsFor(target), request.selected)
  const searchMs = performance.now() - searchStart
  let best: { mask: Awaited<ReturnType<typeof segment>>['mask']; quality: Awaited<ReturnType<typeof segment>>['quality'];
    seed: { x: number; y: number }; rank: number } | null = null
  const accumulated: MaskTimings = { modelLoadMs: 0, resizeMs: 0, setImageMs: 0,
    segmentMs: 0, conversionMs: 0, totalMs: 0, searchMs, attempts: 0 }
  for (const seed of candidates.slice(0, 3)) {
    const result = await segment(request.frameId, [{ mode: 'add', points: [{ x: seed.x, y: seed.y }] }])
    const assessment = assessCandidate(result.mask, seed, request.referenceMask)
    accumulated.modelLoadMs += result.timings.modelLoadMs
    accumulated.resizeMs += result.timings.resizeMs
    accumulated.setImageMs += result.timings.setImageMs
    accumulated.segmentMs += result.timings.segmentMs
    accumulated.conversionMs += result.timings.conversionMs
    accumulated.attempts! += 1
    if (!best || assessment.rank > best.rank) best = { mask: result.mask, quality: assessment.quality,
      seed, rank: assessment.rank }
    if (assessment.acceptable && seed.score > 0.55) break
  }
  if (!best) throw new Error('対象候補を見つけられませんでした。')
  accumulated.totalMs = performance.now() - started
  if (best.rank < 6 || candidates.find((candidate) => candidate.x === best.seed.x && candidate.y === best.seed.y)!.score <= 0.55) {
    best.quality = { ...best.quality, needsReview: true, reason: best.quality.reason || '候補の確信度が低い可能性' }
  }
  return { mask: best.mask, quality: best.quality, seed: best.seed, timings: accumulated }
}
async function benchmark(frameId: number, strokes: SelectionStroke[]) {
  const cpu = await segment(frameId, strokes)
  const bitmap = images.get(frameId)!
  let gpu: InteractiveSegmenter | null = null
  try {
    gpu = await createSegmenter('GPU')
    const { canvas } = inputFor(bitmap)
    const start = performance.now()
    gpu.setImage(canvas)
    const gpuMask = toMask(gpu.segment(brushes(strokes)))
    const gpuMs = performance.now() - start
    if (!gpuMask.data.some(Boolean)) throw new Error('GPUのMaskが空です。')
    if (gpuMask.width !== cpu.mask.width || gpuMask.height !== cpu.mask.height) throw new Error('GPUのMask寸法が異なります。')
    let intersection = 0,union = 0
    for (let i = 0; i < gpuMask.data.length; i += 1) {
      if (gpuMask.data[i] && cpu.mask.data[i]) intersection += 1
      if (gpuMask.data[i] || cpu.mask.data[i]) union += 1
    }
    return { cpuMs: cpu.timings.setImageMs + cpu.timings.segmentMs, gpuMs, iou: union ? intersection / union : 0 }
  } finally { gpu?.close() }
}
async function handle(request: MaskWorkerRequest) {
  if (request.type === 'register') {
    images.get(request.frameId)?.close()
    images.set(request.frameId, request.bitmap)
    if (activeFrame === request.frameId) activeFrame = null
    return
  }
  if (request.type === 'remove') {
    images.get(request.frameId)?.close()
    images.delete(request.frameId)
    if (activeFrame === request.frameId) activeFrame = null
    return
  }
  try {
    if (request.type === 'segment' || request.type === 'auto') {
      const result = request.type === 'segment' ? await segment(request.frameId, request.strokes) : await autoSegment(request)
      const response: MaskWorkerResponse = { type: 'mask', jobId: request.jobId, frameId: request.frameId, ...result }
      scope.postMessage(response, [result.mask.data.buffer])
    } else {
      const result = await benchmark(request.frameId, request.strokes)
      const response: MaskWorkerResponse = { type: 'benchmark', jobId: request.jobId, frameId: request.frameId, ...result }
      scope.postMessage(response)
    }
  } catch (cause) {
    const response: MaskWorkerResponse = { type: request.type === 'benchmark' ? 'benchmark' : 'error',
      jobId: request.jobId, frameId: request.frameId,
      ...(request.type === 'benchmark' ? { cpuMs: 0, error: cause instanceof Error ? cause.message : '比較に失敗しました。' }
        : { error: cause instanceof Error ? cause.message : 'Maskを作れませんでした。' }) } as MaskWorkerResponse
    scope.postMessage(response)
  }
}
scope.onmessage = (event: MessageEvent<MaskWorkerRequest>) => {
  queue = queue.then(() => handle(event.data)).catch(() => {})
}
