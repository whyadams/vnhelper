create table if not exists script_translation_files (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references script_projects(id) on delete cascade,
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  language        text not null,
  relative_path   text not null,
  sort_order      bigint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_id, language, relative_path)
);
create index if not exists script_tl_files_project_idx
  on script_translation_files (project_id, language);

create table if not exists script_translation_entries (
  id              uuid primary key default gen_random_uuid(),
  file_id         uuid not null references script_translation_files(id) on delete cascade,
  block_label     text,
  block_index     int  not null default 0,
  entry_index     int  not null default 0,
  source_file     text,
  source_line     int,
  old_text        text not null,
  new_text        text not null default '',
  status          text not null default 'untranslated',
  updated_at      timestamptz not null default now(),
  updated_by      uuid references profiles(id) on delete set null
);
create index if not exists script_tl_entries_file_idx
  on script_translation_entries (file_id, block_index, entry_index);
create index if not exists script_tl_entries_status_idx
  on script_translation_entries (file_id, status);

drop trigger if exists trg_script_tl_files_upd on script_translation_files;
create trigger trg_script_tl_files_upd
  before update on script_translation_files
  for each row execute function set_updated_at_now();

drop trigger if exists trg_script_tl_entries_upd on script_translation_entries;
create trigger trg_script_tl_entries_upd
  before update on script_translation_entries
  for each row execute function set_updated_at_now();

alter table script_translation_files   enable row level security;
alter table script_translation_entries enable row level security;

drop policy if exists script_tl_files_select on script_translation_files;
create policy script_tl_files_select on script_translation_files
  for select using (script_role_in(workspace_id) is not null);

drop policy if exists script_tl_files_insert on script_translation_files;
create policy script_tl_files_insert on script_translation_files
  for insert with check (script_role_in(workspace_id) in ('owner','editor'));

drop policy if exists script_tl_files_update on script_translation_files;
create policy script_tl_files_update on script_translation_files
  for update using (script_role_in(workspace_id) in ('owner','editor'))
  with check (script_role_in(workspace_id) in ('owner','editor'));

drop policy if exists script_tl_files_delete on script_translation_files;
create policy script_tl_files_delete on script_translation_files
  for delete using (script_role_in(workspace_id) in ('owner','editor'));

drop policy if exists script_tl_entries_select on script_translation_entries;
create policy script_tl_entries_select on script_translation_entries
  for select using (
    exists (select 1 from script_translation_files f
            where f.id = file_id and script_role_in(f.workspace_id) is not null)
  );

drop policy if exists script_tl_entries_insert on script_translation_entries;
create policy script_tl_entries_insert on script_translation_entries
  for insert with check (
    exists (select 1 from script_translation_files f
            where f.id = file_id and script_role_in(f.workspace_id) in ('owner','editor'))
  );

drop policy if exists script_tl_entries_update on script_translation_entries;
create policy script_tl_entries_update on script_translation_entries
  for update using (
    exists (select 1 from script_translation_files f
            where f.id = file_id and script_role_in(f.workspace_id) in ('owner','editor'))
  )
  with check (
    exists (select 1 from script_translation_files f
            where f.id = file_id and script_role_in(f.workspace_id) in ('owner','editor'))
  );

drop policy if exists script_tl_entries_delete on script_translation_entries;
create policy script_tl_entries_delete on script_translation_entries
  for delete using (
    exists (select 1 from script_translation_files f
            where f.id = file_id and script_role_in(f.workspace_id) in ('owner','editor'))
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table script_translation_files;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table script_translation_entries;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
