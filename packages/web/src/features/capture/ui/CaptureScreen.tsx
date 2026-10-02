import { useEffect, useRef, useState, type MouseEvent } from 'react'
import {
  CAPTURE_VIEWS,
  MAX_CAPTURE_SELECTION_STROKES,
  type CaptureSelectionStroke,
  type CaptureView,
} from '@gikcamp/protocol'
import { PhoneStage } from '../../../components/PhoneStage'
import { Svg } from '../../../components/Svg'
import type { CaptureShot } from '../../../lib/peer/controllerPeerSession'
import { players, type PlayerId } from '../../../../../../docs/design/tokens'
import addIcon from '../../../../../../docs/design/assets/icons/add.svg?raw'
import againIcon from '../../../../../../docs/design/assets/icons/again.svg?raw'
import brightIcon from '../../../../../../docs/design/assets/icons/bright.svg?raw'
import cameraIcon from '../../../../../../docs/design/assets/icons/camera.svg?raw'
import checkIcon from '../../../../../../docs/design/assets/icons/check.svg?raw'
import monitorIcon from '../../../../../../docs/design/assets/icons/monitor.svg?raw'
import presetIcon from '../../../../../../docs/design/assets/icons/preset.svg?raw'
import removeIcon from '../../../../../../docs/design/assets/icons/remove.svg?raw'
import retakeIcon from '../../../../../../docs/design/assets/icons/retake.svg?raw'
import sendIcon from '../../../../../../docs/design/assets/icons/send.svg?raw'
import tapIcon from '../../../../../../docs/design/assets/icons/tap.svg?raw'
import wholeIcon from '../../../../../../docs/design/assets/icons/whole.svg?raw'
import './capture.css'

type Props = {
  player: PlayerId
  onSendCapture?: (
    shots: CaptureShot[],
    selection: CaptureSelectionStroke[],
    onProgress: (ratio: number) => void,
  ) => Promise<void>
}

// shoot：4方向を撮る / select：正面の写真で対象をタップ / sending：送信中 / sent：送信完了
type Phase = 'shoot' | 'select' | 'sending' | 'sent'
type SelectMode = CaptureSelectionStroke['mode']

// 撮った写真。画面に出す用の URL と、送る用の Blob を持つ
type TakenShot = CaptureShot & { previewUrl: string }

// モック：送信にかかったことにする時間（onSendCapture が無いとき）
const MOCK_SEND_MS = 1600
const MAX_PHOTO_SIDE = 2048

const VIEW_LABELS: Record<CaptureView, string> = {
  front: 'まえ',
  right: 'みぎ',
  back: 'うしろ',
  left: 'ひだり',
}

const TIPS = [
  { icon: presetIcon, label: '1こだけ' },
  { icon: brightIcon, label: 'あかるく' },
  { icon: wholeIcon, label: 'まるごと' },
]

/**
 * スマホ：撮影と範囲指定の画面（横持ち）。
 * まえ → みぎ → うしろ → ひだり の4枚を撮り、正面の写真で対象（＋）と背景（−）をタップしてから、4枚まとめてPCへ送る。
 * マスクはPCで作るので、スマホからはタップした位置だけを送る。
 */
export function CaptureScreen({ player, onSendCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [phase, setPhase] = useState<Phase>('shoot')
  const [shots, setShots] = useState<Partial<Record<CaptureView, TakenShot>>>({})
  // 次に撮る向き。null は「とりなおす」から戻ってきて、撮り直す向きをまだ選んでいない状態
  const [currentView, setCurrentView] = useState<CaptureView | null>('front')
  const [taking, setTaking] = useState(false)
  const [selection, setSelection] = useState<CaptureSelectionStroke[]>([])
  const [selectMode, setSelectMode] = useState<SelectMode>('add')
  const [cameraFailed, setCameraFailed] = useState(false)
  const [sendProgress, setSendProgress] = useState(0)
  const [sendError, setSendError] = useState('')
  // HTTPS でない・非対応ブラウザではカメラを使えない
  const cameraSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  const cameraError = !cameraSupported || cameraFailed
  const front = shots.front
  const canSend = selection.some((stroke) => stroke.mode === 'add')
  const allTaken = CAPTURE_VIEWS.every((view) => shots[view] !== undefined)
  const selectionFull = selection.length >= MAX_CAPTURE_SELECTION_STROKES

  // 撮影中だけカメラを動かす
  useEffect(() => {
    if (phase !== 'shoot' || !cameraSupported) return

    let cancelled = false
    let stream: MediaStream | null = null
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (cancelled) {
          stopStream(s)
          return
        }
        stream = s
        if (videoRef.current) videoRef.current.srcObject = s
      })
      .catch(() => {
        if (!cancelled) setCameraFailed(true)
      })

    return () => {
      cancelled = true
      if (stream) stopStream(stream)
    }
  }, [phase, cameraSupported])

  // モック：一定時間たったら送信完了にする
  useEffect(() => {
    if (phase !== 'sending' || onSendCapture !== undefined) return
    const timer = window.setTimeout(() => setPhase('sent'), MOCK_SEND_MS)
    return () => window.clearTimeout(timer)
  }, [phase, onSendCapture])

  // 画面を離れるときに写真の URL を片付ける
  const shotsRef = useRef(shots)
  useEffect(() => {
    shotsRef.current = shots
  }, [shots])
  useEffect(() => {
    return () => {
      for (const shot of Object.values(shotsRef.current)) {
        if (shot) URL.revokeObjectURL(shot.previewUrl)
      }
    }
  }, [])

  const handleShutter = async () => {
    const video = videoRef.current
    if (taking || currentView === null || !video || video.videoWidth <= 0) return

    setTaking(true)
    try {
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(video.videoWidth, video.videoHeight))
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
      const photo = await canvasToBlob(canvas)

      const view = currentView
      const shot: TakenShot = {
        view,
        photo,
        width: canvas.width,
        height: canvas.height,
        previewUrl: URL.createObjectURL(photo),
      }
      const previous = shots[view]
      if (previous) URL.revokeObjectURL(previous.previewUrl)
      const next = { ...shots, [view]: shot }
      setShots(next)
      setSendError('')
      // 正面を撮り直したら、前のタップは位置が合わなくなるので消す
      if (view === 'front') setSelection([])

      // まだ撮っていない向きがあれば次へ、すべてそろったら範囲指定へ
      const remaining = CAPTURE_VIEWS.find((v) => next[v] === undefined)
      if (remaining === undefined) {
        setPhase('select')
      } else {
        setCurrentView(remaining)
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : '写真を とれませんでした')
    } finally {
      setTaking(false)
    }
  }

  // 正面の写真の上をタップした位置を、写真の幅・高さを1とした位置で記録する
  // 写真は SVG の中に preserveAspectRatio="xMidYMid meet" で収めているので、同じ計算で余白を除く
  const handleSelectTap = (event: MouseEvent<SVGSVGElement>) => {
    if (!front || selectionFull) return
    const rect = event.currentTarget.getBoundingClientRect()
    const scale = Math.min(rect.width / front.width, rect.height / front.height)
    if (scale <= 0) return
    const offsetX = (rect.width - front.width * scale) / 2
    const offsetY = (rect.height - front.height * scale) / 2
    const x = (event.clientX - rect.left - offsetX) / (front.width * scale)
    const y = (event.clientY - rect.top - offsetY) / (front.height * scale)
    if (x < 0 || y < 0 || x > 1 || y > 1) return

    setSelection((current) => [...current, { mode: selectMode, points: [{ x, y }] }])
  }

  // どの向きを撮り直すかは、一覧の写真をタップして選んでもらう
  const handleRetake = () => {
    setSendError('')
    setCurrentView(null)
    setPhase('shoot')
  }

  const handleSend = async () => {
    if (!canSend) return
    const ordered = CAPTURE_VIEWS.flatMap((view) => {
      const shot = shots[view]
      return shot ? [{ view, photo: shot.photo, width: shot.width, height: shot.height }] : []
    })
    if (ordered.length !== CAPTURE_VIEWS.length) return

    setSendProgress(0)
    setSendError('')
    setPhase('sending')
    if (onSendCapture === undefined) return

    try {
      await onSendCapture(ordered, selection, setSendProgress)
      setPhase('sent')
    } catch (error) {
      // 写真とタップは残して、もう一度送れるようにする
      setPhase('select')
      setSendError(error instanceof Error ? error.message : '写真を送信できませんでした')
    }
  }

  if (phase === 'sent') {
    return (
      <PhoneStage player={player} className="capture">
        <div className="capture__sent">
          <div className="capture__sent-badge">
            <Svg markup={checkIcon} className="capture__sent-check" />
          </div>
          <div className="capture__sent-text">
            <div className="ss-display phone-ol capture__sent-title">おくったよ!</div>
            <div className="capture__sent-sub">
              <Svg markup={monitorIcon} className="capture__sent-monitor" />
              <span>PCを みてね!</span>
            </div>
          </div>
        </div>
      </PhoneStage>
    )
  }

  const showSelect = phase !== 'shoot' && front !== undefined
  // タップの印の大きさ。写真の短い辺に合わせる
  const markerRadius = front ? Math.min(front.width, front.height) * 0.04 : 0

  return (
    <PhoneStage player={player} className="capture">
      <div className="capture__layout">
        <div className="capture__preview">
          {showSelect ? (
            <svg
              className="capture__select"
              viewBox={`0 0 ${front.width} ${front.height}`}
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="まえの しゃしん。たいしょうを タップ してね"
              onClick={phase === 'select' ? handleSelectTap : undefined}
            >
              <image href={front.previewUrl} width={front.width} height={front.height} />
              {selection.map((stroke, index) =>
                stroke.points.map((point, pointIndex) => (
                  <g
                    key={`${index}-${pointIndex}`}
                    className={`capture__marker is-${stroke.mode}`}
                    transform={`translate(${point.x * front.width} ${point.y * front.height})`}
                  >
                    <circle r={markerRadius} strokeWidth={markerRadius * 0.15} />
                    <path
                      d={
                        stroke.mode === 'add'
                          ? `M${-markerRadius * 0.5} 0H${markerRadius * 0.5}M0 ${-markerRadius * 0.5}V${markerRadius * 0.5}`
                          : `M${-markerRadius * 0.5} 0H${markerRadius * 0.5}`
                      }
                      strokeWidth={markerRadius * 0.28}
                    />
                  </g>
                )),
              )}
            </svg>
          ) : (
            <video ref={videoRef} className="capture__media" autoPlay playsInline muted />
          )}
          {phase === 'shoot' && cameraError && <div className="capture__camera-error">カメラが つかえないよ</div>}
          {sendError !== '' && (
            <div className="capture__send-error" role="alert">
              {sendError}
            </div>
          )}

          {phase === 'shoot' && (
            <>
              <div className="capture__guide" aria-hidden="true" />
              <ul className="capture__tips">
                {TIPS.map((tip) => (
                  <li key={tip.label} className="capture__tip">
                    <Svg markup={tip.icon} className="capture__tip-icon" />
                    <span>{tip.label}</span>
                  </li>
                ))}
              </ul>
              <div className="capture__pill" role="status">
                {currentView === null ? (
                  <span className="ss-display">とりなおす しゃしんを えらんでね</span>
                ) : (
                  <>
                    <span className="ss-display capture__pill-step">
                      {CAPTURE_VIEWS.indexOf(currentView) + 1}/{CAPTURE_VIEWS.length}
                    </span>
                    <span className="ss-display">{VIEW_LABELS[currentView]}を とってね</span>
                  </>
                )}
              </div>
            </>
          )}

          {phase === 'select' && (
            <>
              <div className="capture__pill" role="status">
                <Svg markup={tapIcon} className="capture__pill-icon" />
                <span className="ss-display">
                  {selectionFull ? 'これいじょう タップ できないよ' : 'たいしょうを タップ してね'}
                </span>
              </div>
              <div className="capture__modes" role="group" aria-label="タップの しゅるい">
                <button
                  type="button"
                  className={selectMode === 'add' ? 'capture__mode is-active is-add' : 'capture__mode'}
                  aria-pressed={selectMode === 'add'}
                  onClick={() => setSelectMode('add')}
                >
                  <Svg markup={addIcon} className="capture__mode-icon" />
                  <span>これ</span>
                </button>
                <button
                  type="button"
                  className={selectMode === 'remove' ? 'capture__mode is-active is-remove' : 'capture__mode'}
                  aria-pressed={selectMode === 'remove'}
                  onClick={() => setSelectMode('remove')}
                >
                  <Svg markup={removeIcon} className="capture__mode-icon" />
                  <span>ちがう</span>
                </button>
              </div>
            </>
          )}
        </div>

        <div className="capture__side">
          <div className="ss-display phone-ol-s capture__player">{players[player].label}</div>
          {phase === 'shoot' ? (
            <>
              <button
                type="button"
                className="capture__shutter"
                aria-label={currentView === null ? 'しゃしんを とる' : `${VIEW_LABELS[currentView]}の しゃしんを とる`}
                disabled={cameraError || taking || currentView === null}
                onClick={handleShutter}
              >
                <span className="capture__shutter-ring" />
                <Svg markup={cameraIcon} className="capture__shutter-icon" />
              </button>
              {allTaken ? (
                // とりなおすを押したあと、撮り直さずに範囲指定へ戻る
                <button type="button" className="capture__back" disabled={taking} onClick={() => setPhase('select')}>
                  タップに もどる
                </button>
              ) : (
                <div className="ss-display phone-ol-s capture__shutter-label">パシャ!</div>
              )}
              {/* 撮った写真をタップすると、その向きだけ撮り直せる */}
              <ol className="capture__views">
                {CAPTURE_VIEWS.map((view) => {
                  const shot = shots[view]
                  return (
                    <li key={view}>
                      <button
                        type="button"
                        className={view === currentView ? 'capture__view is-current' : 'capture__view'}
                        aria-label={`${VIEW_LABELS[view]}を とりなおす`}
                        aria-current={view === currentView ? 'step' : undefined}
                        disabled={shot === undefined || taking}
                        onClick={() => setCurrentView(view)}
                      >
                        {shot && <img className="capture__view-thumb" src={shot.previewUrl} alt="" />}
                        <span className="capture__view-label">{VIEW_LABELS[view]}</span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </>
          ) : (
            <>
              <button
                type="button"
                className="capture__ok"
                aria-label="これで おくる"
                disabled={!canSend || phase !== 'select'}
                onClick={handleSend}
              >
                <Svg markup={checkIcon} className="capture__ok-icon" />
                <span className="ss-display">OK!</span>
              </button>
              <button
                type="button"
                className="capture__action"
                disabled={selection.length === 0 || phase !== 'select'}
                onClick={() => setSelection([])}
              >
                <Svg markup={againIcon} className="capture__action-icon" />
                <span>やりなおし</span>
              </button>
              <button
                type="button"
                className="capture__action"
                disabled={phase !== 'select'}
                onClick={handleRetake}
              >
                <Svg markup={retakeIcon} className="capture__action-icon" />
                <span>とりなおす</span>
              </button>
            </>
          )}
        </div>
      </div>

      {phase === 'sending' && (
        <div className="capture__sending" role="status">
          <Svg markup={sendIcon} className="capture__sending-icon" />
          <div className="ss-display capture__sending-title">おくってるよ…</div>
          <div className="capture__sending-bar">
            <div
              className={onSendCapture === undefined ? 'capture__sending-fill' : 'capture__sending-fill is-live'}
              style={
                onSendCapture === undefined
                  ? { animationDuration: `${MOCK_SEND_MS}ms` }
                  : { width: `${sendProgress * 100}%` }
              }
            />
          </div>
        </div>
      )}
    </PhoneStage>
  )
}

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop())
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob === null) {
          reject(new Error('写真の変換に失敗しました'))
        } else {
          resolve(blob)
        }
      },
      'image/jpeg',
      0.85,
    )
  })
}
