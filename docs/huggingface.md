# 後でHugging Face Spacesに公開する

このアプリは静的Webアプリなので、**Static HTML Space**を使用できます。PythonのCPUサーバーはSpaceに載せず、利用者のブラウザで推論する構成です。公開サーバーのGPU待ち行列はありませんが、端末側の解析時間は必要です。

## ビルド済みファイルを配置する方法

ローカルで以下を実行します。

```sh
npm ci
npm run setup:assets
npm run build
```

Spaceを作成し、`dist` の**中身**をSpaceのルートへ配置します。`index.html`、`assets`、`models`、`vendor`、各 `.mjs`、`docs` をまとめて配置してください。SpaceのREADMEの先頭を次のようにします。

```yaml
---
title: ShotLab
emoji: 🏀
colorFrom: blue
colorTo: green
sdk: static
app_file: index.html
pinned: false
---
```

README本文にGitHubのソースURL、バージョン、仕様へのリンクを書きます。動画は利用者が選ぶ方式で、サンプルの個人動画は含めません。モデル・WASM・ライセンス通知を含む `dist` 全体を使ってください。

## ソースからSpace側でビルドする場合

ソース一式とpackage-lockをSpaceに登録し、README先頭の設定を変更します。

```yaml
sdk: static
app_build_command: npm ci && npm run setup:assets && npm run build
app_file: dist/index.html
```

Node.jsのバージョン条件を満たす必要があります。Spaceのビルド環境で解決しない場合は、上のビルド済みファイルを配置する方法を使えます。

この初版ではSpaceへの実デプロイは未検証です。GitHubをソースの原本とし、公開したアプリと同じバージョンをタグで残す運用を推奨します。

[Hugging Face公式：Static HTML Spaces](https://huggingface.co/docs/hub/spaces-sdks-static)
