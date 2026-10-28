/** Offline image-plane trajectory reconstruction. Raw observations are never changed. */
import { SETTINGS } from "./settings.mjs";
export const BALL_METHOD = "robust_parabola_v1";
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const rounded = (v) => (finite(v) ? Number(v.toFixed(5)) : null);

function solve(a, b) {
  const m = a.map((r, i) => [...r, b[i]]),
    n = b.length;
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++)
      if (Math.abs(m[i][k]) > Math.abs(m[pivot][k])) pivot = i;
    if (Math.abs(m[pivot][k]) < 1e-10) return null;
    [m[k], m[pivot]] = [m[pivot], m[k]];
    const d = m[k][k];
    for (let j = k; j <= n; j++) m[k][j] /= d;
    for (let i = 0; i < n; i++)
      if (i !== k) {
        const q = m[i][k];
        for (let j = k; j <= n; j++) m[i][j] -= q * m[k][j];
      }
  }
  return m.map((r) => r[n]);
}
function regression(points, axis, degree) {
  const n = degree + 1,
    a = Array.from({ length: n }, () => Array(n).fill(0)),
    b = Array(n).fill(0);
  for (const p of points) {
    const u = Array.from({ length: n }, (_, j) => p.u ** j);
    for (let i = 0; i < n; i++) {
      b[i] += u[i] * p[axis];
      for (let j = 0; j < n; j++) a[i][j] += u[i] * u[j];
    }
  }
  return solve(a, b);
}
const model = (points) => ({
  x: regression(points, "x", 1),
  y: regression(points, "y", 2),
});
const position = (m, u) => ({
  x: m.x[0] + m.x[1] * u,
  y: m.y[0] + m.y[1] * u + m.y[2] * u * u,
});
const residual = (m, p) => {
  const q = position(m, p.u);
  return Math.hypot(q.x - p.x, q.y - p.y);
};
function plausible(m, h, w) {
  if (!m.x || !m.y) return false;
  const apex = -m.y[1] / (2 * m.y[2]);
  return (
    m.y[2] > h * 0.03 &&
    m.y[2] < h * 5 &&
    apex > 0.12 &&
    apex < 1.5 &&
    Math.abs(m.x[1]) > w * 0.025
  );
}

export function fitFlight(frames, shot, meta) {
  const config = (meta.analysis_settings ?? SETTINGS).ballistics;
  const searchEnd = Math.min(shot.end, shot.release + config.search_window_s),
    threshold = Math.max(
      config.min_residual_px,
      meta.height * config.residual_height_fraction,
    );
  const points = frames
    .filter(
      (f) =>
        f.t >= shot.release &&
        f.t <= searchEnd &&
        finite(f.ball?.x) &&
        finite(f.ball?.y),
    )
    .map((f) => ({ t: f.t, u: f.t - shot.release, x: f.ball.x, y: f.ball.y }));
  const empty = {
    shot_id: shot.id,
    status: "insufficient_observations",
    method: BALL_METHOD,
    offline: true,
    search_end_s: searchEnd,
    n_observations: points.length,
    n_inliers: 0,
  };
  if (points.length < config.min_observations) return empty;
  let seed = config.random_seed,
    best = null,
    bestInliers = [];
  const rand = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let trial = 0; trial < config.ransac_trials; trial++) {
    const ids = [
      rand(points.length),
      rand(points.length),
      rand(points.length),
    ].sort((a, b) => a - b);
    const p = ids.map((i) => points[i]);
    if (p[1].u - p[0].u < 0.12 || p[2].u - p[1].u < 0.12) continue;
    const m = model(p);
    if (!plausible(m, meta.height, meta.width)) continue;
    const inside = points.filter((p) => residual(m, p) <= threshold);
    if (
      inside.length < config.min_observations ||
      inside[0].u > 0.22 ||
      inside.at(-1).u - inside[0].u < 0.45
    )
      continue;
    if (inside.length > bestInliers.length) {
      best = m;
      bestInliers = inside;
    }
  }
  if (!best) return { ...empty, status: "no_valid_parabola" };
  // Three successive observed departures after the apex mark a contact/bounce.
  const apex = -best.y[1] / (2 * best.y[2]);
  let streak = 0,
    cut = Infinity;
  for (let i = 0; i < points.length; i++) {
    if (points[i].u <= apex) {
      streak = 0;
      continue;
    }
    streak = residual(best, points[i]) > threshold ? streak + 1 : 0;
    if (streak === 3) {
      cut = points[i - 2].t;
      break;
    }
  }
  let inside = bestInliers.filter((p) => p.t < cut);
  for (let k = 0; k < 3; k++) {
    if (inside.length < config.min_observations) break;
    const candidate = model(inside);
    if (!plausible(candidate, meta.height, meta.width)) break;
    best = candidate;
    inside = points.filter((p) => p.t < cut && residual(best, p) <= threshold);
  }
  if (
    inside.length < config.min_observations ||
    inside[0].u > 0.22 ||
    inside.at(-1).u <= -best.y[1] / (2 * best.y[2]) + 0.1
  )
    return { ...empty, status: "insufficient_flight_span" };
  best = model(inside);
  const start = inside[0].t,
    end = inside.at(-1).t,
    rmse = Math.sqrt(
      inside.reduce((s, p) => s + residual(best, p) ** 2, 0) / inside.length,
    );
  return {
    shot_id: shot.id,
    status: "fitted",
    method: BALL_METHOD,
    offline: true,
    origin_s: shot.release,
    start_s: start,
    end_s: end,
    search_end_s: searchEnd,
    n_observations: points.length,
    n_inliers: inside.length,
    threshold_px: threshold,
    rmse_px: rmse,
    x: best.x,
    y: best.y,
  };
}

export function correctBallistics(data, shots = data.shots ?? []) {
  const fits = shots.map((s) => fitFlight(data.frames, s, data.meta));
  for (const frame of data.frames) {
    const fit = fits.find(
      (f) =>
        f.status === "fitted" &&
        frame.t >= f.start_s - 1e-6 &&
        frame.t <= f.end_s + 1e-6,
    );
    let corrected = null,
      status = frame.ball ? "outside_flight" : "unavailable",
      error = null,
      inlier = null;
    if (fit) {
      const point = position(fit, frame.t - fit.origin_s);
      corrected = { x: point.x, y: point.y, shot_id: fit.shot_id };
      if (finite(frame.ball?.x) && finite(frame.ball?.y)) {
        error = Math.hypot(frame.ball.x - point.x, frame.ball.y - point.y);
        inlier = error <= fit.threshold_px ? 1 : 0;
        status = inlier ? "observed_fit" : "outlier_replaced";
      } else status = "interpolated";
    }
    frame.ball_corrected = corrected;
    Object.assign(frame.f, {
      ball_x_px_corrected: rounded(corrected?.x),
      ball_y_px_corrected: rounded(corrected?.y),
      ball_correction_status: status,
      ball_fit_shot_id: fit?.shot_id ?? null,
      ball_fit_inlier: inlier,
      ball_fit_residual_px: rounded(error),
      ball_fit_rmse_px: rounded(fit?.rmse_px),
      ball_fit_available_at_s: fit?.search_end_s ?? null,
      ball_correction_method: fit ? BALL_METHOD : null,
    });
  }
  for (const f of fits)
    if (f.status === "fitted")
      f.n_interpolated = data.frames.filter(
        (p) =>
          p.f.ball_fit_shot_id === f.shot_id &&
          p.f.ball_correction_status === "interpolated",
      ).length;
  data.ball_fits = fits;
  data.meta.ball_correction = {
    method: BALL_METHOD,
    offline: true,
    model: "x=x0+vx*u; y=y0+vy*u+a*u^2; u=t-release_s",
    scope:
      "First supported free-flight interval, before sustained departure/contact; no extrapolation outside inlier support.",
    raw_preserved: true,
  };
  return data;
}
