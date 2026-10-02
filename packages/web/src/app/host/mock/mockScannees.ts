import type { ScanneeLook } from '../../../components/scanneeLook'
import type { PlayerId } from '../../../../../../docs/design/tokens'
import mugBodyUrl from './mug-body.svg'
import eraserBodyUrl from './eraser-body.svg'

/**
 * モック：見本のコマ（1P マグカップ・2P 消しゴム）。スキャン結果とつなぐまでの代わり。
 * 体の絵は docs/design/assets/sample-scannee-*.svg から目を抜いたもの。座標は見本と同じ。
 */
export const MOCK_SCANNEES: Record<PlayerId, ScanneeLook> = {
  p1: {
    bodyUrl: mugBodyUrl,
    outline: 'M40 40H140V154Q140 170 124 170H56Q40 170 40 154ZM140 66H158Q182 66 182 96V112Q182 142 158 142H140V124H154Q164 124 164 112V96Q164 84 154 84H140Z',
    eyes: { x: 50, y: 70, width: 80, height: 44 },
    bounds: { x: 40, y: 26, width: 160, height: 144 },
  },
  p2: {
    bodyUrl: eraserBodyUrl,
    outline:
      'M28 78H174Q186 78 186 90V138Q186 150 174 150H28Q16 150 16 138V90Q16 78 28 78ZM86 72H186Q192 72 192 78V150Q192 156 186 156H86Q80 156 80 150V78Q80 72 86 72Z',
    eyes: { x: 18, y: 92, width: 62, height: 34 },
    bounds: { x: 16, y: 56, width: 194, height: 100 },
  },
}
