import assert from 'node:assert/strict'
import test from 'node:test'
import { getVolumeCentroid } from '../src/features/analyze/reconstruction/centroid.ts'
import { reconstructQuickScan } from '../src/features/analyze/reconstruction/quickScan.ts'
import type { SilhouetteMask } from '../src/features/analyze/reconstruction/types.ts'

function createMask(width: number, height: number, selected: (x: number, y: number) => boolean): SilhouetteMask {
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data[y * width + x] = selected(x, y) ? 1 : 0
  }
  return { width, height, data }
}

function inspectMesh(mask: SilhouetteMask) {
  const mesh = reconstructQuickScan(mask)
  assert.ok(mesh.normals)
  const count = mesh.positions.length / 3
  assert.ok(count >= 12)
  assert.equal(mesh.normals.length, mesh.positions.length)
  assert.equal(mesh.indices.length % 3, 0)
  const xs: number[] = []
  const ys: number[] = []
  const zs: number[] = []
  for (let index = 0; index < mesh.positions.length; index += 3) {
    xs.push(mesh.positions[index])
    ys.push(mesh.positions[index + 1])
    zs.push(mesh.positions[index + 2])
    assert.ok(Math.abs(Math.hypot(mesh.normals[index], mesh.normals[index + 1], mesh.normals[index + 2]) - 1) < 1e-5)
  }
  assert.ok(Math.abs(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) - 1) < 1e-5)
  assert.ok(Math.abs(Math.max(...zs) - Math.min(...zs) - 0.25) < 1e-5)
  assert.equal(Math.min(...ys), 0)
  for (const index of mesh.indices) assert.ok(index < count)

  // 前後面と側面が幾何学的に閉じていることを辺の共有数で確かめる。
  const edges = new Map<string, number>()
  const edgeDirections = new Map<string, number>()
  const keyOf = (vertex: number) => Array.from(mesh.positions.slice(vertex * 3, vertex * 3 + 3), (value) => value.toFixed(6)).join(',')
  let frontArea = 0
  let signedVolume = 0
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const ids = [mesh.indices[index], mesh.indices[index + 1], mesh.indices[index + 2]]
    const [a, b, c] = ids.map((id) => id * 3)
    const ux = mesh.positions[b] - mesh.positions[a]
    const uy = mesh.positions[b + 1] - mesh.positions[a + 1]
    const uz = mesh.positions[b + 2] - mesh.positions[a + 2]
    const vx = mesh.positions[c] - mesh.positions[a]
    const vy = mesh.positions[c + 1] - mesh.positions[a + 1]
    const vz = mesh.positions[c + 2] - mesh.positions[a + 2]
    assert.ok(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 1e-8)
    if (ids.every((id) => mesh.positions[id * 3 + 2] > 0)) frontArea += (ux * vy - uy * vx) / 2
    signedVolume += (
      mesh.positions[a] * (mesh.positions[b + 1] * mesh.positions[c + 2] - mesh.positions[b + 2] * mesh.positions[c + 1])
      + mesh.positions[a + 1] * (mesh.positions[b + 2] * mesh.positions[c] - mesh.positions[b] * mesh.positions[c + 2])
      + mesh.positions[a + 2] * (mesh.positions[b] * mesh.positions[c + 1] - mesh.positions[b + 1] * mesh.positions[c])
    ) / 6
    for (let edge = 0; edge < 3; edge += 1) {
      const start = keyOf(ids[edge])
      const end = keyOf(ids[(edge + 1) % 3])
      const ends = [start, end].sort().join('|')
      edges.set(ends, (edges.get(ends) ?? 0) + 1)
      edgeDirections.set(ends, (edgeDirections.get(ends) ?? 0) + (start < end ? 1 : -1))
    }
  }
  assert.ok([...edges.values()].every((count) => count === 2))
  assert.ok([...edgeDirections.values()].every((direction) => direction === 0))
  assert.ok(signedVolume > 0)
  return { mesh, frontArea, signedVolume }
}

test('矩形の寸法と閉じた押し出し面', () => {
  const { mesh, frontArea, signedVolume } = inspectMesh(createMask(32, 32, (x, y) => x >= 5 && x < 25 && y >= 7 && y < 21))
  assert.ok(Math.abs(frontArea - 0.7) < 1e-5)
  assert.ok(Math.abs(signedVolume - 0.7 * 0.25) < 1e-5)
  const center = getVolumeCentroid(mesh)
  assert.ok(center)
  assert.ok(Math.abs(center.x) < 1e-5)
  assert.ok(Math.abs(center.y - 0.35) < 1e-5)
  assert.ok(Math.abs(center.z) < 1e-5)
  const horizontalSides = new Set<number>()
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const ids = Array.from(mesh.indices.slice(index, index + 3))
    const ys = ids.map((id) => mesh.positions[id * 3 + 1])
    if (ys.every((y) => y === ys[0])) horizontalSides.add(ys[0])
  }
  const sideHeights = [...horizontalSides].sort((a, b) => a - b)
  assert.equal(sideHeights.length, 2)
  assert.ok(Math.abs(sideHeights[0]) < 1e-5)
  assert.ok(Math.abs(sideHeights[1] - 0.7) < 1e-5)
})

test('凹形状を面分割し、同じ入力から同じ結果を得る', () => {
  const input = createMask(32, 32, (x, y) => (x >= 5 && x < 11 && y >= 5 && y < 25) || (x >= 5 && x < 24 && y >= 19 && y < 25))
  const { mesh, frontArea } = inspectMesh(input)
  assert.ok(Math.abs(frontArea - 198 / 400) < 1e-5)
  const center = getVolumeCentroid(mesh)
  assert.ok(center)
  assert.ok(center.y < 0.5)
  assert.deepEqual(mesh.positions, reconstructQuickScan(input).positions)
  assert.deepEqual(mesh.indices, reconstructQuickScan(input).indices)
})

test('最大連結成分だけを使う', () => {
  const main = (x: number, y: number) => x >= 3 && x < 20 && y >= 3 && y < 20
  const mixed = createMask(32, 32, (x, y) => main(x, y) || (x >= 25 && x < 28 && y >= 25 && y < 28))
  assert.deepEqual(reconstructQuickScan(mixed).positions, reconstructQuickScan(createMask(32, 32, main)).positions)
})

test('内部の穴を埋める', () => {
  const full = (x: number, y: number) => x >= 4 && x < 28 && y >= 4 && y < 28
  const hole = createMask(32, 32, (x, y) => full(x, y) && !(x >= 10 && x < 20 && y >= 10 && y < 20))
  assert.deepEqual(reconstructQuickScan(hole).indices, reconstructQuickScan(createMask(32, 32, full)).indices)
  inspectMesh(hole)
})

test('空Maskと不正なサイズは説明できるエラーにする', () => {
  assert.throws(() => reconstructQuickScan(createMask(8, 8, () => false)), /対象物/)
  assert.throws(() => reconstructQuickScan({ width: 8, height: 8, data: new Uint8Array(1) }), /サイズ/)
})
