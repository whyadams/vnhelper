import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
// Tailwind first so the preflight reset is overridden by the legacy CSS
// that follows. shadcn variables are loaded but no global element styles
// are applied beyond preflight — existing screens are unaffected.
import "./styles/tailwind.css";
import "./styles/kanban.css";
import "./styles/tiptap.css";
import "./styles/scripts.css";
import "./styles/graph.css";
import "./styles/calendar.css";
import "@xyflow/react/dist/style.css";
import "./styles/photos.css";
import "./styles/auth.css";
import "./styles/mmenu.css";
import "./styles/members.css";
import "./styles/workspace.css";
import "./styles/translations.css";
import "./styles/skeleton.css";
import "./styles/widget.css";
import "./styles/settings.css";
import "./styles/subscription.css";
import "./styles/copy-button.css";
import "./styles/scrollbars.css";
import "./i18n";
import { AutoUpdater } from "./components/AutoUpdater";
import { AuthScreen } from "./components/auth/AuthScreen";
import { CalendarScreen } from "./components/calendar/CalendarScreen";
import { GraphScreen } from "./components/graph/GraphScreen";
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
import { PhotosScreen } from "./components/photos/PhotosScreen";
import { DialogProvider } from "./components/ui/Dialog";
import { KanbanWidget } from "./components/widget/KanbanWidget";
import { SimulatorWindow } from "./components/graph/SimulatorWindow";
import { AuthProvider, useAuth } from "./state/AuthProvider";
import { KanbanProvider, useKanban } from "./state/kanbanStore";
import { SubscriptionProvider } from "./state/subscription";
import { PaywallProvider } from "./components/subscription/Paywall";
import { FrozenAutoSwitcher } from "./components/subscription/FrozenAutoSwitcher";
import { CalendarNotifier } from "./components/calendar/CalendarNotifier";
import { useTrayTasks } from "./state/useTrayTasks";
import { canSeeNav, type Role } from "./lib/roles";

// Tauri window label is fixed at construction time. Read it once so the
// React tree can route to the right shell on first paint without a flash.
const WINDOW_LABEL = (() => {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
})();
const IS_WIDGET = WINDOW_LABEL === "widget";
const IS_SIMULATOR = WINDOW_LABEL === "simulator";

// Widget mode needs transparent <html>/<body> so the rounded shell sits over
// the desktop. Mark the root nodes once at boot — pure DOM, no React state.
if (IS_WIDGET && typeof document !== "undefined") {
  document.documentElement.classList.add("is-widget");
  document.body.classList.add("is-widget");
  document.getElementById("root")?.classList.add("is-widget");
}

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
  if (state.activeNav === "graph") return <GraphScreen />;
  if (state.activeNav === "script") return <ScriptScreen />;
  if (state.activeNav === "translations") return <TranslationsScreen />;
  if (state.activeNav === "calendar") return <CalendarScreen />;
  if (state.activeNav === "photos") return <PhotosScreen />;
  if (state.activeNav === "members") return <MembersScreen />;
  if (state.activeNav === "invitations") return <InvitationsScreen />;
  if (state.activeNav === "notifications") return <NotificationsScreen />;
  return <KanbanScreen />;
}

function AuthedShell() {
  return (
    <SubscriptionProvider>
      <PaywallProvider>
        <KanbanProvider>
          <FrozenAutoSwitcher />
          <CalendarNotifier />
          <GlobalShortcuts />
          <Rail />
          <Sidebar />
          <ActiveScreen />
        </KanbanProvider>
      </PaywallProvider>
    </SubscriptionProvider>
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

function WidgetApp() {
  // Compact always-on-top kanban widget. Reuses the same Supabase auth
  // (shared via WebView2 storage) and KanbanProvider so realtime updates
  // mirror the main window without any cross-window IPC.
  return (
    <DialogProvider>
      <AuthProvider>
        <WidgetGate />
      </AuthProvider>
    </DialogProvider>
  );
}

function WidgetGate() {
  const { session, loading } = useAuth();
  if (loading) {
    return <div className="widget-shell widget-loading">Loading…</div>;
  }
  if (!session) {
    return (
      <div className="widget-shell widget-loading">Sign in in the main window first.</div>
    );
  }
  return (
    <KanbanProvider>
      <KanbanWidget />
    </KanbanProvider>
  );
}

function SimulatorApp() {
  // Standalone Path Simulator window. No AuthGate / shell chrome — the
  // simulator is a player-facing preview, not a place to land cold. We
  // rely on the parent window's Supabase session (shared via WebView2
  // storage). The Supabase client reads the session synchronously from
  // localStorage, so requests in `SimulatorWindow` work immediately.
  return (
    <DialogProvider>
      <AuthProvider>
        <SimulatorWindow />
      </AuthProvider>
    </DialogProvider>
  );
}

export default function App() {
  if (IS_WIDGET) return <WidgetApp />;
  if (IS_SIMULATOR) return <SimulatorApp />;
  return (
    <DialogProvider>
      <AutoUpdater />
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </DialogProvider>
  );
}
