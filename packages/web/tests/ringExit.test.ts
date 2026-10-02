import assert from 'node:assert/strict'
import test from 'node:test'
import { hasJustLeftRing, RING_RADIUS } from '../src/features/battle/game/ringExit.ts'

test('境界の内側と境界線上は場内、外側は場外', () => {
  assert.equal(hasJustLeftRing(RING_RADIUS - 0.01, 0, false), false)
  assert.equal(hasJustLeftRing(RING_RADIUS, 0, false), false)
  assert.equal(hasJustLeftRing(RING_RADIUS + 0.01, 0, false), true)
  assert.equal(hasJustLeftRing(4, 4, false), false)
})

test('場外通知は一度だけで、無効な座標では発生しない', () => {
  assert.equal(hasJustLeftRing(7, 0, true), false)
  assert.equal(hasJustLeftRing(Number.NaN, 0, false), false)
})
