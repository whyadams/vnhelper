import { useState } from "react";
import { useKanban } from "../../state/kanbanStore";
import { useScripts } from "../../state/scripts";
import { CreateProjectModal } from "./CreateProjectModal";
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
  const [view, setView] = useState<View>("scene");

  return (
    <>
      <ScriptPane
        scripts={scripts}
        onCreateProject={() => setCreateOpen(true)}
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
