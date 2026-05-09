import { useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  useKanban,
  type IncomingInvitation,
} from "../../state/kanbanStore";
import { MailFilledIcon } from "../kanban/SidebarIcons";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function InvitationsScreen() {
  const { state, dispatch, refreshInvitations, refreshWorkspaces } =
    useKanban();
  const [error, setError] = useState<string | null>(null);

  const accept = async (inv: IncomingInvitation) => {
    setError(null);
    const { error } = await supabase.rpc("accept_invitation", {
      _invitation_id: inv.id,
    });
    if (error) {
      setError(error.message);
      return;
    }
    await Promise.all([refreshInvitations(), refreshWorkspaces()]);
    dispatch({ type: "SET_ACTIVE_WORKSPACE", id: inv.workspace_id });
  };

  const reject = async (inv: IncomingInvitation) => {
    setError(null);
    const { error } = await supabase.rpc("reject_invitation", {
      _invitation_id: inv.id,
    });
    if (error) setError(error.message);
    else await refreshInvitations();
  };

  const items = state.incomingInvitations;

  return (
    <main className="main">
      <div className="ws-screen-topbar">
        <MailFilledIcon size={20} className="ws-screen-glyph" />
        <span className="ws-screen-title">Invitations</span>
        {items.length > 0 && (
          <span className="ws-screen-ct">{items.length}</span>
        )}
      </div>

      <div className="ws-body">
        {items.length === 0 ? (
          <div className="ws-empty">No pending invitations.</div>
        ) : (
          <div className="ws-table">
            {items.map((inv) => (
              <div key={inv.id} className="ws-tr is-pending">
                <div className="ws-td col-member">
                  <div className="ws-av">
                    {inv.workspace_name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="ws-td-name">
                    <div className="ws-td-display">{inv.workspace_name}</div>
                    <div className="ws-td-email">
                      Invited by{" "}
                      {inv.inviter_name ?? inv.inviter_email ?? "—"} ·{" "}
                      {formatDate(inv.created_at)}
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
                <div
                  className="ws-td col-actions"
                  style={{ gap: 4 }}
                >
                  <button
                    type="button"
                    className="hbtn is-primary"
                    style={{ height: 28, padding: "0 12px" }}
                    onClick={() => void accept(inv)}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="ws-row-revoke"
                    onClick={() => void reject(inv)}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <div className="auth-error">{error}</div>}
      </div>
    </main>
  );
}
