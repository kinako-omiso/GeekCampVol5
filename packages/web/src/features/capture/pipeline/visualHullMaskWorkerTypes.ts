import type { SilhouetteMask } from '../../analyze/reconstruction/types'
import type { SelectionStroke } from './photoSegmenter'
import type { MaskQuality } from './maskQuality'
import type { NormalizedPoint } from './visualHullCandidateSearch'

export type MaskWorkerRequest =
  | { type: 'register'; frameId: number; bitmap: ImageBitmap }
  | { type: 'remove'; frameId: number }
  | { type: 'segment'; jobId: number; frameId: number; strokes: SelectionStroke[] }
  | { type: 'auto'; jobId: number; frameId: number; referenceFrameId: number; referenceMask: SilhouetteMask; selected: NormalizedPoint }
  | { type: 'benchmark'; jobId: number; frameId: number; strokes: SelectionStroke[] }

export type MaskTimings = {
  modelLoadMs: number
  resizeMs: number
  setImageMs: number
  segmentMs: number
  conversionMs: number
  totalMs: number
  searchMs?: number
  attempts?: number
}
export type MaskWorkerResponse =
  | { type: 'mask'; jobId: number; frameId: number; mask: SilhouetteMask; quality: MaskQuality; timings: MaskTimings; seed?: NormalizedPoint }
  | { type: 'benchmark'; jobId: number; frameId: number; cpuMs: number; gpuMs?: number; iou?: number; error?: string }
  | { type: 'error'; jobId: number; frameId: number; error: string }
