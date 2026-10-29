/** Offline image-plane trajectory reconstruction. Raw observations are never changed. */
import { SETTINGS } from "./settings.mjs";
import { applyBallEdits } from "./ball-tracking.mjs";
export const BALL_METHOD = "hybrid_parabola_v2";
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
  const config = {
    ...SETTINGS.ballistics,
    ...meta.analysis_settings?.ballistics,
  };
  const searchEnd = Math.min(shot.end, shot.release + config.search_window_s);
  const threshold = Math.max(
    config.min_residual_px,
    meta.height * config.residual_height_fraction,
  );
  const window = frames.filter(
    (f) => f.t >= shot.release - 1e-6 && f.t <= searchEnd + 1e-6,
  );
  const anchors = window
    .filter((f) => ["point", "assumed"].includes(f.ball_edit?.kind))
    .map((f) => ({
      t: f.t,
      u: f.t - shot.release,
      x: f.ball_edit.x,
      y: f.ball_edit.y,
      assumed: f.ball_edit.kind === "assumed",
      manual: true,
    }));
  const points = window.flatMap((f) => {
    if (f.ball_edit?.kind === "missing") return [];
    const anchor = anchors.find((p) => Math.abs(p.t - f.t) < 1e-7);
    if (anchor) return [anchor];
    const candidates = [
      ...(f.ball_candidates ?? []),
      ...(f.ball ? [f.ball] : []),
    ];
    return candidates
      .filter(
        (p, i) =>
          finite(p.x) &&
          finite(p.y) &&
          !candidates
            .slice(0, i)
            .some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1),
      )
      .map((p) => ({ ...p, t: f.t, u: f.t - shot.release }));
  });
  const unique = (m, pool) => {
    const byTime = new Map();
    for (const p of pool)
      if (
        residual(m, p) <= threshold &&
        (!byTime.has(p.t) || residual(m, p) < residual(m, byTime.get(p.t)))
      )
        byTime.set(p.t, p);
    return [...byTime.values()].sort((a, b) => a.t - b.t);
  };
  const empty = {
    shot_id: shot.id,
    status: "insufficient_observations",
    method: BALL_METHOD,
    offline: true,
    search_end_s: searchEnd,
    n_observations: new Set(points.filter((p) => !p.assumed).map((p) => p.t))
      .size,
    n_inliers: 0,
    n_manual: anchors.filter((p) => !p.assumed).length,
    n_assumed: anchors.filter((p) => p.assumed).length,
    basis: null,
    quality: null,
  };
  const finish = (m, inside, basis) => {
    const rmse = Math.sqrt(
      inside.reduce((s, p) => s + residual(m, p) ** 2, 0) / inside.length,
    );
    return {
      ...empty,
      status: "fitted",
      basis,
      quality: empty.n_assumed
        ? "assumption_dependent"
        : inside.length === 3
          ? "three_point_unvalidated"
          : "review_required",
      origin_s: shot.release,
      start_s: inside[0].t,
      end_s: inside.at(-1).t,
      n_inliers: inside.length,
      threshold_px: threshold,
      rmse_px: rmse,
      x: m.x,
      y: m.y,
      support: inside.map((p) => ({
        t: p.t,
        x: p.x,
        y: p.y,
        source: p.source ?? (p.assumed ? "assumed" : "manual"),
        manual: !!p.manual,
        assumed: !!p.assumed,
      })),
    };
  };
  // Three manual anchors can reconstruct a flight even when the detector found none.
  // Their actual timestamps determine the curve; an assumed anchor is never an observation.
  if (anchors.length >= 3) {
    const spaced = [];
    for (const p of anchors)
      if (
        !spaced.length ||
        p.t - spaced.at(-1).t >= config.manual_min_separation_s
      )
        spaced.push(p);
    if (
      spaced.length < 3 ||
      anchors.at(-1).t - anchors[0].t < config.manual_min_span_s
    )
      return { ...empty, status: "anchors_too_close" };
    const m = model(anchors);
    if (
      !m.x ||
      !m.y ||
      m.y[2] <= 0 ||
      m.y[2] > meta.height * 10 ||
      anchors.some((p) => residual(m, p) > threshold * 2)
    )
      return { ...empty, status: "inconsistent_anchors" };
    return finish(
      m,
      anchors,
      empty.n_assumed ? "assumed_anchors" : "manual_anchors",
    );
  }
  if (new Set(points.map((p) => p.t)).size < config.min_observations)
    return empty;
  let seed = config.random_seed,
    best = null,
    bestInliers = [],
    bestError = Infinity;
  const rand = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 4294967296) * n);
  };
  const wristFrame = frames
    .filter(
      (f) => f.t <= shot.release + 0.12 && f.t >= shot.release - 0.2 && f.p,
    )
    .at(-1);
  const wrists = wristFrame
    ? [15, 16]
        .map((i) => wristFrame.p[i])
        .filter((p) => p && p[3] >= 0.5)
        .map((p) => ({ x: p[0] * meta.width, y: p[1] * meta.height }))
    : [];
  const initial = points.filter(
    (p) =>
      p.u <= 0.3 &&
      (!wrists.length ||
        Math.min(...wrists.map((w) => Math.hypot(p.x - w.x, p.y - w.y))) <
          Math.hypot(meta.width, meta.height) * 0.15),
  );
  const middle = points.filter((p) => p.u > 0.3 && p.u < 0.9),
    late = points.filter((p) => p.u >= 0.8);
  for (let trial = 0; trial < config.ransac_trials; trial++) {
    const guided =
      trial % 2 === 0 && initial.length && middle.length && late.length;
    const sample = (
      guided
        ? [
            initial[rand(initial.length)],
            middle[rand(middle.length)],
            late[rand(late.length)],
          ]
        : [
            points[rand(points.length)],
            points[rand(points.length)],
            points[rand(points.length)],
          ]
    ).sort((a, b) => a.t - b.t);
    if (sample[1].t - sample[0].t < 0.08 || sample[2].t - sample[1].t < 0.08)
      continue;
    const m = model(sample);
    if (!plausible(m, meta.height, meta.width)) continue;
    if (anchors.some((p) => residual(m, p) > threshold * 2)) continue;
    if (
      wrists.length &&
      Math.min(...wrists.map((w) => Math.hypot(m.x[0] - w.x, m.y[0] - w.y))) >
        Math.hypot(meta.width, meta.height) * config.wrist_gate_diag_fraction
    )
      continue;
    const inside = unique(m, points);
    if (
      inside.length < config.min_observations ||
      inside.at(-1).t - inside[0].t < config.auto_min_span_s
    )
      continue;
    if (
      inside.length /
        window.filter((f) => f.t >= inside[0].t && f.t <= inside.at(-1).t)
          .length <
      config.min_support_fraction
    )
      continue;
    const err = inside.reduce((s, p) => s + residual(m, p), 0) / inside.length;
    if (
      inside.length > bestInliers.length ||
      (inside.length === bestInliers.length && err < bestError)
    ) {
      best = m;
      bestInliers = inside;
      bestError = err;
    }
  }
  if (!best) return { ...empty, status: "no_valid_parabola" };
  // Detect sustained departure in selected observations, never count competing same-frame candidates.
  const apex = -best.y[1] / (2 * best.y[2]);
  let streak = 0,
    cut = Infinity,
    departures = [];
  for (let i = 0; i < window.length; i++) {
    const f = window[i];
    if (f.t - shot.release <= apex) {
      streak = 0;
      departures = [];
      continue;
    }
    const ps = points.filter((p) => p.t === f.t);
    if (!ps.length) continue;
    if (ps.every((p) => residual(best, p) > threshold)) {
      streak++;
      departures.push(f.t);
    } else {
      streak = 0;
      departures = [];
    }
    if (streak === 3) {
      cut = departures[0];
      break;
    }
  }
  let inside = bestInliers.filter((p) => p.t < cut);
  for (let i = 0; i < 3; i++) {
    if (inside.length < config.min_observations) break;
    const m = model(inside);
    if (!plausible(m, meta.height, meta.width)) break;
    best = m;
    inside = unique(
      best,
      points.filter((p) => p.t < cut),
    );
  }
  if (
    inside.length < config.min_observations ||
    inside.at(-1).t - inside[0].t < config.auto_min_span_s ||
    inside.length /
      window.filter((f) => f.t >= inside[0].t && f.t <= inside.at(-1).t)
        .length <
      config.min_support_fraction
  )
    return { ...empty, status: "insufficient_flight_span" };
  const final = model(inside);
  if (
    !plausible(final, meta.height, meta.width) ||
    anchors.some((p) => residual(final, p) > threshold * 2)
  )
    return { ...empty, status: "no_valid_parabola" };
  return finish(
    final,
    inside,
    empty.n_assumed
      ? "assumed_and_automatic"
      : anchors.length
        ? "manual_and_automatic"
        : "automatic_candidates",
  );
}

export function correctBallistics(data, shots = data.shots ?? []) {
  applyBallEdits(data);
  const fits = shots.map((s) => fitFlight(data.frames, s, data.meta));
  for (const frame of data.frames) {
    frame.ball_recovered = null;
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
      const support = fit.support.find((p) => Math.abs(p.t - frame.t) < 1e-6);
      if (
        support &&
        !support.manual &&
        frame.ball_edit?.kind !== "missing" &&
        (!frame.ball ||
          residual(
            { x: fit.x, y: fit.y },
            { ...frame.ball, u: frame.t - fit.origin_s },
          ) > fit.threshold_px)
      ) {
        frame.ball_recovered = {
          x: support.x,
          y: support.y,
          source: support.source,
          confidence: null,
          status: "trajectory_selected_candidate",
        };
        frame.ball = { ...frame.ball_recovered };
        Object.assign(frame.f, {
          ball_x_px: frame.ball.x,
          ball_y_px: frame.ball.y,
          ball_visibility: null,
        });
      }
      const point = position(fit, frame.t - fit.origin_s);
      corrected = { x: point.x, y: point.y, shot_id: fit.shot_id };
      if (finite(frame.ball?.x) && finite(frame.ball?.y)) {
        error = Math.hypot(frame.ball.x - point.x, frame.ball.y - point.y);
        inlier = error <= fit.threshold_px ? 1 : 0;
        status = inlier ? "observed_fit" : "outlier_replaced";
      } else status = "interpolated";
      if (fit.n_assumed) status = "assumption_based";
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
      ball_fit_basis: fit?.basis ?? null,
      ball_fit_n_assumed: fit?.n_assumed ?? null,
      ball_fit_quality: fit?.quality ?? null,
    });
  }
  for (const f of fits)
    if (f.status === "fitted")
      f.n_interpolated = data.frames.filter(
        (p) =>
          p.f.ball_fit_shot_id === f.shot_id &&
          ["interpolated", "assumption_based"].includes(
            p.f.ball_correction_status,
          ) &&
          !p.ball,
      ).length;
  data.ball_fits = fits;
  data.meta.ball_correction = {
    method: BALL_METHOD,
    offline: true,
    model: "x=x0+vx*u; y=y0+vy*u+a*u^2; u=t-release_s",
    scope:
      "First supported free-flight interval, before sustained departure/contact; no extrapolation outside inlier support.",
    raw_preserved: true,
    settings: {
      ...SETTINGS.ballistics,
      ...data.meta.analysis_settings?.ballistics,
    },
    assumed_anchors_are_observations: false,
  };
  return data;
}
