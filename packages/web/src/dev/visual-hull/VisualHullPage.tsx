import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { createFixedCamera, VOXEL_SIDE } from '@gikcamp/reconstruction-wasm'
import type { SilhouetteMask, VisualHullOptions, VisualHullOutput } from '@gikcamp/reconstruction-wasm'
import type { GeometryResult } from '@gikcamp/geometry-wasm'
import { loadPhoto } from '../../features/capture/pipeline/photoSegmenter'
import type { SelectionStroke } from '../../features/capture/pipeline/photoSegmenter'
import { assessMask } from '../../features/capture/pipeline/maskQuality'
import type { MaskQuality } from '../../features/capture/pipeline/maskQuality'
import type { MaskTimings, MaskWorkerResponse } from '../../features/capture/pipeline/visualHullMaskWorkerTypes'
import type { VisualHullResponse } from '../../features/analyze/reconstruction/visualHullWorkerTypes'
import type { ReconstructionResult } from '../../features/analyze/reconstruction/types'
import { FighterPlacementScreen } from '../../features/orient/FighterPlacementScreen'
import { PhysicsBattleTest } from '../../features/battle/ui/PhysicsBattleTest'
import { createDefaultPlacement, prepareFighterModel, type FighterPlacement } from '../../features/battle/game/fighterPlacement'
import { compareProjection } from './projectedSilhouette'
import './visualHull.css'

const DIRECTIONS = [
  { label: '正面', yaw: 0, required: true }, { label: '右前', yaw: 45, required: false },
  { label: '右', yaw: 90, required: true }, { label: '右後', yaw: 135, required: false },
  { label: '背面', yaw: 180, required: true }, { label: '左後', yaw: 225, required: false },
  { label: '左', yaw: 270, required: true }, { label: '左前', yaw: 315, required: false },
] as const
const BATCH_ORDER = [0, 2, 4, 6, 1, 3, 5, 7]
const noOp = () => {}
function makeThumbnail(photo: HTMLCanvasElement, mask: SilhouetteMask | null) {
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 160 / Math.max(photo.width, photo.height))
  canvas.width = Math.max(1, Math.round(photo.width * scale))
  canvas.height = Math.max(1, Math.round(photo.height * scale))
  const context = canvas.getContext('2d')!
  context.drawImage(photo, 0, 0, canvas.width, canvas.height)
  if (mask) {
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) {
      const mx = Math.min(mask.width - 1, Math.floor(x / canvas.width * mask.width))
      const my = Math.min(mask.height - 1, Math.floor(y / canvas.height * mask.height))
      if (!mask.data[my * mask.width + mx]) continue
      const index = (y * canvas.width + x) * 4
      image.data[index] = Math.round(image.data[index] * 0.55)
      image.data[index + 1] = Math.round(image.data[index + 1] * 0.55 + 100)
      image.data[index + 2] = Math.round(image.data[index + 2] * 0.55 + 70)
    }
    context.putImageData(image, 0, 0)
  }
  return canvas.toDataURL('image/jpeg', 0.7)
}
type Frame = { id: number; name: string; thumbnail: string; photo: HTMLCanvasElement | null; mask: SilhouetteMask | null; seed: { x: number; y: number } | null;
  strokes: SelectionStroke[]; appliedStrokeCount: number; maskRequestedAt: number; maskResponseAt: number; displayMs: number | null; selectionToDisplayMs: number | null; yaw: number; quality: MaskQuality | null; timings: MaskTimings | null; loadMs: number }
const initialFrames = (): Frame[] => DIRECTIONS.map((value) => ({ id: 0, name: '', thumbnail: '', photo: null, mask: null, seed: null,
  strokes: [], appliedStrokeCount: 0, maskRequestedAt: 0, maskResponseAt: 0, displayMs: null, selectionToDisplayMs: null, yaw: value.yaw, quality: null, timings: null, loadMs: 0 }))
type MaskJob = { resolve: (value: MaskWorkerResponse) => void; reject: (reason: Error) => void }

function ModelPreview({ reconstruction, onError, onFirstFrame }: { reconstruction: ReconstructionResult;
  onError: (message: string) => void; onFirstFrame: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    let dispose: (() => void) | undefined
    void import('../../lib/babylon/reconstructionPreview').then(({ mountReconstructionPreview }) => {
      if (!cancelled && ref.current) dispose = mountReconstructionPreview(ref.current, reconstruction, onFirstFrame)
    }).catch((cause: unknown) => { if (!cancelled) onError(cause instanceof Error ? cause.message : '3D表示に失敗しました。') })
    return () => { cancelled = true; dispose?.() }
  }, [reconstruction, onError, onFirstFrame])
  return <canvas ref={ref} className="visual-hull-preview" aria-label="Visual Hull 3Dプレビュー" />
}

function drawProjectionBounds(context: CanvasRenderingContext2D, photo: HTMLCanvasElement, yaw: number) {
  const camera = createFixedCamera(photo.width, photo.height, yaw)
  const project = (x: number, y: number, z: number) => {
    const R = camera.rotation, t = camera.translation, K = camera.intrinsics
    const cx = R[0] * x + R[1] * y + R[2] * z + t[0]
    const cy = R[3] * x + R[4] * y + R[5] * z + t[1]
    const cz = R[6] * x + R[7] * y + R[8] * z + t[2]
    return { x: K[0] * cx / cz + K[2], y: K[4] * cy / cz + K[5] }
  }
  const corners = [-0.5, 0.5].flatMap((x) => [-0.5, 0.5].flatMap((y) => [-0.5, 0.5].map((z) => project(x, y, z))))
  context.strokeStyle = '#ffdc65'; context.lineWidth = Math.max(2, photo.width / 500)
  for (let a = 0; a < 8; a += 1) for (let b = a + 1; b < 8; b += 1) {
    if ((a ^ b) !== 1 && (a ^ b) !== 2 && (a ^ b) !== 4) continue
    context.beginPath(); context.moveTo(corners[a].x, corners[a].y)
    context.lineTo(corners[b].x, corners[b].y); context.stroke()
  }
}

export default function VisualHullPage() {
  const [flowStep, setFlowStep] = useState<'create' | 'placement' | 'battle'>('create')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [placement, setPlacement] = useState<FighterPlacement | null>(null)
  const [defaultPlacement, setDefaultPlacement] = useState<FighterPlacement | null>(null)
  const [frames, setFrames] = useState<Frame[]>(initialFrames)
  const [active, setActive] = useState(0)
  const [swapTarget, setSwapTarget] = useState(2)
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [busy, setBusy] = useState(false)
  const [batchStage, setBatchStage] = useState<'none' | 'choose-front' | 'front' | 'auto' | 'review'>('none')
  const [processingIndex, setProcessingIndex] = useState<number | null>(null)
  const [referencePoint, setReferencePoint] = useState<{ x: number; y: number } | null>(null)
  const [status, setStatus] = useState('写真を4枚まとめて選ぶか、方向ごとに読み込んでください。')
  const [error, setError] = useState('')
  const [output, setOutput] = useState<VisualHullOutput | null>(null)
  const [baseline, setBaseline] = useState<{ output: VisualHullOutput; options: Required<VisualHullOptions>; timing: typeof generationTiming } | null>(null)
  const [outputOptions, setOutputOptions] = useState<Required<VisualHullOptions> | null>(null)
  const [geometry, setGeometry] = useState<GeometryResult | null>(null)
  const [options, setOptions] = useState<Required<VisualHullOptions>>({ surface: 'binary', adaptiveBounds: true })
  const [slice, setSlice] = useState(Math.floor(VOXEL_SIDE / 2))
  const [drawTick, setDrawTick] = useState(0)
  const [benchResult, setBenchResult] = useState('')
  const [maskBatchResult, setMaskBatchResult] = useState('')
  const [generationTiming, setGenerationTiming] = useState<{ reconstructionMs: number; geometryMs: number; displayMs: number; totalMs: number } | null>(null)
  const [generationSamples, setGenerationSamples] = useState<number[]>([])
  const imageRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const sliceRef = useRef<HTMLCanvasElement>(null)
  const draftRef = useRef<SelectionStroke | null>(null)
  const maskWorkerRef = useRef<Worker | null>(null)
  const reconstructionWorkerRef = useRef<Worker | null>(null)
  const maskJobsRef = useRef(new Map<number, MaskJob>())
  const nextJobRef = useRef(0)
  const nextFrameRef = useRef(0)
  const generationRef = useRef(0)
  const generationStartRef = useRef(0)
  const workerDoneRef = useRef(0)
  const importedOutputRef = useRef(false)
  const firstFrameMeasuredRef = useRef(false)
  const model = useMemo(() => output && geometry ? { reconstruction: output.reconstruction, geometry } : null, [output, geometry])
  const battleOptions = useMemo(() => model && placement ? { fighters: { p1: { ...model, placement } } } : undefined, [model, placement])
  const current = frames[active]
  const comparisons = useMemo(() => output ? frames.map((frame) => frame.mask ?
    compareProjection(output, createFixedCamera(frame.mask.width, frame.mask.height, frame.yaw), frame.mask) : null) :
    frames.map(() => null), [frames, output])
  const p95 = generationSamples.length ? [...generationSamples].sort((a, b) => a - b)[Math.ceil(generationSamples.length * 0.95) - 1] : null

  useEffect(() => {
    const worker = new Worker(new URL('../../features/capture/pipeline/visualHullMask.worker.ts', import.meta.url), { type: 'module' })
    maskWorkerRef.current = worker
    worker.onmessage = (event: MessageEvent<MaskWorkerResponse>) => {
      const job = maskJobsRef.current.get(event.data.jobId)
      if (!job) return
      maskJobsRef.current.delete(event.data.jobId)
      if (event.data.type === 'error') job.reject(new Error(event.data.error))
      else job.resolve(event.data)
    }
    worker.onerror = () => {
      for (const job of maskJobsRef.current.values()) job.reject(new Error('Mask Workerを起動できませんでした。'))
      maskJobsRef.current.clear()
    }
    return () => { worker.terminate(); reconstructionWorkerRef.current?.terminate() }
  }, [])
  useEffect(() => {
    const photo = current.photo, image = imageRef.current, overlay = overlayRef.current
    if (!photo || !image || !overlay) return
    image.width = overlay.width = photo.width
    image.height = overlay.height = photo.height
    image.getContext('2d')?.drawImage(photo, 0, 0)
    const context = overlay.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, photo.width, photo.height)
    if (current.mask) {
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = current.mask.width; maskCanvas.height = current.mask.height
      const maskContext = maskCanvas.getContext('2d')!
      const pixels = maskContext.createImageData(current.mask.width, current.mask.height)
      current.mask.data.forEach((value, index) => {
        if (value) { pixels.data[index * 4] = 30; pixels.data[index * 4 + 1] = 220; pixels.data[index * 4 + 2] = 170; pixels.data[index * 4 + 3] = 95 }
      })
      maskContext.putImageData(pixels, 0, 0)
      context.drawImage(maskCanvas, 0, 0, photo.width, photo.height)
      const projected = comparisons[active]
      if (projected) {
        const projectionCanvas = document.createElement('canvas')
        projectionCanvas.width = projected.width; projectionCanvas.height = projected.height
        const projectionContext = projectionCanvas.getContext('2d')!
        const projectionPixels = projectionContext.createImageData(projected.width, projected.height)
        for (let y = 0; y < projected.height; y += 1) for (let x = 0; x < projected.width; x += 1) {
          const index = y * projected.width + x
          if (!projected.pixels[index] || (x > 0 && x < projected.width - 1 && y > 0 && y < projected.height - 1 &&
            projected.pixels[index - 1] && projected.pixels[index + 1] && projected.pixels[index - projected.width] && projected.pixels[index + projected.width])) continue
          projectionPixels.data[index * 4] = 255; projectionPixels.data[index * 4 + 1] = 210
          projectionPixels.data[index * 4 + 3] = 255
        }
        projectionContext.putImageData(projectionPixels, 0, 0)
        context.drawImage(projectionCanvas, 0, 0, photo.width, photo.height)
      }
    }
    if (!output) drawProjectionBounds(context, photo, current.yaw)
    for (const stroke of [...current.strokes, ...(draftRef.current ? [draftRef.current] : [])]) {
      context.strokeStyle = stroke.mode === 'add' ? '#00ffae' : '#ff6655'
      context.fillStyle = context.strokeStyle
      context.lineWidth = Math.max(4, photo.width / 150)
      context.lineCap = 'round'; context.lineJoin = 'round'; context.beginPath()
      stroke.points.forEach((point, index) => {
        const x = point.x * photo.width, y = point.y * photo.height
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y)
      })
      if (stroke.points.length === 1) { const p = stroke.points[0]; context.arc(p.x * photo.width, p.y * photo.height, context.lineWidth / 2, 0, Math.PI * 2); context.fill() }
      else context.stroke()
    }
  }, [current, active, comparisons, drawTick, output, flowStep])
  useEffect(() => {
    const pending = frames.map((frame, index) => frame.mask && frame.maskResponseAt && frame.displayMs === null ?
      { index, id: frame.id, mask: frame.mask, responseAt: frame.maskResponseAt, requestedAt: frame.maskRequestedAt } : null)
      .filter((value) => value !== null)
    if (!pending.length) return
    let second = 0
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      const now = performance.now()
      setFrames((previous) => previous.map((frame, index) => {
        const item = pending.find((value) => value.index === index)
        return item && frame.id === item.id && frame.mask === item.mask ?
          { ...frame, displayMs: now - item.responseAt, selectionToDisplayMs: now - item.requestedAt } : frame
      }))
    }) })
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
  }, [frames])
  useEffect(() => {
    if (!output || !sliceRef.current) return
    const side = output.metrics.voxelSide, canvas = sliceRef.current
    canvas.width = canvas.height = side
    const context = canvas.getContext('2d'); if (!context) return
    const pixels = context.createImageData(side, side)
    for (let index = 0; index < side ** 2; index += 1) {
      const value = output.occupancy[slice * side ** 2 + index]
      pixels.data[index * 4] = value ? 80 : 19
      pixels.data[index * 4 + 1] = value ? 222 : 32
      pixels.data[index * 4 + 2] = value ? 185 : 49
      pixels.data[index * 4 + 3] = 255
    }
    context.putImageData(pixels, 0, 0)
  }, [output, slice, flowStep, advancedOpen])

  const resetPlacement = () => { setPlacement(null); setDefaultPlacement(null); setFlowStep('create') }
  const invalidate = () => { resetPlacement(); setOutput(null); setBaseline(null); setOutputOptions(null); setGeometry(null); setGenerationTiming(null) }
  const changeFrame = (index: number, update: Partial<Frame>) => {
    setFrames((previous) => previous.map((frame, i) => {
      if (i !== index) return frame
      const next = { ...frame, ...update }
      if ('mask' in update && next.photo) next.thumbnail = makeThumbnail(next.photo, next.mask)
      return next
    }))
    invalidate()
  }
  const requestMask = (type: 'segment' | 'benchmark', frameId: number, strokes: SelectionStroke[]) => {
    const worker = maskWorkerRef.current
    if (!worker) return Promise.reject(new Error('Mask Workerの準備ができていません。'))
    const jobId = ++nextJobRef.current
    return new Promise<MaskWorkerResponse>((resolve, reject) => {
      maskJobsRef.current.set(jobId, { resolve, reject })
      worker.postMessage({ type, jobId, frameId, strokes })
    })
  }
  const requestAuto = (frameId: number, referenceFrameId: number, referenceMask: SilhouetteMask,
    selected: { x: number; y: number }) => {
    const worker = maskWorkerRef.current
    if (!worker) return Promise.reject(new Error('Mask Workerの準備ができていません。'))
    const jobId = ++nextJobRef.current
    return new Promise<MaskWorkerResponse>((resolve, reject) => {
      maskJobsRef.current.set(jobId, { resolve, reject })
      worker.postMessage({ type: 'auto', jobId, frameId, referenceFrameId, referenceMask, selected })
    })
  }
  const loadIntoSlot = async (file: File, index: number) => {
    const start = performance.now()
    const photo = await loadPhoto(file)
    const thumbnail = makeThumbnail(photo, null)
    const loadMs = performance.now() - start
    const id = ++nextFrameRef.current
    const old = frames[index]
    if (old.id) maskWorkerRef.current?.postMessage({ type: 'remove', frameId: old.id })
    const bitmap = await createImageBitmap(photo)
    maskWorkerRef.current?.postMessage({ type: 'register', frameId: id, bitmap }, [bitmap])
    changeFrame(index, { id, name: file.name, thumbnail, photo, mask: null, seed: null, strokes: [], appliedStrokeCount: 0,
      maskRequestedAt: 0, maskResponseAt: 0, displayMs: null, selectionToDisplayMs: null,
      quality: null, timings: null, loadMs })
  }
  const selectFiles = async (files: File[], batch: boolean) => {
    if (!files.length) return
    if (batch && (files.length < 4 || files.length > 8)) { setError('一括取込は4〜8枚を選んでください。'); return }
    setBusy(true); setError(''); setBenchResult(''); setMaskBatchResult('')
    if (batch) {
      for (const frame of frames) if (frame.id) maskWorkerRef.current?.postMessage({ type: 'remove', frameId: frame.id })
      setFrames(initialFrames()); invalidate(); setActive(0); setReferencePoint(null)
      setBatchStage('choose-front')
    }
    try {
      for (let i = 0; i < files.length; i += 1) {
        const index = batch ? BATCH_ORDER[i] : active
        setStatus(`${i + 1}/${files.length}枚の写真を読み込んでいます。`)
        try { await loadIntoSlot(files[i], index) }
        catch (cause) { setError((previous) => `${previous}${previous ? ' / ' : ''}${DIRECTIONS[index].label}: ${cause instanceof Error ? cause.message : '読込失敗'}`) }
      }
      setStatus(batch ? '読み込んだ写真から正面を選んでください。残りは読込順に右・背面・左へ割り当てます。' :
        '写真の対象を指定し、「修正を反映」でMaskを作ってください。')
    } finally { setBusy(false) }
  }
  const chooseFront = (index: number) => {
    if (busy || !frames[index].photo) return
    if (BATCH_ORDER.filter((slot) => frames[slot].photo).length < 4) {
      setError('Mask生成には有効な写真が4枚以上必要です。写真を選び直してください。')
      return
    }
    setFrames((previous) => {
      const selected = previous[index]
      const remaining = BATCH_ORDER.map((slot) => previous[slot]).filter((frame) => frame.photo && frame.id !== selected.id)
      const reordered = initialFrames()
      reordered[0] = { ...selected, yaw: DIRECTIONS[0].yaw }
      remaining.forEach((frame, order) => {
        const slot = BATCH_ORDER[order + 1]
        reordered[slot] = { ...frame, yaw: DIRECTIONS[slot].yaw }
      })
      return reordered
    })
    setActive(0); setMode('add'); setBatchStage('front'); setError('')
    setStatus('正面写真の対象を点かストロークで指定してください。対象全体に沿って描くと輪郭欠けを減らせます。指定後に他方向を自動処理します。')
  }
  const runFromFront = async (strokes: SelectionStroke[]) => {
    const front = frames[0]
    const selected = strokes.filter((stroke) => stroke.mode === 'add').at(-1)?.points.at(-1)
    if (!front.photo || !selected) return
    setBusy(true); setError(''); setStatus('正面のMaskを生成しています。')
    const maskRequestedAt = performance.now()
    let referenceMask: SilhouetteMask
    try {
      const result = await requestMask('segment', front.id, strokes)
      const maskResponseAt = performance.now()
      if (result.type !== 'mask' || !result.mask.data.some(Boolean)) throw new Error('正面の対象が見つかりません。もう一度指定してください。')
      referenceMask = result.mask
      changeFrame(0, { strokes, appliedStrokeCount: strokes.length, mask: result.mask, seed: selected,
        maskRequestedAt, maskResponseAt, displayMs: null, selectionToDisplayMs: null,
        quality: result.quality, timings: result.timings })
      setReferencePoint(selected)
    } catch (cause) {
      changeFrame(0, { strokes: [], appliedStrokeCount: 0, mask: null, seed: null })
      setError(cause instanceof Error ? cause.message : '正面Maskを作れませんでした。')
      setBusy(false)
      return
    }
    setBusy(false); setBatchStage('auto')
    for (const index of BATCH_ORDER.slice(1)) {
      const frame = frames[index]
      if (!frame.photo) continue
      setProcessingIndex(index)
      setStatus(`${DIRECTIONS[index].label}の対象を画像内容から探しています。`)
      const requestedAt = performance.now()
      try {
        const result = await requestAuto(frame.id, front.id, referenceMask, selected)
        const responseAt = performance.now()
        if (result.type !== 'mask') throw new Error('候補を取得できませんでした。')
        const seed = result.seed ?? selected
        const automaticStroke: SelectionStroke = { mode: 'add', points: [seed] }
        changeFrame(index, { mask: result.mask, quality: result.quality, timings: result.timings,
          seed, strokes: [automaticStroke], appliedStrokeCount: 1, maskRequestedAt: requestedAt,
          maskResponseAt: responseAt, displayMs: null, selectionToDisplayMs: null })
      } catch (cause) {
        setError((previous) => `${previous}${previous ? ' / ' : ''}${DIRECTIONS[index].label}: ${cause instanceof Error ? cause.message : '候補取得失敗'}`)
      }
    }
    setProcessingIndex(null); setBatchStage('review')
    setStatus('各写真のMaskを確認してください。失敗した写真だけ修正できます。')
  }
  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }
  const finishStroke = () => {
    const draft = draftRef.current; draftRef.current = null
    if (!draft || !current.photo) return
    const strokes = [...current.strokes, draft]
    changeFrame(active, { strokes })
    if (batchStage === 'front' && active === 0) void runFromFront(strokes)
    else setStatus('修正を反映すると、この写真のMaskだけ再計算します。')
  }
  const applyStrokes = async () => {
    if (!current.photo || !current.strokes.length) return
    const index = active, id = current.id, strokes = current.strokes
    setBusy(true); setError(''); setStatus(`${DIRECTIONS[index].label}のMaskを再計算しています。`)
    try {
      const maskRequestedAt = performance.now()
      const result = await requestMask('segment', id, strokes)
      const maskResponseAt = performance.now()
      if (result.type !== 'mask') throw new Error('Maskを生成できませんでした。')
      changeFrame(index, { appliedStrokeCount: strokes.length, mask: result.mask, seed: strokes.filter((stroke) => stroke.mode === 'add').at(-1)?.points.at(-1) ?? null, maskRequestedAt, maskResponseAt, displayMs: null, selectionToDisplayMs: null, quality: result.quality, timings: result.timings })
      setStatus(`${DIRECTIONS[index].label}のMaskを確認してください。`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Maskを作れませんでした。') }
    finally { setBusy(false) }
  }
  const benchmarkDelegate = async () => {
    if (!current.photo || !current.strokes.length) return
    setBusy(true); setError('')
    try {
      const result = await requestMask('benchmark', current.id, current.strokes)
      if (result.type !== 'benchmark') throw new Error('比較結果を取得できませんでした。')
      setBenchResult(result.error ? `GPU比較失敗: ${result.error}` :
        `同じ写真・指定点: CPU ${result.cpuMs.toFixed(0)} ms / GPU ${result.gpuMs?.toFixed(0)} ms / Mask一致度 IoU ${result.iou?.toFixed(3)}。GPUは比較用で、通常処理はCPUです。`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '比較に失敗しました。') }
    finally { setBusy(false) }
  }
  const benchmarkMaskWorkers = async (count: 1 | 2, items: Frame[]) => {
    const workers = Array.from({ length: count }, () => new Worker(
      new URL('../../features/capture/pipeline/visualHullMask.worker.ts', import.meta.url), { type: 'module' }))
    const pending = new Map<number, { resolve: (value: MaskWorkerResponse) => void; reject: (reason: Error) => void }>()
    let nextJob = 0
    try {
      for (const worker of workers) {
        worker.onmessage = (event: MessageEvent<MaskWorkerResponse>) => {
          const job = pending.get(event.data.jobId)
          if (!job) return
          pending.delete(event.data.jobId)
          if (event.data.type === 'error') job.reject(new Error(event.data.error))
          else job.resolve(event.data)
        }
        worker.onerror = () => {
          for (const job of pending.values()) job.reject(new Error('比較用Workerが停止しました。'))
          pending.clear()
        }
      }
      const front = frames[0]
      if (!front.photo || !front.mask || !referencePoint) throw new Error('正面Maskと指定点が必要です。')
      const started = performance.now()
      await Promise.all(workers.map(async (worker, index) => {
        const bitmap = await createImageBitmap(front.photo!)
        worker.postMessage({ type: 'register', frameId: 10000 + index, bitmap }, [bitmap])
      }))
      const results = await Promise.all(items.map(async (frame, index) => {
        const workerIndex = index % count, worker = workers[workerIndex]
        const bitmap = await createImageBitmap(frame.photo!)
        const frameId = index + 1, jobId = ++nextJob
        worker.postMessage({ type: 'register', frameId, bitmap }, [bitmap])
        return new Promise<MaskWorkerResponse>((resolve, reject) => {
          pending.set(jobId, { resolve, reject })
          if (frame === front) worker.postMessage({ type: 'segment', jobId, frameId, strokes: frame.strokes })
          else worker.postMessage({ type: 'auto', jobId, frameId, referenceFrameId: 10000 + workerIndex,
            referenceMask: front.mask, selected: referencePoint })
        })
      }))
      const mismatches = results.filter((result, index) => {
        const expected = items[index].mask
        return result.type !== 'mask' || !expected || result.mask.width !== expected.width ||
          result.mask.height !== expected.height || result.mask.data.some((pixel, i) => pixel !== expected.data[i])
      }).length
      const masks = results.map((result) => {
        if (result.type !== 'mask') throw new Error('Worker比較でMaskを取得できませんでした。')
        return result.mask.data
      })
      return { ms: performance.now() - started, mismatches, masks }
    } finally { workers.forEach((worker) => worker.terminate()) }
  }
  const compareWorkerCounts = async () => {
    const loaded = BATCH_ORDER.map((index) => frames[index]).filter((frame) => frame.photo)
    if (loaded.length < 4 || ![0, 2, 4, 6].every((index) => frames[index].mask)) {
      setError('Worker比較には正面・右・背面・左のMaskが必要です。'); return
    }
    if (loaded.some((frame) => !frame.mask || frame.strokes.length !== frame.appliedStrokeCount)) {
      setError('Worker比較の前にすべてのMaskを確定してください。'); return
    }
    const suites = loaded.length === 8 ? [loaded.slice(0, 4), loaded] :
      [loaded.slice(0, 4), Array.from({ length: 8 }, (_, index) => loaded[index % loaded.length])]
    setBusy(true); setError(''); setMaskBatchResult('')
    try {
      const lines: string[] = []
      for (const items of suites) {
        setStatus(`${items.length}枚を1 Workerと2 Workerで再推論しています。`)
        const one = await benchmarkMaskWorkers(1, items)
        const two = await benchmarkMaskWorkers(2, items)
        const saving = (1 - two.ms / one.ms) * 100
        const parallelDifference = one.masks.filter((mask, index) => mask.length !== two.masks[index].length ||
          mask.some((pixel, at) => pixel !== two.masks[index][at])).length
        lines.push(`${items.length}枚${items.length === 8 && loaded.length < 8 ? '（写真の再利用）' : ''}: 1 Worker ${one.ms.toFixed(0)} ms / 2 Worker ${two.ms.toFixed(0)} ms / 短縮 ${saving.toFixed(1)}% / 並列差 ${parallelDifference}件 / 保存Maskとの差 ${one.mismatches + two.mismatches}件（手動修正を含む）`)
      }
      setMaskBatchResult(`${lines.join('。')}。Workerのメモリ量は未測定です。`)
      setStatus('Worker比較が完了しました。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Worker比較に失敗しました。') }
    finally { setBusy(false) }
  }
  const swapFrames = () => {
    if (swapTarget === active) return
    setFrames((previous) => {
      const next = [...previous], a = next[active], b = next[swapTarget]
      next[active] = { ...b, yaw: a.yaw }; next[swapTarget] = { ...a, yaw: b.yaw }
      return next
    })
    invalidate()
  }
  const generate = () => {
    const missing = DIRECTIONS.findIndex((direction, index) => direction.required && !frames[index].mask)
    if (batchStage === 'front' || batchStage === 'auto') { setError('自動Mask生成が完了してからモデルを生成してください。'); return }
    if (missing >= 0) { setError(`${DIRECTIONS[missing].label}のMaskが必要です。`); return }
    if (frames.some((frame) => frame.photo && (!frame.mask || frame.strokes.length !== frame.appliedStrokeCount))) {
      setError('読み込んだ写真のMaskを確認してください。'); return
    }
    const views = frames.filter((frame): frame is Frame & { mask: SilhouetteMask } => frame.mask !== null)
      .map((frame) => ({ mask: frame.mask, camera: createFixedCamera(frame.mask.width, frame.mask.height, frame.yaw) }))
    if (output && outputOptions) setBaseline({ output, options: outputOptions, timing: generationTiming })
    resetPlacement()
    firstFrameMeasuredRef.current = false
    setBusy(true); setError(''); setOutput(null); setGeometry(null); setGenerationTiming(null)
    setStatus('96³ Voxelの再構成と形状解析を実行しています。')
    reconstructionWorkerRef.current?.terminate()
    const worker = new Worker(new URL('../../features/analyze/reconstruction/visualHull.worker.ts', import.meta.url), { type: 'module' })
    reconstructionWorkerRef.current = worker
    const id = ++generationRef.current
    importedOutputRef.current = false
    generationStartRef.current = performance.now()
    worker.onmessage = (event: MessageEvent<VisualHullResponse>) => {
      if (event.data.id !== id) return
      workerDoneRef.current = performance.now()
      if ('error' in event.data) setError(event.data.error)
      else {
        setOutput(event.data.output); setOutputOptions({ ...options }); setGeometry(event.data.geometry)
        setSlice(Math.floor(event.data.output.metrics.voxelSide / 2))
        setGenerationTiming({ reconstructionMs: event.data.timings.reconstructionMs,
          geometryMs: event.data.timings.geometryMs, displayMs: 0, totalMs: 0 })
        if (event.data.geometryError) setError(`形状解析: ${event.data.geometryError}`)
        setStatus('Visual Hullを生成しました。モデルをドラッグで回転できます。')
      }
      setBusy(false); worker.terminate(); reconstructionWorkerRef.current = null
    }
    worker.onerror = () => { setError('再構成Workerを起動できませんでした。'); setBusy(false); worker.terminate(); reconstructionWorkerRef.current = null }
    worker.postMessage({ id, views, options })
  }
  const onFirstFrame = useCallback(() => {
    if (importedOutputRef.current || firstFrameMeasuredRef.current) return
    firstFrameMeasuredRef.current = true
    const now = performance.now(), totalMs = now - generationStartRef.current
    setGenerationTiming((previous) => previous ? { ...previous, displayMs: now - workerDoneRef.current, totalMs } : previous)
    setGenerationSamples((previous) => [...previous, totalMs])
  }, [])
  const exportBundle = () => {
    if (!output) return
    const bundle = { version: 2, createdAt: new Date().toISOString(), options: outputOptions ?? options,
      views: frames.filter((frame) => frame.photo).map((frame, index) => ({ direction: DIRECTIONS[frames.indexOf(frame)].label,
        order: index, name: frame.name, yaw: frame.yaw, photo: frame.photo!.toDataURL('image/jpeg', 0.9),
        mask: frame.mask ? { width: frame.mask.width, height: frame.mask.height, data: Array.from(frame.mask.data) } : null,
        seed: frame.seed, strokes: frame.strokes, quality: frame.quality, loadMs: frame.loadMs, maskTimings: frame.timings, displayMs: frame.displayMs, selectionToDisplayMs: frame.selectionToDisplayMs })),
      mesh: { positions: Array.from(output.reconstruction.positions), indices: Array.from(output.reconstruction.indices),
        normals: Array.from(output.reconstruction.normals), normalization: output.normalization,
        occupancy: Array.from(output.occupancy) },
      metrics: output.metrics, referencePoint, generationTiming, projectionIoU: comparisons.map((value) => value?.iou ?? null),
      geometry: geometry ? { ...geometry, hullPositions: Array.from(geometry.hullPositions),
        hullIndices: Array.from(geometry.hullIndices), principalAxes: Array.from(geometry.principalAxes) } : null }
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `visual-hull-${Date.now()}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const importBundle = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setError(''); setStatus('保存した比較データを読み込んでいます。')
    try {
      const raw: unknown = JSON.parse(await file.text())
      if (!raw || typeof raw !== 'object') throw new Error('比較データの形式が正しくありません。')
      const bundle = raw as Record<string, unknown>
      if ((bundle.version !== 1 && bundle.version !== 2) || !Array.isArray(bundle.views) ||
        bundle.views.length < 4 || bundle.views.length > 8 || !bundle.mesh || typeof bundle.mesh !== 'object' ||
        !bundle.metrics || typeof bundle.metrics !== 'object') throw new Error('比較データの形式が正しくありません。')
      const mesh = bundle.mesh as Record<string, unknown>
      const metrics = bundle.metrics as VisualHullOutput['metrics']
      if (!Array.isArray(mesh.positions) || !Array.isArray(mesh.indices) || !Array.isArray(mesh.normals) ||
        !Array.isArray(mesh.normalization) || mesh.normalization.length !== 4 ||
        mesh.positions.length % 3 !== 0 || mesh.indices.length % 3 !== 0 ||
        mesh.normals.length !== mesh.positions.length ||
        metrics.voxelSide !== VOXEL_SIDE) throw new Error('モデルのデータが正しくありません。')
      const restored = initialFrames()
      const occupiedSlots = new Set<number>()
      for (const viewValue of bundle.views) {
        if (!viewValue || typeof viewValue !== 'object') throw new Error('写真のデータが正しくありません。')
        const view = viewValue as Record<string, unknown>
        const index = DIRECTIONS.findIndex((direction) => direction.label === view.direction)
        if (index < 0 || occupiedSlots.has(index) || typeof view.photo !== 'string' ||
          !view.photo.startsWith('data:image/') || !Number.isFinite(view.yaw)) throw new Error('写真と方向の対応が正しくありません。')
        occupiedSlots.add(index)
        const blob = await (await fetch(view.photo)).blob()
        const photo = await loadPhoto(new File([blob], typeof view.name === 'string' ? view.name : 'photo.jpg', { type: blob.type }))
        const id = ++nextFrameRef.current
        const bitmap = await createImageBitmap(photo)
        maskWorkerRef.current?.postMessage({ type: 'register', frameId: id, bitmap }, [bitmap])
        let mask: SilhouetteMask | null = null
        if (view.mask && typeof view.mask === 'object') {
          const savedMask = view.mask as Record<string, unknown>
          if (!Number.isInteger(savedMask.width) || !Number.isInteger(savedMask.height) || !Array.isArray(savedMask.data) ||
            savedMask.data.length !== Number(savedMask.width) * Number(savedMask.height) ||
            savedMask.data.some((value: unknown) => value !== 0 && value !== 1)) throw new Error('Maskのデータが正しくありません。')
          mask = { width: Number(savedMask.width), height: Number(savedMask.height), data: Uint8Array.from(savedMask.data as number[]) }
        }
        const seed = view.seed && typeof view.seed === 'object' && Number.isFinite((view.seed as { x: number }).x) &&
          Number.isFinite((view.seed as { y: number }).y) ? view.seed as { x: number; y: number } : null
        const strokes: SelectionStroke[] = Array.isArray(view.strokes) && view.strokes.every((stroke: unknown) => {
          if (!stroke || typeof stroke !== 'object') return false
          const value = stroke as SelectionStroke
          return (value.mode === 'add' || value.mode === 'remove') && Array.isArray(value.points) &&
            value.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) &&
              point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)
        }) ? view.strokes as SelectionStroke[] : seed ? [{ mode: 'add', points: [seed] }] : []
        restored[index] = { ...restored[index], id, name: typeof view.name === 'string' ? view.name : 'photo.jpg',
          photo, thumbnail: makeThumbnail(photo, mask), mask, seed, strokes, appliedStrokeCount: strokes.length,
          yaw: Number(view.yaw), quality: mask ? assessMask(mask, seed ?? { x: 0.5, y: 0.5 }) : null,
          timings: view.maskTimings && typeof view.maskTimings === 'object' ? view.maskTimings as MaskTimings : null,
          loadMs: Number(view.loadMs) || 0, maskRequestedAt: 0, maskResponseAt: 0,
          displayMs: typeof view.displayMs === 'number' ? view.displayMs : null,
          selectionToDisplayMs: typeof view.selectionToDisplayMs === 'number' ? view.selectionToDisplayMs : null }
      }
      if (![0, 2, 4, 6].every((index) => restored[index].mask)) throw new Error('必須の4方向のMaskがありません。')
      const occupancy = Array.isArray(mesh.occupancy) ? Uint8Array.from(mesh.occupancy as number[]) :
        new Uint8Array(metrics.voxelSide ** 3)
      if (occupancy.length !== metrics.voxelSide ** 3) throw new Error('Voxelのデータが正しくありません。')
      const loadedOutput: VisualHullOutput = { reconstruction: {
        positions: Float32Array.from(mesh.positions as number[]), indices: Uint32Array.from(mesh.indices as number[]),
        normals: Float32Array.from(mesh.normals as number[]) },
      occupancy, normalization: mesh.normalization as [number, number, number, number], metrics }
      const savedOptions = bundle.options as Required<VisualHullOptions> | undefined
      for (const frame of frames) if (frame.id) maskWorkerRef.current?.postMessage({ type: 'remove', frameId: frame.id })
      let restoredGeometry: GeometryResult | null = null
      if (bundle.geometry && typeof bundle.geometry === 'object') {
        const saved = bundle.geometry as Record<string, unknown>
        if (Array.isArray(saved.hullPositions) && Array.isArray(saved.hullIndices) &&
          Array.isArray(saved.principalAxes) && Array.isArray(saved.centerOfMass) &&
          Array.isArray(saved.inertia) && saved.stats && typeof saved.stats === 'object') {
          restoredGeometry = { ...saved, hullPositions: Float32Array.from(saved.hullPositions as number[]),
            hullIndices: Uint32Array.from(saved.hullIndices as number[]),
            principalAxes: Float32Array.from(saved.principalAxes as number[]) } as GeometryResult
        }
      }
      resetPlacement()
      setAdvancedOpen(restored.some((frame, index) => !DIRECTIONS[index].required && frame.photo !== null))
      importedOutputRef.current = true
      setFrames(restored); setOutput(loadedOutput); setBaseline(null); setGeometry(restoredGeometry)
      setOptions({ surface: savedOptions?.surface === 'interpolated' ? 'interpolated' : 'binary',
        adaptiveBounds: savedOptions?.adaptiveBounds !== false })
      setOutputOptions(savedOptions ? { surface: savedOptions.surface === 'interpolated' ? 'interpolated' : 'binary',
        adaptiveBounds: savedOptions.adaptiveBounds !== false } : null)
      setGenerationTiming(bundle.generationTiming as typeof generationTiming ?? null)
      setReferencePoint(bundle.referencePoint as { x: number; y: number } | null ?? null)
      setSlice(Math.floor(metrics.voxelSide / 2)); setActive(0); setBatchStage('review')
      setStatus('保存した写真・Mask・モデルを読み込みました。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '比較データを読み込めませんでした。') }
    finally { setBusy(false) }
  }

  const enterPlacement = async () => {
    if (!output || busy) return
    const requestedOutput = output
    setBusy(true); setError('')
    try {
      const analysis = geometry ?? await (await import('@gikcamp/geometry-wasm')).analyzeGeometry({
        ...requestedOutput.reconstruction, source: 'reconstruction',
      })
      const automatic = createDefaultPlacement(requestedOutput.reconstruction, frames[0].yaw)
      const selected = placement ?? automatic
      // 入力途中の補正値も保持して調整画面へ戻せるよう、モデルの検証は自動配置で行う。
      prepareFighterModel({ reconstruction: requestedOutput.reconstruction, geometry: analysis, placement: automatic })
      setGeometry(analysis); setDefaultPlacement(automatic); setPlacement(selected); setFlowStep('placement')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '配置調整の準備に失敗しました。') }
    finally { setBusy(false) }
  }
  const renderDirection = (index: number) => {
    const direction = DIRECTIONS[index]
    return <button type="button" key={direction.label}
      className={active === index ? 'active' : ''} disabled={busy || (batchStage === 'auto' && index !== 0 && !frames[index].mask)} onClick={() => { draftRef.current = null; setActive(index); setMode('add') }}>
      {frames[index].thumbnail && (batchStage !== 'auto' || !!frames[index].mask) && <img src={frames[index].thumbnail} alt="" />}
      {direction.label}{direction.required ? ' *' : ''}<small>{processingIndex === index ? '画像から探索中' : frames[index].quality?.needsReview ? `要確認: ${frames[index].quality.reason}` :
        frames[index].mask ? 'Mask候補あり' : frames[index].photo ? '指定待ち' : '写真なし'}</small></button>
  }

  if (flowStep !== 'create' && model && placement && defaultPlacement) {
    return <main className="visual-hull-page">
      <header><p>ISSUE #49 · 作成 → 配置調整 → 対戦検証</p><h1>{flowStep === 'placement' ? 'モデルの配置調整' : '生成モデルで対戦を確認'}</h1></header>
      {flowStep === 'placement' ? <FighterPlacementScreen model={model} placement={placement} defaultPlacement={defaultPlacement}
        onChange={setPlacement} onBack={() => setFlowStep('create')} onConfirm={() => setFlowStep('battle')} /> :
        <><p>1P（青）は生成モデル、2P（赤）は既存サンプルです。</p><PhysicsBattleTest options={battleOptions} onBack={() => setFlowStep('placement')} /></>}
    </main>
  }

  return <main className="visual-hull-page">
    <header><a href="/dev/photo-model">Quick Scanへ</a><p>ISSUE #32 / #49 · 作成 → 配置調整 → 対戦検証</p><h1>複数方向の写真から立体を作る</h1>
      <p>正面・右・背面・左の4方向を一括または個別に取り込みます。一括取込では正面を選んで対象を指定すると、残りの写真のMask候補を自動で探します。カメラの高さと距離をそろえて撮影してください。生成後は配置調整と対戦検証へ進めます。</p></header>
    {batchStage === 'choose-front' ? <section className="visual-hull-front-choice" aria-label="正面写真を選ぶ">
      <h2>正面の写真を選んでください</h2>
      <p>写真を選ぶと、その写真だけを大きく表示してMask指定へ進みます。</p>
      <div className="visual-hull-photo-choice">{BATCH_ORDER.map((slot, order) => frames[slot].photo &&
        <button type="button" key={frames[slot].id} disabled={busy} onClick={() => chooseFront(slot)}
          aria-label={`写真${order + 1} ${frames[slot].name}を正面にする`}>
          <img src={frames[slot].thumbnail} alt="" /><span>写真{order + 1} · {frames[slot].name}</span>
          <strong>この写真を正面にする</strong>
        </button>)}</div>
    </section> : <nav className="visual-hull-directions" aria-label="撮影方向">{(batchStage === 'front' ? [0] : [0, 2, 4, 6]).map(renderDirection)}</nav>}
    <section className="visual-hull-toolbar">
      <label>4枚を一括取込 <input type="file" accept="image/*" multiple disabled={busy || batchStage === 'auto'} onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? [])
        if (files.length && files.length !== 4) setError('通常の一括取込は4枚です。5〜8枚は詳細から取り込んでください。')
        else void selectFiles(files, true)
        event.currentTarget.value = ''
      }} /></label>
      {batchStage !== 'front' && batchStage !== 'choose-front' && <><label>選択方向の写真 <input type="file" accept="image/*" disabled={busy || batchStage === 'auto'} onChange={(event) => { void selectFiles(Array.from(event.currentTarget.files ?? []), false); event.currentTarget.value = '' }} /></label>
      <label>方位角 <input type="number" min="0" max="359" value={current.yaw} disabled={busy || batchStage === 'auto'} onChange={(event) => changeFrame(active, { yaw: Number(event.currentTarget.value) })} />°</label>
      <label>入れ替え先 <select value={swapTarget} disabled={busy || batchStage === 'auto'} onChange={(event) => setSwapTarget(Number(event.currentTarget.value))}>{DIRECTIONS.map((direction, index) => (direction.required || advancedOpen) && <option value={index} key={direction.label}>{direction.label}</option>)}</select></label>
      <button type="button" disabled={busy || batchStage === 'auto' || swapTarget === active} onClick={swapFrames}>割当を入れ替え</button>
      <button type="button" disabled={busy || batchStage === 'auto' || !current.photo} onClick={() => setMode('add')} aria-pressed={mode === 'add'}>追加</button>
      <button type="button" disabled={busy || batchStage === 'auto' || !current.photo} onClick={() => setMode('remove')} aria-pressed={mode === 'remove'}>除外</button>
      <button type="button" disabled={busy || batchStage === 'auto' || !current.photo} onClick={() => changeFrame(active, { strokes: [], appliedStrokeCount: 0, mask: null, quality: null, timings: null })}>指定をやり直す</button>
      <button type="button" disabled={busy || batchStage === 'auto' || !current.strokes.length} onClick={() => { void applyStrokes() }}>修正を反映</button>
      </>}
    </section>
    {batchStage !== 'front' && batchStage !== 'choose-front' && <>
      <section className="visual-hull-toolbar">
        <button type="button" className="primary" disabled={busy || batchStage === 'auto'} onClick={generate}>Visual Hullを生成</button>
        <button type="button" className="primary" disabled={busy || batchStage === 'auto' || !output} onClick={() => { void enterPlacement() }}>配置調整へ進む</button>
      </section>
      <details className="visual-hull-advanced" open={advancedOpen} onToggle={(event) => {
        const open = event.currentTarget.open
        setAdvancedOpen(open)
        if (!open && !DIRECTIONS[active].required) setActive(0)
        if (!open && !DIRECTIONS[swapTarget].required) setSwapTarget(2)
      }}>
        <summary>8方向・検証の詳細（任意方向の写真 {frames.filter((frame, index) => !DIRECTIONS[index].required && frame.photo).length} 枚）</summary>
        {advancedOpen && <>
          <nav className="visual-hull-directions" aria-label="任意の撮影方向">{[1, 3, 5, 7].map(renderDirection)}</nav>
          <section className="visual-hull-toolbar">
            <label>4〜8枚を一括取込 <input type="file" accept="image/*" multiple disabled={busy || batchStage === 'auto'} onChange={(event) => { void selectFiles(Array.from(event.currentTarget.files ?? []), true); event.currentTarget.value = '' }} /></label>
            <button type="button" disabled={busy || batchStage === 'auto' || !current.mask} onClick={() => { void benchmarkDelegate() }}>CPU/GPU比較</button>
            <button type="button" disabled={busy || batchStage === 'auto'} onClick={() => { void compareWorkerCounts() }}>1/2 Worker比較</button>
            <label>面 <select value={options.surface} disabled={busy || batchStage === 'auto'} onChange={(event) => setOptions({ ...options, surface: event.currentTarget.value as 'binary' | 'interpolated' })}><option value="interpolated">輪郭補間</option><option value="binary">二値中点</option></select></label>
            <label><input type="checkbox" checked={options.adaptiveBounds} disabled={busy || batchStage === 'auto'} onChange={(event) => setOptions({ ...options, adaptiveBounds: event.currentTarget.checked })} />占有範囲へ計算領域を合わせる</label>
            <button type="button" disabled={busy || !output} onClick={exportBundle}>写真・Mask・モデルを保存</button>
            <label>保存データを再読込 <input type="file" accept="application/json,.json" disabled={busy || batchStage === 'auto'} onChange={(event) => { void importBundle(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /></label>
          </section>
          {benchResult && <p>{benchResult}</p>}{maskBatchResult && <p>{maskBatchResult}</p>}
        </>}
      </details>
    </>}
    <p role="status">{busy ? '処理中 · ' : ''}{status}</p>{error && <p className="visual-hull-error" role="alert">{error}</p>}
    {batchStage !== 'choose-front' && <div className={`visual-hull-columns ${batchStage === 'front' ? 'front-stage' : ''}`}>
      <section className="visual-hull-panel"><h2>{DIRECTIONS[active].label} · 写真とMask</h2>
        {current.photo ? <div className="visual-hull-image-wrap"><canvas ref={imageRef} aria-label="選択した写真" />
          <canvas ref={overlayRef} aria-label="対象を指定する" onPointerDown={(event) => { if (busy || batchStage === 'auto') return; event.currentTarget.setPointerCapture(event.pointerId); draftRef.current = { mode, points: [point(event)] }; setDrawTick((value) => value + 1) }}
            onPointerMove={(event) => { if (!draftRef.current || busy || batchStage === 'auto') return; const next = point(event); const last = draftRef.current.points.at(-1)!; if (Math.hypot(next.x - last.x, next.y - last.y) < 0.003) return; draftRef.current = { ...draftRef.current, points: [...draftRef.current.points, next] }; setDrawTick((value) => value + 1) }}
            onPointerUp={finishStroke} onPointerCancel={() => { draftRef.current = null; setDrawTick((value) => value + 1) }} /></div>
          : <p>この方向の写真を選んでください。</p>}
        <p>緑: Mask / 黄: 生成モデルの再投影輪郭 / ストロークは「修正を反映」でまとめて推論します。</p>
        {current.quality && <p>{current.quality.needsReview ? `要確認: ${current.quality.reason}` : '自動候補: 問題の兆候なし'}（面積 {(current.quality.fraction * 100).toFixed(1)}%）</p>}
        <details><summary>写真とMaskの計測値</summary>{current.timings && <p>{current.timings.attempts ? `候補探索 ${current.timings.searchMs?.toFixed(0)} ms / 候補推論 ${current.timings.attempts}回 / ` : ''}指定完了→Maskサムネイル表示 {current.selectionToDisplayMs?.toFixed(0) ?? '未表示'} ms / 推論 {current.timings.segmentMs.toFixed(0)} ms / 表示 {current.displayMs?.toFixed(0) ?? '未表示'} ms<br />写真準備 {current.loadMs.toFixed(0)} ms / モデル準備 {current.timings.modelLoadMs.toFixed(0)} ms / 縮小 {current.timings.resizeMs.toFixed(0)} ms / setImage {current.timings.setImageMs.toFixed(0)} ms / 推論 {current.timings.segmentMs.toFixed(0)} ms / Mask変換 {current.timings.conversionMs.toFixed(0)} ms</p>}
        {comparisons[active] && <p>Maskと再投影の一致度 IoU {comparisons[active]!.iou.toFixed(3)}</p>}</details>
      </section>
      {batchStage !== 'front' && <section className="visual-hull-panel"><h2>3Dモデルと解析結果</h2>
        {output ? <div className="visual-hull-comparison"><h3>現在 · {output.metrics.voxelSide}³ / {outputOptions?.surface === 'binary' ? '二値中点' : '輪郭補間'}</h3><ModelPreview reconstruction={output.reconstruction} onError={setError} onFirstFrame={onFirstFrame} /></div> : <div className="visual-hull-placeholder">4〜8方向のMaskをそろえて生成してください。</div>}
        {advancedOpen && <div className="visual-hull-metrics">
        {baseline && <div className="visual-hull-comparison"><h3>比較前 · {baseline.output.metrics.voxelSide}³ / {baseline.options.surface === 'binary' ? '二値中点' : '輪郭補間'}</h3><ModelPreview reconstruction={baseline.output.reconstruction} onError={setError} onFirstFrame={noOp} /><p>再構成 {baseline.output.metrics.carvingAndMeshMs.toFixed(0)} ms / 頂点 {baseline.output.metrics.vertexCount.toLocaleString()} / 三角形 {baseline.output.metrics.triangleCount.toLocaleString()} / Mask確定後から表示 {baseline.timing?.totalMs.toFixed(0) ?? '未測定'} ms</p></div>}
        {output && <><p>占有Voxel {output.metrics.voxelCount.toLocaleString()} / 頂点 {output.metrics.vertexCount.toLocaleString()} / 三角形 {output.metrics.triangleCount.toLocaleString()} / 再構成本体 {output.metrics.carvingAndMeshMs.toFixed(0)} ms / 面向き補正 {output.metrics.windingCorrections ?? 0}面 / 境界修復 {output.metrics.sealedFaces ?? 0}面{output.metrics.clipped ? ' / 領域端への接触あり' : ''}</p>
          <label>Voxel断面 z={slice} <input type="range" min="0" max={output.metrics.voxelSide - 1} value={slice} onChange={(event) => setSlice(Number(event.currentTarget.value))} /></label>
          <canvas ref={sliceRef} className="visual-hull-slice" aria-label="Voxel断面" /></>}
        {generationTiming && <p>再構成Worker {generationTiming.reconstructionMs.toFixed(0)} ms / 形状解析 {generationTiming.geometryMs.toFixed(0)} ms / 3D画面表示 {generationTiming.displayMs.toFixed(0)} ms / Mask確定後から表示 {generationTiming.totalMs.toFixed(0)} ms{p95 !== null ? ` / この画面でのp95 ${p95.toFixed(0)} ms（${generationSamples.length}回）` : ''}</p>}
        {geometry && <p>暫定能力値: HP {geometry.stats.hp} / 攻撃 {geometry.stats.attack} / リーチ {geometry.stats.reach} / 旋回 {geometry.stats.turnSpeed} / 移動 {geometry.stats.moveSpeed}<br />体積 {geometry.volume.toFixed(3)} / 3D凸包 {geometry.hullIndices.length / 3}面 / 重心 {geometry.centerOfMass.map((v) => v.toFixed(2)).join(', ')}（{geometry.statsVersion}）</p>}
        </div>}
      </section>}
    </div>}
  </main>
}
