import { useEffect, useRef } from "react";
import {
  isPermissionGranted,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { useAuth } from "../../state/AuthProvider";
import { useKanban } from "../../state/kanbanStore";
import { useCalendar } from "../../state/calendar";
import { supabase } from "../../lib/supabase";
import { getNotificationSettingsSync } from "../../state/notificationSettings";

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const POLL_INTERVAL_MS = 60_000; // every minute

type NotificationKind = "day_start" | "minutes_before";

interface LogRow {
  event_id: string;
  kind: NotificationKind;
}

/**
 * Background side-effect component. Polls the current workspace's calendar
 * events once a minute and fires native desktop notifications for events
 * that match the user's notification preferences:
 *
 *   - `day_start`: all-day events on today's date, when the local clock
 *     reaches the configured day-start hour (default 9:00).
 *   - `minutes_before`: timed events on today's date, when the clock crosses
 *     the (event_time − minutesBefore) threshold.
 *
 * Dedup is server-side via `calendar_notification_log(user_id, event_id, kind)`
 * with a UNIQUE constraint. We load the log on mount + cache in-memory, then
 * extend the cache when we fire. A duplicate INSERT (e.g. from another device
 * firing first) simply rejects and we treat it as already-notified.
 *
 * Render nothing — mount once high in the tree (AuthedShell).
 */
export function CalendarNotifier() {
  const { user } = useAuth();
  const { state } = useKanban();
  const { events } = useCalendar(state.workspaceId);

  /** Set keyed by `${event_id}:${kind}` so we don't re-fire while the poll
   *  loop runs through the same minute multiple times before the DB INSERT
   *  round-trips. */
  const firedRef = useRef<Set<string>>(new Set());
  const seededRef = useRef<boolean>(false);

  // Seed the in-memory dedup set from the server log on mount / user change.
  // Without this, restarting the app would re-fire today's already-notified
  // events.
  useEffect(() => {
    if (!user) {
      firedRef.current = new Set();
      seededRef.current = false;
      return;
    }
    seededRef.current = false;
    let cancelled = false;
    void (async () => {
      // Pull only today's rows — older log entries are useless for the
      // current day and would balloon the cache over time.
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("calendar_notification_log")
        .select("event_id, kind")
        .eq("user_id", user.id)
        .gte("fired_at", startOfToday.toISOString());
      if (cancelled) return;
      if (error) {
        console.warn("notification log seed failed", error);
        seededRef.current = true;
        return;
      }
      const set = new Set<string>();
      for (const r of (data ?? []) as LogRow[]) {
        set.add(`${r.event_id}:${r.kind}`);
      }
      firedRef.current = set;
      seededRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!isTauri()) return; // nothing to do in a browser dev tab
    if (!user) return;

    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (!seededRef.current) return; // wait for initial log fetch

      const settings = getNotificationSettingsSync();
      if (!settings.enabled) return;

      // Check OS permission lazily — first run will prompt the user when
      // they actually enable notifications from Settings, but a reinstall /
      // wipe might leave settings.enabled=true with permission revoked.
      let granted: boolean;
      try {
        granted = await isPermissionGranted();
      } catch {
        granted = false;
      }
      if (!granted) return;

      const now = new Date();
      const todayIso = isoFromDate(now);
      const nowMs = now.getTime();

      for (const ev of events) {
        if (ev.event_date !== todayIso) continue;
        const key = (kind: NotificationKind) => `${ev.id}:${kind}`;

        if (!ev.event_time) {
          // All-day event — fire once at the configured day-start hour.
          if (now.getHours() < settings.dayStartHour) continue;
          if (firedRef.current.has(key("day_start"))) continue;
          await fire(ev, "day_start", "Сегодня запланировано");
          continue;
        }

        // Timed event — fire when now is within the `minutes_before` window
        // and before event_time + 5min grace (catch wake-from-sleep cases).
        const [h, m] = ev.event_time.split(":").map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
        const eventTime = new Date(now);
        eventTime.setHours(h, m, 0, 0);
        const fireAt = eventTime.getTime() - settings.minutesBefore * 60_000;
        const grace = eventTime.getTime() + 5 * 60_000;
        if (nowMs < fireAt) continue;
        if (nowMs > grace) continue;
        if (firedRef.current.has(key("minutes_before"))) continue;
        const minsLate = Math.max(
          0,
          Math.round((nowMs - eventTime.getTime()) / 60_000),
        );
        const body =
          minsLate > 0
            ? `Было в ${ev.event_time.slice(0, 5)} (${minsLate} мин назад)`
            : `В ${ev.event_time.slice(0, 5)}`;
        await fire(ev, "minutes_before", body);
      }
    };

    const fire = async (
      ev: (typeof events)[number],
      kind: NotificationKind,
      body: string,
    ) => {
      const key = `${ev.id}:${kind}`;
      // Optimistic cache add — prevents double-fire if the next tick
      // races the DB insert.
      firedRef.current.add(key);
      try {
        await sendNotification({
          title: ev.title || "Событие календаря",
          body,
        });
        const { error } = await supabase
          .from("calendar_notification_log")
          .insert({
            user_id: user!.id,
            event_id: ev.id,
            kind,
          });
        // Unique constraint violation = another device already fired it.
        // That's fine; keep our optimistic cache entry.
        if (error && !/duplicate key|unique/i.test(error.message)) {
          console.warn("notification log insert", error);
        }
      } catch (e) {
        // Pull the key back out so a future tick can retry.
        firedRef.current.delete(key);
        console.warn("sendNotification failed", e);
      }
    };

    // Run immediately so a freshly-opened app catches anything that already
    // happened today, then settle into the once-per-minute cadence.
    void tick();
    const id = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [events, user]);

  return null;
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
