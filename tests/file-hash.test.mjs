import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256, sha256Fallback } from "../public/file-hash.mjs";
test("portable file identity matches native SHA-256 across padding boundaries and large files", async () => {
  for (const length of [0, 1, 55, 56, 63, 64, 65, 127, 128, 1000000]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + 17) % 256);
    const expected = createHash("sha256").update(bytes).digest("hex");
    assert.equal(sha256Fallback(bytes), expected);
    assert.equal(await sha256(bytes), expected);
  }
  assert.equal(
    sha256Fallback(new TextEncoder().encode("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
