import assert from 'node:assert/strict'
import test from 'node:test'
import { isControlMessage } from '../../protocol/src/control.ts'
import { isMotionMessage } from '../../protocol/src/motion.ts'
import { stepMovement, type MovementState } from '../src/features/battle/game/movement.ts'

test('傾きとボタンの検証では無効な値を受け付けない', () => {
  assert.equal(isMotionMessage({ type: 'motion', x: 0.5, y: -1 }), true)
  assert.equal(isMotionMessage({ type: 'motion', x: Number.NaN, y: 0 }), false)
  assert.equal(isMotionMessage({ type: 'motion', x: 1.1, y: 0 }), false)
  assert.equal(isControlMessage({ type: 'attack', button: 'a' }), true)
  assert.equal(isControlMessage({ type: 'attack', button: 'c' }), false)
})

test('画面右と奥の入力をカメラ基準で移動へ写像する', () => {
  const start: MovementState = { x: 0, z: 0, yaw: 0, smoothedX: 0, smoothedY: 0 }
  const right = { x: 1, z: 0 }
  const forward = { x: 0, z: 1 }
  const movedRight = stepMovement(start, { x: 1, y: 0 }, 0.1, right, forward)
  assert.ok(movedRight.x > 0)
  assert.ok(Math.abs(movedRight.z) < 1e-9)
  assert.ok(movedRight.yaw > 0)
  const movedForward = stepMovement(start, { x: 0, y: 1 }, 0.1, right, forward)
  assert.ok(movedForward.z > 0)
  assert.ok(Math.abs(movedForward.x) < 1e-9)
})

test('斜め入力でも移動速度は基準値を超えない', () => {
  const state: MovementState = { x: 0, z: 0, yaw: 0, smoothedX: 1, smoothedY: 1 }
  const next = stepMovement(state, { x: 1, y: 1 }, 1, { x: 1, z: 0 }, { x: 0, z: 1 })
  assert.ok(Math.hypot(next.x, next.z) <= 3 + 1e-9)
})
