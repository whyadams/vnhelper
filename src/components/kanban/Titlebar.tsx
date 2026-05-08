import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";

const win = getCurrentWindow();

export function Titlebar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    const sync = async () => {
      const m = await win.isMaximized();
      if (active) setMaximized(m);
    };
    sync();
    const unlistenP = win.onResized(sync);
    return () => {
      active = false;
      unlistenP.then((fn) => fn());
    };
  }, []);

  const onDragMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".tb-btn")) return;
    win.startDragging();
  };

  const onTitlebarDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(".tb-btn")) return;
    win.toggleMaximize();
  };

  return (
    <div
      className="titlebar"
      data-tauri-drag-region
      onMouseDown={onDragMouseDown}
      onDoubleClick={onTitlebarDoubleClick}
    >
      <span className="titlebar-title" data-tauri-drag-region>
        VnHelper
      </span>
      <div className="titlebar-controls">
        <button
          className="tb-btn"
          type="button"
          aria-label="Minimize"
          onClick={() => win.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1 5h8" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          className="tb-btn"
          type="button"
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={() => win.toggleMaximize()}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M2.5 3.5h5v5h-5z M3.5 3.5V2h5v5H7"
                stroke="currentColor"
                strokeWidth="1"
                fill="none"
              />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect
                x="1"
                y="1"
                width="8"
                height="8"
                stroke="currentColor"
                strokeWidth="1"
                fill="none"
              />
            </svg>
          )}
        </button>
        <button
          className="tb-btn tb-close"
          type="button"
          aria-label="Close"
          onClick={() => win.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M1 1l8 8M9 1l-8 8"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
