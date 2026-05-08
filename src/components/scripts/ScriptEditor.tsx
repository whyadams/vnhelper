import {
  useEditor,
  EditorContent,
  type Content,
  type Editor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TextSelection } from "@tiptap/pm/state";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ScriptCharacter, ScriptContent } from "../../state/scripts";
import { ALL_VN_NODES } from "./scriptNodes";
import {
  CharacterMention,
  charactersToMentionTargets,
} from "./CharacterMention";
import { CharacterMentionTooltip } from "./CharacterMentionTooltip";
import { useDialog } from "../ui/Dialog";
import { runScriptAI, type ScriptAIAction } from "../../lib/scriptAi";
import { loadAISettings } from "../../lib/aiClient";
import { AISettingsModal } from "./AISettingsModal";

interface Props {
  nodeId: string;
  initialContent: ScriptContent | null;
  initialMarkdown: string;
  characters: ScriptCharacter[];
  projectTitle?: string;
  synopsis?: string;
  sceneTitle?: string;
  povCharacter?: string | null;
  location?: string | null;
  onChange: (content: ScriptContent) => void;
}

function legacyTextToDoc(text: string): Content {
  if (!text) return { type: "doc", content: [{ type: "paragraph" }] };
  const blocks = text.split(/\n\n+/).map((para) => {
    const lines = para.split("\n");
    return {
      type: "paragraph",
      content: lines.flatMap((line, i) => {
        const t: { type: string; text?: string }[] = [];
        if (line) t.push({ type: "text", text: line });
        if (i < lines.length - 1) t.push({ type: "hardBreak" });
        return t;
      }),
    };
  });
  return {
    type: "doc",
    content: blocks.length === 0 ? [{ type: "paragraph" }] : blocks,
  };
}

function toEditorContent(
  initialContent: ScriptContent | null,
  initialMarkdown: string,
): Content {
  if (
    initialContent &&
    typeof initialContent === "object" &&
    !Array.isArray(initialContent)
  ) {
    return initialContent as Content;
  }
  return legacyTextToDoc(initialMarkdown);
}

export function ScriptEditor({
  nodeId,
  initialContent,
  initialMarkdown,
  characters,
  projectTitle,
  synopsis,
  sceneTitle,
  povCharacter,
  location,
  onChange,
}: Props) {
  const lastSavedRef = useRef<string>("");

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Placeholder.configure({
          placeholder:
            "Press '/' for commands · Enter to add a new line · '@' for character",
        }),
        ...ALL_VN_NODES,
        CharacterMention.configure({
          characters: charactersToMentionTargets(characters),
        }),
      ],
      content: toEditorContent(initialContent, initialMarkdown),
      onUpdate: ({ editor }) => {
        const json = editor.getJSON();
        const sig = JSON.stringify(json);
        if (sig === lastSavedRef.current) return;
        lastSavedRef.current = sig;
        onChange(json as unknown as ScriptContent);
      },
      editorProps: {
        attributes: { class: "tiptap-editor vn-editor" },
      },
    },
    [nodeId],
  );

  useEffect(() => {
    if (!editor) return;
    const next = toEditorContent(initialContent, initialMarkdown);
    lastSavedRef.current = JSON.stringify(next);
    editor.commands.setContent(next, { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  // Refresh mention decorations when characters change without
  // recreating the editor.
  useEffect(() => {
    if (!editor) return;
    const storage = (editor.storage as unknown as Record<string, unknown>)
      .vnCharacterMention as
      | { setCharacters?: (list: ReturnType<typeof charactersToMentionTargets>) => void }
      | undefined;
    storage?.setCharacters?.(charactersToMentionTargets(characters));
  }, [editor, characters]);

  const wrapRef = useRef<HTMLDivElement | null>(null);

  if (!editor) return <div className="tiptap-loading">Loading editor…</div>;

  return (
    <div ref={wrapRef} className="tiptap-wrap vn-editor-wrap">
      <ScriptToolbar
        editor={editor}
        characters={characters}
        projectTitle={projectTitle}
        synopsis={synopsis}
        sceneTitle={sceneTitle}
        povCharacter={povCharacter}
        location={location}
      />
      <EditorContent editor={editor} />
      <SelectionBubbleMenu editor={editor} characters={characters} />
      <CharacterMentionTooltip rootRef={wrapRef} characters={characters} />
    </div>
  );
}

// ============================================================
// Selection-based floating toolbar (bubble menu)
// ============================================================

function SelectionBubbleMenu({
  editor,
  characters,
}: {
  editor: Editor;
  characters: ScriptCharacter[];
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [charPickerOpen, setCharPickerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const update = () => {
      const { state, view } = editor;
      const { selection } = state;
      const { from, to, empty } = selection;
      if (empty || from === to || !(selection instanceof TextSelection)) {
        setPos(null);
        setCharPickerOpen(false);
        return;
      }
      const wrap = view.dom.closest(".tiptap-wrap") as HTMLElement | null;
      if (!wrap) return;
      const wrapRect = wrap.getBoundingClientRect();
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      const top = Math.min(start.top, end.top) - wrapRect.top;
      const left = (start.left + end.right) / 2 - wrapRect.left;
      setPos({ top, left });
    };
    const hide = () => {
      // small delay so a click on a bubble button isn't lost
      requestAnimationFrame(() => {
        const sel = editor.state.selection;
        if (sel.empty) {
          setPos(null);
          setCharPickerOpen(false);
        }
      });
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    editor.on("focus", update);
    editor.on("blur", hide);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      editor.off("focus", update);
      editor.off("blur", hide);
    };
  }, [editor]);

  if (!pos) return null;

  const wrapText = (c: ScriptCharacter) => {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, " ");
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from, to },
        {
          type: "dialogue",
          attrs: {
            speaker: c.name,
            shortName: c.short_name ?? c.name,
            color: c.color,
          },
          content: text ? [{ type: "text", text }] : [],
        },
      )
      .run();
    setCharPickerOpen(false);
  };

  const Btn = ({
    active,
    onClick,
    label,
    title,
  }: {
    active?: boolean;
    onClick: () => void;
    label: ReactNode;
    title?: string;
  }) => (
    <button
      type="button"
      className={"vn-bubble-btn" + (active ? " is-active" : "")}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      title={title}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={menuRef}
      className="vn-bubble-menu"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Btn
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        label={<b>B</b>}
        title="Bold ⌘B"
      />
      <Btn
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        label={<i>I</i>}
        title="Italic ⌘I"
      />
      <Btn
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        label={<s>S</s>}
        title="Strikethrough"
      />
      <span className="vn-bubble-sep" />
      <Btn
        active={editor.isActive("heading", { level: 1 })}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 1 }).run()
        }
        label="H1"
        title="Heading 1"
      />
      <Btn
        active={editor.isActive("heading", { level: 2 })}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
        label="H2"
        title="Heading 2"
      />
      <Btn
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        label="❝"
        title="Quote"
      />
      <Btn
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        label="•"
        title="Bullet list"
      />
      {characters.length > 0 && (
        <>
          <span className="vn-bubble-sep" />
          <button
            type="button"
            className={
              "vn-bubble-btn vn-bubble-char" +
              (charPickerOpen ? " is-active" : "")
            }
            onMouseDown={(e) => {
              e.preventDefault();
              setCharPickerOpen((v) => !v);
            }}
            title="Wrap as dialogue"
          >
            @
          </button>
          {charPickerOpen && (
            <div className="vn-bubble-char-menu">
              {characters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="vn-bubble-char-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    wrapText(c);
                  }}
                >
                  <span
                    className="vn-bubble-char-dot"
                    style={{ background: c.color }}
                  />
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// Toolbar
// ============================================================

interface ToolbarProps {
  editor: Editor;
  characters: ScriptCharacter[];
  projectTitle?: string;
  synopsis?: string;
  sceneTitle?: string;
  povCharacter?: string | null;
  location?: string | null;
}

function ScriptToolbar({
  editor,
  characters,
  projectTitle,
  synopsis,
  sceneTitle,
  povCharacter,
  location,
}: ToolbarProps) {
  const dialog = useDialog();
  const [insertMenuOpen, setInsertMenuOpen] = useState(false);
  const [characterMenuOpen, setCharacterMenuOpen] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState<ScriptAIAction | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const insertDialogue = (c?: ScriptCharacter) => {
    editor
      .chain()
      .focus()
      .insertContent({
        type: "dialogue",
        attrs: c
          ? {
              speaker: c.name,
              shortName: c.short_name ?? c.name,
              color: c.color,
            }
          : { speaker: "", shortName: "", color: "" },
        content: [],
      })
      .run();
    setCharacterMenuOpen(false);
    setInsertMenuOpen(false);
  };

  const insertDirection = () => {
    editor
      .chain()
      .focus()
      .insertContent({ type: "direction", content: [] })
      .run();
    setInsertMenuOpen(false);
  };

  const insertSceneHeading = async () => {
    setInsertMenuOpen(false);
    const loc = await dialog.prompt({
      title: "Scene heading",
      message: "Location (optional)",
      placeholder: "e.g. Cafe, Rooftop, Aiko's apartment",
      confirmLabel: "Next →",
    });
    if (loc === null) return;
    const time = await dialog.prompt({
      title: "Scene heading",
      message: "Time of day (optional)",
      placeholder: "e.g. Evening, Past, Day 3",
      confirmLabel: "Insert",
    });
    if (time === null) return;
    editor
      .chain()
      .focus()
      .insertContent({
        type: "sceneHeading",
        attrs: { location: loc, time },
        content: [],
      })
      .run();
  };

  const insertChoice = async () => {
    setInsertMenuOpen(false);
    const prompt = await dialog.prompt({
      title: "Choice",
      message: "Prompt for the player",
      placeholder: "What do you say?",
      confirmLabel: "Insert",
    });
    if (prompt === null) return;
    editor
      .chain()
      .focus()
      .insertContent({
        type: "choice",
        attrs: { prompt: prompt || "Choose…" },
        content: [
          {
            type: "choiceOption",
            attrs: { target: "" },
            content: [{ type: "text", text: "Option 1" }],
          },
          {
            type: "choiceOption",
            attrs: { target: "" },
            content: [{ type: "text", text: "Option 2" }],
          },
        ],
      })
      .run();
  };

  const insertBgm = async () => {
    setInsertMenuOpen(false);
    const track = await dialog.prompt({
      title: "BGM marker",
      message: "Background track or mood",
      placeholder: "e.g. melancholic_piano, tense, silence",
      confirmLabel: "Insert",
    });
    if (!track?.trim()) return;
    editor
      .chain()
      .focus()
      .insertContent({ type: "bgmMarker", attrs: { track: track.trim() } })
      .run();
  };

  const insertSfx = async () => {
    setInsertMenuOpen(false);
    const sound = await dialog.prompt({
      title: "SFX marker",
      message: "Sound effect",
      placeholder: "e.g. door_slam, distant_thunder",
      confirmLabel: "Insert",
    });
    if (!sound?.trim()) return;
    editor
      .chain()
      .focus()
      .insertContent({ type: "sfxMarker", attrs: { sound: sound.trim() } })
      .run();
  };

  const runAI = async (action: ScriptAIAction) => {
    const settings = loadAISettings();
    if (!settings.baseUrl) {
      setAiSettingsOpen(true);
      return;
    }
    setAiMenuOpen(false);
    setAiError(null);
    setAiBusy(action);
    abortRef.current = new AbortController();
    try {
      const inputHtml = editor.getHTML();
      const result = await runScriptAI(
        action,
        inputHtml || "<p></p>",
        {
          projectTitle,
          synopsis,
          sceneTitle,
          povCharacter,
          location,
          characters: characters.map((c) => ({
            name: c.name,
            shortName: c.short_name,
            pronouns: c.pronouns,
            role: c.role,
            voiceNotes: c.voice_notes,
            traits:
              typeof c.traits === "object" && c.traits !== null
                ? (c.traits as Record<string, unknown>)
                : null,
          })),
        },
        abortRef.current.signal,
      );
      if (!result.trim()) {
        setAiError("Model returned empty response.");
        return;
      }
      const append =
        action === "continue-scene" ||
        action === "dialogue-in-voice" ||
        action === "suggest-choices" ||
        action === "describe-location";
      if (append) {
        editor
          .chain()
          .focus()
          .insertContentAt(editor.state.doc.content.size, result)
          .run();
      } else {
        editor.commands.setContent(result, { emitUpdate: true });
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") {
        setAiError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setAiBusy(null);
      abortRef.current = null;
    }
  };

  const cancelAI = () => {
    abortRef.current?.abort();
    setAiBusy(null);
  };

  const btn = (active: boolean, fn: () => void, label: string, title?: string) => (
    <button
      type="button"
      className={"tiptap-btn" + (active ? " is-active" : "")}
      onMouseDown={(e) => {
        e.preventDefault();
        fn();
      }}
      title={title ?? label}
    >
      {label}
    </button>
  );

  return (
    <div className="tiptap-toolbar vn-toolbar">
      {/* Insert (VN) */}
      <div className="vn-toolbar-group">
        <button
          type="button"
          className={"tiptap-btn is-primary" + (insertMenuOpen ? " is-active" : "")}
          onMouseDown={(e) => {
            e.preventDefault();
            setInsertMenuOpen((v) => !v);
            setCharacterMenuOpen(false);
            setAiMenuOpen(false);
          }}
          title="Insert VN block"
        >
          + Insert
        </button>
        {insertMenuOpen && (
          <div className="vn-menu">
            <button
              type="button"
              className="vn-menu-item"
              onMouseDown={(e) => {
                e.preventDefault();
                setCharacterMenuOpen(true);
              }}
            >
              <strong>Dialogue</strong>
              <span>Pick a character to speak</span>
            </button>
            <button
              type="button"
              className="vn-menu-item"
              onMouseDown={(e) => {
                e.preventDefault();
                insertDirection();
              }}
            >
              <strong>Direction</strong>
              <span>Action / narration</span>
            </button>
            <button
              type="button"
              className="vn-menu-item"
              onMouseDown={(e) => {
                e.preventDefault();
                void insertSceneHeading();
              }}
            >
              <strong>Scene heading</strong>
              <span>Location · time</span>
            </button>
            <button
              type="button"
              className="vn-menu-item"
              onMouseDown={(e) => {
                e.preventDefault();
                void insertChoice();
              }}
            >
              <strong>Choice</strong>
              <span>Branching options</span>
            </button>
            <div className="vn-menu-divider" />
            <button
              type="button"
              className="vn-menu-item"
              onMouseDown={(e) => {
                e.preventDefault();
                void insertBgm();
              }}
            >
              <strong>♪ BGM marker</strong>
              <span>Background music cue</span>
            </button>
            <button
              type="button"
              className="vn-menu-item"
              onMouseDown={(e) => {
                e.preventDefault();
                void insertSfx();
              }}
            >
              <strong>🔊 SFX marker</strong>
              <span>Sound effect cue</span>
            </button>
          </div>
        )}
        {characterMenuOpen && (
          <div className="vn-menu">
            {characters.length === 0 && (
              <div className="vn-menu-empty">
                No characters yet — add one in the right panel.
              </div>
            )}
            <button
              type="button"
              className="vn-menu-item"
              onMouseDown={(e) => {
                e.preventDefault();
                insertDialogue();
              }}
            >
              <strong>—</strong>
              <span>Empty (set later)</span>
            </button>
            {characters.map((c) => (
              <button
                key={c.id}
                type="button"
                className="vn-menu-item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertDialogue(c);
                }}
              >
                <strong style={{ color: c.color }}>{c.name}</strong>
                <span>{c.role ?? c.pronouns ?? c.short_name ?? ""}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="tiptap-sep" />

      {/* Plain rich-text */}
      {btn(
        editor.isActive("heading", { level: 1 }),
        () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
        "H1",
      )}
      {btn(
        editor.isActive("heading", { level: 2 }),
        () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
        "H2",
      )}
      {btn(
        editor.isActive("bold"),
        () => editor.chain().focus().toggleBold().run(),
        "B",
        "Bold ⌘B",
      )}
      {btn(
        editor.isActive("italic"),
        () => editor.chain().focus().toggleItalic().run(),
        "I",
        "Italic ⌘I",
      )}
      {btn(
        editor.isActive("bulletList"),
        () => editor.chain().focus().toggleBulletList().run(),
        "•",
        "Bullet list",
      )}
      {btn(
        editor.isActive("blockquote"),
        () => editor.chain().focus().toggleBlockquote().run(),
        "❝",
        "Quote",
      )}

      <span className="tiptap-spacer" />

      {/* AI */}
      <button
        type="button"
        className={"tiptap-btn tiptap-ai-btn" + (aiBusy ? " is-busy" : "")}
        onClick={() => {
          if (aiBusy) {
            cancelAI();
            return;
          }
          setAiMenuOpen((v) => !v);
          setInsertMenuOpen(false);
          setCharacterMenuOpen(false);
        }}
        title={aiBusy ? "Cancel" : "AI assist (LM Studio)"}
      >
        {aiBusy ? (
          <>
            <span className="tiptap-ai-spin" /> {aiBusy}…
          </>
        ) : (
          <>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: 4 }}
            >
              <path d="M12 2l2.39 6.96H22l-6.18 4.49L18.18 22 12 17.27 5.82 22l2.36-8.55L2 8.96h7.61z" />
            </svg>
            AI
          </>
        )}
      </button>

      {aiMenuOpen && !aiBusy && (
        <div className="tiptap-ai-menu vn-ai-menu">
          <button
            type="button"
            className="tiptap-ai-item"
            onClick={() => void runAI("continue-scene")}
          >
            <strong>Continue scene</strong>
            <span>Append next 6-12 beats in voice</span>
          </button>
          <button
            type="button"
            className="tiptap-ai-item"
            onClick={() => void runAI("dialogue-in-voice")}
          >
            <strong>Suggest dialogue</strong>
            <span>2-4 lines matching cast voices</span>
          </button>
          <button
            type="button"
            className="tiptap-ai-item"
            onClick={() => void runAI("suggest-choices")}
          >
            <strong>Suggest choices</strong>
            <span>3 player choices for this moment</span>
          </button>
          <button
            type="button"
            className="tiptap-ai-item"
            onClick={() => void runAI("describe-location")}
          >
            <strong>Describe location</strong>
            <span>Atmospheric setting paragraph</span>
          </button>
          <div className="tiptap-ai-divider" />
          <button
            type="button"
            className="tiptap-ai-item"
            onClick={() => void runAI("tighten")}
          >
            <strong>Tighten</strong>
            <span>Cut redundancy, sharpen lines</span>
          </button>
          <button
            type="button"
            className="tiptap-ai-item"
            onClick={() => void runAI("beat-sheet")}
          >
            <strong>Beat sheet</strong>
            <span>5-7 structural beats of the scene</span>
          </button>
          <div className="tiptap-ai-divider" />
          <button
            type="button"
            className="tiptap-ai-item tiptap-ai-settings"
            onClick={() => {
              setAiMenuOpen(false);
              setAiSettingsOpen(true);
            }}
          >
            <span>⚙ Settings</span>
          </button>
        </div>
      )}

      {aiError && (
        <div className="tiptap-ai-error" onClick={() => setAiError(null)}>
          {aiError}
          <span className="tiptap-ai-error-x">×</span>
        </div>
      )}

      <AISettingsModal
        open={aiSettingsOpen}
        onClose={() => setAiSettingsOpen(false)}
      />
    </div>
  );
}

export function useScriptStats(content: ScriptContent | null): {
  words: number;
  dialogueLines: number;
  directions: number;
  choices: number;
  speakers: string[];
} {
  return useMemo(() => {
    let words = 0;
    let dialogueLines = 0;
    let directions = 0;
    let choices = 0;
    const speakers = new Set<string>();
    const walk = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      const obj = n as { type?: string; text?: string; attrs?: { speaker?: string }; content?: unknown[] };
      if (obj.type === "text" && typeof obj.text === "string") {
        words += obj.text.trim().split(/\s+/).filter(Boolean).length;
      }
      if (obj.type === "dialogue") {
        dialogueLines++;
        if (obj.attrs?.speaker) speakers.add(obj.attrs.speaker);
      }
      if (obj.type === "direction") directions++;
      if (obj.type === "choice") choices++;
      if (Array.isArray(obj.content)) obj.content.forEach(walk);
    };
    walk(content);
    return {
      words,
      dialogueLines,
      directions,
      choices,
      speakers: Array.from(speakers),
    };
  }, [content]);
}
