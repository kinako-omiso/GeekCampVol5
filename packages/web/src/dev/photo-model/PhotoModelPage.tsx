import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { analyzeGeometry, type GeometryResult } from '@gikcamp/geometry-wasm'
import { reconstructQuickScanWithMetrics } from '../../features/analyze/reconstruction/quickScan'
import type { QuickScanOutput, SilhouetteMask } from '../../features/analyze/reconstruction/types'
import { loadPhoto, segmentPhoto, setPhotoForSegmentation } from '../../features/capture/pipeline/photoSegmenter'
import type { PhotoPreparationTimings, SegmentationTimings, SelectionStroke } from '../../features/capture/pipeline/photoSegmenter'
import './photoModel.css'

function Preview({ output, onError }: { output: QuickScanOutput; onError: (message: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    let dispose: (() => void) | undefined
    void import('../../lib/babylon/reconstructionPreview')
      .then(({ mountReconstructionPreview }) => {
        if (cancelled || !canvasRef.current) return
        dispose = mountReconstructionPreview(canvasRef.current, output.reconstruction)
      })
      .catch((error: unknown) => {
        if (!cancelled) onError(error instanceof Error ? error.message : '3D表示を初期化できませんでした。')
      })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [output, onError])

  return <canvas ref={canvasRef} className="photo-model-preview" aria-label="3Dモデルのプレビュー" />
}

type PreparationMetrics = PhotoPreparationTimings & { imageLoadMs: number; totalMs: number }
type MaskMetrics = SegmentationTimings & {
  rasterMs: number
  overlayDrawMs: number
  visibleMs: number
  maskWidth: number
  maskHeight: number
}

type PendingMaskMetrics = {
  mask: SilhouetteMask
  startedAt: number
  operation: number
  timings: Omit<MaskMetrics, 'overlayDrawMs' | 'visibleMs'>
}

function createMaskOverlay(mask: SilhouetteMask): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = mask.width
  canvas.height = mask.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Maskを表示するCanvasを作成できませんでした。')
  const pixels = context.createImageData(mask.width, mask.height)
  for (let index = 0; index < mask.data.length; index += 1) {
    if (mask.data[index] === 0) continue
    pixels.data[index * 4] = 53
    pixels.data[index * 4 + 1] = 211
    pixels.data[index * 4 + 2] = 196
    pixels.data[index * 4 + 3] = 105
  }
  context.putImageData(pixels, 0, 0)
  return canvas
}

function drawOverlay(
  canvas: HTMLCanvasElement,
  photo: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement | null,
  strokes: ReadonlyArray<SelectionStroke>,
  draft: SelectionStroke | null,
) {
  if (canvas.width !== photo.width) canvas.width = photo.width
  if (canvas.height !== photo.height) canvas.height = photo.height
  const context = canvas.getContext('2d')
  if (!context) return
  context.clearRect(0, 0, canvas.width, canvas.height)

  if (maskCanvas) context.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height)

  for (const stroke of [...strokes, ...(draft ? [draft] : [])]) {
    if (stroke.points.length === 0) continue
    context.beginPath()
    context.lineWidth = Math.max(4, canvas.width / 170)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeStyle = stroke.mode === 'add' ? '#12f0ab' : '#ff6e69'
    context.fillStyle = context.strokeStyle
    stroke.points.forEach((point, index) => {
      const x = point.x * canvas.width
      const y = point.y * canvas.height
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    if (stroke.points.length === 1) {
      const point = stroke.points[0]
      context.arc(point.x * canvas.width, point.y * canvas.height, context.lineWidth / 2, 0, Math.PI * 2)
      context.fill()
    } else {
      context.stroke()
    }
  }
}

export default function PhotoModelPage() {
  const photoRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const draftRef = useRef<SelectionStroke | null>(null)
  const maskOverlayRef = useRef<{ mask: SilhouetteMask; canvas: HTMLCanvasElement } | null>(null)
  const pendingMaskMetricsRef = useRef<PendingMaskMetrics | null>(null)
  const operationRef = useRef(0)
  const segmentationMaxSide = new URLSearchParams(window.location.search).get('maskSize') === '768' ? 768 : 1024
  const [preparationMetrics, setPreparationMetrics] = useState<PreparationMetrics | null>(null)
  const [maskMetrics, setMaskMetrics] = useState<MaskMetrics | null>(null)
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null)
  const [mask, setMask] = useState<SilhouetteMask | null>(null)
  const [strokes, setStrokes] = useState<SelectionStroke[]>([])
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [output, setOutput] = useState<QuickScanOutput | null>(null)
  const [geometry, setGeometry] = useState<GeometryResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('写真を選択してください。')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!photo || !photoRef.current) return
    photoRef.current.width = photo.width
    photoRef.current.height = photo.height
    photoRef.current.getContext('2d')?.drawImage(photo, 0, 0)
  }, [photo])

  useEffect(() => {
    if (!photo || !overlayRef.current) return
    const drawStart = performance.now()
    const maskCanvas = maskOverlayRef.current?.mask === mask ? maskOverlayRef.current.canvas : null
    drawOverlay(overlayRef.current, photo, maskCanvas, strokes, draftRef.current)
    const pending = pendingMaskMetricsRef.current
    if (pending?.mask !== mask) return
    pendingMaskMetricsRef.current = null
    const overlayDrawMs = performance.now() - drawStart
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (pending.operation !== operationRef.current) return
        setMaskMetrics({
          ...pending.timings,
          overlayDrawMs,
          visibleMs: performance.now() - pending.startedAt,
        })
      }, 0)
    })
  }, [photo, mask, strokes])

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    const startedAt = performance.now()
    operationRef.current += 1
    maskOverlayRef.current = null
    pendingMaskMetricsRef.current = null
    draftRef.current = null
    setPreparationMetrics(null)
    setMaskMetrics(null)
    setBusy(true)
    setError('')
    setOutput(null)
    setGeometry(null)
    setMask(null)
    setStrokes([])
    setMode('add')
    setPhoto(null)
    setStatus('写真を読み込んでいます…')
    try {
      const canvas = await loadPhoto(file)
      const imageLoadMs = performance.now() - startedAt
      setPhoto(canvas)
      setStatus('領域分割モデルを読み込んでいます…')
      const timings = await setPhotoForSegmentation(canvas, segmentationMaxSide)
      setPreparationMetrics({ ...timings, imageLoadMs, totalMs: performance.now() - startedAt })
      setStatus('対象物の上をクリックまたはドラッグしてください。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '写真の準備に失敗しました。')
      setStatus('写真を選び直してください。')
    } finally {
      setBusy(false)
    }
  }

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    }
  }

  const showDraft = () => {
    if (!photo || !overlayRef.current) return
    const maskCanvas = maskOverlayRef.current?.mask === mask ? maskOverlayRef.current.canvas : null
    drawOverlay(overlayRef.current, photo, maskCanvas, strokes, draftRef.current)
  }

  const finishStroke = async () => {
    const draft = draftRef.current
    draftRef.current = null
    if (!draft || !photo) return
    const startedAt = performance.now()
    const operation = ++operationRef.current
    const next = [...strokes, draft]
    setStrokes(next)
    setBusy(true)
    setError('')
    setOutput(null)
    setGeometry(null)
    setMaskMetrics(null)
    setStatus('対象物を切り出しています…')
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    try {
      const timings: SegmentationTimings = { segmentMs: 0, conversionMs: 0 }
      const nextMask = await segmentPhoto(next, (value) => { Object.assign(timings, value) })
      if (!nextMask.data.some((value) => value !== 0)) throw new Error('対象物が見つかりません。指定をやり直してください。')
      const rasterStart = performance.now()
      const maskCanvas = createMaskOverlay(nextMask)
      const rasterMs = performance.now() - rasterStart
      maskOverlayRef.current = { mask: nextMask, canvas: maskCanvas }
      pendingMaskMetricsRef.current = {
        mask: nextMask,
        startedAt,
        operation,
        timings: {
          segmentMs: timings.segmentMs,
          conversionMs: timings.conversionMs,
          rasterMs,
          maskWidth: nextMask.width,
          maskHeight: nextMask.height,
        },
      }
      setMask(nextMask)
      setStatus('Maskを確認し、必要なら追加・除外してください。')
    } catch (cause) {
      maskOverlayRef.current = null
      pendingMaskMetricsRef.current = null
      setMask(null)
      setError(cause instanceof Error ? cause.message : '領域分割に失敗しました。')
      setStatus('指定をやり直してください。')
    } finally {
      setBusy(false)
    }
  }

  const generate = async () => {
    if (!mask) return
    setError('')
    setBusy(true)
    try {
      const next = reconstructQuickScanWithMetrics(mask)
      setOutput(next)
      try {
        setGeometry(await analyzeGeometry({ ...next.reconstruction, source: 'photo' }))
        setStatus('モデルと形状解析を生成しました。ドラッグで回転、ホイールで拡大できます。')
      } catch (cause) {
        setGeometry(null)
        setError(cause instanceof Error ? cause.message : '形状解析に失敗しました。')
        setStatus('モデルを生成しました。形状解析のエラーを確認してください。')
      }
    } catch (cause) {
      setOutput(null)
      setGeometry(null)
      setError(cause instanceof Error ? cause.message : '3Dモデルを解析できませんでした。')
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    operationRef.current += 1
    maskOverlayRef.current = null
    pendingMaskMetricsRef.current = null
    setMaskMetrics(null)
    setStrokes([])
    setMode('add')
    setMask(null)
    setOutput(null)
    setGeometry(null)
    setError('')
    setStatus('対象物の上をクリックまたはドラッグしてください。')
  }

  return (
    <main className="photo-model-page">
      <header className="photo-model-header">
        <a href="/">トップ</a>
        <div>
          <p className="photo-model-kicker">ISSUE #2 · QUICK SCAN</p>
          <h1>写真から3Dモデルを作る</h1>
          <p>写真の対象物を指定し、輪郭から単色の立体を作ります。</p>
        </div>
      </header>

      <section className="photo-model-toolbar" aria-label="写真と領域の操作">
        <label className="photo-model-file">
          写真を選択
          <input type="file" accept="image/*" disabled={busy} onChange={(event) => {
            void handleFile(event.currentTarget.files?.[0])
            event.currentTarget.value = ''
          }} />
        </label>
        {photo && <>
          <div className="photo-model-mode" aria-label="領域の指定方法">
            <button type="button" className={mode === 'add' ? 'selected' : ''} disabled={busy} onClick={() => setMode('add')}>追加</button>
            <button type="button" className={mode === 'remove' ? 'selected' : ''} disabled={busy} onClick={() => setMode('remove')}>除外</button>
          </div>
          <button type="button" disabled={busy || strokes.length === 0} onClick={reset}>指定をやり直す</button>
          <button type="button" className="photo-model-primary" disabled={busy || !mask} onClick={() => { void generate() }}>3Dモデルを生成</button>
        </>}
      </section>

      <p className="photo-model-status" role="status">{busy ? '処理中 · ' : ''}{status}</p>
      {preparationMetrics && <p className="photo-model-timings">写真準備 {preparationMetrics.totalMs.toFixed(0)} ms（画像 {preparationMetrics.imageLoadMs.toFixed(0)} / モデル {preparationMetrics.modelLoadMs.toFixed(0)} / 縮小 {preparationMetrics.resizeMs.toFixed(0)} / setImage {preparationMetrics.setImageMs.toFixed(0)}）、分割入力 {preparationMetrics.inputWidth}×{preparationMetrics.inputHeight}px</p>}
      {maskMetrics && <p className="photo-model-timings">Mask表示 {maskMetrics.visibleMs.toFixed(0)} ms / 目標 1,500 ms（{maskMetrics.visibleMs <= 1500 ? '目標以内' : '目標超過'}、指定完了から表示までの推定値）（segment {maskMetrics.segmentMs.toFixed(0)} / 変換 {maskMetrics.conversionMs.toFixed(0)} / 色付け {maskMetrics.rasterMs.toFixed(0)} / 重ね描き {maskMetrics.overlayDrawMs.toFixed(0)}）、Mask {maskMetrics.maskWidth}×{maskMetrics.maskHeight}px</p>}
      {error && <p className="photo-model-error" role="alert">{error}</p>}

      <div className="photo-model-columns">
        <section className="photo-model-panel">
          <div className="photo-model-panel-heading"><h2>01 · 対象を指定</h2><span>緑: 追加 / 赤: 除外</span></div>
          {photo ? <div className="photo-model-image-wrap">
            <canvas ref={photoRef} className="photo-model-image" aria-label="選択した写真" />
            <canvas
              ref={overlayRef}
              className="photo-model-overlay"
              aria-label="写真上で対象物を指定"
              onPointerDown={(event) => {
                if (busy) return
                event.currentTarget.setPointerCapture(event.pointerId)
                draftRef.current = { mode, points: [pointFromEvent(event)] }
                showDraft()
              }}
              onPointerMove={(event) => {
                if (!draftRef.current || busy) return
                const point = pointFromEvent(event)
                const previous = draftRef.current.points.at(-1)!
                if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.003) return
                draftRef.current = { ...draftRef.current, points: [...draftRef.current.points, point] }
                showDraft()
              }}
              onPointerUp={() => { void finishStroke() }}
              onPointerCancel={() => { draftRef.current = null; showDraft() }}
            />
          </div> : <div className="photo-model-placeholder">写真を選ぶと、ここにプレビューが表示されます。</div>}
        </section>

        <section className="photo-model-panel">
          <div className="photo-model-panel-heading"><h2>02 · 3Dを確認</h2><span>ドラッグで360°回転</span></div>
          {output ? <Preview output={output} onError={setError} /> : <div className="photo-model-placeholder photo-model-placeholder-dark">Maskを確認して「3Dモデルを生成」を押してください。</div>}
          {geometry && <dl className="photo-model-metrics">
            <div><dt>暫定能力値</dt><dd>HP {geometry.stats.hp} / 攻撃 {geometry.stats.attack} / リーチ {geometry.stats.reach} / 旋回 {geometry.stats.turnSpeed} / 移動 {geometry.stats.moveSpeed}</dd></div>
            <div><dt>3D形状</dt><dd>体積 {geometry.volume.toFixed(3)} / 凸包 {geometry.hullIndices.length / 3}面 / 重心 {geometry.centerOfMass.map((v) => v.toFixed(2)).join(', ')}</dd></div>
            <div><dt>特徴</dt><dd>細長さ {geometry.axes.elongation.toFixed(2)} / 充実度 {geometry.axes.solidity.toFixed(2)} / 鋭さ {geometry.axes.sharpness.toFixed(2)}（{geometry.statsVersion}）</dd></div>
          </dl>}
          {output && <dl className="photo-model-metrics">
            <div><dt>輪郭抽出</dt><dd>{output.metrics.contourMs.toFixed(1)} ms</dd></div>
            <div><dt>メッシュ生成</dt><dd>{output.metrics.meshMs.toFixed(1)} ms</dd></div>
            <div><dt>頂点</dt><dd>{output.metrics.vertexCount.toLocaleString()}</dd></div>
            <div><dt>三角形</dt><dd>{output.metrics.triangleCount.toLocaleString()}</dd></div>
          </dl>}
        </section>
      </div>
    </main>
  )
}
