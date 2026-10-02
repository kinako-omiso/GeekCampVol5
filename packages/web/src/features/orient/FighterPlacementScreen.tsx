import { useEffect, useMemo, useRef, useState } from 'react'
import { getModelBounds, prepareFighterModel } from '../battle/game/fighterPlacement'
import type { BattleFighterModel, FighterPlacement } from '../battle/game/fighterPlacement'
import type { mountFighterPlacementPreview } from './fighterPlacementPreview'
import './fighterPlacement.css'

const SCALE_STEP = 1.1
const MIN_SCALE_RATIO = 0.5
const MAX_SCALE_RATIO = 2

type Props = {
  model: Omit<BattleFighterModel, 'placement'>
  placement: FighterPlacement
  defaultPlacement: FighterPlacement
  onChange: (placement: FighterPlacement) => void
  onConfirm: () => void
  onBack: () => void
}

/** 操作元に依存しない配置確認。将来はスマホ入力も同じ補正データへ反映する。 */
export function FighterPlacementScreen({ model, placement, defaultPlacement, onChange, onConfirm, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<ReturnType<typeof mountFighterPlacementPreview> | null>(null)
  const [ready, setReady] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const result = useMemo(() => {
    try { return { prepared: prepareFighterModel({ ...model, placement }), error: '' } }
    catch (cause) { return { prepared: null, error: cause instanceof Error ? cause.message : '配置を確認できませんでした。' } }
  }, [model, placement])
  const preparedRef = useRef(result.prepared)
  const bounds = getModelBounds(model.reconstruction.positions)

  useEffect(() => {
    let cancelled = false
    void import('./fighterPlacementPreview').then(({ mountFighterPlacementPreview }) => {
      if (cancelled || !canvasRef.current) return
      const preview = mountFighterPlacementPreview(canvasRef.current)
      previewRef.current = preview
      if (preparedRef.current) preview.setModel(preparedRef.current)
      setReady(true)
    }).catch((cause: unknown) => {
      if (!cancelled) setPreviewError(cause instanceof Error ? cause.message : '配置プレビューを表示できませんでした。')
    })
    return () => { cancelled = true; previewRef.current?.dispose(); previewRef.current = null }
  }, [])
  useEffect(() => {
    preparedRef.current = result.prepared
    if (result.prepared) previewRef.current?.setModel(result.prepared)
  }, [result.prepared])

  const numberValue = (value: number) => Number.isFinite(value) ? value : ''
  const update = (key: keyof FighterPlacement, value: number) => onChange({ ...placement, [key]: value })
  const minScale = defaultPlacement.scale * MIN_SCALE_RATIO
  const maxScale = defaultPlacement.scale * MAX_SCALE_RATIO
  const validScale = Number.isFinite(placement.scale) && placement.scale > 0
  const changeScale = (factor: number) => onChange({ ...placement,
    scale: Math.max(minScale, Math.min(maxScale, placement.scale * factor)) })
  return <section className="fighter-placement" aria-label="モデルの配置調整">
    <h2>02 · 正面・大きさ・接地面を確認</h2>
    <p>青いマーカーが攻撃方向、水色の面が接地面、黄色の点が生成時の重心です。下端より下の形は残し、衝突判定からだけ除外します。</p>
    <canvas ref={canvasRef} aria-label="配置と接地面の3Dプレビュー" />
    <p>ドラッグとホイールは閲覧用のカメラ操作です。対戦中の大きさは下のボタンで調整します。</p>
    <div className="fighter-placement__scale">
      <strong>モデルの大きさ</strong>
      <p>倍率 {validScale ? placement.scale.toFixed(2) : '不正'}倍 / 高さ {validScale ? (bounds.height * placement.scale).toFixed(2) : '不正'}（サンプル {Number.isFinite(defaultPlacement.scale) ? (bounds.height * defaultPlacement.scale).toFixed(2) : '不正'}）</p>
      <div className="fighter-placement__scale-actions">
        <button type="button" disabled={!validScale || placement.scale <= minScale} onClick={() => changeScale(1 / SCALE_STEP)}>縮小</button>
        <button type="button" disabled={!validScale || placement.scale >= maxScale} onClick={() => changeScale(SCALE_STEP)}>拡大</button>
        <button type="button" onClick={() => onChange({ ...placement, scale: defaultPlacement.scale })}>サンプルの高さに戻す</button>
      </div>
    </div>
    <div className="fighter-placement__controls">
      <label>正面補正（°）<input type="number" step="1" value={numberValue(placement.yaw * 180 / Math.PI)} onChange={(event) => update('yaw', event.currentTarget.valueAsNumber * Math.PI / 180)} />
        <input aria-label="正面補正スライダー" type="range" min="-360" max="360" step="1" value={Number.isFinite(placement.yaw) ? placement.yaw * 180 / Math.PI : 0} onChange={(event) => update('yaw', event.currentTarget.valueAsNumber * Math.PI / 180)} /></label>
      <label>水平位置 X<input type="number" step="0.01" value={numberValue(placement.offsetX)} onChange={(event) => update('offsetX', event.currentTarget.valueAsNumber)} /></label>
      <label>水平位置 Z<input type="number" step="0.01" value={numberValue(placement.offsetZ)} onChange={(event) => update('offsetZ', event.currentTarget.valueAsNumber)} /></label>
      <label>下端（生成座標のY）<input type="number" min={bounds.minY} max={bounds.maxY} step="any" value={numberValue(placement.bottomY)} onChange={(event) => update('bottomY', event.currentTarget.valueAsNumber)} />
        <input aria-label="下端スライダー" type="range" min={bounds.minY} max={bounds.maxY} step="any" value={Number.isFinite(placement.bottomY) ? placement.bottomY : bounds.minY} onChange={(event) => update('bottomY', event.currentTarget.valueAsNumber)} /></label>
    </div>
    {(result.error || previewError) && <p role="alert">{result.error || previewError}</p>}
    {!ready && !previewError && <p role="status">配置プレビューを準備しています…</p>}
    <div className="fighter-placement__actions">
      <button type="button" onClick={onBack}>モデル作成へ戻る</button>
      <button type="button" onClick={() => onChange({ ...defaultPlacement })}>自動設定に戻す</button>
      <button type="button" disabled={!ready || !!previewError || !result.prepared} onClick={onConfirm}>この配置で対戦を確認</button>
    </div>
  </section>
}
