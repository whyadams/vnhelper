import { useEffect, useState } from "react";
import type { ScriptCharacter } from "../../state/scripts";

interface Props {
  /** Container the editor lives inside — we bind delegated listeners here. */
  rootRef: React.RefObject<HTMLElement | null>;
  characters: ScriptCharacter[];
}

interface Hover {
  character: ScriptCharacter;
  rect: DOMRect;
}

/**
 * Hovers over `.vn-mention[data-character-id]` inside `rootRef` show a
 * tooltip with the character's avatar / color / aliases / role.
 *
 * Uses event delegation so it works for ProseMirror Decoration spans
 * (which are recreated on every doc change).
 */
export function CharacterMentionTooltip({ rootRef, characters }: Props) {
  const [hover, setHover] = useState<Hover | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const byId = new Map(characters.map((c) => [c.id, c]));

    const onOver = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const el = target.closest<HTMLElement>(".vn-mention[data-character-id]");
      if (!el) return;
      const id = el.getAttribute("data-character-id");
      if (!id) return;
      const character = byId.get(id);
      if (!character) return;
      const rect = el.getBoundingClientRect();
      setHover({ character, rect });
    };

    const onOut = (e: Event) => {
      const target = e.target as HTMLElement | null;
      const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
      if (!target?.closest(".vn-mention[data-character-id]")) return;
      // Stay open if cursor moved into another mention or into the tooltip
      if (related?.closest(".vn-mention-tooltip")) return;
      if (related?.closest(".vn-mention[data-character-id]")) return;
      setHover(null);
    };

    const onScroll = () => setHover(null);

    root.addEventListener("mouseover", onOver);
    root.addEventListener("mouseout", onOut);
    window.addEventListener("scroll", onScroll, true);

    return () => {
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseout", onOut);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [rootRef, characters]);

  if (!hover) return null;
  const { character, rect } = hover;

  // Position centered above the mention; flip to below if not enough room.
  const margin = 8;
  const tooltipMaxWidth = 280;
  const left = Math.max(
    margin,
    Math.min(
      window.innerWidth - tooltipMaxWidth - margin,
      rect.left + rect.width / 2 - tooltipMaxWidth / 2,
    ),
  );
  const showAbove = rect.top > 180;
  const top = showAbove ? rect.top - margin : rect.bottom + margin;

  return (
    <div
      className={
        "vn-mention-tooltip" + (showAbove ? " is-above" : " is-below")
      }
      style={{
        position: "fixed",
        left,
        top,
        maxWidth: tooltipMaxWidth,
        ...(showAbove ? { transform: "translateY(-100%)" } : null),
        ["--vn-mention-color" as string]: character.color,
      }}
      role="tooltip"
    >
      <div className="vn-mention-tooltip-head">
        {character.avatar_url ? (
          <img
            src={character.avatar_url}
            alt=""
            className="vn-mention-tooltip-avatar"
            style={{ borderColor: character.color }}
          />
        ) : (
          <span
            className="vn-mention-tooltip-avatar vn-mention-tooltip-avatar-fallback"
            style={{ background: character.color }}
          >
            {character.emoji ??
              (character.short_name ?? character.name)
                .slice(0, 2)
                .toUpperCase()}
          </span>
        )}
        <div className="vn-mention-tooltip-meta">
          <div
            className="vn-mention-tooltip-name"
            style={{ color: character.color }}
          >
            {character.name}
          </div>
          <div className="vn-mention-tooltip-sub">
            {[character.role, character.pronouns, character.age]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
        </div>
      </div>
      {character.aliases.length > 0 && (
        <div className="vn-mention-tooltip-aliases">
          <span className="vn-mention-tooltip-label">aka</span>
          {character.aliases.map((a) => (
            <span key={a} className="vn-mention-tooltip-alias">
              {a}
            </span>
          ))}
        </div>
      )}
      {character.voice_notes && (
        <div className="vn-mention-tooltip-voice">{character.voice_notes}</div>
      )}
    </div>
  );
}
