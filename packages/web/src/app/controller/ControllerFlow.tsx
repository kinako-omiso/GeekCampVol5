import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { assignScanDirections, SCAN_DIRECTIONS, type ControlMessage, type ScanDirection, type SelectionStroke } from '@gikcamp/protocol'
import { CaptureScreen, type CapturedScan } from '../../features/capture/ui/CaptureScreen'
import { MaskReviewScreen, type ReviewMask } from '../../features/capture/ui/MaskReviewScreen'
import { JoinScreen } from '../../features/join/JoinScreen'
import { PadScreen } from '../../features/pad/PadScreen'
import { RematchScreen } from '../../features/rematch/RematchScreen'
import { PhoneStage } from '../../components/PhoneStage'
import { ControllerPeerSession } from '../../lib/peer/controllerPeerSession'
import { parseControllerPairing } from '../../lib/peer/pairing'
import { createTiltNormalizer, getScreenAngle, subscribeOrientation, type Baseline } from '../../lib/sensor'
import type { PlayerId } from '../../../../../docs/design/tokens'
import '../../../../../docs/design/tokens.css'
import './controller.css'

type Flow = Extract<ControlMessage, { type: 'flow-state' }>
export function ControllerFlow() {
  const [searchParams] = useSearchParams(), query = searchParams.toString()
  const pairing = parseControllerPairing(new URLSearchParams(query))
  const player: PlayerId = pairing?.metadata.slot === 1 ? 'p1' : 'p2'
  const [connected, setConnected] = useState(false)
  const [message, setMessage] = useState('PCに接続しています')
  const [flow, setFlow] = useState<Flow | null>(null)
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const baselineRef = useRef<Baseline | null>(null)
  const roundRef = useRef('')
  const sessionRef = useRef<ControllerPeerSession | null>(null)
  const [scan, setScan] = useState<CapturedScan | null>(null)
  const scanRef = useRef<CapturedScan | null>(null)
  const [masks, setMasks] = useState<Partial<Record<ScanDirection, ReviewMask>>>({})
  const masksRef = useRef(masks)
  const maskUrls = useRef(new Set<string>())
  const [captureKey, setCaptureKey] = useState(0)
  const [feedback, setFeedback] = useState(0)
  const [sensorWarning, setSensorWarning] = useState('')
  const clearMasks = () => {
    for (const url of maskUrls.current) URL.revokeObjectURL(url)
    maskUrls.current.clear(); masksRef.current = {}; setMasks({})
  }
  const changeMasks = (next: Partial<Record<ScanDirection, ReviewMask>>) => { masksRef.current = next; setMasks(next) }

  useEffect(() => {
    const parsed = parseControllerPairing(new URLSearchParams(query))
    if (!parsed) return
    const urls = maskUrls.current
    const session = new ControllerPeerSession(parsed.hostPeerId, parsed.metadata, {
      connected: () => {
        setConnected(true); setMessage('')
        if (baselineRef.current) session.sendControl({ type: 'sensor-ready' })
      },
      rejected: (reason) => { setConnected(false); setMessage(reason) },
      disconnected: () => { setConnected(false); setMessage('PCに つなぎなおしています…') },
      error: (error) => setMessage(error.message),
      controlReceived: (control) => {
        if (control.type === 'flow-state') {
          if (roundRef.current && roundRef.current !== control.roundId) {
            scanRef.current = null; setScan(null); clearMasks(); setCaptureKey((value) => value + 1)
            // 再戦では基準姿勢を保持し、ロビーへ戻ったときだけ取得し直す。
            if (control.phase === 'join') {
              baselineRef.current = null; setBaseline(null)
              session.sendControl({ type: 'sensor-reset' })
            }
          }
          roundRef.current = control.roundId
          if (control.phase === 'capture' && !control.scanId && scanRef.current) {
            scanRef.current = null; setScan(null); clearMasks(); setCaptureKey((value) => value + 1)
          }
          setFlow(control)
        } else if (control.type === 'mask-ready' && control.scanId === scanRef.current?.scanId) {
          const current = masksRef.current[control.direction]
          if (current && current.revision > control.revision) return
          const same = current?.transferId === control.transferId
          const preserveDraft = current?.dirty && current.revision === control.revision && current.requestedRevision === control.revision
          changeMasks({ ...masksRef.current, [control.direction]: { transferId: control.transferId, revision: control.revision,
            info: control, url: same ? current.url : undefined, strokes: preserveDraft ? current.strokes : control.strokes, dirty: !!preserveDraft,
            requestedRevision: Math.max(control.revision, current?.requestedRevision ?? 0) } })
        } else if (control.type === 'scan-revision-failed' && control.scanId === scanRef.current?.scanId) {
          const current = masksRef.current[control.direction]
          if (current?.requestedRevision === control.revision) changeMasks({ ...masksRef.current,
            [control.direction]: { ...current, requestedRevision: current.revision, dirty: true } })
        } else if (control.type === 'feedback') {
          const pattern = control.effect === 'hit' ? 30 : control.effect === 'damage' ? 60 : [60, 40, 120]
          const vibrated = navigator.vibrate?.(pattern)
          setFeedback((value) => value + 1)
          if (!vibrated) playFeedback(control.effect)
        }
      },
      assetReceived: (manifest, blob) => {
        if (manifest.kind !== 'mask' || !manifest.scan || manifest.scan.scanId !== scanRef.current?.scanId) return
        const { direction, revision } = manifest.scan
        const previous = masksRef.current[direction]
        if (previous && previous.revision > revision) return
        if (previous?.url) { URL.revokeObjectURL(previous.url); urls.delete(previous.url) }
        const url = URL.createObjectURL(blob); urls.add(url)
        const same = previous?.transferId === manifest.transferId
        changeMasks({ ...masksRef.current, [direction]: { transferId: manifest.transferId, revision,
          url, info: same ? previous.info : undefined, strokes: same ? previous.strokes : [],
          dirty: same ? previous.dirty : false, requestedRevision: same ? previous.requestedRevision : revision } })
      },
    })
    sessionRef.current = session
    return () => { session.destroy(); sessionRef.current = null; for (const url of urls) URL.revokeObjectURL(url); urls.clear() }
  }, [query])

  useEffect(() => {
    if (!baseline || !connected) return
    const normalize = createTiltNormalizer(baseline)
    let latest = { x: 0, y: 0 }, lastSampleAt = 0
    const unsubscribe = subscribeOrientation((sample) => {
      const motion = normalize(sample, getScreenAngle())
      if (!motion) {
        latest = { x: 0, y: 0 }; baselineRef.current = null; setBaseline(null)
        sessionRef.current?.sendControl({ type: 'sensor-reset' })
        setSensorWarning('横持ちの向きが変わりました。基準をとりなおしてね。'); return
      }
      latest = motion; lastSampleAt = performance.now(); setSensorWarning('')
    })
    const timer = setInterval(() => sessionRef.current?.sendMotion(performance.now() - lastSampleAt < 250 ? latest : { x: 0, y: 0 }), 1000 / 30)
    return () => { clearInterval(timer); unsubscribe() }
  }, [baseline, connected])

  if (!pairing) return <main><h1>PCに接続</h1><p>PCに表示されたQRコードから開いてください。</p></main>
  if (!connected || !flow) return <main><h1>PCに接続</h1><p role="status">{message || '進み具合を確認しています…'}</p></main>
  const sendScan = async (next: CapturedScan, onProgress: (ratio: number) => void) => {
    const session = sessionRef.current
    if (!session) throw new Error('PCと接続されていません。')
    scanRef.current = next; setScan(next); clearMasks()
    session.sendControl({ type: 'scan-start', scanId: next.scanId, photoIds: next.photos.map((photo) => photo.id), frontPhotoId: next.frontPhotoId, strokes: next.strokes })
    const directions = assignScanDirections(next.photos.map((photo) => photo.id), next.frontPhotoId)
    for (let index = 0; index < next.photos.length; index += 1) {
      const photo = next.photos[index], direction = SCAN_DIRECTIONS.find((value) => directions[value] === photo.id)!
      await session.sendPhoto(photo.blob, photo, (ratio) => onProgress((index + ratio) / 4), { scanId: next.scanId, photoId: photo.id, direction, revision: 0 })
    }
  }
  const onStrokes = (direction: ScanDirection, strokes: SelectionStroke[]) => {
    const current = masksRef.current[direction]
    if (!current) return
    changeMasks({ ...masksRef.current, [direction]: { ...current, strokes, dirty: true } })
  }
  return <>
    {(flow.phase === 'join' || !baseline) && <JoinScreen key={flow.roundId} player={player}
      onInteraction={unlockFeedback}
      onSensorEnabled={() => sessionRef.current?.sendControl({ type: 'sensor-enabled' })}
      onCalibrated={(value) => { baselineRef.current = value; setBaseline(value); setSensorWarning(''); sessionRef.current?.sendControl({ type: 'sensor-ready' }) }} />}
    {baseline && flow.phase === 'capture' && <CaptureScreen key={captureKey} player={player} initialScan={scan ?? undefined} message={flow.message}
      onSendScan={sendScan} onSubmitted={(value) => { scanRef.current = value; setScan(value) }} />}
    {baseline && scan && (flow.phase === 'processing' || flow.phase === 'review') && <MaskReviewScreen player={player} scan={scan} masks={masks}
      busy={flow.phase === 'processing' || Object.values(masks).some((mask) => mask.requestedRevision > mask.revision)} message={flow.message} onStrokes={onStrokes}
      onRevise={(direction) => {
        const current = masksRef.current[direction]!
        const revision = current.revision + 1
        changeMasks({ ...masksRef.current, [direction]: { ...current, requestedRevision: revision } })
        sessionRef.current?.sendControl({ type: 'scan-revise', scanId: scan.scanId, direction, revision, strokes: current.strokes })
      }} onConfirm={() => sessionRef.current?.sendControl({ type: 'scan-confirm', scanId: scan.scanId,
        revisions: SCAN_DIRECTIONS.map((direction) => masks[direction]!.revision) as [number, number, number, number] })}
      onRetry={() => sessionRef.current?.sendControl({ type: 'scan-retry', scanId: scan.scanId })}
      onResend={() => sessionRef.current?.sendControl({ type: 'scan-resend-masks', scanId: scan.scanId })} />}
    {baseline && flow.phase === 'waiting' && <PhoneStage player={player} className="controller-waiting">
      <h1>PCを みてね!</h1><p>コマを じゅんびしています…</p></PhoneStage>}
    {baseline && !scan && (flow.phase === 'processing' || flow.phase === 'review') && <PhoneStage player={player} className="controller-waiting">
      <h1>写真を とりなおしてね</h1><p>撮影した情報がないため、もう一度4枚とってね</p>
      <button type="button" disabled={flow.phase !== 'review' || !flow.scanId}
        onClick={() => sessionRef.current?.sendControl({ type: 'scan-retry', scanId: flow.scanId! })}>とりなおす</button>
    </PhoneStage>}
    {baseline && flow.phase === 'battle' && <PadScreen player={player} connected={!flow.paused} onAttack={(button) => sessionRef.current?.sendAttack(button)} />}
    {baseline && flow.phase === 'result' && <RematchScreen key={flow.roundId} player={player} initialChoice={flow.rematchChoice}
      onChoose={(choice) => sessionRef.current?.sendControl({ type: 'rematch-choice', roundId: flow.roundId, choice })} />}
    {flow.phase === 'battle' && flow.paused && <div className="controller-status" role="status">{flow.resumeSeconds ? `${flow.resumeSeconds}秒で はじまるよ` : '接続を まっているよ'}</div>}
    {(message || sensorWarning) && <div className="controller-status" role="alert">{sensorWarning || message}
      {sensorWarning && <button type="button" onClick={() => { baselineRef.current = null; setBaseline(null); setSensorWarning('') }}>基準を とりなおす</button>}</div>}
    {feedback > 0 && <div key={feedback} className="controller-feedback" aria-hidden="true" />}
  </>
}

let feedbackAudio: AudioContext | null = null
function unlockFeedback() {
  try { feedbackAudio ??= new AudioContext(); void feedbackAudio.resume().catch(() => {}) }
  catch { /* 非対応時は画面フラッシュのみ使う。 */ }
}
function playFeedback(effect: 'hit' | 'damage' | 'defeat') {
  try {
    feedbackAudio ??= new AudioContext()
    void feedbackAudio.resume().catch(() => {})
    const oscillator = feedbackAudio.createOscillator(), gain = feedbackAudio.createGain()
    oscillator.connect(gain); gain.connect(feedbackAudio.destination)
    oscillator.frequency.value = effect === 'hit' ? 440 : effect === 'damage' ? 220 : 110
    gain.gain.setValueAtTime(0.08, feedbackAudio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, feedbackAudio.currentTime + 0.12)
    oscillator.start(); oscillator.stop(feedbackAudio.currentTime + 0.12)
  } catch { /* 音が使えない端末でも画面フラッシュを続ける。 */ }
}
