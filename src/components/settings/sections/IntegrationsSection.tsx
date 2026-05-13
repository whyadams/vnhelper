import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../state/AuthProvider";
import { SectionHead } from "./shared";

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Dev-time fallback when running outside of a packaged Tauri build (e.g.,
// `pnpm dev` in a browser tab) — the bundled binary resolver returns an
// error, so we fall back to the local checkout's compiled cli.js so devs
// can still test the integration UI without rebuilding the installer.
const DEV_FALLBACK_ENTRY =
  "E:/Desktop/VnHelper/packages/vnhelper-mcp/dist/cli.js";

type Target = "code" | "desktop";

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | {
      kind: "ok";
      authPath: string;
      envPath: string;
      command: string;
      desktopJson: string;
      desktopConfigPaths: string[];
    }
  | { kind: "error"; message: string };

/** Best-effort detection of where Claude Desktop's MCP config lives per
 * platform. On Windows there are TWO valid locations: the regular installer
 * uses %APPDATA%\Claude\, while the Microsoft Store / UWP build sandboxes
 * its config under %LOCALAPPDATA%\Packages\Claude_<hash>\… — the UI shows
 * both and tells the user how to figure out which one applies. */
function claudeDesktopConfigPaths(): string[] {
  const platform =
    typeof navigator !== "undefined" ? navigator.platform : "Win32";
  if (/Mac/i.test(platform)) {
    return ["~/Library/Application Support/Claude/claude_desktop_config.json"];
  }
  if (/Linux/i.test(platform)) {
    return ["~/.config/Claude/claude_desktop_config.json"];
  }
  // Windows — both installer and UWP/Store paths.
  return [
    "%APPDATA%\\Claude\\claude_desktop_config.json",
    "%LOCALAPPDATA%\\Packages\\Claude_<hash>\\LocalCache\\Roaming\\Claude\\claude_desktop_config.json",
  ];
}

export function IntegrationsSection() {
  const { user, session } = useAuth();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [target, setTarget] = useState<Target>("desktop");
  const [copied, setCopied] = useState<"cmd" | "json" | null>(null);
  /** Path to the bundled `vnhelper-mcp(.exe)` sidecar, resolved via Tauri at
   *  mount. `null` while we wait for the IPC. If the resolver fails (e.g.,
   *  the bundled binary is missing in a dev build), we fall back to the
   *  local-checkout cli.js. */
  const [mcpBinary, setMcpBinary] = useState<string | null>(null);
  const [usingBundled, setUsingBundled] = useState(true);

  useEffect(() => {
    if (!isTauri()) {
      setMcpBinary(DEV_FALLBACK_ENTRY);
      setUsingBundled(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const p = await invoke<string>("mcp_binary_path");
        if (!cancelled) {
          setMcpBinary(p);
          setUsingBundled(true);
        }
      } catch (e) {
        console.warn("mcp_binary_path failed, using dev fallback", e);
        if (!cancelled) {
          setMcpBinary(DEV_FALLBACK_ENTRY);
          setUsingBundled(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const buildCommand = (workspaceId: string | null) => {
    if (!mcpBinary) return "";
    const wsFlag = workspaceId
      ? ` --env VNHELPER_DEFAULT_WORKSPACE_ID=${workspaceId}`
      : "";
    const envFlags =
      ` --env VNHELPER_SUPABASE_URL=${SUPABASE_URL}` +
      ` --env VNHELPER_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}` +
      wsFlag;
    // Bundled path: pass the sidecar exe directly — no Node required.
    // Dev fallback path: launch via Node since the .js wasn't compiled.
    const launcher = usingBundled
      ? `"${mcpBinary}"`
      : `node "${mcpBinary}"`;
    return `claude mcp add vnhelper --scope user${envFlags} -- ${launcher}`;
  };

  const buildDesktopJson = (workspaceId: string | null) => {
    if (!mcpBinary) return "";
    const env: Record<string, string> = {
      VNHELPER_SUPABASE_URL: SUPABASE_URL,
      VNHELPER_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
    };
    if (workspaceId) env.VNHELPER_DEFAULT_WORKSPACE_ID = workspaceId;
    const serverEntry = usingBundled
      ? { command: mcpBinary, args: [] as string[], env }
      : { command: "node", args: [mcpBinary], env };
    return JSON.stringify(
      { mcpServers: { vnhelper: serverEntry } },
      null,
      2,
    );
  };

  const connect = async () => {
    if (!session || !user) {
      setStatus({ kind: "error", message: "Not signed in." });
      return;
    }
    if (!isTauri()) {
      setStatus({
        kind: "error",
        message: "Connect Claude is available only in the desktop app.",
      });
      return;
    }
    setStatus({ kind: "working" });
    try {
      const fresh = await supabase.auth.refreshSession();
      const s = fresh.data.session ?? session;

      const authResult = await invoke<{ path: string }>("write_mcp_auth", {
        auth: {
          access_token: s.access_token,
          refresh_token: s.refresh_token,
          expires_at:
            s.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
          user_id: s.user.id,
          email: s.user.email ?? user.email ?? "",
        },
      });

      const { data: ws } = await supabase
        .from("workspaces")
        .select("id")
        .order("created_at", { ascending: true });
      const wsId = ws && ws.length === 1 ? ws[0].id : null;

      const envResult = await invoke<{ path: string }>("write_mcp_env", {
        env: {
          supabase_url: SUPABASE_URL,
          supabase_anon_key: SUPABASE_ANON_KEY,
          default_workspace_id: wsId ?? undefined,
        },
      });

      setStatus({
        kind: "ok",
        authPath: authResult.path,
        envPath: envResult.path,
        command: buildCommand(wsId),
        desktopJson: buildDesktopJson(wsId),
        desktopConfigPaths: claudeDesktopConfigPaths(),
      });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const copy = async (which: "cmd" | "json") => {
    if (status.kind !== "ok") return;
    try {
      const text = which === "cmd" ? status.command : status.desktopJson;
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // ignore
    }
  };

  return (
    <>
      <SectionHead
        title="Integrations"
        subtitle="Подключи Claude к своему рабочему пространству. Поддерживается как Claude Desktop (через config-файл), так и Claude Code (через CLI)."
      />
      <div className="set-card">
        <div className="set-card-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="set-row-title">Claude (MCP)</div>
            <div className="set-row-desc" style={{ marginTop: 4 }}>
              Дай Claude доступ к задачам, сценариям и персонажам. Токены
              сохранятся в <code>~/.vnhelper/</code>, дальше выбери способ
              подключения ниже.
            </div>
          </div>
          <button
            type="button"
            className="set-btn is-primary"
            onClick={() => void connect()}
            disabled={status.kind === "working"}
          >
            {status.kind === "working"
              ? "Saving…"
              : status.kind === "ok"
                ? "Re-export"
                : "Connect Claude"}
          </button>
        </div>

        {status.kind === "error" && (
          <div className="set-error">{status.message}</div>
        )}

        {status.kind === "ok" && (
          <>
            <div className="set-info">
              <div>
                <strong>Auth saved:</strong> <code>{status.authPath}</code>
              </div>
              <div>
                <strong>Config saved:</strong> <code>{status.envPath}</code>
              </div>
            </div>

            {/* Target switcher: Claude Desktop (no CLI needed) vs Claude Code (CLI). */}
            <div
              className="vn-view-toggle"
              role="tablist"
              aria-label="Claude target"
              style={{ alignSelf: "flex-start" }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={target === "desktop"}
                className={
                  "vn-view-toggle-btn" +
                  (target === "desktop" ? " is-active" : "")
                }
                onClick={() => setTarget("desktop")}
                title="Use Claude Desktop (config file)"
              >
                Claude Desktop
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={target === "code"}
                className={
                  "vn-view-toggle-btn" +
                  (target === "code" ? " is-active" : "")
                }
                onClick={() => setTarget("code")}
                title="Use Claude Code CLI"
              >
                Claude Code
              </button>
            </div>

            {target === "desktop" ? (
              <>
                <div className="set-step">
                  <div className="set-step-num">1</div>
                  <div className="set-step-body">
                    <div className="set-step-title">
                      Открой <code>claude_desktop_config.json</code> (или
                      создай, если его нет):
                    </div>
                    {status.desktopConfigPaths.length > 1 ? (
                      <>
                        <div
                          className="set-row-desc"
                          style={{ marginBottom: 6 }}
                        >
                          На Windows два возможных пути в зависимости от
                          сборки Claude Desktop:
                        </div>
                        <div className="set-cmd">
                          <pre>
                            {"# installer (claude.ai/download):\n"}
                            {status.desktopConfigPaths[0]}
                            {"\n\n# Microsoft Store / UWP:\n"}
                            {status.desktopConfigPaths[1]}
                          </pre>
                        </div>
                      </>
                    ) : (
                      <div className="set-cmd">
                        <pre>{status.desktopConfigPaths[0]}</pre>
                      </div>
                    )}
                    <div
                      className="set-row-desc"
                      style={{ marginTop: 6 }}
                    >
                      <strong>Самый надёжный способ найти правильный
                      файл:</strong> в Claude Desktop открой{" "}
                      <code>Settings → Developer → Edit Config</code> — он
                      откроет именно тот файл, который читает твоя сборка.
                    </div>
                  </div>
                </div>

                <div className="set-step">
                  <div className="set-step-num">2</div>
                  <div className="set-step-body">
                    <div className="set-step-title">
                      Вставь блок (или слей с существующим{" "}
                      <code>mcpServers</code>):
                    </div>
                    <div className="set-cmd">
                      <pre>{status.desktopJson}</pre>
                      <button
                        type="button"
                        className="set-cmd-copy"
                        onClick={() => void copy("json")}
                      >
                        {copied === "json" ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <div
                      className="set-row-desc"
                      style={{ marginTop: 6 }}
                    >
                      Если в файле уже есть другие MCP-серверы — просто добавь
                      ключ <code>vnhelper</code> внутрь существующего{" "}
                      <code>mcpServers</code>, не перетирай весь файл.
                    </div>
                  </div>
                </div>

                <div className="set-step">
                  <div className="set-step-num">3</div>
                  <div className="set-step-body">
                    <div className="set-step-title">
                      Полностью закрой Claude Desktop и открой заново.
                    </div>
                    <div className="set-row-desc">
                      Через минуту в любом чате появится значок инструментов
                      MCP — внутри будет сервер <code>vnhelper</code>. Скажи
                      ему «список моих задач» — проверь ответ.
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="set-step">
                  <div className="set-step-num">1</div>
                  <div className="set-step-body">
                    <div className="set-step-title">
                      Убедись, что установлен <code>claude</code> CLI (
                      <code>claude --version</code>). Если нет — поставь его
                      с claude.com/download или через{" "}
                      <code>npm i -g @anthropic-ai/claude-code</code>.
                    </div>
                  </div>
                </div>

                <div className="set-step">
                  <div className="set-step-num">2</div>
                  <div className="set-step-body">
                    <div className="set-step-title">
                      Скопируй и выполни в терминале (PowerShell / cmd):
                    </div>
                    <div className="set-cmd">
                      <pre>{status.command}</pre>
                      <button
                        type="button"
                        className="set-cmd-copy"
                        onClick={() => void copy("cmd")}
                      >
                        {copied === "cmd" ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="set-step">
                  <div className="set-step-num">3</div>
                  <div className="set-step-body">
                    <div className="set-step-title">
                      Перезапусти Claude Code.
                    </div>
                    <div className="set-row-desc">
                      В команде <code>/mcp</code> появится сервер{" "}
                      <code>vnhelper</code>.
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
