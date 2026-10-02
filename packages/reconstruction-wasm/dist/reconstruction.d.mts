type ReconstructionModule = {
  HEAPU8: Uint8Array
  HEAPF32: Float32Array
  HEAPU32: Uint32Array
  HEAP32: Int32Array
  _malloc(size: number): number
  _free(pointer: number): void
  _recon_build_options(masks: number, offsets: number, widths: number, heights: number, cameras: number, count: number, side: number, smooth: number, adaptive: number): number
  _recon_build(masks: number, offsets: number, widths: number, heights: number, cameras: number, count: number): number
  _recon_positions(): number
  _recon_indices(): number
  _recon_normals(): number
  _recon_vertex_count(): number
  _recon_index_count(): number
  _recon_occupied(): number
  _recon_slice(z: number): number
  _recon_side(): number
  _recon_normalization(): number
  _recon_clipped(): number
}
export default function initialize(options?: { locateFile?: (path: string) => string; wasmBinary?: Uint8Array }): Promise<ReconstructionModule>
