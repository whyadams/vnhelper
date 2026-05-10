import { type ComponentType, type SVGProps } from "react";
import { Languages as LucideLanguages } from "lucide-react";
import { useAuth } from "../../state/AuthProvider";
import { useKanban } from "../../state/kanbanStore";
import { useNotifications } from "../../state/notifications";
import { canSeeNav, type Role } from "../../lib/roles";
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

function SignOutGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16,17 21,12 16,7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

export function Sidebar() {
  const { state, dispatch } = useKanban();
  const { user, signOut } = useAuth();
  const notifications = useNotifications();

  const userName =
    (user?.user_metadata?.name as string | undefined) ??
    user?.email?.split("@")[0] ??
    "Me";
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
        {visibleNav.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={"nav-item" + (isActive(key) ? " is-active" : "")}
            type="button"
            onClick={() => dispatch({ type: "SET_ACTIVE_NAV", key })}
          >
            <Icon className="ico" />
            <span className="nav-item-label">{label}</span>
          </button>
        ))}
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

      {/* User card */}
      <div className="user-chip">
        <div className="user-chip-info">
          <div className="user-chip-name" title={user?.email ?? ""}>
            {userName}
          </div>
          <div className="user-chip-email">{user?.email ?? ""}</div>
        </div>
        <button
          type="button"
          className="user-chip-action"
          onClick={() => void signOut()}
          title="Sign out"
          aria-label="Sign out"
        >
          <SignOutGlyph />
        </button>
      </div>
    </aside>
  );
}
