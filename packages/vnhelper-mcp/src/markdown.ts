/* ============================================================
   Markdown <-> Tiptap (ProseMirror) JSON conversion.

   Used by MCP write handlers (update_script_node, append_to_scene,
   create_script_node) to populate the `content` jsonb column so the
   editor renders rich text — instead of showing literal markdown
   characters.

   Used by read_script_node to serialize the editor's JSON back to
   markdown for round-trippable AI editing, in case the user edited
   the document manually after the AI last wrote it.

   Scope: covers the StarterKit nodes/marks the Doc-mode editor uses
   (heading, paragraph, hardBreak, horizontalRule, blockquote, lists,
   bold, italic, strike, code). Custom VN nodes (dialogue, direction,
   sceneHeading, choice, choiceOption, bgmMarker, sfxMarker,
   characterMention) are emitted in a best-effort textual form when
   serializing back to markdown — so the AI sees something readable
   even if it can't be perfectly reconstructed.
   ============================================================ */

import { marked, type Token, type Tokens } from "marked";

/* ---------- Types ---------- */

export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}

export interface PMDoc extends PMNode {
  type: "doc";
  content: PMNode[];
}

/* ============================================================
   markdown -> Tiptap JSON
   ============================================================ */

const EMPTY_DOC: PMDoc = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export function markdownToTiptapDoc(md: string): PMDoc {
  if (!md || !md.trim()) return EMPTY_DOC;

  // breaks:true → single \n becomes <br> token, which we map to hardBreak.
  // This is critical for VN-style line layouts like:
  //   Тайлер
  //   (не спит.)
  // where each line needs its own visible break, not paragraph
  // collapsing into a single line as plain CommonMark does.
  const tokens = marked.lexer(md, { gfm: true, breaks: true });

  const blocks = tokensToBlocks(tokens);
  if (blocks.length === 0) return EMPTY_DOC;
  return { type: "doc", content: blocks };
}

function tokensToBlocks(tokens: Token[]): PMNode[] {
  const out: PMNode[] = [];
  for (const tok of tokens) {
    const node = blockTokenToNode(tok);
    if (Array.isArray(node)) out.push(...node);
    else if (node) out.push(node);
  }
  return out;
}

function blockTokenToNode(tok: Token): PMNode | PMNode[] | null {
  switch (tok.type) {
    case "space":
      return null;

    case "hr":
      return { type: "horizontalRule" };

    case "heading": {
      const t = tok as Tokens.Heading;
      const level = Math.min(Math.max(t.depth, 1), 6);
      return {
        type: "heading",
        attrs: { level },
        content: inlineTokensToNodes(t.tokens ?? []),
      };
    }

    case "paragraph": {
      const t = tok as Tokens.Paragraph;
      return {
        type: "paragraph",
        content: inlineTokensToNodes(t.tokens ?? []),
      };
    }

    case "blockquote": {
      const t = tok as Tokens.Blockquote;
      const inner = tokensToBlocks(t.tokens ?? []);
      return {
        type: "blockquote",
        content: inner.length ? inner : [{ type: "paragraph" }],
      };
    }

    case "list": {
      const t = tok as Tokens.List;
      const wrapType = t.ordered ? "orderedList" : "bulletList";
      const items: PMNode[] = (t.items ?? []).map((it) => listItemToNode(it));
      const node: PMNode = {
        type: wrapType,
        content: items.length ? items : [defaultListItem()],
      };
      if (t.ordered && typeof t.start === "number" && t.start !== 1) {
        node.attrs = { start: t.start };
      }
      return node;
    }

    case "code": {
      // ``` fenced or 4-space block -> codeBlock
      const t = tok as Tokens.Code;
      const content: PMNode[] = t.text
        ? [{ type: "text", text: t.text }]
        : [];
      const attrs: Record<string, unknown> = {};
      if (t.lang) attrs.language = t.lang;
      const node: PMNode = { type: "codeBlock", content };
      if (Object.keys(attrs).length) node.attrs = attrs;
      return node;
    }

    case "html": {
      // HTML blocks are rare in our flow; preserve as plain paragraph text
      // so the AI can fix it on the next pass.
      const t = tok as Tokens.HTML;
      const text = (t.text ?? "").trim();
      if (!text) return null;
      return {
        type: "paragraph",
        content: [{ type: "text", text }],
      };
    }

    case "table": {
      // Tables aren't part of StarterKit; fall back to a code block so the
      // user at least sees the data.
      const t = tok as Tokens.Table;
      return {
        type: "codeBlock",
        content: [{ type: "text", text: t.raw ?? "" }],
      };
    }

    case "text": {
      // Loose text token at the block level (rare). Wrap as paragraph.
      const t = tok as Tokens.Text;
      const inner = "tokens" in t && t.tokens
        ? inlineTokensToNodes(t.tokens)
        : [{ type: "text", text: t.text ?? "" } as PMNode];
      if (!inner.length) return null;
      return { type: "paragraph", content: inner };
    }

    default:
      return null;
  }
}

function listItemToNode(it: Tokens.ListItem): PMNode {
  const inner = tokensToBlocks(it.tokens ?? []);
  // ProseMirror list items must contain at least one block (paragraph).
  // marked emits inline tokens directly inside list_item.tokens via 'text'
  // tokens; tokensToBlocks handles those. If inner is empty, default to
  // an empty paragraph.
  const content = inner.length ? inner : [{ type: "paragraph" }];
  const node: PMNode = { type: "listItem", content };
  if (it.task) {
    // StarterKit doesn't ship task lists, but we keep the data for the
    // editor's TaskList ext (already in deps).
    node.type = "taskItem";
    node.attrs = { checked: !!it.checked };
  }
  return node;
}

function defaultListItem(): PMNode {
  return { type: "listItem", content: [{ type: "paragraph" }] };
}

/* ---------- Inline tokens ---------- */

function inlineTokensToNodes(tokens: Token[]): PMNode[] {
  return inlineTokensWithMarks(tokens, []);
}

function inlineTokensWithMarks(tokens: Token[], marks: PMMark[]): PMNode[] {
  const out: PMNode[] = [];
  for (const tok of tokens) {
    const nodes = inlineTokenToNodes(tok, marks);
    for (const n of nodes) out.push(n);
  }
  return out;
}

function inlineTokenToNodes(tok: Token, marks: PMMark[]): PMNode[] {
  switch (tok.type) {
    case "text": {
      const t = tok as Tokens.Text;
      // text tokens may have nested tokens (mixed content), or plain text
      if ("tokens" in t && Array.isArray(t.tokens) && t.tokens.length) {
        return inlineTokensWithMarks(t.tokens, marks);
      }
      const text = t.text ?? "";
      if (!text) return [];
      return [makeTextNode(decodeEntities(text), marks)];
    }

    case "escape": {
      const t = tok as Tokens.Escape;
      return [makeTextNode(t.text ?? "", marks)];
    }

    case "strong": {
      const t = tok as Tokens.Strong;
      return inlineTokensWithMarks(t.tokens ?? [], addMark(marks, "bold"));
    }

    case "em": {
      const t = tok as Tokens.Em;
      return inlineTokensWithMarks(t.tokens ?? [], addMark(marks, "italic"));
    }

    case "del": {
      const t = tok as Tokens.Del;
      return inlineTokensWithMarks(t.tokens ?? [], addMark(marks, "strike"));
    }

    case "codespan": {
      const t = tok as Tokens.Codespan;
      const text = decodeEntities(t.text ?? "");
      if (!text) return [];
      return [makeTextNode(text, addMark(marks, "code"))];
    }

    case "br":
      return [{ type: "hardBreak" }];

    case "link": {
      // StarterKit doesn't ship the Link mark by default in this project,
      // but we'll add it as a mark if the editor adds the extension later.
      // For now, fall back to "[label](url)" plain text so info isn't lost.
      const t = tok as Tokens.Link;
      const inner = inlineTokensWithMarks(t.tokens ?? [], marks);
      const labelText = inner.map((n) => n.text ?? "").join("");
      const href = t.href ?? "";
      const fallback = href && labelText !== href
        ? `${labelText} (${href})`
        : labelText || href;
      return fallback ? [makeTextNode(fallback, marks)] : [];
    }

    case "image": {
      const t = tok as Tokens.Image;
      const alt = t.text ?? "";
      const href = t.href ?? "";
      const text = alt && href ? `[${alt}](${href})` : alt || href;
      return text ? [makeTextNode(text, marks)] : [];
    }

    case "html": {
      const t = tok as Tokens.HTML;
      const text = decodeEntities(t.text ?? "");
      return text ? [makeTextNode(text, marks)] : [];
    }

    default: {
      // Unknown inline token — try to extract any visible text safely.
      const anyTok = tok as { text?: string; raw?: string };
      const text = anyTok.text ?? anyTok.raw ?? "";
      return text ? [makeTextNode(text, marks)] : [];
    }
  }
}

function makeTextNode(text: string, marks: PMMark[]): PMNode {
  const node: PMNode = { type: "text", text };
  if (marks.length) node.marks = marks.map((m) => ({ ...m }));
  return node;
}

function addMark(existing: PMMark[], type: string): PMMark[] {
  if (existing.some((m) => m.type === type)) return existing;
  return [...existing, { type }];
}

function decodeEntities(s: string): string {
  // marked encodes a few HTML entities. Decode the common ones so the
  // editor's JSON has plain unicode.
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/* ============================================================
   Tiptap JSON -> markdown (best-effort, for AI round-trips)
   ============================================================ */

export function tiptapDocToMarkdown(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const root = doc as PMNode;
  if (root.type !== "doc" || !Array.isArray(root.content)) return "";
  const parts: string[] = [];
  for (const block of root.content) {
    const md = blockNodeToMarkdown(block).trimEnd();
    if (md.length) parts.push(md);
  }
  return parts.join("\n\n").trim();
}

function blockNodeToMarkdown(node: PMNode): string {
  switch (node.type) {
    case "paragraph":
      return inlineToMarkdown(node.content ?? []);

    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return `${"#".repeat(level)} ${inlineToMarkdown(node.content ?? [])}`;
    }

    case "horizontalRule":
      return "---";

    case "hardBreak":
      // hardBreak shouldn't appear at block level, but be safe.
      return "";

    case "blockquote": {
      const inner = (node.content ?? [])
        .map((n) => blockNodeToMarkdown(n))
        .join("\n\n");
      return inner
        .split("\n")
        .map((l) => (l.length ? `> ${l}` : ">"))
        .join("\n");
    }

    case "bulletList":
      return listToMarkdown(node, false);

    case "orderedList":
      return listToMarkdown(node, true);

    case "codeBlock": {
      const lang = (node.attrs?.language as string) ?? "";
      const text = (node.content ?? [])
        .map((n) => n.text ?? "")
        .join("");
      return "```" + lang + "\n" + text + "\n```";
    }

    /* ---- VN custom nodes ---- */

    case "dialogue": {
      const speaker = (node.attrs?.speaker as string) ?? "";
      const body = inlineToMarkdown(node.content ?? []);
      return speaker ? `**${speaker}:** ${body}` : body;
    }

    case "direction": {
      const body = inlineToMarkdown(node.content ?? []);
      return body ? `*${body}*` : "";
    }

    case "sceneHeading": {
      const loc = (node.attrs?.location as string) ?? "";
      const time = (node.attrs?.time as string) ?? "";
      const parts = [loc, time].filter(Boolean).join(" · ");
      return parts ? `## ${parts}` : "##";
    }

    case "choice": {
      const prompt = (node.attrs?.prompt as string) ?? "";
      const opts = (node.content ?? [])
        .map((c) => {
          if (c.type !== "choiceOption") return "";
          const t = inlineToMarkdown(c.content ?? []);
          const target = (c.attrs?.target as string) ?? "";
          return target ? `- ${t} → ${target}` : `- ${t}`;
        })
        .filter(Boolean)
        .join("\n");
      return prompt ? `> Choice: ${prompt}\n${opts}` : opts;
    }

    case "bgmMarker": {
      const track = (node.attrs?.track as string) ?? "";
      return track ? `_♪ ${track}_` : "";
    }

    case "sfxMarker": {
      const sound = (node.attrs?.sound as string) ?? "";
      return sound ? `_🔊 ${sound}_` : "";
    }

    default: {
      // Unknown block: try to walk children, then fall back to text.
      if (Array.isArray(node.content) && node.content.length) {
        return node.content
          .map((c) => blockNodeToMarkdown(c))
          .filter(Boolean)
          .join("\n\n");
      }
      return node.text ?? "";
    }
  }
}

function inlineToMarkdown(nodes: PMNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "hardBreak") {
      // Two trailing spaces + newline is the CommonMark hard-break form
      // — round-trippable through markdownToTiptapDoc().
      out = out.replace(/\s+$/g, "") + "  \n";
      continue;
    }
    if (n.type === "text") {
      out += applyMarks(n.text ?? "", n.marks ?? []);
      continue;
    }
    if (n.type === "characterMention") {
      const name = (n.attrs?.name as string) ?? "";
      out += name ? `@${name}` : "";
      continue;
    }
    // Other inline nodes: walk content if present.
    if (Array.isArray(n.content)) out += inlineToMarkdown(n.content);
  }
  return out;
}

function applyMarks(text: string, marks: PMMark[]): string {
  if (!text) return "";
  let out = text;
  // Apply in stable order — innermost mark first → outermost wraps last.
  const order = ["code", "strike", "italic", "bold"];
  const present = order.filter((t) => marks.some((m) => m.type === t));
  for (const t of present) {
    if (t === "bold") out = `**${out}**`;
    else if (t === "italic") out = `*${out}*`;
    else if (t === "strike") out = `~~${out}~~`;
    else if (t === "code") out = "`" + out + "`";
  }
  return out;
}

function listToMarkdown(node: PMNode, ordered: boolean): string {
  const items = node.content ?? [];
  const start = ordered
    ? Math.max(1, Number(node.attrs?.start ?? 1))
    : 1;
  return items
    .map((it, i) => {
      const marker = ordered ? `${start + i}.` : "-";
      const inner = (it.content ?? [])
        .map((c) => blockNodeToMarkdown(c))
        .join("\n\n");
      // Indent continuation lines so they stay inside the list item.
      const indented = inner
        .split("\n")
        .map((l, idx) => (idx === 0 ? l : "  " + l))
        .join("\n");
      const checkbox =
        it.type === "taskItem"
          ? it.attrs?.checked
            ? "[x] "
            : "[ ] "
          : "";
      return `${marker} ${checkbox}${indented}`;
    })
    .join("\n");
}
