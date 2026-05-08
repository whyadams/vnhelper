/**
 * LM Studio integration via OpenAI-compatible API.
 * Default endpoint: http://localhost:1234/v1
 * Docs: https://lmstudio.ai/docs/local-server
 *
 * Uses Tauri's @tauri-apps/plugin-http to bypass webview restrictions
 * on localhost connections (Tauri 2 webview blocks direct fetch by default).
 * Falls back to native fetch when running outside Tauri.
 */
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const isTauri =
  typeof window !== "undefined" &&
  // @ts-expect-error tauri injects this into window
  (window.__TAURI_INTERNALS__ !== undefined ||
    // @ts-expect-error legacy
    window.__TAURI__ !== undefined);

const httpFetch: typeof fetch = isTauri
  ? (tauriFetch as unknown as typeof fetch)
  : globalThis.fetch.bind(globalThis);

export interface AISettings {
  baseUrl: string;
  model: string;
  apiKey: string; // LM Studio doesn't require one but field exists for compat
}

const STORAGE_KEY = "vnhelper.ai.settings";

const DEFAULT_SETTINGS: AISettings = {
  baseUrl: "http://localhost:1234/v1",
  model: "",
  apiKey: "",
};

export function loadAISettings(): AISettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AISettings>;
    return {
      baseUrl: parsed.baseUrl?.trim() || DEFAULT_SETTINGS.baseUrl,
      model: parsed.model?.trim() ?? "",
      apiKey: parsed.apiKey ?? "",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAISettings(s: AISettings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export interface ModelInfo {
  id: string;
}

/** GET /v1/models — list models loaded in LM Studio. */
export async function listModels(
  settings: AISettings,
): Promise<ModelInfo[]> {
  const r = await httpFetch(
    `${settings.baseUrl.replace(/\/+$/, "")}/models`,
    {
      headers: settings.apiKey
        ? { Authorization: `Bearer ${settings.apiKey}` }
        : {},
    },
  );
  if (!r.ok) throw new Error(`Models endpoint returned ${r.status}`);
  const data = (await r.json()) as { data?: ModelInfo[] };
  return data.data ?? [];
}

export type AIAction = "format" | "improve" | "summarize" | "continue";

const SYSTEM_PROMPTS: Record<AIAction, string> = {
  format: `You are a writing assistant. The user will give you HTML content from a notes editor.
Reformat it into clean, well-structured HTML using <h1>, <h2>, <h3>, <p>, <ul>, <ol>, <li>, <blockquote>, <code>, <pre>, <strong>, <em>, <a> as appropriate.
- DO NOT add new information that isn't in the source.
- DO NOT remove information from the source.
- Preserve URLs, code blocks, names, numbers exactly.
- Make headings reflect logical sections.
- Return ONLY the HTML body content. No <html>, <body>, no markdown code fences, no explanations.`,
  improve: `You are an editing assistant. The user will give you HTML content from a notes editor.
Improve writing quality: fix grammar/spelling, improve clarity and flow, tighten verbose sentences.
- Preserve the original meaning and all facts/numbers/names exactly.
- Keep the same overall structure (headings, lists, blockquotes).
- Return ONLY the cleaned-up HTML body content. No <html>, <body>, no markdown code fences, no explanations.`,
  summarize: `You are a summarization assistant. The user will give you HTML content from a notes editor.
Produce a concise summary as HTML with:
- A short opening paragraph (1-2 sentences) of the gist.
- A <h3>Key points</h3> heading followed by a <ul> bullet list of the most important ideas (3-7 bullets).
- Optionally a <h3>Action items</h3> section if the source contains tasks/decisions.
Return ONLY the HTML body content. No <html>, <body>, no markdown code fences, no explanations.`,
  continue: `You are a writing assistant. The user will give you HTML content they have written so far.
Continue writing in the same voice and style for ~2-4 more paragraphs. Match the existing tone, register, and formatting.
- Do not summarize what was already said.
- Do not introduce yourself.
- Return ONLY new HTML body content to be APPENDED after the existing content. No <html>, no markdown code fences, no explanations.`,
};

export async function runAIAction(
  action: AIAction,
  inputHtml: string,
  settings: AISettings,
  signal?: AbortSignal,
): Promise<string> {
  const url = settings.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const body = {
    model: settings.model || "lmstudio-community/local",
    messages: [
      { role: "system", content: SYSTEM_PROMPTS[action] },
      { role: "user", content: inputHtml },
    ],
    temperature: action === "summarize" ? 0.3 : 0.5,
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

/**
 * Strip common LLM "wrappers": fenced ```html blocks, <think> reasoning,
 * leading/trailing whitespace, accidental commentary lines.
 */
function cleanLLMOutput(s: string): string {
  let out = s.trim();

  // 1. Strip <think>…</think> blocks (some reasoning models inline thinking
  //    even when LM Studio also exposes it via reasoning_content).
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // 2. Strip a fenced wrapper of any language tag (```html, ```markdown,
  //    bare ```, etc.) covering the whole content.
  //    Allow optional trailing newline before the closing fence.
  const fence = out.match(/^```[a-zA-Z]*[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*```[ \t]*$/);
  if (fence) {
    out = fence[1].trim();
  } else if (out.startsWith("```") && out.endsWith("```")) {
    // Defensive fallback: drop first and last lines if both look like fences.
    const lines = out.split("\n");
    if (
      lines.length >= 2 &&
      /^```[a-zA-Z]*\s*$/.test(lines[0]) &&
      /^```\s*$/.test(lines[lines.length - 1])
    ) {
      out = lines.slice(1, -1).join("\n").trim();
    }
  }

  // 3. Drop a single-line preamble ("Here's the formatted version:" etc.)
  //    when followed by HTML.
  const firstNl = out.indexOf("\n");
  if (firstNl > 0 && firstNl < 200) {
    const firstLine = out.slice(0, firstNl).trim();
    const rest = out.slice(firstNl + 1).trim();
    if (
      /^(here(?:'s| is| you go)|sure|certainly|of course|formatted version|the formatted)/i.test(
        firstLine,
      ) &&
      /^</.test(rest)
    ) {
      out = rest;
    }
  }

  return out;
}
