## Vercelへのデプロイ（Issue #2）

このリポジトリは npm workspaces を使います。依存関係はリポジトリルートの
`package-lock.json` で管理し、追加・更新時はルートで `npm install` を実行します。

Vercelのプロジェクト設定は次のとおりです。

- Framework Preset: `Vite`
- Root Directory: `packages/web`
- 「Include source files outside of the Root Directory in the Build Step」を有効化
  （ルートのロックファイルと共有パッケージ `packages/protocol` が必要）

`vercel.json` でインストール・ビルド・出力先を指定しています。
インストールはリポジトリルートで `npm ci`、ビルドは `packages/web` で
`npm run build` を実行し、`dist` を配信します。

ローカルではリポジトリルートで次を実行すると確認できます。

```sh
npm ci
npm run lint
npm run build
```

ビルドには `tsc -b` による型チェックも含まれます。

pnpm を使う場合も、リポジトリルートの `pnpm-workspace.yaml` が
`@gikcamp/protocol` をローカルの共有パッケージへリンクします。
`packages/web` から `pnpm run dev` を実行できます。
依存の追加・更新と固定は従来どおり npm と `package-lock.json` で行います。

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
