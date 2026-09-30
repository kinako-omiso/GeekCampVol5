import type { ReconstructionView, VisualHullOptions, VisualHullOutput } from '@gikcamp/reconstruction-wasm'
import type { GeometryResult } from '@gikcamp/geometry-wasm'

export type VisualHullRequest = { id: number; views: ReconstructionView[]; options: VisualHullOptions }
export type VisualHullResponse =
  | { id: number; output: VisualHullOutput; geometry: GeometryResult | null; geometryError?: string;
    timings: { reconstructionMs: number; geometryMs: number; totalWorkerMs: number } }
  | { id: number; error: string }
