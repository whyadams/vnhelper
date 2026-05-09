import { escapeRenpyString } from "./escape";
import type { ParsedString, SerializeOptions } from "./types";

const INDENT = "    ";

// Serialize structured rows back to .rpy text. Preserves input order.
export function serializeRenpyTranslations(
  strings: ParsedString[],
  _opts?: SerializeOptions,
): string {
  const out: string[] = [];
  let prevGroup: string | null | undefined = undefined;
  let prevLang: string | null = null;

  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    const groupChanged = prevGroup === undefined || s.groupLabel !== prevGroup;
    const startOfGroup = groupChanged;

    if (groupChanged) {
      if (s.groupLabel !== null) {
        out.push(`# TODO: ${s.groupLabel}`);
        out.push("");
      }
      prevGroup = s.groupLabel;
      prevLang = null;
    }

    if (startOfGroup || s.targetLanguage !== prevLang) {
      out.push(`translate ${s.targetLanguage} strings:`);
      out.push("");
      prevLang = s.targetLanguage;
    }

    out.push(`${INDENT}# ${s.sourcePath}:${s.sourceLine}`);
    out.push(`${INDENT}old "${escapeRenpyString(s.sourceText)}"`);
    out.push(`${INDENT}new "${escapeRenpyString(s.translatedText)}"`);
    out.push("");
  }

  return out.join("\n");
}
