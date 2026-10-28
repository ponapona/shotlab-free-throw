/** Exact-column dictionary. A missing definition is a build error, never a guessed label. */
import {
  ANGLES,
  NAMES,
  enrich,
  frameRows,
  shotRows,
  landmarkRows,
} from "./engine.mjs";
const D = (
  name,
  description,
  unit = "",
  missing = "空欄＝値なし／計算不可",
  note = "",
) => ({ name, description, unit, missing, note });
const COMMON = {
  source_sha256: D(
    "動画識別SHA-256",
    "解析元動画のSHA-256。複数CSVの対応確認に使う。",
    "文字列",
    "空欄＝旧版などで未記録",
  ),
  app_version: D(
    "処理アプリのバージョン",
    "特徴量を計算・再計算したShotLabのバージョン。設定は対応するmetadata JSONを参照。",
    "文字列",
    "なし",
  ),
  frame: D(
    "フレーム番号",
    "0始まり。CPU版は原動画のフレーム、ブラウザ版は再サンプリング番号。",
    "番号",
    "なし",
  ),
  t_s: D(
    "動画内時刻",
    "動画開始からの経過秒。時刻の取得方法はセッションJSONのmeta.timestamp_source。",
    "s",
    "なし",
  ),
  shot_id: D(
    "シュートID",
    "対象のシュート区間の識別番号。追加・削除後も既存IDを維持。",
    "番号",
    "空欄＝シュート区間外",
  ),
  phase: D(
    "動作区分",
    "setup＝セット、drive＝上昇開始～リリース前、follow_through＝リリース～区間終了、other＝区間外。",
    "カテゴリ",
    "なし",
    "指定した時刻に基づく区分。学習済み動作分類器の判定ではない。",
  ),
  success: D(
    "シュート結果（目的変数）",
    "成功＝1、失敗＝0。",
    "0/1",
    "空欄＝未確認。0に置換しない。",
  ),
  label_source: D(
    "結果ラベルの由来",
    "unreviewed＝未確認、assistant_video_review＝サンプルの暫定ラベル、human_review＝画面で確認・変更。",
    "カテゴリ",
    "空欄＝区間外",
  ),
  timing_source: D(
    "区間時刻の由来",
    "pose_heuristic＝姿勢に基づく候補、human_review＝画面で時刻を保存。",
    "カテゴリ",
  ),
  timing_reviewed: D(
    "区間時刻の確認状態",
    "確認済み＝1、未確認＝0。旧版のフレームCSVはtrue/false。",
    "0/1",
    "空欄＝区間外",
  ),
  pose_detected: D(
    "姿勢の出力有無",
    "姿勢モデルが33点を出力＝1、未検出＝0。",
    "0/1",
    "なし",
    "正しい測定を保証しない。旧版ではtrue/falseの場合がある。",
  ),
  visible_fraction: D(
    "主要関節の可視率",
    "主要16点のうちvisibilityとpresenceがともにmeta.analysis_settings.confidence.landmark以上の点の割合。",
    "0–1",
    "未検出は0",
    "測定精度・正解率ではない。",
  ),
  start_s: D(
    "セット開始時刻",
    "シュート区間とリリース前特徴量の集計開始時刻。",
    "s",
  ),
  drive_s: D("上昇開始時刻", "セットからシュート動作へ移る時刻。", "s"),
  release_s: D(
    "リリース時刻",
    "ボールが手を離れる候補／確認時刻。放物線の時間原点。",
    "s",
    "空欄は不可",
    "サンプルでは要確認。",
  ),
  end_s: D(
    "シュート区間の終了時刻",
    "リリース後の区間が終わる時刻。放物線補正の終了時刻とは別。",
    "s",
  ),
  n_pre_release_frames: D(
    "リリース前のフレーム数",
    "start_s以上release_s以下に含まれる全フレーム数。欠測も数える。",
    "フレーム",
    "なし",
  ),
  note: D(
    "確認メモ",
    "区間や結果について入力した自由記述。",
    "",
    "空欄＝メモなし",
  ),
  mean_visible_fraction_pre: D(
    "リリース前の平均可視率",
    "start_s以上release_s以下のvisible_fractionの算術平均。",
    "0–1",
  ),
  trunk_lean_deg: D(
    "体幹の傾き",
    "両股中点から両肩中点へ向かう線と、画像の上向き鉛直との符号付き角度。画像右への傾きが正。",
    "deg",
    "空欄＝肩・股のいずれかの可視性不足／未検出",
  ),
  hip_y_px: D(
    "股中点のY座標",
    "両股の中点の画像Y座標。画像上端が0、下向き正。",
    "px",
  ),
  left_wrist_y_px: D("左手首のY座標", "左手首の画像Y座標。下向き正。", "px"),
  right_wrist_y_px: D("右手首のY座標", "右手首の画像Y座標。下向き正。", "px"),
  ball_x_px: D(
    "ボール観測X",
    "画像処理で得たボール候補の元のX座標。画像左端が0、右向き正。",
    "px",
    "空欄＝未観測",
    "補正前の値を保持。候補点は誤検出を含みうる。",
  ),
  ball_y_px: D(
    "ボール観測Y",
    "画像処理で得たボール候補の元のY座標。画像上端が0、下向き正。",
    "px",
    "空欄＝未観測",
    "補正前の値を保持。候補点は誤検出を含みうる。",
  ),
  ball_visibility: D(
    "ボール観測の適合スコア",
    "添付動画用の輪郭追跡の未校正スコア。姿勢モデルのvisibilityとは異なる。",
    "0–1",
    "空欄＝未観測",
    "ボール位置の正確さを保証する確率ではない。",
  ),
  ball_x_px_corrected: D(
    "放物線補正X",
    "飛行区間の推定X＝x0＋vx×u（u＝t_s−release_s）。",
    "px",
    "空欄＝補正区間外／当てはめ不可",
    "飛行全体を使う事後推定。実測値・ライブ値ではない。",
  ),
  ball_y_px_corrected: D(
    "放物線補正Y",
    "飛行区間の推定Y＝y0＋vy×u＋a×u²。下向き正。",
    "px",
    "空欄＝補正区間外／当てはめ不可",
    "飛行全体を使う事後推定。リング接触後へ外挿しない。",
  ),
  ball_correction_status: D(
    "ボール補正の状態",
    "observed_fit＝採用観測点を補正、outlier_replaced＝外れ値を補正、interpolated＝欠測を補間、outside_flight＝観測あり・補正区間外、unavailable＝補正値なし。",
    "カテゴリ",
    "なし",
  ),
  ball_fit_shot_id: D(
    "補正対象のシュートID",
    "このフレームの補正値を生成した放物線のシュートID。",
    "番号",
    "空欄＝補正値なし",
  ),
  ball_fit_inlier: D(
    "観測点の採否",
    "観測値と補正値の2D距離が閾値以下＝1、閾値超過＝0。閾値はmax(3,画像高さ×0.015)px。",
    "0/1",
    "空欄＝未観測／補正値なし",
  ),
  ball_fit_residual_px: D(
    "観測と補正の距離",
    "元のボール候補点と放物線補正点のユークリッド距離。",
    "px",
    "空欄＝未観測／補正値なし",
    "基準計測との誤差ではない。",
  ),
  ball_fit_rmse_px: D(
    "当てはまりのRMSE",
    "採用観測点と放物線の2D距離の二乗平均平方根。",
    "px",
    "空欄＝当てはめ不可",
    "観測候補に対する当てはまり。真の位置の測定誤差ではない。",
  ),
  ball_fit_available_at_s: D(
    "補正で参照した区間の終端",
    "補正候補の探索終端min(end_s,release_s＋1.8)。事後計算でこの時点までの観測を参照。",
    "s",
    "空欄＝補正値なし",
    "これより早い時点で確定していた値として扱わない。",
  ),
  ball_correction_method: D(
    "補正方法",
    "robust_parabola_v1：決定的なRANSAC候補評価と最小二乗再推定。X一次・Y二次。",
    "文字列",
    "空欄＝補正値なし",
  ),
  ball_fit_status: D(
    "投ごとの放物線推定状態",
    "fitted＝推定成功、insufficient_observations＝観測不足、no_valid_parabola＝条件を満たす曲線なし、insufficient_flight_span＝飛行区間不足、unavailable＝未計算。",
    "カテゴリ",
    "なし",
  ),
  ball_fit_start_s: D(
    "補正区間の開始",
    "採用した最初の飛行観測点の時刻。",
    "s",
    "空欄＝当てはめ不可",
  ),
  ball_fit_end_s: D(
    "補正区間の終了",
    "採用した最後の飛行観測点の時刻。この外側を補間・外挿しない。",
    "s",
    "空欄＝当てはめ不可",
  ),
  ball_fit_n_observations: D(
    "補正候補の観測点数",
    "release_s～min(end_s,release_s＋1.8)の観測ボール候補数。",
    "点",
    "なし",
  ),
  ball_fit_n_inliers: D(
    "採用観測点数",
    "最終的な放物線の再推定に採用した観測点数。",
    "点",
    "推定失敗は0",
  ),
  ball_fit_n_interpolated: D(
    "補間したフレーム数",
    "補正区間内で元の観測がなかったフレーム数。",
    "フレーム",
    "空欄＝当てはめ不可",
  ),
  ball_fit_x0_px: D(
    "Xの切片",
    "X(u)=x0+vx×uのx0。u=0はrelease_s。",
    "px",
    "空欄＝当てはめ不可",
    "切片はモデル値で、実測リリース位置ではない。",
  ),
  ball_fit_vx_px_s: D(
    "Xの一次係数",
    "X(u)=x0+vx×uのvx。",
    "px/s",
    "空欄＝当てはめ不可",
    "画面上の値。実空間の速度ではない。",
  ),
  ball_fit_y0_px: D(
    "Yの切片",
    "Y(u)=y0+vy×u+a×u²のy0。",
    "px",
    "空欄＝当てはめ不可",
  ),
  ball_fit_vy_px_s: D(
    "Yの一次係数",
    "Y(u)=y0+vy×u+a×u²のvy。",
    "px/s",
    "空欄＝当てはめ不可",
  ),
  ball_fit_a_px_s2: D(
    "Yの二次係数",
    "Y(u)=y0+vy×u+a×u²のa。画像Yは下向き正なので、自由飛行モデルでa>0に制約。",
    "px/s²",
    "空欄＝当てはめ不可",
    "加速度に相当する値は2a。実空間の重力加速度ではない。",
  ),
  landmark_id: D(
    "ランドマーク番号",
    "MediaPipe Poseの点番号（0～32）。",
    "番号",
    "なし",
  ),
  landmark: D(
    "ランドマーク名",
    "MediaPipe Poseの英語名。left/rightは身体の左右。",
    "文字列",
    "なし",
  ),
  x_norm: D(
    "生の正規化X",
    "元画像の幅で正規化した座標。右向き正。画像外の推定では0～1を超える。",
    "画像幅比",
  ),
  y_norm: D(
    "生の正規化Y",
    "元画像の高さで正規化した座標。下向き正。画像外の推定では0～1を超える。",
    "画像高さ比",
  ),
  z_norm_est: D(
    "正規化深さの推定",
    "股中点を原点とするモデルの深さ推定。小さい値ほどカメラに近い。",
    "モデル正規化値",
    "空欄＝姿勢未検出",
    "校正された距離ではない。",
  ),
  visibility: D(
    "関節の可視性スコア",
    "モデル出力のvisibilityをそのまま保存。",
    "0–1",
    "空欄＝姿勢未検出",
    "測定精度ではない。",
  ),
  presence: D(
    "関節の存在スコア",
    "モデル出力のpresenceをそのまま保存。",
    "0–1",
    "空欄＝姿勢未検出",
    "モデル／出力経路により未提供の場合は1を使う。",
  ),
  usable: D(
    "角度計算に使う条件",
    "visibilityとpresenceがともにmeta.analysis_settings.confidence.landmark以上＝1、それ以外＝0。",
    "0/1",
    "未検出は0",
    "正確さの保証ではない。",
  ),
  x_norm_filtered: D(
    "平滑化した正規化X",
    "因果的One Euroフィルタ後のX。低可視性の点は生値を保持するが角度計算から除く。",
    "画像幅比",
  ),
  y_norm_filtered: D(
    "平滑化した正規化Y",
    "因果的One Euroフィルタ後のY。低可視性の点は生値を保持するが角度計算から除く。",
    "画像高さ比",
  ),
  world_x_m_est: D(
    "推定3DのX",
    "股中点を原点としてモデルがメートル単位で出すX座標。",
    "m（推定）",
    "空欄＝未検出／未出力",
    "実測・校正された空間座標ではない。",
  ),
  world_y_m_est: D(
    "推定3DのY",
    "股中点を原点としてモデルがメートル単位で出すY座標。",
    "m（推定）",
    "空欄＝未検出／未出力",
    "実測・校正された空間座標ではない。",
  ),
  world_z_m_est: D(
    "推定3DのZ",
    "股中点を原点としてモデルがメートル単位で出すZ座標。",
    "m（推定）",
    "空欄＝未検出／未出力",
    "実測・校正された空間座標ではない。",
  ),
};
const joint = {
  elbow: ["肘", "肩→肘→手首"],
  knee: ["膝", "股→膝→足首"],
  hip: ["股関節", "肩→股→膝"],
  shoulder: ["肩", "股→肩→肘"],
  ankle: ["足首", "膝→足首→足先"],
};
function definition(key) {
  if (COMMON[key]) return COMMON[key];
  if (key.endsWith("_raw")) {
    const base = definition(key.slice(0, -4));
    return {
      ...base,
      name: base.name + "（生値）",
      description:
        base.description +
        " 平滑化前の座標から算出。可視性による除外条件は同じ。",
      note: key.includes("_3d_")
        ? "推定3D座標には平滑化を適用していないため、対応する非raw列と同じ値。"
        : base.note,
    };
  }
  for (const [suffix, label, meaning] of [
    [
      "_min_pre",
      "・リリース前最小",
      "セット開始以上、リリース以下の有効値の最小。",
    ],
    [
      "_max_pre",
      "・リリース前最大",
      "セット開始以上、リリース以下の有効値の最大。",
    ],
    [
      "_at_release",
      "・リリース時",
      "リリース時刻を超えない直近フレームの値。0.16秒を超えて離れた場合は欠測。",
    ],
    [
      "_valid_fraction",
      "・有効割合",
      "セット開始以上、リリース以下の全フレームに対する有効値の割合。",
    ],
  ])
    if (key.endsWith(suffix)) {
      const base = definition(key.slice(0, -suffix.length));
      return {
        ...base,
        name: base.name + label,
        description: meaning + " " + base.description,
        unit: suffix === "_valid_fraction" ? "0–1" : base.unit,
      };
    }
  if (key.endsWith("_velocity_deg_s")) {
    const base = definition(key.replace("_velocity_deg_s", "_deg"));
    return {
      ...base,
      name: base.name + "・角速度",
      description:
        "直前フレームとの差を時刻差で割った後退差分。" + base.description,
      unit: "deg/s",
      missing: "空欄＝現在または直前が欠測／間隔が0.12秒以上",
    };
  }
  const match = key.match(
    /^(left|right)_(elbow|knee|hip|shoulder|ankle)_(deg|3d_est_deg|visibility)$/,
  );
  if (match) {
    const [, side, k, kind] = match,
      [label, points] = joint[k],
      name = (side === "left" ? "左" : "右") + label;
    if (kind === "visibility")
      return D(
        name + "の角度用可視性",
        points + "の3点のvisibility/presenceの最小値。",
        "0–1",
        "未検出は0",
        "設定された閾値以上のときだけ角度を算出。",
      );
    return D(
      name + "の" + (kind === "deg" ? "2D内角" : "推定3D内角"),
      points +
        "の中央点を頂点とする内角。" +
        (kind === "deg"
          ? "画像幅・高さを掛けた座標から算出。"
          : "モデルの推定3D座標から算出。"),
      "deg",
      "空欄＝可視性不足／未検出／計算不可",
      k === "ankle"
        ? "臨床的な足関節背屈角ではない。"
        : kind === "deg"
          ? "肘・膝の伸展は約180度。左右は身体の左右。"
          : "未校正・未検証。",
    );
  }
  throw new Error("Missing column definition: " + key);
}
export function dictionaryRows() {
  const data = enrich({
    meta: { width: 640, height: 360, duration: 1 },
    frames: [{ i: 0, t: 0, p: null, world: null, ball: null }],
    shots: [
      {
        id: 1,
        start: 0,
        drive: 0.2,
        release: 0.5,
        end: 1,
        outcome: null,
        label_source: "unreviewed",
        timing_source: "pose_heuristic",
        timing_reviewed: false,
        note: "",
      },
    ],
  });
  return [
    ["frames.csv", frameRows(data, data.shots)[0]],
    ["shots.csv", shotRows(data, data.shots)[0]],
    ["landmarks.csv", landmarkRows(data)[0]],
  ].flatMap(([file, row]) =>
    Object.keys(row).map((column) => {
      const d = definition(column);
      return {
        file,
        column,
        name_ja: d.name,
        description_ja: d.description,
        unit: d.unit,
        missing_value: d.missing,
        notes: d.note,
      };
    }),
  );
}
export { NAMES };
