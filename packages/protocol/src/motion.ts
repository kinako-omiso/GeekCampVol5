import { z } from 'zod'

export const motionMessageSchema = z.object({
  type: z.literal('motion'),

  // unordered通信で古い値を捨てるための通し番号
  sequence: z.number().int().nonnegative(),

  // 右方向が正。範囲は-1〜1
  x: z.number().finite().min(-1).max(1),

  // 奥方向が正。範囲は-1〜1
  y: z.number().finite().min(-1).max(1),
})

export type MotionMessage = z.infer<
  typeof motionMessageSchema
>

export function isMotionMessage(
  value: unknown,
): value is MotionMessage {
  return motionMessageSchema.safeParse(value).success
}
