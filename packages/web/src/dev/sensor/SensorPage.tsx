import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  calibrate,
  createTiltNormalizer,
  getScreenAngle,
  isLandscape,
  requestMotionPermission,
  subscribeOrientation,
  subscribeScreenAngle,
  type Baseline,
  type MotionPermission,
  type RawOrientation,
  type ScreenAngle,
  type TiltVector,
} from '../../lib/sensor'

type Status = 'idle' | MotionPermission

const RESTART_LABELS = {
  moved: '動いたので計測をやり直しました',
  portrait: '横持ちにしてください',
  rotated: '向きが変わったので計測をやり直しました',
} as const

/**
 * /dev/sensor：傾きの生値と補正後の値を表示する検証ページ。
 */
export function SensorPage() {
  const [status, setStatus] = useState<Status>('idle')
  const [raw, setRaw] = useState<RawOrientation | null>(null)
  const [angle, setAngle] = useState<ScreenAngle>(() => getScreenAngle())
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [progress, setProgress] = useState(0)
  const [calibrationMessage, setCalibrationMessage] = useState('')
  const [vector, setVector] = useState<TiltVector | null>(null)
  const [eventRate, setEventRate] = useState(0)

  const normalizerRef = useRef<ReturnType<typeof createTiltNormalizer> | null>(null)
  const calibrationRef = useRef<AbortController | null>(null)
  const eventCountRef = useRef(0)

  // 許可が取れたら、生値の購読と1秒ごとのイベント数の集計を始める
  useEffect(() => {
    if (status !== 'granted') return

    const unsubscribeOrientation = subscribeOrientation((orientation) => {
      eventCountRef.current += 1
      const currentAngle = getScreenAngle()
      setRaw(orientation)
      setAngle(currentAngle)
      if (normalizerRef.current) {
        setVector(normalizerRef.current(orientation, currentAngle))
      }
    })
    const unsubscribeAngle = subscribeScreenAngle(setAngle)
    const timer = window.setInterval(() => {
      setEventRate(eventCountRef.current)
      eventCountRef.current = 0
    }, 1000)

    return () => {
      unsubscribeOrientation()
      unsubscribeAngle()
      window.clearInterval(timer)
    }
  }, [status])

  // ページを離れたら基準姿勢の計測を止める
  useEffect(() => () => calibrationRef.current?.abort(), [])

  const startCalibration = () => {
    calibrationRef.current?.abort()
    const controller = new AbortController()
    calibrationRef.current = controller

    normalizerRef.current = null
    setBaseline(null)
    setVector(null)
    setProgress(0)
    setCalibrationMessage('横持ちで1秒間静止してください')

    calibrate({
      signal: controller.signal,
      onProgress: setProgress,
      onRestart: (reason) => setCalibrationMessage(RESTART_LABELS[reason]),
    })
      .then((result) => {
        normalizerRef.current = createTiltNormalizer(result)
        setBaseline(result)
        setCalibrationMessage('基準姿勢を取得しました')
      })
      .catch(() => {
        // 取り直し・ページ離脱で中断したときは何もしない
      })
  }

  // iOS では requestPermission をクリックの中で直接呼ぶ必要がある
  const handleEnable = async () => {
    const result = await requestMotionPermission()
    setStatus(result)
    if (result === 'granted') startCalibration()
  }

  return (
    <main style={styles.page}>
      <h1 style={styles.heading}>/dev/sensor</h1>

      {status !== 'granted' && (
        <button type="button" style={styles.button} onClick={handleEnable}>
          センサーを有効化
        </button>
      )}
      {status === 'denied' && <p style={styles.warning}>許可されませんでした。タブを閉じて開き直してください。</p>}
      {status === 'unsupported' && <p style={styles.warning}>この端末は傾きの取得に対応していません。</p>}

      {status === 'granted' && (
        <>
          {!isLandscape(angle) && <p style={styles.warning}>横持ちにしてください</p>}

          <section style={styles.section}>
            <h2 style={styles.subheading}>生値</h2>
            <dl style={styles.list}>
              <dt>alpha</dt>
              <dd>{format(raw?.alpha)}</dd>
              <dt>beta</dt>
              <dd>{format(raw?.beta)}</dd>
              <dt>gamma</dt>
              <dd>{format(raw?.gamma)}</dd>
              <dt>画面の向き</dt>
              <dd>{angle}°</dd>
              <dt>イベント数</dt>
              <dd>{eventRate} 回/秒</dd>
            </dl>
            {eventRate === 0 && <p style={styles.note}>値が届いていません（PCの場合は DevTools の Sensors で確認）</p>}
          </section>

          <section style={styles.section}>
            <h2 style={styles.subheading}>基準姿勢</h2>
            <p>{calibrationMessage}</p>
            {!baseline && <progress value={progress} max={1} />}
            {baseline && (
              <dl style={styles.list}>
                <dt>beta</dt>
                <dd>{format(baseline.beta)}</dd>
                <dt>gamma</dt>
                <dd>{format(baseline.gamma)}</dd>
                <dt>画面の向き</dt>
                <dd>{baseline.angle}°</dd>
              </dl>
            )}
            <button type="button" style={styles.button} onClick={startCalibration}>
              基準を取り直す
            </button>
          </section>

          <section style={styles.section}>
            <h2 style={styles.subheading}>移動ベクトル</h2>
            <dl style={styles.list}>
              <dt>x（右が正）</dt>
              <dd>{format(vector?.x, 3)}</dd>
              <dt>y（奥が正）</dt>
              <dd>{format(vector?.y, 3)}</dd>
            </dl>
            {baseline && !vector && <p style={styles.note}>基準を取ったときと向きが違うため停止中</p>}
            <div style={styles.stick}>
              <div style={styles.crossX} />
              <div style={styles.crossY} />
              {vector && (
                <div
                  style={{
                    ...styles.dot,
                    left: `${((vector.x + 1) / 2) * 100}%`,
                    top: `${((1 - vector.y) / 2) * 100}%`,
                  }}
                />
              )}
            </div>
          </section>
        </>
      )}
    </main>
  )
}

function format(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? '-' : value.toFixed(digits)
}

const styles = {
  page: { padding: 16, maxWidth: 480, margin: '0 auto', textAlign: 'left' },
  heading: { fontSize: 20, margin: '0 0 12px' },
  subheading: { fontSize: 16, margin: '0 0 8px' },
  section: { marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' },
  list: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', margin: 0, fontFamily: 'var(--mono)' },
  button: { marginTop: 8, padding: '12px 20px', fontSize: 16 },
  warning: { color: '#d33', fontWeight: 'bold' },
  note: { fontSize: 14 },
  stick: {
    position: 'relative',
    width: 200,
    height: 200,
    marginTop: 12,
    border: '2px solid var(--border)',
    borderRadius: '50%',
  },
  crossX: { position: 'absolute', left: 0, right: 0, top: '50%', borderTop: '1px dashed var(--border)' },
  crossY: { position: 'absolute', top: 0, bottom: 0, left: '50%', borderLeft: '1px dashed var(--border)' },
  dot: {
    position: 'absolute',
    width: 20,
    height: 20,
    marginLeft: -10,
    marginTop: -10,
    borderRadius: '50%',
    background: 'var(--accent)',
  },
} satisfies Record<string, CSSProperties>
