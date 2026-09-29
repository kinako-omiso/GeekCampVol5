import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CaptureScreen } from '../../features/capture/ui/CaptureScreen'
import { JoinScreen } from '../../features/join/JoinScreen'
import { OrientScreen } from '../../features/orient/OrientScreen'
import { PadScreen } from '../../features/pad/PadScreen'
import { ControllerPeerSession } from '../../lib/peer/controllerPeerSession.ts'
import { parseControllerPairing } from '../../lib/peer/pairing.ts'
import type { Baseline } from '../../lib/sensor'
import type { PlayerId } from '../../../../../docs/design/tokens'
import '../../../../../docs/design/tokens.css'
import './controller.css'

type Step = 'join' | 'capture' | 'orient' | 'pad'

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
]

export function ControllerFlow() {
  const [searchParams] = useSearchParams()
  const query = searchParams.toString()

  const [step, setStep] = useState<Step>('join')
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting')
  const [connectionMessage, setConnectionMessage] =
    useState('PCに接続しています')

  const baselineRef = useRef<Baseline | null>(null)

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
          setConnectionState('rejected')
          setConnectionMessage(reason)
        },

        disconnected: () => {
          setConnectionState('disconnected')
          setConnectionMessage('PCとの接続が切れました')
        },

        error: (error) => {
          setConnectionMessage(error.message)
        },
      },
    )

    return () => {
      session.destroy()
    }
  }, [query])

  const goNext = () => {
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
            baselineRef.current = baseline
          }}
        />
      )}

      {step === 'capture' && (
        <CaptureScreen player={player} />
      )}

      {step === 'orient' && (
        <OrientScreen player={player} />
      )}

      {step === 'pad' && (
        <PadScreen player={player} />
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