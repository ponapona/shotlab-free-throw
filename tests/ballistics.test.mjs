import test from "node:test";
import assert from "node:assert/strict";
import { enrich } from "../public/engine.mjs";
test("ball fit preserves observations, replaces outlier, interpolates only inside support", () => {
  const frames = Array.from({ length: 46 }, (_, i) => {
    const t = i / 30;
    return {
      i,
      t,
      p: null,
      world: null,
      ball:
        t <= 1.2
          ? { x: 100 + 100 * t, y: 220 - 200 * t + 160 * t * t, confidence: 1 }
          : null,
    };
  });
  frames[15].ball = null;
  frames[20].ball.y += 100;
  const raw = structuredClone(frames.map((f) => f.ball));
  const d = enrich({
    meta: { width: 640, height: 360, duration: 1.6 },
    frames,
    shots: [{ id: 1, start: 0, drive: 0, release: 0, end: 1.5 }],
  });
  assert.equal(d.ball_fits[0].status, "fitted");
  assert.deepEqual(
    d.frames.map((f) => f.ball),
    raw,
  );
  assert.equal(d.frames[15].f.ball_correction_status, "interpolated");
  assert.equal(d.frames[20].f.ball_correction_status, "outlier_replaced");
  assert.equal(d.frames[42].f.ball_x_px_corrected, null);
  assert.ok(Math.abs(d.frames[15].f.ball_y_px_corrected - 160) < 0.001);
});
test("no observations never fabricate ball positions", () => {
  const d = enrich({
    meta: { width: 640, height: 360, duration: 1 },
    frames: [{ i: 0, t: 0, p: null, world: null, ball: null }],
    shots: [],
  });
  assert.equal(d.frames[0].f.ball_x_px_corrected, null);
});
