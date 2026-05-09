import { unescapeRenpyString } from "./escape";
import type { ParseResult, ParseWarning, ParsedString } from "./types";

const TODO_RE = /^\s*#\s*TODO:\s*(.*)$/;
// `translate <lang> strings:` — UI strings block (old/new pairs).
const TRANSLATE_STRINGS_HEADER_RE = /^translate\s+(\S+)\s+strings:\s*$/;
// `translate <lang> <id>:` — dialog block (one source comment + one
// translated line each, indexed by Ren'Py-generated <id>).
const TRANSLATE_DIALOG_HEADER_RE = /^translate\s+(\S+)\s+(\S+):\s*$/;
const PATH_COMMENT_RE = /^\s*#\s*(\S+):(\d+)\s*$/;
const OLD_NEW_RE = /^\s*(old|new)\s+"((?:\\.|[^"\\])*)"\s*$/;
// Optional speaker token, then a quoted string, then an optional trailing
// modifier (`with dissolve`, `pause 0.5`, `id "label"`, etc.) that Ren'Py
// allows after the dialogue text. Trailing is captured so we can round-trip
// it on export. Examples:
//   dg "Hmm..."                              (speaker = "dg")
//   "Just a thought"                         (speaker = null, narrator)
//   "Bella" "Hi"                             (speaker = '"Bella"', rare)
//   mr "Phew." with dissolve                 (trailing = "with dissolve")
//   ol "Hi" with dissolve id "ol_001"        (trailing = "with dissolve id \"ol_001\"")
const DIALOG_LINE_RE =
  /^\s*(?:((?:"(?:\\.|[^"\\])*"|\S+))\s+)?"((?:\\.|[^"\\])*)"(?:\s+(\S.*?))?\s*$/;
// Same shape but commented out — that's the source line in a dialog block.
const DIALOG_COMMENT_RE =
  /^\s*#\s*(?:((?:"(?:\\.|[^"\\])*"|\S+))\s+)?"((?:\\.|[^"\\])*)"(?:\s+(\S.*?))?\s*$/;
const COMMENT_RE = /^\s*#/;
const BLANK_RE = /^\s*$/;

// Detect the target language declared in a Ren'Py translations file.
// Looks at both strings: and dialog headers; returns null if neither found.
export function detectRenpyLanguage(content: string): string | null {
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const m =
      raw.match(TRANSLATE_STRINGS_HEADER_RE) ??
      raw.match(TRANSLATE_DIALOG_HEADER_RE);
    if (m) return m[1];
  }
  return null;
}

type Mode = "none" | "strings" | "dialog";

// Parse a Ren'Py translation strings file into structured rows.
// Handles both `translate <lang> strings:` (old/new pairs) and
// `translate <lang> <id>:` (single dialog line per block).
export function parseRenpyTranslations(content: string): ParseResult {
  const strings: ParsedString[] = [];
  const warnings: ParseWarning[] = [];

  let groupLabel: string | null = null;
  let language: string | null = null;
  let mode: Mode = "none";

  // Strings-block state.
  let pendingPath: string | null = null;
  let pendingLine: number | null = null;
  let pendingOld: string | null = null;

  // Dialog-block state.
  let dialogId: string | null = null;
  let dialogSpeaker: string | null = null;
  let dialogSource: string | null = null;
  let dialogTrailing: string | null = null;
  let dialogPath: string | null = null;
  let dialogLine: number | null = null;
  let dialogSawSource = false;

  const lines = content.split(/\r?\n/);

  const resetStrings = () => {
    pendingPath = null;
    pendingLine = null;
    pendingOld = null;
  };
  const resetDialog = () => {
    dialogId = null;
    dialogSpeaker = null;
    dialogSource = null;
    dialogTrailing = null;
    dialogPath = null;
    dialogLine = null;
    dialogSawSource = false;
  };

  const warn = (line: number, message: string, raw: string) => {
    warnings.push({ line, message, raw });
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const lineNum = idx + 1;

    if (BLANK_RE.test(raw)) continue;

    const todoMatch = raw.match(TODO_RE);
    if (todoMatch) {
      if (pendingPath !== null || pendingOld !== null || dialogId !== null) {
        warn(lineNum, "incomplete entry before group header", raw);
        resetStrings();
        resetDialog();
      }
      groupLabel = todoMatch[1].trim();
      mode = "none";
      continue;
    }

    // Strings header: `translate russian strings:`
    const stringsHeader = raw.match(TRANSLATE_STRINGS_HEADER_RE);
    if (stringsHeader) {
      if (pendingPath !== null || pendingOld !== null || dialogId !== null) {
        warn(lineNum, "incomplete entry before strings header", raw);
        resetStrings();
        resetDialog();
      }
      language = stringsHeader[1];
      mode = "strings";
      continue;
    }

    // Dialog header: `translate russian detective_eb96d781:`
    // (Must be tested AFTER the strings header so we don't catch "strings".)
    const dialogHeader = raw.match(TRANSLATE_DIALOG_HEADER_RE);
    if (dialogHeader && dialogHeader[2] !== "strings") {
      if (pendingOld !== null) {
        warn(lineNum, "incomplete strings entry before dialog header", raw);
        resetStrings();
      }
      if (dialogId !== null) {
        warn(lineNum, "incomplete dialog entry before next header", raw);
      }
      // Carry over the path comment that was emitted just before this header.
      const carryPath = pendingPath;
      const carryLine = pendingLine;
      resetDialog();
      language = dialogHeader[1];
      dialogId = dialogHeader[2];
      dialogPath = carryPath;
      dialogLine = carryLine;
      // pendingPath belongs to the dialog block now; clear it so it's not
      // also consumed by a later strings entry.
      pendingPath = null;
      pendingLine = null;
      mode = "dialog";
      continue;
    }

    // Path comment `# game/foo.rpy:42` — works in any mode (strings keeps
    // it for the next old/new, dialog keeps it for itself).
    const pathMatch = raw.match(PATH_COMMENT_RE);
    if (pathMatch) {
      pendingPath = pathMatch[1];
      pendingLine = Number.parseInt(pathMatch[2], 10);
      continue;
    }

    if (mode === "none") {
      if (COMMENT_RE.test(raw)) continue;
      warn(lineNum, "unexpected line outside translate block", raw);
      continue;
    }

    if (mode === "strings") {
      if (COMMENT_RE.test(raw)) continue;
      const onMatch = raw.match(OLD_NEW_RE);
      if (onMatch) {
        const kind = onMatch[1];
        const value = unescapeRenpyString(onMatch[2]);
        if (kind === "old") {
          if (pendingPath === null) {
            warn(lineNum, "`old` without preceding path comment", raw);
            continue;
          }
          if (pendingOld !== null) {
            warn(lineNum, "duplicate `old` before `new`", raw);
          }
          pendingOld = value;
        } else {
          if (
            pendingPath === null ||
            pendingOld === null ||
            pendingLine === null
          ) {
            warn(lineNum, "`new` without matching `old`", raw);
            resetStrings();
            continue;
          }
          if (language === null) {
            warn(lineNum, "`new` outside any language block", raw);
            resetStrings();
            continue;
          }
          strings.push({
            groupLabel,
            targetLanguage: language,
            sourcePath: pendingPath,
            sourceLine: pendingLine,
            sourceText: pendingOld,
            translatedText: value,
            translateId: null,
            speaker: null,
            trailing: null,
          });
          resetStrings();
        }
        continue;
      }
      warn(lineNum, "unrecognized line in strings block", raw);
      continue;
    }

    // mode === "dialog"
    // First non-blank inside a dialog block is the source comment
    // (`# dg "Hmm..."`), then the translated line (`dg "Хмм..."`).
    if (!dialogSawSource) {
      const cm = raw.match(DIALOG_COMMENT_RE);
      if (cm) {
        dialogSpeaker = cm[1] ?? null;
        dialogSource = unescapeRenpyString(cm[2]);
        dialogTrailing = cm[3] ?? null;
        dialogSawSource = true;
        continue;
      }
      // A bare path comment was already handled above; any other comment
      // we skip until we find the dialog source comment.
      if (COMMENT_RE.test(raw)) continue;
      warn(lineNum, "expected source-comment line in dialog block", raw);
      continue;
    }

    // Already saw `# <speaker?> "<source>"` — this should be the translation.
    const tm = raw.match(DIALOG_LINE_RE);
    if (tm) {
      const trSpeaker = tm[1] ?? null;
      const trText = unescapeRenpyString(tm[2]);
      const trTrailing = tm[3] ?? null;
      if (
        dialogSpeaker !== null &&
        trSpeaker !== null &&
        dialogSpeaker !== trSpeaker
      ) {
        warn(
          lineNum,
          `speaker mismatch: source uses ${dialogSpeaker}, translation uses ${trSpeaker}`,
          raw,
        );
      }
      if (language === null || dialogId === null) {
        warn(lineNum, "dialog translation without surrounding header", raw);
        resetDialog();
        continue;
      }
      strings.push({
        groupLabel,
        targetLanguage: language,
        sourcePath: dialogPath ?? "",
        sourceLine: dialogLine ?? 0,
        sourceText: dialogSource ?? "",
        translatedText: trText,
        translateId: dialogId,
        speaker: trSpeaker ?? dialogSpeaker,
        // Prefer the translation's trailing modifier; fall back to source
        // (translators usually copy it verbatim, occasionally drop it).
        trailing: trTrailing ?? dialogTrailing,
      });
      resetDialog();
      // After one dialog entry the block is over until the next header.
      mode = "none";
      continue;
    }
    if (COMMENT_RE.test(raw)) continue;
    warn(lineNum, "expected translation line in dialog block", raw);
  }

  if (pendingPath !== null || pendingOld !== null || dialogId !== null) {
    warn(lines.length, "file ended mid-entry", "");
    resetStrings();
    resetDialog();
  }

  return { strings, warnings };
}
