import assert from 'node:assert/strict'
import test from 'node:test'
import { judgeBattle, type BattleSnapshot } from '../src/features/battle/game/judge.ts'

function snapshot(overrides: Partial<BattleSnapshot> = {}): BattleSnapshot {
  return {
    hp: { p1: 72, p2: 38 },
    ringOut: { p1: false, p2: false },
    remainingSeconds: 24,
    ...overrides,
  }
}

test('どちらも負けておらず時間も残っていれば続行', () => {
  assert.equal(judgeBattle(snapshot()), null)
})

test('HP が 0 になった側の負け（KO）', () => {
  assert.deepEqual(judgeBattle(snapshot({ hp: { p1: 72, p2: 0 } })), { reason: 'ko', winner: 'p1' })
  assert.deepEqual(judgeBattle(snapshot({ hp: { p1: -3, p2: 38 } })), { reason: 'ko', winner: 'p2' })
})

test('HP は切り上げで見るので、0 より少しでも多ければ KO ではない', () => {
  assert.equal(judgeBattle(snapshot({ hp: { p1: 72, p2: 0.2 } })), null)
})

test('リング外へ出た側の負け（場外）', () => {
  assert.deepEqual(judgeBattle(snapshot({ ringOut: { p1: true, p2: false } })), { reason: 'ringOut', winner: 'p2' })
})

test('時間切れは残り HP が多い側の勝ち、同じなら引き分け', () => {
  assert.deepEqual(judgeBattle(snapshot({ remainingSeconds: 0 })), { reason: 'timeUp', winner: 'p1' })
  assert.deepEqual(judgeBattle(snapshot({ hp: { p1: 10, p2: 50 }, remainingSeconds: -0.01 })), {
    reason: 'timeUp',
    winner: 'p2',
  })
  assert.deepEqual(judgeBattle(snapshot({ hp: { p1: 40, p2: 40 }, remainingSeconds: 0 })), { reason: 'timeUp', winner: null })
  // 画面の数字（切り上げ）が同じなら引き分け
  assert.deepEqual(judgeBattle(snapshot({ hp: { p1: 39.2, p2: 40 }, remainingSeconds: 0 })), { reason: 'timeUp', winner: null })
})

test('最後の一撃と時間切れが重なったら KO を優先する', () => {
  assert.deepEqual(judgeBattle(snapshot({ hp: { p1: 72, p2: 0 }, remainingSeconds: 0 })), { reason: 'ko', winner: 'p1' })
})

test('同じ瞬間に両方が負けたら残り HP でくらべる', () => {
  assert.deepEqual(judgeBattle(snapshot({ hp: { p1: 0, p2: 0 } })), { reason: 'ko', winner: null })
  assert.deepEqual(judgeBattle(snapshot({ ringOut: { p1: true, p2: true } })), { reason: 'ringOut', winner: 'p1' })
})
