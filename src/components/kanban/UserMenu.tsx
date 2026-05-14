import type { SVGProps } from "react";
import { useAuth } from "../../state/AuthProvider";
import { useSubscription } from "../../state/subscription";
import { usePaywall } from "../subscription/Paywall";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

/**
 * Bottom-of-sidebar identity widget. One compact ~40px trigger row (avatar +
 * name + chevron) that opens a dropdown with the rest of the account
 * surface: full email, trial countdown / upgrade CTA, sign-out.
 *
 * The avatar carries a status ring whose colour encodes the subscription
 * state so trial info is glanceable without opening the menu — sage for
 * active trial, amber for last day, red for expired, no ring for paid Pro.
 */
export function UserMenu() {
  const { user, signOut } = useAuth();
  const { tier, isTrial, trialDaysLeft } = useSubscription();
  const paywall = usePaywall();

  const userName =
    (user?.user_metadata?.name as string | undefined) ??
    user?.email?.split("@")[0] ??
    "Me";
  const initials = userInitials(userName, user?.email);

  let ringClass = "";
  let trialLabel = "";
  if (tier === "free") {
    ringClass = "is-ring-expired";
    trialLabel = "Триал истёк";
  } else if (isTrial && trialDaysLeft !== null && trialDaysLeft <= 1) {
    ringClass = "is-ring-urgent";
    trialLabel = "Последний день триала";
  } else if (isTrial && trialDaysLeft !== null) {
    ringClass = "is-ring-trial";
    trialLabel = `Триал · ${trialDaysLeft} ${pluralDays(trialDaysLeft)}`;
  }
  const showTrialRow = !!trialLabel;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="user-menu-trigger"
          title={user?.email ?? ""}
        >
          <span className={"user-menu-avatar " + ringClass} aria-hidden>
            {initials}
          </span>
          <span className="user-menu-name">{userName}</span>
          <ChevronUpDown className="user-menu-chev" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        className="user-menu-pop"
      >
        <div className="user-menu-id">
          <div className="user-menu-id-name">{userName}</div>
          <div className="user-menu-id-email">{user?.email ?? ""}</div>
        </div>

        {showTrialRow && (
          <>
            <DropdownMenuSeparator />
            <button
              type="button"
              className={"user-menu-trial " + ringClass}
              onClick={() => paywall.show("trial_ending")}
            >
              <span className="user-menu-trial-dot" aria-hidden />
              <span className="user-menu-trial-label">{trialLabel}</span>
              <span className="user-menu-trial-action">Апгрейд →</span>
            </button>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => void signOut()}
        >
          <SignOutGlyph />
          <span style={{ marginLeft: 8 }}>Выйти</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function userInitials(
  name: string | undefined | null,
  email: string | null | undefined,
): string {
  const fromName = (name ?? "").trim();
  if (fromName) {
    const parts = fromName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  const local = (email ?? "").split("@")[0].trim();
  if (local) return local.slice(0, 2).toUpperCase();
  return "?";
}

function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

function ChevronUpDown(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="10"
      height="14"
      viewBox="0 0 10 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M2 5L5 2L8 5" />
      <path d="M2 9L5 12L8 9" />
    </svg>
  );
}

function SignOutGlyph() {
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
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16,17 21,12 16,7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
