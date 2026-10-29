// @ts-nocheck
import React from "react";
export default function BallTrajectory({ data, shot, time, onSeek }) {
  const frames = data.frames.filter(
    (f) => !shot || (f.t >= shot.start && f.t <= shot.end),
  );
  const observed = frames.filter((f) => f.ball);
  const anchors = frames.filter((f) =>
    ["point", "assumed"].includes(f.ball_edit?.kind),
  );
  const fit = data.ball_fits?.find((f) => f.shot_id === shot?.id);
  const fitLabels = {
    insufficient_observations:
      "自動候補が不足しています。3点を指定して復元できます。",
    no_valid_parabola:
      "自動候補が飛行軌道につながりません。3点を指定するか、点を修正してください。",
    anchors_too_close:
      "指定した時刻が近すぎます。飛行の前半・中間・後半へ点を離してください。",
    inconsistent_anchors:
      "点が放物線に整合しません。時刻・位置・リング接触前かを確認してください。",
    insufficient_flight_span:
      "飛行の時間範囲が不足しています。離れた時刻の点を追加してください。",
  };
  const { width, height } = data.meta;
  let last = null;
  const path = frames
    .map((f) => {
      const b = f.ball_corrected;
      if (!b) {
        last = null;
        return "";
      }
      const move =
        !last ||
        f.t - last.t > 0.12 ||
        b.shot_id !== last.ball_corrected.shot_id;
      last = f;
      return `${move ? "M" : "L"}${b.x},${b.y}`;
    })
    .join(" ");
  return (
    <div className="ball-trajectory">
      <div className="ball-trajectory-heading">
        <strong>{shot ? `SHOT ${shot.id} の軌道` : "ボールの軌道"}</strong>
        <span>
          観測 {observed.length} 点 / 指定 {anchors.length} 点
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="ボールの画像平面XY軌道。灰は自動検出、緑は手修正、橙の破線は放物線の事後推定。"
      >
        {[0.25, 0.5, 0.75].map((q) => (
          <g key={q} stroke="#e4e9ed" strokeWidth={width / 800}>
            <path d={`M${width * q},0 V${height} M0,${height * q} H${width}`} />
          </g>
        ))}
        <path
          d={path}
          fill="none"
          stroke="#d79b3e"
          strokeWidth={width / 300}
          strokeDasharray={`${width / 90} ${width / 140}`}
        />
        {observed.map((f) => (
          <circle
            key={f.i}
            cx={f.ball.x}
            cy={f.ball.y}
            r={width / 140}
            fill={f.ball.source === "manual" ? "#17a69e" : "#8492a0"}
            opacity={f.t > time ? 0.4 : 0.95}
            onClick={() => onSeek(f.t + 0.001)}
          >
            <title>
              {f.t.toFixed(3)} 秒 ·{" "}
              {f.ball.source === "manual" ? "手修正" : "自動候補"} · X{" "}
              {f.ball.x.toFixed(1)}, Y {f.ball.y.toFixed(1)} px
            </title>
          </circle>
        ))}
        {anchors
          .filter((f) => f.ball_edit.kind === "assumed")
          .map((f) => (
            <circle
              key={"a" + f.i}
              cx={f.ball_edit.x}
              cy={f.ball_edit.y}
              r={width / 120}
              fill="none"
              stroke="#9559b4"
              strokeWidth={width / 300}
              onClick={() => onSeek(f.t + 0.001)}
            >
              <title>{f.t.toFixed(3)} 秒：仮定点</title>
            </circle>
          ))}
      </svg>
      {fit && (
        <p role="status">
          {fit.status === "fitted"
            ? `放物線を復元：${fit.start_s.toFixed(3)}〜${fit.end_s.toFixed(3)}秒。${fit.n_assumed ? "仮定点を含む推定です。" : "観測候補に基づく補間です。"}${fit.n_inliers === 3 ? "3点だけのため精度は検証できません。" : ""}`
            : (fitLabels[fit.status] ?? "軌道を確認してください。")}
        </p>
      )}
      {anchors.length > 0 && (
        <div className="ball-anchor-list">
          {anchors.map((f) => (
            <button
              className="button small"
              key={f.i}
              onClick={() => onSeek(f.t + 0.001)}
            >
              {f.t.toFixed(3)}秒 ·{" "}
              {f.ball_edit.kind === "assumed" ? "仮定" : "観測"}点
            </button>
          ))}
        </div>
      )}
      <p>
        {observed.length
          ? "点を押すとその時刻へ移動。灰：自動候補／緑：手修正／橙の破線：放物線。選択区間全体を表示。"
          : "自動観測がなくても、3時刻の点から放物線を復元できます。紫の丸は仮定点です。"}
      </p>
      <small>
        画像上のXY座標（左上が原点・Yは下向き）。実空間の3D軌道ではありません。
      </small>
    </div>
  );
}
