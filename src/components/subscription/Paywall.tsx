import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSubscription } from "../../state/subscription";

/**
 * Paywall plumbing.
 *
 * One global modal is mounted at the root via `<PaywallProvider>`. Any
 * descendant can call `usePaywall().show('script_project')` (etc.) to surface
 * an upgrade pitch with a feature-specific headline. This avoids each gated
 * surface having to render its own modal.
 */

export type PaywallFeature =
  | "workspace_limit"
  | "script_project_limit"
  | "invite_collaborator"
  | "graph"
  | "rpy_export"
  | "frozen_workspace"
  | "frozen_project"
  | "translation_limit"
  | "frozen_translation"
  | "trial_ending";

interface FeatureCopy {
  title: string;
  body: string;
}

const COPY: Record<PaywallFeature, FeatureCopy> = {
  workspace_limit: {
    title: "Upgrade to add another workspace",
    body: "The free plan includes one workspace. Pro lets you spin up unlimited workspaces — useful when you keep separate projects, teams, or clients apart.",
  },
  script_project_limit: {
    title: "Upgrade to start another script project",
    body: "The free plan limits each workspace to one script project. Pro lifts that cap so you can work on as many stories as you like in parallel.",
  },
  invite_collaborator: {
    title: "Upgrade to invite collaborators",
    body: "The free plan is solo-only. Pro lets you invite editors and translators into the workspace and assign them roles.",
  },
  graph: {
    title: "Story Graph is a Pro feature",
    body: "The graph view visualises your labels, jumps, and choices on an interactive canvas. Upgrade to unlock it.",
  },
  rpy_export: {
    title: "Ren'Py export is a Pro feature",
    body: "Generate a buildable .rpy bundle from your project — characters, scenes, choices, and jumps — ready to drop into the Ren'Py SDK.",
  },
  frozen_workspace: {
    title: "This workspace is frozen",
    body: "Your trial ended, so the free plan keeps only one workspace active. Your data here isn't deleted — upgrade to Pro to unlock this workspace again, or keep working in your active one.",
  },
  frozen_project: {
    title: "This script project is frozen",
    body: "On the free plan each workspace keeps a single script project active. Your scenes, characters, and notes here are safe — upgrade to Pro to unfreeze this project instantly.",
  },
  translation_limit: {
    title: "Upgrade to add more languages",
    body: "The free plan covers two target languages per workspace. Pro lets you ship in as many languages as you need — useful when you're translating into 5+ markets or shipping community-driven localisations.",
  },
  frozen_translation: {
    title: "This translation is frozen",
    body: "On the free plan each workspace keeps two translations active. Your translated strings here aren't deleted — upgrade to Pro to unfreeze this language instantly.",
  },
  trial_ending: {
    title: "Stay on Pro",
    body: "Your Pro trial is wrapping up. Upgrade now to keep every workspace, project, and translation active — nothing freezes, nothing locks. Your existing data is preserved either way.",
  },
};

interface Ctx {
  show: (feature: PaywallFeature) => void;
}

const PaywallCtx = createContext<Ctx | null>(null);

export function PaywallProvider({ children }: { children: ReactNode }) {
  const [feature, setFeature] = useState<PaywallFeature | null>(null);

  const value = useMemo<Ctx>(
    () => ({ show: setFeature }),
    [],
  );

  return (
    <PaywallCtx.Provider value={value}>
      {children}
      <PaywallModal
        feature={feature}
        onClose={() => setFeature(null)}
      />
    </PaywallCtx.Provider>
  );
}

export function usePaywall(): Ctx {
  const v = useContext(PaywallCtx);
  if (!v) throw new Error("usePaywall must be used within PaywallProvider");
  return v;
}

/**
 * Wraps a user action so it only runs when the predicate holds; otherwise
 * pops the paywall modal. Lets call sites stay declarative:
 *
 *   const guard = useFeatureGuard();
 *   <button onClick={guard("graph", limits.canUseGraph, () => openGraph())}>
 */
export function useFeatureGuard() {
  const { show } = usePaywall();
  return useCallback(
    (feature: PaywallFeature, ok: boolean, run: () => void) => {
      if (ok) run();
      else show(feature);
    },
    [show],
  );
}

interface ModalProps {
  feature: PaywallFeature | null;
  onClose: () => void;
}

function PaywallModal({ feature, onClose }: ModalProps) {
  const { tier, isTrial, trialDaysLeft, trialEndsAt } = useSubscription();
  if (!feature) return null;
  const copy = COPY[feature];

  return (
    <div className="vn-modal-backdrop" onClick={onClose}>
      <div
        className="vn-modal paywall-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="vn-modal-head">
          <div className="vn-modal-head-title">
            <h3>{copy.title}</h3>
          </div>
          <button
            type="button"
            className="vn-drawer-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="vn-modal-body paywall-body">
          {isTrial && trialDaysLeft !== null && (
            <div className="paywall-trial-badge">
              You're on the free trial — {trialDaysLeft}{" "}
              day{trialDaysLeft === 1 ? "" : "s"} left
              {trialEndsAt && ` (until ${trialEndsAt.toLocaleDateString()})`}.
              Pro features are unlocked until then.
            </div>
          )}
          {!isTrial && tier === "free" && (
            <div className="paywall-trial-badge paywall-trial-ended">
              Your trial has ended. Upgrade to keep Pro features.
            </div>
          )}

          <p className="paywall-copy">{copy.body}</p>

          <ul className="paywall-features">
            <li>Unlimited workspaces & script projects</li>
            <li>Collaborator invites with role management</li>
            <li>Story Graph view (labels, jumps, choices)</li>
            <li>Ren'Py project export</li>
            <li>Priority support</li>
          </ul>
        </div>

        <div className="vn-modal-foot">
          <button type="button" className="hbtn" onClick={onClose}>
            Maybe later
          </button>
          <button
            type="button"
            className="hbtn is-primary"
            onClick={() => {
              // Billing integration not wired yet — surface intent without
              // navigating to a broken URL.
              alert(
                "Billing isn't connected yet. Drop a note to the maintainer and you'll be upgraded manually.",
              );
            }}
          >
            Upgrade to Pro
          </button>
        </div>
      </div>
    </div>
  );
}
