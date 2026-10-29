import fs from "node:fs";
import { SETTINGS } from "../public/settings.mjs";
import path from "node:path";
import { dictionaryRows, NAMES } from "../public/dictionary.mjs";
import { csv } from "../public/engine.mjs";
const out = process.argv[2] ?? "public/docs",
  rows = dictionaryRows();
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "ShotLab_columns.csv"), csv(rows));
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const sections = [
  "frames.csv",
  "shots.csv",
  "body.csv",
  "landmarks.csv",
  "ball.csv",
  "phases.csv",
  "waveforms.csv",
  "pca.csv",
]
  .map(
    (file) =>
      `<h2>${file}</h2><p>${file === "phases.csv" ? "1行＝1投×1局面。セット・シュート動作・リリース後を別々に集計。" : file === "waveforms.csv" ? "1行＝1投×1局面×正規化時刻。各局面51点。" : file === "pca.csv" ? "1行＝1投。10個の身体特徴量と識別・確認情報。PCA自体は未計算。" : file === "frames.csv" ? "1行＝1フレーム／解析サンプル。" : file === "shots.csv" ? "1行＝1投。" : file === "ball.csv" ? "1行＝1サンプル。欠測も行として残し、自動候補・手修正・放物線を分離。" : file === "body.csv" ? "1行＝1サンプル×主要16点の1点。顔・指先を除きます。" : "1行＝1サンプル×全33点の1点。MediaPipeの元の点番号を保ちます。"}</p><div class="table"><table><thead><tr><th>カラム</th><th>意味</th><th>単位</th><th>欠測・注意</th></tr></thead><tbody>${rows
        .filter((r) => r.file === file)
        .map(
          (r) =>
            `<tr><td><code>${esc(r.column)}</code><br>${esc(r.name_ja)}</td><td>${esc(r.description_ja)}</td><td>${esc(r.unit || "—")}</td><td>${esc(r.missing_value)}<br>${esc(r.notes)}</td></tr>`,
        )
        .join("")}</tbody></table></div>`,
  )
  .join("");
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ShotLab データの読み方・全カラム説明</title><style>body{margin:0;background:#f5f7fa;color:#263543;font:16px/1.8 system-ui,sans-serif}main{max-width:1120px;margin:32px auto;padding:32px;background:#fff;border:1px solid #dde3e9;border-radius:8px}h1{font-size:27px}h2{font-size:21px;margin-top:36px}h3{font-size:17px}.meta{color:#738191;font-size:14px}code{font-family:Consolas,monospace;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;vertical-align:top;padding:12px;border:1px solid #dce3e9}th{background:#eef2f5}td:first-child{width:27%}td:nth-child(2){width:37%}.callout{background:#f1f6f7;border-left:3px solid #278e87;padding:16px 20px}.table{overflow-x:auto}li{margin:6px 0}@media(max-width:650px){main{margin:0;padding:18px}table{min-width:720px}}@media print{body{background:white}main{border:0;margin:0;padding:0;max-width:none}th,td{padding:6px;font-size:10px}tr{break-inside:avoid}.table{overflow:visible}h2{break-after:avoid}}</style><main><p class="meta">SHOTLAB / DATA DICTIONARY / v${SETTINGS.app_version} / 2026-10-29 改訂</p><h1>データの読み方・全カラム説明</h1><p>CSVの実際のヘッダーと一致する${rows.length}カラムを説明しています。CSVはUTF-8 BOM付きです。空欄を0に置換しないでください。画面右上の「カラム説明」から、同じ内容を一覧CSVとして保存できます。</p><div class="callout"><strong>元の観測値と補正値を分けて使う</strong><p><code>ball_x_px / ball_y_px</code>は採用した観測点（手修正を優先）、<code>ball_x_px_corrected / ball_y_px_corrected</code>は放物線による事後推定です。欠測を補った値も実測値ではありません。</p></div><h2>最初に確認すること</h2><ul><li>結果ラベルは<code>success</code>（フォームPCAの入力には使わない）：成功1、失敗0、未確認は空欄。時刻と結果は映像を見て確認してください。</li><li><code>phase</code>はセット・上昇・リリース後・区間外。時刻の確認状態は<code>timing_reviewed</code>で区別します。</li><li>left/rightは身体の左右。2D角度は画像の縦横比を補正し、肘・膝が伸びると約180度になります。</li><li>画像座標は左上を原点としてXは右向き、Yは下向き正。pixel単位は実空間のメートルではありません。</li><li>可視性とpresenceが0.5以上の点だけを角度に使います。可視率は正確さを表す値ではありません。</li></ul><h2>ボールの放物線補正</h2><p>投ごとにリリースから最大1.8秒までの観測候補を調べ、外れ値に強い当てはめと最小二乗再推定を行います。画像上で、u＝動画時刻−リリース時刻としてX＝x0＋vx×u、Y＝y0＋vy×u＋a×u²（a&gt;0）を使います。加速度に相当する係数は2aです。これは固定カメラの画像平面の近似であり、カメラ校正による実空間の弾道ではありません。</p><p>自動候補はAI検出と固定カメラの背景差分（白・橙系の小さな動く物体）を併用します。AIを実行できない環境でも背景差分は動きます。動画全体から9時刻を取り、画素ごとの中央値を背景にします。身体の投候補があれば離手前0.3秒〜離手後最大1.8秒を探索します。初期設定は1800試行、6点以上・0.35秒以上・支持区間中35%以上の観測を要求します。手首と離れた軌道は除外します。モデル・背景差分のどちらも誤検出があり、位置精度は未検証です。</p><p>自動観測がなくても、「3点から軌道を復元」で異なる3時刻以上の点を指定できます。手離れ直後・飛行中・リング接触前を選びます。点は最低0.06秒ずつ、全体0.2秒以上離してください。3点の時刻と座標にXの一次式・Yの二次式を最小二乗で当てはめ、指定した最初〜最後の間を補間します。点がモデルと整合しない場合は理由を表示します。3点で曲線が合うこと自体は精度の検証になりません。</p><p>見えるボールの指定はpoint、見えない位置を仮定する指定はassumedです。仮定点はball_x_px/ball_y_pxの観測列には入れず、ball_assumed_*列へ保存します。仮定点を使った曲線全体はassumption_basedと記録します。身体の動きだけから実際の軌道が一意に決まるわけではありません。未知の位置を自動的に実測扱いしません。</p><p>採用した最初〜最後の支持点の間だけを補間し、端の外へ延長しません。リング接触後の点を指定しないでください。自動処理の接触候補判定は確実な接触検出ではありません。ball_auto_*は元の追跡結果を保持し、ball_candidate_recovered=1は保存した別候補から軌道に合う点を再選択した場合です。RMSEは候補点への当てはまりで、真の位置に対する誤差ではありません。</p><h2>平均・中央値とPCAの準備</h2><p>shots.csvの身体特徴は開始〜離手の有効サンプルについて、最小・最大・平均・中央値・標本標準偏差・四分位範囲・可動域・有効点数を出します。phases.csvはsetup=[start,drive)、drive=[drive,release)、follow_through=[release,end]です。平均はサンプルの単純平均で時間加重ではありません。欠測を0に置換しません。標準偏差はn−1、分位点は(n−1)pの隣接順位の線形補間で計算します。</p><p>waveforms.csvは局面ごとに0〜100%の51点へそろえます。有効な隣接サンプルの間隔が0.12秒以下の場合だけ線形補間します。長い欠測や範囲外は空欄です。角度ごとにsample/linear_interpolation/missingを保存します。時間をそろえても撮影方向や推定誤差の差は除去できません。</p><p>選手ID・測定ID・シュートする手を入力します。pca.csvの10特徴はシュートする側の肘・肩・膝・股・体幹と動作時間を選んだ初期候補です。全CSVの全列を投入しません。平均と中央値、最小・最大・可動域など重複する特徴を同時に多数入れると特定の関節が重くなります。pca_readyは入力の最低条件の確認で、研究上の妥当性を保証しません。成功ラベル・ID・品質指標はPCAの入力から外します。仮定依存の軌道は身体フォームのPCAへ混ぜません。</p><h3>再生同期と事後推定の違い</h3><p>波形は動画の開始（0秒）から再生時刻までを蓄積します。横軸の左端を0秒に固定し、時間の経過に合わせて右端を広げ、終了時には全区間を表示します。巻き戻すとその時点より先を非表示にします。カーソルを合わせると最も近い表示済みフレームの時刻・数値・欠測を表示します。姿勢の平滑化は過去の値だけを使う因果的な処理です。一方、ボールの放物線は飛行区間全体を使う事後推定です。<code>ball_fit_available_at_s</code>より前に確定していた値として、ライブ予測の説明変数に入れないでください。将来の値を参照せずにその時点で推定する機能は含みません。</p><h2>セッションJSON</h2><p><code>meta</code>は動画寸法・fps・時刻の取得方法・推定器・補正仕様、<code>frames</code>は生座標・自動候補ball_auto・全候補ball_candidates・手修正ball_edit、<code>shots</code>は区間と結果、<code>ball_fits</code>は投ごとの補正係数です。放物線は読込時・時刻編集時に再計算されます。xの係数配列は[x0,vx]、yは[y0,vy,a]、origin_sはrelease_sです。解析結果とラベルは、画面を閉じる前にセッションJSONとして保存してください。</p>${sections}<h2>ランドマークの対応</h2><p>${NAMES.map((n, i) => `<code>${i}: ${esc(n)}</code>`).join(" / ")}</p><h2>解析上の注意</h2><p>単眼映像による推定です。標準モーションキャプチャとの角度誤差・位置誤差の比較検証は未実施です。推定3D座標は校正した距離として扱えません。姿勢は因果的One Euroフィルタ（minCutoff=3、beta=2、dCutoff=1）を使い、生値も保存しています。フィルタの遅れがあるためリリース付近は生値との照合が必要です。</p><p>シュート結果・リリース時刻・ボール候補の誤検出を人が確認してください。shots.csvの身体特徴量はリリース以前で集計しますが、phases/waveforms.csvのfollow_throughと追加した<code>ball_fit_*</code>列はリリース後の情報を含みます。リリース前の成功予測にそのまま投入すると情報漏洩になります。学習・評価は動画や選手を単位に分割し、同じ投のフレームを両方へ入れないでください。</p></main></html>`;
fs.writeFileSync(path.join(out, "ShotLab_data_guide.html"), html);
if (out === "public/docs")
  fs.writeFileSync(
    "public/guide.mjs",
    "// Generated by analysis/write_guides.mjs\nexport default " +
      JSON.stringify(html) +
      ";\n",
  );
console.log(
  `Wrote guide and ${rows.length} exact column definitions to ${out}`,
);
