// スマホが共有する型とZodスキーマを定義
import { z } from 'zod'

export const PROTOCOL_VERSION = '0.1.0' as const

// プレイヤー番号のスキーマ
export const playerSlotSchema = z.union([
  z.literal(1),
  z.literal(2),
])

export type PlayerSlot = z.infer<typeof playerSlotSchema>

// 接続時に渡すデータのスキーマ
export const pairingMetadataSchema = z.object({
  slot: playerSlotSchema,
  token: z.string().regex(/^[0-9a-f]{32}$/i),
  protocolVersion: z.literal(PROTOCOL_VERSION),
})

export type PairingMetadata = z.infer<
  typeof pairingMetadataSchema
>

// データ判別のスキーマ
export const controlMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('connection-accepted'),
    slot: playerSlotSchema,
  }),
  z.object({
    type: z.literal('connection-rejected'),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('heartbeat'),
  }),
])

export type ControlMessage = z.infer<
  typeof controlMessageSchema
>