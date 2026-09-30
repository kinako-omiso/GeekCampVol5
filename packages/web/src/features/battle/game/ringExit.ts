export const RING_RADIUS = 6

/** 境界線上は場内。場外になったコマは再通知しない。 */
export function hasJustLeftRing(x: number, z: number, alreadyOut: boolean, radius = RING_RADIUS): boolean {
  return !alreadyOut && Number.isFinite(x) && Number.isFinite(z) && x * x + z * z > radius * radius
}
