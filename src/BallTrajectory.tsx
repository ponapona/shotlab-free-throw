// @ts-nocheck
import React from "react";
export default function BallTrajectory({ data, shot, time, onSeek }) {
  const frames = data.frames.filter(
    (f) => !shot || (f.t >= shot.start && f.t <= shot.end),
  );
  const observed = frames.filter((f) => f.ball);
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
          {observed.length} / {frames.length} 点
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
      </svg>
      <p>
        {observed.length
          ? "点を押すとその時刻へ移動。灰：自動候補／緑：手修正／橙の破線：放物線。選択区間全体を表示。"
          : "ボールの観測点がありません。「ボール位置を修正」で映像のボール中心を指定できます。"}
      </p>
      <small>
        画像上のXY座標（左上が原点・Yは下向き）。実空間の3D軌道ではありません。
      </small>
    </div>
  );
}
