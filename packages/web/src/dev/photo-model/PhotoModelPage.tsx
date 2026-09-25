import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { reconstructQuickScanWithMetrics } from '../../features/analyze/reconstruction/quickScan'
import type { QuickScanOutput, SilhouetteMask } from '../../features/analyze/reconstruction/types'
import { loadPhoto, segmentPhoto, setPhotoForSegmentation } from '../../features/capture/pipeline/photoSegmenter'
import type { SelectionStroke } from '../../features/capture/pipeline/photoSegmenter'
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

function drawOverlay(
  canvas: HTMLCanvasElement,
  photo: HTMLCanvasElement,
  mask: SilhouetteMask | null,
  strokes: ReadonlyArray<SelectionStroke>,
  draft: SelectionStroke | null,
) {
  canvas.width = photo.width
  canvas.height = photo.height
  const context = canvas.getContext('2d')
  if (!context) return

  if (mask) {
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = mask.width
    maskCanvas.height = mask.height
    const maskContext = maskCanvas.getContext('2d')
    if (maskContext) {
      const pixels = maskContext.createImageData(mask.width, mask.height)
      for (let index = 0; index < mask.data.length; index += 1) {
        if (mask.data[index] === 0) continue
        pixels.data[index * 4] = 53
        pixels.data[index * 4 + 1] = 211
        pixels.data[index * 4 + 2] = 196
        pixels.data[index * 4 + 3] = 105
      }
      maskContext.putImageData(pixels, 0, 0)
      context.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height)
    }
  }

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
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null)
  const [mask, setMask] = useState<SilhouetteMask | null>(null)
  const [strokes, setStrokes] = useState<SelectionStroke[]>([])
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [output, setOutput] = useState<QuickScanOutput | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('写真を選択してください。')
  const [error, setError] = useState('')

  useEffect(() => {
    if (photo && photoRef.current) {
      photoRef.current.width = photo.width
      photoRef.current.height = photo.height
      photoRef.current.getContext('2d')?.drawImage(photo, 0, 0)
    }
    if (photo && overlayRef.current) drawOverlay(overlayRef.current, photo, mask, strokes, draftRef.current)
  }, [photo, mask, strokes])

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError('')
    setOutput(null)
    setMask(null)
    setStrokes([])
    setPhoto(null)
    setStatus('写真を読み込んでいます…')
    try {
      const canvas = await loadPhoto(file)
      setPhoto(canvas)
      setStatus('領域分割モデルを読み込んでいます…')
      await setPhotoForSegmentation(canvas)
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
    if (photo && overlayRef.current) drawOverlay(overlayRef.current, photo, mask, strokes, draftRef.current)
  }

  const finishStroke = async () => {
    const draft = draftRef.current
    draftRef.current = null
    if (!draft || !photo) return
    const next = [...strokes, draft]
    setStrokes(next)
    setBusy(true)
    setError('')
    setOutput(null)
    setStatus('対象物を切り出しています…')
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    try {
      const nextMask = await segmentPhoto(next)
      if (!nextMask.data.some((value) => value !== 0)) throw new Error('対象物が見つかりません。指定をやり直してください。')
      setMask(nextMask)
      setStatus('Maskを確認し、必要なら追加・除外してください。')
    } catch (cause) {
      setMask(null)
      setError(cause instanceof Error ? cause.message : '領域分割に失敗しました。')
      setStatus('指定をやり直してください。')
    } finally {
      setBusy(false)
    }
  }

  const generate = () => {
    if (!mask) return
    setError('')
    try {
      setOutput(reconstructQuickScanWithMetrics(mask))
      setStatus('モデルを生成しました。ドラッグでモデルを回転、ホイールでモデルを拡大できます。')
    } catch (cause) {
      setOutput(null)
      setError(cause instanceof Error ? cause.message : '3Dモデルを生成できませんでした。')
    }
  }

  const reset = () => {
    setStrokes([])
    setMask(null)
    setOutput(null)
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
          <button type="button" className="photo-model-primary" disabled={busy || !mask} onClick={generate}>3Dモデルを生成</button>
        </>}
      </section>

      <p className="photo-model-status" role="status">{busy ? '処理中 · ' : ''}{status}</p>
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
