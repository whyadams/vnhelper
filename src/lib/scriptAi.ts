/**
 * VN-script-specific AI helpers, on top of the same LM Studio client.
 * Reuses `loadAISettings` from aiClient.ts.
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { loadAISettings, type AISettings } from "./aiClient";

const isTauri =
  typeof window !== "undefined" &&
  // @ts-expect-error tauri injects this into window
  (window.__TAURI_INTERNALS__ !== undefined ||
    // @ts-expect-error legacy
    window.__TAURI__ !== undefined);

const httpFetch: typeof fetch = isTauri
  ? (tauriFetch as unknown as typeof fetch)
  : globalThis.fetch.bind(globalThis);

export type ScriptAIAction =
  | "dialogue-in-voice"
  | "suggest-choices"
  | "beat-sheet"
  | "tighten"
  | "continue-scene"
  | "describe-location";

export interface CharacterCtx {
  name: string;
  shortName?: string | null;
  pronouns?: string | null;
  role?: string | null;
  voiceNotes?: string | null;
  traits?: Record<string, unknown> | null;
}

export interface ScriptAICtx {
  projectTitle?: string;
  synopsis?: string;
  sceneTitle?: string;
  characters?: CharacterCtx[];
  povCharacter?: string | null;
  location?: string | null;
}

const SYSTEM_PROMPTS: Record<ScriptAIAction, (ctx: ScriptAICtx) => string> = {
  "dialogue-in-voice": (ctx) =>
    `You are a visual-novel writing assistant.
The user will give you HTML from a scene. Continue with 2-4 lines of dialogue
in the existing voices.
${
  ctx.characters && ctx.characters.length > 0
    ? `Characters in this project:\n${ctx.characters
        .map(
          (c) =>
            `- ${c.name}${c.role ? ` (${c.role})` : ""}: ${
              c.voiceNotes || "no voice notes"
            }`,
        )
        .join("\n")}`
    : ""
}
- Use <div data-vn="dialogue" speaker="NAME" shortName="NAME">…</div> for each line.
- Optionally use <p data-vn="direction">…</p> for short action beats.
- Keep each character's voice consistent. Match their traits, age, role.
- Do NOT introduce new characters not listed above.
Return ONLY HTML body content. No <html>, no markdown fences, no preamble.`,

  "suggest-choices": (ctx) =>
    `You are a branching-narrative assistant for visual novels.
Given the HTML scene the user is writing, propose 3 player choices that fit
the moment. Each choice should hint at a different tone (e.g. earnest, jokey,
guarded).
${ctx.povCharacter ? `Player POV: ${ctx.povCharacter}.` : ""}
Return ONLY one block:
<div data-vn="choice" prompt="What do you say?">
  <div data-vn="choice-option">…</div>
  <div data-vn="choice-option">…</div>
  <div data-vn="choice-option">…</div>
</div>
No explanation, no fences, no extra text.`,

  "beat-sheet": () =>
    `You are a story editor. Compress the user's scene HTML into 5-7 beats —
the structural turns that drive the scene forward.
Return as:
<h3>Beats</h3>
<ol>
  <li><strong>Hook</strong> — …</li>
  <li><strong>Turn</strong> — …</li>
  …
</ol>
Use neutral analytic language. Return ONLY HTML body, no fences.`,

  tighten: () =>
    `You are a script editor for visual novels.
Tighten the user's scene: cut redundancy, shorten stage exposition, sharpen
each line, but PRESERVE every character's voice and every plot beat.
Keep the same VN structure: <div data-vn="dialogue">, <p data-vn="direction">,
<div data-vn="scene-heading">, etc.
Return ONLY the cleaned-up HTML body. No fences, no commentary.`,

  "continue-scene": (ctx) =>
    `You are co-writing a visual-novel scene.
Continue the user's HTML from where it stops. Add roughly the next 6-12 beats
(mix of dialogue and brief direction). Match the existing tone.
${ctx.povCharacter ? `Player POV: ${ctx.povCharacter}.` : ""}
${ctx.location ? `Location: ${ctx.location}.` : ""}
${
  ctx.characters && ctx.characters.length > 0
    ? `Cast available:\n${ctx.characters
        .map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}`)
        .join("\n")}`
    : ""
}
Use <div data-vn="dialogue" speaker="NAME"> for spoken lines and
<p data-vn="direction"> for short action / mood lines. Don't end on a wrap-up.
Return ONLY new HTML body to be APPENDED. No fences, no preamble.`,

  "describe-location": (ctx) =>
    `Write a short, evocative location description suitable for a visual novel
scene-setter. ${
      ctx.location ? `Location name: ${ctx.location}.` : ""
    }
2-3 sentences in present tense. Atmospheric, sensory, not florid.
Return as a single <p data-vn="direction">…</p>. No fences, no preamble.`,
};

export async function runScriptAI(
  action: ScriptAIAction,
  inputHtml: string,
  ctx: ScriptAICtx,
  signal?: AbortSignal,
  settingsOverride?: AISettings,
): Promise<string> {
  const settings = settingsOverride ?? loadAISettings();
  const url = settings.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const sys = SYSTEM_PROMPTS[action](ctx);
  const projectIntro = [
    ctx.projectTitle ? `Project: ${ctx.projectTitle}` : "",
    ctx.synopsis ? `Synopsis: ${ctx.synopsis}` : "",
    ctx.sceneTitle ? `Scene: ${ctx.sceneTitle}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const user = projectIntro
    ? `${projectIntro}\n\n---\n\n${inputHtml}`
    : inputHtml;
  const body = {
    model: settings.model || "lmstudio-community/local",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    temperature: action === "beat-sheet" || action === "tighten" ? 0.3 : 0.6,
    stream: false,
  };
  const r = await httpFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.apiKey
        ? { Authorization: `Bearer ${settings.apiKey}` }
        : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(
      `LM Studio returned ${r.status}: ${text.slice(0, 300) || "empty body"}`,
    );
  }
  const data = (await r.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(data.error.message);
  const content = data.choices?.[0]?.message?.content ?? "";
  return cleanLLMOutput(content);
}

function cleanLLMOutput(s: string): string {
  let out = s.trim();
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = out.match(
    /^```[a-zA-Z]*[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*```[ \t]*$/,
  );
  if (fence) out = fence[1].trim();
  const firstNl = out.indexOf("\n");
  if (firstNl > 0 && firstNl < 200) {
    const firstLine = out.slice(0, firstNl).trim();
    const rest = out.slice(firstNl + 1).trim();
    if (
      /^(here(?:'s| is| you go)|sure|certainly|of course|the .{0,30} version)/i.test(
        firstLine,
      ) &&
      /^</.test(rest)
    ) {
      out = rest;
    }
  }
  return out;
}
