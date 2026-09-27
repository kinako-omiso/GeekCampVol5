import { useEffect, useRef, useState } from 'react'
import { PhoneStage } from '../../../components/PhoneStage'
import { Svg } from '../../../components/Svg'
import { players, type PlayerId } from '../../../../../../docs/design/tokens'
import brightIcon from '../../../../../../docs/design/assets/icons/bright.svg?raw'
import cameraIcon from '../../../../../../docs/design/assets/icons/camera.svg?raw'
import checkIcon from '../../../../../../docs/design/assets/icons/check.svg?raw'
import monitorIcon from '../../../../../../docs/design/assets/icons/monitor.svg?raw'
import presetIcon from '../../../../../../docs/design/assets/icons/preset.svg?raw'
import sendIcon from '../../../../../../docs/design/assets/icons/send.svg?raw'
import wholeIcon from '../../../../../../docs/design/assets/icons/whole.svg?raw'
import './capture.css'

type Props = {
  player: PlayerId
}

type Phase = 'shoot' | 'sending' | 'sent'

// モック：送信にかかったことにする時間（本番は PeerJS の送信完了で進める）
const MOCK_SEND_MS = 1600

const TIPS = [
  { icon: presetIcon, label: '1こだけ' },
  { icon: brightIcon, label: 'あかるく' },
  { icon: wholeIcon, label: 'まるごと' },
]

/**
 * スマホ：撮影画面（モック）。
 * カメラのプレビューとシャッター → 送信中 → 送信完了。範囲指定（ぬりぬり）と送信は後続の issue で作る。
 */
export function CaptureScreen({ player }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [phase, setPhase] = useState<Phase>('shoot')
  const [photo, setPhoto] = useState<string | null>(null)
  const [cameraFailed, setCameraFailed] = useState(false)
  // HTTPS でない・非対応ブラウザではカメラを使えない
  const cameraSupported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  const cameraError = !cameraSupported || cameraFailed

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
    if (phase !== 'sending') return
    const timer = window.setTimeout(() => setPhase('sent'), MOCK_SEND_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  const handleShutter = () => {
    const video = videoRef.current
    if (video && video.videoWidth > 0) {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')?.drawImage(video, 0, 0)
      setPhoto(canvas.toDataURL('image/jpeg', 0.85))
    }
    setPhase('sending')
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

  return (
    <PhoneStage player={player} className="capture">
      <div className="capture__layout">
        <div className="capture__preview">
          {photo ? (
            <img className="capture__media" src={photo} alt="とった しゃしん" />
          ) : (
            <video ref={videoRef} className="capture__media" autoPlay playsInline muted />
          )}
          {cameraError && !photo && <div className="capture__camera-error">カメラが つかえないよ</div>}

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
            </>
          )}
        </div>

        <div className="capture__side">
          <div className="ss-display phone-ol-s capture__player">{players[player].label}</div>
          {phase === 'shoot' && (
            <>
              <button
                type="button"
                className="capture__shutter"
                aria-label="しゃしんを とる"
                disabled={cameraError}
                onClick={handleShutter}
              >
                <span className="capture__shutter-ring" />
                <Svg markup={cameraIcon} className="capture__shutter-icon" />
              </button>
              <div className="ss-display phone-ol-s capture__shutter-label">パシャ!</div>
            </>
          )}
        </div>
      </div>

      {phase === 'sending' && (
        <div className="capture__sending" role="status">
          <Svg markup={sendIcon} className="capture__sending-icon" />
          <div className="ss-display capture__sending-title">おくってるよ…</div>
          <div className="capture__sending-bar">
            <div className="capture__sending-fill" style={{ animationDuration: `${MOCK_SEND_MS}ms` }} />
          </div>
        </div>
      )}
    </PhoneStage>
  )
}

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop())
}
