import fs from "node:fs";
const s = JSON.parse(
  fs.readFileSync(new URL("../config/defaults.json", import.meta.url)),
);
const pkg = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url)),
);
if (s.app_version !== pkg.version)
  throw new Error("Version mismatch: config/defaults.json and package.json");
if (s.model.sdk_web !== pkg.dependencies["@mediapipe/tasks-vision"])
  throw new Error("MediaPipe SDK version mismatch");
for (const v of Object.values(s.confidence))
  if (!(v >= 0 && v <= 1)) throw new Error("Confidence must be in [0,1]");
fs.writeFileSync(
  new URL("../public/settings.mjs", import.meta.url),
  "// Generated from config/defaults.json. Run npm run config after editing.\nexport const SETTINGS = " +
    JSON.stringify(s, null, 2) +
    ";\n",
);
