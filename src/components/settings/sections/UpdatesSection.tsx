import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useDialog } from "../../ui/Dialog";
import { SectionHead } from "./shared";

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function UpdatesSection() {
  const dialog = useDialog();
  const [version, setVersion] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setVersion("dev");
      return;
    }
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("?"));
  }, []);

  const checkNow = async () => {
    if (!isTauri()) {
      setError("Updater is available only in the desktop app.");
      return;
    }
    setChecking(true);
    setInfo(null);
    setError(null);
    try {
      const update = await check();
      if (!update?.available) {
        setInfo("У вас последняя версия.");
        return;
      }
      const ok = await dialog.confirm({
        title: `Update available — v${update.version}`,
        message: update.body?.trim()
          ? `${update.body.trim()}\n\nUpdate now? The app will restart automatically.`
          : "A new version is available. Update now? The app will restart automatically.",
        confirmLabel: "Update",
        cancelLabel: "Later",
        variant: "primary",
      });
      if (!ok) {
        setInfo(`Доступна версия ${update.version} — установка отложена.`);
        return;
      }
      await update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <SectionHead
        title="Updates"
        subtitle="Обновления подтягиваются с GitHub Releases. При запуске приложение проверяет апдейты автоматически."
      />
      <div className="set-row">
        <div className="set-row-label">
          <div className="set-row-title">Текущая версия</div>
          <div className="set-row-desc">RenHub {version || "…"}</div>
        </div>
        <div className="set-row-control">
          <button
            type="button"
            className="set-btn"
            onClick={() => void checkNow()}
            disabled={checking}
          >
            {checking ? "Checking…" : "Check for updates"}
          </button>
        </div>
      </div>
      {info && <div className="set-info">{info}</div>}
      {error && <div className="set-error">{error}</div>}
    </>
  );
}
