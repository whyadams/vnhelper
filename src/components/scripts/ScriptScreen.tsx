import { useEffect, useState } from "react";
import { useKanban } from "../../state/kanbanStore";
import type { ScriptProject } from "../../state/scripts";
import { useScripts } from "../../state/scripts";
import { supabase } from "../../lib/supabase";
import { useSubscription } from "../../state/subscription";
import { usePaywall } from "../subscription/Paywall";
import { CreateProjectModal } from "./CreateProjectModal";
import { EditProjectModal } from "./EditProjectModal";
import { QuickAddCharacterModal } from "./QuickAddCharacterModal";
import { ScriptCharactersPage } from "./ScriptCharactersPage";
import { ScriptDoc } from "./ScriptDoc";
import { ScriptPane } from "./ScriptPane";

type View = "scene" | "characters";

export function ScriptScreen() {
  const { state, dispatch } = useKanban();
  const scripts = useScripts(state.workspaceId);
  const { limits } = useSubscription();
  const paywall = usePaywall();
  const [createOpen, setCreateOpen] = useState(false);

  // Free tier may only host 1 script project per workspace. Gate here so the
  // modal never opens — the DB trigger is the backstop if someone bypasses.
  const atProjectLimit =
    scripts.projects.length >= limits.maxScriptProjectsPerWorkspace;
  const tryOpenCreate = () => {
    if (atProjectLimit) {
      paywall.show("script_project_limit");
      return;
    }
    setCreateOpen(true);
  };
  const [quickCharOpen, setQuickCharOpen] = useState(false);
  const [editProject, setEditProject] = useState<ScriptProject | null>(null);
  const [view, setView] = useState<View>("scene");
  /** Character id queued for editing — handed to ScriptCharactersPage so it
   *  can open the editor when navigated from elsewhere (e.g. Calendar). */
  const [pendingEditCharId, setPendingEditCharId] = useState<string | null>(
    null,
  );

  // React to cross-screen focus requests from kanbanStore. We need to look up
  // the row's `project_id` to switch projects first when necessary — the
  // calendar attachment only carries the entity id.
  useEffect(() => {
    const focus = state.pendingFocus;
    if (!focus) return;
    if (focus.kind !== "script_node" && focus.kind !== "character") return;

    let cancelled = false;
    void (async () => {
      try {
        if (focus.kind === "script_node") {
          const { data, error } = await supabase
            .from("script_nodes")
            .select("id, project_id")
            .eq("id", focus.id)
            .maybeSingle();
          if (cancelled) return;
          if (error || !data) {
            console.error("pendingFocus script_node lookup", error);
            return;
          }
          setView("scene");
          scripts.setActiveProjectId(data.project_id);
          scripts.setActiveNodeId(data.id);
        } else {
          const { data, error } = await supabase
            .from("script_characters")
            .select("id, project_id")
            .eq("id", focus.id)
            .maybeSingle();
          if (cancelled) return;
          if (error || !data) {
            console.error("pendingFocus character lookup", error);
            return;
          }
          scripts.setActiveProjectId(data.project_id);
          setView("characters");
          setPendingEditCharId(data.id);
        }
      } finally {
        if (!cancelled) {
          dispatch({ type: "CLEAR_PENDING_FOCUS" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only react to a *new* pendingFocus request; scripts.setActiveProjectId
    // identity changes on every render and would otherwise re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingFocus]);

  return (
    <>
      <ScriptPane
        scripts={scripts}
        onCreateProject={tryOpenCreate}
        onEditProject={(p) => setEditProject(p)}
        onShowCharacters={() => setView("characters")}
        charactersActive={view === "characters"}
      />
      {view === "scene" ? (
        <ScriptDoc
          scripts={scripts}
          onAddCharacter={() => setQuickCharOpen(true)}
        />
      ) : (
        <ScriptCharactersPage
          scripts={scripts}
          onBack={() => setView("scene")}
          onAddCharacter={() => setQuickCharOpen(true)}
          initialEditingId={pendingEditCharId}
          onConsumeInitialEditingId={() => setPendingEditCharId(null)}
        />
      )}
      <CreateProjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={(title, emoji) => {
          void scripts.createProject(title, emoji);
        }}
      />
      <EditProjectModal
        open={editProject !== null}
        project={editProject}
        onClose={() => setEditProject(null)}
        onSave={(patch) => {
          if (editProject) void scripts.updateProject(editProject.id, patch);
        }}
        onUploadCover={async (file) => {
          if (!editProject) return null;
          return scripts.uploadProjectCover(editProject.id, file);
        }}
        onRemoveCover={async () => {
          if (editProject) await scripts.removeProjectCover(editProject.id);
        }}
        onDelete={async () => {
          if (editProject) await scripts.deleteProject(editProject.id);
        }}
      />
      <QuickAddCharacterModal
        open={quickCharOpen}
        onClose={() => setQuickCharOpen(false)}
        existingNames={scripts.characters.flatMap((c) => [
          c.name,
          ...(c.aliases ?? []),
        ])}
        onSubmit={({ name, aliases, color, emoji }) => {
          void scripts.createCharacter(name, {
            color,
            aliases,
            emoji: emoji || null,
          });
        }}
      />
    </>
  );
}
