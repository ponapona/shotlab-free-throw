import { medianBackground, motionCandidates } from "./ball-motion.mjs";
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
  {
    roi = [0, 0, 1, 1],
    onProgress = () => {},
    signal,
    motionOnly = false,
  } = {},
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
  let detector,
    digest = null,
    delegate = null,
    detectorError = null;
  try {
    onProgress(0, "ボール検出モデルを準備しています");
    try {
      if (motionOnly) throw new Error("動きからの検出のみを選択");
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
      digest = await sha256(model);
      if (digest !== config.model.sha256)
        throw new Error("ボールモデルのSHA-256が一致しません。");
      const fileset = await FilesetResolver.forVisionTasks(
        asset("vendor/wasm"),
      );
      const options = {
        baseOptions: { modelAssetBuffer: model, delegate: "GPU" },
        runningMode: "VIDEO",
        categoryAllowlist: ["sports ball"],
        scoreThreshold: config.score_threshold,
        maxResults: 12,
      };
      delegate = "GPU";
      try {
        detector = await ObjectDetector.createFromOptions(fileset, options);
      } catch {
        delegate = "CPU";
        options.baseOptions.delegate = "CPU";
        detector = await ObjectDetector.createFromOptions(fileset, options);
      }
    } catch (e) {
      if (e.name === "AbortError") throw e;
      detectorError = e.message;
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
    const motionCanvas = document.createElement("canvas");
    const ms = Math.min(1, config.motion.max_side_px / Math.max(cw, ch));
    motionCanvas.width = Math.max(1, Math.round(cw * ms));
    motionCanvas.height = Math.max(1, Math.round(ch * ms));
    const mc = motionCanvas.getContext("2d", { willReadFrequently: true });
    const backgroundImages = [];
    for (let i = 0; i < config.motion.background_frames; i++) {
      if (signal?.aborted) throw new DOMException("中止しました", "AbortError");
      const t = Math.max(
        0,
        Math.min(
          video.duration - 0.002,
          (video.duration * (i + 0.5)) / config.motion.background_frames,
        ),
      );
      if (Math.abs(video.currentTime - t) > 0.0001) {
        const ready = waitVideo(video, "seeked", signal);
        video.currentTime = t;
        await ready;
      }
      mc.drawImage(
        video,
        x,
        y,
        cw,
        ch,
        0,
        0,
        motionCanvas.width,
        motionCanvas.height,
      );
      backgroundImages.push(
        mc.getImageData(0, 0, motionCanvas.width, motionCanvas.height).data,
      );
      onProgress(
        (0.08 * (i + 1)) / config.motion.background_frames,
        "小さいボールを探すため背景を確認しています",
      );
      await tick();
    }
    const background = medianBackground(backgroundImages);
    backgroundImages.length = 0;
    const tracker = createBallTracker(w, h, config);
    // Stage results first: a failed/cancelled rerun cannot partly overwrite a session.
    const observations = [];
    for (let i = 0; i < data.frames.length; i++) {
      if (signal?.aborted) throw new DOMException("中止しました", "AbortError");
      const active =
        !data.shots?.length ||
        data.shots.some(
          (s) =>
            data.frames[i].t >= s.release - 0.3 &&
            data.frames[i].t <=
              Math.min(s.end, s.release + SETTINGS.ballistics.search_window_s),
        );
      if (!active) {
        observations.push({
          ball_auto: null,
          ball_candidates: [],
          ball_tracking_status: "outside_search",
        });
        continue;
      }
      const t = Math.min(data.frames[i].t, video.duration - 0.001);
      if (Math.abs(video.currentTime - t) > 0.0001) {
        const seeked = waitVideo(video, "seeked", signal);
        video.currentTime = t;
        await seeked;
      }
      ctx.drawImage(video, x, y, cw, ch, 0, 0, canvas.width, canvas.height);
      let ai = [];
      if (detector) {
        try {
          const result = detector.detectForVideo(
            canvas,
            Math.round(data.frames[i].t * 1000),
          );
          ai = detectionCandidates(
            result,
            roi,
            w,
            h,
            canvas.width,
            canvas.height,
            config,
          );
        } catch (e) {
          detectorError = e.message;
          detector.close();
          detector = null;
        }
      }
      mc.drawImage(
        video,
        x,
        y,
        cw,
        ch,
        0,
        0,
        motionCanvas.width,
        motionCanvas.height,
      );
      const moving = motionCandidates(
        mc.getImageData(0, 0, motionCanvas.width, motionCanvas.height).data,
        background,
        motionCanvas.width,
        motionCanvas.height,
        roi,
        w,
        h,
        config.motion,
      );
      const candidates = [
        ...ai,
        ...moving.filter(
          (p) =>
            !ai.some(
              (q) => Math.hypot(p.x - q.x, p.y - q.y) < Math.max(p.r, q.r),
            ),
        ),
      ];
      const tracked = tracker.next(candidates, data.frames[i].t);
      observations.push({
        ball_auto: tracked.ball,
        ball_candidates: candidates,
        ball_tracking_status: tracked.status,
      });
      onProgress(
        0.08 + (0.92 * (i + 1)) / data.frames.length,
        `ボール ${i + 1} / ${data.frames.length} サンプル`,
      );
      await tick();
    }
    observations.forEach((r, i) => Object.assign(data.frames[i], r));
    data.meta.ball_detection = {
      status: "complete",
      method: "hybrid_ai_motion",
      detector_error: detectorError,
      ai_available: !!detector,
      background_method: "temporal_median",
      candidate_frames: observations.filter((f) => f.ball_candidates.length)
        .length,
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
    onProgress(1, "ボール候補の抽出が完了しました");
    return applyBallEdits(data);
  } finally {
    detector?.close();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
