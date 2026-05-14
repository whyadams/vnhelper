/**
 * Ren'Py script parser — line-based, indentation-significant.
 *
 * Scope (parsed structurally):
 *   label NAME:
 *   scene IMG [at POS] [with TX]
 *   show IMG [EXPR…] [at POS] [with TX]
 *   hide IMG [with TX]
 *   menu:
 *   "choice text" [if COND]:
 *   jump LABEL
 *   call LABEL
 *   with TX
 *   pause [N]
 *   "narrator text"
 *   <varname> [EXPR…] "dialogue text"
 *   # comment
 *
 * Anything else (`if/elif/else`, `$ ...`, `python:`, `init python:`, `screen`,
 * `transform`, `style`, `image`, `define`, `play/stop/queue`, `voice`, …) is
 * captured verbatim as a `raw` block: the unrecognised line plus every
 * subsequent line at greater indentation, with the leading whitespace
 * stripped down to the raw block's depth so the serializer can re-emit it
 * 1:1. This bounds the parser surface but keeps round-trip lossless on
 * unsupported constructs.
 *
 * The parser does NOT resolve Ren'Py character variables to project
 * `script_characters` ids. Say-blocks are emitted with `char_id = null` and
 * `char_var = char_name = <raw varname>`. Linkage is performed downstream
 * by the import flow.
 */

import {
  newBlockId,
  type RpyBlock,
  type RawBlock,
  type SayBlock,
  type NarratorBlock,
} from "./blocks";

export interface ParseResult {
  blocks: RpyBlock[];
  warnings: ParseWarning[];
}

export interface ParseWarning {
  line: number; // 1-based
  message: string;
  raw: string;
}

const INDENT_SPACES = 4;

interface MeasuredLine {
  /** Original 1-based line number for diagnostics. */
  lineNumber: number;
  /** Leading whitespace converted to spaces. */
  leading: number;
  /** Indentation in INDENT_SPACES units (Math.floor; non-multiples get a warning). */
  depth: number;
  /** The line with leading whitespace stripped. Trailing whitespace removed. */
  body: string;
  /** True for blank / whitespace-only lines (skipped by the dispatcher). */
  blank: boolean;
}

/** Replace tabs with `INDENT_SPACES` spaces. Idempotent for tab-free input. */
function normalizeLeading(raw: string): string {
  let i = 0;
  let out = "";
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "\t") {
      out += " ".repeat(INDENT_SPACES);
    } else if (ch === " ") {
      out += " ";
    } else {
      break;
    }
    i++;
  }
  return out + raw.slice(i);
}

function measureLine(raw: string, lineNumber: number): MeasuredLine {
  const norm = normalizeLeading(raw);
  const m = /^( *)(.*?)\s*$/.exec(norm)!;
  const leading = m[1].length;
  const body = m[2];
  const blank = body.length === 0;
  return {
    lineNumber,
    leading,
    depth: Math.floor(leading / INDENT_SPACES),
    body,
    blank,
  };
}

// -- Pattern matchers --------------------------------------------------------

function tryLabel(body: string): { name: string } | null {
  const m = /^label\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:\s*$/.exec(body);
  return m ? { name: m[1] } : null;
}

function tryJump(body: string): { target: string } | null {
  const m = /^jump\s+([A-Za-z_]\w*)\s*$/.exec(body);
  return m ? { target: m[1] } : null;
}

function tryCall(body: string): { target: string } | null {
  // `call foo` and `call foo(arg=1)` and `call foo from _label` are all valid
  // — for v1 only the simple form is structured, the rest fall through to raw.
  const m = /^call\s+([A-Za-z_]\w*)\s*$/.exec(body);
  return m ? { target: m[1] } : null;
}

function tryReturn(body: string): { expression?: string } | null {
  // `return` alone (most common) or `return <expr>` — author rarely supplies
  // a value in VN scripts, but Ren'Py allows it (e.g. `return _set_volume(0.5)`).
  // Anything after the keyword is captured verbatim and treated as an opaque
  // expression on round-trip.
  const m = /^return(?:\s+(.+?))?\s*$/.exec(body);
  if (!m) return null;
  return m[1] !== undefined ? { expression: m[1] } : {};
}

function tryWith(body: string): { transition: string } | null {
  const m = /^with\s+(\S+)\s*$/.exec(body);
  return m ? { transition: m[1] } : null;
}

function tryPause(body: string): { duration?: number } | null {
  const m = /^pause(?:\s+([0-9]+(?:\.[0-9]+)?))?\s*$/.exec(body);
  if (!m) return null;
  return m[1] !== undefined ? { duration: parseFloat(m[1]) } : {};
}

function tryMenu(body: string): boolean {
  // Accept a trailing inline comment — `menu:  # walk hint` is still a menu.
  const stripped = body.replace(/\s*#.*$/, "").trimEnd();
  return /^menu\s*:\s*$/.test(stripped);
}

function tryComment(body: string): { text: string } | null {
  if (!body.startsWith("#")) return null;
  return { text: body.slice(1).trimStart() };
}

/**
 * Splits a `show`/`scene`/`hide` argument tail into its components.
 * Input is everything after the leading keyword, e.g.:
 *   `eileen happy at left with dissolve`
 *   `bg room day`
 *   `mc with fade`
 *
 * Returns the image-spec part (first token = base, rest = expression
 * attributes), plus optional `at` and `with` clauses.
 */
function splitImageTail(tail: string): {
  imageSpec: string;
  position?: string;
  transition?: string;
} {
  let rest = tail;
  let transition: string | undefined;
  let position: string | undefined;

  // `with X` is always trailing in well-formed Ren'Py. Strip last.
  const withRe = /\s+with\s+(\S+)\s*$/;
  const wm = withRe.exec(rest);
  if (wm) {
    transition = wm[1];
    rest = rest.slice(0, wm.index);
  }

  // `at <transform expr>` — multi-token, ends at end of (already with-stripped) line.
  const atRe = /\s+at\s+(.+?)\s*$/;
  const am = atRe.exec(rest);
  if (am) {
    position = am[1];
    rest = rest.slice(0, am.index);
  }

  return { imageSpec: rest.trim(), position, transition };
}

function tryScene(
  body: string,
): { bg: string; transition?: string } | null {
  const m = /^scene\s+(.+?)\s*$/.exec(body);
  if (!m) return null;
  const split = splitImageTail(m[1]);
  // `scene` doesn't use `at` in practice — if present, fold it back into bg.
  const bg = split.position
    ? `${split.imageSpec} at ${split.position}`
    : split.imageSpec;
  return { bg, transition: split.transition };
}

function tryShow(
  body: string,
): {
  char: string;
  expression?: string;
  position?: string;
  transition?: string;
} | null {
  const m = /^show\s+(.+?)\s*$/.exec(body);
  if (!m) return null;
  const split = splitImageTail(m[1]);
  const tokens = split.imageSpec.split(/\s+/);
  const char = tokens[0];
  const expression = tokens.slice(1).join(" ") || undefined;
  return {
    char,
    expression,
    position: split.position,
    transition: split.transition,
  };
}

function tryHide(
  body: string,
): { char: string; transition?: string } | null {
  const m = /^hide\s+(.+?)\s*$/.exec(body);
  if (!m) return null;
  const split = splitImageTail(m[1]);
  // `hide` doesn't accept `at`; if present treat as raw.
  if (split.position) return null;
  return { char: split.imageSpec, transition: split.transition };
}

/** Decode the Ren'Py escape subset we care about: `\\"`, `\\\\`, `\\n`. */
function unescapeRpyString(s: string): string {
  return s.replace(/\\(["\\n])/g, (_, c) =>
    c === "n" ? "\n" : c,
  );
}

/**
 * Locate a top-level Ren'Py double-quoted string in `body`. Returns the index
 * range of the opening/closing quotes and the unescaped contents. Handles
 * `\"` and `\\` inside the string. Returns null when no balanced string.
 */
function findQuotedString(body: string): {
  start: number;
  end: number;
  text: string;
} | null {
  const start = body.indexOf('"');
  if (start === -1) return null;
  let i = start + 1;
  let buf = "";
  while (i < body.length) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) {
      buf += body[i] + body[i + 1];
      i += 2;
      continue;
    }
    if (ch === '"') {
      return { start, end: i, text: unescapeRpyString(buf) };
    }
    buf += ch;
    i++;
  }
  return null;
}

/**
 * `"text" [if cond]:` — a menu choice. We distinguish a choice from a
 * narrator by the trailing colon (with optional `if` clause). The body
 * after the choice header lives at greater indentation; consumed by the
 * outer dispatcher, not here.
 */
function tryChoice(
  body: string,
): { text: string; condition?: string } | null {
  const q = findQuotedString(body);
  if (!q || q.start !== 0) return null;
  // Everything after the closing quote is post-string — a `#` here is always
  // a Ren'Py comment, never part of the choice header. Strip it before
  // checking for the trailing `:` so `"Flirt": #(romance)` is still detected.
  const tail = body
    .slice(q.end + 1)
    .replace(/\s*#.*$/, "")
    .trim();
  if (!tail.endsWith(":")) return null;
  const beforeColon = tail.slice(0, -1).trim();
  if (beforeColon === "") return { text: q.text };
  const ifMatch = /^if\s+(.+)$/.exec(beforeColon);
  if (!ifMatch) return null;
  return { text: q.text, condition: ifMatch[1].trim() };
}

/**
 * Pure narrator: `"text"` with nothing else (or only a trailing modifier we
 * choose to drop for v1 like `with dissolve` / `id "x"` / `nointeract`).
 */
function tryNarrator(body: string): NarratorBlock | null {
  const q = findQuotedString(body);
  if (!q || q.start !== 0) return null;
  // Reject choice form (handled above) and say form (prefix before quote).
  // Inline comments after the colon are stripped to stay symmetric with
  // tryChoice — `"text": # foo` is a choice, not a narrator line.
  const tail = body
    .slice(q.end + 1)
    .replace(/\s*#.*$/, "")
    .trim();
  if (tail.endsWith(":")) return null;
  return {
    id: newBlockId(),
    kind: "narrator",
    depth: 0,
    text: q.text,
  };
}

/**
 * Reserved Ren'Py statement keywords that look like a valid identifier but
 * MUST NOT be parsed as a say-block speaker. Without this guard, lines like
 * `play music "track.mp3"` would otherwise match the say pattern and be
 * mis-classified as dialogue from a character named `play`.
 *
 * These constructs (audio, control flow, top-level defs, init/screen
 * statements) all fall through to the `raw` block on purpose — they are
 * out of scope for v1 structural editing and should round-trip verbatim.
 */
const RESERVED_STATEMENT_HEADS = new Set([
  // audio
  "play",
  "stop",
  "queue",
  "voice",
  // control flow
  "if",
  "elif",
  "else",
  "while",
  "for",
  "return",
  // definitions
  "define",
  "default",
  "init",
  "python",
  // screens / styling
  "screen",
  "transform",
  "style",
  "image",
  "layeredimage",
  // misc
  "nvl",
  "window",
  "pass",
]);

/**
 * Say: `<varname> [EXPR…] "text" [trailing]`. The prefix tokens before the
 * first quote are the varname plus optional image attributes. Trailing
 * tokens (e.g. `with dissolve`, `id "x"`) are dropped for v1 — they are
 * uncommon and would otherwise force this line into a raw block.
 *
 * Bails when the first token is a reserved Ren'Py statement keyword so
 * audio/control-flow lines fall through to the raw-block capture instead
 * of being read as dialogue.
 */
function trySay(body: string): SayBlock | null {
  const q = findQuotedString(body);
  if (!q || q.start === 0) return null;
  const prefix = body.slice(0, q.start).trim();
  if (!prefix) return null;
  const tokens = prefix.split(/\s+/);
  const charVar = tokens[0];
  if (!/^[A-Za-z_]\w*$/.test(charVar)) return null;
  if (RESERVED_STATEMENT_HEADS.has(charVar)) return null;
  const expression = tokens.slice(1).join(" ") || undefined;
  return {
    id: newBlockId(),
    kind: "say",
    depth: 0,
    char_var: charVar,
    char_id: null,
    char_name: charVar,
    text: q.text,
    expression,
  };
}

// -- Main parser -------------------------------------------------------------

/**
 * Parse a `.rpy` script into structured blocks plus diagnostics.
 *
 * The parser is forgiving: anything it doesn't recognise becomes a `raw`
 * block, and warnings flag positions where the indentation isn't a clean
 * multiple of 4 spaces.
 */
export function parseRpyScript(text: string): ParseResult {
  const blocks: RpyBlock[] = [];
  const warnings: ParseWarning[] = [];

  const rawLines = text.replace(/\r\n/g, "\n").split("\n");
  const measured: MeasuredLine[] = rawLines.map((l, i) =>
    measureLine(l, i + 1),
  );

  // Warn about ragged indentation once per offending line.
  for (const m of measured) {
    if (!m.blank && m.leading % INDENT_SPACES !== 0) {
      warnings.push({
        line: m.lineNumber,
        message: `Indentation is not a multiple of ${INDENT_SPACES} spaces — depth was rounded down.`,
        raw: rawLines[m.lineNumber - 1],
      });
    }
  }

  let i = 0;
  while (i < measured.length) {
    const m = measured[i];
    if (m.blank) {
      i++;
      continue;
    }

    const block = dispatchLine(m);
    if (block) {
      blocks.push(block);
      i++;
      continue;
    }

    // Unrecognised — capture this line + every subsequent more-indented line
    // (skipping blanks, which we re-include verbatim in the raw payload so
    // formatting survives) into a single raw block.
    const raw = captureRawBlock(measured, rawLines, i);
    blocks.push(raw.block);
    i = raw.nextIndex;
  }

  return { blocks, warnings };
}

/** Try every recognised pattern at this measured line. Returns null on miss. */
function dispatchLine(m: MeasuredLine): RpyBlock | null {
  const { body, depth } = m;

  const lab = tryLabel(body);
  if (lab) return { id: newBlockId(), kind: "label", depth, name: lab.name };

  if (tryMenu(body)) {
    return { id: newBlockId(), kind: "menu", depth };
  }

  const choice = tryChoice(body);
  if (choice) {
    return {
      id: newBlockId(),
      kind: "choice",
      depth,
      text: choice.text,
      condition: choice.condition,
    };
  }

  const jp = tryJump(body);
  if (jp) return { id: newBlockId(), kind: "jump", depth, target: jp.target };

  const cl = tryCall(body);
  if (cl) return { id: newBlockId(), kind: "call", depth, target: cl.target };

  const ret = tryReturn(body);
  if (ret) {
    return {
      id: newBlockId(),
      kind: "return",
      depth,
      expression: ret.expression,
    };
  }

  const sc = tryScene(body);
  if (sc) {
    return {
      id: newBlockId(),
      kind: "scene",
      depth,
      bg: sc.bg,
      transition: sc.transition,
    };
  }

  const sh = tryShow(body);
  if (sh) {
    return {
      id: newBlockId(),
      kind: "show",
      depth,
      char: sh.char,
      expression: sh.expression,
      position: sh.position,
      transition: sh.transition,
    };
  }

  const hd = tryHide(body);
  if (hd) {
    return {
      id: newBlockId(),
      kind: "hide",
      depth,
      char: hd.char,
      transition: hd.transition,
    };
  }

  const wt = tryWith(body);
  if (wt) {
    return {
      id: newBlockId(),
      kind: "with",
      depth,
      transition: wt.transition,
    };
  }

  const ps = tryPause(body);
  if (ps) {
    return {
      id: newBlockId(),
      kind: "pause",
      depth,
      duration: ps.duration,
    };
  }

  const cm = tryComment(body);
  if (cm) return { id: newBlockId(), kind: "note", depth, text: cm.text };

  // Quoted-string lines: choice was already tried above. Now say / narrator.
  const say = trySay(body);
  if (say) return { ...say, depth };

  const nar = tryNarrator(body);
  if (nar) return { ...nar, depth };

  return null;
}

/**
 * Build a `raw` block starting at `startIndex`. Captures the start line plus
 * every subsequent line whose depth > startLine.depth (blank lines are kept
 * inside the block to preserve formatting). Each captured raw line has its
 * leading indentation reduced by `startLine.depth * INDENT_SPACES` so the
 * serializer can re-add the block's depth on emit.
 */
/**
 * A raw line "opens" a Python-style indented block only when, after stripping
 * any trailing comment, the line ends with `:` — `if x:`, `init python:`,
 * `screen Y:`, `class Z:`, etc. Everything else (`$ x = 1`, `play music "…"`,
 * `define …`) is single-line and must NOT swallow deeper-indented siblings:
 * a stray paste where the first line happens to be at depth 0 while the rest
 * sit at depth 1 would otherwise cause the parser to gobble the whole file
 * into one giant raw block.
 */
function rawHeadOpensBlock(head: string): boolean {
  // Strip a trailing comment (`if x:  # foo` is still a block opener).
  const withoutComment = head.replace(/\s*#.*$/, "").trimEnd();
  return withoutComment.endsWith(":");
}

function captureRawBlock(
  measured: MeasuredLine[],
  rawLines: string[],
  startIndex: number,
): { block: RawBlock; nextIndex: number } {
  const start = measured[startIndex];
  const baseDepth = start.depth;
  const stripCols = baseDepth * INDENT_SPACES;
  const lines: string[] = [];
  let i = startIndex;

  // Always include the start line, depth-stripped.
  const startLine = stripLeading(rawLines[start.lineNumber - 1], stripCols);
  lines.push(startLine);
  i++;

  // Single-line raw (no `:` at end of head): bail out, leave following lines
  // to the main dispatcher. This is the common case for `$ …`, `play …`,
  // `define …`, and tolerates ragged first-line indentation in pasted input.
  if (!rawHeadOpensBlock(startLine)) {
    return {
      block: {
        id: newBlockId(),
        kind: "raw",
        depth: baseDepth,
        lines,
        head: startLine.trim(),
      },
      nextIndex: i,
    };
  }

  // Block-opener form (`init python:` and friends): greedy capture of every
  // deeper-indented line plus blanks that sit inside the block.
  while (i < measured.length) {
    const cur = measured[i];
    if (cur.blank) {
      let lookahead = i + 1;
      while (lookahead < measured.length && measured[lookahead].blank) {
        lookahead++;
      }
      if (
        lookahead < measured.length &&
        measured[lookahead].depth > baseDepth
      ) {
        for (let j = i; j < lookahead; j++) lines.push("");
        i = lookahead;
        continue;
      }
      break;
    }
    if (cur.depth <= baseDepth) break;
    lines.push(stripLeading(rawLines[cur.lineNumber - 1], stripCols));
    i++;
  }

  return {
    block: {
      id: newBlockId(),
      kind: "raw",
      depth: baseDepth,
      lines,
      head: lines[0]?.trim() ?? "",
    },
    nextIndex: i,
  };
}

/**
 * Remove up to `cols` columns of leading whitespace from `s`, normalising
 * tabs to `INDENT_SPACES` spaces first. Lines indented less than `cols` are
 * trimmed to their non-whitespace content (this should not happen for a
 * well-formed raw block, but we tolerate it).
 */
function stripLeading(s: string, cols: number): string {
  if (cols <= 0) return s;
  const norm = normalizeLeading(s);
  let i = 0;
  while (i < cols && i < norm.length && norm[i] === " ") i++;
  return norm.slice(i);
}
