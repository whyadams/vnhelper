import { useMemo } from "react";
import type { TierLimits } from "./subscription";

/**
 * "Lock-on-open" downgrade model.
 *
 * When the trial ends, a user can no longer create new workspaces / script
 * projects past the free-tier quota — but anything they created during the
 * trial still exists in the DB. We don't delete or hide it; we mark the
 * "overflow" entities as frozen, render them with a lock badge, and pop a
 * paywall when the user tries to enter them. Their data is preserved and
 * instantly unfrozen the moment they upgrade.
 *
 * "Active" picks are deterministic: oldest by created_at. The oldest is
 * almost always the one the user cares about (the first thing they made),
 * and not having to ask them on expiry keeps the UX quiet.
 *
 * Only entities the current user OWNS are subject to freezing. A workspace
 * the user joined via invite is gated by the inviter's tier on the server
 * side (the inviter couldn't have invited them on free, so its existence
 * implies a paying owner) — for the invitee, the workspace and everything
 * inside stays fully accessible regardless of their own tier.
 */

export interface FrozenSet {
  /** Owned workspace ids that should be locked behind a paywall. */
  frozenWorkspaceIds: Set<string>;
  /** The single workspace that's accessible on free tier (oldest owned).
   *  Null when the user owns nothing. */
  activeOwnedWorkspaceId: string | null;
  /** Map workspace_id → project ids in that workspace that are frozen.
   *  Only populated for workspaces the user owns. */
  frozenProjectIds: Map<string, Set<string>>;
  /** workspace_id → the single project id that's accessible on free tier. */
  activeProjectIdByWorkspace: Map<string, string | null>;
}

interface WorkspaceLike {
  id: string;
  role: string;
  created_at?: string; // optional — older list items may not carry it
}

interface ProjectLike {
  id: string;
  workspace_id: string;
  created_at?: string;
}

/**
 * Pure computation — easy to unit-test, no hook dependencies. Receives
 * lists from kanbanStore / scripts and the resolved `limits` from
 * `useSubscription`. Re-runs whenever any input identity changes.
 */
export function computeFrozenEntities(
  workspaces: WorkspaceLike[],
  projects: ProjectLike[],
  limits: TierLimits,
): FrozenSet {
  // Sort owned workspaces by created_at ascending (oldest first). When
  // created_at is missing (older list shapes), fall back to id sort so the
  // ordering is at least stable across renders.
  const owned = workspaces
    .filter((w) => w.role === "owner")
    .slice()
    .sort((a, b) => {
      if (a.created_at && b.created_at) {
        return a.created_at.localeCompare(b.created_at);
      }
      return a.id.localeCompare(b.id);
    });

  const frozenWorkspaceIds = new Set<string>();
  let activeOwnedWorkspaceId: string | null = null;
  if (owned.length > 0) {
    activeOwnedWorkspaceId = owned[0].id;
    if (Number.isFinite(limits.maxWorkspaces)) {
      // Anything past the first N owned is frozen.
      for (let i = limits.maxWorkspaces; i < owned.length; i++) {
        frozenWorkspaceIds.add(owned[i].id);
      }
    }
  }

  // Projects: group by workspace; oldest per workspace is active, rest frozen.
  const projectsByWs = new Map<string, ProjectLike[]>();
  for (const p of projects) {
    const arr = projectsByWs.get(p.workspace_id) ?? [];
    arr.push(p);
    projectsByWs.set(p.workspace_id, arr);
  }

  const frozenProjectIds = new Map<string, Set<string>>();
  const activeProjectIdByWorkspace = new Map<string, string | null>();
  const ownedIds = new Set(owned.map((w) => w.id));

  for (const [wsId, list] of projectsByWs) {
    list.sort((a, b) => {
      if (a.created_at && b.created_at) {
        return a.created_at.localeCompare(b.created_at);
      }
      return a.id.localeCompare(b.id);
    });
    activeProjectIdByWorkspace.set(wsId, list[0]?.id ?? null);
    // Only freeze projects in OWNED workspaces. Workspaces we're invited to
    // are gated by the owner's tier elsewhere.
    if (!ownedIds.has(wsId)) continue;
    if (!Number.isFinite(limits.maxScriptProjectsPerWorkspace)) continue;
    const frozen = new Set<string>();
    for (let i = limits.maxScriptProjectsPerWorkspace; i < list.length; i++) {
      frozen.add(list[i].id);
    }
    if (frozen.size > 0) frozenProjectIds.set(wsId, frozen);
  }

  return {
    frozenWorkspaceIds,
    activeOwnedWorkspaceId,
    frozenProjectIds,
    activeProjectIdByWorkspace,
  };
}

/** Hook variant — memoises against the inputs so callers can pass without
 *  worrying about identity stability. */
export function useFrozenEntities(
  workspaces: WorkspaceLike[],
  projects: ProjectLike[],
  limits: TierLimits,
): FrozenSet {
  return useMemo(
    () => computeFrozenEntities(workspaces, projects, limits),
    [workspaces, projects, limits],
  );
}
