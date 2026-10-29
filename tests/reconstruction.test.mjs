import test from "node:test";
import assert from "node:assert/strict";
import {
  enrich,
  shotRows,
  frameRows,
  landmarkRows,
} from "../public/engine.mjs";
import { correctBallistics } from "../public/ballistics.mjs";
import { ballRows } from "../public/ball-tracking.mjs";
import { medianBackground, motionCandidates } from "../public/ball-motion.mjs";
import {
  statistics,
  phaseRows,
  waveformRows,
  sampleMetric,
  pcaRows,
} from "../public/shot-statistics.mjs";
import { dictionaryRows } from "../public/dictionary.mjs";
const shot = {
  id: 1,
  start: 0,
  drive: 0.2,
  release: 0.4,
  end: 1.8,
  outcome: null,
  timing_reviewed: true,
};
const point = (t) => ({
  x: 100 + 160 * (t - 0.4),
  y: 240 - 220 * (t - 0.4) + 170 * (t - 0.4) ** 2,
});
function session() {
  return {
    schema: "shotlab/1.0",
    meta: {
      width: 640,
      height: 360,
      duration: 2,
      player_id: "P1",
      session_id: "S1",
      shooting_hand: "right",
    },
    frames: Array.from({ length: 61 }, (_, i) => ({
      i,
      t: i / 30,
      p: null,
      world: null,
      ball: null,
    })),
    shots: [{ ...shot }],
  };
}
test("three observed anchors interpolate a missing flight without inventing raw observations", () => {
  const d = session();
  for (const i of [12, 27, 42])
    d.frames[i].ball_edit = { kind: "point", ...point(i / 30) };
  enrich(d);
  assert.equal(d.ball_fits[0].status, "fitted");
  assert.equal(d.ball_fits[0].basis, "manual_anchors");
  assert.equal(d.frames[22].ball, null);
  assert.ok(Math.abs(d.frames[22].ball_corrected.y - point(22 / 30).y) < 1e-6);
  assert.equal(d.frames[43].ball_corrected, null);
  assert.equal(d.frames[11].ball_corrected, null);
  const restored = enrich(JSON.parse(JSON.stringify(d)));
  assert.deepEqual(restored.ball_fits, d.ball_fits);
});
test("assumed anchors never become observations or disappear from provenance on restore", () => {
  const d = session();
  for (const i of [12, 27, 42])
    d.frames[i].ball_edit = { kind: "assumed", ...point(i / 30) };
  enrich(d);
  assert.equal(d.ball_fits[0].status, "fitted");
  assert.equal(d.ball_fits[0].n_observations, 0);
  assert.equal(d.ball_fits[0].n_assumed, 3);
  assert.equal(d.frames[27].ball, null);
  assert.equal(d.frames[22].f.ball_correction_status, "assumption_based");
  assert.equal(ballRows(d)[27].ball_assumed_x_px, point(0.9).x);
  assert.equal(ballRows(d)[27].ball_x_px, null);
  const restored = enrich(JSON.parse(JSON.stringify(d)));
  assert.equal(restored.frames[27].ball, null);
  assert.equal(restored.ball_fits[0].n_assumed, 3);
});
test("two anchors, inconsistent points and nearly coincident timestamps do not claim a fitted flight", () => {
  const d = session();
  for (const i of [12, 27])
    d.frames[i].ball_edit = { kind: "point", ...point(i / 30) };
  enrich(d);
  assert.notEqual(d.ball_fits[0].status, "fitted");
  d.frames[42].ball_edit = { kind: "point", x: 260, y: 20 };
  correctBallistics(d);
  assert.equal(d.ball_fits[0].status, "inconsistent_anchors");
  const near = session();
  for (const i of [12, 13, 14])
    near.frames[i].ball_edit = { kind: "point", ...point(i / 30) };
  enrich(near);
  assert.equal(near.ball_fits[0].status, "anchors_too_close");
});
test("candidate-based recovery can join a flight while preserving the original tracker output", () => {
  const d = session();
  for (let i = 12; i <= 48; i += 2)
    d.frames[i].ball_candidates = [
      { ...point(i / 30), source: "motion_component", confidence: 0.5 },
      { x: 500, y: 320, source: "motion_component", confidence: 0.9 },
    ];
  enrich(d);
  assert.equal(d.ball_fits[0].status, "fitted");
  assert.equal(d.frames[20].ball_auto, null);
  assert.equal(d.frames[20].ball.source, "motion_component");
  assert.ok(d.frames[20].ball_recovered);
  const once = JSON.stringify(d.ball_fits);
  correctBallistics(d);
  assert.equal(JSON.stringify(d.ball_fits), once);
});
test("motion detection observes a small bright moving object, rejects identical background, and maps crop coordinates", () => {
  const w = 100,
    h = 100,
    bg = new Uint8ClampedArray(w * h * 4),
    im = bg.slice();
  for (let y = 46; y < 54; y++)
    for (let x = 66; x < 74; x++) {
      const i = (y * w + x) * 4;
      im[i] = im[i + 1] = im[i + 2] = 220;
      im[i + 3] = 255;
    }
  const b = medianBackground([bg, bg, im]);
  assert.equal(b[50 * w * 4 + 70 * 4], 0);
  const c = motionCandidates(im, b, w, h, [0.2, 0.1, 0.7, 0.6], 200, 200);
  assert.equal(c.length, 1);
  assert.ok(Math.abs(c[0].x - 110) < 0.01);
  assert.ok(Math.abs(c[0].y - 70) < 0.01);
  assert.equal(
    motionCandidates(im, im, w, h, [0, 0, 1, 1], 100, 100).length,
    0,
  );
});
test("mean, median, sample SD and IQR are independently known and ignore missing values", () => {
  const s = statistics([1, 2, null, 3, 4, NaN]);
  assert.equal(s.n_valid, 4);
  assert.equal(s.mean, 2.5);
  assert.equal(s.median, 2.5);
  assert.equal(s.sd, 1.29099);
  assert.equal(s.iqr, 1.5);
  assert.equal(s.rom, 3);
  assert.equal(statistics([null]).mean, null);
  assert.equal(statistics([2]).sd, null);
});
test("phase statistics exclude the next phase and normalized waveforms leave long gaps missing", () => {
  const d = enrich(session());
  d.frames.forEach((f) => {
    f.f.right_elbow_deg = f.t < 0.2 ? 10 : f.t < 0.4 ? 20 : 100;
  });
  const rows = phaseRows(d);
  assert.equal(rows[0].right_elbow_deg_mean_phase, 10);
  assert.equal(rows[1].right_elbow_deg_mean_phase, 20);
  assert.equal(rows[2].right_elbow_deg_mean_phase, 100);
  assert.equal(waveformRows(d).length, 153);
  assert.equal(waveformRows(d)[0].phase_percent, 0);
  assert.equal(waveformRows(d)[50].phase_percent, 100);
  const sparse = [
    { t: 0, f: { x: 0 } },
    { t: 0.5, f: { x: 100 } },
  ];
  assert.equal(sampleMetric(sparse, 0.2, "x").value, null);
  assert.equal(sampleMetric(sparse, 0.6, "x").value, null);
  assert.equal(
    sampleMetric(
      [
        { t: 0, f: { x: 0 } },
        { t: 0.1, f: { x: 10 } },
      ],
      0.05,
      "x",
    ).value,
    5,
  );
});
test("pre-release statistics do not leak follow-through values; PCA filters low-coverage and unknown-side rows", () => {
  const d = enrich(session());
  d.frames.forEach((f) => {
    f.f.right_elbow_deg = f.t <= 0.4 ? 30 : 999;
  });
  const r = shotRows(d, d.shots)[0];
  assert.equal(r.right_elbow_deg_mean_pre, 30);
  assert.equal(r.right_elbow_deg_median_pre, 30);
  d.frames.forEach((f) => {
    for (const joint of ["elbow", "shoulder", "hip", "knee"]) {
      f.f["right_" + joint + "_deg"] = 80;
      f.f["left_" + joint + "_deg"] = 30;
    }
    f.f.trunk_lean_deg = 5;
  });
  assert.equal(pcaRows(d)[0].pca_ready, 1);
  assert.equal(pcaRows(d)[0].shooting_elbow_deg_at_release, 80);
  d.meta.shooting_hand = "left";
  assert.equal(pcaRows(d)[0].shooting_elbow_deg_at_release, 30);
  d.meta.shooting_hand = "unknown";
  assert.equal(pcaRows(d)[0].pca_ready, 0);
  assert.equal(pcaRows(d)[0].shooting_elbow_deg_at_release, null);
  d.meta.shooting_hand = "right";
  d.frames.filter((f) => f.t < 0.4).forEach((f) => (f.f.right_knee_deg = null));
  assert.equal(pcaRows(d)[0].pca_ready, 0);
});
test("every downloadable data table has an exact complete dictionary", () => {
  const d = enrich(session()),
    dict = dictionaryRows();
  for (const [file, rows] of [
    ["frames", frameRows(d, d.shots)],
    ["shots", shotRows(d, d.shots)],
    ["body", landmarkRows(d, { bodyOnly: true })],
    ["landmarks", landmarkRows(d)],
    ["ball", ballRows(d)],
    ["phases", phaseRows(d)],
    ["waveforms", waveformRows(d)],
    ["pca", pcaRows(d)],
  ]) {
    assert.deepEqual(
      dict.filter((v) => v.file === file + ".csv").map((v) => v.column),
      Object.keys(rows[0]),
    );
    assert.ok(
      dict
        .filter((v) => v.file === file + ".csv")
        .every((v) => v.description_ja),
    );
  }
});
