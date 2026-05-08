import { useState } from "react";
import { useKanban } from "../../state/kanbanStore";
import type { ScriptProject } from "../../state/scripts";
import { useScripts } from "../../state/scripts";
import { CreateProjectModal } from "./CreateProjectModal";
import { EditProjectModal } from "./EditProjectModal";
import { QuickAddCharacterModal } from "./QuickAddCharacterModal";
import { ScriptCharactersPage } from "./ScriptCharactersPage";
import { ScriptDoc } from "./ScriptDoc";
import { ScriptPane } from "./ScriptPane";

type View = "scene" | "characters";

export function ScriptScreen() {
  const { state } = useKanban();
  const scripts = useScripts(state.workspaceId);
  const [createOpen, setCreateOpen] = useState(false);
  const [quickCharOpen, setQuickCharOpen] = useState(false);
  const [editProject, setEditProject] = useState<ScriptProject | null>(null);
  const [view, setView] = useState<View>("scene");

  return (
    <>
      <ScriptPane
        scripts={scripts}
        onCreateProject={() => setCreateOpen(true)}
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
