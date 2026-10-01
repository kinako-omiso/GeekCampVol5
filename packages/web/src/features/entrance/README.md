# entrance
PC：登場演出。対戦の前に、両者のコマを 1P → 2P の順に大写しして能力値を見せる。

- `EntranceScreen.tsx`：登場演出の画面。コマの見た目と能力値を props で受け取り、1人ずつ1回再生して、終わったら `onDone` を呼ぶ。見本は docs/design/screens/pc-04-entrance.html
  - コマはいまは 2D の絵（見本のコマを仮置き）。3D のコマ（空から落ちてきて着地する）は別 issue で差し替える
  - ★の数は倍率 0.80〜1.25 を5段階、タイプ名は一番高い能力値から決める（どちらも docs/design/README.md の案）
