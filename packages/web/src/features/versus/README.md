# versus
PC：VS → 3・2・1・GO!。登場演出のあと、対戦を始める前に両者を並べてカウントダウンする。

- `VersusScreen.tsx`：VS とカウントダウンの画面。コマの見た目と能力値（タイプ名に使う）を props で受け取り、1回だけ再生して、終わったら `onDone` を呼ぶ。見本は docs/design/screens/pc-05-vs-countdown.html
  - DOM（2D）で作る。コマはいまは 2D の絵（見本のコマを仮置き）
