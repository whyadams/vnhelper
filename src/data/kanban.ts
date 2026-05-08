export type TagColor =
  | "pink"
  | "green"
  | "amber"
  | "violet"
  | "sky"
  | "rose"
  | "teal";

export type BrandKey =
  | "zendesk"
  | "dropbox"
  | "loom"
  | "todoist"
  | "airtable"
  | "stripe"
  | "linear"
  | "notion";

/**
 * Column identifier. Originally a 4-value union; now any string so users
 * can add custom columns. The 4 default keys (todo/progress/review/done)
 * still get themed CSS via `.col-head.<key>`; custom columns fall back
 * to a neutral dot.
 */
export type ColumnKey = string;

export interface CardTag {
  label: string;
  color: TagColor;
}

export interface CardMeta {
  files?: number;
  links?: number;
  comments?: number;
}

export interface CardAssignee {
  user_id: string;
  name: string | null;
  email: string | null;
}

export type CardPriority = "low" | "medium" | "high" | "urgent";

export interface CardData {
  id: string;
  brand: BrandKey;
  brandFallback?: string;
  title: string;
  subtitle: string;
  tags: CardTag[];
  meta: CardMeta;
  assignees: CardAssignee[];
  date: string;
  description?: string;
  priority?: CardPriority | null;
  /** DB sync metadata — not used by UI components. */
  position?: number;
  columnId?: string;
}

export interface ColumnData {
  id: string;
  key: ColumnKey;
  title: string;
  cards: CardData[];
}
