import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Main window starts hidden so the user never sees the webview's blank
// pre-paint frame. Reveal it after React has committed its first render.
// The widget window manages its own visibility (positioned then shown).
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    try {
      const win = getCurrentWindow();
      if (win.label === "main") {
        void win.show();
      }
    } catch {
      // Outside Tauri (unlikely) — nothing to do.
    }
  });
});
