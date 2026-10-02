import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CaptureScreen } from '../../features/capture/ui/CaptureScreen'
import { JoinScreen } from '../../features/join/JoinScreen'
import { OrientScreen } from '../../features/orient/OrientScreen'
import { PadScreen } from '../../features/pad/PadScreen'
import {
  RematchScreen,
  type RematchChoice,
} from '../../features/rematch/RematchScreen'
import { ControllerPeerSession } from '../../lib/peer/controllerPeerSession.ts'
import { parseControllerPairing } from '../../lib/peer/pairing.ts'
import { MOCK_SCANNEES } from '../host/mock/mockScannees'
import {
  createTiltNormalizer,
  getScreenAngle,
  subscribeOrientation,
  type Baseline,
} from '../../lib/sensor'
import type { PlayerId } from '../../../../../docs/design/tokens'
import '../../../../../docs/design/tokens.css'
import './controller.css'

type Step = 'join' | 'capture' | 'orient' | 'pad' | 'result'

type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'rejected'
  | 'disconnected'

const STEPS: Step[] = [
  'join',
  'capture',
  'orient',
  'pad',
  'result',
]

export function ControllerFlow() {
  const [searchParams] = useSearchParams()
  const query = searchParams.toString()

  const [step, setStep] = useState<Step>('join')
  // モック：結果画面で選んだもの。「つぎへ」の行き先に使う
  const [rematchChoice, setRematchChoice] =
    useState<RematchChoice | null>(null)
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting')
  const [connectionMessage, setConnectionMessage] =
    useState('PCに接続しています')

  const sessionRef = useRef<ControllerPeerSession | null>(null)
  const [baseline, setBaseline] = useState<Baseline | null>(null)

  const pairing = parseControllerPairing(
    new URLSearchParams(query),
  )

  const player: PlayerId =
    pairing?.metadata.slot === 1 ? 'p1' : 'p2'

  useEffect(() => {
    const parsedPairing = parseControllerPairing(
      new URLSearchParams(query),
    )

    if (parsedPairing === null) {
      return
    }

    const session = new ControllerPeerSession(
      parsedPairing.hostPeerId,
      parsedPairing.metadata,
      {
        connected: () => {
          setConnectionState('connected')
          setConnectionMessage('')
        },

        rejected: (reason) => {
          setStep('join')
          setBaseline(null)
          setConnectionState('rejected')
          setConnectionMessage(reason)
        },

        disconnected: () => {
          setStep('join')
          setBaseline(null)
          setConnectionState('disconnected')
          setConnectionMessage('PCとの接続が切れました')
        },

        error: (error) => {
          setConnectionMessage(error.message)
        },
      },
    )
    sessionRef.current = session

    return () => {
      if (sessionRef.current === session) {
        sessionRef.current = null
      }
      session.destroy()
    }
  }, [query])

  useEffect(() => {
    if (baseline === null || connectionState !== 'connected') {
      return
    }

    const normalize = createTiltNormalizer(baseline)
    let lastSentAt = -Infinity

    return subscribeOrientation((orientation) => {
      const now = performance.now()

      if (now - lastSentAt < 1_000 / 30) {
        return
      }

      const motion = normalize(
        orientation,
        getScreenAngle(),
      )

      if (motion === null) {
        return
      }

      lastSentAt = now
      sessionRef.current?.sendMotion({
        x: motion.x,
        y: motion.y,
      })
    })
  }, [baseline, connectionState])

  const goNext = () => {
    // 結果画面のあとは選んだものに合わせる（このまま → 対戦、あたらしく → スキャン）
    if (step === 'result') {
      setStep(rematchChoice === 'again' ? 'pad' : 'capture')
      setRematchChoice(null)
      return
    }

    setStep((current) => {
      const currentIndex = STEPS.indexOf(current)
      return STEPS[(currentIndex + 1) % STEPS.length]
    })
  }

  if (pairing === null) {
    return (
      <main>
        <h1>PCに接続</h1>
        <p>QRコードの情報が不正です</p>
        <p>PCに表示されたQRコードから開いてください。</p>
      </main>
    )
  }

  if (connectionState !== 'connected') {
    return (
      <main>
        <h1>PCに接続</h1>
        <p>{connectionMessage}</p>

        {connectionState === 'disconnected' && (
          <p>PCに表示されたQRコードを読み直してください。</p>
        )}
      </main>
    )
  }

  return (
    <>
      {step === 'join' && (
        <JoinScreen
          player={player}
          onCalibrated={(baseline) => {
            setBaseline(baseline)
          }}
        />
      )}

      {step === 'capture' && (
        <CaptureScreen
          player={player}
          onSendCapture={(
            shots,
            selection,
            onProgress,
          ) => {
            const session = sessionRef.current

            if (session === null) {
              return Promise.reject(
                new Error('PCと接続されていません'),
              )
            }

            return session.sendCapture(
              shots,
              selection,
              onProgress,
            )
          }}
        />
      )}

      {step === 'orient' && (
        <OrientScreen player={player} />
      )}

      {step === 'pad' && (
        <PadScreen
          player={player}
          connected={connectionState === 'connected'}
          onAttack={(button) => {
            sessionRef.current?.sendAttack(button)
          }}
        />
      )}

      {/* モック：コマはスキャン結果とつなぐまで見本のものを使い、選んだ結果はまだ PC に送らない */}
      {step === 'result' && (
        <RematchScreen
          player={player}
          look={MOCK_SCANNEES[player]}
          onChoose={setRematchChoice}
        />
      )}

      <button
        type="button"
        className="controller-mock-next"
        onClick={goNext}
      >
        モック：つぎへ ▶
      </button>
    </>
  )
}
