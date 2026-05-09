-- Preserve relative folder structure for files imported as a folder.
-- folder_path = relative directory (e.g. "game/script" or
-- "game/assets/preferences"), empty string for files at the import root.
alter table translation_files
  add column if not exists folder_path text not null default '';

-- Useful when listing/grouping files by folder for a single project.
create index if not exists translation_files_project_folder_idx
  on translation_files (project_id, folder_path, filename);
