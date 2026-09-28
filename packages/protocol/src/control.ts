/** 検証画面で使う攻撃ボタンの押下イベント。 */
export type ControlMessage = {
  type: 'attack'
  button: 'a' | 'b'
}

export function isControlMessage(value: unknown): value is ControlMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  return message.type === 'attack' && (message.button === 'a' || message.button === 'b')
}
