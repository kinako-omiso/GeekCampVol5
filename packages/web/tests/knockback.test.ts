import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateKnockbackImpulse, TEST_ATTACK_MULTIPLIERS, TEST_ATTACK_VALUE } from '../src/features/battle/game/knockback.ts'

test('固定の攻撃力倍率で追加インパルスが変わる', () => {
  assert.ok(Math.abs(calculateKnockbackImpulse({ attackValue: TEST_ATTACK_VALUE, attackMultiplier: TEST_ATTACK_MULTIPLIERS.p1 }) - 2.4) < 1e-10)
  assert.ok(Math.abs(calculateKnockbackImpulse({ attackValue: TEST_ATTACK_VALUE, attackMultiplier: TEST_ATTACK_MULTIPLIERS.p2 }) - 3.9) < 1e-10)
})

test('攻撃値と攻撃力倍率に比例し、0なら追加しない', () => {
  assert.ok(Math.abs(calculateKnockbackImpulse({ attackValue: 2, attackMultiplier: 1.2 }) - 7.2) < 1e-10)
  assert.equal(calculateKnockbackImpulse({ attackValue: 0, attackMultiplier: 1 }), 0)
  assert.equal(calculateKnockbackImpulse({ attackValue: 1, attackMultiplier: 0 }), 0)
})

test('負数と有限でない値を拒否する', () => {
  for (const value of [-1, Number.NaN, Infinity, -Infinity]) {
    assert.throws(() => calculateKnockbackImpulse({ attackValue: value, attackMultiplier: 1 }), RangeError)
    assert.throws(() => calculateKnockbackImpulse({ attackValue: 1, attackMultiplier: value }), RangeError)
  }
  assert.throws(() => calculateKnockbackImpulse({ attackValue: 1e308, attackMultiplier: 1e308 }), RangeError)
})
