export type PingMessage = {
  type: 'ping'
  sentAt: number
}

export type PongMessage = {
  type: 'pong'
  sentAt: number
  receivedAt: number
}

export type HeartbeatMessage = {
  type: 'heartbeat'
}

export type TestMessage =
  | PingMessage
  | PongMessage
  | HeartbeatMessage

export function isTestMessage(value: unknown): value is TestMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false
  }

  const message = value as Record<string, unknown>

  return (
    (message.type === 'heartbeat') ||
    (message.type === 'ping' && typeof message.sentAt === 'number') ||
    (message.type === 'pong' &&
      typeof message.sentAt === 'number' &&
      typeof message.receivedAt === 'number')
  )
}