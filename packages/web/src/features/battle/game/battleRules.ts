import type { FighterStats } from '@gikcamp/protocol'
import { RING_RADIUS } from './ringExit.ts'

type Player = 'p1' | 'p2'
export type BattleResult = { winner: Player | 'draw'; reason: 'hp' | 'out' | 'timeout' }
// nextRadius は予告中なら縮小後の半径、それ以外は radius と同じ
export type BattleSnapshot = { hp: Record<Player, number>; remainingSeconds: number;
  radius: number; nextRadius: number; shrinkWarning: boolean; result: BattleResult | null }
export const ATTACKS = {
  a: { damage: 3, reach: 1.2, windupMs: 0, intervalMs: 400 },
  b: { damage: 18, reach: 2.4, windupMs: 300, intervalMs: 3000 },
} as const
/** リング縮小の段階（仕様書「リング縮小」）。at 秒で縮み、その3秒前から予告する。 */
export const RING_STAGES = [
  { at: 0, radius: RING_RADIUS },
  { at: 28, radius: 4.2 },
  { at: 48, radius: 2.7 },
] as const
const SHRINK_WARNING_SECONDS = 3

function radiusAt(elapsed: number): number {
  return RING_STAGES.reduce<number>((radius, stage) => elapsed >= stage.at ? stage.radius : radius, RING_RADIUS)
}

export type BattleHit = { attacker: Player; target: Player; button: 'a' | 'b' }

/** 同じ物理ステップの両者の命中・場外をまとめて評価する。 */
export class BattleRules {
  private elapsed = 0
  private hp: Record<Player, number>
  private stats: Record<Player, FighterStats>
  private result: BattleResult | null = null
  private nextAttack: Record<Player, Record<'a' | 'b', number>> = { p1: { a: 0, b: 0 }, p2: { a: 0, b: 0 } }

  constructor(stats: Record<Player, FighterStats>) {
    this.stats = stats
    this.hp = { p1: stats.p1.hp, p2: stats.p2.hp }
  }

  acceptAttack(player: Player, button: 'a' | 'b', nowMs: number): boolean {
    if (this.result || nowMs < this.nextAttack[player][button]) return false
    this.nextAttack[player][button] = nowMs + ATTACKS[button].intervalMs
    return true
  }

  step(seconds: number, hits: readonly BattleHit[] = [], outs: readonly Player[] = []): BattleSnapshot {
    if (this.result) return this.snapshot()
    this.elapsed = Math.min(60, this.elapsed + Math.max(0, seconds))
    for (const hit of hits) this.hp[hit.target] = Math.max(0,
      this.hp[hit.target] - ATTACKS[hit.button].damage * this.stats[hit.attacker].attack)
    const defeated = (['p1', 'p2'] as const).filter((player) => this.hp[player] <= 0 || outs.includes(player))
    if (defeated.length) this.result = { winner: defeated.length === 2 ? 'draw' : defeated[0] === 'p1' ? 'p2' : 'p1',
      reason: outs.length ? 'out' : 'hp' }
    else if (this.elapsed >= 60) this.result = { winner: this.hp.p1 === this.hp.p2 ? 'draw' : this.hp.p1 > this.hp.p2 ? 'p1' : 'p2', reason: 'timeout' }
    return this.snapshot()
  }

  snapshot(): BattleSnapshot {
    const radius = radiusAt(this.elapsed)
    const nextRadius = radiusAt(this.elapsed + SHRINK_WARNING_SECONDS)
    return { hp: { ...this.hp }, remainingSeconds: Math.max(0, 60 - this.elapsed),
      radius, nextRadius, shrinkWarning: nextRadius < radius, result: this.result }
  }
}
