import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { HostStage } from '../../components/HostStage'
import { ScanProgressScreen } from '../../features/analyze/ScanProgressScreen'
import { ScanProcessor } from '../../features/analyze/scanProcessor'
import { maskToBlob, createScanLook } from '../../features/analyze/scanImages'
import { BattleScreen } from '../../features/battle/ui/BattleScreen'
import { LobbyScreen } from '../../features/lobby/LobbyScreen'
import { ResultScreen, type RematchChoice } from '../../features/result/ResultScreen'
import { HostPeerSession } from '../../lib/peer/hostPeerSession'
import { buildControllerUrl } from '../../lib/peer/pairing'
import { HostMatch, type HostMatchSnapshot } from './hostMatch'
import type { PlayerSlot } from '@gikcamp/protocol'
import '../../../../../docs/design/tokens.css'
import './host.css'

// #45は選択状況の表示まで。スマホの選択を受信するまでは未選択として表示する。
const NO_REMATCH_CHOICES: Record<'p1' | 'p2', RematchChoice | null> = { p1: null, p2: null }

export function HostFlow() {
  const [match, setMatch] = useState<HostMatch | null>(null)
  const [state, setState] = useState<HostMatchSnapshot | null>(null)
  const [urls, setUrls] = useState<Record<PlayerSlot, string> | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const processor = new ScanProcessor()
    const session = new HostPeerSession({
      ready: (id, metadata) => {
        setUrls({ 1: buildControllerUrl(window.location.origin, id, metadata[1]), 2: buildControllerUrl(window.location.origin, id, metadata[2]) })
        setMatch(activeMatch); setState(activeMatch.snapshot())
      },
      playerConnected: (slot) => activeMatch.connected(slot),
      playerDisconnected: (slot) => activeMatch.disconnected(slot),
      motionReceived: (slot, message) => activeMatch.motion(slot, message),
      buttonPressed: (slot, button) => activeMatch.attack(slot, button),
      controlReceived: (slot, message) => activeMatch.control(slot, message),
      assetProgress: (slot, received, total) => activeMatch.progress(slot, received, total),
      assetReceived: (slot, manifest, blob) => { void activeMatch.asset(slot, manifest, blob) },
      error: (cause) => setError(cause.message),
    })
    const activeMatch = new HostMatch(session, processor, { maskToBlob, createScanLook }, setState)
    return () => { activeMatch.dispose(); session.destroy() }
  }, [])
  if (!urls || !state || !match) return <HostStage><div className="host-loading"><h1>スマホを接続</h1><p role="status">{error || 'QRコードを準備中…'}</p></div></HostStage>
  return <>
    {state.step === 'lobby' && <LobbyScreen joinUrls={{ p1: urls[1], p2: urls[2] }} statuses={{
      p1: { connected: state.players[1].connected, sensorReady: state.players[1].sensorReady, ready: state.players[1].ready },
      p2: { connected: state.players[2].connected, sensorReady: state.players[2].sensorReady, ready: state.players[2].ready },
    }} />}
    {state.step === 'scan' && <ScanProgressScreen players={{ p1: state.players[1], p2: state.players[2] }} />}
    {state.step === 'battle' && <BattleScreen match={match} state={state} />}
    {state.step === 'result' && state.result && state.players[1].look && state.players[2].look && <>
      <ResultScreen winner={state.result.winner} looks={{ p1: state.players[1].look, p2: state.players[2].look }} choices={NO_REMATCH_CHOICES} />
      <div className="host-result-actions"><p>{state.result.reason === 'hp' ? 'HPで けっちゃく!' : state.result.reason === 'out' ? '場外で けっちゃく!' : '時間ぎれ!'}</p>
        <button type="button" onClick={() => match.restart()}>ロビーへ もどる</button></div>
    </>}
    {state.step !== 'lobby' && state.step !== 'result' && ([1, 2] as const).some((slot) => !state.players[slot].connected) && <div className="host-reconnect" role="status">
      <h2>接続を まっているよ</h2><div>{([1, 2] as const).filter((slot) => !state.players[slot].connected).map((slot) => <section key={slot}>
        <p>Player {slot} の接続が切れました</p><QRCodeSVG value={urls[slot]} size={150} /><p>このQRから つなぎなおしてね</p></section>)}</div></div>}
    {error && <div className="host-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')}>とじる</button></div>}
  </>
}
