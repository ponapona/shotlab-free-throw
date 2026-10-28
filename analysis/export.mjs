import fs from "node:fs";
import path from "node:path";
import { dictionaryRows } from "../public/dictionary.mjs";
import { correctBallistics } from "../public/ballistics.mjs";
import { ballRows } from "../public/ball-tracking.mjs";
import {
  enrich,
  suggestShots,
  frameRows,
  shotRows,
  landmarkRows,
  csv,
} from "../public/engine.mjs";
const input = process.argv[2],
  out = process.argv[3] ?? "results";
if (!input)
  throw new Error(
    "Usage: node analysis/export.mjs SESSION.json OUTPUT_DIRECTORY",
  );
const d = enrich(JSON.parse(fs.readFileSync(input, "utf8")));
if (!d.shots.length) d.shots = suggestShots(d);
correctBallistics(d);
fs.mkdirSync(out, { recursive: true });
for (const [name, rows] of [
  ["frames", frameRows(d, d.shots)],
  ["shots", shotRows(d, d.shots)],
  ["landmarks", landmarkRows(d)],
  ["body", landmarkRows(d, { bodyOnly: true })],
  ["ball", ballRows(d, d.shots)],
]) {
  fs.writeFileSync(
    path.join(out, name + ".csv"),
    csv(
      rows,
      dictionaryRows()
        .filter(
          (r) => r.file === (name === "body" ? "landmarks" : name) + ".csv",
        )
        .map((r) => r.column),
    ),
  );
  console.log(name, rows.length);
}
fs.writeFileSync(path.join(out, "enriched.json"), JSON.stringify(d));
fs.writeFileSync(
  path.join(out, "metadata.json"),
  JSON.stringify(d.meta, null, 2),
);

fs.writeFileSync(path.join(out, "ShotLab_columns.csv"), csv(dictionaryRows()));
