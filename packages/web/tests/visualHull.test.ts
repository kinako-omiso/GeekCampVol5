import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import createGeometry from '../../geometry-wasm/dist/geometry.mjs'
import createReconstruction from '../../reconstruction-wasm/dist/reconstruction.mjs'
import { createFixedCamera } from '../../reconstruction-wasm/src/index.ts'
import { reconstructQuickScan } from '../src/features/analyze/reconstruction/quickScan.ts'
import { assessMask } from '../src/features/capture/pipeline/maskQuality.ts'
import { findCandidatePoints, assessCandidate } from '../src/features/capture/pipeline/visualHullCandidateSearch.ts'

function instantiate(create: (options: object) => Promise<any>, file: string) {
  const binary = readFileSync(new URL(file, import.meta.url))
  return create({ instantiateWasm(imports: WebAssembly.Imports, success: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) {
    const module = new WebAssembly.Module(binary)
    const instance = new WebAssembly.Instance(module, imports)
    success(instance, module)
    return instance.exports
  } })
}
const geometryPromise = instantiate(createGeometry, '../../geometry-wasm/dist/geometry.wasm')
const reconstructionPromise = instantiate(createReconstruction, '../../reconstruction-wasm/dist/reconstruction.wasm')

function mask(size: number, selected: (x: number, y: number) => boolean) {
  const data = new Uint8Array(size * size)
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) data[y * size + x] = selected(x, y) ? 1 : 0
  return { width: size, height: size, data }
}

async function analyze(positions: Float32Array, indices: Uint32Array) {
  const module = await geometryPromise
  const p = module._malloc(positions.byteLength), q = module._malloc(indices.byteLength)
  try {
    module.HEAPU8.set(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength), p)
    module.HEAPU8.set(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength), q)
    const status = module._geom_analyze(p, positions.length / 3, q, indices.length)
    return { status, values: Array.from({ length: 12 }, (_, i) => module._geom_value(i)), hullTriangles: module._geom_hull_index_count() / 3 }
  } finally { module._free(p); module._free(q) }
}

async function reconstruct(yaws: number[], shape: 'square' | 'circle', empty = false, badCamera = false,
  options: { side: 96 | 128 | 160; smooth: 0 | 1; adaptive: 0 | 1 } = { side: 96, smooth: 0, adaptive: 0 }) {
  const module = await reconstructionPromise
  const size = 64
  const m = mask(size, (x, y) => !empty && (shape === 'square'
    ? x >= 16 && x < 48 && y >= 16 && y < 48
    : Math.hypot(x - 31.5, y - 31.5) < 17))
  const count = yaws.length
  const pointers = [module._malloc(count * m.data.length), module._malloc(count * 4), module._malloc(count * 4), module._malloc(count * 4), module._malloc(count * 21 * 4)]
  try {
    yaws.forEach((yaw, i) => {
      module.HEAPU8.set(m.data, pointers[0] + i * m.data.length)
      module.HEAP32[pointers[1] / 4 + i] = i * m.data.length
      module.HEAP32[pointers[2] / 4 + i] = size
      module.HEAP32[pointers[3] / 4 + i] = size
      const camera = createFixedCamera(size, size, yaw)
      if (badCamera && i === 0) camera.rotation[0] = 0
      module.HEAPF32.set(camera.intrinsics, pointers[4] / 4 + i * 21)
      module.HEAPF32.set(camera.rotation, pointers[4] / 4 + i * 21 + 9)
      module.HEAPF32.set(camera.translation, pointers[4] / 4 + i * 21 + 18)
    })
    const status = module._recon_build_options(...pointers, count, options.side, options.smooth, options.adaptive)
    if (status) return { status }
    const vertexCount = module._recon_vertex_count(), indexCount = module._recon_index_count()
    const positions = new Float32Array(module.HEAPF32.subarray(module._recon_positions() / 4, module._recon_positions() / 4 + vertexCount * 3))
    const indices = new Uint32Array(module.HEAPU32.subarray(module._recon_indices() / 4, module._recon_indices() / 4 + indexCount))
    const normals = new Float32Array(module.HEAPF32.subarray(module._recon_normals() / 4, module._recon_normals() / 4 + vertexCount * 3))
    return { status, positions, indices, normals, occupied: module._recon_occupied(),
      normalization: Array.from(module.HEAPF32.subarray(module._recon_normalization() / 4, module._recon_normalization() / 4 + 4)) }
  } finally { pointers.forEach((pointer) => module._free(pointer)) }
}

function inspectMesh(mesh: { positions: Float32Array; indices: Uint32Array; normals: Float32Array }) {
  assert.ok(mesh.positions.length > 0)
  assert.equal(mesh.positions.length, mesh.normals.length)
  assert.equal(mesh.indices.length % 3, 0)
  let volume = 0
  const edgeCounts = new Map<string, number>()
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = Array.from(mesh.indices.slice(i, i + 3))
    assert.ok(ids.every((id) => id < mesh.positions.length / 3))
    const [a, b, c] = ids.map((id) => id * 3)
    const p = mesh.positions
    volume += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6
    for (let j = 0; j < 3; j += 1) {
      const key = [ids[j], ids[(j + 1) % 3]].sort((x, y) => x - y).join(':')
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1)
    }
  }
  assert.ok(volume > 0)
  assert.ok([...edgeCounts.values()].every((count) => count === 2))
  for (let i = 0; i < mesh.normals.length; i += 3) assert.ok(Math.abs(Math.hypot(...mesh.normals.slice(i, i + 3)) - 1) < 1e-3)
  return volume
}

test('Quick Scanから3D凸包・重心・能力値の基礎特徴を解析できる', async () => {
  const m = mask(32, (x, y) => x >= 5 && x < 25 && y >= 7 && y < 21)
  const mesh = reconstructQuickScan(m)
  const result = await analyze(mesh.positions, mesh.indices)
  assert.equal(result.status, 0)
  assert.ok(Math.abs(result.values[0] - 0.175) < 1e-5)
  assert.ok(Math.abs(result.values[3] - 0.35) < 1e-5)
  assert.ok(result.hullTriangles >= 12)
  assert.deepEqual((await analyze(mesh.positions, mesh.indices)).values, result.values)
  const module = await geometryPromise
  const principalAxes = Array.from({ length: 9 }, (_, i) => module._geom_value(12 + i))
  for (let axis = 0; axis < 3; axis += 1) {
    const vector = principalAxes.slice(axis * 3, axis * 3 + 3)
    assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-5)
  }
  assert.ok(Math.abs(principalAxes[0]) > 0.99)
  assert.equal((await analyze(mesh.positions, mesh.indices.slice(0, -3))).status, 2)
})

test('4方向と8方向の合成Silhouetteから閉じたVisual Hullを生成する', async () => {
  for (const yaws of [[0, 90, 180, 270], [0, 45, 90, 135, 180, 225, 270, 315]]) {
    const result = await reconstruct(yaws, 'square')
    assert.equal(result.status, 0)
    assert.ok(result.occupied > 0)
    const volume = inspectMesh(result as { positions: Float32Array; indices: Uint32Array; normals: Float32Array })
    assert.ok(volume > 0.05 && volume < 1)
    assert.equal((await analyze(result.positions!, result.indices!)).status, 0)
  }
})

test('曲面と空Mask・不正な姿勢を処理する', async () => {
  const curved = await reconstruct([0, 45, 90, 135, 180, 225, 270, 315], 'circle')
  assert.equal(curved.status, 0)
  inspectMesh(curved as { positions: Float32Array; indices: Uint32Array; normals: Float32Array })
  assert.equal((await analyze(curved.positions!, curved.indices!)).status, 0)
  assert.equal((await reconstruct([0, 90, 180, 270], 'square', true)).status, 2)
  assert.equal((await reconstruct([0, 90, 180], 'square')).status, 1)
  assert.equal((await reconstruct([0, 90, 180, 270], 'square', false, true)).status, 1)
})


test('Mask候補の空・画像端・正常な中央選択を判定する', () => {
  const blank = mask(32, () => false)
  const edge = mask(32, (x, y) => x < 12 && y > 5 && y < 25)
  const center = mask(32, (x, y) => x > 8 && x < 24 && y > 8 && y < 24)
  assert.match(assessMask(blank).reason, /見つかりません/)
  assert.equal(assessMask(edge).touchesEdge, true)
  assert.equal(assessMask(edge).needsReview, true)
  assert.equal(assessMask(center).needsReview, false)
})

test('96/128/160³と二値・補間の合成形状を検証し、標準96³の能力値を再現する', async () => {
  const yaws = [0, 90, 180, 270]
  for (const side of [96, 128, 160] as const) for (const smooth of [0, 1] as const) {
    const options = { side, smooth, adaptive: 1 as const }
    const first = await reconstruct(yaws, 'square', false, false, options)
    assert.equal(first.status, 0)
    const volume = inspectMesh(first as { positions: Float32Array; indices: Uint32Array; normals: Float32Array })
    assert.ok(volume > 0.05 && volume < 1)
    const features = await analyze(first.positions!, first.indices!)
    if (side === 96) assert.equal(features.status, 0, `side=${side} smooth=${smooth}`)
    const again = await reconstruct(yaws, 'square', false, false, options)
    assert.deepEqual(first.positions, again.positions)
    assert.deepEqual(first.indices, again.indices)
    if (features.status !== 0) console.log(`比較候補 side=${side} smooth=${smooth} の形状解析 status=${features.status}`)
    const repeatedFeatures = await analyze(again.positions!, again.indices!)
    assert.equal(repeatedFeatures.status, features.status)
    if (features.status === 0) assert.deepEqual(repeatedFeatures.values, features.values)
  }
})


test('正面Maskの画像内容からずれた対象を探し、別色の背景物体を避ける', () => {
  const picture = (objectX: number, distractor: boolean) => {
    const data = new Uint8ClampedArray(64 * 64 * 4)
    for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
      const index = (y * 64 + x) * 4
      const object = x >= objectX && x < objectX + 12 && y >= 20 && y < 44
      const falseTarget = distractor && x >= 18 && x < 30 && y >= 20 && y < 44
      const value = object ? [60, 65, 70] : falseTarget ? [240, 40, 40] : [235, 235, 235]
      data.set([...value, 255], index)
    }
    return { width: 64, height: 64, data }
  }
  const foreground = mask(64, (x, y) => x >= 18 && x < 30 && y >= 20 && y < 44)
  const candidates = findCandidatePoints(picture(18, false), foreground, picture(33, true), { x: 24 / 64, y: 32 / 64 })
  assert.ok(candidates.length <= 3)
  assert.ok(candidates.some((point) => point.x > 32 / 64 && point.x < 46 / 64))
  assert.equal(assessMask(foreground, { x: 24 / 64, y: 32 / 64 }).needsReview, false)
  assert.equal(assessCandidate(foreground, { x: 24 / 64, y: 32 / 64 }, foreground).acceptable, true)
})

test('面向きの不整合と小さな開口部を閉じ、C++形状解析へ渡す', async () => {
  const { orientClosedMesh } = await import('../../reconstruction-wasm/src/meshWinding.ts')
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])
  const inconsistent = new Uint32Array([0, 1, 2, 0, 1, 3, 0, 3, 2, 1, 2, 3])
  const fixed = orientClosedMesh(positions, inconsistent)
  assert.ok(fixed.correctedFaces > 0)
  assert.equal(fixed.sealedFaces, 0)
  assert.equal((await analyze(positions, fixed.indices)).status, 0)
  const open = orientClosedMesh(positions, new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2]))
  assert.equal(open.sealedFaces, 1)
  assert.equal((await analyze(positions, open.indices)).status, 0)
})
