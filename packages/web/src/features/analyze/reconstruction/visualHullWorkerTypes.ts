import type { ReconstructionView, VisualHullOutput } from '@gikcamp/reconstruction-wasm'
import type { GeometryResult } from '@gikcamp/geometry-wasm'

export type VisualHullRequest = { id: number; views: ReconstructionView[] }
export type VisualHullResponse =
  | { id: number; output: VisualHullOutput; geometry: GeometryResult | null; geometryError?: string }
  | { id: number; error: string }
