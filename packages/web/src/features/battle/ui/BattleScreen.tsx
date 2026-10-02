import { useEffect, useRef, useState } from 'react'
import { HostStage } from '../../../components/HostStage'
import { BattleHud } from './BattleHud'
import goCenterUrl from '../../../../../../docs/design/assets/go-center.svg'
import warningUrl from '../../../../../../docs/design/assets/warning.svg'
import type { HostMatch, HostMatchSnapshot } from '../../../app/host/hostMatch'
import type { PhysicsBattle } from '../game/physicsBattle'
import type { BattleSnapshot } from '../game/battleRules'
import './battleScreen.css'

/** 検証入力を持たず、PCの試合進行とスマホ入力を既存Havokシーンへ接続する。 */
export function BattleScreen({ match, state }: { match: HostMatch; state: HostMatchSnapshot }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [snapshot, setSnapshot] = useState<BattleSnapshot | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const p1 = state.players[1].model!, p2 = state.players[2].model!
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const abort = new AbortController()
    let battle: PhysicsBattle | null = null
    void import('../game/physicsBattle').then(({ mountPhysicsBattle }) => mountPhysicsBattle(canvas, (event) => {
      if (event.type === 'hit') {
        match.feedback(event.attacker === 'p1' ? 1 : 2, 'hit')
        match.feedback(event.target === 'p1' ? 1 : 2, 'damage')
      }
    }, abort.signal, { fighters: { p1, p2 }, production: {
      stats: { p1: p1.geometry.stats, p2: p2.geometry.stats },
      onSnapshot: (value) => { if (!abort.signal.aborted) { setSnapshot(value); match.battleSnapshot(value) } },
    } })).then((value) => {
      if (abort.signal.aborted) { value.dispose(); return }
      battle = value; setError(''); match.attachBattle(value)
    }).catch((cause: unknown) => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : '対戦を準備できませんでした。') })
    return () => { abort.abort(); match.attachBattle(null); battle?.dispose() }
  }, [match, p1, p2, attempt])
  return <HostStage className="battle-screen">
    <ArenaBackdrop />
    <canvas className="battle-screen__canvas" ref={canvasRef} aria-label="2人のスキャンしたコマが対戦するアリーナ" />
    <BattleHud remainingSeconds={snapshot?.remainingSeconds ?? 60} fighters={{
      p1: { hp: snapshot?.hp.p1 ?? p1.geometry.stats.hp, stats: p1.geometry.stats, portraitUrl: state.players[1].look?.bodyUrl },
      p2: { hp: snapshot?.hp.p2 ?? p2.geometry.stats.hp, stats: p2.geometry.stats, portraitUrl: state.players[2].look?.bodyUrl },
    }} />
    {snapshot?.shrinkWarning && <div className="battle-screen__warning ss-motion" role="status">
      <div className="ss-pill battle-screen__warning-pill">
        <img src={goCenterUrl} alt="" width={38} height={38} />
        <span className="ss-display">まんなかへ にげて!</span>
        <img src={warningUrl} alt="" width={30} height={27} />
      </div>
    </div>}
    {state.paused && !error && <div className="battle-screen__pause" role="status">
      {state.resumeSeconds ? `${state.resumeSeconds}` : state.players[1].ready && state.players[2].ready ? '対戦を じゅんびしています…' : 'スマホの じゅんびを まっているよ'}</div>}
    {error && <div className="battle-screen__pause" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>もう一度 じゅんびする</button></div>}
  </HostStage>
}

/** 3D の島の後ろに見える空・遠くの山・雲海（見本 pc-06-battle の背景と同じ形）。 */
function ArenaBackdrop() {
  return <svg className="battle-screen__backdrop" viewBox="0 0 1280 720" aria-hidden="true">
    <rect className="battle-screen__sky" width="1280" height="720" />
    <path className="battle-screen__mountains" d="M0 250L120 180L230 220L350 150L470 210L600 170L740 220L870 150L1000 200L1130 160L1280 200V330H0Z" />
    <path className="battle-screen__cloud-sea" d="M-10 282Q40 242 100 264Q150 228 220 256Q280 224 350 254Q420 222 490 252Q560 222 630 250Q700 222 770 252Q840 224 910 254Q980 226 1050 256Q1120 228 1190 258Q1240 240 1292 264V730H-10Z" />
    <g className="battle-screen__cloud-shade">
      <ellipse cx="120" cy="420" rx="90" ry="26" /><ellipse cx="1150" cy="440" rx="100" ry="28" />
      <ellipse cx="90" cy="640" rx="120" ry="30" /><ellipse cx="1190" cy="650" rx="110" ry="30" />
    </g>
  </svg>
}
