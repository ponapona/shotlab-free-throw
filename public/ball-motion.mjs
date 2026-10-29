/** Fixed-camera, small bright/orange moving components. Image evidence, not a learned ball classifier. */
import { SETTINGS } from "./settings.mjs";
export function medianBackground(images) {
  if (!images.length) throw new Error("背景画像がありません。");
  const n = images[0].length,
    out = new Uint8ClampedArray(n),
    a = new Array(images.length);
  if (images.some((im) => im.length !== n))
    throw new Error("背景画像のサイズが一致しません。");
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < images.length; i++) a[i] = images[i][j];
    a.sort((x, y) => x - y);
    out[j] = a[Math.floor(a.length / 2)];
  }
  return out;
}
export function motionCandidates(
  image,
  background,
  width,
  height,
  roi,
  originalWidth,
  originalHeight,
  options = {},
) {
  const cfg = { ...SETTINGS.ball_tracking.motion, ...options };
  if (!cfg.enabled) return [];
  const mask = new Uint8Array(width * height),
    queue = new Int32Array(width * height),
    out = [];
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4,
      r = image[i],
      g = image[i + 1],
      b = image[i + 2],
      max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    const white = max >= 155 && (max - min) / Math.max(1, max) < 0.42;
    const orange = r >= 110 && r > g * 1.1 && g > b * 1.12 && r - b > 40;
    const color =
      cfg.color === "white"
        ? white
        : cfg.color === "orange"
          ? orange
          : white || orange;
    const delta = Math.max(
      Math.abs(r - background[i]),
      Math.abs(g - background[i + 1]),
      Math.abs(b - background[i + 2]),
    );
    mask[p] = Number(color && delta >= cfg.difference_threshold);
  }
  const scaleX = ((roi[2] - roi[0]) * originalWidth) / width,
    scaleY = ((roi[3] - roi[1]) * originalHeight) / height;
  const minD = originalHeight * cfg.min_diameter_fraction,
    maxD = originalHeight * cfg.max_diameter_fraction;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    let head = 0,
      tail = 1,
      x0 = width,
      y0 = height,
      x1 = 0,
      y1 = 0,
      sx = 0,
      sy = 0;
    queue[0] = p;
    mask[p] = 0;
    while (head < tail) {
      const q = queue[head++],
        x = q % width,
        y = Math.floor(q / width);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      sx += x;
      sy += y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const z = ny * width + nx;
          if (mask[z]) {
            mask[z] = 0;
            queue[tail++] = z;
          }
        }
    }
    const w = (x1 - x0 + 1) * scaleX,
      h = (y1 - y0 + 1) * scaleY,
      area = tail * scaleX * scaleY,
      fill = tail / ((x1 - x0 + 1) * (y1 - y0 + 1));
    if (
      w < minD ||
      h < minD ||
      w > maxD ||
      h > maxD ||
      w / h < 0.45 ||
      w / h > 2.3 ||
      area < Math.max(8, minD * minD * 0.45) ||
      fill < 0.35
    )
      continue;
    out.push({
      x: roi[0] * originalWidth + (sx / tail + 0.5) * scaleX,
      y: roi[1] * originalHeight + (sy / tail + 0.5) * scaleY,
      w,
      h,
      r: Math.min(w, h) / 2,
      confidence: Math.min(0.75, 0.35 + fill * 0.4),
      source: "motion_component",
      status: "candidate_unvalidated",
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 40);
}
