# GitHubに載せる

このZIPはGitHubに登録するためのソースです。まだあなたのGitHubアカウントにリポジトリを作成・公開していません。

## 簡単な方法：GitHub Desktop

1. ZIPを展開し、`shotlab-github` フォルダーを置きます。
2. [GitHub Desktop](https://desktop.github.com/)を開き、GitHubへサインインします。
3. **File → Add local repository**でこのフォルダーを選択します。
4. Gitリポジトリがない旨が出たら、**create a repository here**で作成します。既存のREADME等を上書きするオプションは選びません。
5. 変更一覧を確認し、最初のコミットを作成します。名称の例：`shotlab-free-throw`。
6. **Publish repository**を選択。まず自分だけで確認するならprivate、ソースを公開するならpublicを選びます。

`.gitignore` により、動画、解析結果フォルダー、モデル、node_modules、ローカル環境は登録対象から外れます。自分で追加した別名のデータは一覧で確認してください。

## コマンドを使う場合

GitHubで空のリポジトリを作成後、その画面のURLを使います。

```sh
git init -b main
git add .
git commit -m "Prepare ShotLab v0.1.0"
git remote add origin https://github.com/YOUR_ACCOUNT/shotlab-free-throw.git
git push -u origin main
```

`YOUR_ACCOUNT` は自分のユーザー名に置き換えます。GitHubでREADMEを自動作成せず、空のリポジトリへ登録する手順です。既存リポジトリへの強制pushは不要です。

## ブラウザで使えるようにする：GitHub Pages

コード公開だけならここは後回しで構いません。

1. GitHubのリポジトリで **Settings → Pages → Source: GitHub Actions** を選択。
2. **Actions → Publish GitHub Pages → Run workflow** を実行。
3. 完了後に表示されたPages URLを開きます。

ワークフローは手動実行です。コードを更新しただけではPagesを更新しません。モデル取得・テスト・ビルドを実行して `dist/` を配信します。APIキーは不要です。`.github/workflows` もリポジトリへ登録してください。

ソースの配置先はGitHub、利用者が動画を選ぶ画面はPagesまたはHugging Face、という役割分担です。
