import { useMemo } from "react";
import type { ScriptContent } from "../../state/scripts";

/**
 * Pure word/line/speaker counter for the TipTap doc JSON. Lives in its own
 * module (not next to `ScriptEditor`) so the Renpy tab can read script stats
 * without static-importing TipTap / ProseMirror / VN node extensions. That
 * static import is what was forcing TipTap to initialize even when the user
 * only ever looked at the Renpy tab.
 */
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
      const obj = n as {
        type?: string;
        text?: string;
        attrs?: { speaker?: string };
        content?: unknown[];
      };
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
