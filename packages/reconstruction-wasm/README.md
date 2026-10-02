# reconstruction-wasm

固定のCamera Poseと4〜8枚のSilhouette Maskから96³ Visual Hullを作る。C++で投影・Silhouette Carving・Marching Cubesの面生成を行い、`positions` / `indices` / `normals` を返す。座標はY上向き、画像のv軸は下向き。出力は最長軸1で、底面Y=0にそろえる。

## ビルド

Emscripten SDK **6.0.10** を有効にして、リポジトリルートから `npm run build:wasm -w packages/reconstruction-wasm` を実行する。`dist/reconstruction.mjs` と `dist/reconstruction.wasm` は配信に必要なためリポジトリで管理する。VercelではWasmを再ビルドしない。外部npm依存は追加していない。

PCの `/dev/visual-hull` で写真4〜8枚をMask化し、Workerで再構成する。視点の自動推定は行わない。
