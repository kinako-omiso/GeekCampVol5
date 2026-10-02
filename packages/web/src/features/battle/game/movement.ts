export type PlanarVector = { x: number; z: number }
export type MotionInput = { x: number; y: number }
export type MovementState = {
  x: number
  z: number
  yaw: number
  smoothedX: number
  smoothedY: number
}

const MOVE_SPEED = 3
const TURN_SPEED = (240 * Math.PI) / 180
const SMOOTHING_SECONDS = 0.08

/** カメラ基準の入力を地面上の移動と向きに変換する。 */
export function stepMovement(
  state: MovementState,
  input: MotionInput,
  seconds: number,
  right: PlanarVector,
  forward: PlanarVector,
  stats: { moveSpeed: number; turnSpeed: number } = { moveSpeed: 1, turnSpeed: 240 },
): MovementState {
  const blend = 1 - Math.exp(-seconds / SMOOTHING_SECONDS)
  const smoothedX = state.smoothedX + (input.x - state.smoothedX) * blend
  const smoothedY = state.smoothedY + (input.y - state.smoothedY) * blend
  const length = Math.hypot(smoothedX, smoothedY)
  const scale = length > 1 ? 1 / length : 1
  const worldX = (right.x * smoothedX + forward.x * smoothedY) * scale
  const worldZ = (right.z * smoothedX + forward.z * smoothedY) * scale
  let yaw = state.yaw
  if (Math.hypot(worldX, worldZ) > 0.01) {
    const desired = Math.atan2(worldX, worldZ)
    const difference = Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw))
    const maxTurn = TURN_SPEED * (stats.turnSpeed / 240) * seconds
    yaw += Math.max(-maxTurn, Math.min(maxTurn, difference))
  }
  return {
    x: state.x + worldX * MOVE_SPEED * stats.moveSpeed * seconds,
    z: state.z + worldZ * MOVE_SPEED * stats.moveSpeed * seconds,
    yaw,
    smoothedX,
    smoothedY,
  }
}
