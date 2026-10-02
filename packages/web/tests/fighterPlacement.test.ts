import assert from 'node:assert/strict'
import test from 'node:test'
import type { GeometryResult } from '@gikcamp/geometry-wasm'
import { clipCollisionHull, createDefaultPlacement, prepareFighterModel } from '../src/features/battle/game/fighterPlacement.ts'

// 下端に1点、上端に3点を持つ四面体。単に下の頂点を削除すると平面になってしまう。
const positions = new Float32Array([0, -0.4, 0, -0.5, 0.6, -0.5, 0.5, 0.6, -0.5, 0, 0.6, 0.5])
const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2])
const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1])
const reconstruction = { positions, indices, normals }
const geometry: GeometryResult = {
  hullPositions: positions.slice(), hullIndices: indices.slice(), centerOfMass: [0, 0.35, -0.125],
  inertia: [0.1, 0.2, 0.3], principalAxes: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
  axes: { elongation: 0, solidity: 1, sharpness: 0 }, volume: 1 / 6, surfaceArea: 2,
  statsVersion: 'provisional-1', stats: { hp: 100, attack: 1, reach: 1, turnSpeed: 200, moveSpeed: 1 },
}
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`)

test('自動配置は写真の正面と生成モデル下端を使い、最下端を接地させる', () => {
  const placement = createDefaultPlacement(reconstruction, 90)
  close(placement.yaw, -Math.PI / 2)
  assert.equal(placement.bottomY, positions[1])
  const prepared = prepareFighterModel({ reconstruction, geometry, placement })
  const bottom = prepared.collisionPositions.filter((_, index) => index % 3 === 1)
  close(Math.min(...bottom), 0)
  close(Math.max(...bottom), 1)
})

test('切断面の交点を含め、下端より下の衝突頂点を除外する', () => {
  const clipped = clipCollisionHull(positions, indices, 0)
  assert.equal(clipped.length / 3, 6)
  for (let i = 1; i < clipped.length; i += 3) assert.ok(clipped[i] >= 0)
  const intersections: number[][] = []
  for (let i = 0; i < clipped.length; i += 3) if (clipped[i + 1] === 0) intersections.push(Array.from(clipped.slice(i, i + 3)))
  assert.equal(intersections.length, 3)
  for (const expected of [[-0.2, 0, -0.2], [0.2, 0, -0.2], [0, 0, 0.2]]) {
    assert.ok(intersections.some((point) => point.every((value, axis) => Math.abs(value - expected[axis]) < 1e-6)))
  }
})

test('切断面上にある頂点を保持し、平面だけ・空・不正入力を拒否する', () => {
  assert.equal(clipCollisionHull(positions, indices, positions[1]).length, positions.length)
  for (const bottom of [positions[4], 2, Infinity, Number.NaN]) assert.throws(() => clipCollisionHull(positions, indices, bottom))
  assert.throws(() => clipCollisionHull(positions, new Uint32Array([99, 1, 2, 0, 2, 3, 0, 3, 1, 1, 3, 2]), 0))
  const flat = positions.map((value, index) => index % 3 === 1 ? 0 : value)
  assert.throws(() => clipCollisionHull(flat, indices, 0))
})

test('元の重心・表示・衝突へ同じ補正を適用し、入力と能力値を変更しない', () => {
  const snapshot = { positions: positions.slice(), normals: normals.slice(), indices: indices.slice(),
    hull: geometry.hullPositions.slice(), center: [...geometry.centerOfMass], stats: { ...geometry.stats } }
  const prepared = prepareFighterModel({ reconstruction, geometry,
    placement: { yaw: Math.PI / 2, offsetX: 0.2, offsetZ: -0.3, bottomY: 0 } })
  close(prepared.centerOfMass[0], 0.075)
  close(prepared.centerOfMass[1], 0.35)
  close(prepared.centerOfMass[2], -0.3)
  // 表示は切断しない。原点側の先端が床下に残る。
  assert.ok(prepared.reconstruction.positions[1] < 0)
  close(prepared.reconstruction.positions[0], 0.2)
  close(prepared.reconstruction.normals![0], 1)
  for (let i = 1; i < prepared.collisionPositions.length; i += 3) assert.ok(prepared.collisionPositions[i] >= 0)
  // 上端の同じ頂点は、表示と衝突で同じ足元座標へ変換される。
  assert.deepEqual(prepared.reconstruction.positions.slice(3, 12), prepared.collisionPositions.slice(0, 9))
  assert.deepEqual(positions, snapshot.positions); assert.deepEqual(normals, snapshot.normals)
  assert.deepEqual(indices, snapshot.indices); assert.deepEqual(geometry.hullPositions, snapshot.hull)
  assert.deepEqual(geometry.centerOfMass, snapshot.center); assert.deepEqual(geometry.stats, snapshot.stats)
})

test('geometry-wasmの正規化座標を表示座標へ合わせ、縮尺を維持する', () => {
  const scaled = { ...reconstruction, positions: positions.map((value) => value * 2) }
  const prepared = prepareFighterModel({ reconstruction: scaled, geometry,
    placement: { yaw: 0, offsetX: 0, offsetZ: 0, bottomY: 0 } })
  close(prepared.centerOfMass[1], 0.7)
  close(prepared.centerOfMass[2], -0.25)
  close(prepared.collisionPositions[1], 1.2)
})

test('不正な補正や衝突形状がなくなる配置は確定できない', () => {
  const placement = createDefaultPlacement(reconstruction)
  for (const update of [{ yaw: Number.NaN }, { offsetX: Infinity }, { offsetZ: 1e308 }, { bottomY: -2 }, { bottomY: 2 }, { bottomY: positions[4] }]) {
    assert.throws(() => prepareFighterModel({ reconstruction, geometry, placement: { ...placement, ...update } }))
  }
})
