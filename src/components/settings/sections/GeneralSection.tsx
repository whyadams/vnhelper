import { useEffect, useState } from "react";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../../../i18n";
import { SectionHead } from "./shared";

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * General app settings — currently:
 *   - "Запускать вместе с Windows" toggle wired to tauri-plugin-autostart
 *     (writes to HKCU\Software\Microsoft\Windows\CurrentVersion\Run on
 *     Windows; LaunchAgent on macOS; .desktop file on Linux).
 *
 * Pairs with the Notifications section: with autostart on, RenHub sits
 * in the tray and event-day notifications can fire even when the user
 * hasn't manually opened the app.
 */
export function GeneralSection() {
  const { t, i18n } = useTranslation();
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentLang =
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.resolvedLanguage)?.code ??
    "en";

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
        title={t("settings.section.general")}
      />

      <div className="set-card">
        <div className="set-card-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="set-row-title">{t("settings.general.autostart_title")}</div>
            <div className="set-row-desc" style={{ marginTop: 4 }}>
              {t("settings.general.autostart_hint")}
            </div>
          </div>
          {!isTauri() ? (
            <div className="set-row-desc" style={{ minWidth: 0 }}>
              {t("settings.general.autostart_unavailable")}
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
              aria-label={t("settings.general.autostart_title")}
            >
              <span className="set-toggle-thumb" />
            </button>
          )}
        </div>
        {error && <div className="set-error">{error}</div>}
      </div>

      <div className="set-card" style={{ marginTop: 16 }}>
        <div className="set-card-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="set-row-title">
              {t("settings.general.language_title")}
            </div>
            <div className="set-row-desc" style={{ marginTop: 4 }}>
              {t("settings.general.language_hint")}
            </div>
          </div>
          <select
            className="set-select"
            value={currentLang}
            onChange={(e) => void i18n.changeLanguage(e.target.value)}
            aria-label={t("settings.general.language_title")}
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeLabel}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}
