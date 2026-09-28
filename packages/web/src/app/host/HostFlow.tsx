import { useState } from 'react'
import { LobbyScreen, type LobbyPlayerStatus } from '../../features/lobby/LobbyScreen'
import type { PlayerId } from '../../../../../docs/design/tokens'
import '../../../../../docs/design/tokens.css'
import './host.css'

// モック：ボタンを押すたびに 未接続 → 接続 → センサー → 準備 → 未接続 と進める
const MOCK_STEPS: LobbyPlayerStatus[] = [
  { connected: false, sensorReady: false, ready: false },
  { connected: true, sensorReady: false, ready: false },
  { connected: true, sensorReady: true, ready: false },
  { connected: true, sensorReady: true, ready: true },
]

// スマホで開く URL。ControllerFlow は ?p=2 で 2P になる
function joinUrl(player: PlayerId) {
  return `${window.location.origin}/controller?p=${player === 'p2' ? 2 : 1}`
}

/**
 * PC（/host）の画面遷移。いまはロビーだけ。
 * モック：スマホとはまだつながないので、画面上のボタンで接続状態を進める。
 */
export function HostFlow() {
  const [mockStep, setMockStep] = useState<Record<PlayerId, number>>({ p1: 0, p2: 0 })

  const advance = (player: PlayerId) =>
    setMockStep((prev) => ({ ...prev, [player]: (prev[player] + 1) % MOCK_STEPS.length }))

  return (
    <>
      <LobbyScreen
        joinUrls={{ p1: joinUrl('p1'), p2: joinUrl('p2') }}
        statuses={{ p1: MOCK_STEPS[mockStep.p1], p2: MOCK_STEPS[mockStep.p2] }}
      />

      <div className="host-mock">
        <button type="button" onClick={() => advance('p1')}>
          モック：1P ▶
        </button>
        <button type="button" onClick={() => advance('p2')}>
          モック：2P ▶
        </button>
      </div>
    </>
  )
}
