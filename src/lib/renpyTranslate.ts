// Parse and generate Ren'Py "translate <lang> strings:" files.
//
// Input format example:
//
//   # TODO: Translation updated at 2025-11-11 16:59
//
//   translate russian strings:
//
//       # game/screens.rpy:177
//       old "THOUGHTS"
//       new "МЫСЛИ"
//
//       # game/screens.rpy:258
//       old "{color=#0B0B0B}…{/color}"
//       new "{color=#0B0B0B}…{/color}"
//
// We treat each `# TODO: …` comment as a *block label* and each subsequent
// `translate <lang> strings:` section is its set of entries (we keep the
// language name from the first such section, but it's also stored on the
// containing file in DB).

export interface ParsedEntry {
  block_label: string | null;
  block_index: number;
  entry_index: number;
  source_file: string | null;
  source_line: number | null;
  old_text: string;
  new_text: string;
}

export interface ParsedFile {
  language: string | null;
  entries: ParsedEntry[];
}

// ---------- Parser ----------

const RE_TODO = /^\s*#\s*TODO[:\s]+(.+?)\s*$/i;
const RE_TRANSLATE = /^\s*translate\s+(\w+)\s+strings\s*:/i;
const RE_SOURCE = /^\s*#\s*([^:#\s]+?\.rpy):(\d+)\s*$/;
const RE_OLD = /^\s*old\s+(.+?)\s*$/;
const RE_NEW = /^\s*new\s+(.+?)\s*$/;

/**
 * Parse a Ren'Py "string" translation file. Tolerant: if there is no TODO
 * header, all entries fall under a single null block.
 */
export function parseRpyTranslation(text: string): ParsedFile {
  const lines = text.split(/\r?\n/);
  const entries: ParsedEntry[] = [];
  let language: string | null = null;

  let blockLabel: string | null = null;
  let blockIndex = -1;
  let entryIndex = 0;

  let pendingSrcFile: string | null = null;
  let pendingSrcLine: number | null = null;
  let pendingOld: string | null = null;

  const beginBlock = (label: string | null) => {
    blockLabel = label;
    blockIndex += 1;
    entryIndex = 0;
  };

  for (const raw of lines) {
    const line = raw;

    // TODO header — start a new block
    const todo = RE_TODO.exec(line);
    if (todo) {
      beginBlock(todo[1]);
      continue;
    }

    // translate <lang> strings: — capture language; if no block yet, open one
    const tr = RE_TRANSLATE.exec(line);
    if (tr) {
      if (!language) language = tr[1].toLowerCase();
      if (blockIndex < 0) beginBlock(null);
      continue;
    }

    // # game/screens.rpy:177  — source location for next entry
    const src = RE_SOURCE.exec(line);
    if (src) {
      pendingSrcFile = src[1];
      pendingSrcLine = parseInt(src[2], 10);
      continue;
    }

    // old "..."
    const o = RE_OLD.exec(line);
    if (o) {
      pendingOld = unquote(o[1]);
      continue;
    }

    // new "..."
    const n = RE_NEW.exec(line);
    if (n) {
      const newText = unquote(n[1]);
      if (pendingOld !== null) {
        if (blockIndex < 0) beginBlock(null);
        entries.push({
          block_label: blockLabel,
          block_index: blockIndex,
          entry_index: entryIndex++,
          source_file: pendingSrcFile,
          source_line: pendingSrcLine,
          old_text: pendingOld,
          new_text: newText,
        });
      }
      pendingSrcFile = null;
      pendingSrcLine = null;
      pendingOld = null;
      continue;
    }
  }

  return { language, entries };
}

// Unquote a Ren'Py string literal: "..." or '...', honoring \" and \\.
function unquote(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length < 2) return trimmed;
  const q = trimmed[0];
  if ((q !== '"' && q !== "'") || trimmed[trimmed.length - 1] !== q) {
    return trimmed;
  }
  const body = trimmed.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\" && i + 1 < body.length) {
      const next = body[i + 1];
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "\\" || next === '"' || next === "'") out += next;
      else out += next;
      i++;
    } else {
      out += c;
    }
  }
  return out;
}

function quote(s: string): string {
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

// ---------- Generator ----------

export interface GenerateInput {
  language: string;
  entries: Array<
    Omit<ParsedEntry, "block_index" | "entry_index"> & {
      block_index: number;
      entry_index: number;
    }
  >;
}

/**
 * Render entries back into a `.rpy` translation file.
 * Groups entries by `block_index`, prefixing each non-null `block_label` with
 * `# TODO: ...` and a `translate <lang> strings:` header per block.
 */
export function generateRpyTranslation(input: GenerateInput): string {
  const sorted = [...input.entries].sort((a, b) => {
    if (a.block_index !== b.block_index) return a.block_index - b.block_index;
    return a.entry_index - b.entry_index;
  });

  // Group by block_index keeping first-seen order
  const blocks: { label: string | null; items: ParsedEntry[] }[] = [];
  let curBlock = -1;
  for (const e of sorted) {
    if (e.block_index !== curBlock) {
      blocks.push({ label: e.block_label, items: [] });
      curBlock = e.block_index;
    }
    blocks[blocks.length - 1].items.push(e as ParsedEntry);
  }

  const lines: string[] = [];
  for (const b of blocks) {
    if (b.label) {
      lines.push(`# ${b.label}`);
      lines.push("");
    }
    lines.push(`translate ${input.language} strings:`);
    lines.push("");
    for (const e of b.items) {
      if (e.source_file && e.source_line) {
        lines.push(`    # ${e.source_file}:${e.source_line}`);
      }
      lines.push(`    old ${quote(e.old_text)}`);
      lines.push(`    new ${quote(e.new_text)}`);
      lines.push("");
    }
  }
  // trim trailing blank lines, keep one final newline
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n") + "\n";
}

// ---------- Re-import merge ----------

export interface ExistingEntry {
  id: string;
  old_text: string;
  new_text: string;
  status: string;
}

export interface MergeResult {
  /** Entries to insert (no `id`). */
  toInsert: ParsedEntry[];
  /** Existing rows whose new_text we want to keep but metadata refresh. */
  toRefresh: Array<{
    id: string;
    block_label: string | null;
    block_index: number;
    entry_index: number;
    source_file: string | null;
    source_line: number | null;
  }>;
  /** Existing rows whose `old_text` is no longer present — mark as orphaned. */
  toOrphan: string[];
}

/**
 * Merge a freshly-parsed file with existing DB rows, preserving translator
 * work. Strategy: match by `old_text` (exact). If found in incoming → refresh
 * metadata. If existing not in incoming → orphan. Incoming with no match →
 * insert empty.
 */
export function mergeTranslationEntries(
  incoming: ParsedEntry[],
  existing: ExistingEntry[],
): MergeResult {
  const existingByOld = new Map<string, ExistingEntry>();
  for (const e of existing) {
    if (!existingByOld.has(e.old_text)) existingByOld.set(e.old_text, e);
  }

  const toInsert: ParsedEntry[] = [];
  const toRefresh: MergeResult["toRefresh"] = [];
  const matchedIds = new Set<string>();

  for (const inc of incoming) {
    const match = existingByOld.get(inc.old_text);
    if (match) {
      matchedIds.add(match.id);
      toRefresh.push({
        id: match.id,
        block_label: inc.block_label,
        block_index: inc.block_index,
        entry_index: inc.entry_index,
        source_file: inc.source_file,
        source_line: inc.source_line,
      });
    } else {
      toInsert.push(inc);
    }
  }

  const toOrphan: string[] = [];
  for (const e of existing) {
    if (!matchedIds.has(e.id) && e.status !== "orphaned") {
      toOrphan.push(e.id);
    }
  }

  return { toInsert, toRefresh, toOrphan };
}
