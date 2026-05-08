import { useEffect, useRef } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useDialog } from "./ui/Dialog";

const isTauri = () =>
  typeof window !== "undefined" &&
  // @ts-expect-error tauri exposes internals on the window
  typeof window.__TAURI_INTERNALS__ !== "undefined";

export function AutoUpdater() {
  const dialog = useDialog();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    if (!isTauri()) return;

    let cancelled = false;
    (async () => {
      let update: Update | null = null;
      try {
        update = await check();
      } catch (err) {
        console.warn("[updater] check failed:", err);
        return;
      }
      if (cancelled || !update?.available) return;

      const notes = update.body?.trim();
      const ok = await dialog.confirm({
        title: `Update available — v${update.version}`,
        message: notes
          ? `${notes}\n\nUpdate now? The app will restart automatically.`
          : "A new version is available. Update now? The app will restart automatically.",
        confirmLabel: "Update",
        cancelLabel: "Later",
        variant: "primary",
      });
      if (!ok) return;

      try {
        await update.downloadAndInstall();
        await relaunch();
      } catch (err) {
        console.error("[updater] install failed:", err);
        await dialog.alert({
          title: "Update failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dialog]);

  return null;
}
