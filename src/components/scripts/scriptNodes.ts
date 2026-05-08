import { Node, mergeAttributes } from "@tiptap/react";

/**
 * Custom TipTap nodes for VN scripting.
 *
 * Implemented as simple block nodes with attributes + inline content,
 * rendered as semantic HTML with data-* attributes so CSS owns the look.
 * No React NodeViews — keeps things light and serializable.
 */

// ============================================================
// Dialogue:  speaker says inline-text.
// ============================================================
export const Dialogue = Node.create({
  name: "dialogue",
  group: "block",
  content: "inline*",
  defining: true,

  addAttributes() {
    return {
      id: { default: "" },
      speaker: { default: "" },
      shortName: { default: "" },
      emotion: { default: "" },
      color: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-vn="dialogue"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const speaker = (HTMLAttributes.speaker as string) || "—";
    const shortName = (HTMLAttributes.shortName as string) || speaker;
    const color = (HTMLAttributes.color as string) || "";
    const emotion = (HTMLAttributes.emotion as string) || "";
    const initial = (shortName || speaker).slice(0, 1).toUpperCase();
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-vn": "dialogue",
        class: "vn-dialogue",
        style: color ? `--vn-color:${color}` : undefined,
      }),
      [
        "div",
        { class: "vn-dialogue-tag", contenteditable: "false" },
        ["span", { class: "vn-dialogue-av" }, initial],
        ["span", { class: "vn-dialogue-name" }, speaker],
        emotion ? ["span", { class: "vn-dialogue-emotion" }, `· ${emotion}`] : "",
      ],
      ["p", { class: "vn-dialogue-text" }, 0],
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Hitting Enter inside a dialogue makes a new dialogue with the same speaker
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;
        const node = $from.node($from.depth);
        if (node?.type.name !== "dialogue") return false;
        const attrs = node.attrs;
        return editor
          .chain()
          .insertContent({ type: "dialogue", attrs, content: [] })
          .focus()
          .run();
      },
    };
  },
});

// ============================================================
// Direction (narrator/action description).
// ============================================================
export const Direction = Node.create({
  name: "direction",
  group: "block",
  content: "inline*",
  defining: true,

  addAttributes() {
    return {
      id: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'p[data-vn="direction"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "p",
      mergeAttributes(HTMLAttributes, {
        "data-vn": "direction",
        class: "vn-direction",
      }),
      0,
    ];
  },
});

// ============================================================
// Scene heading.
// ============================================================
export const SceneHeading = Node.create({
  name: "sceneHeading",
  group: "block",
  content: "inline*",
  defining: true,

  addAttributes() {
    return {
      id: { default: "" },
      location: { default: "" },
      time: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-vn="scene-heading"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const location = (HTMLAttributes.location as string) || "";
    const time = (HTMLAttributes.time as string) || "";
    const meta = [location, time].filter(Boolean).join(" · ");
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-vn": "scene-heading",
        class: "vn-scene-heading",
      }),
      meta
        ? ["span", { class: "vn-scene-heading-meta", contenteditable: "false" }, meta]
        : "",
      ["span", { class: "vn-scene-heading-title" }, 0],
    ];
  },
});

// ============================================================
// Choice — wraps a list of options.
// ============================================================
export const Choice = Node.create({
  name: "choice",
  group: "block",
  content: "choiceOption+",
  defining: true,

  addAttributes() {
    return {
      id: { default: "" },
      prompt: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-vn="choice"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const prompt = (HTMLAttributes.prompt as string) || "Choose…";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-vn": "choice",
        class: "vn-choice",
      }),
      [
        "div",
        { class: "vn-choice-prompt", contenteditable: "false" },
        prompt,
      ],
      ["div", { class: "vn-choice-options" }, 0],
    ];
  },
});

// ============================================================
// Choice option — single branch.
// ============================================================
export const ChoiceOption = Node.create({
  name: "choiceOption",
  group: "block",
  content: "inline*",
  defining: true,

  addAttributes() {
    return {
      id: { default: "" },
      target: { default: "" },
      flag: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-vn="choice-option"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const target = (HTMLAttributes.target as string) || "";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-vn": "choice-option",
        class: "vn-choice-option",
      }),
      ["span", { class: "vn-choice-bullet", contenteditable: "false" }, "▸"],
      ["span", { class: "vn-choice-text" }, 0],
      target
        ? ["span", { class: "vn-choice-target", contenteditable: "false" }, `→ ${target}`]
        : "",
    ];
  },
});

// ============================================================
// BGM / SFX inline markers.
// ============================================================
export const BGMMarker = Node.create({
  name: "bgmMarker",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      track: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-vn="bgm"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const track = (HTMLAttributes.track as string) || "—";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-vn": "bgm",
        class: "vn-marker vn-bgm",
      }),
      `♪ ${track}`,
    ];
  },
});

export const SFXMarker = Node.create({
  name: "sfxMarker",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      sound: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-vn="sfx"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const sound = (HTMLAttributes.sound as string) || "—";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-vn": "sfx",
        class: "vn-marker vn-sfx",
      }),
      `🔊 ${sound}`,
    ];
  },
});

export const ALL_VN_NODES = [
  Dialogue,
  Direction,
  SceneHeading,
  Choice,
  ChoiceOption,
  BGMMarker,
  SFXMarker,
];
