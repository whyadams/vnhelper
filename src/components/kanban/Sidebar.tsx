import { type ComponentType, type SVGProps } from "react";
import { Languages as LucideLanguages } from "lucide-react";
import { useKanban } from "../../state/kanbanStore";
import { useNotifications } from "../../state/notifications";
import { canSeeNav, type Role } from "../../lib/roles";
import { useSubscription } from "../../state/subscription";
import { usePaywall } from "../subscription/Paywall";
import { UserMenu } from "./UserMenu";
import {
  BellFilledIcon,
  CalendarFilledIcon,
  CategoryFilledIcon,
  DocumentFilledIcon,
  ImageFilledIcon,
  MailFilledIcon,
  ShareFilledIcon,
  UsersFilledIcon,
} from "./SidebarIcons";

function LanguagesIcon(p: SVGProps<SVGSVGElement> & { size?: number }) {
  const { size = 16, ...rest } = p;
  return <LucideLanguages width={size} height={size} {...rest} />;
}

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

interface NavItem {
  key: string;
  label: string;
  Icon: IconCmp;
}

const essentialItems: NavItem[] = [
  { key: "task", label: "Tasks", Icon: CategoryFilledIcon },
  { key: "calendar", label: "Calendar", Icon: CalendarFilledIcon },
  { key: "graph", label: "Graph", Icon: ShareFilledIcon },
  { key: "script", label: "Script", Icon: DocumentFilledIcon },
  { key: "translations", label: "Translations", Icon: LanguagesIcon },
  { key: "photos", label: "Photos", Icon: ImageFilledIcon },
];

const MembersGlyph = UsersFilledIcon;
const InvitesGlyph = MailFilledIcon;
const BellGlyph = BellFilledIcon;

function LockIcon(props: SVGProps<SVGSVGElement>) {
  // Stroke-only padlock (12×12) tuned to match the sidebar's other inline
  // icons (1.6 stroke, rounded joins). Sits in `.nav-item-lock` which paints
  // it in muted text colour.
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function Sidebar() {
  const { state, dispatch } = useKanban();
  const notifications = useNotifications();
  const { limits } = useSubscription();
  const paywall = usePaywall();

  const pendingInvites = state.incomingInvitations.length;
  const unreadNotifs = notifications.unreadCount;

  const wsName = state.workspaceName || "Workspace";
  const wsInitials = wsName.trim().charAt(0).toUpperCase() || "W";
  const wsAvatar =
    state.workspaces.find((w) => w.id === state.workspaceId)?.avatar_url ??
    null;

  const isActive = (key: string) => state.activeNav === key;

  const role = (state.myRole ?? null) as Role | null;
  const baseRoleLabel = state.myRole
    ? `${state.myRole.charAt(0).toUpperCase()}${state.myRole.slice(1)}`
    : "Member";
  const wsRoleLabel =
    role === "translator" && state.myTargetLanguage
      ? `${baseRoleLabel} · ${state.myTargetLanguage}`
      : baseRoleLabel;

  const visibleNav = essentialItems.filter((it) => canSeeNav(role, it.key));
  const showWorkspaceSection = role !== "translator";

  return (
    <aside className="sidebar">
      {/* Workspace card */}
      <div className="ws-card">
        <div
          className={
            "ws-card-avatar" + (wsAvatar ? " ws-card-avatar-img" : "")
          }
        >
          {wsAvatar ? (
            <img src={wsAvatar} alt="" draggable={false} />
          ) : (
            wsInitials
          )}
        </div>
        <div className="ws-card-info">
          <div className="ws-card-name" title={wsName}>
            {wsName}
          </div>
          <div className="ws-card-role">{wsRoleLabel}</div>
        </div>
      </div>

      <div className="sidebar-spacer-14" />

      {/* Search — no left icon, only placeholder + ⌘K kbd */}
      <label className="search">
        <input
          placeholder="Search..."
          value={state.search}
          onChange={(e) =>
            dispatch({ type: "SET_SEARCH", value: e.target.value })
          }
        />
        <span className="kbd">⌘K</span>
      </label>

      <div className="sidebar-spacer-20" />

      {/* Essentials */}
      <div className="nav-section">
        <div className="nav-section-label">ESSENTIALS</div>
        {visibleNav.map(({ key, label, Icon }) => {
          const isLocked = key === "graph" && !limits.canUseGraph;
          return (
            <button
              key={key}
              className={
                "nav-item" +
                (isActive(key) ? " is-active" : "") +
                (isLocked ? " is-locked" : "")
              }
              type="button"
              onClick={() => {
                if (isLocked) {
                  paywall.show("graph");
                  return;
                }
                dispatch({ type: "SET_ACTIVE_NAV", key });
              }}
            >
              <Icon className="ico" />
              <span className="nav-item-label">{label}</span>
              {isLocked && (
                <span className="nav-item-lock" aria-hidden>
                  <LockIcon />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {showWorkspaceSection && (
        <>
          <div className="sidebar-spacer-18" />
          <div className="nav-section">
            <div className="nav-section-label">WORKSPACE</div>
            <button
              className={"nav-item" + (isActive("members") ? " is-active" : "")}
              type="button"
              onClick={() =>
                dispatch({ type: "SET_ACTIVE_NAV", key: "members" })
              }
            >
              <MembersGlyph className="ico" />
              <span className="nav-item-label">Members</span>
            </button>
            <button
              className={
                "nav-item" + (isActive("invitations") ? " is-active" : "")
              }
              type="button"
              onClick={() =>
                dispatch({ type: "SET_ACTIVE_NAV", key: "invitations" })
              }
            >
              <InvitesGlyph className="ico" />
              <span className="nav-item-label">Invitations</span>
              {pendingInvites > 0 && (
                <span className="nav-badge">{pendingInvites}</span>
              )}
            </button>
            <button
              className={
                "nav-item" + (isActive("notifications") ? " is-active" : "")
              }
              type="button"
              onClick={() =>
                dispatch({ type: "SET_ACTIVE_NAV", key: "notifications" })
              }
            >
              <BellGlyph className="ico" />
              <span className="nav-item-label">Notifications</span>
              {unreadNotifs > 0 && <span className="nav-dot" />}
            </button>
          </div>
        </>
      )}

      {/* Stretch filler */}
      <div className="sidebar-flex" />

      <div className="sidebar-divider" />
      <div className="sidebar-spacer-12" />

      {/* Compact identity widget. Avatar carries a colored status ring for
          trial state at-a-glance; dropdown holds email + trial CTA + sign-out. */}
      <UserMenu />
    </aside>
  );
}
