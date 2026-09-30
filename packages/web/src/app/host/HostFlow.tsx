import { useState } from 'react'
import type { FighterStats } from '@gikcamp/protocol'
import { HostStage } from '../../components/HostStage'
import { ScanProgressScreen, type ScanStatus } from '../../features/analyze/ScanProgressScreen'
import { BattleHud } from '../../features/battle/ui/BattleHud'
import { LobbyScreen, type LobbyPlayerStatus } from '../../features/lobby/LobbyScreen'
import { ResultScreen } from '../../features/result/ResultScreen'
import { MOCK_SCANNEES } from './mock/mockScannees'
import type { PlayerId } from '../../../../../docs/design/tokens'
import mugUrl from '../../../../../docs/design/assets/sample-scannee-mug.svg'
import eraserUrl from '../../../../../docs/design/assets/sample-scannee-eraser.svg'
import '../../../../../docs/design/tokens.css'
import './host.css'

type Step = 'lobby' | 'scan' | 'battle' | 'result'

// モック：ボタンを押すたびに 未接続 → 接続 → センサー → 準備 → 未接続 と進める
const MOCK_STEPS: LobbyPlayerStatus[] = [
  { connected: false, sensorReady: false, ready: false },
  { connected: true, sensorReady: false, ready: false },
  { connected: true, sensorReady: true, ready: false },
  { connected: true, sensorReady: true, ready: true },
]

// モック：スキャンの進み方。解析は1人ずつなので、2P は 1P の解析が終わるまで待つ
const MOCK_SCAN_STEPS: Record<PlayerId, ScanStatus>[] = [
  { p1: 'capturing', p2: 'capturing' },
  { p1: 'sending', p2: 'capturing' },
  { p1: 'analyzing', p2: 'sending' },
  { p1: 'analyzing', p2: 'waiting' },
  { p1: 'done', p2: 'analyzing' },
  { p1: 'done', p2: 'done' },
]

// モック：能力値は docs/04-mvp.md の表示例に合わせたサンプル。HP は試合の途中くらいの値
const MOCK_STATS: Record<PlayerId, FighterStats> = {
  p1: { hp: 128, attack: 1.05, reach: 1.01, turnSpeed: 192, moveSpeed: 0.89 },
  p2: { hp: 110, attack: 1.2, reach: 0.89, turnSpeed: 228, moveSpeed: 1.02 },
}
const MOCK_HP: Record<PlayerId, number> = { p1: 72, p2: 38 }
const MOCK_REMAINING_SECONDS = 24

// スマホで開く URL。ControllerFlow は ?p=2 で 2P になる
function joinUrl(player: PlayerId) {
  return `${window.location.origin}/controller?p=${player === 'p2' ? 2 : 1}`
}

// 送られてきた後（順番待ち・解析中・完成）だけコマの見た目がある
function hasLook(status: ScanStatus) {
  return status === 'waiting' || status === 'analyzing' || status === 'done'
}

/**
 * PC（/host）の画面遷移。ロビー → スキャン → 対戦 → 結果。
 * モック：スマホとはまだつながないので、画面上のボタンで状態と画面を進める。
 * 対戦は背景だけの画面に HUD を重ねた仮のもの（Babylon は読み込まない）。
 */
export function HostFlow() {
  const [step, setStep] = useState<Step>('lobby')
  const [mockStep, setMockStep] = useState<Record<PlayerId, number>>({ p1: 0, p2: 0 })
  const [scanStep, setScanStep] = useState(0)
  const [winner, setWinner] = useState<PlayerId>('p1')

  const advance = (player: PlayerId) =>
    setMockStep((prev) => ({ ...prev, [player]: (prev[player] + 1) % MOCK_STEPS.length }))

  const scanStatuses = MOCK_SCAN_STEPS[scanStep]
  const scanIsLast = scanStep === MOCK_SCAN_STEPS.length - 1

  const finish = (player: PlayerId) => {
    setWinner(player)
    setStep('result')
  }

  const restart = () => {
    setMockStep({ p1: 0, p2: 0 })
    setScanStep(0)
    setStep('lobby')
  }

  return (
    <>
      {step === 'lobby' && (
        <LobbyScreen
          joinUrls={{ p1: joinUrl('p1'), p2: joinUrl('p2') }}
          statuses={{ p1: MOCK_STEPS[mockStep.p1], p2: MOCK_STEPS[mockStep.p2] }}
        />
      )}
      {step === 'scan' && (
        <ScanProgressScreen
          players={{
            p1: { status: scanStatuses.p1, look: hasLook(scanStatuses.p1) ? MOCK_SCANNEES.p1 : undefined },
            p2: { status: scanStatuses.p2, look: hasLook(scanStatuses.p2) ? MOCK_SCANNEES.p2 : undefined },
          }}
        />
      )}
      {step === 'battle' && (
        <HostStage>
          <BattleHud
            fighters={{
              p1: { hp: MOCK_HP.p1, stats: MOCK_STATS.p1, portraitUrl: mugUrl },
              p2: { hp: MOCK_HP.p2, stats: MOCK_STATS.p2, portraitUrl: eraserUrl },
            }}
            remainingSeconds={MOCK_REMAINING_SECONDS}
          />
        </HostStage>
      )}
      {step === 'result' && <ResultScreen winner={winner} looks={MOCK_SCANNEES} />}

      <div className="host-mock">
        {step === 'lobby' && (
          <>
            <button type="button" onClick={() => advance('p1')}>
              モック：1P ▶
            </button>
            <button type="button" onClick={() => advance('p2')}>
              モック：2P ▶
            </button>
            <button type="button" onClick={() => setStep('scan')}>
              モック：スキャンへ ▶
            </button>
          </>
        )}
        {step === 'scan' && (
          <button
            type="button"
            onClick={() => (scanIsLast ? setStep('battle') : setScanStep((current) => current + 1))}
          >
            {scanIsLast ? 'モック：たいせんへ ▶' : 'モック：すすめる ▶'}
          </button>
        )}
        {step === 'battle' && (
          <>
            <button type="button" onClick={() => finish('p1')}>
              モック：1Pのかち ▶
            </button>
            <button type="button" onClick={() => finish('p2')}>
              モック：2Pのかち ▶
            </button>
          </>
        )}
        {step === 'result' && (
          <button type="button" onClick={restart}>
            モック：ロビーへ ▶
          </button>
        )}
      </div>
    </>
  )
}
