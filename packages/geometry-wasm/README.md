# geometry-wasm

PCでメッシュの3D形状を解析する。Quick ScanとVisual Hullから同じ `positions` / `indices` を受け、C++で凸包・体積・重心・慣性主軸を算出する。TSラッパーが暫定能力値 `provisional-1` を返す。算出式はIssue #33で置き換える。

## ビルド

Emscripten SDK **6.0.10** を有効にして、リポジトリルートから `npm run build:wasm -w packages/geometry-wasm` を実行する。`dist/geometry.mjs` と `dist/geometry.wasm` は配信に必要なためリポジトリで管理する。VercelではWasmを再ビルドしない。外部npm依存は追加していない。

入力は最長軸を1として解析する。非有限座標、範囲外のインデックス、立体にならない入力はエラーにする。
