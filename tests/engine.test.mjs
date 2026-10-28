import test from "node:test";
import assert from "node:assert/strict";
import {
  enrich,
  frameRows,
  landmarkRows,
  shotRows,
  csv,
  validateShots,
} from "../public/engine.mjs";
import { dictionaryRows } from "../public/dictionary.mjs";
import { SETTINGS } from "../public/settings.mjs";
const pose = () => Array.from({ length: 33 }, () => [0.5, 0.5, 0, 1, 1]);
const data = (frames, shots = []) => ({
  meta: { width: 800, height: 400, duration: 3 },
  frames,
  shots,
});
const frame = (i, p) => ({ i, t: i / 30, p, world: null, ball: null });
const shot = {
  id: 1,
  start: 0,
  drive: 0.1,
  release: 0.2,
  end: 1,
  outcome: null,
  label_source: "unreviewed",
  timing_source: "human_review",
  timing_reviewed: true,
};

test("2D angles correct for image aspect ratio; straight elbow is 180°", () => {
  const p = pose();
  p[11] = [0.25, 0.5, 0, 1, 1];
  p[13] = [0.5, 0.5, 0, 1, 1];
  p[15] = [0.75, 0.5, 0, 1, 1];
  const d = enrich(data([frame(0, p)]));
  assert.equal(d.frames[0].f.left_elbow_deg, 180);
  // Pixel vectors (-200,100), (200,100): angle acos(-0.6), not 90°.
  p[11][1] = 0.75;
  p[15][1] = 0.75;
  assert.ok(
    Math.abs(
      enrich(data([frame(0, p)])).frames[0].f.left_elbow_deg - 126.869897,
    ) < 0.0001,
  );
});
test("low presence/visibility remains raw but angle becomes missing", () => {
  const p = pose();
  p[13][4] = 0.2;
  const d = enrich(data([frame(0, p)]));
  assert.equal(d.frames[0].f.left_elbow_deg, null);
  assert.equal(d.frames[0].p[13][4], 0.2);
  assert.equal(landmarkRows(d)[13].usable, 0);
});
test("filter is causal and missing pose is not interpolated", () => {
  const frames = Array.from({ length: 20 }, (_, i) => {
    const p = pose();
    p[15][0] = 0.2 + i * 0.01;
    return frame(i, p);
  });
  frames[6].p = null;
  const full = enrich(data(structuredClone(frames)));
  const prefix = enrich(data(structuredClone(frames.slice(0, 10))));
  assert.deepEqual(full.frames.slice(0, 10), prefix.frames);
  assert.equal(full.frames[6].f.left_elbow_deg, null);
  assert.equal(full.frames[7].f.left_elbow_velocity_deg_s, null);
});
test("body export has 16 points, raw export has 33, face is excluded", () => {
  const d = enrich(data([frame(0, pose())]));
  assert.equal(landmarkRows(d).length, 33);
  const body = landmarkRows(d, { bodyOnly: true });
  assert.equal(body.length, 16);
  assert.ok(body.every((p) => p.landmark_id >= 11));
});
test("changing success labels does not change kinematics; missing stays empty", () => {
  const d = enrich(
    data(
      Array.from({ length: 9 }, (_, i) => frame(i, pose())),
      [shot],
    ),
  );
  const a = shotRows(d, [shot])[0],
    b = shotRows(d, [{ ...shot, outcome: 1 }])[0];
  assert.deepEqual({ ...a, success: 1 }, b);
  assert.equal(a.success, null);
  assert.equal(csv([{ a: null, b: 0, c: "=1+1" }]), "\ufeffa,b,c\r\n,0,'=1+1");
  assert.equal(csv([], ["a", "b"]), "\ufeffa,b\r\n");
});
test("dictionary exactly matches all three export schemas", () => {
  const d = enrich(data([frame(0, null)], [shot]));
  const dictionary = dictionaryRows();
  for (const [file, row] of [
    ["frames.csv", frameRows(d, d.shots)[0]],
    ["shots.csv", shotRows(d, d.shots)[0]],
    ["landmarks.csv", landmarkRows(d)[0]],
  ])
    assert.deepEqual(
      dictionary.filter((x) => x.file === file).map((x) => x.column),
      Object.keys(row),
    );
  assert.equal(dictionary.length, 209);
});
test("saved settings are reused and defaults are stamped", () => {
  const d = data([frame(0, pose())]);
  enrich(d);
  assert.deepEqual(d.meta.analysis_settings, SETTINGS);
  d.meta.analysis_settings.confidence.landmark = 0.95;
  d.frames[0].p[13][3] = 0.9;
  enrich(d);
  assert.equal(d.frames[0].f.left_elbow_deg, null);
  assert.equal(SETTINGS.confidence.landmark, 0.5);
});
test("malformed times, overlapping shots and duplicate IDs are rejected", () => {
  assert.throws(
    () => enrich(data([frame(0, null), frame(0, null)])),
    /timestamps/,
  );
  assert.throws(() => enrich(data([frame(0, [[0, 0, 0, 1]])])), /33/);
  assert.throws(() => validateShots([shot, { ...shot, id: 2 }], 3), /重複/);
  assert.throws(() => validateShots([shot, { ...shot }], 3), /ID/);
  assert.throws(() => validateShots([{ ...shot, drive: 0.3 }], 3), /時刻/);
});
