import { useEffect, useRef, useState, type KeyboardEvent } from "react";

const PRESET_COLORS = [
  "#6aa6ff",
  "#ff7aa2",
  "#9ad36a",
  "#f5b94a",
  "#bf8cff",
  "#ff8a65",
  "#3ec2c2",
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    name: string;
    aliases: string[];
    color: string;
    emoji: string;
  }) => void;
  /** Existing names — used to avoid duplicates and pre-fill suggestions. */
  existingNames?: string[];
}

export function QuickAddCharacterModal({
  open,
  onClose,
  onSubmit,
  existingNames = [],
}: Props) {
  const [step, setStep] = useState<"name" | "aliases">("name");
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState<string[]>([]);
  const [aliasDraft, setAliasDraft] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [emoji, setEmoji] = useState("");
  const nameRef = useRef<HTMLInputElement | null>(null);
  const aliasRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("name");
    setName("");
    setAliases([]);
    setAliasDraft("");
    setColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]);
    setEmoji("");
    setTimeout(() => nameRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (step === "aliases") {
      setTimeout(() => aliasRef.current?.focus(), 30);
    }
  }, [step]);

  if (!open) return null;

  const trimmedName = name.trim();
  const isDuplicate =
    !!trimmedName &&
    existingNames.some((n) => n.toLowerCase() === trimmedName.toLowerCase());

  const goNext = () => {
    if (!trimmedName || isDuplicate) return;
    setStep("aliases");
  };

  const addAlias = () => {
    const v = aliasDraft.trim();
    if (!v) return;
    if (
      v.toLowerCase() === trimmedName.toLowerCase() ||
      aliases.some((a) => a.toLowerCase() === v.toLowerCase())
    ) {
      setAliasDraft("");
      return;
    }
    setAliases([...aliases, v]);
    setAliasDraft("");
  };
  const removeAlias = (a: string) => {
    setAliases(aliases.filter((x) => x !== a));
  };

  const onAliasKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addAlias();
    } else if (e.key === "Backspace" && !aliasDraft && aliases.length > 0) {
      removeAlias(aliases[aliases.length - 1]);
    }
  };

  const submit = () => {
    if (!trimmedName) return;
    // Commit any pending alias the user typed but didn't Enter
    const finalAliases = aliasDraft.trim()
      ? [...aliases, aliasDraft.trim()].filter(
          (v, i, arr) =>
            arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i,
        )
      : aliases;
    onSubmit({
      name: trimmedName,
      aliases: finalAliases,
      color,
      emoji: emoji.trim(),
    });
    onClose();
  };

  return (
    <div className="vn-modal-backdrop" onClick={onClose}>
      <div
        className="vn-modal vn-quick-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="vn-modal-head">
          <h3>
            {step === "name" ? "Add character" : `New character: ${trimmedName}`}
          </h3>
          <button
            type="button"
            className="vn-drawer-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="vn-quick-steps">
          <span className={"vn-quick-step" + (step === "name" ? " is-active" : " is-done")}>
            1. Name
          </span>
          <span className="vn-quick-step-sep" />
          <span
            className={
              "vn-quick-step" + (step === "aliases" ? " is-active" : "")
            }
          >
            2. Aliases & color
          </span>
        </div>

        <div className="vn-modal-body">
          {step === "name" ? (
            <>
              <label className="vn-modal-label">Character name</label>
              <input
                ref={nameRef}
                className="vn-input"
                placeholder="e.g. Tyler"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") goNext();
                  if (e.key === "Escape") onClose();
                }}
              />
              {isDuplicate && (
                <div className="vn-quick-warn">
                  A character named “{trimmedName}” already exists.
                </div>
              )}
              <div className="vn-quick-hint">
                Next step: add other names to highlight (MC, short forms,
                Cyrillic spellings, nicknames).
              </div>
            </>
          ) : (
            <>
              <label className="vn-modal-label">
                Aliases — names that should also highlight
              </label>
              <div className="vn-alias-chips" style={{ borderColor: color }}>
                {aliases.map((a) => (
                  <span
                    key={a}
                    className="vn-alias-chip"
                    style={{
                      background: color + "22",
                      borderColor: color + "55",
                      color,
                    }}
                    onClick={() => removeAlias(a)}
                    title="Click to remove"
                  >
                    {a}
                    <span className="tag-x">×</span>
                  </span>
                ))}
                <input
                  ref={aliasRef}
                  className="vn-alias-input"
                  value={aliasDraft}
                  onChange={(e) => setAliasDraft(e.target.value)}
                  onKeyDown={onAliasKey}
                  placeholder={
                    aliases.length === 0
                      ? "MC, Тайлер, Ty… (Enter / comma to add)"
                      : "+ alias"
                  }
                />
              </div>
              <div className="vn-quick-hint">
                Tip: anywhere any of these strings appears in the script,
                it will be highlighted in the character's color.
              </div>

              <label className="vn-modal-label" style={{ marginTop: 8 }}>
                Color & emoji
              </label>
              <div className="vn-color-row">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={"vn-color-dot" + (c === color ? " is-active" : "")}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
                <input
                  type="color"
                  className="vn-color-picker"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
                <input
                  className="vn-input"
                  style={{ width: 56, textAlign: "center" }}
                  maxLength={4}
                  placeholder="🌸"
                  value={emoji}
                  onChange={(e) => setEmoji(e.target.value)}
                />
              </div>
              <div className="vn-quick-preview">
                <span
                  className="vn-mention vn-mention-preview"
                  style={
                    {
                      "--vn-mention-color": color,
                    } as React.CSSProperties
                  }
                >
                  {emoji && <span style={{ marginRight: 4 }}>{emoji}</span>}
                  {trimmedName}
                </span>
                <span className="vn-quick-preview-arrow">→</span>
                <span className="vn-quick-preview-label">
                  this is how it will look in the script
                </span>
              </div>
            </>
          )}
        </div>

        <div className="vn-modal-foot">
          {step === "aliases" && (
            <button
              type="button"
              className="hbtn"
              onClick={() => setStep("name")}
            >
              ← Back
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="hbtn" onClick={onClose}>
            Cancel
          </button>
          {step === "name" ? (
            <button
              type="button"
              className="hbtn is-primary"
              onClick={goNext}
              disabled={!trimmedName || isDuplicate}
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              className="hbtn is-primary"
              onClick={submit}
              disabled={!trimmedName}
            >
              Add character
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
