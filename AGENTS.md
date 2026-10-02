## プロジェクト概要
写真から簡易的な3Dモデルを作り、PCのブラウザに表示するWebアプリ。
スマホをコントローラーとして使い、スマホの傾きでPC上の3Dモデルを操作する。
PCとスマホはブラウザ同士でP2P通信する。
詳しい仕様は docs/02-spec.md を参照すること。

## アーキテクチャ・ディレクトリ構成
| 層 | 採用 |
|---|---|
| Web基盤 | Vite + React + TypeScript（PC版とスマホ版は同じSPAの別ルート） |
| 3D基盤 | Babylon.js + Havok（WebGL2） |
| 形状解析 | C++ + Emscripten / Embind（2D凸包・慣性テンソル・主軸） |
| 写真の領域分割 | MediaPipe Interactive Segmenter |
| 通信 | PeerJS + 公開PeerServer |
| ホスティング | Vercel |

処理の流れ：
写真 → MediaPipeでマスクを作る → C++(Wasm)で形状を解析 → Babylon.jsでモデルを作って表示 ← スマホの傾き（PeerJS経由）

ディレクトリ構成（npm workspaces。各ディレクトリの役割は README.md を参照）：
```
packages/
├─ protocol/src/        # PCとスマホで共有する通信メッセージの型
│  ├─ motion.ts         # 傾き 30Hz
│  ├─ control.ts        # A/B・決定・準備完了・振動指示
│  ├─ asset.ts          # 写真・マスクの転送
│  ├─ stats.ts          # FighterStats
│  └─ index.ts
├─ geometry-wasm/       # 形状解析（PCで実行）
│  ├─ cpp/              # C++本体
│  ├─ dist/             # ビルド済みWasm（git管理）
│  └─ src/              # TSラッパ＋能力値の写像式
└─ web/src/
   ├─ app/              # ルーティングと画面遷移（host: PC / controller: スマホ）
   ├─ features/         # 画面ごとの機能
   │  ├─ lobby/         # PC: QR表示・接続状態
   │  ├─ analyze/       # PC: 受信・解析・進捗表示
   │  ├─ battle/        # PC: 対戦（game/: Babylon・物理 / ui/: HPバー等）
   │  ├─ result/        # PC: 結果
   │  ├─ join/          # スマホ: 接続・センサー権限・基準姿勢
   │  ├─ capture/       # スマホ: 撮影・範囲指定・送信（ui/ / pipeline/）
   │  ├─ orient/        # スマホ: 向き調整（傾けで回転・決定）
   │  └─ pad/           # スマホ: 横持ちコントローラー
   ├─ lib/              # peer / sensor / babylon
   ├─ components/       # 2画面以上で使うUIだけ
   └─ dev/              # 検証ページ（/dev/〇〇）
docs/                   # 仕様書など
```

## セットアップ・コマンド
TODO: 確定したら書く
セットアップコマンド: 環境構築が終わり次第書く

## タスク管理・仕様の参照先
- 仕様：docs/02-spec.md（仕様に関してはこれが正しい）
- 企画書：docs/01-overview.md
- 技術計画：docs/03-tecnical_plan.md
- タスク：GitHub Issues。作業は必ずissueに対応させる
- 進捗の区切り：GitHub Milestone（develop-0-0 など）
- 仕様とコードが食い違っていたら、勝手にどちらかを直さずに人間に確認する

## 規約
- コミットメッセージとPRのタイトルにはissue番号を書く（例：`#5 スマホの傾き取得を実装`）
- コメントとドキュメントは日本語で書く
- PCとスマホの間で送るメッセージの型は `packages/protocol/` だけに定義し、両方からimportする
- Babylon.js は `@babylonjs/core` からサブパスでimportする（バンドルサイズを抑えるため）

## 暗黙のルールと禁止事項
- 形状解析（凸包・慣性テンソル・主軸）をJSのライブラリに置き換えない
  （理由：C++での自前実装がこの作品の技術的な中核だから）
- three.js / React Three Fiber を導入しない
  （理由：3D基盤は Babylon.js に統一している。物理・演出・Inspectorをまとめて使うため）
- WebGPUエンジンを使わない（理由：初期版は WebGL2 で作ると決めている）
- シグナリングサーバーを自分たちで立てない（理由：公開PeerServerを使う方針のため）
- 依存パッケージを勝手に追加しない。追加が必要なら理由を示して確認する
  （理由：メンバーの環境がそろわなくなり、ハッカソン中に原因を探す時間がもったいないため）
- APIキーや .env をコミットしない
- main / develop に直接pushしない（理由：他のメンバーの作業と衝突しないようにするため）
- issueの範囲外のリファクタリングをしない（理由：レビューしにくくなり、コンフリクトも増えるため）
- Gitの操作は原則行わない（行う場合は人間に必ず確認）

## 落とし穴
作業中に留意すべき点があった場合は更新

## Definition of Done
- lint・型チェック・ビルドがすべて通っている
- スマホの機能は、iOSとAndroidの実機で動作を確認している
- Vercel の Preview デプロイで動作を確認している
- PRに対応するissueがリンクされている（`Closes #番号`）
- 仕様が変わった場合は docs/spec.md も更新している