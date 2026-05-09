// Run with: pnpm dlx tsx src/lib/renpy/__fixtures__/roundtrip.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseRenpyTranslations, serializeRenpyTranslations } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const original = readFileSync(join(here, "sample.rpy"), "utf8");

const first = parseRenpyTranslations(original);
if (first.warnings.length) {
  console.error("Unexpected warnings on first parse:", first.warnings);
  process.exit(1);
}

const round1 = serializeRenpyTranslations(first.strings);
const second = parseRenpyTranslations(round1);
if (second.warnings.length) {
  console.error("Unexpected warnings on second parse:", second.warnings);
  process.exit(1);
}

const a = JSON.stringify(first.strings);
const b = JSON.stringify(second.strings);
if (a !== b) {
  console.error("Round-trip mismatch:\n--- first ---\n" + a + "\n--- second ---\n" + b);
  process.exit(1);
}

const round2 = serializeRenpyTranslations(second.strings);
if (round1 !== round2) {
  console.error("Serialize is not idempotent. round1 vs round2 differ.");
  process.exit(1);
}

console.log(`OK — ${first.strings.length} strings, round-trip stable.`);
