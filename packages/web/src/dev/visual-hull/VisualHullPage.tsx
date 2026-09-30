import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { createFixedCamera, VOXEL_SIDE } from '@gikcamp/reconstruction-wasm'
import type { SilhouetteMask, VisualHullOutput } from '@gikcamp/reconstruction-wasm'
import type { GeometryResult } from '@gikcamp/geometry-wasm'
import { loadPhoto, segmentPhoto, setPhotoForSegmentation } from '../../features/capture/pipeline/photoSegmenter'
import type { SelectionStroke } from '../../features/capture/pipeline/photoSegmenter'
import type { VisualHullResponse } from '../../features/analyze/reconstruction/visualHullWorkerTypes'
import type { ReconstructionResult } from '../../features/analyze/reconstruction/types'
import './visualHull.css'

const DIRECTIONS = [
  { label: '正面', yaw: 0, required: true },
  { label: '右前', yaw: 45, required: false },
  { label: '右', yaw: 90, required: true },
  { label: '右後', yaw: 135, required: false },
  { label: '背面', yaw: 180, required: true },
  { label: '左後', yaw: 225, required: false },
  { label: '左', yaw: 270, required: true },
  { label: '左前', yaw: 315, required: false },
] as const

type Frame = { photo: HTMLCanvasElement | null; mask: SilhouetteMask | null; strokes: SelectionStroke[]; yaw: number }
const initialFrames = (): Frame[] => DIRECTIONS.map((value) => ({ photo: null, mask: null, strokes: [], yaw: value.yaw }))

function ModelPreview({ reconstruction, onError }: { reconstruction: ReconstructionResult; onError: (message: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    let dispose: (() => void) | undefined
    void import('../../lib/babylon/reconstructionPreview').then(({ mountReconstructionPreview }) => {
      if (!cancelled && ref.current) dispose = mountReconstructionPreview(ref.current, reconstruction)
    }).catch((cause: unknown) => { if (!cancelled) onError(cause instanceof Error ? cause.message : '3D表示に失敗しました。') })
    return () => { cancelled = true; dispose?.() }
  }, [reconstruction, onError])
  return <canvas ref={ref} className="visual-hull-preview" aria-label="Visual Hull 3Dプレビュー" />
}

function drawProjection(context: CanvasRenderingContext2D, frame: Frame) {
  if (!frame.mask || !frame.photo) return
  const camera = createFixedCamera(frame.mask.width, frame.mask.height, frame.yaw)
  const project = (x: number, y: number, z: number) => {
    const R = camera.rotation, t = camera.translation, K = camera.intrinsics
    const cx = R[0] * x + R[1] * y + R[2] * z + t[0]
    const cy = R[3] * x + R[4] * y + R[5] * z + t[1]
    const cz = R[6] * x + R[7] * y + R[8] * z + t[2]
    return { x: (K[0] * cx / cz + K[2]) * frame.photo!.width / frame.mask!.width,
      y: (K[4] * cy / cz + K[5]) * frame.photo!.height / frame.mask!.height }
  }
  const corners = [-0.5, 0.5].flatMap((x) => [-0.5, 0.5].flatMap((y) => [-0.5, 0.5].map((z) => project(x, y, z))))
  context.strokeStyle = '#ffdc65'
  context.lineWidth = Math.max(2, frame.photo.width / 500)
  for (let a = 0; a < 8; a += 1) for (let b = a + 1; b < 8; b += 1) {
    if ((a ^ b) !== 1 && (a ^ b) !== 2 && (a ^ b) !== 4) continue
    context.beginPath(); context.moveTo(corners[a].x, corners[a].y); context.lineTo(corners[b].x, corners[b].y); context.stroke()
  }
}

export default function VisualHullPage() {
  const [frames, setFrames] = useState<Frame[]>(initialFrames)
  const [active, setActive] = useState(0)
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('正面から順に写真を読み込んでください。')
  const [error, setError] = useState('')
  const [output, setOutput] = useState<VisualHullOutput | null>(null)
  const [geometry, setGeometry] = useState<GeometryResult | null>(null)
  const [slice, setSlice] = useState(VOXEL_SIDE / 2)
  const imageRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const sliceRef = useRef<HTMLCanvasElement>(null)
  const draftRef = useRef<SelectionStroke | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const operationRef = useRef(0)
  const current = frames[active]

  useEffect(() => () => workerRef.current?.terminate(), [])
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
      drawProjection(context, current)
    }
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
  }, [current])
  useEffect(() => {
    if (!output || !sliceRef.current) return
    const canvas = sliceRef.current; canvas.width = canvas.height = VOXEL_SIDE
    const context = canvas.getContext('2d'); if (!context) return
    const pixels = context.createImageData(VOXEL_SIDE, VOXEL_SIDE)
    for (let index = 0; index < VOXEL_SIDE ** 2; index += 1) {
      const value = output.occupancy[slice * VOXEL_SIDE ** 2 + index]
      pixels.data[index * 4] = value ? 80 : 19
      pixels.data[index * 4 + 1] = value ? 222 : 32
      pixels.data[index * 4 + 2] = value ? 185 : 49
      pixels.data[index * 4 + 3] = 255
    }
    context.putImageData(pixels, 0, 0)
  }, [output, slice])

  const changeFrame = (index: number, update: Partial<Frame>) => {
    setFrames((previous) => previous.map((frame, i) => i === index ? { ...frame, ...update } : frame))
    setOutput(null); setGeometry(null)
  }
  const selectFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setError('')
    try {
      const photo = await loadPhoto(file)
      changeFrame(active, { photo, mask: null, strokes: [] })
      setStatus(`${DIRECTIONS[active].label}の対象物を緑で指定してください。`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '写真を読み込めませんでした。') }
    finally { setBusy(false) }
  }
  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }
  const finishStroke = async () => {
    const draft = draftRef.current; draftRef.current = null
    if (!draft || !current.photo) return
    const index = active, photo = current.photo, strokes = [...current.strokes, draft]
    const operation = ++operationRef.current
    setBusy(true); setError(''); setStatus(`${DIRECTIONS[index].label}のMaskを生成しています…`)
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
      await setPhotoForSegmentation(photo, 1024)
      const mask = await segmentPhoto(strokes)
      if (!mask.data.some((value) => value)) throw new Error('対象物が見つかりません。')
      if (operation !== operationRef.current) return
      changeFrame(index, { strokes, mask })
      setStatus(`${DIRECTIONS[index].label}のMaskを確認し、必要なら追加・除外してください。`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Maskを作れませんでした。') }
    finally { setBusy(false) }
  }
  const generate = () => {
    const missing = DIRECTIONS.findIndex((direction, index) => direction.required && !frames[index].mask)
    if (missing >= 0) { setError(`${DIRECTIONS[missing].label}のMaskが必要です。`); return }
    if (frames.some((frame) => frame.photo && !frame.mask)) { setError('読み込んだ写真はすべてMaskを確認してください。'); return }
    const views = frames.filter((frame): frame is Frame & { mask: SilhouetteMask } => frame.mask !== null)
      .map((frame) => ({ mask: frame.mask, camera: createFixedCamera(frame.mask.width, frame.mask.height, frame.yaw) }))
    setBusy(true); setError(''); setOutput(null); setGeometry(null)
    setStatus('96³ Voxelの再構成と形状解析を実行しています…')
    workerRef.current?.terminate()
    const worker = new Worker(new URL('../../features/analyze/reconstruction/visualHull.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const id = ++operationRef.current
    worker.onmessage = (event: MessageEvent<VisualHullResponse>) => {
      if (event.data.id !== id) return
      if ('error' in event.data) setError(event.data.error)
      else { setOutput(event.data.output); setGeometry(event.data.geometry); if (event.data.geometryError) setError(`形状解析: ${event.data.geometryError}`); setStatus('Visual Hullを生成しました。モデルをドラッグで回転できます。') }
      setBusy(false); worker.terminate(); workerRef.current = null
    }
    worker.onerror = () => { setError('再構成Workerを起動できませんでした。'); setBusy(false); worker.terminate(); workerRef.current = null }
    worker.postMessage({ id, views })
  }

  return <main className="visual-hull-page">
    <header><a href="/dev/photo-model">Quick Scanへ</a><p>ISSUE #32 · VISUAL HULL</p><h1>複数方向の写真から立体を作る</h1>
      <p>正面・右・背面・左の4方向が必須です。斜め4方向を加えると形を比較できます。対象物を中央に置き、カメラの高さと距離をそろえて撮影してください。</p></header>
    <nav className="visual-hull-directions" aria-label="撮影方向">{DIRECTIONS.map((direction, index) => <button type="button" key={direction.label}
      className={active === index ? 'active' : ''} disabled={busy} onClick={() => { draftRef.current = null; setActive(index); setMode('add') }}>
      {direction.label}{direction.required ? ' *' : ''}<small>{frames[index].mask ? 'Mask完了' : frames[index].photo ? '指定待ち' : '写真なし'}</small></button>)}</nav>
    <section className="visual-hull-toolbar">
      <label>写真を選択 <input type="file" accept="image/*" disabled={busy} onChange={(event) => { void selectFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} /></label>
      <label>方位角 <input type="number" min="0" max="359" value={current.yaw} disabled={busy} onChange={(event) => changeFrame(active, { yaw: Number(event.currentTarget.value) })} />°</label>
      <button type="button" disabled={busy || !current.photo} onClick={() => setMode('add')} aria-pressed={mode === 'add'}>追加</button>
      <button type="button" disabled={busy || !current.photo} onClick={() => setMode('remove')} aria-pressed={mode === 'remove'}>除外</button>
      <button type="button" disabled={busy || !current.photo} onClick={() => changeFrame(active, { strokes: [], mask: null })}>指定をやり直す</button>
      <button type="button" className="primary" disabled={busy} onClick={generate}>Visual Hullを生成</button>
    </section>
    <p role="status">{busy ? '処理中 · ' : ''}{status}</p>{error && <p className="visual-hull-error" role="alert">{error}</p>}
    <div className="visual-hull-columns">
      <section className="visual-hull-panel"><h2>{DIRECTIONS[active].label} · 写真とMask</h2>
        {current.photo ? <div className="visual-hull-image-wrap"><canvas ref={imageRef} aria-label="選択した写真" />
          <canvas ref={overlayRef} aria-label="対象を指定する" onPointerDown={(event) => { if (busy) return; event.currentTarget.setPointerCapture(event.pointerId); draftRef.current = { mode, points: [point(event)] }; setFrames((old) => old.map((frame, index) => index === active ? { ...frame } : frame)) }}
            onPointerMove={(event) => { if (!draftRef.current || busy) return; const next = point(event); const last = draftRef.current.points.at(-1)!; if (Math.hypot(next.x - last.x, next.y - last.y) < 0.003) return; draftRef.current = { ...draftRef.current, points: [...draftRef.current.points, next] }; setFrames((old) => old.map((frame, index) => index === active ? { ...frame } : frame)) }}
            onPointerUp={() => { void finishStroke() }} onPointerCancel={() => { draftRef.current = null; setFrames((old) => old.map((frame, index) => index === active ? { ...frame } : frame)) }} /></div>
          : <p>この方向の写真を選んでください。</p>}
        <p>緑: 対象を追加 / 赤: 背景を除外 / 黄: 仮の投影範囲</p>
      </section>
      <section className="visual-hull-panel"><h2>3Dモデルと解析結果</h2>
        {output ? <ModelPreview reconstruction={output.reconstruction} onError={setError} /> : <div className="visual-hull-placeholder">4〜8方向のMaskをそろえて生成してください。</div>}
        {output && <><p>占有Voxel {output.metrics.voxelCount.toLocaleString()} / 頂点 {output.metrics.vertexCount.toLocaleString()} / 三角形 {output.metrics.triangleCount.toLocaleString()} / 再構成 {output.metrics.carvingAndMeshMs.toFixed(0)} ms</p>
          <label>Voxel断面 z={slice} <input type="range" min="0" max="95" value={slice} onChange={(event) => setSlice(Number(event.currentTarget.value))} /></label>
          <canvas ref={sliceRef} className="visual-hull-slice" aria-label="Voxel断面" /></>}
        {geometry && <p>暫定能力値: HP {geometry.stats.hp} / 攻撃 {geometry.stats.attack} / リーチ {geometry.stats.reach} / 旋回 {geometry.stats.turnSpeed} / 移動 {geometry.stats.moveSpeed}<br />体積 {geometry.volume.toFixed(3)} / 3D凸包 {geometry.hullIndices.length / 3}面 / 重心 {geometry.centerOfMass.map((v) => v.toFixed(2)).join(', ')}（{geometry.statsVersion}）</p>}
      </section>
    </div>
  </main>
}
