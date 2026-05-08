import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useKanban } from "./kanbanStore";

interface TrayTask {
  id: string;
  title: string;
  column: string;
}

const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function useTrayTasks() {
  const { state, dispatch } = useKanban();
  const lastSerialized = useRef<string>("");

  useEffect(() => {
    if (!isTauri() || !state.ready) return;

    const tasks: TrayTask[] = state.columns
      .filter((col) => col.key !== "done")
      .flatMap((col) =>
        col.cards.map((c) => ({
          id: c.id,
          title: c.title,
          column: col.key,
        })),
      );

    const serialized = JSON.stringify(tasks);
    if (serialized === lastSerialized.current) return;
    lastSerialized.current = serialized;

    void invoke("update_tray_tasks", { tasks }).catch((e) =>
      console.error("update_tray_tasks failed", e),
    );
  }, [state.columns, state.ready]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: UnlistenFn | undefined;
    void listen<string>("tray://focus-task", (event) => {
      const cardId = event.payload;
      if (!cardId) return;
      dispatch({ type: "SET_ACTIVE_NAV", key: "task" });
      dispatch({ type: "FOCUS_CARD", id: cardId });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [dispatch]);
}
