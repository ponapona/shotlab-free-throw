// @ts-nocheck
"use client";
import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Upload,
  Download,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ScanLine,
  Activity,
  SlidersHorizontal,
  Check,
  Plus,
  Info,
  Film,
  Box,
  FolderOpen,
  BookOpen,
  FileText,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Toaster, toast } from "sonner";
import {
  enrich,
  atTime,
  shotAt,
  phaseAt,
  CONNECTIONS,
  BODY,
  finite,
  frameRows,
  landmarkRows,
  shotRows,
  csv,
  validateShots,
} from "../public/engine.mjs";
import { sha256 } from "../public/file-hash.mjs";
import {
  phaseRows,
  waveformRows,
  pcaRows,
} from "../public/shot-statistics.mjs";
import BallTrajectory from "./BallTrajectory";
import { ballRows } from "../public/ball-tracking.mjs";
import { correctBallistics } from "../public/ballistics.mjs";
import { dictionaryRows } from "../public/dictionary.mjs";
import DATA_GUIDE from "../public/guide.mjs";
import { SETTINGS } from "../public/settings.mjs";
const confidence = (p) => (p ? Math.min(p[3] ?? 0, p[4] ?? 1) : 0);
const LEFT = "#17a69e",
  RIGHT = "#7686ef",
  BALL = "#d79b3e";
const fmt = (v, dec = 0) => (finite(v) ? Number(v).toFixed(dec) : "—");
const clock = (t) =>
  `${Math.floor(t / 60)
    .toString()
    .padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}`;
const phases = {
  other: "待機・移動",
  setup: "セット",
  drive: "シュート動作",
  follow_through: "リリース後",
};
function download(name, content, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function Choice({ value, onChange, options, label, className = "" }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, t]) => (
          <SelectItem key={v} value={v}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Wave({
  data,
  time,
  keys,
  colors,
  labels,
  min = 0,
  max = 180,
  title,
  unit = "deg",
}) {
  const [hover, setHover] = useState(null),
    start = 0,
    end = Math.max(0.001, Math.min(5, data.meta.duration || 5), time),
    span = end - start,
    w = 510,
    h = 66;
  const visible = data.frames.filter((f) => f.t >= start && f.t <= time + 1e-6);
  const xOf = (t) => 26 + ((t - start) / span) * (w - 34),
    yOf = (v) =>
      Math.max(
        2,
        Math.min(h - 2, 5 + (1 - (v - min) / (max - min)) * (h - 13)),
      );
  const names =
    labels ??
    keys.map((k) =>
      k.startsWith("left_") ? "左" : k.startsWith("right_") ? "右" : title,
    );
  const paths = keys.map((key) => {
    let path = "",
      last = -1;
    for (const f of visible) {
      const val = f.f[key];
      if (!finite(val)) {
        last = -1;
        continue;
      }
      path += `${last >= 0 && f.t - last < 0.15 ? "L" : "M"}${xOf(f.t).toFixed(2)},${yOf(val).toFixed(2)} `;
      last = f.t;
    }
    return path;
  });
  const point =
    hover !== null && hover >= start && hover <= time && visible.length
      ? visible.reduce(
          (best, f) =>
            Math.abs(f.t - hover) < Math.abs(best.t - hover) ? f : best,
          visible[0],
        )
      : null;
  const select = (e) => {
    const r = e.currentTarget.getBoundingClientRect(),
      x = ((e.clientX - r.left) / r.width) * w;
    if (x < 26 || x > w - 8) {
      setHover(null);
      return;
    }
    const t = start + ((x - 26) / (w - 34)) * span;
    setHover(t <= time ? t : null);
  };
  return (
    <section className="wave">
      <div className="wave-head">
        <span>{title}</span>
        <span className="mono">{unit}</span>
      </div>
      <div className="wave-plot">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          role="img"
          tabIndex={0}
          aria-label={`${title}の波形。カーソルまたは左右キーで数値を表示。動画開始から再生時点までの累積表示。`}
          onPointerMove={select}
          onPointerDown={select}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover((prev) => prev ?? visible.at(-1)?.t ?? null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (
              !["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(
                e.key,
              )
            )
              return;
            e.preventDefault();
            if (e.key === "Escape") {
              setHover(null);
              return;
            }
            const i = point ? visible.indexOf(point) : visible.length - 1,
              n =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? visible.length - 1
                    : Math.max(
                        0,
                        Math.min(
                          visible.length - 1,
                          i + (e.key === "ArrowLeft" ? -1 : 1),
                        ),
                      );
            setHover(visible[n]?.t ?? null);
          }}
        >
          {[7, 32, 57].map((y) => (
            <line key={y} x1="26" y1={y} x2={w - 8} y2={y} stroke="#e8ebef" />
          ))}
          <text x="0" y="11" fill="#84909e" fontSize="11">
            {max}
          </text>
          <text x="0" y="61" fill="#84909e" fontSize="11">
            {min}
          </text>
          {paths.map((p, i) => (
            <path
              key={keys[i]}
              d={p}
              fill="none"
              stroke={colors[i]}
              opacity={keys[i] === "ball_y_px" ? 0.45 : 1}
              strokeWidth={keys[i] === "ball_y_px" ? 1 : 1.85}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {point &&
            keys.map(
              (key, i) =>
                finite(point.f[key]) && (
                  <circle
                    key={key}
                    cx={xOf(point.t)}
                    cy={yOf(point.f[key])}
                    r="3"
                    fill="#fff"
                    stroke={colors[i]}
                    strokeWidth="1.5"
                  />
                ),
            )}
        </svg>
        {point && (
          <div
            className="wave-tooltip"
            role="tooltip"
            style={{
              left: `${Math.max(24, Math.min(76, (xOf(point.t) / w) * 100))}%`,
            }}
          >
            <strong className="mono">
              {point.t.toFixed(3)} s <span>FRAME {point.i}</span>
            </strong>
            {keys.map((key, i) => (
              <div key={key}>
                <span>
                  <i style={{ background: colors[i] }} />
                  {names[i]}
                </span>
                <b className="mono">
                  {finite(point.f[key])
                    ? `${fmt(point.f[key], 2)} ${unit}`
                    : "欠測"}
                </b>
              </div>
            ))}
            {keys.includes("ball_y_px_corrected") && (
              <small>
                {
                  {
                    observed_fit: "観測点を放物線で補正",
                    outlier_replaced: "外れ値を放物線で補正",
                    interpolated: "欠測を放物線で補間",
                    outside_flight: "飛行区間外・補正なし",
                    unavailable: "補正値なし",
                    assumption_based: "仮定点を含む軌道推定",
                  }[point.f.ball_correction_status]
                }
              </small>
            )}
          </div>
        )}
      </div>
      <div className="wave-axis mono">
        <span>{start.toFixed(1)} s</span>
        <span>{end.toFixed(1)} s</span>
      </div>
    </section>
  );
}
function Skeleton({ frame, mode, yaw, meta, bodyOnly }) {
  const canvas = useRef(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const c = el.getContext("2d");
    el.width = 600;
    el.height = 780;
    c.fillStyle = "#111921";
    c.fillRect(0, 0, 600, 780);
    c.strokeStyle = "#23303c";
    c.lineWidth = 1;
    for (let i = -5; i <= 5; i++) {
      c.beginPath();
      c.moveTo(300 + i * 37, 620);
      c.lineTo(300 + i * 115, 780);
      c.stroke();
    }
    for (let i = 0; i < 5; i++) {
      c.beginPath();
      c.moveTo(0, 620 + i * i * 9);
      c.lineTo(600, 620 + i * i * 9);
      c.stroke();
    }
    if (!frame?.s) {
      c.fillStyle = "#82919e";
      c.font = "24px sans-serif";
      c.textAlign = "center";
      c.fillText("姿勢を検出できません", 300, 380);
      return;
    }
    const p = frame.s;
    let points = [];
    if (mode === "3d" && frame.world) {
      const a = (yaw * Math.PI) / 180;
      points = frame.world.map((v) => [
        300 + (v[0] * Math.cos(a) + v[2] * Math.sin(a)) * 360,
        405 + v[1] * 360,
      ]);
    } else {
      const hx = (p[23][0] + p[24][0]) / 2,
        hy = (p[23][1] + p[24][1]) / 2;
      const height = Math.max(
          0.18,
          Math.max(p[27][1], p[28][1]) - (p[0][1] - 0.035),
        ),
        scale = 480 / height;
      points = p.map((v) => [
        300 + ((v[0] - hx) * scale * meta.width) / meta.height,
        450 + (v[1] - hy) * scale,
      ]);
    }
    for (const [a, b] of CONNECTIONS) {
      if (bodyOnly && (!BODY.includes(a) || !BODY.includes(b))) continue;
      const low =
        Math.min(confidence(p[a]), confidence(p[b])) <
        (meta.analysis_settings ?? SETTINGS).confidence.landmark;
      c.setLineDash(low ? [7, 8] : []);
      c.globalAlpha = low ? 0.27 : 0.94;
      c.strokeStyle =
        a <= 10 && b <= 10
          ? "#c2c9ce"
          : a % 2 === 1 && b % 2 === 1
            ? LEFT
            : a % 2 === 0 && b % 2 === 0
              ? RIGHT
              : "#bcc6cd";
      c.lineWidth = a <= 10 && b <= 10 ? 2.5 : 5;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(...points[a]);
      c.lineTo(...points[b]);
      c.stroke();
    }
    c.setLineDash([]);
    points.forEach((pt, i) => {
      if (bodyOnly && !BODY.includes(i)) return;
      c.globalAlpha =
        confidence(p[i]) <
        (meta.analysis_settings ?? SETTINGS).confidence.landmark
          ? 0.25
          : 1;
      c.beginPath();
      c.arc(pt[0], pt[1], i > 10 ? 5 : 2.5, 0, Math.PI * 2);
      c.fillStyle = i <= 10 ? "#dee5e9" : i % 2 === 1 ? LEFT : RIGHT;
      c.fill();
      c.strokeStyle = "#111921";
      c.lineWidth = 1.5;
      c.stroke();
    });
    c.globalAlpha = 1;
  }, [frame, mode, yaw, meta, bodyOnly]);
  return (
    <canvas
      ref={canvas}
      className="skeleton-canvas"
      aria-label={`${bodyOnly ? "主要16点" : "全33点"}。低可視性は破線。`}
    />
  );
}
export default function Home() {
  const [sourceData, setData] = useState(null),
    [shots, setShots] = useState([]),
    [src, setSrc] = useState("");
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [rate, setRate] = useState("1"),
    [mode, setMode] = useState("2d"),
    [yaw, setYaw] = useState(0);
  const [selected, setSelected] = useState(1),
    [error, setError] = useState(""),
    [overlay, setOverlay] = useState(true),
    [bodyOnly, setBodyOnly] = useState(true),
    [ballOverlay, setBallOverlay] = useState(true),
    [ballEditing, setBallEditing] = useState(false),
    [ballPointKind, setBallPointKind] = useState("point"),
    [ballBusy, setBallBusy] = useState(false),
    [ballProgress, setBallProgress] = useState(""),
    [sourceFile, setSourceFile] = useState(null),
    [importOpen, setImportOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [edit, setEdit] = useState(null);
  const [file, setFile] = useState(null),
    [importSrc, setImportSrc] = useState(""),
    [roi, setRoi] = useState([0, 0, 1, 1]),
    [ballRoi, setBallRoi] = useState([0, 0, 1, 1]),
    [roiMode, setRoiMode] = useState("body"),
    [trackBall, setTrackBall] = useState(true),
    [sample, setSample] = useState(String(SETTINGS.sampling.browser_fps)),
    [progress, setProgress] = useState(-1),
    [progressText, setProgressText] = useState(""),
    [busy, setBusy] = useState(false),
    [importError, setImportError] = useState("");
  const video = useRef(null),
    overlayCanvas = useRef(null),
    input = useRef(null),
    jsonInput = useRef(null),
    drag = useRef(null),
    controller = useRef(null),
    state = useRef(null);
  const data = useMemo(
    () =>
      sourceData
        ? correctBallistics(
            {
              ...sourceData,
              meta: { ...sourceData.meta },
              frames: sourceData.frames.map((f) => ({ ...f, f: { ...f.f } })),
            },
            shots,
          )
        : null,
    [sourceData, shots],
  );
  useEffect(
    () => () => {
      if (src.startsWith("blob:")) URL.revokeObjectURL(src);
    },
    [src],
  );
  useEffect(
    () => () => {
      if (importSrc) URL.revokeObjectURL(importSrc);
    },
    [importSrc],
  );
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let id = 0,
      alive = true;
    const cb = (_, m) => {
      if (!alive) return;
      if (!v.paused && !v.seeking) setTime(m.mediaTime);
      id = v.requestVideoFrameCallback(cb);
    };
    if (v.requestVideoFrameCallback) id = v.requestVideoFrameCallback(cb);
    const update = () => {
      if (v.paused || !v.requestVideoFrameCallback) setTime(v.currentTime);
    };
    v.addEventListener("seeked", update);
    v.addEventListener("timeupdate", update);
    return () => {
      alive = false;
      if (id) v.cancelVideoFrameCallback(id);
      v.removeEventListener("seeked", update);
      v.removeEventListener("timeupdate", update);
    };
  }, [src]);
  const frame = data ? atTime(data.frames, time) : null,
    current = shotAt(shots, time),
    phase = phaseAt(shots, time),
    selectedShot = shots.find((s) => s.id === selected),
    metrics = frame?.f ?? {},
    accepted = shots.filter((s) => s.outcome !== null).length,
    successes = shots.filter((s) => s.outcome === 1).length;
  const seek = (t) => {
    if (video.current) {
      video.current.currentTime = Math.max(
        0,
        Math.min(t, data?.meta.duration ?? 0),
      );
      setTime(video.current.currentTime);
    }
  };
  const stepFrame = (direction) => {
    const v = video.current;
    if (!v || !data) return;
    v.pause();
    const f = atTime(data.frames, v.currentTime + 0.0001);
    const ix = f ? data.frames.indexOf(f) : 0;
    const next =
      data.frames[
        Math.max(0, Math.min(data.frames.length - 1, ix + direction))
      ];
    seek(next.t + 0.001);
  };
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      setBallEditing(false);
      v.play().catch(() => toast.error("再生ボタンをもう一度押してください"));
    } else v.pause();
  };
  const selectShot = (s) => {
    setSelected(s.id);
    seek(s.start + 0.05);
  };
  const updateOutcome = (id, value) =>
    setShots((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              outcome: value === "unknown" ? null : Number(value),
              label_source: value === "unknown" ? "unreviewed" : "human_review",
            }
          : s,
      ),
    );
  state.current = { data, shots, seek, updateOutcome };
  useEffect(() => {
    const el = overlayCanvas.current;
    if (!el || !data) return;
    el.width = data.meta.width;
    el.height = data.meta.height;
    const c = el.getContext("2d");
    c.clearRect(0, 0, el.width, el.height);
    if (overlay && frame?.s) {
      const p = frame.s;
      for (const [a, b] of CONNECTIONS) {
        if (bodyOnly && (!BODY.includes(a) || !BODY.includes(b))) continue;
        c.strokeStyle =
          a % 2 === 1 && b % 2 === 1
            ? LEFT
            : a % 2 === 0 && b % 2 === 0
              ? RIGHT
              : "#ddd";
        const low =
          Math.min(confidence(p[a]), confidence(p[b])) <
          (data?.meta.analysis_settings ?? SETTINGS).confidence.landmark;
        c.globalAlpha = low ? 0.25 : 0.9;
        c.setLineDash(low ? [3, 3] : []);
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(p[a][0] * el.width, p[a][1] * el.height);
        c.lineTo(p[b][0] * el.width, p[b][1] * el.height);
        c.stroke();
      }
    }
    c.globalAlpha = 1;
    c.setLineDash([]);
    if (!ballOverlay) return;
    // Raw observations stay visible even when a parabola cannot be fitted.
    for (const f of data.frames) {
      if (f.t > time || f.t < time - 2.5 || !f.ball) continue;
      c.fillStyle = f.ball.source === "manual" ? LEFT : "#dce3e8";
      c.beginPath();
      c.arc(f.ball.x, f.ball.y, Math.max(2, el.width / 400), 0, Math.PI * 2);
      c.fill();
    }
    if (frame?.ball) {
      c.strokeStyle = frame.ball.source === "manual" ? LEFT : "#fff";
      c.beginPath();
      c.arc(
        frame.ball.x,
        frame.ball.y,
        Math.max(5, frame.ball.r ?? 5),
        0,
        Math.PI * 2,
      );
      c.stroke();
    }
    c.setLineDash([5, 4]);
    const trail = data.frames.filter(
      (f) => f.t <= time && f.t > time - 2.5 && f.ball_corrected,
    );
    c.strokeStyle = BALL;
    c.lineWidth = 1.7;
    let last = -1,
      lastShot = null;
    c.beginPath();
    for (const f of trail) {
      const b = f.ball_corrected;
      if (f.t - last > 0.1 || b.shot_id !== lastShot) c.moveTo(b.x, b.y);
      else c.lineTo(b.x, b.y);
      last = f.t;
      lastShot = b.shot_id;
    }
    c.stroke();
    if (frame?.ball_corrected) {
      const b = frame.ball_corrected;
      c.strokeStyle = "#ffd17b";
      c.beginPath();
      c.arc(b.x, b.y, 5, 0, Math.PI * 2);
      c.stroke();
    }
  }, [data, frame, overlay, ballOverlay, bodyOnly, time]);
  const openFile = (f) => {
    setError("");
    setImportError("");
    setFile(f);
    setImportSrc(URL.createObjectURL(f));
    setRoi([0, 0, 1, 1]);
    setBallRoi([0, 0, 1, 1]);
    setRoiMode("body");
    setImportOpen(true);
  };
  const analyze = async () => {
    if (!file) return;
    setImportError("");
    setBusy(true);
    setProgress(0);
    controller.current = new AbortController();
    video.current?.pause();
    try {
      if (!window.shotlabAnalyzeVideo) {
        await new Promise((resolve, reject) => {
          const tag = document.createElement("script");
          tag.type = "module";
          tag.src = new URL("analyzer.mjs", document.baseURI).href;
          tag.onload = resolve;
          tag.onerror = () =>
            reject(new Error("解析処理の読み込みに失敗しました"));
          document.head.appendChild(tag);
        });
      }
      const analyzeVideo = window.shotlabAnalyzeVideo;
      const d = await analyzeVideo(file, {
        roi,
        ballRoi,
        trackBall,
        fps: Number(sample),
        signal: controller.current.signal,
        onProgress: (p, text) => {
          setProgress(p * 100);
          setProgressText(text);
        },
      });
      setData(d);
      setSourceFile(file);
      setError("");
      setBallEditing(false);
      setShots(d.shots);
      setSelected(d.shots[0]?.id ?? 1);
      setSrc(URL.createObjectURL(file));
      setTime(0);
      setImportOpen(false);
      toast.success(
        `${d.frames.length.toLocaleString()}サンプルを解析しました。区間・結果・ボールを確認してください。`,
      );
      if (d.meta.ball_detection?.status === "error")
        toast.warning(
          "身体の解析は完了。ボール自動検出は失敗しました。画面の説明を確認してください。",
        );
      else if (trackBall && !d.meta.ball_detection?.observed_frames)
        toast.warning(
          "ボールを自動検出できませんでした。映像をクリックして位置を追加できます。",
        );
    } catch (e) {
      if (e.name !== "AbortError") {
        console.error("ShotLab import:", e);
        setImportError(e.message);
        toast.error("解析できませんでした。下の説明を確認してください。");
      } else toast("解析を中止しました");
    } finally {
      setBusy(false);
      setProgress(-1);
    }
  };
  const exportData = async (kind) => {
    if (kind === "dictionary") {
      download("ShotLab_columns.csv", csv(dictionaryRows()));
      toast.success("カラム説明を書き出しました");
      return;
    }
    if (kind === "guide") {
      download(
        "ShotLab_data_guide.html",
        DATA_GUIDE,
        "text/html;charset=utf-8",
      );
      toast.success("説明書を書き出しました");
      return;
    }
    if (!data) return;
    const name = data.meta.filename.replace(/\.[^.]+$/, "");
    if (kind === "metadata") {
      download(
        name + "_metadata.json",
        JSON.stringify(
          { ...data.meta, shots, exported_at: new Date().toISOString() },
          null,
          2,
        ),
        "application/json",
      );
    } else if (kind === "session") {
      download(
        name + "_session.json",
        JSON.stringify({
          ...data,
          shots,
          frames: data.frames.map(
            ({ s, f, raw, ball_corrected, ...rest }) => rest,
          ),
        }),
        "application/json",
      );
    } else {
      const rows =
        kind === "phases"
          ? phaseRows(data, shots)
          : kind === "waveforms"
            ? waveformRows(data, shots)
            : kind === "pca"
              ? pcaRows(data, shots)
              : kind === "ball"
                ? ballRows(data, shots)
                : kind === "frames"
                  ? frameRows(data, shots)
                  : kind === "shots"
                    ? shotRows(data, shots)
                    : landmarkRows(data, { bodyOnly: kind === "body" });
      const table = kind === "body" ? "landmarks" : kind;
      download(
        name + "_" + kind + ".csv",
        csv(
          rows,
          dictionaryRows()
            .filter((r) => r.file === table + ".csv")
            .map((r) => r.column),
        ),
      );
    }
    toast.success("データを書き出しました");
  };
  const restore = async (f) => {
    setImportError("");
    try {
      const d = JSON.parse(await f.text());
      if (
        d.schema !== "shotlab/1.0" ||
        !d.meta ||
        !Array.isArray(d.frames) ||
        !Array.isArray(d.shots)
      )
        throw new Error("ShotLabのセッションJSONを選択してください。");
      const source = importOpen ? file : null;
      if (source) {
        const hash = await sha256(await source.arrayBuffer());
        if (!d.meta.source_sha256 || hash !== d.meta.source_sha256)
          throw new Error("動画とセッションのSHA-256が一致しません。");
      } else if (
        !data ||
        !d.meta.source_sha256 ||
        d.meta.source_sha256 !== data.meta.source_sha256
      )
        throw new Error("対応する動画を先に選択してください。");
      validateShots(d.shots, d.meta.duration);
      enrich(d);
      setData(d);
      if (source) setSourceFile(source);
      setError("");
      setBallEditing(false);
      setShots(d.shots);
      setSelected(d.shots[0]?.id ?? 1);
      setTime(0);
      video.current?.pause();
      if (source) setSrc(URL.createObjectURL(source));
      else if (video.current) video.current.currentTime = 0;
      setImportOpen(false);
      toast.success("再解析せずにセッションを復元しました");
    } catch (e) {
      setImportError(e.message);
      toast.error(e.message);
    }
  };
  const saveEdit = () => {
    if (!edit || !data) return;
    const reviewed = {
      ...edit,
      timing_source: "human_review",
      timing_reviewed: true,
    };
    const next = shots.some((s) => s.id === edit.id)
      ? shots.map((s) => (s.id === edit.id ? reviewed : s))
      : [...shots, reviewed];
    try {
      validateShots(next, data.meta.duration);
      setShots(next.sort((a, b) => a.start - b.start));
      setEdit(null);
    } catch (e) {
      toast.error(e.message);
    }
  };
  const addShot = () =>
    setEdit({
      id: Math.max(0, ...shots.map((s) => s.id)) + 1,
      start: Math.max(0, time - 1),
      drive: Math.max(0.01, time - 0.3),
      release: Math.max(0.02, time),
      end: Math.min(data?.meta.duration ?? time + 2, time + 2),
      outcome: null,
      label_source: "unreviewed",
      timing_source: "human_review",
      timing_reviewed: true,
    });
  const changeRoi = (e, finish = false) => {
    const r = e.currentTarget.getBoundingClientRect(),
      x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    if (!drag.current) return;
    const [sx, sy] = drag.current;
    if (Math.abs(x - sx) > 0.03 && Math.abs(y - sy) > 0.03)
      (roiMode === "ball" ? setBallRoi : setRoi)([
        Math.min(x, sx),
        Math.min(y, sy),
        Math.max(x, sx),
        Math.max(y, sy),
      ]);
    if (finish) drag.current = null;
  };
  const activeRoi = roiMode === "ball" ? ballRoi : roi;
  const updateBall = (editValue) => {
    if (!frame || !sourceData) return;
    setData((prev) => ({
      ...prev,
      frames: prev.frames.map((f) => {
        if (f.i !== frame.i) return f;
        const next = { ...f };
        if (!Object.prototype.hasOwnProperty.call(next, "ball_auto"))
          next.ball_auto = f.ball ?? null;
        if (editValue)
          next.ball_edit = {
            ...editValue,
            edited_at: new Date().toISOString(),
          };
        else delete next.ball_edit;
        return next;
      }),
    }));
  };
  const clickBall = (e) => {
    if (!ballEditing || playing || !frame) return;
    const rect = e.currentTarget.getBoundingClientRect();
    updateBall({
      kind: ballPointKind,
      x: ((e.clientX - rect.left) / rect.width) * data.meta.width,
      y: ((e.clientY - rect.top) / rect.height) * data.meta.height,
    });
  };
  const rerunBall = async () => {
    if (!sourceFile || !data || ballBusy) return;
    video.current?.pause();
    setBallBusy(true);
    try {
      const d = {
        ...data,
        meta: { ...data.meta },
        shots,
        frames: data.frames.map((f) => ({ ...f, f: { ...f.f } })),
      };
      const { analyzeBall } = await import(
        /* @vite-ignore */ new URL("ball-analyzer.mjs", document.baseURI).href
      );
      await analyzeBall(sourceFile, d, {
        roi: data.meta.ball_detection?.roi ?? [0, 0, 1, 1],
        motionOnly: true,
        onProgress: (p, text) =>
          setBallProgress(`${Math.round(p * 100)}% · ${text}`),
      });
      setData(d);
      toast.success(
        "動きからボール候補を再抽出しました。軌道を映像と照合してください。",
      );
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBallBusy(false);
      setBallProgress("");
    }
  };
  const beginReconstruction = () => {
    if (!selectedShot) return;
    video.current?.pause();
    setBallEditing(true);
    setBallOverlay(true);
    setBallPointKind("point");
    const f = data.frames.find((f) => f.t >= selectedShot.release);
    seek((f?.t ?? selectedShot.release) + 0.001);
  };
  const startBallEdit = () => {
    video.current?.pause();
    if (!ballEditing && frame) seek(frame.t + 0.001);
    setBallOverlay(true);
    setBallEditing(!ballEditing);
  };
  return (
    <div className="app-shell">
      <Toaster position="bottom-right" richColors />
      <input
        ref={input}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) openFile(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={jsonInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) restore(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <header className="topbar">
        <div className="brand">
          <span className="brand-symbol">
            <Activity size={21} />
          </span>
          ShotLab
          <span className="brand-divider" />
          <span className="workspace-name">
            Motion workspace · v{SETTINGS.app_version}
          </span>
        </div>
        <div className="top-actions">
          <span className="local-badge">動画は端末内で解析</span>
          <button
            className="icon-button"
            onClick={() => setHelpOpen(true)}
            aria-label="解析方法と精度について"
          >
            <Info size={19} />
          </button>
        </div>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <div className="eyebrow">BASKETBALL / MOTION ANALYSIS</div>
            <h1>フリースロー解析</h1>
            <div className="fileline">
              <Film size={14} />
              <span>
                {data?.meta.filename ?? "動画をインポートしてください"}
              </span>
              <span className="file-dot">·</span>
              <span className="mono">
                {data ? `${data.meta.width} × ${data.meta.height}` : "—"}
              </span>
              <span className="file-dot">·</span>
              <span className="mono">
                {data ? `${fmt(data.meta.fps, 2)} fps` : "—"}
              </span>
            </div>
          </div>
          <div className="heading-actions">
            <button className="button" onClick={() => exportData("dictionary")}>
              <BookOpen size={16} />
              カラム説明
            </button>
            <button className="button" onClick={() => input.current?.click()}>
              <Upload size={16} />
              動画をインポート
            </button>
            <button
              className="button primary"
              disabled={!data}
              onClick={() => setExportOpen(true)}
            >
              <Download size={16} />
              CSVエクスポート
            </button>
          </div>
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => location.reload()}>再読み込み</button>
          </div>
        )}
        <div className="analysis-grid">
          <section className="panel source-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-index">01</span>
                <h2>動画</h2>
              </div>
              <span className="small-tag">SOURCE</span>
            </div>
            <div className="video-area">
              <div
                className={`video-wrap ${ballEditing ? "ball-editing" : ""}`}
                style={
                  data
                    ? {
                        aspectRatio: `${data.meta.width} / ${data.meta.height}`,
                      }
                    : undefined
                }
                onClick={clickBall}
              >
                {!src && (
                  <div className="video-empty">
                    <Film size={38} />
                    <p>フリースローの動画を選択</p>
                    <button
                      className="button"
                      onClick={() => input.current?.click()}
                    >
                      動画をインポート
                    </button>
                    <small>1人の全身が映る、固定カメラの動画を使用</small>
                  </div>
                )}
                <video
                  ref={video}
                  src={src || undefined}
                  playsInline
                  muted
                  preload="auto"
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onError={() =>
                    setError(
                      "動画を再生できません。別の動画をインポートしてください。",
                    )
                  }
                />
                <canvas ref={overlayCanvas} />
              </div>
              <div className="video-stamp mono">{clock(time)}</div>
              <span
                className={`phase-pill ${phase === "other" ? "" : "active"}`}
              >
                {phases[phase]}
              </span>
            </div>
            <div className="playback">
              <button
                className="icon-button"
                onClick={() => stepFrame(-1)}
                aria-label="1フレーム戻る"
              >
                <SkipBack size={16} />
              </button>
              <button
                className="play-button"
                onClick={toggle}
                aria-label={playing ? "一時停止" : "再生"}
              >
                {playing ? <Pause size={19} /> : <Play size={19} />}
              </button>
              <button
                className="icon-button"
                onClick={() => stepFrame(1)}
                aria-label="1フレーム進む"
              >
                <SkipForward size={16} />
              </button>
              <span className="play-time mono">
                {clock(time)} <span>/ {clock(data?.meta.duration ?? 0)}</span>
              </span>
              <Choice
                value={rate}
                onChange={(v) => {
                  setRate(v);
                  if (video.current) video.current.playbackRate = Number(v);
                }}
                options={["0.25", "0.5", "1", "1.5", "2"].map((v) => [
                  v,
                  v + "×",
                ])}
                label="再生速度"
                className="speed-select"
              />
            </div>
            <div className="scrubber">
              <Slider
                min={0}
                max={data?.meta.duration ?? 1}
                step={0.001}
                value={[time]}
                onValueChange={([v]) => seek(v)}
                aria-label="再生位置"
              />
              <div className="shot-ticks">
                {shots.map((s) => (
                  <button
                    key={s.id}
                    style={{
                      left: `${(s.release / (data?.meta.duration ?? 1)) * 100}%`,
                    }}
                    className={
                      s.outcome === 1 ? "made" : s.outcome === 0 ? "missed" : ""
                    }
                    onClick={() => selectShot(s)}
                    aria-label={`シュート${s.id}へ移動`}
                  />
                ))}
              </div>
            </div>
            <div className="source-options">
              <label>
                <Switch checked={overlay} onCheckedChange={setOverlay} />
                骨格を重ねる
              </label>
              <label>
                <Switch
                  checked={ballOverlay}
                  onCheckedChange={setBallOverlay}
                />
                ボール軌道
              </label>
              <span className="mono">
                FRAME {String(frame?.i ?? 0).padStart(4, "0")}
              </span>
            </div>
            {data && (
              <div className="ball-editor">
                <div className="ball-edit-actions">
                  <button
                    className={`button small ${ballEditing ? "primary" : ""}`}
                    onClick={startBallEdit}
                  >
                    {ballEditing ? "位置の修正を終了" : "ボール位置を修正"}
                  </button>
                  <button
                    className="button small"
                    onClick={() => exportData("ball")}
                  >
                    軌道 CSV
                  </button>
                  <button
                    className="button small primary"
                    disabled={!selectedShot || ballBusy}
                    onClick={beginReconstruction}
                  >
                    3点から軌道を復元
                  </button>
                  <button
                    className="button small"
                    disabled={!sourceFile || ballBusy}
                    onClick={rerunBall}
                  >
                    {ballBusy ? "抽出中…" : "動きからボールを再検出"}
                  </button>
                </div>
                <p>
                  シュートを選び、手離れ直後・飛行中・リング接触前の3時刻で位置を指定すると、その間を放物線で補います。1時刻に1点、時刻を十分離して指定してください。
                </p>
                {ballBusy && <p role="status">{ballProgress}</p>}
                {ballEditing && (
                  <>
                    <p>
                      前後のフレームや再生バーで時刻を選び、一時停止中の映像をクリック。見えているボールは「観測点」、見えない位置を推測して置く場合は「仮定点」を選びます。3点は同じ飛行区間の中で指定してください。
                    </p>
                    <div className="ball-edit-actions">
                      <label>
                        点の種類{" "}
                        <select
                          aria-label="ボール点の種類"
                          value={ballPointKind}
                          onChange={(e) => setBallPointKind(e.target.value)}
                        >
                          <option value="point">観測点：ボールが見える</option>
                          <option value="assumed">
                            仮定点：位置を推測して置く
                          </option>
                        </select>
                      </label>
                      <button
                        className="button small"
                        onClick={() => stepFrame(-1)}
                      >
                        1フレーム前
                      </button>
                      <button
                        className="button small"
                        onClick={() => stepFrame(1)}
                      >
                        1フレーム後
                      </button>
                      <button
                        className="button small"
                        onClick={() => updateBall({ kind: "missing" })}
                        disabled={!frame}
                      >
                        この点を欠測に
                      </button>
                      <button
                        className="button small"
                        onClick={() => updateBall(null)}
                        disabled={!frame?.ball_edit}
                      >
                        この点の修正を戻す
                      </button>
                    </div>
                  </>
                )}
                <p className="ball-status" role="status">
                  {frame?.ball_edit?.kind === "assumed"
                    ? "現在の点：位置を仮定（観測ではありません）"
                    : frame?.ball_edit?.kind === "missing"
                      ? "現在の点：手動で欠測に指定"
                      : frame?.ball?.source === "manual"
                        ? "現在の点：手修正"
                        : frame?.ball
                          ? "現在の点：自動検出候補（要確認）"
                          : "現在の点：欠測"}
                </p>
                {data.meta.ball_detection?.status === "error" && (
                  <p className="import-error" role="alert">
                    ボール自動検出を完了できませんでした：
                    {data.meta.ball_detection.error}。手動で位置を追加できます。
                  </p>
                )}
                {data.meta.ball_detection?.status === "disabled" && (
                  <p>ボール自動検出はオフです。手動で位置を追加できます。</p>
                )}
                <BallTrajectory
                  data={data}
                  shot={selectedShot}
                  time={time}
                  onSeek={seek}
                />
              </div>
            )}
            <div className="capture-info">
              <div>
                <span>現在の動作</span>
                <strong>
                  {current
                    ? `SHOT ${String(current.id).padStart(2, "0")}`
                    : "待機区間"}
                </strong>
              </div>
              <div>
                <span>結果ラベル</span>
                <strong
                  className={
                    current?.outcome === 1
                      ? "text-made"
                      : current?.outcome === 0
                        ? "text-missed"
                        : ""
                  }
                >
                  {current?.outcome === 1
                    ? "成功"
                    : current?.outcome === 0
                      ? "失敗"
                      : "未確認"}
                </strong>
              </div>
              <div>
                <span>解析範囲</span>
                <strong>左右・全身</strong>
              </div>
            </div>
          </section>
          <section className="panel motion-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-index">02</span>
                <h2>モーション</h2>
              </div>
              <ScanLine size={16} />
            </div>
            <div className="skeleton-stage">
              <Skeleton
                frame={frame}
                mode={mode}
                yaw={yaw}
                meta={data?.meta ?? { width: 640, height: 360 }}
                bodyOnly={bodyOnly}
              />
              <div className="skeleton-top">
                <span>{bodyOnly ? "16 MAIN POINTS" : "33 LANDMARKS"}</span>
                <span className="mono">{mode === "2d" ? "2D" : "3D EST."}</span>
              </div>
              <div className="skeleton-bottom">
                <span>
                  <i style={{ background: LEFT }} />左
                </span>
                <span>
                  <i style={{ background: RIGHT }} />右
                </span>
                <span className="muted">破線：低可視性</span>
              </div>
            </div>
            <div className="motion-control">
              <Choice
                value={mode}
                onChange={setMode}
                options={[
                  ["2d", "映像平面"],
                  ["3d", "推定3D"],
                ]}
                label="骨格表示モード"
              />
              <span>
                {
                  BODY.filter(
                    (i) =>
                      confidence(frame?.p?.[i]) >=
                      (data?.meta.analysis_settings ?? SETTINGS).confidence
                        .landmark,
                  ).length
                }{" "}
                / 16 <small>主要関節</small>
              </span>
            </div>
            <div
              className="point-choice"
              role="group"
              aria-label="表示する身体の点"
            >
              <button
                className={bodyOnly ? "active" : ""}
                aria-pressed={bodyOnly}
                onClick={() => setBodyOnly(true)}
              >
                主要16点
              </button>
              <button
                className={!bodyOnly ? "active" : ""}
                aria-pressed={!bodyOnly}
                onClick={() => setBodyOnly(false)}
              >
                全33点
              </button>
            </div>
            <div className="body-downloads">
              <button
                className="button small"
                disabled={!data}
                onClick={() => exportData("body")}
              >
                主要16点 CSV
              </button>
              <button
                className="button small"
                disabled={!data}
                onClick={() => exportData("landmarks")}
              >
                全33点 CSV
              </button>
            </div>
            {mode === "3d" && (
              <div className="rotation">
                <span>回転</span>
                <Slider
                  value={[yaw]}
                  min={-180}
                  max={180}
                  onValueChange={([v]) => setYaw(v)}
                  aria-label="推定3Dの回転"
                />
              </div>
            )}
            <p className="motion-note">
              Google
              MediaPipeで33点を推定し、標準表示は顔・指先を除く主要16点です。表示切替で元データは変わりません。隠れた関節は推定です。
            </p>
          </section>
          <section className="panel signal-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-index">03</span>
                <h2>波形・特徴量</h2>
              </div>
              <span className="sync-label">
                <span />
                動画に同期
              </span>
            </div>
            <div className="metric-grid">
              {[
                ["膝の内角", "knee"],
                ["肘の内角", "elbow"],
              ].map(([name, key]) => (
                <div className="metric" key={key}>
                  <span>{name}</span>
                  <div>
                    <small style={{ color: LEFT }}>L</small>
                    <b>{fmt(metrics["left_" + key + "_deg"])}</b>
                    <small>°</small>
                    <small style={{ color: RIGHT }}>R</small>
                    <b>{fmt(metrics["right_" + key + "_deg"])}</b>
                    <small>°</small>
                  </div>
                </div>
              ))}
              <div className="metric">
                <span>体幹の傾き</span>
                <div>
                  <b>{fmt(metrics.trunk_lean_deg, 1)}</b>
                  <small>°</small>
                </div>
              </div>
              <div className="metric">
                <span>主要関節の可視率</span>
                <div>
                  <b>{fmt((metrics.visible_fraction ?? 0) * 100)}</b>
                  <small>%</small>
                  <span className="metric-hint">精度ではありません</span>
                </div>
              </div>
            </div>
            <div className="wave-legend">
              <span>
                <i style={{ background: LEFT }} />左
              </span>
              <span>
                <i style={{ background: RIGHT }} />右
              </span>
              <span className="wave-window">開始から蓄積・再生時点まで</span>
            </div>
            {data ? (
              <>
                <Wave
                  data={data}
                  time={time}
                  title="膝関節"
                  keys={["left_knee_deg", "right_knee_deg"]}
                  colors={[LEFT, RIGHT]}
                />
                <Wave
                  data={data}
                  time={time}
                  title="肘関節"
                  keys={["left_elbow_deg", "right_elbow_deg"]}
                  colors={[LEFT, RIGHT]}
                />
                <Wave
                  data={data}
                  time={time}
                  title="体幹の傾き"
                  keys={["trunk_lean_deg"]}
                  colors={["#67717f"]}
                  min={-45}
                  max={45}
                />
                <Wave
                  data={data}
                  time={time}
                  title="ボール位置 Y（下向き正）"
                  keys={["ball_y_px", "ball_y_px_corrected"]}
                  colors={["#9aa4b1", BALL]}
                  labels={["観測", "放物線補正"]}
                  min={0}
                  max={data.meta.height}
                  unit="px"
                />
              </>
            ) : (
              <div className="loading-data">
                動画を読み込むと、ここに角度と波形を表示します。
              </div>
            )}
            <div className="ball-legend">
              <span>
                <i style={{ background: "#9aa4b1" }} />
                ボール観測
              </span>
              <span>
                <i style={{ background: BALL }} />
                放物線補正
              </span>
              <span>飛行区間・事後推定</span>
            </div>
            <div className="signal-foot">
              波形にカーソルを合わせると数値を表示。角度の欠測区間は線をつなぎません。
            </div>
          </section>
        </div>
        <section className="panel shots-panel">
          <div className="shot-heading">
            <div>
              <div className="section-title">
                <h2>シュート一覧</h2>
                <span className="count-badge">{shots.length}</span>
              </div>
              <p>区間と結果を確認して、分析用の目的変数を記録。</p>
            </div>
            <div className="shot-summary">
              <span>
                <i className="dot made" />
                成功 <b>{successes}</b>
              </span>
              <span>
                <i className="dot missed" />
                失敗 <b>{accepted - successes}</b>
              </span>
              <span>
                未確認 <b>{shots.length - accepted}</b>
              </span>
              <button
                className="button small"
                disabled={!data}
                onClick={addShot}
              >
                <Plus size={15} />
                区間を追加
              </button>
            </div>
          </div>
          <div className="sample-label-note">
            {data?.meta.demo
              ? "サンプルの結果は映像確認による暫定ラベルです。研究に使う前に再確認してください。"
              : "自動抽出した区間は候補です。時刻と結果を映像で確認してください。"}
          </div>
          <div className="shot-strip">
            {shots.map((s) => (
              <button
                key={s.id}
                onClick={() => selectShot(s)}
                className={`shot-chip ${selected === s.id ? "selected" : ""} ${s.outcome === 1 ? "made" : s.outcome === 0 ? "missed" : "unknown"}`}
              >
                <span className="mono">{String(s.id).padStart(2, "0")}</span>
                <span>
                  {s.outcome === 1
                    ? "成功"
                    : s.outcome === 0
                      ? "失敗"
                      : "未確認"}
                </span>
                <small className="mono">{clock(s.release)}</small>
              </button>
            ))}
            {!shots.length && (
              <p className="empty-shots">
                区間がまだありません。リリース位置で「区間を追加」を押してください。
              </p>
            )}
          </div>
          {selectedShot && (
            <div className="selected-shot">
              <div className="selected-shot-label">
                <span className="eyebrow">SELECTED SHOT</span>
                <strong className="mono">
                  {String(selectedShot.id).padStart(2, "0")}
                </strong>
              </div>
              <div className="shot-details">
                {[
                  ["セット開始", clock(selectedShot.start)],
                  ["リリース", clock(selectedShot.release)],
                  ["区間終了", clock(selectedShot.end)],
                  [
                    "時刻の確認",
                    selectedShot.timing_reviewed ? "確認済み" : "要確認",
                  ],
                ].map(([k, v]) => (
                  <div key={k}>
                    <span>{k}</span>
                    <b className="mono">{v}</b>
                  </div>
                ))}
              </div>
              <div className="label-control">
                <label>結果（目的変数）</label>
                <Choice
                  value={
                    selectedShot.outcome === null
                      ? "unknown"
                      : String(selectedShot.outcome)
                  }
                  onChange={(v) => updateOutcome(selectedShot.id, v)}
                  options={[
                    ["unknown", "未確認"],
                    ["1", "成功 · 1"],
                    ["0", "失敗 · 0"],
                  ]}
                  label="シュート結果"
                  className={
                    selectedShot.outcome === 1
                      ? "result-made"
                      : selectedShot.outcome === 0
                        ? "result-missed"
                        : ""
                  }
                />
              </div>
              <button
                className="button small"
                onClick={() => setEdit({ ...selectedShot })}
              >
                <SlidersHorizontal size={15} />
                時刻を編集
              </button>
            </div>
          )}
        </section>
        <div className="bottom-note">
          <span>
            <Info size={14} />
            単眼映像による推定値です。標準モーションキャプチャに対する精度検証は未実施。
          </span>
          <button onClick={() => setHelpOpen(true)}>解析仕様を見る</button>
        </div>
      </main>
      <footer>
        <span>
          SHOTLAB <span className="muted">/</span> MOTION WORKSPACE
        </span>
        <span>左右の角度 · 生座標 · 可視性 · 結果ラベル</span>
      </footer>
      <Dialog
        open={importOpen}
        onOpenChange={(v) => {
          if (!busy) setImportOpen(v);
        }}
      >
        <DialogContent className="app-dialog import-dialog">
          <DialogHeader>
            <DialogTitle>動画をインポート</DialogTitle>
            <DialogDescription>
              「身体の範囲」は全身を、「ボールの範囲」は手元からリングまでの飛行範囲を囲みます。ボールは初期設定で映像全体を探します。
            </DialogDescription>
          </DialogHeader>
          {file && (
            <>
              <div className="point-choice" role="group" aria-label="囲む範囲">
                <button
                  disabled={busy}
                  className={roiMode === "body" ? "active" : ""}
                  onClick={() => setRoiMode("body")}
                >
                  身体の範囲
                </button>
                <button
                  disabled={busy}
                  className={roiMode === "ball" ? "active" : ""}
                  onClick={() => setRoiMode("ball")}
                >
                  ボールの範囲
                </button>
              </div>
              <div
                className="import-video"
                onPointerDown={(e) => {
                  if (busy) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const r = e.currentTarget.getBoundingClientRect();
                  drag.current = [
                    (e.clientX - r.left) / r.width,
                    (e.clientY - r.top) / r.height,
                  ];
                }}
                onPointerMove={(e) => changeRoi(e)}
                onPointerUp={(e) => changeRoi(e, true)}
              >
                <video src={importSrc} muted preload="auto" />
                <div
                  className="roi-box"
                  style={{
                    left: `${activeRoi[0] * 100}%`,
                    top: `${activeRoi[1] * 100}%`,
                    width: `${(activeRoi[2] - activeRoi[0]) * 100}%`,
                    height: `${(activeRoi[3] - activeRoi[1]) * 100}%`,
                  }}
                />
                <span className="roi-label">
                  {roiMode === "ball" ? "ボールの飛行範囲" : "選手の動作範囲"}
                </span>
              </div>
              <div className="import-meta">
                <span>{file.name}</span>
                <button
                  onClick={() =>
                    (roiMode === "ball" ? setBallRoi : setRoi)([0, 0, 1, 1])
                  }
                  disabled={busy}
                >
                  枠をリセット
                </button>
              </div>
              <div className="import-settings">
                <label>ブラウザ解析サンプル数 / 秒</label>
                <Choice
                  value={sample}
                  onChange={setSample}
                  options={[
                    ["30", "30 fps"],
                    ["15", "15 fps"],
                  ]}
                  label="解析サンプル数"
                />
              </div>
              <label className="ball-toggle">
                <Switch
                  checked={trackBall}
                  disabled={busy}
                  onCheckedChange={setTrackBall}
                />
                ボールも自動検出する
              </label>
              <p className="helper-text">
                身体は33点を推定し、主要16点だけのCSVも保存できます。ボールはAIと画像の動きから検出するため処理時間が増えます。小さい球・遮蔽・複数の球には誤検出や欠測があり、解析後に手修正できます。まず5〜10秒の動画でお試しください。
              </p>
              {busy && (
                <div className="import-progress">
                  <Progress value={progress} />
                  <p>
                    {progressText}
                    <b>{progress.toFixed(0)}%</b>
                  </p>
                </div>
              )}
              <div className="import-error" role="alert">
                {importError}
              </div>
              <div className="dialog-actions">
                {busy ? (
                  <button
                    className="button"
                    onClick={() => controller.current?.abort()}
                  >
                    解析を中止
                  </button>
                ) : (
                  <>
                    <button
                      className="button"
                      onClick={() => setImportOpen(false)}
                    >
                      キャンセル
                    </button>
                    <button
                      className="button"
                      onClick={() => jsonInput.current?.click()}
                    >
                      保存セッションを復元
                    </button>
                    <button className="button primary" onClick={analyze}>
                      <ScanLine size={16} />
                      解析を開始
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="app-dialog">
          <DialogHeader>
            <DialogTitle>分析データを書き出す</DialogTitle>
            <DialogDescription>
              未確認の結果と低可視性の関節角度は空欄です。
            </DialogDescription>
          </DialogHeader>
          {data && (
            <div className="analysis-identity">
              <label>
                選手ID（例：P01）
                <input
                  aria-label="選手ID"
                  value={sourceData.meta.player_id ?? ""}
                  onChange={(e) =>
                    setData((prev) => ({
                      ...prev,
                      meta: { ...prev.meta, player_id: e.target.value },
                    }))
                  }
                />
              </label>
              <label>
                測定ID（例：2026-10-28-A）
                <input
                  aria-label="測定ID"
                  value={sourceData.meta.session_id ?? ""}
                  onChange={(e) =>
                    setData((prev) => ({
                      ...prev,
                      meta: { ...prev.meta, session_id: e.target.value },
                    }))
                  }
                />
              </label>
              <label>
                シュートする手
                <select
                  aria-label="シュートする手"
                  value={sourceData.meta.shooting_hand ?? "unknown"}
                  onChange={(e) =>
                    setData((prev) => ({
                      ...prev,
                      meta: { ...prev.meta, shooting_hand: e.target.value },
                    }))
                  }
                >
                  <option value="unknown">未設定</option>
                  <option value="right">右手</option>
                  <option value="left">左手</option>
                </select>
              </label>
              <small>
                PCA候補CSVは選手ID・シュートする手・投区間の確認が必要です。全データとセッションにも保存します。
              </small>
            </div>
          )}
          <div className="export-options">
            {[
              [
                "shots",
                "シュート単位 CSV",
                "1行＝1投。平均・中央値・SD・IQR・最小最大・可動域・リリース角・軌道係数。",
                Activity,
              ],
              [
                "pca",
                "PCA候補 CSV",
                "シュートする側をそろえた10特徴量。ID・確認状態を含む。PCA計算前の入力候補。",
                Activity,
              ],
              [
                "phases",
                "局面別の統計 CSV",
                "セット・シュート動作・リリース後の平均・中央値・SD・IQR・有効割合。",
                Activity,
              ],
              [
                "waveforms",
                "時間をそろえた波形 CSV",
                "各局面を0〜100%の51点へ。長い欠測は埋めず、補間した値を明示。",
                Activity,
              ],
              [
                "frames",
                "フレーム単位 CSV",
                "時刻・左右角度・生値・ボールの観測値と補正値。",
                Film,
              ],
              [
                "body",
                "主要16点 CSV",
                "基本の分析用。左右の肩・肘・手首・股・膝・足首・かかと・つま先。",
                Activity,
              ],
              [
                "landmarks",
                "全33点 CSV",
                "元データ保存用。顔・指先も含むMediaPipeの全点。",
                Box,
              ],
              [
                "ball",
                "ボール軌道 CSV",
                "自動候補・手修正・採用座標・放物線を別列で保存。",
                Activity,
              ],
              [
                "metadata",
                "解析設定 JSON",
                "バージョン・使用モデル・設定・区間確認の記録。",
                SlidersHorizontal,
              ],
              [
                "session",
                "セッション JSON",
                "解析と確認済みラベルを保存・復元。",
                FolderOpen,
              ],
              [
                "dictionary",
                "カラム説明 CSV",
                "全カラムの意味・単位・欠測・補正の扱い。",
                BookOpen,
              ],
              [
                "guide",
                "データの読み方 HTML",
                "ブラウザで読める説明書。保存・印刷できます。",
                FileText,
              ],
            ].map(([key, title, desc, Icon]) => (
              <button key={key} onClick={() => exportData(key)}>
                <Icon />
                <div>
                  <strong>{title}</strong>
                  <span>{desc}</span>
                </div>
                <Download size={17} />
              </button>
            ))}
          </div>
          <button
            className="text-button"
            onClick={() => {
              setExportOpen(false);
              jsonInput.current?.click();
            }}
          >
            保存したセッションを復元
          </button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!edit}
        onOpenChange={(v) => {
          if (!v) setEdit(null);
        }}
      >
        <DialogContent className="app-dialog">
          <DialogHeader>
            <DialogTitle>シュート {edit?.id} の区間</DialogTitle>
            <DialogDescription>
              映像で確認した秒数を入力します。リリースはボールが手から離れる時点です。
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <>
              <div className="timing-fields">
                {[
                  ["start", "セット開始"],
                  ["drive", "上昇開始"],
                  ["release", "リリース"],
                  ["end", "区間終了"],
                ].map(([key, label]) => (
                  <label key={key}>
                    <span>{label}（秒）</span>
                    <div>
                      <input
                        type="number"
                        step="0.001"
                        value={edit[key]}
                        onChange={(e) =>
                          setEdit({ ...edit, [key]: Number(e.target.value) })
                        }
                      />
                      <button
                        onClick={() =>
                          setEdit({ ...edit, [key]: Number(time.toFixed(3)) })
                        }
                      >
                        現在位置
                      </button>
                    </div>
                  </label>
                ))}
              </div>
              <label className="note-input">
                確認メモ
                <input
                  value={edit.note ?? ""}
                  onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                />
              </label>
              <div className="dialog-actions">
                <button
                  className="button danger"
                  onClick={() => {
                    setShots(shots.filter((s) => s.id !== edit.id));
                    setEdit(null);
                  }}
                >
                  この区間を削除
                </button>
                <button className="button primary" onClick={saveEdit}>
                  <Check size={16} />
                  確認して保存
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="app-dialog help-dialog">
          <DialogHeader>
            <DialogTitle>解析仕様と読み方</DialogTitle>
            <DialogDescription>
              研究用の探索・特徴量抽出を支援します。
            </DialogDescription>
          </DialogHeader>
          <div className="help-body">
            <h3>全身を推定し、可視性で区別</h3>
            <p>
              MediaPipe Pose Landmarker
              Heavyで左右を含む33点を推定。主要16関節の可視率は測定精度ではありません。角度に必要な点のvisibilityまたはpresenceが設定閾値（初期値0.5）未満なら欠測です。
            </p>
            <h3>再生時刻に同期する波形</h3>
            <p>
              動画の開始から再生時点までの波形を蓄積します。時間軸は再生に合わせて広がり、終了時には全区間を表示します。巻き戻した場合は、その時点より先を非表示にします。未来の値を使わないOne
              Euroフィルタで揺れを抑え、生値も保存。角速度は過去との差分です。録画の同期再生で、カメラのライブ収録機能は含みません。
            </p>
            <h3>2D角度と推定3D</h3>
            <p>
              角度は画素の縦横比を補正した映像平面の内角。3D座標は単眼モデルの推定で、実測距離ではありません。回旋や隠れた側の角度には不確かさがあります。
            </p>
            <h3>結果・区間・ボール</h3>
            <p>
              successは成功1、失敗0、未確認は空欄。区間は姿勢からの候補なので離手時刻を確認してください。ボールはAIと固定カメラの背景差分から候補を探し、放物線へつなぎます。自動検出がなくても「3点から軌道を復元」で異なる3時刻の点を指定できます。緑は見える球の手動観測、紫は見えない位置の仮定、橙の破線は事後推定です。仮定点を使った曲線全体には印が付きます。元の自動候補は保持します。接触前の範囲で指定し、曲線を映像と照合してください。基準位置との精度は未検証です。
            </p>
            <h3>精度を検証するには</h3>
            <p>
              小さな選手像、遮蔽、圧縮は推定の不安定さにつながります。通常の多眼モーションキャプチャ相当の精度は保証できません。固定カメラで全身が大きく映る高解像度・高フレームレートの映像、複数方向の同期撮影と基準計測が必要です。
            </p>
            <div className="help-links">
              <button
                className="text-button"
                onClick={() => exportData("dictionary")}
              >
                カラム説明 CSVを保存
              </button>
              <button
                className="text-button"
                onClick={() => exportData("guide")}
              >
                説明書 HTMLを保存
              </button>
              <a
                href="https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker"
                target="_blank"
                rel="noreferrer"
              >
                MediaPipe 公式仕様
              </a>
              <a
                href="https://www.nature.com/articles/s41598-025-22626-7"
                target="_blank"
                rel="noreferrer"
              >
                単眼姿勢推定の検証研究
              </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
