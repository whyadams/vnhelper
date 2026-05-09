import { escapeRenpyString } from "./escape";
import type { ParsedString, SerializeOptions } from "./types";

const INDENT = "    ";

/**
 * Serialize structured rows back to .rpy text. Preserves input order.
 *
 * Two block kinds round-trip:
 *  - strings: blocks (`translate <lang> strings:` with indented `old/new`)
 *  - dialog blocks (`translate <lang> <id>:` with indented source-comment
 *    + translated line). Dialog rows carry `translateId` and `speaker`.
 *
 * Adjacent rows of the same kind/group/language are merged under a single
 * header (for strings: blocks). Dialog blocks always emit their own header
 * because each one is identified by a unique `translateId`.
 */
export function serializeRenpyTranslations(
  strings: ParsedString[],
  _opts?: SerializeOptions,
): string {
  const out: string[] = [];
  let prevGroup: string | null | undefined = undefined;
  let prevLang: string | null = null;
  let prevKind: "strings" | "dialog" | null = null;

  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    const kind: "strings" | "dialog" = s.translateId === null ? "strings" : "dialog";
    const groupChanged = prevGroup === undefined || s.groupLabel !== prevGroup;

    if (groupChanged) {
      if (s.groupLabel !== null) {
        out.push(`# TODO: ${s.groupLabel}`);
        out.push("");
      }
      prevGroup = s.groupLabel;
      prevLang = null;
      prevKind = null;
    }

    if (kind === "strings") {
      // Reuse the surrounding `translate <lang> strings:` header when we're
      // already under one for the same language.
      const needHeader =
        prevKind !== "strings" || s.targetLanguage !== prevLang;
      if (needHeader) {
        out.push(`translate ${s.targetLanguage} strings:`);
        out.push("");
        prevLang = s.targetLanguage;
        prevKind = "strings";
      }
      out.push(`${INDENT}# ${s.sourcePath}:${s.sourceLine}`);
      out.push(`${INDENT}old "${escapeRenpyString(s.sourceText)}"`);
      out.push(`${INDENT}new "${escapeRenpyString(s.translatedText)}"`);
      out.push("");
    } else {
      // Dialog block. Path comment goes BEFORE the header (Ren'Py format).
      if (prevKind !== null) {
        // Separate from previous block with a blank line for readability.
        // (Consecutive dialog blocks already get blank lines below.)
      }
      out.push(`# ${s.sourcePath}:${s.sourceLine}`);
      out.push(`translate ${s.targetLanguage} ${s.translateId}:`);
      out.push("");
      const sp = s.speaker ? `${s.speaker} ` : "";
      out.push(`${INDENT}# ${sp}"${escapeRenpyString(s.sourceText)}"`);
      out.push(`${INDENT}${sp}"${escapeRenpyString(s.translatedText)}"`);
      out.push("");
      prevLang = s.targetLanguage;
      prevKind = "dialog";
    }
  }

  return out.join("\n");
}
