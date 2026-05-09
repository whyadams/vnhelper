import { useEffect } from "react";
import "./styles/kanban.css";
import "./styles/tiptap.css";
import "./styles/scripts.css";
import "./styles/graph.css";
import "./styles/calendar.css";
import "./styles/photos.css";
import "./styles/auth.css";
import "./styles/mmenu.css";
import "./styles/members.css";
import "./styles/workspace.css";
import "./styles/translations.css";
import "./styles/skeleton.css";
import { AutoUpdater } from "./components/AutoUpdater";
import { AuthScreen } from "./components/auth/AuthScreen";
import { CalendarScreen } from "./components/calendar/CalendarScreen";
import { Board } from "./components/kanban/Board";
import { CardDetailPanel } from "./components/kanban/CardDetailPanel";
import { Rail } from "./components/kanban/Rail";
import { Sidebar } from "./components/kanban/Sidebar";
import { Titlebar } from "./components/kanban/Titlebar";
import { Topbar } from "./components/kanban/Topbar";
import { InvitationsScreen } from "./components/members/InvitationsScreen";
import { MembersScreen } from "./components/members/MembersScreen";
import { NotificationsScreen } from "./components/notifications/NotificationsScreen";
import { ScriptScreen } from "./components/scripts/ScriptScreen";
import { TranslationsScreen } from "./components/translations/TranslationsScreen";
import { ComingSoonScreen } from "./components/ui/ComingSoonScreen";
import { DialogProvider } from "./components/ui/Dialog";
import { AuthProvider, useAuth } from "./state/AuthProvider";
import { KanbanProvider, useKanban } from "./state/kanbanStore";
import { useTrayTasks } from "./state/useTrayTasks";
import { canSeeNav, type Role } from "./lib/roles";

function GlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>(
          ".sidebar .search input",
        );
        input?.focus();
        input?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

function KanbanScreen() {
  return (
    <>
      <main className="main">
        <Topbar />
        <Board />
      </main>
      <CardDetailPanel />
    </>
  );
}

function ActiveScreen() {
  const { state, dispatch } = useKanban();
  useTrayTasks();
  const role = (state.myRole ?? null) as Role | null;
  const navAllowed = canSeeNav(role, state.activeNav);
  useEffect(() => {
    if (role === "translator" && !navAllowed) {
      dispatch({ type: "SET_ACTIVE_NAV", key: "task" });
    }
  }, [role, navAllowed, dispatch]);
  if (role === "translator" && !navAllowed) {
    return null;
  }
  if (!state.ready) {
    return <div className="app-splash">Loading workspace…</div>;
  }
  if (state.activeNav === "graph")
    return (
      <ComingSoonScreen
        title="Graph"
        description="Story-flow whiteboard временно недоступен. Возвращаем после доработки."
      />
    );
  if (state.activeNav === "script") return <ScriptScreen />;
  if (state.activeNav === "translations") return <TranslationsScreen />;
  if (state.activeNav === "calendar") return <CalendarScreen />;
  if (state.activeNav === "photos")
    return (
      <ComingSoonScreen
        title="Photos"
        description="Фотогалерея временно недоступна — выбираем подход к хранилищу (Google Drive / BYO bucket)."
      />
    );
  if (state.activeNav === "members") return <MembersScreen />;
  if (state.activeNav === "invitations") return <InvitationsScreen />;
  if (state.activeNav === "notifications") return <NotificationsScreen />;
  return <KanbanScreen />;
}

function AuthedShell() {
  return (
    <KanbanProvider>
      <GlobalShortcuts />
      <Rail />
      <Sidebar />
      <ActiveScreen />
    </KanbanProvider>
  );
}

function AuthGate() {
  const { session, loading } = useAuth();
  return (
    <div className="app">
      <Titlebar />
      <div className="frame">
        {loading ? (
          <div className="app-splash">Loading…</div>
        ) : !session ? (
          <AuthScreen />
        ) : (
          <AuthedShell />
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <DialogProvider>
      <AutoUpdater />
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </DialogProvider>
  );
}
