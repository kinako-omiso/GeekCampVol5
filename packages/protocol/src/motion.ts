/** スマホ側で補正した移動入力。x は画面右、y は画面奥が正。 */
export type MotionMessage = {
  type: 'motion'
  x: number
  y: number
}

export function isMotionMessage(value: unknown): value is MotionMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  return message.type === 'motion' &&
    typeof message.x === 'number' && Number.isFinite(message.x) && Math.abs(message.x) <= 1 &&
    typeof message.y === 'number' && Number.isFinite(message.y) && Math.abs(message.y) <= 1
}
