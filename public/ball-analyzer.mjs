import { sha256 } from "./file-hash.mjs";
import { SETTINGS } from "./settings.mjs";
import {
  createBallTracker,
  detectionCandidates,
  applyBallEdits,
} from "./ball-tracking.mjs";
const asset = (p) => new URL(p, import.meta.url).href;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function waitVideo(video, name, signal) {
  return new Promise((resolve, reject) => {
    const done = (error) => {
      clearTimeout(timer);
      video.removeEventListener(name, ok);
      video.removeEventListener("error", bad);
      signal?.removeEventListener("abort", aborted);
      error ? reject(error) : resolve();
    };
    const ok = () => done(),
      bad = () => done(new Error("ボール解析用の動画を読み込めません。"));
    const aborted = () => done(new DOMException("中止しました", "AbortError"));
    const timer = setTimeout(
      () => done(new Error("動画の読み込みがタイムアウトしました。")),
      20000,
    );
    video.addEventListener(name, ok, { once: true });
    video.addEventListener("error", bad, { once: true });
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}
export async function analyzeBall(
  file,
  data,
  { roi = [0, 0, 1, 1], onProgress = () => {}, signal } = {},
) {
  if (
    !Array.isArray(roi) ||
    roi.length !== 4 ||
    !roi.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) ||
    roi[2] - roi[0] < 0.03 ||
    roi[3] - roi[1] < 0.03
  )
    throw new Error("ボールの範囲が小さすぎます。");
  const config = SETTINGS.ball_tracking;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const url = URL.createObjectURL(file);
  let detector;
  try {
    onProgress(0, "ボール検出モデルを準備しています");
    const { ObjectDetector, FilesetResolver } = await import(
      "./vendor/vision_bundle.mjs"
    );
    const response = await fetch(
      asset("models/ball-efficientdet-lite2.tflite"),
      { signal },
    );
    if (!response.ok)
      throw new Error(
        "ボールモデルの取得に失敗しました。setup:assets または公開設定を確認してください。",
      );
    const model = new Uint8Array(await response.arrayBuffer());
    const digest = await sha256(model);
    if (digest !== config.model.sha256)
      throw new Error("ボールモデルのSHA-256が一致しません。");
    const fileset = await FilesetResolver.forVisionTasks(asset("vendor/wasm"));
    const options = {
      baseOptions: { modelAssetBuffer: model, delegate: "GPU" },
      runningMode: "VIDEO",
      categoryAllowlist: ["sports ball"],
      scoreThreshold: config.score_threshold,
      maxResults: 12,
    };
    let delegate = "GPU";
    try {
      detector = await ObjectDetector.createFromOptions(fileset, options);
    } catch {
      delegate = "CPU";
      options.baseOptions.delegate = "CPU";
      detector = await ObjectDetector.createFromOptions(fileset, options);
    }
    const loaded = waitVideo(video, "loadeddata", signal);
    video.src = url;
    await loaded;
    const w = video.videoWidth,
      h = video.videoHeight;
    const x = roi[0] * w,
      y = roi[1] * h,
      cw = (roi[2] - roi[0]) * w,
      ch = (roi[3] - roi[1]) * h;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, config.max_crop_side_px / Math.max(cw, ch));
    canvas.width = Math.max(1, Math.round(cw * scale));
    canvas.height = Math.max(1, Math.round(ch * scale));
    const ctx = canvas.getContext("2d");
    const tracker = createBallTracker(w, h, config);
    // Stage results first: a failed/cancelled rerun cannot partly overwrite a session.
    const observations = [];
    for (let i = 0; i < data.frames.length; i++) {
      if (signal?.aborted) throw new DOMException("中止しました", "AbortError");
      const t = Math.min(data.frames[i].t, video.duration - 0.001);
      if (Math.abs(video.currentTime - t) > 0.0001) {
        const seeked = waitVideo(video, "seeked", signal);
        video.currentTime = t;
        await seeked;
      }
      ctx.drawImage(video, x, y, cw, ch, 0, 0, canvas.width, canvas.height);
      const result = detector.detectForVideo(
        canvas,
        Math.round(data.frames[i].t * 1000),
      );
      const candidates = detectionCandidates(
        result,
        roi,
        w,
        h,
        canvas.width,
        canvas.height,
        config,
      );
      const tracked = tracker.next(candidates, data.frames[i].t);
      observations.push({
        ball_auto: tracked.ball,
        ball_candidates: candidates,
        ball_tracking_status: tracked.status,
      });
      onProgress(
        (i + 1) / data.frames.length,
        `ボール ${i + 1} / ${data.frames.length} サンプル`,
      );
      await tick();
    }
    observations.forEach((r, i) => Object.assign(data.frames[i], r));
    data.meta.ball_detection = {
      status: "complete",
      model: config.model.name,
      model_sha256: digest,
      sdk_version: SETTINGS.model.sdk_web,
      delegate,
      roi,
      settings: structuredClone(config),
      observed_frames: observations.filter((f) => f.ball_auto).length,
      total_frames: observations.length,
      coordinates: "original image pixels; origin top-left; x right, y down",
      accuracy_validated: false,
    };
    return applyBallEdits(data);
  } finally {
    detector?.close();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
