# MediaPipe同梱資産

Quick Scanの領域分割に使用する。公開画面では、このディレクトリの資産を同じ配信元から読み込む。

- ライブラリ：@mediapipe/tasks-vision 1.0.1（Apache-2.0）
- Wasm：上記npmパッケージの wasm/vision_wasm_internal.js と .wasm、および vision_wasm_nosimd_internal.js と .wasm
- モデル：MediaPipe Interactive Segmenter v2 / MagicTouch int8
- モデル取得元：https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/1/interactive_segmentation.task
- モデルSHA-256：38431bc66b883404e8397f74c3579404315b9b52b04a46c6346fe906a7309b03

モデルとライブラリを更新するときは、Wasmとモデルの組み合わせをPCブラウザで確認し、SHA-256を更新する。

開発サーバーではViteがMediaPipeの動的importに`?import`を付けるため、`vite.config.ts`で同梱ローダーをそのまま配信する。ローダー末尾にはES moduleスコープでもMediaPipeが参照できるよう`globalThis.ModuleFactory`への代入を追加している。また、strict modeで参照できなかった`custom_dbg`をローダーの外側に宣言している。Wasmを更新するときは両方の修正を再確認する。
