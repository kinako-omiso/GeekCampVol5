import { useEffect, useRef, useState } from 'react'
import { HostStage } from '../../../components/HostStage'
import { BattleHud } from './BattleHud'
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
    <canvas className="battle-screen__canvas" ref={canvasRef} aria-label="2人のスキャンしたコマが対戦するアリーナ" />
    <BattleHud remainingSeconds={snapshot?.remainingSeconds ?? 60} fighters={{
      p1: { hp: snapshot?.hp.p1 ?? p1.geometry.stats.hp, stats: p1.geometry.stats, portraitUrl: state.players[1].look?.bodyUrl },
      p2: { hp: snapshot?.hp.p2 ?? p2.geometry.stats.hp, stats: p2.geometry.stats, portraitUrl: state.players[2].look?.bodyUrl },
    }} />
    {snapshot?.shrinkWarning && <div className="battle-screen__warning" role="status">リングが ちいさくなるよ!</div>}
    {state.paused && !error && <div className="battle-screen__pause" role="status">
      {state.resumeSeconds ? `${state.resumeSeconds}` : state.players[1].ready && state.players[2].ready ? '対戦を じゅんびしています…' : 'スマホの じゅんびを まっているよ'}</div>}
    {error && <div className="battle-screen__pause" role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>もう一度 じゅんびする</button></div>}
  </HostStage>
}
