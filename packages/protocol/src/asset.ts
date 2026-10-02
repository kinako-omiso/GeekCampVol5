import { z } from 'zod'
import { scanDirectionSchema } from './scan.ts'

// 一回で送るデータ量と最大のデータ量を定義
export const ASSET_CHUNK_SIZE = 12 * 1024
export const MAX_ASSET_BYTES = 5 * 1024 * 1024

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
