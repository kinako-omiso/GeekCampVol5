export const TEST_ATTACK_VALUE = 1
export const TEST_ATTACK_MULTIPLIERS = { p1: 0.8, p2: 1.3 } as const

const BASE_ATTACK_IMPULSE = 3

export type AttackKnockbackInput = {
  attackValue: number
  attackMultiplier: number
}

/** 攻撃値と攻撃力倍率から、被弾側へ加える追加インパルスを求める。 */
export function calculateKnockbackImpulse({ attackValue, attackMultiplier }: AttackKnockbackInput): number {
  if (!Number.isFinite(attackValue) || attackValue < 0 ||
      !Number.isFinite(attackMultiplier) || attackMultiplier < 0) {
    throw new RangeError('攻撃値と攻撃力倍率は0以上の有限数にしてください。')
  }
  const impulse = BASE_ATTACK_IMPULSE * attackValue * attackMultiplier
  if (!Number.isFinite(impulse)) throw new RangeError('追加インパルスが有限数の範囲を超えました。')
  return impulse
}
