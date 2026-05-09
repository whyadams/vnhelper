import { useState } from "react";
import { useKanban } from "../../state/kanbanStore";
import { useTranslations } from "../../state/translations";
import { canEdit } from "../../lib/roles";
import type { Role } from "../../lib/roles";
import {
  TranslationsSidebar,
  type FolderImportItem,
} from "./TranslationsSidebar";
import { ProjectDetailView } from "./ProjectDetailView";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { ImportRpyDialog } from "./ImportRpyDialog";
import { FolderImportDialog } from "./FolderImportDialog";

export function TranslationsScreen() {
  const { state } = useKanban();
  const api = useTranslations(state.workspaceId);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [folderItems, setFolderItems] = useState<FolderImportItem[] | null>(
    null,
  );
  const role = (state.myRole ?? "viewer") as Role;
  const editable = canEdit(role);

  const hasProjects = api.projects.length > 0;
  const hasActiveProject = !!api.activeProjectId;

  // The active translation's target language. With the new architecture,
  // a "project" represents one translation and its `name` IS the language.
  const activeProject = api.projects.find((p) => p.id === api.activeProjectId);
  const activeTargetLang = activeProject?.name ?? "";

  const onImport = async (
    filename: string,
    content: string,
    targetLang: string,
    folderPath: string = "",
  ) => {
    if (!api.activeProjectId) return null;
    const result = await api.importRpyFile(
      api.activeProjectId,
      filename,
      content,
      targetLang,
      folderPath,
    );
    if (result.warnings.length > 0) {
      console.warn("rpy import warnings:", result.warnings);
    }
    return { inserted: result.inserted, warnings: result.warnings.length };
  };

  return (
    <main className="main translations">
      <TranslationsSidebar
        api={api}
        canEdit={editable}
        onNewProject={() => setCreateOpen(true)}
        onImportFile={() => setImportOpen(true)}
        onImportFolder={(items) => setFolderItems(items)}
      />

      <section className="tr-detail">
        {!hasProjects ? (
          <div className="tr-empty">
            <h2>No translations yet.</h2>
            <p>
              A translation holds <code>.rpy</code> files for one target
              language.
            </p>
            {editable && (
              <button
                type="button"
                className="hbtn is-primary"
                onClick={() => setCreateOpen(true)}
              >
                Create translation
              </button>
            )}
          </div>
        ) : hasActiveProject ? (
          <ProjectDetailView
            api={api}
            role={role}
            onImport={() => setImportOpen(true)}
          />
        ) : (
          <div className="tr-empty">
            <p>Select a translation on the left.</p>
          </div>
        )}
      </section>

      <CreateProjectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (name, sourceLang) => {
          await api.createProject(name, sourceLang);
        }}
      />

      <ImportRpyDialog
        open={importOpen}
        defaultTargetLang={activeTargetLang}
        onClose={() => setImportOpen(false)}
        onImport={onImport}
      />

      <FolderImportDialog
        open={folderItems !== null}
        items={folderItems}
        defaultTargetLang={activeTargetLang}
        onClose={() => setFolderItems(null)}
        onImport={onImport}
      />
    </main>
  );
}
