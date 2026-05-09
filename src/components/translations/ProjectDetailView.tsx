import { canEdit } from "../../lib/roles";
import type { Role } from "../../lib/roles";
import {
  serializeRenpyTranslations,
  type ParsedString,
} from "../../lib/renpy";
import type {
  TranslationsApi,
  TranslationString,
} from "../../state/translations";
import { TranslationEditor } from "./TranslationEditor";

interface Props {
  api: TranslationsApi;
  role: Role;
  onImport: () => void;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function stringsToParsed(
  rows: TranslationString[],
  targetLang: string,
): ParsedString[] {
  return rows.map((s) => ({
    groupLabel: s.groupLabel,
    targetLanguage: targetLang,
    sourcePath: s.sourcePath,
    sourceLine: s.sourceLine,
    sourceText: s.sourceText,
    translatedText: s.translatedText,
    translateId: s.translateId,
    speaker: s.speaker,
    trailing: s.trailing,
  }));
}

export function ProjectDetailView({ api, role, onImport }: Props) {
  const editable = canEdit(role);
  const project = api.projects.find((p) => p.id === api.activeProjectId);
  const activeFile = api.files.find((f) => f.id === api.activeFileId) ?? null;

  const onExport = () => {
    if (!activeFile) return;
    const rows = stringsToParsed(api.strings, activeFile.target_language);
    const text = serializeRenpyTranslations(rows);
    downloadText(activeFile.filename, text);
  };

  if (!project) {
    return <div className="tr-empty">Project not found.</div>;
  }

  if (!activeFile) {
    return (
      <div className="tr-empty">
        <h2>{project.name}</h2>
        <p>
          {api.files.length === 0
            ? "No files yet — import a .rpy to start translating."
            : "Pick a file from the list to start editing."}
        </p>
        {editable && api.files.length === 0 && (
          <button type="button" className="hbtn is-primary" onClick={onImport}>
            Import .rpy
          </button>
        )}
      </div>
    );
  }

  return (
    <TranslationEditor
      api={api}
      file={activeFile}
      role={role}
      sourceLang={project.source_lang}
      onExport={onExport}
      onImport={onImport}
      canEdit={editable}
    />
  );
}
