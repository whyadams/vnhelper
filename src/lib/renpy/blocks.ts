/**
 * Ren'Py script block model — the structured representation of a `.rpy`
 * scene used by the Renpy-tab editor and the Graph view.
 *
 * Scope is intentionally tight (text-related, frequently-used constructs):
 * label / scene / show / hide / dialogue / narrator / menu+choice /
 * jump / call / with / pause / comments. Everything else (control flow,
 * Python, screens, transforms, audio cues, define/default, …) is preserved
 * losslessly as a `raw` block — kept as the original text, surfaced to the
 * editor as a read-only multiline code box, written back on serialise byte-
 * for-byte. This bounds the parser without losing data on round-trip.
 *
 * Each scene-kind `script_node` will own one array of these blocks under
 * `script_nodes.rpy_blocks jsonb`.
 */

/** All block kinds supported by the structured editor. */
export type RpyBlockKind =
  | "label"
  | "scene"
  | "show"
  | "hide"
  | "say"
  | "narrator"
  | "menu"
  | "choice"
  | "jump"
  | "call"
  | "return"
  | "with"
  | "pause"
  | "note"
  | "raw";

/**
 * Indentation level. 0 = top-level (a `label` always sits at 0). Most blocks
 * inside a label are 1. `choice` is one deeper than its enclosing `menu`,
 * blocks inside a choice are one deeper still. The serializer multiplies
 * `depth` by the indent unit (4 spaces) to render valid Ren'Py.
 *
 * Editor enforces valid depth ranges per kind:
 *   label   → exactly 0
 *   menu    → 1..N (always under a label)
 *   choice  → exactly menu.depth + 1
 *   others  → 1..N
 */
export type Depth = number;

/** Stable id for React keys + drag/drop. Generated client-side. */
export interface BlockBase {
  id: string;
  depth: Depth;
}

// -- Concrete block shapes ---------------------------------------------------

/** `label name:` — scene/sub-scene boundary; jump/call targets reference this. */
export interface LabelBlock extends BlockBase {
  kind: "label";
  /** The Ren'Py label name. Must be unique within a project. */
  name: string;
}

/** `scene <bg> [with <transition>]` — sets the background image. */
export interface SceneBlock extends BlockBase {
  kind: "scene";
  /** Image tag, e.g. `bar_counter`, `bg room day`. Free-text with autocomplete. */
  bg: string;
  /** Optional transition name, e.g. `dissolve`, `fade`. */
  transition?: string;
}

/** `show <char> <expression> [at <position>] [with <transition>]`. */
export interface ShowBlock extends BlockBase {
  kind: "show";
  /** Character image tag (typically the character's `rpy_var`). */
  char: string;
  /** Expression / pose modifier, e.g. `happy`, `angry blush`. */
  expression?: string;
  /** Position, e.g. `left`, `right`, `center`, custom transform. */
  position?: string;
  transition?: string;
}

/** `hide <char> [with <transition>]`. */
export interface HideBlock extends BlockBase {
  kind: "hide";
  char: string;
  transition?: string;
}

/**
 * `<char> "<text>"` — character dialogue. `expression` becomes a Ren'Py
 * "say with image attributes" prefix: `mc happy "Hi"`.
 *
 * Two-tier character reference, by design:
 *   - `char_var` — the Ren'Py variable name (e.g. `mc`, `eileen`). Always
 *     present. This is what the serializer writes verbatim into `.rpy`.
 *   - `char_id`  — FK to `script_characters.id`. Null when the block came
 *     from a raw import and the var hasn't been matched to a project
 *     character yet. Editor surfaces unlinked say-blocks with a "link
 *     character" affordance.
 *   - `char_name` — display-name cache for the editor (falls back to
 *     `char_var` when `char_id` is null). Re-synced when the character is
 *     renamed.
 *
 * On serialise we always emit `char_var`. On rendering inside the editor
 * we prefer `char_name`. This split lets imports be lossless even before
 * the user has built up a Cast.
 */
export interface SayBlock extends BlockBase {
  kind: "say";
  char_var: string;
  char_id: string | null;
  char_name: string;
  text: string;
  expression?: string;
}

/** `"<text>"` — narrator / no-speaker dialogue. */
export interface NarratorBlock extends BlockBase {
  kind: "narrator";
  text: string;
}

/** `menu:` — opens a choice block. Owns subsequent `choice` blocks at depth+1. */
export interface MenuBlock extends BlockBase {
  kind: "menu";
}

/**
 * `"<choice text>" [if <condition>]:` — a menu option. Body lives in the
 * blocks immediately after this one whose `depth > choice.depth`, until the
 * next `choice` at the same depth or a block at lower depth.
 */
export interface ChoiceBlock extends BlockBase {
  kind: "choice";
  text: string;
  /** Optional condition expression, kept verbatim. Empty / omitted = always available. */
  condition?: string;
}

/** `jump <label>` — flow control. Target should match a `label` somewhere. */
export interface JumpBlock extends BlockBase {
  kind: "jump";
  target: string;
}

/** `call <label>` — like jump, but returns. */
export interface CallBlock extends BlockBase {
  kind: "call";
  target: string;
}

/** Standalone `with <transition>` line (rare but valid). */
export interface WithBlock extends BlockBase {
  kind: "with";
  transition: string;
}

/** `pause [<duration>]`. */
export interface PauseBlock extends BlockBase {
  kind: "pause";
  /** Seconds; omitted → indefinite (until click). */
  duration?: number;
}

/**
 * `return` — terminates the current label. If we arrived here via `call`,
 * Ren'Py pops the call stack and resumes after the `call` statement. Without
 * a callsite, `return` ends the game (or main menu). The graph view uses the
 * presence of `return` to flag a label as a subroutine (callable + comes back).
 */
export interface ReturnBlock extends BlockBase {
  kind: "return";
  /** Optional return expression (`return value`). Most VN scripts never use it. */
  expression?: string;
}

/**
 * `# comment` — author note that is preserved in the `.rpy` output as a
 * comment but never rendered in-game. Doubles as the migration target for
 * the legacy `direction` blocks (stage directions).
 */
export interface NoteBlock extends BlockBase {
  kind: "note";
  text: string;
}

/**
 * Escape hatch for any Ren'Py construct outside the structured set —
 * `if`/`elif`/`else`, `$ ...`, `python:`, `init python:`, `screen`,
 * `transform`, `style`, `image`, `play`/`stop`/`queue`, `define`, etc.
 *
 * The parser captures the original lines (with their relative indentation
 * preserved) so the serializer can emit them unchanged at `depth`. Editor
 * surfaces this as a read-only monospace block; users who need to edit it
 * do so as raw text, then re-parse.
 */
export interface RawBlock extends BlockBase {
  kind: "raw";
  /** Original lines, indentation-stripped down to `depth`. Joined with `\n`. */
  lines: string[];
  /** First-line head used as a label in the editor (e.g. `if score > 5:`). */
  head: string;
}

// -- Discriminated union -----------------------------------------------------

export type RpyBlock =
  | LabelBlock
  | SceneBlock
  | ShowBlock
  | HideBlock
  | SayBlock
  | NarratorBlock
  | MenuBlock
  | ChoiceBlock
  | JumpBlock
  | CallBlock
  | ReturnBlock
  | WithBlock
  | PauseBlock
  | NoteBlock
  | RawBlock;

/** A scene's full Renpy-tab document. */
export type RpyBlocks = RpyBlock[];

// -- Helpers -----------------------------------------------------------------

/** Indent unit used by the serializer. 4 spaces matches Ren'Py community style. */
export const INDENT_UNIT = "    ";

/** Stable client-side id generator. */
export function newBlockId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    })
  );
}

/** Type guard for narrowing `RpyBlock` by kind. */
export function isBlock<K extends RpyBlockKind>(
  b: RpyBlock,
  kind: K,
): b is Extract<RpyBlock, { kind: K }> {
  return b.kind === kind;
}

/**
 * All outbound flow references from a block list — labels this scene jumps
 * to, calls into, or branches into via menu choices. Used by the Graph view
 * to derive edges from `rpy_blocks` without parsing free text.
 */
export interface OutboundRef {
  kind: "jump" | "call";
  target: string;
  /** Index in the source block array — for click-to-locate in the editor. */
  fromBlockIndex: number;
  /** When inside a menu, the surrounding choice text (for edge labels). */
  choiceText?: string;
}

export function collectOutboundRefs(blocks: RpyBlocks): OutboundRef[] {
  const out: OutboundRef[] = [];
  let currentChoice: string | undefined;
  let menuDepth: number | null = null;

  blocks.forEach((b, i) => {
    if (b.kind === "menu") {
      menuDepth = b.depth;
      currentChoice = undefined;
      return;
    }
    if (menuDepth !== null && b.depth <= menuDepth && b.kind !== "choice") {
      // Walked out of the menu.
      menuDepth = null;
      currentChoice = undefined;
    }
    if (b.kind === "choice") {
      currentChoice = b.text;
      return;
    }
    if (b.kind === "jump" || b.kind === "call") {
      out.push({
        kind: b.kind,
        target: b.target,
        fromBlockIndex: i,
        choiceText: currentChoice,
      });
    }
  });

  return out;
}
