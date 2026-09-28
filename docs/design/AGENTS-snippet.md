# AGENTS.md に追記する文

AGENTS.md の適当な場所に、下の「UI/UX」セクションをそのまま貼ってください。

---

## UI/UX

- 画面の見た目・演出・言葉づかいは `docs/design/` に従う。UI を作る前に `docs/design/README.md` を読む。
- 各画面の見本は `docs/design/screens/*.html`。実装する画面のファイルだけを読む。
- 色・フォント・線・影は `docs/design/tokens.css`(TS からは `docs/design/tokens.ts`)の値を使い、直書きしない。
- アイコン・Scannee の目・雲などの素材は `docs/design/assets/` の SVG を使う。
- `docs/design/source/` はデザインツールの元データ。独自記法を含むのでコードにコピーしない。
- 画面上の文字はひらがな中心で短く。1P は青、2P は赤で、どこでも同じ色を使う。
- 仕様書と `docs/design/README.md` の「仕様書との差分」が食い違うときは、実装前に人に確認する。
