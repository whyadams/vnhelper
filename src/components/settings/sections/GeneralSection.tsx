import { useEffect, useState } from "react";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { SectionHead } from "./shared";

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * General app settings — currently:
 *   - "Запускать вместе с Windows" toggle wired to tauri-plugin-autostart
 *     (writes to HKCU\Software\Microsoft\Windows\CurrentVersion\Run on
 *     Windows; LaunchAgent on macOS; .desktop file on Linux).
 *
 * Pairs with the Notifications section: with autostart on, VnHelper sits
 * in the tray and event-day notifications can fire even when the user
 * hasn't manually opened the app.
 */
export function GeneralSection() {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setAutostart(false);
      return;
    }
    void isAutostartEnabled()
      .then(setAutostart)
      .catch((e) => {
        console.warn("autostart check failed", e);
        setAutostart(false);
      });
  }, []);

  const toggle = async () => {
    if (busy || autostart === null) return;
    setBusy(true);
    setError(null);
    try {
      if (autostart) {
        await disableAutostart();
        setAutostart(false);
      } else {
        await enableAutostart();
        setAutostart(true);
      }
    } catch (e) {
      console.error("autostart toggle failed", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionHead
        title="General"
        subtitle="Базовые настройки приложения."
      />

      <div className="set-card">
        <div className="set-card-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="set-row-title">Запускать вместе с Windows</div>
            <div className="set-row-desc" style={{ marginTop: 4 }}>
              VnHelper будет автоматически открываться при входе в систему
              и тихо висеть в трее. Нужно, чтобы уведомления о событиях
              календаря приходили вовремя, даже если ты не запускал
              приложение вручную.
            </div>
          </div>
          {!isTauri() ? (
            <div className="set-row-desc" style={{ minWidth: 0 }}>
              Доступно только в desktop-сборке.
            </div>
          ) : (
            <button
              type="button"
              className={
                "set-toggle" + (autostart ? " is-on" : "")
              }
              onClick={() => void toggle()}
              disabled={busy || autostart === null}
              aria-pressed={!!autostart}
              aria-label="Toggle autostart"
            >
              <span className="set-toggle-thumb" />
            </button>
          )}
        </div>
        {error && <div className="set-error">{error}</div>}
      </div>

      <div className="set-empty" style={{ marginTop: 16 }}>
        Тема и язык интерфейса пока зашиты по умолчанию (тёмная,
        русско-английский UI). Переключатели появятся в следующих версиях.
      </div>
    </>
  );
}
