type GeometryModule = {
  HEAPU8: Uint8Array
  HEAPF32: Float32Array
  HEAPU32: Uint32Array
  _malloc(size: number): number
  _free(pointer: number): void
  _geom_analyze(positions: number, vertexCount: number, indices: number, indexCount: number): number
  _geom_value(index: number): number
  _geom_hull_positions(): number
  _geom_hull_indices(): number
  _geom_hull_vertex_count(): number
  _geom_hull_index_count(): number
}
export default function initialize(options?: { locateFile?: (path: string) => string; wasmBinary?: Uint8Array }): Promise<GeometryModule>
