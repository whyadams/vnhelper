-- ============================================================
-- Translations feature: workspace owners import Ren'Py .rpy
-- translation files; translators are scoped to a single
-- target language per workspace membership.
--
-- Adds 'translator' to the workspace_role enum, a per-membership
-- target_language column, three new tables (projects, files,
-- strings), RLS, and an updated_at/updated_by touch trigger.
-- ============================================================

-- -- extend workspace_role enum --------------------------------------------
-- ALTER TYPE ... ADD VALUE works inside a transaction since PG12, but the
-- new value cannot be referenced in the same transaction. Subsequent CHECK
-- constraints below therefore compare role::text rather than role itself.
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'workspace_role' and e.enumlabel = 'translator'
  ) then
    alter type workspace_role add value 'translator';
  end if;
end $$;

-- -- per-membership target language ---------------------------------------
alter table workspace_members
  add column if not exists target_language text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workspace_members_target_language_chk'
  ) then
    alter table workspace_members
      add constraint workspace_members_target_language_chk
      check (
        (target_language is null or role::text = 'translator')
        and ((role::text = 'translator') = (target_language is not null))
      );
  end if;
end $$;

-- -- projects --------------------------------------------------------------
create table if not exists translation_projects (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  source_lang  text not null default 'english',
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null
);
create index if not exists translation_projects_ws_idx on translation_projects (workspace_id);

-- -- files -----------------------------------------------------------------
create table if not exists translation_files (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references translation_projects(id) on delete cascade,
  filename        text not null,
  raw_content     text not null,
  target_language text not null,
  uploaded_at     timestamptz not null default now(),
  uploaded_by     uuid references auth.users(id) on delete set null
);
create index if not exists translation_files_project_lang_idx
  on translation_files (project_id, target_language);

-- -- strings ---------------------------------------------------------------
create table if not exists translation_strings (
  id              uuid primary key default gen_random_uuid(),
  file_id         uuid not null references translation_files(id) on delete cascade,
  group_label     text null,
  source_path     text not null,
  source_line     int  not null,
  source_text     text not null,
  translated_text text not null default '',
  status          text not null default 'empty'
                  check (status in ('empty','draft','done')),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null
);
create index if not exists translation_strings_file_idx on translation_strings (file_id);
create index if not exists translation_strings_file_status_idx
  on translation_strings (file_id, status);

-- -- touch trigger ---------------------------------------------------------
-- On every UPDATE: refresh updated_at + updated_by, and enforce that a
-- translator may only modify translated_text / status (not source columns
-- or file_id). Owner/editor have no such restriction.
create or replace function translation_strings_touch() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ws_id uuid;
  caller_role text;
begin
  if tg_op = 'UPDATE' then
    select tp.workspace_id into ws_id
      from translation_files tf
      join translation_projects tp on tp.id = tf.project_id
     where tf.id = old.file_id;

    select role::text into caller_role
      from workspace_members
     where workspace_id = ws_id and user_id = auth.uid()
     limit 1;

    if caller_role = 'translator' then
      if new.file_id      is distinct from old.file_id
      or new.source_text  is distinct from old.source_text
      or new.source_path  is distinct from old.source_path
      or new.source_line  is distinct from old.source_line
      or new.group_label  is distinct from old.group_label then
        raise exception 'translators may only update translated_text and status';
      end if;
    end if;

    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_translation_strings_touch on translation_strings;
create trigger trg_translation_strings_touch
  before update on translation_strings
  for each row execute function translation_strings_touch();

-- ============================================================
-- Row Level Security
-- ============================================================
alter table translation_projects enable row level security;
alter table translation_files    enable row level security;
alter table translation_strings  enable row level security;

-- helper: caller's role in workspace, or null
create or replace function translation_role_in(workspace_uuid uuid)
returns text language sql stable security definer set search_path = public as $$
  select role::text from workspace_members
   where workspace_id = workspace_uuid and user_id = auth.uid()
   limit 1
$$;

-- ----- translation_projects -----
drop policy if exists translation_projects_select on translation_projects;
create policy translation_projects_select on translation_projects
  for select using (translation_role_in(workspace_id) is not null);

drop policy if exists translation_projects_insert on translation_projects;
create policy translation_projects_insert on translation_projects
  for insert with check (translation_role_in(workspace_id) in ('owner','editor'));

drop policy if exists translation_projects_update on translation_projects;
create policy translation_projects_update on translation_projects
  for update using (translation_role_in(workspace_id) in ('owner','editor'))
  with check (translation_role_in(workspace_id) in ('owner','editor'));

drop policy if exists translation_projects_delete on translation_projects;
create policy translation_projects_delete on translation_projects
  for delete using (translation_role_in(workspace_id) in ('owner','editor'));

-- ----- translation_files -----
drop policy if exists translation_files_select on translation_files;
create policy translation_files_select on translation_files
  for select using (
    exists (
      select 1 from translation_projects p
      where p.id = translation_files.project_id
        and (
          translation_role_in(p.workspace_id) in ('owner','editor','viewer')
          or (
            translation_role_in(p.workspace_id) = 'translator'
            and translation_files.target_language = (
              select wm.target_language from workspace_members wm
              where wm.workspace_id = p.workspace_id and wm.user_id = auth.uid()
              limit 1
            )
          )
        )
    )
  );

drop policy if exists translation_files_insert on translation_files;
create policy translation_files_insert on translation_files
  for insert with check (
    exists (
      select 1 from translation_projects p
      where p.id = translation_files.project_id
        and translation_role_in(p.workspace_id) in ('owner','editor')
    )
  );

drop policy if exists translation_files_update on translation_files;
create policy translation_files_update on translation_files
  for update using (
    exists (
      select 1 from translation_projects p
      where p.id = translation_files.project_id
        and translation_role_in(p.workspace_id) in ('owner','editor')
    )
  )
  with check (
    exists (
      select 1 from translation_projects p
      where p.id = translation_files.project_id
        and translation_role_in(p.workspace_id) in ('owner','editor')
    )
  );

drop policy if exists translation_files_delete on translation_files;
create policy translation_files_delete on translation_files
  for delete using (
    exists (
      select 1 from translation_projects p
      where p.id = translation_files.project_id
        and translation_role_in(p.workspace_id) in ('owner','editor')
    )
  );

-- ----- translation_strings -----
drop policy if exists translation_strings_select on translation_strings;
create policy translation_strings_select on translation_strings
  for select using (
    exists (
      select 1 from translation_files f
      join translation_projects p on p.id = f.project_id
      where f.id = translation_strings.file_id
        and (
          translation_role_in(p.workspace_id) in ('owner','editor','viewer')
          or (
            translation_role_in(p.workspace_id) = 'translator'
            and f.target_language = (
              select wm.target_language from workspace_members wm
              where wm.workspace_id = p.workspace_id and wm.user_id = auth.uid()
              limit 1
            )
          )
        )
    )
  );

drop policy if exists translation_strings_insert on translation_strings;
create policy translation_strings_insert on translation_strings
  for insert with check (
    exists (
      select 1 from translation_files f
      join translation_projects p on p.id = f.project_id
      where f.id = translation_strings.file_id
        and translation_role_in(p.workspace_id) in ('owner','editor')
    )
  );

-- UPDATE: owner/editor anywhere in their workspace; translator only on
-- strings whose file.target_language matches their assigned language.
-- Column-level immutability for translators is enforced by the touch
-- trigger above (PostgreSQL RLS policies cannot compare OLD vs NEW).
drop policy if exists translation_strings_update on translation_strings;
create policy translation_strings_update on translation_strings
  for update using (
    exists (
      select 1 from translation_files f
      join translation_projects p on p.id = f.project_id
      where f.id = translation_strings.file_id
        and (
          translation_role_in(p.workspace_id) in ('owner','editor')
          or (
            translation_role_in(p.workspace_id) = 'translator'
            and f.target_language = (
              select wm.target_language from workspace_members wm
              where wm.workspace_id = p.workspace_id and wm.user_id = auth.uid()
              limit 1
            )
          )
        )
    )
  )
  with check (
    exists (
      select 1 from translation_files f
      join translation_projects p on p.id = f.project_id
      where f.id = translation_strings.file_id
        and (
          translation_role_in(p.workspace_id) in ('owner','editor')
          or (
            translation_role_in(p.workspace_id) = 'translator'
            and f.target_language = (
              select wm.target_language from workspace_members wm
              where wm.workspace_id = p.workspace_id and wm.user_id = auth.uid()
              limit 1
            )
          )
        )
    )
  );

drop policy if exists translation_strings_delete on translation_strings;
create policy translation_strings_delete on translation_strings
  for delete using (
    exists (
      select 1 from translation_files f
      join translation_projects p on p.id = f.project_id
      where f.id = translation_strings.file_id
        and translation_role_in(p.workspace_id) in ('owner','editor')
    )
  );

-- ============================================================
-- Realtime publication
-- ============================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table translation_projects;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table translation_files;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table translation_strings;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
