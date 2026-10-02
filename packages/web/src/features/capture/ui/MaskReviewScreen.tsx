import { useState } from 'react'
import { assignScanDirections, SCAN_DIRECTIONS, type ControlMessage, type ScanDirection, type SelectionStroke } from '@gikcamp/protocol'
import { PhoneStage } from '../../../components/PhoneStage'
import type { PlayerId } from '../../../../../../docs/design/tokens'
import { StrokeEditor } from './StrokeEditor'
import type { CapturedScan } from './CaptureScreen'
import './capture.css'

export type ReviewMask = { info?: Extract<ControlMessage, { type: 'mask-ready' }>; url?: string;
  transferId: string; revision: number; strokes: SelectionStroke[]; dirty: boolean; requestedRevision: number }
export function MaskReviewScreen({ player, scan, masks, busy, message, onStrokes, onRevise, onConfirm, onRetry, onResend }:
  { player: PlayerId; scan: CapturedScan; masks: Partial<Record<ScanDirection, ReviewMask>>; busy: boolean; message: string;
    onStrokes: (direction: ScanDirection, strokes: SelectionStroke[]) => void; onRevise: (direction: ScanDirection) => void;
    onConfirm: () => void; onRetry: () => void; onResend: () => void }) {
  const [active, setActive] = useState<ScanDirection>('front')
  const assignments = assignScanDirections(scan.photos.map((photo) => photo.id), scan.frontPhotoId)
  const photo = scan.photos.find((value) => value.id === assignments[active])!
  const current = masks[active]
  const labels: Record<ScanDirection, string> = { front: '正面', right: '右', back: '背面', left: '左' }
  const ready = !busy && SCAN_DIRECTIONS.every((direction) => {
    const mask = masks[direction]
    return mask?.url && mask.info && !mask.info.empty && !mask.dirty && mask.revision === mask.requestedRevision
  })
  return <PhoneStage player={player} className="capture capture-live">
    <header className="capture-live__header"><strong>4方向を たしかめてね</strong><span>みどりが対象。失敗した写真だけ「ぬる／けす」で直せるよ</span></header>
    {message && <p className="capture-live__error" role="alert">{message}</p>}
    <nav className="capture-review__tabs" aria-label="撮影方向">{SCAN_DIRECTIONS.map((direction) => <button type="button" key={direction} aria-pressed={active === direction} onClick={() => setActive(direction)}>
      {labels[direction]} {masks[direction]?.info?.needsReview ? '· 要確認' : masks[direction]?.url ? '✓' : '…'}</button>)}</nav>
    <StrokeEditor photoUrl={photo.url} maskUrl={current?.url} strokes={current?.strokes ?? []}
      onChange={(strokes) => onStrokes(active, strokes)} disabled={busy} />
    <footer className="capture-live__footer"><span>{current?.info?.reason || (busy ? 'PCで かいせきちゅう…' : '対象が合っているか見てね')}</span>
      <button type="button" disabled={busy || !current?.dirty || !current.strokes.length || current.requestedRevision !== current.revision} onClick={() => onRevise(active)}>この写真を なおす</button>
      {message && <button type="button" disabled={busy} onClick={onResend}>マスクを おくりなおす</button>}
      <button type="button" disabled={!ready} onClick={onConfirm}>これで けってい!</button>
      <button type="button" disabled={busy} onClick={onRetry}>4枚 とりなおす</button></footer>
  </PhoneStage>
}
