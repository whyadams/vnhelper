import { unescapeRenpyString } from "./escape";
import type { ParseResult, ParseWarning, ParsedString } from "./types";

const TODO_RE = /^\s*#\s*TODO:\s*(.*)$/;
const TRANSLATE_HEADER_RE = /^translate\s+(\S+)\s+strings:\s*$/;
const PATH_COMMENT_RE = /^\s*#\s*(\S+):(\d+)\s*$/;
const OLD_NEW_RE = /^\s*(old|new)\s+"((?:\\.|[^"\\])*)"\s*$/;
const COMMENT_RE = /^\s*#/;
const BLANK_RE = /^\s*$/;

// Detect the target language declared in a Ren'Py translations file.
// Returns null when no `translate <lang> strings:` header is present.
export function detectRenpyLanguage(content: string): string | null {
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const m = raw.match(TRANSLATE_HEADER_RE);
    if (m) return m[1];
  }
  return null;
}

// Parse a Ren'Py translation strings file into structured rows.
export function parseRenpyTranslations(content: string): ParseResult {
  const strings: ParsedString[] = [];
  const warnings: ParseWarning[] = [];

  let groupLabel: string | null = null;
  let language: string | null = null;
  let inBlock = false;

  let pendingPath: string | null = null;
  let pendingLine: number | null = null;
  let pendingOld: string | null = null;

  const lines = content.split(/\r?\n/);

  const resetPartial = () => {
    pendingPath = null;
    pendingLine = null;
    pendingOld = null;
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
      if (pendingPath !== null || pendingOld !== null) {
        warn(lineNum, "incomplete entry before group header", raw);
        resetPartial();
      }
      groupLabel = todoMatch[1].trim();
      inBlock = false;
      continue;
    }

    const headerMatch = raw.match(TRANSLATE_HEADER_RE);
    if (headerMatch) {
      if (pendingPath !== null || pendingOld !== null) {
        warn(lineNum, "incomplete entry before translate header", raw);
        resetPartial();
      }
      language = headerMatch[1];
      inBlock = true;
      continue;
    }

    if (!inBlock) {
      if (COMMENT_RE.test(raw)) continue;
      warn(lineNum, "unexpected line outside translate block", raw);
      continue;
    }

    const pathMatch = raw.match(PATH_COMMENT_RE);
    if (pathMatch) {
      if (pendingOld !== null) {
        warn(lineNum, "new path comment before previous entry's `new`", raw);
        resetPartial();
      }
      pendingPath = pathMatch[1];
      pendingLine = Number.parseInt(pathMatch[2], 10);
      continue;
    }

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
        if (pendingPath === null || pendingOld === null || pendingLine === null) {
          warn(lineNum, "`new` without matching `old`", raw);
          resetPartial();
          continue;
        }
        if (language === null) {
          warn(lineNum, "`new` outside any language block", raw);
          resetPartial();
          continue;
        }
        strings.push({
          groupLabel,
          targetLanguage: language,
          sourcePath: pendingPath,
          sourceLine: pendingLine,
          sourceText: pendingOld,
          translatedText: value,
        });
        resetPartial();
      }
      continue;
    }

    warn(lineNum, "unrecognized line in translate block", raw);
  }

  if (pendingPath !== null || pendingOld !== null) {
    warn(lines.length, "file ended mid-entry", "");
    resetPartial();
  }

  return { strings, warnings };
}
