import { useEffect, useRef, useState } from 'react'
import { assignScanDirections, SCAN_DIRECTIONS, type ScanDirection, type SelectionStroke } from '@gikcamp/protocol'
import { PhoneStage } from '../../../components/PhoneStage'
import { StrokeEditor } from './StrokeEditor'
import { players, type PlayerId } from '../../../../../../docs/design/tokens'
import './capture.css'

export type CapturedPhoto = { id: string; blob: Blob; width: number; height: number; url: string }
export type CapturedScan = { scanId: string; photos: CapturedPhoto[]; frontPhotoId: string; strokes: SelectionStroke[] }
type Props = { player: PlayerId; onSendScan: (scan: CapturedScan, onProgress: (ratio: number) => void) => Promise<void>;
  onSubmitted: (scan: CapturedScan) => void; initialScan?: CapturedScan; message?: string }

/** 4枚を撮影し、正面を選んで対象をストローク指定する本番スキャン画面。 */
export function CaptureScreen({ player, onSendScan, onSubmitted, initialScan, message }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [photos, setPhotos] = useState<CapturedPhoto[]>(initialScan?.photos ?? [])
  const [front, setFront] = useState(initialScan?.frontPhotoId ?? '')
  const [strokes, setStrokes] = useState<SelectionStroke[]>(initialScan?.strokes ?? [])
  const [phase, setPhase] = useState<'shoot' | 'choose' | 'select' | 'sending'>(initialScan ? 'select' : 'shoot')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState(0)
  const [shooting, setShooting] = useState(false)
  const mounted = useRef(true)
  const cameraSupported = !!navigator.mediaDevices?.getUserMedia
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (phase !== 'shoot') return
    let cancelled = false, stream: MediaStream | undefined
    if (!cameraSupported) return
    void navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then((value) => {
      if (cancelled) { value.getTracks().forEach((track) => track.stop()); return }
      stream = value; if (videoRef.current) videoRef.current.srcObject = value
    }).catch(() => { if (!cancelled) setError('カメラの許可を確認してください。') })
    return () => { cancelled = true; stream?.getTracks().forEach((track) => track.stop()) }
  }, [phase, cameraSupported])
  const shutter = async () => {
    const video = videoRef.current
    if (!video?.videoWidth || shooting) return
    setShooting(true)
    try {
      const scale = Math.min(1, 2048 / Math.max(video.videoWidth, video.videoHeight))
      const canvas = document.createElement('canvas'); canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale)
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('写真を作れませんでした。')), 'image/jpeg', 0.85))
      if (!mounted.current) return
      const next = [...photos, { id: crypto.randomUUID(), blob, width: canvas.width, height: canvas.height, url: canvas.toDataURL('image/jpeg', 0.85) }]
      setPhotos(next); setError('')
      if (next.length === 4) setPhase('choose')
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '撮影できませんでした。') }
    finally { if (mounted.current) setShooting(false) }
  }
  const send = async () => {
    if (photos.length !== 4 || !front || !strokes.some((stroke) => stroke.mode === 'add')) return
    const scan = { scanId: crypto.randomUUID(), photos, frontPhotoId: front, strokes }
    setPhase('sending'); setError(''); setProgress(0)
    try { await onSendScan(scan, setProgress); if (mounted.current) onSubmitted(scan) }
    catch (cause) { if (mounted.current) { setError(cause instanceof Error ? cause.message : '送信できませんでした。'); setPhase('select') } }
  }
  const selected = photos.find((photo) => photo.id === front)
  const assignments = front && photos.length === 4 ? assignScanDirections(photos.map((photo) => photo.id), front) : null
  const labels: Record<ScanDirection, string> = { front: '正面', right: '右', back: '背面', left: '左' }
  const phaseText = phase === 'shoot' ? `写真 ${photos.length + 1} / 4` : phase === 'choose' ? '正面を えらんでね' : '対象を ぬってね'
  // 見本：docs/design/screens/phone-02-scan.html（左に写真、右にプレイヤー色のパネルとボタン）
  return <PhoneStage player={player} className="capture capture-shot">
    <div className="capture-shot__main">
      {phase === 'shoot' && <>
        <video className="capture-shot__video" ref={videoRef} autoPlay playsInline muted />
        <div className="capture__guide" aria-hidden="true" />
        <p className="capture-shot__tips">あかるく · 1こだけ · まるごと</p>
      </>}
      {phase === 'choose' && <div className="capture-shot__photos">{photos.map((photo, index) => <button type="button" className="capture-shot__photo" key={photo.id} onClick={() => {
        setFront(photo.id); setStrokes([]); setPhase('select')
      }}><img src={photo.url} alt={`写真 ${index + 1}`} /><span>これを正面にする</span></button>)}</div>}
      {(phase === 'select' || phase === 'sending') && selected &&
        <StrokeEditor photoUrl={selected.url} strokes={strokes} onChange={setStrokes} disabled={phase === 'sending'} />}
      <header className="capture-shot__header">
        <strong className="ss-display capture-shot__phase">{phaseText}</strong>
        <span className="capture-shot__hint">高さと距離をそろえ、対象を右・背面・左へ回してね</span>
        {(error || message || !cameraSupported) && <p className="capture-shot__error" role="alert">{error || message || 'カメラを使えません。HTTPSで開いてください。'}</p>}
      </header>
      {phase === 'sending' && <div className="capture__sending" role="status"><div className="ss-display capture__sending-title">おくってるよ… {Math.round(progress * 100)}%</div>
        <progress className="capture-shot__progress" value={progress} max={1} /></div>}
    </div>
    <aside className="capture-shot__side">
      <div className="ss-display phone-ol-s capture-shot__player">{players[player].label}</div>
      {phase === 'shoot' && <>
        <button type="button" className="capture-shot__shutter" onClick={() => void shutter()} disabled={shooting}>
          <span className="capture__shutter-ring" aria-hidden="true" /><span className="ss-display capture-shot__shutter-label">パシャ!</span>
        </button>
        {photos.length > 0 && <button type="button" className="capture-shot__action" onClick={() => setPhotos(photos.slice(0, -1))}>前の写真を とりなおす</button>}
      </>}
      {(phase === 'select' || phase === 'sending') && selected && <>
        <button type="button" className="capture-shot__ok" disabled={phase === 'sending' || !strokes.some((stroke) => stroke.mode === 'add')} onClick={() => void send()}>{error ? '4枚を おくりなおす' : '4枚を おくる'}</button>
        <button type="button" className="capture-shot__action" disabled={phase === 'sending'} onClick={() => setPhase('choose')}>正面を えらびなおす</button>
        <button type="button" className="capture-shot__action" disabled={phase === 'sending'} onClick={() => { setPhotos([]); setStrokes([]); setFront(''); setPhase('shoot') }}>4枚 とりなおす</button>
        <span className="capture-shot__assign">{assignments && SCAN_DIRECTIONS.map((direction) => `${labels[direction]}: ${photos.findIndex((photo) => photo.id === assignments[direction]) + 1}`).join(' / ')}</span>
      </>}
    </aside>
  </PhoneStage>
}
