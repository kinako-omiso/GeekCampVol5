import createModule from '../dist/geometry.mjs'
import type { FighterStats } from '@gikcamp/protocol'

export type GeometryInput = {
  positions: Float32Array
  indices: Uint32Array
  source: 'photo' | 'reconstruction'
}

export type GeometryResult = {
  hullPositions: Float32Array
  hullIndices: Uint32Array
  centerOfMass: [number, number, number]
  inertia: [number, number, number]
  principalAxes: Float32Array
  axes: { elongation: number; solidity: number; sharpness: number }
  volume: number
  surfaceArea: number
  statsVersion: 'provisional-1'
  stats: FighterStats
}

let modulePromise: ReturnType<typeof createModule> | undefined
function getModule() {
  modulePromise ??= createModule({ locateFile: (name) => name.endsWith('.wasm')
    ? new URL('../dist/geometry.wasm', import.meta.url).href : name })
  return modulePromise
}
function round2(value: number) { return Math.round(value * 100) / 100 }
function clamp(value: number) { return Math.min(1, Math.max(0, value)) }

/** 同じ3D形状から方式によらず同じ値を求める。 */
export async function analyzeGeometry(input: GeometryInput): Promise<GeometryResult> {
  if (input.positions.length % 3 || input.indices.length % 3 || input.indices.length === 0) {
    throw new Error('解析するメッシュの配列が正しくありません。')
  }
  const module = await getModule()
  const positionsPointer = module._malloc(input.positions.byteLength)
  const indicesPointer = module._malloc(input.indices.byteLength)
  if (!positionsPointer || !indicesPointer) {
    if (positionsPointer) module._free(positionsPointer)
    if (indicesPointer) module._free(indicesPointer)
    throw new Error('形状解析のメモリを確保できませんでした。')
  }
  try {
    module.HEAPU8.set(new Uint8Array(input.positions.buffer, input.positions.byteOffset, input.positions.byteLength), positionsPointer)
    module.HEAPU8.set(new Uint8Array(input.indices.buffer, input.indices.byteOffset, input.indices.byteLength), indicesPointer)
    const status = module._geom_analyze(positionsPointer, input.positions.length / 3, indicesPointer, input.indices.length)
    if (status !== 0) throw new Error(status === 2 ? '閉じた立体メッシュを入力してください。' : '形状解析に失敗しました。')
    const value = (index: number) => module._geom_value(index)
    const [volume, surfaceArea, x, y, z, i1, i2, i3, elongation, solidity, sharpness, occupancy] = Array.from({ length: 12 }, (_, i) => value(i))
    const vertexCount = module._geom_hull_vertex_count()
    const indexCount = module._geom_hull_index_count()
    return {
      hullPositions: new Float32Array(module.HEAPF32.subarray(module._geom_hull_positions() / 4, module._geom_hull_positions() / 4 + vertexCount * 3)),
      hullIndices: new Uint32Array(module.HEAPU32.subarray(module._geom_hull_indices() / 4, module._geom_hull_indices() / 4 + indexCount)),
      centerOfMass: [x, y, z], inertia: [i1, i2, i3],
      principalAxes: Float32Array.from({ length: 9 }, (_, i) => value(12 + i)),
      axes: { elongation, solidity, sharpness }, volume, surfaceArea,
      statsVersion: 'provisional-1',
      stats: {
        hp: Math.round(80 + 60 * clamp(occupancy)),
        attack: round2(0.8 + 0.5 * clamp(sharpness)),
        reach: round2(0.85 + 0.4 * clamp(elongation)),
        turnSpeed: Math.round(240 - 120 * clamp(elongation)),
        moveSpeed: round2(1.25 - 0.45 * clamp(occupancy)),
      },
    }
  } finally {
    module._free(positionsPointer)
    module._free(indicesPointer)
  }
}
