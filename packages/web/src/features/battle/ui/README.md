# ui
HPバー・残り時間・能力値の表示。

- `BattleHud.tsx`：対戦HUD。Babylon の canvas の上に重ねる（HostStage の中に置く）。値は props で受け取るだけで、game/ には触らない。確認は /dev/battle-hud。
- `FinishOverlay.tsx`：決着の演出。対戦画面（canvas と HUD）の上に重ね、`game/judge.ts` の決着理由で「KO!」「おっこちた!」「タイムアップ!」を切り替える。1回だけ再生して `onDone` を呼ぶ。見本は docs/design/screens/pc-08-finish.html
  - コマが飛ぶ・落ちる動き、カメラの寄り、コマだけ明るくする暗転は 3D 側の担当（ここでは 2D の文字・衝撃・帯だけ）
