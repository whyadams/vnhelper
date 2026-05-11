import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../state/AuthProvider";
import { useDialog } from "../../ui/Dialog";
import { SectionHead } from "./shared";

export function AccountSection() {
  const { user } = useAuth();
  const dialog = useDialog();

  const email = user?.email ?? "—";
  const initials = (email[0] ?? "?").toUpperCase();

  const signOut = async () => {
    const ok = await dialog.confirm({
      title: "Sign out",
      message: "Sign out of VnHelper? You'll need to sign in again next time.",
      confirmLabel: "Sign out",
    });
    if (ok) await supabase.auth.signOut();
  };

  return (
    <>
      <SectionHead
        title="Account"
        subtitle="Информация о вашей учётной записи."
      />
      <div className="set-card">
        <div className="set-avatar">
          <div className="set-avatar-pic">{initials}</div>
          <div className="set-avatar-info">
            <div className="set-avatar-email">{email}</div>
            {user?.id && <div className="set-avatar-id">{user.id}</div>}
          </div>
        </div>
      </div>
      <div className="set-row">
        <div className="set-row-label">
          <div className="set-row-title">Sign out</div>
          <div className="set-row-desc">
            Завершить сессию на этом устройстве.
          </div>
        </div>
        <div className="set-row-control">
          <button
            type="button"
            className="set-btn is-danger"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}
