import { z } from 'zod'
import { scanDirectionSchema } from './scan.ts'

// 一回で送るデータ量と最大のデータ量を定義
export const ASSET_CHUNK_SIZE = 12 * 1024
export const MAX_ASSET_BYTES = 5 * 1024 * 1024

// スマホで撮る写真の向き。撮影もこの順番で行う
export const CAPTURE_VIEWS = ['front', 'right', 'back', 'left'] as const
export const MAX_CAPTURE_SELECTION_STROKES = 32
export const MAX_CAPTURE_SELECTION_POINTS = 256

export const captureViewSchema = z.enum(CAPTURE_VIEWS)

export type CaptureView = z.infer<typeof captureViewSchema>

// 写真の幅・高さを1としたときの位置（0〜1）。PCで縮小しても同じ位置を指す
export const captureSelectionPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})

// add は対象（前景）、remove は背景の指定
export const captureSelectionStrokeSchema = z.object({
  mode: z.union([
    z.literal('add'),
    z.literal('remove'),
  ]),
  points: z.array(captureSelectionPointSchema)
    .min(1)
    .max(MAX_CAPTURE_SELECTION_POINTS),
})

export type CaptureSelectionStroke = z.infer<
  typeof captureSelectionStrokeSchema
>

// 4方向の写真を1組として送るための情報。範囲指定は正面の写真にだけ付ける
export const captureInfoSchema = z.object({
  setId: z.string().min(1),
  view: captureViewSchema,
  selection: z.array(captureSelectionStrokeSchema)
    .min(1)
    .max(MAX_CAPTURE_SELECTION_STROKES)
    .optional(),
}).refine(
  (capture) => capture.view === 'front' || capture.selection === undefined,
  { message: '範囲指定は正面の写真にだけ付けられます' },
)

export type CaptureInfo = z.infer<typeof captureInfoSchema>

export const assetManifestSchema = z.object({
  transferId: z.string().min(1),
  kind: z.union([
    z.literal('photo'),
    z.literal('mask'),
  ]),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  byteLength: z.number()
    .int()
    .positive()
    .max(MAX_ASSET_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
  chunkCount: z.number().int().positive(),
  width: z.number().int().positive().max(2048),
  height: z.number().int().positive().max(2048),
  scan: z.object({ scanId: z.string().uuid(), photoId: z.string().uuid(),
    direction: scanDirectionSchema, revision: z.number().int().nonnegative() }).optional(),
  // スマホの撮影画面から送る写真だけに付く
  capture: captureInfoSchema.optional(),
})

export type AssetManifest = z.infer<
  typeof assetManifestSchema
>

export const assetMessageSchema =
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('asset-manifest'),
      manifest: assetManifestSchema,
    }),

    z.object({
      type: z.literal('asset-manifest-received'),
      transferId: z.string().min(1),
    }),

    z.object({
      type: z.literal('asset-chunk'),
      transferId: z.string().min(1),
      index: z.number().int().nonnegative(),
      data: z.instanceof(ArrayBuffer),
    }),

    z.object({
      type: z.literal('asset-chunk-received'),
      transferId: z.string().min(1),
      index: z.number().int().nonnegative(),
    }),

    z.object({
      type: z.literal('asset-complete'),
      transferId: z.string().min(1),
    }),

    z.object({
      type: z.literal('asset-received'),
      transferId: z.string().min(1),
    }),

    z.object({
      type: z.literal('asset-rejected'),
      transferId: z.string().min(1),
      reason: z.string(),
    }),
  ])

export type AssetMessage = z.infer<
  typeof assetMessageSchema
>

export function isAssetMessage(
  value: unknown,
): value is AssetMessage {
  return assetMessageSchema.safeParse(value).success
}
