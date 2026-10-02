import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { SelectionStroke } from '@gikcamp/protocol'

/** 写真と同じ縦横比のCanvas上で正規化座標のストロークを描く。 */
export function StrokeEditor({ photoUrl, maskUrl, strokes, onChange, disabled = false }:
  { photoUrl: string; maskUrl?: string; strokes: SelectionStroke[]; onChange: (strokes: SelectionStroke[]) => void; disabled?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const draft = useRef<SelectionStroke | null>(null)
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [tick, setTick] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    const photo = new Image(), mask = new Image()
    const loaded = (image: HTMLImageElement, src: string) => new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error('画像を表示できませんでした。')); image.src = src
    })
    void Promise.all([loaded(photo, photoUrl), maskUrl ? loaded(mask, maskUrl) : Promise.resolve()]).then(() => {
      if (cancelled || !ref.current) return
      const canvas = ref.current
      canvas.width = photo.naturalWidth; canvas.height = photo.naturalHeight
      const context = canvas.getContext('2d')!
      context.drawImage(photo, 0, 0)
      if (maskUrl) {
        const overlay = document.createElement('canvas'); overlay.width = canvas.width; overlay.height = canvas.height
        const overlayContext = overlay.getContext('2d')!
        overlayContext.drawImage(mask, 0, 0, canvas.width, canvas.height)
        const pixels = overlayContext.getImageData(0, 0, canvas.width, canvas.height)
        for (let i = 0; i < pixels.data.length; i += 4) {
          const selected = pixels.data[i] >= 128
          pixels.data.set([0, 255, 174, selected ? 100 : 0], i)
        }
        overlayContext.putImageData(pixels, 0, 0); context.drawImage(overlay, 0, 0)
      }
      for (const stroke of [...strokes, ...(draft.current ? [draft.current] : [])]) {
        context.strokeStyle = stroke.mode === 'add' ? '#00ffae' : '#ff6655'; context.fillStyle = context.strokeStyle
        context.lineWidth = Math.max(6, canvas.width / 100); context.lineCap = 'round'; context.lineJoin = 'round'; context.beginPath()
        stroke.points.forEach((point, index) => index ? context.lineTo(point.x * canvas.width, point.y * canvas.height) : context.moveTo(point.x * canvas.width, point.y * canvas.height))
        if (stroke.points.length === 1) { const point = stroke.points[0]; context.arc(point.x * canvas.width, point.y * canvas.height, context.lineWidth / 2, 0, Math.PI * 2); context.fill() }
        else context.stroke()
      }
      setError('')
    }).catch((cause: Error) => { if (!cancelled) setError(cause.message) })
    return () => { cancelled = true }
  }, [photoUrl, maskUrl, strokes, tick])
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }
  return <div className="capture-editor">
    <div className="capture-editor__tools">
      <button type="button" disabled={disabled} aria-pressed={mode === 'add'} onClick={() => setMode('add')}>ぬる</button>
      <button type="button" disabled={disabled} aria-pressed={mode === 'remove'} onClick={() => setMode('remove')}>けす</button>
      <button type="button" disabled={disabled || !strokes.length} onClick={() => onChange(strokes.slice(0, -1))}>ひとつ もどす</button>
    </div>
    <div className="capture-editor__image"><canvas ref={ref} aria-label="対象をぬる・けす写真" onPointerDown={(event) => {
      if (disabled || strokes.length >= 256) return
      event.currentTarget.setPointerCapture(event.pointerId); draft.current = { mode, points: [point(event)] }; setTick((value) => value + 1)
    }} onPointerMove={(event) => {
      if (!draft.current || draft.current.points.length >= 4096) return
      draft.current.points.push(point(event)); setTick((value) => value + 1)
    }} onPointerUp={() => {
      if (!draft.current) return
      const next = [...strokes, draft.current]; draft.current = null; onChange(next); setTick((value) => value + 1)
    }} onPointerCancel={() => { draft.current = null; setTick((value) => value + 1) }} /></div>
    {error && <p role="alert">{error}</p>}
  </div>
}
