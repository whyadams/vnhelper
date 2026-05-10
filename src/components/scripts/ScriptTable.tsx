import { useMemo, useState } from "react";
import type { ScriptCharacter, ScriptContent } from "../../state/scripts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

// Sentinel for "no emotion" — Radix Select rejects empty-string values.
const EMOTION_NONE = "__none__";

type RowKind =
  | "dialogue"
  | "direction"
  | "sceneHeading"
  | "choice"
  | "choiceOption"
  | "other";

interface BlockNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: BlockNode[];
  text?: string;
}

interface DocNode {
  type?: string;
  content?: BlockNode[];
}

type RowPath =
  | { kind: "block"; blockIndex: number }
  | { kind: "option"; blockIndex: number; optionIndex: number };

interface Row {
  key: string;
  path: RowPath;
  kind: RowKind;
  id: string;
  speaker: string;
  emotion: string;
  text: string;
  target: string;
}

interface Props {
  initialContent: ScriptContent | null;
  characters: ScriptCharacter[];
  onChange: (next: ScriptContent) => void;
}

const KIND_GLYPH: Record<RowKind, string> = {
  dialogue: "s",
  direction: "a",
  sceneHeading: "h",
  choice: "c",
  choiceOption: "·",
  other: "·",
};

// Top-level block kinds you can cycle through. Choice is excluded — converting
// to/from choice is structural (needs option children), use the dedicated
// "+ choice" action instead.
const KIND_CYCLE: RowKind[] = ["dialogue", "direction", "sceneHeading"];

const EMOTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "—" },
  { value: "neutral", label: "😐 neutral" },
  { value: "happy", label: "😊 happy" },
  { value: "smile", label: "🙂 smile" },
  { value: "laugh", label: "😄 laugh" },
  { value: "sly", label: "😏 sly" },
  { value: "love", label: "😍 love" },
  { value: "blush", label: "😳 blush" },
  { value: "wink", label: "😉 wink" },
  { value: "sad", label: "😢 sad" },
  { value: "cry", label: "😭 cry" },
  { value: "angry", label: "😠 angry" },
  { value: "rage", label: "😡 rage" },
  { value: "annoyed", label: "😒 annoyed" },
  { value: "surprised", label: "😲 surprised" },
  { value: "shock", label: "😱 shock" },
  { value: "scared", label: "😨 scared" },
  { value: "confused", label: "😕 confused" },
  { value: "thinking", label: "🤔 thinking" },
  { value: "tired", label: "😩 tired" },
  { value: "sleepy", label: "😴 sleepy" },
  { value: "sick", label: "🤢 sick" },
  { value: "cool", label: "😎 cool" },
  { value: "smug", label: "😼 smug" },
  { value: "serious", label: "😤 serious" },
];

function inlineText(node: BlockNode | undefined): string {
  if (!node) return "";
  if (node.type === "text" && typeof node.text === "string") return node.text;
  if (!node.content) return "";
  return node.content.map(inlineText).join("");
}

function getStr(attrs: Record<string, unknown> | undefined, key: string): string {
  const v = attrs?.[key];
  return typeof v === "string" ? v : "";
}

function ensureDoc(content: ScriptContent | null): DocNode {
  if (
    content &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    "type" in content &&
    (content as DocNode).type === "doc"
  ) {
    return content as DocNode;
  }
  return { type: "doc", content: [] };
}

function expandRows(blocks: BlockNode[]): Row[] {
  const rows: Row[] = [];
  blocks.forEach((b, i) => {
    const type = b.type ?? "";
    if (type === "choice") {
      rows.push({
        key: `b${i}:c`,
        path: { kind: "block", blockIndex: i },
        kind: "choice",
        id: getStr(b.attrs, "id"),
        speaker: "",
        emotion: "",
        text: getStr(b.attrs, "prompt"),
        target: "",
      });
      const opts = b.content ?? [];
      opts.forEach((opt, j) => {
        rows.push({
          key: `b${i}:o${j}`,
          path: { kind: "option", blockIndex: i, optionIndex: j },
          kind: "choiceOption",
          id: getStr(opt.attrs, "id"),
          speaker: "",
          emotion: "",
          text: inlineText(opt),
          target: getStr(opt.attrs, "target"),
        });
      });
      return;
    }
    const kind: RowKind =
      type === "dialogue" ? "dialogue"
      : type === "direction" ? "direction"
      : type === "sceneHeading" ? "sceneHeading"
      : "other";
    rows.push({
      key: `b${i}`,
      path: { kind: "block", blockIndex: i },
      kind,
      id: getStr(b.attrs, "id"),
      speaker: getStr(b.attrs, "speaker"),
      emotion: getStr(b.attrs, "emotion"),
      text: inlineText(b),
      target: "",
    });
  });
  return rows;
}

/**
 * Parse a trailing integer from `prev` and increment it.
 * "ch_0" → "ch_1", "ch_42" → "ch_43", "scene-09" → "scene-10".
 * If `prev` has no trailing digits, returns "" so the new row stays empty.
 */
function nextId(prev: string): string {
  const m = /^(.*?)(\d+)$/.exec(prev);
  if (!m) return "";
  const prefix = m[1];
  const width = m[2].length;
  const num = (parseInt(m[2], 10) + 1).toString();
  // Preserve zero-padding (e.g. "ch_001" → "ch_002")
  const padded = num.padStart(width, "0");
  return prefix + padded;
}

export function ScriptTable({
  initialContent,
  characters,
  onChange,
}: Props) {
  const [doc, setDoc] = useState<DocNode>(() => ensureDoc(initialContent));
  const blocks: BlockNode[] = doc.content ?? [];
  const rows = useMemo(() => expandRows(blocks), [blocks]);

  const characterOptions = useMemo(
    () => characters.map((c) => c.name).filter(Boolean),
    [characters],
  );

  const commit = (nextBlocks: BlockNode[]) => {
    const next = { ...doc, content: nextBlocks };
    setDoc(next);
    onChange(next as unknown as ScriptContent);
  };

  const patchBlock = (index: number, mut: (b: BlockNode) => BlockNode) => {
    const next = blocks.slice();
    if (!next[index]) return;
    next[index] = mut(next[index]);
    commit(next);
  };

  const patchOption = (
    blockIndex: number,
    optionIndex: number,
    mut: (b: BlockNode) => BlockNode,
  ) => {
    patchBlock(blockIndex, (b) => {
      const opts = (b.content ?? []).slice();
      if (!opts[optionIndex]) return b;
      opts[optionIndex] = mut(opts[optionIndex]);
      return { ...b, content: opts };
    });
  };

  const cycleKind = (index: number) => {
    patchBlock(index, (b) => {
      const cur = (b.type ?? "") as RowKind;
      const i = KIND_CYCLE.indexOf(cur);
      const nextKind =
        KIND_CYCLE[(i === -1 ? 0 : (i + 1) % KIND_CYCLE.length)];
      const text = inlineText(b);
      return {
        type: nextKind,
        attrs: nextKind === "dialogue" ? (b.attrs ?? {}) : undefined,
        content: text ? [{ type: "text", text }] : [],
      };
    });
  };

  const updateBlockText = (index: number, text: string) => {
    patchBlock(index, (b) => {
      if (b.type === "choice") {
        // For a choice block, the text column holds the prompt attribute.
        return { ...b, attrs: { ...(b.attrs ?? {}), prompt: text } };
      }
      return { ...b, content: text ? [{ type: "text", text }] : [] };
    });
  };

  const updateBlockAttr = (index: number, key: string, value: string) => {
    patchBlock(index, (b) => ({
      ...b,
      attrs: { ...(b.attrs ?? {}), [key]: value },
    }));
  };

  const updateOptionText = (
    blockIndex: number,
    optionIndex: number,
    text: string,
  ) => {
    patchOption(blockIndex, optionIndex, (o) => ({
      ...o,
      type: "choiceOption",
      content: text ? [{ type: "text", text }] : [],
    }));
  };

  const updateOptionAttr = (
    blockIndex: number,
    optionIndex: number,
    key: string,
    value: string,
  ) => {
    patchOption(blockIndex, optionIndex, (o) => ({
      ...o,
      attrs: { ...(o.attrs ?? {}), [key]: value },
    }));
  };

  const addOption = (blockIndex: number) => {
    patchBlock(blockIndex, (b) => {
      const opts = (b.content ?? []).slice();
      const prevId =
        opts.length > 0
          ? getStr(opts[opts.length - 1].attrs, "id")
          : getStr(b.attrs, "id");
      opts.push({
        type: "choiceOption",
        attrs: { id: nextId(prevId), target: "", flag: "" },
        content: [],
      });
      return { ...b, content: opts };
    });
  };

  const deleteOption = (blockIndex: number, optionIndex: number) => {
    patchBlock(blockIndex, (b) => {
      const opts = (b.content ?? []).slice();
      // Keep at least one option — choice schema requires +1.
      if (opts.length <= 1) return b;
      opts.splice(optionIndex, 1);
      return { ...b, content: opts };
    });
  };

  const insertBlockAfter = (afterIndex: number, type: "dialogue" | "choice") => {
    const next = blocks.slice();
    // Auto-increment id from the nearest preceding block (ignoring choice
    // option children — they live one level deeper).
    const prev = afterIndex >= 0 ? next[afterIndex] : undefined;
    const prevId = getStr(prev?.attrs, "id");
    const newId = nextId(prevId);
    const block: BlockNode =
      type === "choice"
        ? {
            type: "choice",
            attrs: { id: newId, prompt: "" },
            content: [
              {
                type: "choiceOption",
                attrs: { id: nextId(newId), target: "" },
                content: [],
              },
            ],
          }
        : {
            type: "dialogue",
            attrs: { id: newId, speaker: "", emotion: "" },
            content: [],
          };
    next.splice(afterIndex + 1, 0, block);
    commit(next);
  };

  const updateBlockId = (index: number, value: string) => {
    patchBlock(index, (b) => ({
      ...b,
      attrs: { ...(b.attrs ?? {}), id: value },
    }));
  };

  const updateOptionId = (
    blockIndex: number,
    optionIndex: number,
    value: string,
  ) => {
    patchOption(blockIndex, optionIndex, (o) => ({
      ...o,
      attrs: { ...(o.attrs ?? {}), id: value },
    }));
  };

  const deleteBlock = (index: number) => {
    const next = blocks.slice();
    next.splice(index, 1);
    commit(next);
  };

  return (
    <div className="vn-table-wrap">
      <div className="vn-table-scroll">
        <table className="vn-table">
          <colgroup>
            <col style={{ width: 44 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 36 }} />
            <col style={{ width: 130 }} />
            <col />
            <col style={{ width: 120 }} />
            <col style={{ width: 96 }} />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>ID</th>
              <th>Type</th>
              <th>Speaker</th>
              <th>Text</th>
              <th>Emotion</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="vn-table-empty">
                  Empty scene — add the first row →
                </td>
              </tr>
            )}
            {rows.map((r, flatIdx) => {
              const isOption = r.path.kind === "option";
              return (
                <tr
                  key={r.key}
                  className={
                    "vn-tr is-" + r.kind + (isOption ? " vn-tr-option" : "")
                  }
                >
                  <td className="vn-td-idx">{flatIdx + 1}</td>
                  <td className="vn-td-id">
                    <input
                      className="vn-table-id-input"
                      value={r.id}
                      placeholder={flatIdx === 0 ? "ch_0" : "—"}
                      onChange={(e) => {
                        if (r.path.kind === "option") {
                          updateOptionId(
                            r.path.blockIndex,
                            r.path.optionIndex,
                            e.target.value,
                          );
                        } else {
                          updateBlockId(r.path.blockIndex, e.target.value);
                        }
                      }}
                    />
                  </td>
                  <td>
                    {r.path.kind === "block" && r.kind !== "choice" ? (
                      <button
                        type="button"
                        className={"vn-table-kind k-" + r.kind}
                        onClick={() => cycleKind(r.path.blockIndex)}
                        title="Click to cycle: s → a → h"
                      >
                        {KIND_GLYPH[r.kind]}
                      </button>
                    ) : (
                      <span className={"vn-table-kind is-static k-" + r.kind}>
                        {isOption ? "▸" : KIND_GLYPH[r.kind]}
                      </span>
                    )}
                  </td>
                  <td>
                    {r.kind === "dialogue" ? (
                      <>
                        <input
                          className="vn-table-input"
                          list={"vn-table-speakers-" + flatIdx}
                          value={r.speaker}
                          placeholder="—"
                          onChange={(e) =>
                            updateBlockAttr(
                              r.path.kind === "block" ? r.path.blockIndex : 0,
                              "speaker",
                              e.target.value,
                            )
                          }
                        />
                        <datalist id={"vn-table-speakers-" + flatIdx}>
                          {characterOptions.map((n) => (
                            <option key={n} value={n} />
                          ))}
                        </datalist>
                      </>
                    ) : isOption ? (
                      <input
                        className="vn-table-input"
                        value={r.target}
                        placeholder="→ target"
                        onChange={(e) =>
                          r.path.kind === "option" &&
                          updateOptionAttr(
                            r.path.blockIndex,
                            r.path.optionIndex,
                            "target",
                            e.target.value,
                          )
                        }
                      />
                    ) : (
                      <span className="vn-table-na">—</span>
                    )}
                  </td>
                  <td>
                    <textarea
                      className="vn-table-text"
                      value={r.text}
                      placeholder={
                        r.kind === "choice"
                          ? "Prompt (Choose…)"
                          : isOption
                            ? "Option text"
                            : "—"
                      }
                      onChange={(e) => {
                        if (r.path.kind === "option") {
                          updateOptionText(
                            r.path.blockIndex,
                            r.path.optionIndex,
                            e.target.value,
                          );
                        } else {
                          updateBlockText(r.path.blockIndex, e.target.value);
                        }
                      }}
                      rows={1}
                    />
                  </td>
                  <td>
                    {r.kind === "dialogue" ? (
                      <Select
                        value={r.emotion === "" ? EMOTION_NONE : r.emotion}
                        onValueChange={(v) => {
                          if (r.path.kind !== "block") return;
                          updateBlockAttr(
                            r.path.blockIndex,
                            "emotion",
                            v === EMOTION_NONE ? "" : v,
                          );
                        }}
                      >
                        <SelectTrigger className="vn-table-select">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {EMOTION_OPTIONS.map((o) => (
                            <SelectItem
                              key={o.value || "_none"}
                              value={o.value === "" ? EMOTION_NONE : o.value}
                            >
                              {o.label}
                            </SelectItem>
                          ))}
                          {r.emotion &&
                            !EMOTION_OPTIONS.some(
                              (o) => o.value === r.emotion,
                            ) && (
                              <SelectItem value={r.emotion}>
                                {r.emotion}
                              </SelectItem>
                            )}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="vn-table-na">—</span>
                    )}
                  </td>
                  <td className="vn-td-actions">
                    {r.kind === "choice" && r.path.kind === "block" && (
                      <button
                        type="button"
                        className="vn-table-rowbtn"
                        onClick={() => addOption(r.path.blockIndex)}
                        title="Add option"
                      >
                        +
                      </button>
                    )}
                    {!isOption && r.path.kind === "block" && (
                      <>
                        <button
                          type="button"
                          className="vn-table-rowbtn"
                          onClick={() =>
                            insertBlockAfter(r.path.blockIndex, "dialogue")
                          }
                          title="Add row below"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className="vn-table-rowbtn is-danger"
                          onClick={() => deleteBlock(r.path.blockIndex)}
                          title="Delete row"
                        >
                          ×
                        </button>
                      </>
                    )}
                    {r.path.kind === "option" && (
                      <button
                        type="button"
                        className="vn-table-rowbtn is-danger"
                        onClick={() => {
                          if (r.path.kind === "option") {
                            deleteOption(
                              r.path.blockIndex,
                              r.path.optionIndex,
                            );
                          }
                        }}
                        title="Delete option"
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="vn-tr-add">
              <td colSpan={7}>
                <button
                  type="button"
                  className="vn-table-addrow"
                  onClick={() => insertBlockAfter(blocks.length - 1, "dialogue")}
                >
                  + Add row
                </button>
                <button
                  type="button"
                  className="vn-table-addrow vn-table-addrow-alt"
                  onClick={() => insertBlockAfter(blocks.length - 1, "choice")}
                >
                  + Add choice
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
