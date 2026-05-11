import { useEffect, useState } from "react";
import { getName, getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { SectionHead } from "./shared";

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function AboutSection() {
  const [name, setName] = useState("VnHelper");
  const [version, setVersion] = useState("");
  const [tauriVersion, setTauriVersion] = useState("");

  useEffect(() => {
    if (!isTauri()) {
      setVersion("dev");
      setTauriVersion("—");
      return;
    }
    void Promise.all([
      getName().catch(() => "VnHelper"),
      getVersion().catch(() => "?"),
      getTauriVersion().catch(() => "?"),
    ]).then(([n, v, t]) => {
      setName(n);
      setVersion(v);
      setTauriVersion(t);
    });
  }, []);

  return (
    <>
      <SectionHead
        title="About"
        subtitle="Информация о приложении."
      />
      <div className="set-card">
        <div className="set-row-title">{name}</div>
        <div className="set-row-desc">
          Tauri 2 + React 19 + Supabase desktop app для авторов визуальных
          новелл.
        </div>
      </div>
      <div className="set-card">
        <div className="set-meta-row">
          <span className="set-meta-key">App version</span>
          <span className="set-meta-val">{version || "…"}</span>
        </div>
        <div className="set-meta-row">
          <span className="set-meta-key">Tauri runtime</span>
          <span className="set-meta-val">{tauriVersion || "…"}</span>
        </div>
        <div className="set-meta-row">
          <span className="set-meta-key">Identifier</span>
          <span className="set-meta-val">com.vnhelper.app</span>
        </div>
      </div>
    </>
  );
}
