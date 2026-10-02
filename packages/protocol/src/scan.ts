import { z } from 'zod'

export const SCAN_DIRECTIONS = ['front', 'right', 'back', 'left'] as const
export const scanDirectionSchema = z.enum(SCAN_DIRECTIONS)
export type ScanDirection = z.infer<typeof scanDirectionSchema>
export const selectionStrokeSchema = z.object({
  mode: z.enum(['add', 'remove']),
  points: z.array(z.object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  })).min(1).max(4096),
})
export type SelectionStroke = z.infer<typeof selectionStrokeSchema>
const strokes = z.array(selectionStrokeSchema).min(1).max(256)
export const maskRevisionsSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative(),
  z.number().int().nonnegative(), z.number().int().nonnegative()])

export const scanControlSchemas = [
  z.object({ type: z.literal('sensor-enabled') }),
  z.object({ type: z.literal('sensor-ready') }),
  z.object({ type: z.literal('sensor-reset') }),
  z.object({ type: z.literal('scan-start'), scanId: z.string().uuid(),
    photoIds: z.array(z.string().uuid()).length(4).refine((ids) => new Set(ids).size === 4),
    frontPhotoId: z.string().uuid(), strokes,
  }).refine((value) => value.photoIds.includes(value.frontPhotoId) && value.strokes.some((stroke) => stroke.mode === 'add')),
  z.object({ type: z.literal('scan-revise'), scanId: z.string().uuid(), direction: scanDirectionSchema,
    revision: z.number().int().positive(), strokes }),
  z.object({ type: z.literal('scan-confirm'), scanId: z.string().uuid(), revisions: maskRevisionsSchema }),
  z.object({ type: z.literal('scan-retry'), scanId: z.string().uuid() }),
  z.object({ type: z.literal('scan-resend-masks'), scanId: z.string().uuid() }),
  z.object({ type: z.literal('scan-revision-failed'), scanId: z.string().uuid(), direction: scanDirectionSchema,
    revision: z.number().int().positive(), reason: z.string() }),
  z.object({ type: z.literal('mask-ready'), scanId: z.string().uuid(), direction: scanDirectionSchema,
    revision: z.number().int().nonnegative(), transferId: z.string(), strokes,
    needsReview: z.boolean(), empty: z.boolean(), reason: z.string(),
  }),
  z.object({ type: z.literal('flow-state'), roundId: z.string().uuid(),
    phase: z.enum(['join', 'capture', 'processing', 'review', 'waiting', 'battle', 'result']),
    scanId: z.string().uuid().optional(), paused: z.boolean(), resumeSeconds: z.number().int().min(0).max(3),
    message: z.string(), winner: z.union([z.literal(1), z.literal(2), z.literal('draw')]).optional(),
  }),
  z.object({ type: z.literal('feedback'), effect: z.enum(['hit', 'damage', 'defeat']) }),
] as const

/** 正面を先頭へ移し、残りは撮影順のまま右・背面・左に割り当てる。 */
export function assignScanDirections<T>(photos: readonly T[], front: T): Record<ScanDirection, T> {
  if (photos.length !== 4 || new Set(photos).size !== 4 || !photos.includes(front)) {
    throw new Error('異なる写真4枚から正面を選択してください。')
  }
  const ordered = [front, ...photos.filter((photo) => photo !== front)]
  return Object.fromEntries(SCAN_DIRECTIONS.map((direction, index) => [direction, ordered[index]])) as Record<ScanDirection, T>
}
