export type MotionPermission = 'granted' | 'denied' | 'unsupported'

// iOS 13以降だけが持つ requestPermission は DOM の型定義に無いので補う
type DeviceOrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

/**
 * モーション権限を要求する。
 * iOS では必ずボタンの onClick から直接呼ぶこと（await や useEffect を挟むと失敗する）。
 * Android など requestPermission が無い環境では、許可済みとして扱う。
 */
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
    return 'unsupported'
  }

  const ctor = DeviceOrientationEvent as DeviceOrientationEventWithPermission
  if (typeof ctor.requestPermission !== 'function') {
    return 'granted'
  }

  try {
    return (await ctor.requestPermission()) === 'granted' ? 'granted' : 'denied'
  } catch {
    // HTTPSでない、ユーザー操作の外から呼んだ、などの場合
    return 'denied'
  }
}
