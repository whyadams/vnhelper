import type { ScriptCharacter, ScriptContent } from "../../state/scripts";

interface BlockNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: BlockNode[];
  text?: string;
}

const SCENE_RE = /^\s*СЦЕНА\s+\d+\s*[.:]/i;
// All-caps short heading ending with colon: "ЛОКАЦИЯ:", "ОБЩИЙ ПЛАН:",
// "ВХОД. ОБЩИЙ ПЛАН:", "ЭМОЦИОНАЛЬНОЕ СОСТОЯНИЕ ТАЙЛЕРА:".
// At most ~8 words, no lowercase letters.
const SECTION_RE = /^[А-ЯЁA-Z][А-ЯЁA-Z0-9\s.,/\\\-—]{0,80}:\s*$/;
// Speaker: a single name (one or two words) ending with colon, all caps.
// "ТАЙЛЕР:", "БЕАТРИС:", "ГЕРМИОНА:", "БАРМЕН:".
const SPEAKER_RE = /^([А-ЯЁA-Z][А-ЯЁA-Z\-]{1,20}(?:\s+[А-ЯЁA-Z][А-ЯЁA-Z\-]{1,20})?):\s*$/;
// Inline speaker prefix ("ТАЙЛЕР: текст") on a single line.
const INLINE_SPEAKER_RE = /^([А-ЯЁA-Z][А-ЯЁA-Z\-]{1,20}(?:\s+[А-ЯЁA-Z][А-ЯЁA-Z\-]{1,20})?):\s+(.+)$/;

// ============================================================
// Ren'Py syntax
// ============================================================
// `scene <id>` / `scene <id> with <transition>` — background directive.
const RENPY_SCENE_RE = /^\s*scene\s+([A-Za-z0-9_]+)(?:\s+with\s+\w+)?\s*$/;
// `label something:` / `menu:` / `if foo:` / `return` — Ren'Py control flow,
// recognized so we don't mis-parse them as direction.
const RENPY_LABEL_RE = /^\s*(label\s+\w+|menu|return|jump\s+\w+|call\s+\w+)\b/;
// `<short> "text"` or `<short> <emotion> "text"`.
// Speaker is lowercase identifier (mc, zr, beatrix_h, …).
const RENPY_DIALOGUE_RE =
  /^\s*([a-z][a-z0-9_]*)(?:\s+([a-z][a-z0-9_]*))?\s+"((?:\\"|[^"])*)"\s*$/;
// `"text"` standalone — narration.
const RENPY_NARRATION_RE = /^\s*"((?:\\"|[^"])*)"\s*$/;
// `# comment`
const RENPY_COMMENT_RE = /^\s*#/;

// Module-level / engine directives we silently drop because they have no
// dramaturgical content and would otherwise pollute the import as direction
// paragraphs.
//
//   define mc = Character(...)        ← character definition
//   default points = 0                ← default vars
//   image bg dorm = "bg/dorm.png"     ← asset binding
//   init: / init python: / python:    ← init blocks
//   transform x: / style x:           ← presentational blocks
//   with dissolve                     ← standalone transition (the `scene X
//                                       with Y` form is handled separately)
//   pause / pause 1.5                 ← timing
//   nvl clear / window show / window hide / window auto
//   play music / stop music / queue music / voice "x.ogg"
//   show beatrix happy / hide beatrix
//   $ python_expr                     ← inline python
const RENPY_NOISE_RE =
  /^\s*(?:(?:define|default|image|init(?:\s+python)?|python|transform|style|with|pause|nvl|window|play|stop|queue|voice|show|hide|camera|layeredimage)\b|\$\s)/;

function isHeadingStart(line: string): boolean {
  return (
    SCENE_RE.test(line) ||
    SECTION_RE.test(line) ||
    SPEAKER_RE.test(line) ||
    RENPY_SCENE_RE.test(line) ||
    RENPY_DIALOGUE_RE.test(line) ||
    RENPY_NARRATION_RE.test(line) ||
    RENPY_LABEL_RE.test(line)
  );
}

function unescapeRenpyText(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}

function textBlock(type: string, text: string, attrs?: Record<string, unknown>): BlockNode {
  return {
    type,
    attrs,
    content: text ? [{ type: "text", text }] : [],
  };
}

/**
 * Parse a plain-text VN script into TipTap blocks.
 *
 * Recognizes:
 *  - "СЦЕНА N: «...»"            → sceneHeading
 *  - "ЛОКАЦИЯ:" / "ОБЩИЙ ПЛАН:"  → sceneHeading (section header)
 *  - "ИМЯ:" alone on a line       → dialogue (next non-empty lines = text)
 *  - "ИМЯ: текст" on one line     → dialogue (text inline)
 *  - everything else              → direction (collapses adjacent lines)
 */
export function parseScriptText(
  text: string,
  characters: ScriptCharacter[] = [],
): ScriptContent {
  const charByName = new Map<string, ScriptCharacter>();
  for (const c of characters) {
    if (c.name) charByName.set(c.name.toUpperCase(), c);
    if (c.short_name) charByName.set(c.short_name.toUpperCase(), c);
    for (const a of c.aliases ?? []) {
      if (a) charByName.set(a.toUpperCase(), c);
    }
  }

  const lookupCharacter = (
    speakerRaw: string,
  ): { speaker: string; shortName: string; color: string } => {
    const norm = speakerRaw.trim().toUpperCase();
    const c = charByName.get(norm);
    if (!c) {
      return { speaker: speakerRaw.trim(), shortName: "", color: "" };
    }
    return {
      speaker: c.name,
      shortName: c.short_name ?? "",
      color: c.color ?? "",
    };
  };

  const blocks: BlockNode[] = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  // Ren'Py `scene hcN` directives don't get their own rows — they attach as
  // the `id` of the next dialogue / direction block. If multiple `scene`
  // directives appear in a row, the latest wins. Cleared once consumed.
  let pendingSceneId: string | null = null;

  const consumeSceneId = (): string => {
    const id = pendingSceneId ?? "";
    pendingSceneId = null;
    return id;
  };

  const pushDirection = (paragraph: string[]) => {
    const joined = paragraph.join(" ").trim();
    if (!joined) return;
    const id = consumeSceneId();
    blocks.push({
      type: "direction",
      attrs: id ? { id } : undefined,
      content: [{ type: "text", text: joined }],
    });
  };

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) {
      i++;
      continue;
    }

    // ----- Ren'Py: comments are silently dropped -----
    if (RENPY_COMMENT_RE.test(line)) {
      i++;
      continue;
    }

    // ----- Ren'Py: control-flow lines (label, menu, jump, return, call)
    //       are dropped — they don't have a meaningful representation in our
    //       block model and would otherwise leak into a direction paragraph.
    if (RENPY_LABEL_RE.test(line)) {
      i++;
      continue;
    }

    // ----- Ren'Py: `scene hc12 with dissolve` -----
    // Checked BEFORE the generic noise filter so that `scene` directives
    // are captured rather than dropped. Instead of producing their own row,
    // the scene id gets attached as the `id` of the next dialogue / direction.
    const renpyScene = RENPY_SCENE_RE.exec(line);
    if (renpyScene) {
      pendingSceneId = renpyScene[1];
      i++;
      continue;
    }

    // ----- Ren'Py: drop module-level / engine directives -----
    if (RENPY_NOISE_RE.test(line)) {
      i++;
      continue;
    }

    // ----- Ren'Py: `mc "text"` / `mc happy "text"` -----
    const renpyDialogue = RENPY_DIALOGUE_RE.exec(line);
    if (renpyDialogue) {
      const sp = lookupCharacter(renpyDialogue[1]);
      const emotion = renpyDialogue[2] ?? "";
      const dialogueText = unescapeRenpyText(renpyDialogue[3]);
      blocks.push({
        type: "dialogue",
        attrs: {
          id: consumeSceneId(),
          speaker: sp.speaker,
          shortName: sp.shortName,
          emotion,
          color: sp.color,
        },
        content: dialogueText
          ? [{ type: "text", text: dialogueText }]
          : [],
      });
      i++;
      continue;
    }

    // ----- Ren'Py: `"narration"` -----
    const renpyNarration = RENPY_NARRATION_RE.exec(line);
    if (renpyNarration) {
      const narrText = unescapeRenpyText(renpyNarration[1]).trim();
      if (narrText) {
        const id = consumeSceneId();
        blocks.push({
          type: "direction",
          attrs: id ? { id } : undefined,
          content: [{ type: "text", text: narrText }],
        });
      }
      i++;
      continue;
    }

    // Major scene heading: "СЦЕНА 1: «СООБЩЕНИЕ»"
    if (SCENE_RE.test(line)) {
      blocks.push(textBlock("sceneHeading", line));
      i++;
      continue;
    }

    // Inline "ИМЯ: текст" (dialogue on a single line) — handle BEFORE the
    // standalone-speaker check so we don't fall through to direction.
    const inlineMatch = INLINE_SPEAKER_RE.exec(line);
    if (inlineMatch) {
      const sp = lookupCharacter(inlineMatch[1]);
      blocks.push({
        type: "dialogue",
        attrs: {
          id: consumeSceneId(),
          speaker: sp.speaker,
          shortName: sp.shortName,
          emotion: "",
          color: sp.color,
        },
        content: [{ type: "text", text: inlineMatch[2].trim() }],
      });
      i++;
      continue;
    }

    // Standalone speaker label "ИМЯ:" — collect dialogue text from following
    // non-empty lines until we hit the next speaker / section / scene heading
    // or a blank line.
    const speakerMatch = SPEAKER_RE.exec(line);
    if (speakerMatch) {
      const sp = lookupCharacter(speakerMatch[1]);
      i++;
      // skip blank lines after the speaker label
      while (i < lines.length && !lines[i].trim()) i++;
      const buf: string[] = [];
      while (i < lines.length) {
        const l = lines[i].trim();
        if (!l) break;
        if (isHeadingStart(l)) break;
        if (RENPY_NOISE_RE.test(l) || RENPY_COMMENT_RE.test(l)) break;
        buf.push(l);
        i++;
      }
      const dialogueText = buf.join(" ").trim();
      blocks.push({
        type: "dialogue",
        attrs: {
          id: consumeSceneId(),
          speaker: sp.speaker,
          shortName: sp.shortName,
          emotion: "",
          color: sp.color,
        },
        content: dialogueText ? [{ type: "text", text: dialogueText }] : [],
      });
      continue;
    }

    // Section heading: "ЛОКАЦИЯ:", "ОБЩИЙ ПЛАН:", etc.
    if (SECTION_RE.test(line)) {
      blocks.push(textBlock("sceneHeading", line));
      i++;
      continue;
    }

    // Direction paragraph: collect consecutive non-blank, non-heading lines.
    // Noise (define/image/init/...) breaks the paragraph but is not collected.
    const paragraph: string[] = [line];
    i++;
    while (i < lines.length) {
      const l = lines[i].trim();
      if (!l) break;
      if (isHeadingStart(l)) break;
      if (RENPY_NOISE_RE.test(l) || RENPY_COMMENT_RE.test(l)) break;
      paragraph.push(l);
      i++;
    }
    pushDirection(paragraph);
  }

  return {
    type: "doc",
    content: blocks,
  } as unknown as ScriptContent;
}
