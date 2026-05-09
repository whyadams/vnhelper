// Unescape the contents of a Ren'Py double-quoted string (caller strips quotes).
export function unescapeRenpyString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\" || i === raw.length - 1) {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === '"') { out += '"'; i++; }
    else if (next === "\\") { out += "\\"; i++; }
    else if (next === "n") { out += "\n"; i++; }
    else { out += ch; }
  }
  return out;
}

// Inverse of unescapeRenpyString. Idempotent under round-trip.
export function escapeRenpyString(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else out += ch;
  }
  return out;
}
