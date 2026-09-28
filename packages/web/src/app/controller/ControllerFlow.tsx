import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CaptureScreen } from '../../features/capture/ui/CaptureScreen'
import { JoinScreen } from '../../features/join/JoinScreen'
import { OrientScreen } from '../../features/orient/OrientScreen'
import { PadScreen } from '../../features/pad/PadScreen'
import type { Baseline } from '../../lib/sensor'
import type { PlayerId } from '../../../../../docs/design/tokens'
import '../../../../../docs/design/tokens.css'
import './controller.css'

type Step = 'join' | 'capture' | 'orient' | 'pad'

const STEPS: Step[] = ['join', 'capture', 'orient', 'pad']

/**
 * スマホ（/controller）の画面遷移。接続 → 撮影 → 向き調整 → パッド。
 * モック：PC とはまだつながないので、画面上の「つぎへ」で進める。プレイヤーは ?p=2 で 2P になる。
 */
export function ControllerFlow() {
  const [searchParams] = useSearchParams()
  const player: PlayerId = searchParams.get('p') === '2' ? 'p2' : 'p1'
  const [step, setStep] = useState<Step>('join')
  // 基準姿勢。パッドで傾きを送るときに使う
  const baselineRef = useRef<Baseline | null>(null)

  const goNext = () => setStep((current) => STEPS[(STEPS.indexOf(current) + 1) % STEPS.length])

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
      {step === 'capture' && <CaptureScreen player={player} />}
      {step === 'orient' && <OrientScreen player={player} />}
      {step === 'pad' && <PadScreen player={player} />}

      <button type="button" className="controller-mock-next" onClick={goNext}>
        モック：つぎへ ▶
      </button>
    </>
  )
}
