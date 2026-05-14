/**
 * Pure path-simulator engine — walks a project's labels the same way Ren'Py
 * does, but lossily (we don't interpret Python). For each label it returns
 * the ordered events (scene/show/hide/say/narrator/note) and the outbound
 * options the user can pick from to advance: menu choices, conditional
 * branches, single jump/call, scene-internal fallthrough, or "ending" when
 * nothing leads on.
 *
 * No React, no DB, no rendering — call sites supply rpy_blocks and step
 * through. PathSimulator.tsx wraps this in a Ren'Py-style overlay.
 */

import type { LabelBlock, RawBlock, RpyBlocks } from "../../lib/renpy/blocks";

/**
 * Ordered events emitted by walking a label's blocks. The simulator UI
 * advances through them one click/key at a time and renders state
 * (visible characters, current BG) accumulated by show/hide/scene events.
 */
export type SimEvent =
  | { kind: "scene"; bg: string; transition?: string }
  | {
      kind: "show";
      char: string;
      expression?: string;
      position?: string;
    }
  | { kind: "hide"; char: string }
  | {
      kind: "say";
      /** The display name (`char_name`) if known, else the var. */
      speaker: string;
      /** The Ren'Py variable name (e.g. `mc`, `eileen`) — used to resolve
       *  colour from the character lookup at render time. */
      speakerVar: string;
      text: string;
    }
  | { kind: "narrator"; text: string }
  | { kind: "note"; text: string };

export interface SimOption {
  /** Primary text on the button. */
  label: string;
  /** Optional grey hint shown under the label (e.g. "if score > 5"). */
  hint?: string;
  /** Resolved next-label. Null means the option targets a label that doesn't
   *  exist in this project (broken ref) — surfaced disabled in the UI. */
  target: string | null;
  /** Drives visual variant + sort order in the option list. */
  variant: "choice" | "continue" | "conditional" | "fallthrough";
}

export interface SimStep {
  /** The label this step belongs to. Useful for the history breadcrumbs. */
  labelName: string;
  sceneId: string;
  sceneTitle: string;
  /** Walk-order event stream for this label's body. */
  events: SimEvent[];
  /** Outbound options. Empty → terminal label (an ending). */
  options: SimOption[];
  isEnding: boolean;
}

/** Scene + label index built once per simulator session from the source rows. */
export interface SimContext {
  /** label → its full segment blocks (excludes the `label x:` block itself). */
  blocksByLabel: Map<string, RpyBlocks>;
  /** label → scene metadata (id + display title). */
  sceneByLabel: Map<string, { sceneId: string; sceneTitle: string }>;
  /** label → next label in tree-order within the same scene. Drives implicit
   *  fall-through when the current label doesn't terminate with jump/return. */
  fallthroughTarget: Map<string, string>;
  /** First label in tree-order across all scenes — the project's entry point.
   *  Null when the project has no labels at all. */
  entryLabel: string | null;
}

interface InternalSegment {
  name: string;
  sceneId: string;
  sceneTitle: string;
  blocks: RpyBlocks;
}

export interface SimSourceRow {
  id: string;
  kind: "chapter" | "scene" | "block";
  title: string;
  position: number;
  rpy_label: string | null;
  rpy_blocks: RpyBlocks | null;
}

/**
 * Indexes a project's scene rows into the simulator context. Mirrors the
 * segmentation done in graphBuild — keeps the two engines consistent on
 * what counts as a label segment without sharing a private helper.
 */
export function buildSimContext(rows: SimSourceRow[]): SimContext {
  const segments: InternalSegment[] = [];
  const labelToSegment = new Map<string, InternalSegment>();
  const sceneScopedNextOf = new Map<string, string>();

  const scenes = rows
    .filter((r) => r.kind === "scene")
    .sort((a, b) => a.position - b.position);

  for (const scene of scenes) {
    const blocks = scene.rpy_blocks ?? [];
    const labelIdx: number[] = [];
    blocks.forEach((b, i) => {
      if (b.kind === "label") labelIdx.push(i);
    });

    const sceneSegs: InternalSegment[] = [];
    if (labelIdx.length === 0) {
      if (!scene.rpy_label) continue;
      sceneSegs.push({
        name: scene.rpy_label,
        sceneId: scene.id,
        sceneTitle: scene.title,
        blocks,
      });
    } else {
      for (let i = 0; i < labelIdx.length; i++) {
        const start = labelIdx[i];
        const end = labelIdx[i + 1] ?? blocks.length;
        const lbl = blocks[start] as LabelBlock;
        sceneSegs.push({
          name: lbl.name,
          sceneId: scene.id,
          sceneTitle: scene.title,
          // Exclude the label block itself — not part of the body.
          blocks: blocks.slice(start + 1, end),
        });
      }
    }

    // Dedupe — same policy as graphBuild: first occurrence wins.
    for (let i = 0; i < sceneSegs.length; i++) {
      const seg = sceneSegs[i];
      if (labelToSegment.has(seg.name)) continue;
      segments.push(seg);
      labelToSegment.set(seg.name, seg);
      const next = sceneSegs[i + 1];
      if (next && !labelToSegment.has(next.name)) {
        sceneScopedNextOf.set(seg.name, next.name);
      }
    }
  }

  const blocksByLabel = new Map<string, RpyBlocks>();
  const sceneByLabel = new Map<
    string,
    { sceneId: string; sceneTitle: string }
  >();
  for (const s of segments) {
    blocksByLabel.set(s.name, s.blocks);
    sceneByLabel.set(s.name, {
      sceneId: s.sceneId,
      sceneTitle: s.sceneTitle,
    });
  }

  return {
    blocksByLabel,
    sceneByLabel,
    fallthroughTarget: sceneScopedNextOf,
    entryLabel: segments[0]?.name ?? null,
  };
}

const JUMP_LINE_RE = /^\s*(jump|call)\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/;

/**
 * Produces the SimStep the UI renders for the given label. Walks the
 * label's body in order to collect events AND options. Resolution is
 * deliberately structural — we don't evaluate `if`/`elif` conditions or
 * Python; instead we expose every branch as a button so the author can
 * pick which path to follow. Ren'Py would pick one at runtime.
 */
export function stepLabel(labelName: string, ctx: SimContext): SimStep | null {
  const blocks = ctx.blocksByLabel.get(labelName);
  const scene = ctx.sceneByLabel.get(labelName);
  if (!blocks || !scene) return null;

  const events: SimEvent[] = [];
  const options: SimOption[] = [];
  const knownLabel = (name: string): string | null =>
    ctx.blocksByLabel.has(name) ? name : null;

  // Track whether top-level flow has been "claimed" already by a menu or
  // an unconditional jump — what comes after is effectively dead code in
  // Ren'Py terms, but we still surface conditional branches because they
  // can carry their own jumps.
  let topFlowClaimed = false;

  for (const b of blocks) {
    switch (b.kind) {
      case "scene":
        events.push({ kind: "scene", bg: b.bg, transition: b.transition });
        break;
      case "show":
        events.push({
          kind: "show",
          char: b.char,
          expression: b.expression,
          position: b.position,
        });
        break;
      case "hide":
        events.push({ kind: "hide", char: b.char });
        break;
      case "say":
        events.push({
          kind: "say",
          speaker: b.char_name || b.char_var,
          speakerVar: b.char_var,
          text: b.text,
        });
        break;
      case "narrator":
        events.push({ kind: "narrator", text: b.text });
        break;
      case "note":
        events.push({ kind: "note", text: b.text });
        break;
      case "menu": {
        topFlowClaimed = true;
        break;
      }
      case "choice": {
        const idx = blocks.indexOf(b);
        let outgoing: string | null = null;
        let outgoingKind: "jump" | "call" = "jump";
        for (let j = idx + 1; j < blocks.length; j++) {
          const inner = blocks[j];
          if (inner.depth <= b.depth) break;
          if (inner.kind === "jump" || inner.kind === "call") {
            outgoing = inner.target;
            outgoingKind = inner.kind;
            break;
          }
        }
        options.push({
          label: b.text,
          hint: b.condition
            ? `if ${b.condition}${outgoingKind === "call" ? " · call" : ""}`
            : outgoingKind === "call"
              ? "call"
              : undefined,
          target: outgoing ? knownLabel(outgoing) : null,
          variant: "choice",
        });
        break;
      }
      case "jump":
      case "call": {
        if (b.depth === 1 && !topFlowClaimed) {
          options.push({
            label: b.kind === "call" ? `call ${b.target}` : `→ ${b.target}`,
            target: knownLabel(b.target),
            variant: "continue",
          });
          topFlowClaimed = true;
        }
        break;
      }
      case "raw": {
        const raw = b as RawBlock;
        const head = (raw.head ?? "").trim();
        if (/^(if\s|elif\s|else\b)/.test(head)) {
          const condition = head.replace(/:$/, "").trim();
          for (const line of raw.lines) {
            const m = line.match(JUMP_LINE_RE);
            if (!m) continue;
            const target = m[2];
            options.push({
              label: condition,
              hint: m[1] === "call" ? `call ${target}` : `→ ${target}`,
              target: knownLabel(target),
              variant: "conditional",
            });
          }
        }
        break;
      }
      default:
        break;
    }
  }

  // No explicit outbound at top level → fall through to the next label in
  // the same scene if one exists.
  if (options.length === 0 && !topFlowClaimed) {
    const next = ctx.fallthroughTarget.get(labelName);
    if (next) {
      options.push({
        label: `${next}`,
        hint: "fall-through",
        target: knownLabel(next),
        variant: "fallthrough",
      });
    }
  }

  return {
    labelName,
    sceneId: scene.sceneId,
    sceneTitle: scene.sceneTitle,
    events,
    options,
    isEnding: options.length === 0,
  };
}
