export type SilhouetteMask = {
  width: number
  height: number
  data: Uint8Array
}

export type ReconstructionResult = {
  positions: Float32Array
  indices: Uint32Array
  normals?: Float32Array
}

export type QuickScanMetrics = {
  contourMs: number
  meshMs: number
  vertexCount: number
  triangleCount: number
}

export type QuickScanOutput = {
  reconstruction: ReconstructionResult & { normals: Float32Array }
  metrics: QuickScanMetrics
}
