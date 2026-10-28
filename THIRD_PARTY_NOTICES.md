# Third-party software and assets

ShotLabのMIT Licenseは、このプロジェクト自身のコードに適用します。依存ソフトウェアとモデルの権利は各配布元に帰属します。

| コンポーネント             | 用途                     | 配布元                                                                                            |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| MediaPipe Tasks Vision     | 姿勢推論・WASMランタイム | [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe)                           |
| MediaPipe Heavy model      | 学習済み姿勢推定モデル   | [公式モデル一覧](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker#models)    |
| EfficientDet-Lite2 float16 | COCO sports ballの検出   | [公式モデル一覧](https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector#models)    |
| React / React DOM          | UI                       | [facebook/react](https://github.com/facebook/react)                                               |
| Radix UI / shadcn/ui       | UI部品                   | [radix-ui](https://github.com/radix-ui/primitives) / [shadcn-ui](https://github.com/shadcn-ui/ui) |
| Lucide                     | アイコン                 | [lucide](https://github.com/lucide-icons/lucide)                                                  |
| Sonner                     | 通知                     | [emilkowalski/sonner](https://github.com/emilkowalski/sonner)                                     |
| Tailwind CSS               | スタイル                 | [tailwindlabs](https://github.com/tailwindlabs/tailwindcss)                                       |
| Vite                       | ビルド                   | [vitejs](https://github.com/vitejs/vite)                                                          |

バージョンと取得整合性は `package-lock.json`、Python版は `analysis/requirements.txt` を参照。モデルURLとSHA-256は `config/defaults.json` で固定しています。モデルとWASMはソースZIPへ同梱せず、セットアップ時に取得します。SDKのLICENSE/NOTICEは利用可能な場合に `public/vendor/` へコピーします。

UI部品はshadcn/uiに由来します。依存パッケージとUI部品のライセンス本文は `licenses/` に保管します。
