/** Descriptive statistics of valid samples; no missing value is replaced by zero. */
import { SETTINGS } from "./settings.mjs";
export const SHOT_METRICS = [
  "left_elbow_deg",
  "right_elbow_deg",
  "left_shoulder_deg",
  "right_shoulder_deg",
  "left_knee_deg",
  "right_knee_deg",
  "left_hip_deg",
  "right_hip_deg",
  "left_ankle_deg",
  "right_ankle_deg",
  "trunk_lean_deg",
];
export const PHASES = ["setup", "drive", "follow_through"];
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const round = (v) => (finite(v) ? Number(v.toFixed(5)) : null);
export function statistics(values) {
  const a = values.filter(finite).sort((x, y) => x - y),
    n = a.length;
  const q = (p) => {
    const z = (n - 1) * p,
      i = Math.floor(z);
    return n ? a[i] + (a[Math.min(i + 1, n - 1)] - a[i]) * (z - i) : null;
  };
  const mean = n ? a.reduce((s, v) => s + v, 0) / n : null;
  return {
    n_valid: n,
    mean: round(mean),
    median: round(q(0.5)),
    sd:
      n > 1
        ? round(Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)))
        : null,
    iqr: n ? round(q(0.75) - q(0.25)) : null,
    rom: n ? round(a.at(-1) - a[0]) : null,
  };
}
export function identity(data) {
  return {
    source_sha256: data.meta.source_sha256 ?? null,
    app_version: data.meta.processing_version ?? SETTINGS.app_version,
    player_id: data.meta.player_id ?? "",
    session_id: data.meta.session_id ?? "",
    shooting_hand: data.meta.shooting_hand ?? "unknown",
  };
}
export function phaseBounds(s, phase) {
  return phase === "setup"
    ? [s.start, s.drive]
    : phase === "drive"
      ? [s.drive, s.release]
      : [s.release, s.end];
}
export function phaseFrames(data, s, phase) {
  const [a, b] = phaseBounds(s, phase);
  return b > a
    ? data.frames.filter(
        (f) => f.t >= a && (phase === "follow_through" ? f.t <= b : f.t < b),
      )
    : [];
}
export function phaseRows(data, shots = data.shots ?? []) {
  return shots.flatMap((s) =>
    PHASES.map((phase) => {
      const [a, b] = phaseBounds(s, phase),
        frames = phaseFrames(data, s, phase);
      const row = {
        ...identity(data),
        shot_id: s.id,
        phase,
        phase_start_s: a,
        phase_end_s: b,
        phase_duration_s: round(b - a),
        timing_reviewed: Number(!!s.timing_reviewed),
        n_phase_frames: frames.length,
      };
      for (const k of SHOT_METRICS) {
        const st = statistics(frames.map((f) => f.f?.[k]));
        for (const [stat, v] of Object.entries(st))
          row[k + "_" + stat + "_phase"] = v;
        row[k + "_valid_fraction_phase"] = frames.length
          ? round(st.n_valid / frames.length)
          : null;
      }
      return row;
    }),
  );
}
// Local interpolation only. Long gaps remain missing, even after time normalization.
export function sampleMetric(frames, t, key, maxGap = 0.12) {
  let lo = 0,
    hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t - 1e-7) lo = mid + 1;
    else hi = mid;
  }
  const right = frames[lo],
    left = frames[lo - 1];
  if (right && Math.abs(right.t - t) < 1e-6)
    return {
      value: finite(right.f?.[key]) ? right.f[key] : null,
      source: finite(right.f?.[key]) ? "sample" : "missing",
    };
  if (
    !left ||
    !right ||
    right.t - left.t > maxGap + 1e-6 ||
    !finite(left.f?.[key]) ||
    !finite(right.f?.[key])
  )
    return { value: null, source: "missing" };
  return {
    value: round(
      left.f[key] +
        ((right.f[key] - left.f[key]) * (t - left.t)) / (right.t - left.t),
    ),
    source: "linear_interpolation",
  };
}
export function waveformRows(data, shots = data.shots ?? []) {
  const c = { ...SETTINGS.features, ...data.meta.analysis_settings?.features };
  return shots.flatMap((s) =>
    PHASES.flatMap((phase) => {
      const [a, b] = phaseBounds(s, phase);
      if (b <= a) return [];
      // Interpolation may use adjoining samples, but never future-of-release data in setup/drive.
      const support = data.frames.filter(
        (f) =>
          f.t >= s.start &&
          f.t <= (phase === "follow_through" ? s.end : s.release),
      );
      return Array.from({ length: c.waveform_points }, (_, i) => {
        const percent = (100 * i) / (c.waveform_points - 1),
          t = a + ((b - a) * percent) / 100;
        const row = {
          ...identity(data),
          shot_id: s.id,
          phase,
          phase_percent: round(percent),
          source_t_s: round(t),
          phase_duration_s: round(b - a),
          timing_reviewed: Number(!!s.timing_reviewed),
        };
        for (const k of SHOT_METRICS) {
          const v = sampleMetric(support, t, k, c.interpolation_max_gap_s);
          row[k] = v.value;
          row[k + "_sample_source"] = v.source;
        }
        return row;
      });
    }),
  );
}
export const PCA_FEATURES = [
  "shooting_elbow_deg_at_release",
  "shooting_shoulder_deg_at_release",
  "shooting_knee_deg_min_pre",
  "shooting_hip_deg_min_pre",
  "trunk_lean_deg_at_release",
  "shooting_elbow_deg_mean_drive",
  "shooting_knee_deg_median_setup",
  "shooting_elbow_deg_rom_pre",
  "shooting_knee_deg_rom_pre",
  "drive_duration_s",
];
export function pcaRows(data, shots = data.shots ?? []) {
  const c = { ...SETTINGS.features, ...data.meta.analysis_settings?.features };
  return shots.map((s) => {
    const side = ["left", "right"].includes(data.meta.shooting_hand)
      ? data.meta.shooting_hand
      : null;
    const pre = data.frames.filter((f) => f.t >= s.start && f.t <= s.release);
    const setup = phaseFrames(data, s, "setup"),
      drive = phaseFrames(data, s, "drive");
    const sample = data.frames.filter((f) => f.t <= s.release).at(-1);
    const release =
      sample &&
      s.release - sample.t <=
        (data.meta.analysis_settings ?? SETTINGS).timing.lookup_max_age_s
        ? sample.f
        : {};
    const coverage = [];
    const st = (frames, key, kind) => {
      const a = frames.map((f) => f.f?.[key]),
        n = a.filter(finite).length,
        q = frames.length ? n / frames.length : 0;
      coverage.push(q);
      if (q < c.min_valid_fraction || n < c.min_valid_samples) return null;
      const v = statistics(a);
      return kind === "min" ? Math.min(...a.filter(finite)) : v[kind];
    };
    const row = {
      ...identity(data),
      shot_id: s.id,
      timing_reviewed: Number(!!s.timing_reviewed),
      success: s.outcome ?? null,
    };
    row.shooting_elbow_deg_at_release = side
      ? (release?.[side + "_elbow_deg"] ?? null)
      : null;
    row.shooting_shoulder_deg_at_release = side
      ? (release?.[side + "_shoulder_deg"] ?? null)
      : null;
    row.shooting_knee_deg_min_pre = side
      ? st(pre, side + "_knee_deg", "min")
      : null;
    row.shooting_hip_deg_min_pre = side
      ? st(pre, side + "_hip_deg", "min")
      : null;
    row.trunk_lean_deg_at_release = release?.trunk_lean_deg ?? null;
    row.shooting_elbow_deg_mean_drive = side
      ? st(drive, side + "_elbow_deg", "mean")
      : null;
    row.shooting_knee_deg_median_setup = side
      ? st(setup, side + "_knee_deg", "median")
      : null;
    row.shooting_elbow_deg_rom_pre = side
      ? st(pre, side + "_elbow_deg", "rom")
      : null;
    row.shooting_knee_deg_rom_pre = side
      ? st(pre, side + "_knee_deg", "rom")
      : null;
    row.drive_duration_s = round(s.release - s.drive);
    row.feature_min_valid_fraction = coverage.length
      ? round(Math.min(...coverage))
      : null;
    row.pca_ready = Number(
      !!side &&
        !!data.meta.player_id &&
        !!s.timing_reviewed &&
        row.drive_duration_s > 0 &&
        PCA_FEATURES.every((k) => finite(row[k])),
    );
    return row;
  });
}
