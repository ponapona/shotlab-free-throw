# 任意：ローカルCPU版

ブラウザでWebGLが利用できない場合、同じPCのPythonで推論できます。GitHub Pages / Static SpaceではこのCPUサーバーは動きません。

先にREADMEのセットアップを済ませ、`npm run build` で画面を作成してください。

Windows / PowerShell（Python 3.12）：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r analysis\requirements.txt
.\.venv\Scripts\python.exe analysis\local_server.py
```

macOS / Linux：

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r analysis/requirements.txt
.venv/bin/python analysis/local_server.py
```

`http://127.0.0.1:8765` を開きます。CPU版は元動画の全フレームを処理します。画面の15/30fps設定はブラウザ解析用です。アップロード先は同じPCのループバックアドレスで、外部推論サービスには送りません。待受は127.0.0.1限定です。

ffprobeがあると元動画の提示時刻を利用します。ない場合はOpenCVの時刻、必要に応じて公称fpsへフォールバックします。Linuxで `libGLESv2.so.2` が不足する場合はOSのlibgles2が必要です。

セッションからCSVを再生成：

```sh
node analysis/export.mjs path/to/session.json results
```

公開用ソースに個人動画やサンプル解析JSONは含みません。モデルは `npm run setup:assets` で取得します。停止はターミナルでCtrl+C。一時ファイルはサーバー終了時に削除します。

## ボール解析（v0.3）

ローカルCPUサーバーの画面で「ボールも自動検出する」をオンにした場合、CPUによる身体解析の後、ブラウザでEfficientDet-Lite2と背景差分を動かします。AIが実行できない場合も、Canvas 2Dの背景差分が使えます。Pythonの `extract.py` 単独実行にはボール検出は含みません。ブラウザの描画機能が利用できない場合は、身体解析後に3時刻の手動点から放物線を復元できます。
