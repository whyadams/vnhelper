import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";

/**
 * Subscription state for the signed-in user.
 *
 * Source: the `my_subscription` Postgres view, which resolves the effective
 * tier (considering trial expiry) on the server. We mirror the row locally
 * and re-fetch on auth changes + realtime updates to the underlying table.
 *
 * Limits live in this module — RLS guards in the DB are the authoritative
 * enforcement; this map is just for UI affordances (disabled buttons, "0/1"
 * counters, paywall modals).
 */

export type Tier = "free" | "pro";

export interface SubscriptionRow {
  tier: Tier;
  status: string; // 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

/** Per-tier feature limits. Keep parallel to the DB triggers in
 *  `0016_subscription_quota_guards.sql`. */
export interface TierLimits {
  maxWorkspaces: number; // workspaces a user may own
  maxScriptProjectsPerWorkspace: number;
  maxTranslationProjectsPerWorkspace: number;
  canInviteCollaborators: boolean;
  canUseGraph: boolean;
  canExportRpy: boolean;
}

const LIMITS: Record<Tier, TierLimits> = {
  free: {
    maxWorkspaces: 1,
    maxScriptProjectsPerWorkspace: 1,
    maxTranslationProjectsPerWorkspace: 2,
    canInviteCollaborators: false,
    canUseGraph: false,
    canExportRpy: false,
  },
  pro: {
    maxWorkspaces: Number.POSITIVE_INFINITY,
    maxScriptProjectsPerWorkspace: Number.POSITIVE_INFINITY,
    maxTranslationProjectsPerWorkspace: Number.POSITIVE_INFINITY,
    canInviteCollaborators: true,
    canUseGraph: true,
    canExportRpy: true,
  },
};

interface Ctx {
  /** Resolved effective tier — `'pro'` during an active trial, `'free'` after. */
  tier: Tier;
  /** True while the demo trial window is still open. */
  isTrial: boolean;
  trialEndsAt: Date | null;
  /** Whole days remaining in the trial (rounded up). `null` outside trial. */
  trialDaysLeft: number | null;
  limits: TierLimits;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SubCtx = createContext<Ctx | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [row, setRow] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setRow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("my_subscription")
      .select("effective_tier, status, trial_ends_at, current_period_end")
      .maybeSingle();
    if (error) {
      console.error("subscription fetch", error);
      // Default to free so we don't accidentally unlock anything on transient
      // errors.
      setRow({
        tier: "free",
        status: "expired",
        trialEndsAt: null,
        currentPeriodEnd: null,
      });
    } else if (data) {
      const tier: Tier = data.effective_tier === "pro" ? "pro" : "free";
      setRow({
        tier,
        status: data.status ?? "expired",
        trialEndsAt: data.trial_ends_at ? new Date(data.trial_ends_at) : null,
        currentPeriodEnd: data.current_period_end
          ? new Date(data.current_period_end)
          : null,
      });
    } else {
      // No row yet (e.g., trigger hasn't fired). Treat as free.
      setRow({
        tier: "free",
        status: "expired",
        trialEndsAt: null,
        currentPeriodEnd: null,
      });
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void refresh();
  }, [authLoading, refresh]);

  // Realtime — keep the local mirror fresh if the row changes (trial flip,
  // webhook activation). Filter by user_id to avoid cross-account noise.
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`subscription:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "subscriptions",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [user, refresh]);

  // Auto-recheck around the trial-expiry instant so the UI flips without a
  // page reload. We schedule a single timeout to the exact moment trial ends.
  useEffect(() => {
    if (!row?.trialEndsAt) return;
    const ms = row.trialEndsAt.getTime() - Date.now();
    if (ms <= 0 || ms > 1000 * 60 * 60 * 24 * 7) return; // skip if past or far away
    const t = setTimeout(() => void refresh(), ms + 1000);
    return () => clearTimeout(t);
  }, [row?.trialEndsAt, refresh]);

  const value = useMemo<Ctx>(() => {
    const tier: Tier = row?.tier ?? "free";
    const isTrial = row?.status === "trialing" && tier === "pro";
    const trialDaysLeft =
      isTrial && row?.trialEndsAt
        ? Math.max(
            0,
            Math.ceil(
              (row.trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
            ),
          )
        : null;
    return {
      tier,
      isTrial,
      trialEndsAt: row?.trialEndsAt ?? null,
      trialDaysLeft,
      limits: LIMITS[tier],
      loading,
      refresh,
    };
  }, [row, loading, refresh]);

  return <SubCtx.Provider value={value}>{children}</SubCtx.Provider>;
}

export function useSubscription(): Ctx {
  const v = useContext(SubCtx);
  if (!v) throw new Error("useSubscription must be used within SubscriptionProvider");
  return v;
}

/** Detects the Postgres-side quota error raised by our guard triggers
 *  (`RAISE EXCEPTION ... USING HINT = 'upgrade'`). Lets call sites convert a
 *  thrown insert-error into a paywall modal instead of a stack trace. */
export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const obj = e as Record<string, unknown>;
  if (obj.hint === "upgrade") return true;
  const msg = typeof obj.message === "string" ? obj.message : "";
  return /free-tier|upgrade/i.test(msg);
}
