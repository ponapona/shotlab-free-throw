import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(
  await fs.readFile(path.join(root, "config/defaults.json"), "utf8"),
);
const sdk = path.join(root, "node_modules/@mediapipe/tasks-vision");
const installed = JSON.parse(
  await fs.readFile(path.join(sdk, "package.json"), "utf8"),
);
if (installed.version !== config.model.sdk_web)
  throw new Error("Run npm ci: SDK version mismatch");
await fs.mkdir(path.join(root, "public/vendor"), { recursive: true });
await fs.copyFile(
  path.join(sdk, "vision_bundle.mjs"),
  path.join(root, "public/vendor/vision_bundle.mjs"),
);
await fs.cp(path.join(sdk, "wasm"), path.join(root, "public/vendor/wasm"), {
  recursive: true,
});
for (const name of ["LICENSE", "NOTICE"]) {
  try {
    await fs.copyFile(
      path.join(sdk, name),
      path.join(root, "public/vendor", name),
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
await fs.cp(
  path.join(root, "licenses"),
  path.join(root, "public/vendor/licenses"),
  { recursive: true },
);
await fs.copyFile(
  path.join(root, "THIRD_PARTY_NOTICES.md"),
  path.join(root, "public/vendor/THIRD_PARTY_NOTICES.md"),
);
const paths = [0, 1].map((i) =>
  path.join(root, `public/models/pose-heavy-${i}.bin`),
);
const hash = (b) => createHash("sha256").update(b).digest("hex");
let bytes;
try {
  bytes = Buffer.concat(await Promise.all(paths.map((p) => fs.readFile(p))));
} catch {}
if (!bytes || hash(bytes) !== config.model.sha256) {
  console.log("Downloading official MediaPipe Heavy model (about 31 MB)…");
  const response = await fetch(config.model.url, {
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok)
    throw new Error(`Model download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== config.model.sha256)
    throw new Error("Model SHA-256 mismatch; no assets were written");
  await fs.mkdir(path.dirname(paths[0]), { recursive: true });
  const split = Math.ceil(bytes.length / 2);
  await fs.writeFile(paths[0], bytes.subarray(0, split));
  await fs.writeFile(paths[1], bytes.subarray(split));
}
console.log(
  `Assets ready: SDK ${installed.version}, model SHA-256 ${hash(bytes)}`,
);
const ballPath = path.join(
  root,
  "public/models/ball-efficientdet-lite2.tflite",
);
const ballModel = config.ball_tracking.model;
let ballBytes;
try {
  ballBytes = await fs.readFile(ballPath);
} catch {}
if (!ballBytes || hash(ballBytes) !== ballModel.sha256) {
  console.log("Downloading official EfficientDet-Lite2 model (about 12 MB)…");
  const response = await fetch(ballModel.url, {
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok)
    throw new Error(`Ball model download failed: ${response.status}`);
  ballBytes = Buffer.from(await response.arrayBuffer());
  if (hash(ballBytes) !== ballModel.sha256)
    throw new Error("Ball model SHA-256 mismatch");
  await fs.writeFile(ballPath, ballBytes);
}
console.log(`Ball model ready: SHA-256 ${hash(ballBytes)}`);
