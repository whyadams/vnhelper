import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../state/AuthProvider";
import { useKanban } from "../../state/kanbanStore";
import { UsersFilledIcon } from "../kanban/SidebarIcons";
import { useDialog } from "../ui/Dialog";
import { useSubscription } from "../../state/subscription";
import { usePaywall } from "../subscription/Paywall";

type Role = "owner" | "editor" | "viewer" | "translator";

interface MemberRow {
  user_id: string;
  role: Role;
  target_language: string | null;
  profile: { id: string; email: string | null; name: string | null } | null;
  created_at?: string;
}

interface InvitationRow {
  id: string;
  email: string;
  role: Role;
  target_language: string | null;
  invited_user_id: string | null;
  created_at: string;
}

type RoleFilter = "all" | Role;

function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function MembersScreen() {
  const { user } = useAuth();
  const { state } = useKanban();
  const dialog = useDialog();
  const { limits } = useSubscription();
  const paywall = usePaywall();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [filter, setFilter] = useState<RoleFilter>("all");
  const [search, setSearch] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [inviteLang, setInviteLang] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isOwner = state.myRole === "owner";

  const refresh = async () => {
    if (!state.workspaceId) return;
    const [membersRes, invitesRes] = await Promise.all([
      supabase
        .from("workspace_members")
        .select(
          "user_id, role, target_language, created_at, profiles(id, email, name)",
        )
        .eq("workspace_id", state.workspaceId),
      supabase
        .from("workspace_invitations")
        .select(
          "id, email, role, target_language, invited_user_id, created_at",
        )
        .eq("workspace_id", state.workspaceId)
        .order("created_at", { ascending: false }),
    ]);
    if (membersRes.error) setError(membersRes.error.message);
    else {
      setMembers(
        (membersRes.data ?? []).map((r) => ({
          user_id: r.user_id,
          role: r.role as Role,
          target_language: r.target_language ?? null,
          created_at: r.created_at,
          profile: (r as { profiles: MemberRow["profile"] }).profiles,
        })),
      );
    }
    if (invitesRes.error) setInvitations([]);
    else {
      setInvitations(
        (invitesRes.data ?? []).map((r) => ({
          id: r.id,
          email: r.email,
          role: r.role as Role,
          target_language: r.target_language ?? null,
          invited_user_id: r.invited_user_id,
          created_at: r.created_at,
        })),
      );
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.workspaceId]);

  useEffect(() => {
    if (!state.workspaceId) return;
    const ch = supabase
      .channel(`ws_admin_screen:${state.workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workspace_members",
          filter: `workspace_id=eq.${state.workspaceId}`,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "workspace_invitations",
          filter: `workspace_id=eq.${state.workspaceId}`,
        },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.workspaceId]);

  const counts = useMemo(() => {
    const c = { all: members.length, owner: 0, editor: 0, viewer: 0, translator: 0 };
    for (const m of members) c[m.role]++;
    return c;
  }, [members]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (filter !== "all" && m.role !== filter) return false;
      if (!q) return true;
      const name = m.profile?.name?.toLowerCase() ?? "";
      const mail = m.profile?.email?.toLowerCase() ?? "";
      return name.includes(q) || mail.includes(q);
    });
  }, [members, filter, search]);

  const invite = async (e: FormEvent) => {
    e.preventDefault();
    if (!state.workspaceId) return;
    setError(null);
    setInfo(null);
    if (inviteRole === "translator" && !inviteLang.trim()) {
      setError("Language is required for translator invitations.");
      return;
    }
    setBusy(true);
    const { data: invRow, error } = await supabase.rpc("invite_to_workspace", {
      _workspace_id: state.workspaceId,
      _email: email.trim(),
      _role: inviteRole,
    });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    if (inviteRole === "translator") {
      const lang = inviteLang.trim().toLowerCase();
      const invitationId = (invRow as { id?: string } | null)?.id ?? null;
      if (!invitationId) {
        setBusy(false);
        setError(
          "Invitation created but its id was not returned — language could not be set.",
        );
        return;
      }
      const { error: updErr } = await supabase
        .from("workspace_invitations")
        .update({ target_language: lang })
        .eq("id", invitationId);
      if (updErr) {
        setBusy(false);
        setError(
          "Invitation created but language could not be set — ask a workspace admin.",
        );
        return;
      }
    }
    setBusy(false);
    setEmail("");
    setInviteLang("");
    setShowInvite(false);
    setInfo(`Invitation sent to ${email}.`);
    void refresh();
  };

  const remove = async (uid: string) => {
    if (!state.workspaceId) return;
    if (uid === user?.id) {
      const ok = await dialog.confirm({
        title: "Leave workspace",
        message: "Leave this workspace? You'll lose access to all its data.",
        variant: "danger",
        confirmLabel: "Leave",
      });
      if (!ok) return;
    }
    const { error } = await supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", state.workspaceId)
      .eq("user_id", uid);
    if (error) setError(error.message);
  };

  const changeRole = async (uid: string, newRole: Role) => {
    if (!state.workspaceId) return;
    const { error } = await supabase
      .from("workspace_members")
      .update({ role: newRole })
      .eq("workspace_id", state.workspaceId)
      .eq("user_id", uid);
    if (error) setError(error.message);
  };

  const revoke = async (id: string) => {
    const { error } = await supabase.rpc("revoke_invitation", {
      _invitation_id: id,
    });
    if (error) setError(error.message);
  };

  return (
    <main className="main">
      <div className="ws-screen-topbar">
        <UsersFilledIcon size={20} className="ws-screen-glyph" />
        <span className="ws-screen-title">Members</span>
        <span className="ws-screen-ct">{members.length}</span>
        <span style={{ flex: 1 }} />
        {info && <span className="saved">{info}</span>}
        {isOwner && (
          <button
            type="button"
            className="hbtn is-primary"
            onClick={() => {
              if (!limits.canInviteCollaborators) {
                paywall.show("invite_collaborator");
                return;
              }
              setShowInvite((v) => !v);
            }}
          >
            + Invite member
          </button>
        )}
      </div>

      <div className="ws-tabs">
        <button
          type="button"
          className={"ws-tab" + (filter === "all" ? " is-active" : "")}
          onClick={() => setFilter("all")}
        >
          All <span>{counts.all}</span>
        </button>
        <button
          type="button"
          className={"ws-tab" + (filter === "owner" ? " is-active" : "")}
          onClick={() => setFilter("owner")}
        >
          Owners <span>{counts.owner}</span>
        </button>
        <button
          type="button"
          className={"ws-tab" + (filter === "editor" ? " is-active" : "")}
          onClick={() => setFilter("editor")}
        >
          Editors <span>{counts.editor}</span>
        </button>
        <button
          type="button"
          className={"ws-tab" + (filter === "viewer" ? " is-active" : "")}
          onClick={() => setFilter("viewer")}
        >
          Viewers <span>{counts.viewer}</span>
        </button>
        <span style={{ flex: 1 }} />
        <input
          className="ws-filter-input"
          placeholder="Filter members…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="ws-body">
        {showInvite && isOwner && (
          <form className="ws-invite-form" onSubmit={invite}>
            <input
              type="email"
              required
              value={email}
              placeholder="name@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Role)}
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
              <option value="translator">Translator</option>
            </select>
            {inviteRole === "translator" && (
              <input
                type="text"
                required
                value={inviteLang}
                placeholder="english"
                aria-label="Language"
                onChange={(e) => setInviteLang(e.target.value)}
              />
            )}
            <button type="submit" className="hbtn is-primary" disabled={busy}>
              {busy ? "…" : "Send invite"}
            </button>
            <button
              type="button"
              className="hbtn"
              onClick={() => setShowInvite(false)}
            >
              Cancel
            </button>
          </form>
        )}

        <div className="ws-table">
          <div className="ws-table-head">
            <div className="ws-th col-member">MEMBER</div>
            <div className="ws-th col-role">ROLE</div>
            <div className="ws-th col-joined">JOINED</div>
            <div className="ws-th col-actions" />
          </div>
          {filtered.map((m) => {
            const display =
              m.profile?.name ?? m.profile?.email ?? m.user_id.slice(0, 8);
            const initials = (m.profile?.name ?? m.profile?.email ?? "?")
              .slice(0, 2)
              .toUpperCase();
            const isMe = m.user_id === user?.id;
            return (
              <div key={m.user_id} className="ws-tr">
                <div className="ws-td col-member">
                  <div className="ws-av">{initials}</div>
                  <div className="ws-td-name">
                    <div className="ws-td-display">
                      {display}
                      {isMe && <span className="ws-you-tag">You</span>}
                    </div>
                    <div className="ws-td-email">{m.profile?.email ?? ""}</div>
                  </div>
                </div>
                <div className="ws-td col-role">
                  <span className={"ws-role ws-role-" + m.role}>
                    <span className="ws-role-dot" />
                    {m.role}
                    {m.role === "translator" && m.target_language && (
                      <span className="ws-role-lang">
                        · {m.target_language}
                      </span>
                    )}
                  </span>
                  {isOwner && m.role !== "owner" && m.role !== "translator" && (
                    <select
                      className="ws-role-edit"
                      value={m.role}
                      onChange={(e) =>
                        void changeRole(m.user_id, e.target.value as Role)
                      }
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  )}
                </div>
                <div className="ws-td col-joined">
                  {formatDate(m.created_at)}
                </div>
                <div className="ws-td col-actions">
                  {((isOwner && m.role !== "owner") || isMe) && (
                    <button
                      className="ws-row-x"
                      onClick={() => void remove(m.user_id)}
                      title={isMe ? "Leave" : "Remove"}
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {isOwner && invitations.length > 0 && (
          <>
            <h2 className="ws-section-h2">Pending invitations</h2>
            <div className="ws-table">
              {invitations.map((inv) => (
                <div key={inv.id} className="ws-tr is-pending">
                  <div className="ws-td col-member">
                    <div className="ws-av is-mail">✉</div>
                    <div className="ws-td-name">
                      <div className="ws-td-display">{inv.email}</div>
                      <div className="ws-td-email">
                        Sent {formatDate(inv.created_at)} ·{" "}
                        {inv.invited_user_id
                          ? "Awaiting response"
                          : "Awaiting signup"}
                      </div>
                    </div>
                  </div>
                  <div className="ws-td col-role">
                    <span className={"ws-role ws-role-" + inv.role}>
                      <span className="ws-role-dot" />
                      {inv.role}
                      {inv.role === "translator" && inv.target_language && (
                        <span className="ws-role-lang">
                          · {inv.target_language}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="ws-td col-joined" />
                  <div className="ws-td col-actions">
                    <button
                      type="button"
                      className="ws-row-revoke"
                      onClick={() => void revoke(inv.id)}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {error && <div className="auth-error">{error}</div>}
      </div>
    </main>
  );
}
