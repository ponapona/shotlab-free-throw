import { enrich, suggestShots, NAMES } from "./engine.mjs";
import { SETTINGS } from "./settings.mjs";
const asset = (p) => new URL(p, import.meta.url).href;
const tick = () => new Promise((r) => setTimeout(r, 0));
function event(el, name) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        done(
          new Error(
            "動画の読み込みがタイムアウトしました。H.264 MP4でお試しください。",
          ),
        ),
      20000,
    );
    function done(err) {
      clearTimeout(timeout);
      el.removeEventListener(name, ok);
      el.removeEventListener("error", bad);
      err ? reject(err) : resolve();
    }
    const ok = () => done();
    const bad = () =>
      done(new Error("動画を再生できません。H.264 MP4でお試しください。"));
    el.addEventListener(name, ok, { once: true });
    el.addEventListener("error", bad, { once: true });
  });
}
export async function analyzeVideo(
  file,
  {
    roi = [0, 0, 1, 1],
    fps = SETTINGS.sampling.browser_fps,
    onProgress = () => {},
    signal,
  } = {},
) {
  if (!SETTINGS.sampling.choices.includes(fps))
    throw new Error("Unsupported sampling rate");
  if (
    roi.length !== 4 ||
    !roi.every(Number.isFinite) ||
    roi.some((v) => v < 0 || v > 1) ||
    roi[2] - roi[0] < 0.03 ||
    roi[3] - roi[1] < 0.03
  )
    throw new Error("対象範囲が小さすぎます");
  // The local server uses Heavy on CPU and original presentation timestamps.
  let local = false;
  try {
    const r = await fetch(asset("api/capabilities"));
    if (r.ok && r.headers.get("content-type")?.includes("application/json"))
      local = (await r.json()).local_cpu;
  } catch {}
  if (local) {
    onProgress(0, "原動画の全フレームをCPUで解析しています");
    const r = await fetch(
      asset("api/analyze") +
        "?" +
        new URLSearchParams({ roi: JSON.stringify(roi), filename: file.name }),
      {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
        signal,
      },
    );
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "CPU解析を開始できません");
    while (true) {
      if (signal?.aborted) {
        await fetch(asset("api/jobs/" + j.job_id), { method: "DELETE" });
        throw new DOMException("中止しました", "AbortError");
      }
      const status = await (await fetch(asset("api/jobs/" + j.job_id))).json();
      if (status.status === "error") throw new Error(status.error);
      if (status.status === "done") {
        const d = await (
          await fetch(asset("api/jobs/" + j.job_id) + "?result=1")
        ).json();
        enrich(d);
        d.shots = suggestShots(d);
        return d;
      }
      onProgress(status.progress, "原動画の全フレームをCPUで解析しています");
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  let detector;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const url = URL.createObjectURL(file);
  try {
    onProgress(0, "解析モデルを準備しています");
    const { PoseLandmarker, FilesetResolver } = await import(
      "./vendor/vision_bundle.mjs"
    );
    const parts = await Promise.all(
      [0, 1].map(async (i) => {
        const r = await fetch(asset(`models/pose-heavy-${i}.bin`));
        if (!r.ok) throw new Error("モデルの取得に失敗しました");
        return new Uint8Array(await r.arrayBuffer());
      }),
    );
    const model = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      model.set(p, offset);
      offset += p.length;
    }
    const glCheck = document.createElement("canvas");
    if (!glCheck.getContext("webgl2") && !glCheck.getContext("webgl"))
      throw new Error(
        "このブラウザではWebGLを使用できません。描画機能が有効なChrome/Edge、または同梱のPython版（CPU解析）を使用してください。",
      );
    const fileset = await FilesetResolver.forVisionTasks(asset("vendor/wasm"));
    const options = {
      baseOptions: { modelAssetBuffer: model, delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: SETTINGS.sampling.num_poses,
      minPoseDetectionConfidence: SETTINGS.confidence.detection,
      minPosePresenceConfidence: SETTINGS.confidence.presence,
      minTrackingConfidence: SETTINGS.confidence.tracking,
    };
    try {
      detector = await PoseLandmarker.createFromOptions(fileset, options);
    } catch {
      options.baseOptions.delegate = "CPU";
      detector = await PoseLandmarker.createFromOptions(fileset, options);
    }
    const loaded = event(video, "loadeddata");
    video.src = url;
    await loaded;
    const w = video.videoWidth,
      h = video.videoHeight,
      duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("動画の長さを取得できません。");
    const [x1, y1, x2, y2] = [roi[0] * w, roi[1] * h, roi[2] * w, roi[3] * h];
    const canvas = document.createElement("canvas");
    canvas.height = SETTINGS.sampling.crop_height_px;
    canvas.width = Math.round(((x2 - x1) / (y2 - y1)) * canvas.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const frames = [];
    const n = Math.ceil(duration * fps);
    for (let i = 0; i < n; i++) {
      if (signal?.aborted)
        throw new DOMException("解析を中止しました", "AbortError");
      const t = Math.min(i / fps, duration - 0.001);
      if (Math.abs(video.currentTime - t) > 0.0001) {
        const seeked = event(video, "seeked");
        video.currentTime = t;
        await seeked;
      }
      ctx.drawImage(
        video,
        x1,
        y1,
        x2 - x1,
        y2 - y1,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const result = detector.detectForVideo(canvas, Math.round(t * 1000));
      const p =
        result.landmarks?.[0]?.map((v) => [
          (x1 + v.x * (x2 - x1)) / w,
          (y1 + v.y * (y2 - y1)) / h,
          (v.z * (x2 - x1)) / w,
          v.visibility ?? 0,
          v.presence ?? 1,
        ]) ?? null;
      const world =
        result.worldLandmarks?.[0]?.map((v) => [v.x, v.y, v.z]) ?? null;
      frames.push({ i, t, p, world, ball: null });
      onProgress(
        (i + 1) / n,
        `${(i + 1).toLocaleString()} / ${n.toLocaleString()} フレーム`,
      );
      await tick();
    }
    const sourceSha = [
      ...new Uint8Array(
        await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
      ),
    ]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    const data = {
      schema: "shotlab/1.0",
      meta: {
        app_version: SETTINGS.app_version,
        analysis_settings: structuredClone(SETTINGS),
        sdk_version: SETTINGS.model.sdk_web,
        model_sha256: SETTINGS.model.sha256,
        source_sha256: sourceSha,
        filename: file.name,
        file_size: file.size,
        width: w,
        height: h,
        fps,
        duration,
        n_frames: frames.length,
        timestamp_source:
          "browser uniform playback-time sampling; original PTS not available",
        sample_fps: fps,
        model: "MediaPipe Pose Landmarker Heavy float16",
        roi,
        landmark_names: NAMES,
        visibility_threshold: SETTINGS.confidence.landmark,
        filter: "causal One Euro; see analysis_settings.filter; raw retained",
        accuracy_validated: false,
      },
      frames,
      shots: [],
    };
    enrich(data);
    data.shots = suggestShots(data);
    return data;
  } finally {
    detector?.close();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

if (typeof window !== "undefined") window.shotlabAnalyzeVideo = analyzeVideo;
