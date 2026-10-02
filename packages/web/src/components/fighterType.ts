import type { FighterStats } from '@gikcamp/protocol'

// タイプ名の候補。並びは登場演出の能力バッジと同じ（同じ値なら前のもの）
const TYPES: { key: 'attack' | 'reach' | 'moveSpeed'; name: string }[] = [
  { key: 'attack', name: 'パワータイプ' },
  { key: 'reach', name: 'リーチタイプ' },
  { key: 'moveSpeed', name: 'スピードタイプ' },
]

/**
 * コマのタイプ名。一番高い能力値から決める（docs/design/README.md「仕様書との差分」13 の案）。
 * 登場演出と VS で同じ名前を出す
 */
export function fighterTypeFor(stats: FighterStats) {
  return TYPES.reduce((best, type) => (stats[type.key] > stats[best.key] ? type : best)).name
}
