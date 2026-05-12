/**
 * Pure inspectors for a single label segment's blocks. Used by the
 * inspector panel to render menu choices with their effects, all outbound
 * flow refs, and any conditional branches.
 *
 * No fetching, no React — just block traversal. Symmetric with graphBuild
 * but at a finer grain: graphBuild only needs the *shape* of refs to draw
 * edges, the inspector needs the *content* (what each choice actually does)
 * so the user can see why a label exists.
 */

import type { RpyBlocks } from "../../lib/renpy/blocks";

export interface ChoiceDetail {
  text: string;
  /** `if`-clause attached to the choice itself, e.g. `condition: "score > 5"`. */
  condition?: string;
  /** `$`-statements inside the choice body — variable assignments, function
   *  calls. The leading `$ ` is stripped, the rest kept verbatim. */
  effects: string[];
  /** First jump/call found inside the choice body — what the choice "does"
   *  to story flow. Undefined for variable-only choices. */
  outgoing?: { kind: "jump" | "call"; target: string };
}

export interface MenuDetail {
  choices: ChoiceDetail[];
}

export interface FlowRef {
  kind: "jump" | "call";
  target: string;
  /** When inside a menu choice — the surrounding choice text. */
  choiceText?: string;
}

export interface ConditionalBranch {
  /** Verbatim head text without the trailing `:`, e.g. `if cook_with_mira == True`. */
  condition: string;
  /** All jump/call targets discovered inside the if-block body. */
  refs: Array<{ kind: "jump" | "call"; target: string }>;
}

export interface LabelDetails {
  menus: MenuDetail[];
  /** Top-level (not inside menu/if) jump/call refs in order of appearance. */
  directRefs: FlowRef[];
  /** if/elif/else blocks whose raw body contains a jump/call. */
  conditionals: ConditionalBranch[];
  /** Raw $-statements at the top level (not inside a choice). Lets the user
   *  see "this label sets these flags" even when there's no menu. */
  topLevelEffects: string[];
}

const JUMP_LINE_RE = /^\s*(jump|call)\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/;

export function parseLabelDetails(blocks: RpyBlocks): LabelDetails {
  const menus: MenuDetail[] = [];
  const directRefs: FlowRef[] = [];
  const conditionals: ConditionalBranch[] = [];
  const topLevelEffects: string[] = [];

  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];

    if (b.kind === "menu") {
      const menuDepth = b.depth;
      const menu: MenuDetail = { choices: [] };
      i++;
      while (i < blocks.length) {
        const cur = blocks[i];
        // We left the menu's territory.
        if (cur.depth <= menuDepth && cur.kind !== "choice") break;

        if (cur.kind === "choice" && cur.depth === menuDepth + 1) {
          const choice: ChoiceDetail = {
            text: cur.text,
            condition: cur.condition,
            effects: [],
            outgoing: undefined,
          };
          // Walk the choice body — everything at depth > choice.depth that
          // follows, stopping at the next same-or-lower depth block.
          let j = i + 1;
          while (j < blocks.length) {
            const inner = blocks[j];
            if (inner.depth <= cur.depth) break;
            if (
              !choice.outgoing &&
              (inner.kind === "jump" || inner.kind === "call")
            ) {
              choice.outgoing = { kind: inner.kind, target: inner.target };
            }
            if (inner.kind === "raw") {
              const eff = extractDollarStatement(inner.head ?? "");
              if (eff) choice.effects.push(eff);
              // Multi-line raw bodies might hide effects on subsequent lines.
              for (const line of inner.lines) {
                const eff2 = extractDollarStatement(line);
                if (eff2) choice.effects.push(eff2);
              }
            }
            j++;
          }
          menu.choices.push(choice);
          i = j;
          continue;
        }
        i++;
      }
      menus.push(menu);
      continue;
    }

    if (b.kind === "jump" || b.kind === "call") {
      directRefs.push({ kind: b.kind, target: b.target });
      i++;
      continue;
    }

    if (b.kind === "raw") {
      const head = (b.head ?? "").trim();
      if (/^(if\s|elif\s|else\b)/.test(head)) {
        const condition = head.replace(/:$/, "").trim();
        const branch: ConditionalBranch = { condition, refs: [] };
        // Scan the raw block's body lines for jump/call statements.
        for (const line of b.lines) {
          const m = line.match(JUMP_LINE_RE);
          if (m) {
            branch.refs.push({
              kind: m[1] as "jump" | "call",
              target: m[2],
            });
          }
        }
        if (branch.refs.length > 0) conditionals.push(branch);
      } else {
        // Plain $-statement at top level.
        const eff = extractDollarStatement(head);
        if (eff) topLevelEffects.push(eff);
      }
      i++;
      continue;
    }

    i++;
  }

  return { menus, directRefs, conditionals, topLevelEffects };
}

/**
 * Returns the body of a `$ <expr>` Python statement, or null if the line
 * isn't one. Handles both `$ var = 1` and the (rarer) `$var = 1` form.
 */
function extractDollarStatement(line: string): string | null {
  const m = line.match(/^\s*\$\s*(.+)$/);
  return m ? m[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Locate a label segment inside a scene's full block list
// ---------------------------------------------------------------------------

/**
 * Mirrors the segmentation done by `graphBuild.extractLabelSegments`. Given a
 * scene's full rpy_blocks and a target label name, returns the slice of
 * blocks that constitute that label's body (excluding the label block itself).
 * Returns null if the label isn't in this scene.
 */
export function findLabelSlice(
  blocks: RpyBlocks,
  labelName: string,
): RpyBlocks | null {
  const labelIdx: number[] = [];
  blocks.forEach((b, i) => {
    if (b.kind === "label") labelIdx.push(i);
  });
  for (let i = 0; i < labelIdx.length; i++) {
    const start = labelIdx[i];
    const lbl = blocks[start];
    if (lbl.kind !== "label") continue;
    if (lbl.name !== labelName) continue;
    const end = labelIdx[i + 1] ?? blocks.length;
    return blocks.slice(start + 1, end);
  }
  return null;
}
