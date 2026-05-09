export interface ParsedString {
  groupLabel: string | null;
  targetLanguage: string;
  sourcePath: string;
  sourceLine: number;
  sourceText: string;
  translatedText: string;
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
