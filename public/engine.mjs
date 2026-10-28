/** Shared deterministic analysis core. No labels enter feature calculations. */
import { SETTINGS } from "./settings.mjs";
import { correctBallistics } from "./ballistics.mjs";
export const CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7],
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8],
  [9, 10],
  [11, 12],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [17, 19],
  [15, 21],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [18, 20],
  [16, 22],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
];
export const BODY = [
  11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
];
export const NAMES = [
  "nose",
  "left_eye_inner",
  "left_eye",
  "left_eye_outer",
  "right_eye_inner",
  "right_eye",
  "right_eye_outer",
  "left_ear",
  "right_ear",
  "mouth_left",
  "mouth_right",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_pinky",
  "right_pinky",
  "left_index",
  "right_index",
  "left_thumb",
  "right_thumb",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
  "left_heel",
  "right_heel",
  "left_foot_index",
  "right_foot_index",
];
export const ANGLES = {
  left_elbow: [11, 13, 15],
  right_elbow: [12, 14, 16],
  left_knee: [23, 25, 27],
  right_knee: [24, 26, 28],
  left_hip: [11, 23, 25],
  right_hip: [12, 24, 26],
  left_shoulder: [23, 11, 13],
  right_shoulder: [24, 12, 14],
  left_ankle: [25, 27, 31],
  right_ankle: [26, 28, 32],
};
export const finite = (v) => typeof v === "number" && Number.isFinite(v);
const round = (v, n = 4) => (finite(v) ? Number(v.toFixed(n)) : null);
const conf = (p) => (p ? Math.min(p[3] ?? 0, p[4] ?? 1) : 0);
function angle(a, b, c) {
  if (!a || !b || !c) return null;
  const u = a.map((v, i) => v - b[i]),
    v = c.map((z, i) => z - b[i]);
  const den = Math.hypot(...u) * Math.hypot(...v);
  return den > 1e-9
    ? (Math.acos(
        Math.max(-1, Math.min(1, u.reduce((s, z, i) => s + z * v[i], 0) / den)),
      ) *
        180) /
        Math.PI
    : null;
}
class Euro {
  constructor(options = SETTINGS.filter) {
    this.options = options;
    this.x = null;
    this.t = null;
    this.dx = 0;
    this.raw = null;
  }
  next(x, t) {
    const dt = t - this.t;
    if (this.x === null || dt <= 0 || dt > this.options.reset_gap_s) {
      this.x = x;
      this.raw = x;
      this.t = t;
      this.dx = 0;
      return x;
    }
    const alpha = (c) => 1 / (1 + 1 / (2 * Math.PI * c * dt));
    const d = (x - this.raw) / dt;
    this.raw = x;
    this.dx += alpha(this.options.derivative_cutoff_hz) * (d - this.dx);
    this.x +=
      alpha(
        this.options.min_cutoff_hz + this.options.beta * Math.abs(this.dx),
      ) *
      (x - this.x);
    this.t = t;
    return this.x;
  }
}
function features(p, world, w, h, threshold = SETTINGS.confidence.landmark) {
  const f = {};
  for (const [key, ids] of Object.entries(ANGLES)) {
    const q = p ? Math.min(...ids.map((i) => conf(p[i]))) : 0;
    f[key + "_visibility"] = round(q);
    f[key + "_deg"] =
      p && q >= threshold
        ? round(angle(...ids.map((i) => [p[i][0] * w, p[i][1] * h])))
        : null;
    f[key + "_3d_est_deg"] =
      p && q >= threshold && world
        ? round(angle(...ids.map((i) => world[i])))
        : null;
  }
  const valid = p && [11, 12, 23, 24].every((i) => conf(p[i]) >= threshold);
  f.trunk_lean_deg = valid
    ? round(
        (Math.atan2(
          (p[11][0] + p[12][0] - (p[23][0] + p[24][0])) * w,
          (p[23][1] + p[24][1] - (p[11][1] + p[12][1])) * h,
        ) *
          180) /
          Math.PI,
      )
    : null;
  f.hip_y_px = valid ? round(((p[23][1] + p[24][1]) * h) / 2) : null;
  f.left_wrist_y_px =
    p && conf(p[15]) >= threshold ? round(p[15][1] * h) : null;
  f.right_wrist_y_px =
    p && conf(p[16]) >= threshold ? round(p[16][1] * h) : null;
  return f;
}
export function validateSession(data) {
  if (
    !data?.meta ||
    !Number.isFinite(data.meta.width) ||
    data.meta.width <= 0 ||
    !Number.isFinite(data.meta.height) ||
    data.meta.height <= 0 ||
    !Number.isFinite(data.meta.duration) ||
    data.meta.duration < 0 ||
    !Array.isArray(data.frames)
  )
    throw new Error("Invalid session metadata");
  let previous = -Infinity;
  for (const f of data.frames) {
    if (
      !Number.isFinite(f.t) ||
      f.t < 0 ||
      f.t <= previous ||
      f.t > data.meta.duration + 0.05 ||
      !Number.isInteger(f.i) ||
      f.i < 0
    )
      throw new Error("Invalid frame timestamps");
    previous = f.t;
    if (
      f.p !== null &&
      (!Array.isArray(f.p) ||
        f.p.length !== 33 ||
        f.p.some(
          (p) => !Array.isArray(p) || p.length < 4 || !p.every(Number.isFinite),
        ))
    )
      throw new Error("Expected 33 finite landmarks or null");
    if (
      f.world != null &&
      (!Array.isArray(f.world) ||
        f.world.length !== 33 ||
        f.world.some((p) => p.length !== 3 || !p.every(Number.isFinite)))
    )
      throw new Error("Invalid estimated 3D landmarks");
  }
  return data;
}
const provenance = (data) => ({
  source_sha256: data.meta.source_sha256 ?? null,
  app_version: data.meta.processing_version ?? SETTINGS.app_version,
});
export function enrich(data) {
  validateSession(data);
  const { width: w, height: h } = data.meta;
  const config = data.meta.analysis_settings ?? structuredClone(SETTINGS);
  data.meta.analysis_settings = config;
  data.meta.app_version ??= config.app_version;
  data.meta.processing_version = SETTINGS.app_version;
  data.meta.accuracy_validated = false;
  const threshold = config.confidence.landmark;
  const filters = Array.from({ length: 33 }, () => [
    new Euro(config.filter),
    new Euro(config.filter),
    new Euro(config.filter),
  ]);
  let prev = null;
  for (const frame of data.frames) {
    const p = frame.p;
    frame.raw = features(p, frame.world, w, h, threshold);
    frame.s = p
      ? p.map((v, i) => [
          ...v
            .slice(0, 3)
            .map((z, j) =>
              conf(v) >= threshold ? filters[i][j].next(z, frame.t) : z,
            ),
          v[3],
          v[4] ?? 1,
        ])
      : null;
    frame.f = features(frame.s, frame.world, w, h, threshold);
    frame.f.visible_fraction = p
      ? BODY.filter((i) => conf(p[i]) >= threshold).length / BODY.length
      : 0;
    frame.f.pose_detected = !!p;
    const dt = prev ? frame.t - prev.t : 0;
    for (const key of [
      "left_elbow",
      "right_elbow",
      "left_knee",
      "right_knee",
      "trunk_lean",
    ]) {
      const name = key + "_deg";
      frame.f[key + "_velocity_deg_s"] =
        dt > 0 &&
        dt < config.timing.velocity_max_gap_s &&
        finite(frame.f[name]) &&
        finite(prev?.f[name])
          ? round((frame.f[name] - prev.f[name]) / dt)
          : null;
    }
    frame.f.ball_x_px = frame.ball?.x ?? null;
    frame.f.ball_y_px = frame.ball?.y ?? null;
    frame.f.ball_visibility = frame.ball?.confidence ?? null;
    prev = frame;
  }
  return correctBallistics(data);
}
export function atTime(frames, t, maxAge = SETTINGS.timing.lookup_max_age_s) {
  let lo = 0,
    hi = frames.length - 1,
    best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t + 1e-6) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (best < 0) return null;
  return t - frames[best].t <= maxAge ? frames[best] : null;
}
export function suggestShots(data) {
  const config = data.meta.analysis_settings ?? SETTINGS,
    c = config.shot_candidates;
  let active = null,
    groups = [];
  for (const f of data.frames) {
    const p = f.s ?? f.p;
    const high =
      p &&
      [15, 16].some(
        (i) =>
          [i, i - 4, 0].every(
            (j) => conf(p[j]) >= config.confidence.landmark,
          ) &&
          p[i][1] < p[i - 4][1] - c.wrist_margin_norm &&
          p[i][1] < p[0][1] + c.wrist_margin_norm,
      );
    if (high) {
      if (!active) active = { start: f.t, end: f.t };
      active.end = f.t;
    } else if (active && f.t - active.end > c.max_gap_s) {
      if (active.end - active.start > c.min_high_duration_s)
        groups.push(active);
      active = null;
    }
  }
  if (active && active.end - active.start > c.min_high_duration_s)
    groups.push(active);
  return groups
    .filter(
      (g, i) => i === 0 || g.start - groups[i - 1].start > c.min_separation_s,
    )
    .map((g, i) => ({
      id: i + 1,
      start: round(Math.max(0, g.start - c.start_lead_s), 3),
      drive: round(Math.max(0, g.start - c.drive_lead_s), 3),
      release: round(g.start + c.release_offset_s, 3),
      end: round(Math.min(data.meta.duration, g.end + c.end_tail_s), 3),
      outcome: null,
      label_source: "unreviewed",
      timing_source: "pose_heuristic",
      timing_reviewed: false,
      note: "",
    }));
}
export function shotAt(shots, t) {
  return shots.find((s) => t >= s.start && t <= s.end) ?? null;
}
export function phaseAt(shots, t) {
  const s = shotAt(shots, t);
  return !s
    ? "other"
    : t < s.drive
      ? "setup"
      : t < s.release
        ? "drive"
        : "follow_through";
}
const metricKeys = Object.keys(features(null, null, 640, 360));
export function frameRows(data, shots) {
  return data.frames.map((f) => {
    const s = shotAt(shots, f.t);
    const r = {
      ...provenance(data),
      frame: f.i,
      t_s: f.t,
      shot_id: s?.id ?? null,
      phase: phaseAt(shots, f.t),
      success: s?.outcome ?? null,
      label_source: s?.label_source ?? null,
      timing_reviewed: s ? Number(!!s.timing_reviewed) : null,
      ...f.f,
      pose_detected: f.f.pose_detected ? 1 : 0,
      visible_fraction: round(f.f.visible_fraction),
    };
    for (const k of metricKeys)
      if (!k.endsWith("_visibility")) r[k + "_raw"] = f.raw[k];
    return r;
  });
}
export function landmarkRows(data, { bodyOnly = false } = {}) {
  return data.frames.flatMap((f) =>
    NAMES.map((name, i) => ({
      ...provenance(data),
      frame: f.i,
      t_s: f.t,
      landmark_id: i,
      landmark: name,
      x_norm: f.p?.[i]?.[0] ?? null,
      y_norm: f.p?.[i]?.[1] ?? null,
      z_norm_est: f.p?.[i]?.[2] ?? null,
      visibility: f.p?.[i]?.[3] ?? null,
      presence: f.p?.[i]?.[4] ?? null,
      usable:
        f.p?.[i] &&
        conf(f.p?.[i]) >=
          (data.meta.analysis_settings ?? SETTINGS).confidence.landmark
          ? 1
          : 0,
      x_norm_filtered: f.s?.[i]?.[0] ?? null,
      y_norm_filtered: f.s?.[i]?.[1] ?? null,
      world_x_m_est: f.world?.[i]?.[0] ?? null,
      world_y_m_est: f.world?.[i]?.[1] ?? null,
      world_z_m_est: f.world?.[i]?.[2] ?? null,
    })).filter((r) => !bodyOnly || BODY.includes(r.landmark_id)),
  );
}
export function shotRows(data, shots) {
  return shots.map((s) => {
    const pre = data.frames.filter((f) => f.t >= s.start && f.t <= s.release);
    const near = atTime(
      data.frames,
      s.release,
      data.meta.analysis_settings.timing.lookup_max_age_s,
    );
    const r = {
      ...provenance(data),
      shot_id: s.id,
      start_s: s.start,
      drive_s: s.drive,
      release_s: s.release,
      end_s: s.end,
      success: s.outcome,
      label_source: s.label_source,
      timing_source: s.timing_source,
      timing_reviewed: s.timing_reviewed ? 1 : 0,
      n_pre_release_frames: pre.length,
      note: s.note ?? "",
    };
    for (const k of [
      "left_knee_deg",
      "right_knee_deg",
      "left_elbow_deg",
      "right_elbow_deg",
      "left_hip_deg",
      "right_hip_deg",
      "left_ankle_deg",
      "right_ankle_deg",
      "trunk_lean_deg",
    ]) {
      const vals = pre.map((f) => f.f[k]).filter(finite);
      r[k + "_min_pre"] = vals.length ? round(Math.min(...vals)) : null;
      r[k + "_max_pre"] = vals.length ? round(Math.max(...vals)) : null;
      r[k + "_at_release"] = near?.f[k] ?? null;
      r[k + "_valid_fraction"] = pre.length
        ? round(vals.length / pre.length)
        : null;
    }
    r.mean_visible_fraction_pre = pre.length
      ? round(
          pre.reduce((sum, f) => sum + f.f.visible_fraction, 0) / pre.length,
        )
      : null;
    const fit = data.ball_fits?.find((f) => f.shot_id === s.id),
      ok = fit?.status === "fitted";
    Object.assign(r, {
      ball_fit_status: fit?.status ?? "unavailable",
      ball_fit_start_s: ok ? fit.start_s : null,
      ball_fit_end_s: ok ? fit.end_s : null,
      ball_fit_n_observations: fit?.n_observations ?? 0,
      ball_fit_n_inliers: fit?.n_inliers ?? 0,
      ball_fit_n_interpolated: ok ? fit.n_interpolated : null,
      ball_fit_rmse_px: ok ? round(fit.rmse_px) : null,
      ball_fit_x0_px: ok ? round(fit.x[0]) : null,
      ball_fit_vx_px_s: ok ? round(fit.x[1]) : null,
      ball_fit_y0_px: ok ? round(fit.y[0]) : null,
      ball_fit_vy_px_s: ok ? round(fit.y[1]) : null,
      ball_fit_a_px_s2: ok ? round(fit.y[2]) : null,
      ball_fit_available_at_s: ok ? fit.search_end_s : null,
    });
    return r;
  });
}
export function csv(rows, columns = []) {
  const cols = columns.length
    ? columns
    : [...new Set(rows.flatMap((r) => Object.keys(r)))];
  if (!cols.length) return "";
  const escape = (v) => {
    if (
      v === null ||
      v === undefined ||
      (typeof v === "number" && !Number.isFinite(v))
    )
      return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  return (
    "\ufeff" +
    cols.join(",") +
    "\r\n" +
    rows.map((r) => cols.map((k) => escape(r[k])).join(",")).join("\r\n")
  );
}
export function validateShots(shots, duration) {
  if (
    new Set(shots.map((s) => s.id)).size !== shots.length ||
    shots.some((s) => !Number.isInteger(s.id) || s.id < 1)
  )
    throw new Error("シュートIDが不正または重複しています。");
  for (const s of shots) {
    if (
      ![s.start, s.drive, s.release, s.end].every(finite) ||
      s.start < 0 ||
      !(s.start <= s.drive && s.drive < s.release && s.release <= s.end) ||
      s.end > duration + 0.05
    )
      throw new Error(
        "時刻は 0 ≤ 開始 ≤ 上昇開始 < リリース ≤ 終了 ≤ 動画長 にしてください。",
      );
    if (![null, 0, 1].includes(s.outcome))
      throw new Error("結果は成功・失敗・未確認から選んでください。");
  }
  const sorted = [...shots].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].start < sorted[i - 1].end)
      throw new Error(
        "シュート区間が重複しています。開始・終了を調整してください。",
      );
}
