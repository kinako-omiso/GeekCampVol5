/** Scannee の絵の座標系。見本（docs/design）のコマと同じ 220×200 */
export const SCANNEE_VIEW = { width: 220, height: 200 } as const

/** 220×200 の座標での四角 */
export type ScanneeBox = { x: number; y: number; width: number; height: number }

/** 1体ぶんの見た目。目は画面ごとに表情を変えるので、体とは別に重ねる */
export type ScanneeLook = {
  // 目のないコマの絵（220×200）
  bodyUrl: string
  // 輪郭の SVG パス（220×200 の座標）。スキャン中の点線に使う
  outline: string
  // 目を置く場所
  eyes: ScanneeBox
  // 絵がある範囲（厚みを含む）。地面に立たせる・王冠をのせる位置の計算に使う
  bounds: ScanneeBox
}
