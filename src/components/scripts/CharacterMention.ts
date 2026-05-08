import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface MentionTarget {
  id: string;
  name: string;
  color: string;
  /** All variants to match — name, short_name, aliases. */
  variants: string[];
}

interface Options {
  characters: MentionTarget[];
}

const pluginKey = new PluginKey("vnCharacterMention");

/**
 * Escape user-provided text for safe inclusion into a RegExp.
 */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a single regex that matches any character variant. Each match
 * captures group 1 = matched name; uses Unicode word boundaries that
 * also work for Cyrillic, since `\b` only handles ASCII.
 *
 * Boundaries: characters preceded/followed by anything that is NOT a
 * letter, digit or underscore (in any script).
 */
function buildMatcher(targets: MentionTarget[]): {
  re: RegExp;
  byVariant: Map<string, MentionTarget>;
} | null {
  const byVariant = new Map<string, MentionTarget>();
  const variants: string[] = [];
  for (const t of targets) {
    for (const v of t.variants) {
      const trimmed = v.trim();
      if (trimmed.length < 2) continue;
      const key = trimmed.toLowerCase();
      // First-write wins, but allow longest variant first so "MC Tyler" matches
      if (!byVariant.has(key)) {
        byVariant.set(key, t);
        variants.push(trimmed);
      }
    }
  }
  if (variants.length === 0) return null;

  // Sort longest first so "MC Tyler" wins over "Tyler"
  variants.sort((a, b) => b.length - a.length);

  const body = variants.map(escapeRe).join("|");
  // (?<![\p{L}\p{N}_]) — left boundary, (?![\p{L}\p{N}_]) — right
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${body})(?![\\p{L}\\p{N}_])`,
    "gu",
  );
  return { re, byVariant };
}

function findDecorations(doc: PMNode, targets: MentionTarget[]): DecorationSet {
  const matcher = buildMatcher(targets);
  if (!matcher) return DecorationSet.empty;
  const { re, byVariant } = matcher;

  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const matched = m[1];
      if (!matched || m.index === undefined) continue;
      const target = byVariant.get(matched.toLowerCase());
      if (!target) continue;
      const from = pos + m.index;
      const to = from + matched.length;
      const initial =
        Array.from(target.name.trim())[0]?.toUpperCase() ?? "?";
      decorations.push(
        Decoration.inline(from, to, {
          class: "vn-mention",
          style: `--vn-mention-color:${target.color}`,
          "data-character-id": target.id,
          "data-character-name": target.name,
          "data-initial": initial,
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * TipTap extension that scans text and decorates known character names
 * (from `name`, `short_name` and `aliases`) with their character color.
 *
 * Pure decorations — does not touch the document, so it doesn't pollute
 * persisted JSON. When the characters list changes, call
 * `editor.storage.vnCharacterMention.setCharacters(list)`.
 */
export const CharacterMention = Extension.create<Options>({
  name: "vnCharacterMention",

  addOptions() {
    return { characters: [] };
  },

  addStorage() {
    return {
      characters: [] as MentionTarget[],
      setCharacters: (_: MentionTarget[]) => {},
    };
  },

  addProseMirrorPlugins() {
    const ext = this;
    ext.storage.characters = ext.options.characters;

    const plugin = new Plugin({
      key: pluginKey,
      state: {
        init: (_cfg, state) =>
          findDecorations(state.doc, ext.storage.characters as MentionTarget[]),
        apply(tr, old) {
          // Force-recompute when characters list updates
          const force = tr.getMeta(pluginKey) as
            | { type: "rebuild" }
            | undefined;
          if (force?.type === "rebuild") {
            return findDecorations(
              tr.doc,
              ext.storage.characters as MentionTarget[],
            );
          }
          if (!tr.docChanged) return old;
          return findDecorations(
            tr.doc,
            ext.storage.characters as MentionTarget[],
          );
        },
      },
      props: {
        decorations(state) {
          return this.getState(state) ?? null;
        },
      },
    });

    ext.storage.setCharacters = (list: MentionTarget[]) => {
      ext.storage.characters = list;
      const view = ext.editor?.view;
      if (!view) return;
      view.dispatch(view.state.tr.setMeta(pluginKey, { type: "rebuild" }));
    };

    return [plugin];
  },
});

export function charactersToMentionTargets(
  characters: Array<{
    id: string;
    name: string;
    color: string;
    short_name: string | null;
    aliases: string[];
  }>,
): MentionTarget[] {
  return characters.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    variants: [c.name, c.short_name ?? "", ...(c.aliases ?? [])].filter(
      (v): v is string => Boolean(v && v.trim()),
    ),
  }));
}
