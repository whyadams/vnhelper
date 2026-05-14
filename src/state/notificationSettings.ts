import { useEffect, useState } from "react";

/**
 * Per-device notification preferences. Storage is localStorage because these
 * are inherently device-local (one user might want toasts on their work
 * laptop but silence on a shared home machine — Supabase-side persistence
 * would couple all their installs together).
 */

export interface NotificationSettings {
  /** Master toggle. Off by default — user opts in from Settings. */
  enabled: boolean;
  /** Hour-of-day (0-23) when all-day events trigger a toast. */
  dayStartHour: number;
  /** Minutes before a timed event when the toast fires. */
  minutesBefore: number;
}

const KEY = "vnhelper.notifications.settings";

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  dayStartHour: 9,
  minutesBefore: 10,
};

function readSettings(): NotificationSettings {
  if (typeof localStorage === "undefined") {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_NOTIFICATION_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : false,
      dayStartHour:
        typeof parsed.dayStartHour === "number" &&
        parsed.dayStartHour >= 0 &&
        parsed.dayStartHour <= 23
          ? parsed.dayStartHour
          : DEFAULT_NOTIFICATION_SETTINGS.dayStartHour,
      minutesBefore:
        typeof parsed.minutesBefore === "number" && parsed.minutesBefore >= 0
          ? parsed.minutesBefore
          : DEFAULT_NOTIFICATION_SETTINGS.minutesBefore,
    };
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

function writeSettings(next: NotificationSettings) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
}

const STORAGE_EVENT = "vnhelper:notification-settings";

/** Hook giving readers reactive access to the settings + a setter. Changes
 *  broadcast through a custom event so other consumers (the CalendarNotifier
 *  poller, the Settings UI) stay in sync without prop drilling. */
export function useNotificationSettings(): [
  NotificationSettings,
  (patch: Partial<NotificationSettings>) => void,
] {
  const [settings, setSettings] = useState<NotificationSettings>(() =>
    readSettings(),
  );

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<NotificationSettings>).detail;
      if (detail) setSettings(detail);
    };
    window.addEventListener(STORAGE_EVENT, onChange);
    return () => window.removeEventListener(STORAGE_EVENT, onChange);
  }, []);

  const update = (patch: Partial<NotificationSettings>) => {
    const next = { ...settings, ...patch };
    writeSettings(next);
    setSettings(next);
    window.dispatchEvent(
      new CustomEvent<NotificationSettings>(STORAGE_EVENT, { detail: next }),
    );
  };

  return [settings, update];
}

/** Non-hook reader for places that can't use hooks (e.g. inside an interval
 *  callback that runs independent of React renders). */
export function getNotificationSettingsSync(): NotificationSettings {
  return readSettings();
}
