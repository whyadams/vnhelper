import { useEffect, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { SectionHead } from "./shared";
import { useNotificationSettings } from "../../../state/notificationSettings";

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Notifications settings. Three controls:
 *   - Master toggle. Enabling it requests OS permission (Windows Action
 *     Center on first prompt; macOS / Linux equivalents). If the user has
 *     previously declined we can't auto-re-prompt — they have to flip the
 *     OS setting themselves and re-enable here.
 *   - Day-start hour: when all-day events trigger today.
 *   - Minutes before: how early timed events trigger relative to event_time.
 */
export function NotificationsSection() {
  const [settings, update] = useNotificationSettings();
  const [permission, setPermission] = useState<
    "granted" | "denied" | "default" | "unknown"
  >("unknown");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setPermission("denied");
      return;
    }
    void isPermissionGranted()
      .then((g) => setPermission(g ? "granted" : "default"))
      .catch(() => setPermission("unknown"));
  }, []);

  const toggleEnabled = async () => {
    if (busy) return;
    if (settings.enabled) {
      update({ enabled: false });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Re-check permission inside the toggle so a user who flipped it in
      // Windows Settings then comes back here doesn't get stuck.
      let granted = isTauri() ? await isPermissionGranted() : false;
      if (!granted && isTauri()) {
        const result = await requestPermission();
        granted = result === "granted";
        setPermission(result === "granted" ? "granted" : "denied");
      }
      if (!granted) {
        setError(
          "Не получили разрешение на уведомления. Открой настройки Windows → Notifications → VnHelper и включи их вручную.",
        );
        return;
      }
      update({ enabled: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionHead
        title="Notifications"
        subtitle="Десктопные уведомления о событиях календаря."
      />

      <div className="set-card">
        <div className="set-card-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="set-row-title">
              Уведомлять о событиях календаря
            </div>
            <div className="set-row-desc" style={{ marginTop: 4 }}>
              VnHelper будет показывать всплывающее уведомление Windows в
              день события. Для своевременных уведомлений включи также
              автозапуск в General — иначе тосты придут только когда
              приложение открыто.
            </div>
          </div>
          {!isTauri() ? (
            <div className="set-row-desc">
              Доступно только в desktop-сборке.
            </div>
          ) : (
            <button
              type="button"
              className={
                "set-toggle" + (settings.enabled ? " is-on" : "")
              }
              onClick={() => void toggleEnabled()}
              disabled={busy}
              aria-pressed={settings.enabled}
              aria-label="Toggle calendar notifications"
            >
              <span className="set-toggle-thumb" />
            </button>
          )}
        </div>

        {permission === "denied" && (
          <div
            className="set-row-desc"
            style={{ marginTop: 8, color: "rgba(220, 140, 140, 0.85)" }}
          >
            Разрешение на уведомления отозвано в системе. Открой Параметры
            Windows → Система → Уведомления → VnHelper и включи их.
          </div>
        )}
        {error && <div className="set-error">{error}</div>}
      </div>

      <div
        className="set-card"
        style={{ marginTop: 16, opacity: settings.enabled ? 1 : 0.55 }}
      >
        <div className="set-card-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="set-row-title">Время для all-day событий</div>
            <div className="set-row-desc" style={{ marginTop: 4 }}>
              В какое время дня показать уведомление о событии без
              конкретного времени.
            </div>
          </div>
          <input
            type="time"
            className="vn-input vn-input-date"
            style={{ width: 100 }}
            value={`${String(settings.dayStartHour).padStart(2, "0")}:00`}
            disabled={!settings.enabled}
            onChange={(e) => {
              const [h] = e.target.value.split(":").map(Number);
              if (Number.isFinite(h)) update({ dayStartHour: h });
            }}
          />
        </div>

        <div className="set-card-row" style={{ marginTop: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="set-row-title">
              Минут до события (timed)
            </div>
            <div className="set-row-desc" style={{ marginTop: 4 }}>
              За сколько минут уведомить о событии с конкретным временем.
              0 — точно в момент начала.
            </div>
          </div>
          <input
            type="number"
            min={0}
            max={1440}
            step={5}
            className="vn-input"
            style={{ width: 80, textAlign: "right" }}
            value={settings.minutesBefore}
            disabled={!settings.enabled}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 0)
                update({ minutesBefore: Math.min(1440, Math.max(0, n)) });
            }}
          />
        </div>
      </div>
    </>
  );
}
