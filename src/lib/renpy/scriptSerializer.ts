/**
 * Ren'Py script serializer — turns `RpyBlock[]` back into a `.rpy` source
 * string. Designed to be the exact inverse of `parseRpyScript` for the
 * structured block kinds, and byte-faithful for `raw` blocks (whose
 * `lines` are stored depth-stripped — we re-add the block's depth on emit).
 *
 * The serializer never validates structure — it trusts the editor / parser
 * to produce sane input. Out-of-range depths and dangling choices are
 * simply rendered as-is.
 */

import { INDENT_UNIT, type RpyBlock } from "./blocks";

export interface SerializeOptions {
  /**
   * Trailing newline at the end of the document. Defaults to true to match
   * the Ren'Py community convention (and most editors will add one anyway).
   */
  trailingNewline?: boolean;
}

export function serializeRpyScript(
  blocks: RpyBlock[],
  options: SerializeOptions = {},
): string {
  const { trailingNewline = true } = options;
  const out: string[] = [];

  for (const b of blocks) {
    const indent = INDENT_UNIT.repeat(Math.max(0, b.depth));
    switch (b.kind) {
      case "label":
        out.push(`${indent}label ${b.name}:`);
        break;
      case "scene":
        out.push(
          `${indent}scene ${b.bg}${b.transition ? ` with ${b.transition}` : ""}`,
        );
        break;
      case "show":
        out.push(
          `${indent}show ${[b.char, b.expression].filter(Boolean).join(" ")}` +
            `${b.position ? ` at ${b.position}` : ""}` +
            `${b.transition ? ` with ${b.transition}` : ""}`,
        );
        break;
      case "hide":
        out.push(
          `${indent}hide ${b.char}${b.transition ? ` with ${b.transition}` : ""}`,
        );
        break;
      case "say": {
        const prefix = [b.char_var, b.expression].filter(Boolean).join(" ");
        out.push(`${indent}${prefix} "${escapeRpyString(b.text)}"`);
        break;
      }
      case "narrator":
        out.push(`${indent}"${escapeRpyString(b.text)}"`);
        break;
      case "menu":
        out.push(`${indent}menu:`);
        break;
      case "choice":
        out.push(
          `${indent}"${escapeRpyString(b.text)}"` +
            `${b.condition ? ` if ${b.condition}` : ""}:`,
        );
        break;
      case "jump":
        out.push(`${indent}jump ${b.target}`);
        break;
      case "call":
        out.push(`${indent}call ${b.target}`);
        break;
      case "return":
        out.push(
          b.expression !== undefined
            ? `${indent}return ${b.expression}`
            : `${indent}return`,
        );
        break;
      case "with":
        out.push(`${indent}with ${b.transition}`);
        break;
      case "pause":
        out.push(
          b.duration !== undefined
            ? `${indent}pause ${formatNumber(b.duration)}`
            : `${indent}pause`,
        );
        break;
      case "note":
        out.push(b.text === "" ? `${indent}#` : `${indent}# ${b.text}`);
        break;
      case "raw":
        // Raw lines are stored depth-stripped (depth=0). Re-add this block's
        // indentation; preserve internal relative indentation byte-for-byte.
        // Blank captured lines stay blank (no trailing whitespace from indent).
        for (const line of b.lines) {
          out.push(line === "" ? "" : `${indent}${line}`);
        }
        break;
    }
  }

  let result = out.join("\n");
  if (trailingNewline && !result.endsWith("\n")) result += "\n";
  return result;
}

/** Escape `"` and `\` for emission inside a Ren'Py double-quoted string. */
function escapeRpyString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** Render a number without unnecessary trailing zeroes (`1.5` not `1.50`). */
function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toString();
}
