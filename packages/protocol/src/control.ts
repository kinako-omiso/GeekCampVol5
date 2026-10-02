// PCとスマホが共有する接続制御メッセージとZodスキーマを定義
import { z } from 'zod'
import { scanControlSchemas } from './scan.ts'

export const PROTOCOL_VERSION = '0.2.0' as const

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

// 接続管理と検証画面の操作に使うメッセージ
export const controlMessageSchema = z.discriminatedUnion('type', [
  ...scanControlSchemas,
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
  z.object({
    type: z.literal('attack'),
    button: z.union([
      z.literal('a'),
      z.literal('b'),
    ]),
  }),
])

export type ControlMessage = z.infer<
  typeof controlMessageSchema
>

export function isControlMessage(
  value: unknown,
): value is ControlMessage {
  return controlMessageSchema.safeParse(value).success
}
