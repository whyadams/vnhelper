import { useState, type MouseEvent } from "react";

interface Props {
  /** The actual string copied to the clipboard. */
  value: string;
  /** Tooltip label, e.g. "Copy file id (for MCP)". The full value is appended
   *  on the next line so the user can sanity-check what they're grabbing. */
  title?: string;
  /** Small label rendered next to the icon, e.g. "id". Hidden by default —
   *  use when the button stands alone (not pinned to a row). */
  label?: string;
  /** Visual size. `xs` = 14px icon for tree rows, `sm` = 16px for cards. */
  size?: "xs" | "sm";
  className?: string;
  /** Stop the click from bubbling up to a row's onClick. On by default. */
  stopPropagation?: boolean;
}

/**
 * Small clipboard button next to entity rows so the user can hand the
 * underlying id to Claude (via MCP) without clicking through the UI to
 * read it. Click → writes to clipboard → flashes "✓" for ~1.5s.
 *
 * Reusable across translation files, script nodes, characters, etc — the
 * goal is to make "tell Claude exactly which scene to edit" a one-click
 * operation instead of an explanation in prose.
 */
export function CopyButton({
  value,
  title,
  label,
  size = "xs",
  className,
  stopPropagation = true,
}: Props) {
  const [copied, setCopied] = useState(false);

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) e.stopPropagation();
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch((err) => {
        console.error("clipboard write failed", err);
      });
  };

  const tooltip = title ? `${title}\n${value}` : `Copy: ${value}`;

  return (
    <button
      type="button"
      className={
        "copy-btn copy-btn-" + size + (copied ? " is-copied" : "") +
        (className ? " " + className : "")
      }
      onClick={onClick}
      onMouseDown={(e) => {
        // Same drag-suppression trick we use on tree carets — without this a
        // mouse-drift between mousedown and click cancels the click when the
        // host row has draggable=true.
        if (stopPropagation) e.stopPropagation();
      }}
      title={tooltip}
      aria-label={title ?? "Copy"}
    >
      {copied ? (
        <CheckGlyph />
      ) : (
        <ClipboardGlyph />
      )}
      {label && <span className="copy-btn-label">{copied ? "Copied" : label}</span>}
    </button>
  );
}

function ClipboardGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="M9 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
