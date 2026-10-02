import type { GeometryResult } from '@gikcamp/geometry-wasm'
import type { ReconstructionResult } from '../../analyze/reconstruction/types.ts'
import { reconstructQuickScan } from '../../analyze/reconstruction/quickScan.ts'
import { createSampleMask } from './sampleMask.ts'

/** 生成座標系の接地面と、足元基準に対する補正。角度の単位はラジアン。 */
export type FighterPlacement = {
  yaw: number
  offsetX: number
  offsetZ: number
  bottomY: number
  scale: number
}

export type BattleFighterModel = {
  reconstruction: ReconstructionResult
  geometry: GeometryResult
  placement: FighterPlacement
}

export type PreparedFighter = {
  reconstruction: ReconstructionResult
  collisionPositions: Float32Array
  centerOfMass: [number, number, number]
}

const EPSILON = 1e-7
const MIN_MODEL_HEIGHT = 1e-4
let sampleHeight: number | null = null

export function getModelBounds(positions: Float32Array) {
  if (positions.length < 12 || positions.length % 3 !== 0) throw new Error('モデルの頂点が不正です。')
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[i + axis]
      if (!Number.isFinite(value)) throw new Error('モデルの頂点が不正です。')
      min[axis] = Math.min(min[axis], value)
      max[axis] = Math.max(max[axis], value)
    }
  }
  const span = Math.max(...max.map((value, axis) => value - min[axis]))
  if (span <= EPSILON) throw new Error('モデルに大きさがありません。')
  return { minY: min[1], maxY: max[1], height: max[1] - min[1], span }
}

export function createDefaultPlacement(reconstruction: ReconstructionResult, frontYawDegrees = 0): FighterPlacement {
  const bounds = getModelBounds(reconstruction.positions)
  if (bounds.height <= MIN_MODEL_HEIGHT) throw new Error('モデルの高さが足りないため、対戦用の大きさを決められません。')
  sampleHeight ??= getModelBounds(reconstructQuickScan(createSampleMask()).positions).height
  return { yaw: -frontYawDegrees * Math.PI / 180, offsetX: 0, offsetZ: 0,
    bottomY: bounds.minY, scale: sampleHeight / bounds.height }
}

function hasVolume(points: Float32Array): boolean {
  if (points.length < 12) return false
  const origin = [points[0], points[1], points[2]]
  let edge: number[] | undefined
  let normal: number[] | undefined
  for (let i = 3; i < points.length; i += 3) {
    const v = [points[i] - origin[0], points[i + 1] - origin[1], points[i + 2] - origin[2]]
    if (!edge) {
      const length = Math.hypot(...v)
      if (length > EPSILON) edge = v.map((value) => value / length)
    } else if (!normal) {
      const cross = [edge[1] * v[2] - edge[2] * v[1], edge[2] * v[0] - edge[0] * v[2], edge[0] * v[1] - edge[1] * v[0]]
      const length = Math.hypot(...cross)
      if (length > EPSILON) normal = cross.map((value) => value / length)
    } else if (Math.abs(normal[0] * v[0] + normal[1] * v[1] + normal[2] * v[2]) > EPSILON) return true
  }
  return false
}

/** C++凸包と水平面の交差点を残す。凸包そのものの計算はHavokに任せる。 */
export function clipCollisionHull(positions: Float32Array, indices: Uint32Array, bottomY: number): Float32Array {
  getModelBounds(positions)
  if (!Number.isFinite(bottomY) || indices.length < 12 || indices.length % 3 !== 0 ||
      indices.some((index) => index >= positions.length / 3)) throw new Error('衝突用の凸包または接地面が不正です。')
  const points: number[] = []
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i + 1] >= bottomY) points.push(positions[i], positions[i + 1], positions[i + 2])
  }
  const edges = new Set<string>()
  for (let i = 0; i < indices.length; i += 3) {
    for (let edge = 0; edge < 3; edge += 1) {
      const a = indices[i + edge], b = indices[i + (edge + 1) % 3]
      const key = a < b ? `${a}:${b}` : `${b}:${a}`
      if (edges.has(key)) continue
      edges.add(key)
      const ay = positions[a * 3 + 1], by = positions[b * 3 + 1]
      if (!((ay < bottomY && by > bottomY) || (by < bottomY && ay > bottomY))) continue
      const t = (bottomY - ay) / (by - ay)
      points.push(positions[a * 3] + t * (positions[b * 3] - positions[a * 3]), bottomY,
        positions[a * 3 + 2] + t * (positions[b * 3 + 2] - positions[a * 3 + 2]))
    }
  }
  const result = Float32Array.from(points)
  if (!hasVolume(result)) throw new Error('接地面より上に立体が残るように下端を設定してください。')
  return result
}

/** 表示・衝突・重心を同じ足元座標へ変換し、生成データを変更しない。 */
export function prepareFighterModel({ reconstruction, geometry, placement }: BattleFighterModel): PreparedFighter {
  const { minY, maxY, height, span } = getModelBounds(reconstruction.positions)
  if (height <= MIN_MODEL_HEIGHT) throw new Error('モデルの高さが足りないため、対戦用の大きさを決められません。')
  if (!Object.values(placement).every(Number.isFinite) || placement.scale <= 0 ||
      placement.bottomY < minY || placement.bottomY > maxY) {
    throw new Error('補正値と倍率は正の有限数、下端はモデルの高さの範囲内にしてください。')
  }
  if (geometry.centerOfMass.length !== 3 || !geometry.centerOfMass.every(Number.isFinite) ||
      reconstruction.indices.length < 12 || reconstruction.indices.length % 3 !== 0 ||
      reconstruction.indices.some((index) => index >= reconstruction.positions.length / 3) ||
      (reconstruction.normals && (reconstruction.normals.length !== reconstruction.positions.length ||
        !reconstruction.normals.every(Number.isFinite)))) throw new Error('モデルまたは形状解析が不正です。')

  const cosine = Math.cos(placement.yaw), sine = Math.sin(placement.yaw)
  const transform = (x: number, y: number, z: number): [number, number, number] => [
    (cosine * x + sine * z) * placement.scale + placement.offsetX,
    (y - placement.bottomY) * placement.scale,
    (-sine * x + cosine * z) * placement.scale + placement.offsetZ,
  ]
  const transformPositions = (input: Float32Array) => {
    const output = new Float32Array(input.length)
    for (let i = 0; i < input.length; i += 3) output.set(transform(input[i], input[i + 1], input[i + 2]), i)
    if (!output.every(Number.isFinite)) throw new Error('補正値が大きすぎます。')
    return output
  }
  // geometry-wasmの結果は最長軸1の座標。表示メッシュの座標系へ戻してから切断する。
  const hull = geometry.hullPositions.map((value) => value * span)
  const clipped = clipCollisionHull(hull, geometry.hullIndices, placement.bottomY)
  const normals = reconstruction.normals?.slice()
  if (normals) for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i], z = normals[i + 2]
    normals[i] = cosine * x + sine * z
    normals[i + 2] = -sine * x + cosine * z
  }
  const collisionPositions = transformPositions(clipped)
  // 交点のFloat32丸めで接地面をわずかに下回る場合だけ0へ戻す。
  for (let i = 1; i < collisionPositions.length; i += 3) collisionPositions[i] = Math.max(0, collisionPositions[i])
  return {
    reconstruction: { positions: transformPositions(reconstruction.positions), indices: reconstruction.indices, normals },
    collisionPositions,
    centerOfMass: transform(...geometry.centerOfMass.map((value) => value * span) as [number, number, number]),
  }
}
