import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "../../state/AuthProvider";
import { supabase } from "../../lib/supabase";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const MCP_ENTRY = "E:/Desktop/VnHelper/packages/vnhelper-mcp/dist/cli.js";

type ConnectStatus =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "ok"; authPath: string; envPath: string; command: string }
  | { kind: "error"; message: string };

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { user, session } = useAuth();
  const [status, setStatus] = useState<ConnectStatus>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setStatus({ kind: "idle" });
      setCopied(false);
    }
  }, [open]);

  const buildCommand = (workspaceId: string | null) => {
    const wsFlag = workspaceId
      ? ` --env VNHELPER_DEFAULT_WORKSPACE_ID=${workspaceId}`
      : "";
    return (
      `claude mcp add vnhelper --scope user` +
      ` --env VNHELPER_SUPABASE_URL=${SUPABASE_URL}` +
      ` --env VNHELPER_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}` +
      wsFlag +
      ` -- node "${MCP_ENTRY}"`
    );
  };

  const handleConnect = async () => {
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
      // Refresh session to ensure tokens are current.
      const fresh = await supabase.auth.refreshSession();
      const s = fresh.data.session ?? session;

      const authResult = await invoke<{ path: string }>("write_mcp_auth", {
        auth: {
          access_token: s.access_token,
          refresh_token: s.refresh_token,
          expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
          user_id: s.user.id,
          email: s.user.email ?? user.email ?? "",
        },
      });

      // Fetch the user's workspaces; if exactly one, bake it as default.
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
      });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleCopy = async () => {
    if (status.kind !== "ok") return;
    try {
      await navigator.clipboard.writeText(status.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore
    }
  };

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-head">
          <h2>Settings</h2>
          <button
            className="settings-close"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-card">
            <div className="settings-card-row">
              <div>
                <h3 className="settings-card-title">Connect Claude (MCP)</h3>
                <p className="settings-card-sub">
                  Дай Claude Code доступ к твоим задачам, сценариям и
                  персонажам. Один клик — и токены сохранятся в{" "}
                  <code>~/.vnhelper/</code>.
                </p>
              </div>
              <button
                type="button"
                className="settings-btn-primary"
                onClick={() => void handleConnect()}
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
              <div className="settings-error">{status.message}</div>
            )}

            {status.kind === "ok" && (
              <>
                <div className="settings-info">
                  <div>
                    <strong>Auth saved:</strong> <code>{status.authPath}</code>
                  </div>
                  <div>
                    <strong>Config saved:</strong> <code>{status.envPath}</code>
                  </div>
                </div>

                <div className="settings-step">
                  <div className="settings-step-num">1</div>
                  <div className="settings-step-body">
                    <div className="settings-step-title">
                      Скопируй и выполни в терминале (PowerShell / cmd):
                    </div>
                    <div className="settings-cmd">
                      <pre>{status.command}</pre>
                      <button
                        type="button"
                        className="settings-cmd-copy"
                        onClick={() => void handleCopy()}
                      >
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="settings-step">
                  <div className="settings-step-num">2</div>
                  <div className="settings-step-body">
                    <div className="settings-step-title">
                      Перезапусти Claude Code.
                    </div>
                    <div className="settings-step-hint">
                      В команде <code>/mcp</code> появится сервер{" "}
                      <code>vnhelper</code>. Скажи ему «список моих задач» —
                      проверь, что отвечает.
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>

          <section className="settings-card">
            <h3 className="settings-card-title">Account</h3>
            <p className="settings-card-sub">
              Signed in as <strong>{user?.email ?? "—"}</strong>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
