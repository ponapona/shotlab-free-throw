import test from "node:test";
import assert from "node:assert/strict";
import {
  createBallTracker,
  detectionCandidates,
  applyBallEdits,
  ballRows,
  BALL_COLUMNS,
} from "../public/ball-tracking.mjs";
import { enrich, frameRows, csv } from "../public/engine.mjs";
import { correctBallistics } from "../public/ballistics.mjs";
import { dictionaryRows } from "../public/dictionary.mjs";
const candidate = (x, y, confidence = 0.8) => ({
  x,
  y,
  confidence,
  source: "efficientdet_lite2",
});
const fixture = () =>
  enrich({
    meta: { width: 640, height: 360, duration: 1, source_sha256: "video-id" },
    frames: [
      { i: 0, t: 0, p: null, ball: candidate(100, 150) },
      { i: 1, t: 0.1, p: null, ball: null },
    ],
    shots: [],
  });

test("cropped detector coordinates return to the original image; other classes and invalid boxes are rejected", () => {
  const result = {
    detections: [
      {
        categories: [{ categoryName: "sports ball", score: 0.7 }],
        boundingBox: { originX: 40, originY: 10, width: 20, height: 20 },
      },
      {
        categories: [{ categoryName: "person", score: 0.99 }],
        boundingBox: { originX: 40, originY: 10, width: 20, height: 20 },
      },
      {
        categories: [{ categoryName: "sports ball", score: 0.8 }],
        boundingBox: { originX: 999, originY: 10, width: 20, height: 20 },
      },
    ],
  };
  const r = detectionCandidates(
    result,
    [0.25, 0.25, 0.75, 0.75],
    800,
    400,
    200,
    100,
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].x, 300);
  assert.equal(r[0].y, 140);
  assert.equal(r[0].w, 40);
  assert.equal(r[0].h, 40);
});
test("association leaves missing and ambiguous observations empty and does not join long gaps", () => {
  const tracker = createBallTracker(640, 360);
  assert.equal(
    tracker.next([candidate(100, 100, 0.8), candidate(400, 100, 0.78)], 0)
      .status,
    "ambiguous",
  );
  const first = tracker.next([candidate(100, 100)], 0.1);
  assert.ok(first.ball);
  assert.equal(tracker.next([], 0.13).ball, null);
  assert.equal(tracker.next([candidate(600, 350)], 0.16).status, "rejected");
  const next = tracker.next([candidate(111, 97)], 0.17);
  assert.equal(next.ball.track_id, first.ball.track_id);
  const reacquired = tracker.next([candidate(600, 350)], 0.7);
  assert.notEqual(reacquired.ball.track_id, first.ball.track_id);
});
test("manual edits preserve automatic observations, update features, survive restore, and undo to an actual missing value", () => {
  const d = fixture();
  d.frames[0].ball_edit = {
    kind: "point",
    x: 120,
    y: 80,
    edited_at: "2026-10-28T00:00:00Z",
  };
  d.frames[1].ball_edit = { kind: "point", x: 130, y: 75 };
  correctBallistics(d);
  assert.equal(d.frames[0].ball_auto.x, 100);
  assert.equal(frameRows(d, [])[0].ball_x_px, 120);
  assert.equal(d.frames[0].ball.confidence, null);
  const restored = enrich(JSON.parse(JSON.stringify(d)));
  assert.equal(restored.frames[0].ball.x, 120);
  assert.equal(restored.frames[0].ball_auto.x, 100);
  delete restored.frames[1].ball_edit;
  correctBallistics(restored);
  assert.equal(restored.frames[1].ball, null);
  restored.frames[0].ball_edit = { kind: "missing" };
  correctBallistics(restored);
  assert.equal(restored.frames[0].f.ball_x_px, null);
  assert.equal(restored.frames[0].ball_auto.x, 100);
  delete restored.frames[0].ball_edit;
  correctBallistics(restored);
  assert.equal(restored.frames[0].ball.x, 100);
});
test("ball CSV retains missing rows, automatic/edited/fit values and exact documented columns", () => {
  const d = fixture();
  const rows = ballRows(d);
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]), BALL_COLUMNS);
  assert.deepEqual(
    dictionaryRows()
      .filter((r) => r.file === "ball.csv")
      .map((r) => r.column),
    BALL_COLUMNS,
  );
  assert.equal(rows[1].ball_x_px, null);
  assert.equal(rows[0].ball_auto_x_px, 100);
  assert.equal(rows[0].ball_x_px_corrected, null);
  assert.ok(
    csv(rows, BALL_COLUMNS).startsWith(
      "\ufeffsource_sha256,app_version,frame,t_s",
    ),
  );
});
test("invalid manual points are refused rather than included in a trajectory", () => {
  for (const edit of [
    { kind: "point", x: -1, y: 50 },
    { kind: "point", x: 20, y: Infinity },
    { kind: "unknown" },
  ]) {
    const d = fixture();
    d.frames[0].ball_edit = edit;
    assert.throws(() => applyBallEdits(d), /ボール/);
  }
});
