// Run with: pnpm dlx tsx src/lib/renpy/__fixtures__/sceneRoundtrip.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseRpyScript } from "../scriptParser.js";
import { serializeRpyScript } from "../scriptSerializer.js";
import type { RpyBlock } from "../blocks.js";

const here = dirname(fileURLToPath(import.meta.url));
const original = readFileSync(join(here, "sceneSample.rpy"), "utf8");

// Drop random block ids so two parses are structurally comparable.
function stripIds(blocks: RpyBlock[]): unknown {
  return blocks.map((b) => {
    const { id: _id, ...rest } = b;
    void _id;
    return rest;
  });
}

const first = parseRpyScript(original);
if (first.warnings.length) {
  console.error("Unexpected warnings on first parse:", first.warnings);
  process.exit(1);
}

const round1 = serializeRpyScript(first.blocks);
const second = parseRpyScript(round1);
if (second.warnings.length) {
  console.error("Unexpected warnings on second parse:", second.warnings);
  process.exit(1);
}

const a = JSON.stringify(stripIds(first.blocks));
const b = JSON.stringify(stripIds(second.blocks));
if (a !== b) {
  console.error("Round-trip mismatch:");
  console.error("--- first ---");
  console.error(a);
  console.error("--- second ---");
  console.error(b);
  process.exit(1);
}

const round2 = serializeRpyScript(second.blocks);
if (round1 !== round2) {
  console.error("Serialize is not idempotent. round1 vs round2 differ:");
  console.error("--- round1 ---");
  console.error(round1);
  console.error("--- round2 ---");
  console.error(round2);
  process.exit(1);
}

// Spot-check a few semantic expectations that wouldn't survive a regression.
const labels = first.blocks.filter((b) => b.kind === "label");
if (labels.length !== 4) {
  console.error(`Expected 4 labels in fixture, got ${labels.length}.`);
  process.exit(1);
}

const says = first.blocks.filter((b) => b.kind === "say");
if (says.length === 0) {
  console.error("Expected dialogue blocks, got none.");
  process.exit(1);
}

const choices = first.blocks.filter((b) => b.kind === "choice");
if (choices.length !== 2) {
  console.error(`Expected 2 menu choices, got ${choices.length}.`);
  process.exit(1);
}

const raws = first.blocks.filter((b) => b.kind === "raw");
if (raws.length === 0) {
  console.error(
    "Expected at least one raw block (the if/else branch in ch2_bar_leave was parsed structurally — that's wrong for v1).",
  );
  process.exit(1);
}

console.log(
  `OK — ${first.blocks.length} blocks ` +
    `(${labels.length} labels, ${says.length} says, ${choices.length} choices, ${raws.length} raws), ` +
    `round-trip stable.`,
);
