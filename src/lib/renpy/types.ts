export interface ParsedString {
  groupLabel: string | null;
  targetLanguage: string;
  sourcePath: string;
  sourceLine: number;
  sourceText: string;
  translatedText: string;
  /**
   * Ren'Py translate-id for dialog blocks (`translate russian foo_e1d4:`).
   * `null` for entries from strings: blocks. Round-trip required.
   */
  translateId: string | null;
  /**
   * Speaker prefix for dialog lines (e.g. "dg", "dm", or `null` for narrator
   * `""` / strings: blocks). The speaker is preserved on both the source
   * comment and the translated line.
   */
  speaker: string | null;
  /**
   * Trailing Ren'Py modifier after the closing quote, e.g. "with dissolve",
   * "pause 0.5", `id "abc"`. `null` when none. Emitted on both source comment
   * and translated line on serialise. Strings: rows always have null.
   */
  trailing: string | null;
}

export interface ParseWarning {
  line: number;
  message: string;
  raw: string;
}

export interface ParseResult {
  strings: ParsedString[];
  warnings: ParseWarning[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SerializeOptions {}
