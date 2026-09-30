import createModule from '../dist/reconstruction.mjs'
import { orientClosedMesh } from './meshWinding.ts'

export type SilhouetteMask = { width: number; height: number; data: Uint8Array }
export type ReconstructionCamera = {
  intrinsics: Float32Array
  rotation: Float32Array
  translation: Float32Array
  imageWidth: number
  imageHeight: number
}
export type ReconstructionView = { mask: SilhouetteMask; camera: ReconstructionCamera }
export type ReconstructionResult = { positions: Float32Array; indices: Uint32Array; normals: Float32Array }
export type VoxelSide = 96 | 128 | 160
export type VisualHullOptions = {
  voxelSide?: VoxelSide
  surface?: 'binary' | 'interpolated'
  adaptiveBounds?: boolean
}
export type VisualHullOutput = {
  reconstruction: ReconstructionResult
  occupancy: Uint8Array
  /** 正規化メッシュから撮影時の世界座標へ戻すための [中心X, 底面Y, 中心Z, 縮尺]。 */
  normalization: [number, number, number, number]
  metrics: {
    voxelSide: VoxelSide
    voxelCount: number
    vertexCount: number
    triangleCount: number
    carvingAndMeshMs: number
    clipped: boolean
    windingCorrections: number
    sealedFaces: number
  }
}
export const DEFAULT_VOXEL_SIDE: VoxelSide = 96
export const VOXEL_SIDE = DEFAULT_VOXEL_SIDE

let modulePromise: ReturnType<typeof createModule> | undefined
function getModule() {
  modulePromise ??= createModule({ locateFile: (name) => name.endsWith('.wasm')
    ? new URL('../dist/reconstruction.wasm', import.meta.url).href : name })
  return modulePromise
}

/** 画像上端を下方向、世界座標のYを上方向とする固定の透視カメラ。 */
export function createFixedCamera(width: number, height: number, yawDegrees: number, radius = 2, fovDegrees = 50): ReconstructionCamera {
  const yaw = yawDegrees * Math.PI / 180
  const s = Math.sin(yaw), c = Math.cos(yaw)
  const focal = height / (2 * Math.tan(fovDegrees * Math.PI / 360))
  return {
    intrinsics: new Float32Array([focal, 0, (width - 1) / 2, 0, focal, (height - 1) / 2, 0, 0, 1]),
    rotation: new Float32Array([c, 0, -s, 0, -1, 0, -s, 0, -c]),
    translation: new Float32Array([0, 0, radius]),
    imageWidth: width, imageHeight: height,
  }
}

export async function reconstructVisualHull(
  views: readonly ReconstructionView[], options: VisualHullOptions = {},
): Promise<VisualHullOutput> {
  if (views.length < 4 || views.length > 8) throw new Error('Maskは4～8方向分を指定してください。')
  const voxelSide = options.voxelSide ?? DEFAULT_VOXEL_SIDE
  if (voxelSide !== 96 && voxelSide !== 128 && voxelSide !== 160) throw new Error('Voxel解像度が正しくありません。')
  const smooth = options.surface === 'interpolated' ? 1 : 0
  const adaptive = options.adaptiveBounds === false ? 0 : 1
  let bytes = 0
  for (const { mask, camera } of views) {
    if (!Number.isInteger(mask.width) || !Number.isInteger(mask.height) || mask.width < 8 || mask.height < 8 ||
      mask.width > 2048 || mask.height > 2048 || mask.data.length !== mask.width * mask.height ||
      !mask.data.some((value) => value !== 0)) throw new Error('空または不正なMaskがあります。')
    if (camera.imageWidth !== mask.width || camera.imageHeight !== mask.height ||
      camera.intrinsics.length !== 9 || camera.rotation.length !== 9 || camera.translation.length !== 3 ||
      ![...camera.intrinsics, ...camera.rotation, ...camera.translation].every(Number.isFinite) ||
      camera.intrinsics[0] <= 0 || camera.intrinsics[4] <= 0) throw new Error('Camera Poseまたは画像寸法が正しくありません。')
    bytes += mask.data.byteLength
  }
  const module = await getModule()
  const count = views.length
  const pointers = [module._malloc(bytes), module._malloc(count * 4), module._malloc(count * 4), module._malloc(count * 4), module._malloc(count * 21 * 4)]
  if (pointers.some((value) => !value)) {
    pointers.forEach((value) => { if (value) module._free(value) })
    throw new Error('Visual Hullのメモリを確保できませんでした。')
  }
  try {
    let offset = 0
    views.forEach(({ mask, camera }, index) => {
      module.HEAPU8.set(mask.data, pointers[0] + offset)
      module.HEAP32[pointers[1] / 4 + index] = offset
      module.HEAP32[pointers[2] / 4 + index] = mask.width
      module.HEAP32[pointers[3] / 4 + index] = mask.height
      module.HEAPF32.set(camera.intrinsics, pointers[4] / 4 + index * 21)
      module.HEAPF32.set(camera.rotation, pointers[4] / 4 + index * 21 + 9)
      module.HEAPF32.set(camera.translation, pointers[4] / 4 + index * 21 + 18)
      offset += mask.data.byteLength
    })
    const started = performance.now()
    const status = module._recon_build_options(pointers[0], pointers[1], pointers[2], pointers[3], pointers[4],
      count, voxelSide, smooth, adaptive)
    if (status !== 0) throw new Error(status === 2 ? '交差する領域がありません。写真とCamera Poseを確認してください。' :
      status === 3 ? 'メッシュが複雑すぎるか、生成できませんでした。' : '入力またはCamera Poseが正しくありません。')
    const ms = performance.now() - started
    const vertices = module._recon_vertex_count(), indices = module._recon_index_count()
    const positionPtr = module._recon_positions() / 4, indexPtr = module._recon_indices() / 4
    const side = module._recon_side() as VoxelSide
    const normalization = Array.from(module.HEAPF32.subarray(module._recon_normalization() / 4, module._recon_normalization() / 4 + 4)) as [number, number, number, number]
    const positions = new Float32Array(module.HEAPF32.subarray(positionPtr, positionPtr + vertices * 3))
    const originalIndices = new Uint32Array(module.HEAPU32.subarray(indexPtr, indexPtr + indices))
    const oriented = orientClosedMesh(positions, originalIndices)
    return {
      reconstruction: { positions, indices: oriented.indices, normals: oriented.normals },
      occupancy: new Uint8Array(module.HEAPU8.subarray(module._recon_slice(0), module._recon_slice(0) + side ** 3)),
      normalization,
      metrics: { voxelSide: side, voxelCount: module._recon_occupied(), vertexCount: vertices,
        triangleCount: oriented.indices.length / 3, carvingAndMeshMs: ms, clipped: Boolean(module._recon_clipped()),
        windingCorrections: oriented.correctedFaces, sealedFaces: oriented.sealedFaces },
    }
  } finally {
    pointers.forEach((pointer) => module._free(pointer))
  }
}
