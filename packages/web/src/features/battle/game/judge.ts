import type { PlayerId } from '../../../../../../docs/design/tokens'

/** 決着の理由。KO（HP が 0）・場外・時間切れ */
export type FinishReason = 'ko' | 'ringOut' | 'timeUp'

/** 決着の結果。winner が null なら引き分け */
export type BattleOutcome = {
  reason: FinishReason
  winner: PlayerId | null
}

/** 判定に使う、ある瞬間の対戦の状態 */
export type BattleSnapshot = {
  hp: Record<PlayerId, number>
  // リング外へ押し出されたか（ringExit.ts の hasJustLeftRing で一度 true になったら true のまま）
  ringOut: Record<PlayerId, boolean>
  // 残り時間（秒）
  remainingSeconds: number
}

const IDS: PlayerId[] = ['p1', 'p2']

// HP は HUD と同じく切り上げた整数でくらべる（画面に出ている数字と結果を食い違わせないため）
function shownHp(hp: number) {
  return Math.max(0, Math.ceil(hp))
}

// 残り HP が多い側の勝ち。同じなら引き分け
function byHp(hp: Record<PlayerId, number>): PlayerId | null {
  const p1 = shownHp(hp.p1)
  const p2 = shownHp(hp.p2)
  if (p1 === p2) return null
  return p1 > p2 ? 'p1' : 'p2'
}

/**
 * 決着したかを判定する。まだ続くなら null。
 * 仕様書「勝敗条件」：HP が 0 になった瞬間・リング外へ押し出された瞬間・60 秒の時間切れ（残り HP が多い側の勝ち、同じなら引き分け）。
 * 仕様書に無い「同じ瞬間に両方が負けた」ときは、時間切れと同じく残り HP でくらべる（理由は KO を場外より優先）。
 * HP 0・場外は時間切れより先に見る（最後の一撃と時間切れが重なったら、一撃の演出を出す）
 */
export function judgeBattle({ hp, ringOut, remainingSeconds }: BattleSnapshot): BattleOutcome | null {
  const knockedOut = IDS.filter((id) => shownHp(hp[id]) <= 0)
  const fellOut = IDS.filter((id) => ringOut[id])
  const losers = new Set([...knockedOut, ...fellOut])

  if (losers.size > 0) {
    const reason: FinishReason = knockedOut.length > 0 ? 'ko' : 'ringOut'
    if (losers.size === 1) {
      const [loser] = losers
      return { reason, winner: loser === 'p1' ? 'p2' : 'p1' }
    }
    return { reason, winner: byHp(hp) }
  }

  if (remainingSeconds <= 0) return { reason: 'timeUp', winner: byHp(hp) }
  return null
}
