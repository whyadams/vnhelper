import { useEffect } from "react";
import { useKanban } from "../../state/kanbanStore";
import { useSubscription } from "../../state/subscription";
import { computeFrozenEntities } from "../../state/frozenEntities";

/**
 * Side-effect-only component. Watches the workspace list, the active
 * workspace id, and the current tier; if the active workspace has just
 * become frozen (e.g., trial expired while the user was inside one of
 * their overflow workspaces), dispatches a switch to the active (oldest
 * owned) one so the user isn't stuck looking at a paywalled shell.
 *
 * Renders nothing — mount once high in the tree, inside both the
 * SubscriptionProvider and the KanbanProvider.
 */
export function FrozenAutoSwitcher() {
  const { state, dispatch } = useKanban();
  const { limits, loading } = useSubscription();

  useEffect(() => {
    if (loading) return;
    if (!state.workspaceId) return;
    const { frozenWorkspaceIds, activeOwnedWorkspaceId } = computeFrozenEntities(
      state.workspaces,
      [],
      limits,
    );
    if (!frozenWorkspaceIds.has(state.workspaceId)) return;
    // The current pick is frozen. Move the user to a safe workspace —
    // prefer the active owned one; if for some reason there isn't one
    // (e.g., user only has invited workspaces), pick the first non-frozen
    // entry in the list.
    let target = activeOwnedWorkspaceId;
    if (!target) {
      const first = state.workspaces.find((w) => !frozenWorkspaceIds.has(w.id));
      target = first?.id ?? null;
    }
    if (target && target !== state.workspaceId) {
      dispatch({ type: "SET_ACTIVE_WORKSPACE", id: target });
    }
  }, [state.workspaceId, state.workspaces, limits, loading, dispatch]);

  return null;
}
