/** Image observations only. Association never invents a position during a gap. */
import { SETTINGS } from "./settings.mjs";
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const BALL_COLUMNS = [
  "source_sha256",
  "app_version",
  "frame",
  "t_s",
  "shot_id",
  "ball_auto_x_px",
  "ball_auto_y_px",
  "ball_auto_score",
  "ball_auto_track_id",
  "ball_candidate_count",
  "ball_tracking_status",
  "ball_edit",
  "ball_edited_at",
  "ball_source",
  "ball_x_px",
  "ball_y_px",
  "ball_visibility",
  "ball_x_norm",
  "ball_y_norm",
  "ball_x_px_corrected",
  "ball_y_px_corrected",
  "ball_correction_status",
  "ball_fit_inlier",
  "ball_fit_residual_px",
  "ball_fit_rmse_px",
  "ball_fit_available_at_s",
];

export function detectionCandidates(
  result,
  roi,
  width,
  height,
  canvasWidth,
  canvasHeight,
  config = SETTINGS.ball_tracking,
) {
  const [x0, y0, x1, y1] = roi;
  const sx = ((x1 - x0) * width) / canvasWidth;
  const sy = ((y1 - y0) * height) / canvasHeight;
  return (result.detections ?? [])
    .flatMap((d) => {
      const category = d.categories?.find(
        (c) => c.categoryName === "sports ball",
      );
      const b = d.boundingBox;
      if (!category || !b || category.score < config.score_threshold) return [];
      const w = b.width * sx,
        h = b.height * sy;
      const x = x0 * width + (b.originX + b.width / 2) * sx;
      const y = y0 * height + (b.originY + b.height / 2) * sy;
      if (
        ![x, y, w, h, category.score].every(finite) ||
        w <= 0 ||
        h <= 0 ||
        x < 0 ||
        x > width ||
        y < 0 ||
        y > height ||
        w > width * config.max_diameter_fraction ||
        h > height * config.max_diameter_fraction
      )
        return [];
      return [
        {
          x,
          y,
          w,
          h,
          r: (w + h) / 4,
          confidence: category.score,
          source: "efficientdet_lite2",
          status: "candidate_unvalidated",
        },
      ];
    })
    .sort((a, b) => b.confidence - a.confidence);
}

export function createBallTracker(
  width,
  height,
  config = SETTINGS.ball_tracking,
) {
  const diagonal = Math.hypot(width, height);
  let last = null,
    velocity = { x: 0, y: 0 },
    segment = 0;
  return {
    next(candidates, t) {
      const dt = last ? t - last.t : Infinity;
      const continuing = last && dt > 0 && dt <= config.max_gap_s;
      let ranked;
      if (continuing) {
        const gate =
          diagonal * (config.gate_diag_fraction + config.max_speed_diag_s * dt);
        const predicted = {
          x: last.x + velocity.x * dt,
          y: last.y + velocity.y * dt,
        };
        ranked = candidates
          .map((b) => ({
            b,
            distance: Math.hypot(b.x - predicted.x, b.y - predicted.y),
          }))
          .filter((r) => r.distance <= gate)
          .map((r) => ({
            ...r,
            rank: r.b.confidence - (0.5 * r.distance) / gate,
          }))
          .sort((a, b) => b.rank - a.rank);
      } else {
        ranked = candidates
          .filter((b) => b.confidence >= config.start_score)
          .map((b) => ({ b, rank: b.confidence }));
      }
      if (!ranked.length)
        return {
          ball: null,
          status: candidates.length ? "rejected" : "missing",
        };
      if (
        ranked.length > 1 &&
        ranked[0].rank - ranked[1].rank < config.ambiguity_margin
      )
        return { ball: null, status: "ambiguous" };
      const b = ranked[0].b;
      if (continuing) {
        velocity = {
          x: (0.6 * (b.x - last.x)) / dt + 0.4 * velocity.x,
          y: (0.6 * (b.y - last.y)) / dt + 0.4 * velocity.y,
        };
      } else {
        segment++;
        velocity = { x: 0, y: 0 };
      }
      last = { ...b, t };
      return { ball: { ...b, track_id: segment }, status: "observed" };
    },
  };
}

/** Keep detector output immutable; edits override only the selected observation. */
export function applyBallEdits(data) {
  const { width, height } = data.meta;
  for (const f of data.frames) {
    if (!has(f, "ball_auto")) f.ball_auto = f.ball ? { ...f.ball } : null;
    const e = f.ball_edit;
    if (e && !["point", "missing"].includes(e.kind))
      throw new Error("不正なボール修正です。");
    if (e?.kind === "point") {
      if (
        !finite(e.x) ||
        !finite(e.y) ||
        e.x < 0 ||
        e.x > width ||
        e.y < 0 ||
        e.y > height
      )
        throw new Error("ボールの修正座標が動画の範囲外です。");
      f.ball = {
        x: e.x,
        y: e.y,
        confidence: null,
        source: "manual",
        status: "human_annotation",
      };
    } else
      f.ball =
        e?.kind === "missing" ? null : f.ball_auto ? { ...f.ball_auto } : null;
    if (f.f)
      Object.assign(f.f, {
        ball_x_px: f.ball?.x ?? null,
        ball_y_px: f.ball?.y ?? null,
        ball_visibility: f.ball?.confidence ?? null,
      });
  }
  return data;
}

export function ballRows(data, shots = data.shots ?? []) {
  return data.frames.map((f) => {
    const shot = shots.find((s) => f.t >= s.start && f.t <= s.end);
    const row = {
      source_sha256: data.meta.source_sha256 ?? null,
      app_version: data.meta.processing_version ?? SETTINGS.app_version,
      frame: f.i,
      t_s: f.t,
      shot_id: shot?.id ?? null,
      ball_auto_x_px: f.ball_auto?.x ?? null,
      ball_auto_y_px: f.ball_auto?.y ?? null,
      ball_auto_score: f.ball_auto?.confidence ?? null,
      ball_auto_track_id: f.ball_auto?.track_id ?? null,
      ball_candidate_count: f.ball_candidates?.length ?? null,
      ball_tracking_status: f.ball_tracking_status ?? "not_run",
      ball_edit: f.ball_edit?.kind ?? "none",
      ball_edited_at: f.ball_edit?.edited_at ?? null,
      ball_source: f.ball?.source ?? null,
      ball_x_px: f.ball?.x ?? null,
      ball_y_px: f.ball?.y ?? null,
      ball_visibility: f.ball?.confidence ?? null,
      ball_x_norm: finite(f.ball?.x) ? f.ball.x / data.meta.width : null,
      ball_y_norm: finite(f.ball?.y) ? f.ball.y / data.meta.height : null,
    };
    for (const k of BALL_COLUMNS.slice(19)) row[k] = f.f?.[k] ?? null;
    return row;
  });
}
