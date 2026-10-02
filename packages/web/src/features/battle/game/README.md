# game
アリーナ・カメラ・移動・物理・場外判定。Reactの外で動かす。

- `judge.ts`：決着の判定（KO・場外・時間切れと勝者）。React・Babylon に依存しない関数。テストは tests/judge.test.ts
- `arena.ts`：浮島のアリーナの見た目（草の島・岩の側面・まわりの雲・縮小予告のしましま/点線/矢印・縮小後に外を覆う雲）。物理の床は固定サイズのままで、見た目は場外判定と同じ有効半径（`battleRules.ts` の `RING_STAGES`）だけを参照する。空・遠くの山・雲海は `ui/BattleScreen.tsx` の 2D 背景
