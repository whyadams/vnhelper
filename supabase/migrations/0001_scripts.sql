-- ============================================================
-- VN Script feature: projects, nodes (chapters/scenes/blocks),
-- characters, locations.
--
-- All scoped per workspace; RLS based on workspace_members
-- (uses helper logic identical to existing notes/cards tables).
-- ============================================================

-- -- node kinds enum --------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'script_node_kind') then
    create type script_node_kind as enum ('chapter', 'scene', 'block');
  end if;
end $$;

-- -- projects ---------------------------------------------------------------
create table if not exists script_projects (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title        text not null default 'Untitled Script',
  synopsis     text not null default '',
  cover_emoji  text,
  position     bigint not null default extract(epoch from now())::bigint,
  created_by   uuid references profiles(id) on delete set null,
  updated_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists script_projects_ws_idx on script_projects (workspace_id);

-- -- nodes (tree of chapters / scenes / blocks) -----------------------------
create table if not exists script_nodes (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references script_projects(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  parent_id    uuid references script_nodes(id) on delete cascade,
  kind         script_node_kind not null default 'scene',
  title        text not null default 'Untitled',
  emoji        text,
  body         text not null default '',
  content      jsonb,
  tags         text[] not null default '{}',
  status       text not null default 'draft',  -- draft | wip | review | final
  pov          text,                            -- character id or free text
  location_id  uuid,
  pinned       boolean not null default false,
  position     bigint not null default extract(epoch from now())::bigint,
  created_by   uuid references profiles(id) on delete set null,
  updated_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists script_nodes_project_idx on script_nodes (project_id);
create index if not exists script_nodes_parent_idx  on script_nodes (parent_id);
create index if not exists script_nodes_ws_idx      on script_nodes (workspace_id);

-- -- characters -------------------------------------------------------------
create table if not exists script_characters (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references script_projects(id) on delete cascade,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  name          text not null,
  short_name    text,
  color         text not null default '#6aa6ff',
  emoji         text,
  pronouns      text,
  age           text,
  role          text,                      -- protagonist | antagonist | side | npc
  voice_notes   text not null default '',
  traits        jsonb not null default '{}'::jsonb,
  position      bigint not null default extract(epoch from now())::bigint,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists script_characters_project_idx on script_characters (project_id);
create unique index if not exists script_characters_short_name_uidx
  on script_characters (project_id, short_name) where short_name is not null;

-- -- locations --------------------------------------------------------------
create table if not exists script_locations (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references script_projects(id) on delete cascade,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  name          text not null,
  description   text not null default '',
  mood          text,
  image_url     text,
  position      bigint not null default extract(epoch from now())::bigint,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists script_locations_project_idx on script_locations (project_id);

-- FK from nodes.location_id (added now that locations exists)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'script_nodes_location_fk'
  ) then
    alter table script_nodes
      add constraint script_nodes_location_fk
      foreign key (location_id) references script_locations(id) on delete set null;
  end if;
end $$;

-- -- updated_at triggers ----------------------------------------------------
create or replace function set_updated_at_now() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_script_projects_upd on script_projects;
create trigger trg_script_projects_upd before update on script_projects
  for each row execute function set_updated_at_now();

drop trigger if exists trg_script_nodes_upd on script_nodes;
create trigger trg_script_nodes_upd before update on script_nodes
  for each row execute function set_updated_at_now();

drop trigger if exists trg_script_characters_upd on script_characters;
create trigger trg_script_characters_upd before update on script_characters
  for each row execute function set_updated_at_now();

drop trigger if exists trg_script_locations_upd on script_locations;
create trigger trg_script_locations_upd before update on script_locations
  for each row execute function set_updated_at_now();

-- ============================================================
-- Row Level Security
-- A user has access to a row iff they are a member of its workspace.
-- Editor/Owner can write; viewers can only read.
-- ============================================================

alter table script_projects   enable row level security;
alter table script_nodes      enable row level security;
alter table script_characters enable row level security;
alter table script_locations  enable row level security;

-- helper: current user's role in workspace ('owner' | 'editor' | 'viewer' | null)
create or replace function script_role_in(_ws uuid)
returns text language sql stable security definer set search_path = public as $$
  select role::text from workspace_members
  where workspace_id = _ws and user_id = auth.uid()
  limit 1
$$;

-- ----- projects -----
drop policy if exists script_projects_select on script_projects;
create policy script_projects_select on script_projects
  for select using (script_role_in(workspace_id) is not null);

drop policy if exists script_projects_insert on script_projects;
create policy script_projects_insert on script_projects
  for insert with check (script_role_in(workspace_id) in ('owner','editor'));

drop policy if exists script_projects_update on script_projects;
create policy script_projects_update on script_projects
  for update using (script_role_in(workspace_id) in ('owner','editor'))
  with check (script_role_in(workspace_id) in ('owner','editor'));

drop policy if exists script_projects_delete on script_projects;
create policy script_projects_delete on script_projects
  for delete using (script_role_in(workspace_id) in ('owner','editor'));

-- ----- nodes -----
drop policy if exists script_nodes_select on script_nodes;
create policy script_nodes_select on script_nodes
  for select using (script_role_in(workspace_id) is not null);

drop policy if exists script_nodes_insert on script_nodes;
create policy script_nodes_insert on script_nodes
  for insert with check (script_role_in(workspace_id) in ('owner','editor'));

drop policy if exists script_nodes_update on script_nodes;
create policy script_nodes_update on script_nodes
  for update using (script_role_in(workspace_id) in ('owner','editor'))
  with check (script_role_in(workspace_id) in ('owner','editor'));

drop policy if exists script_nodes_delete on script_nodes;
create policy script_nodes_delete on script_nodes
  for delete using (script_role_in(workspace_id) in ('owner','editor'));

-- ----- characters -----
drop policy if exists script_characters_select on script_characters;
create policy script_characters_select on script_characters
  for select using (script_role_in(workspace_id) is not null);

drop policy if exists script_characters_insert on script_characters;
create policy script_characters_insert on script_characters
  for insert with check (script_role_in(workspace_id) in ('owner','editor'));

drop policy if exists script_characters_update on script_characters;
create policy script_characters_update on script_characters
  for update using (script_role_in(workspace_id) in ('owner','editor'))
  with check (script_role_in(workspace_id) in ('owner','editor'));

drop policy if exists script_characters_delete on script_characters;
create policy script_characters_delete on script_characters
  for delete using (script_role_in(workspace_id) in ('owner','editor'));

-- ----- locations -----
drop policy if exists script_locations_select on script_locations;
create policy script_locations_select on script_locations
  for select using (script_role_in(workspace_id) is not null);

drop policy if exists script_locations_insert on script_locations;
create policy script_locations_insert on script_locations
  for insert with check (script_role_in(workspace_id) in ('owner','editor'));

drop policy if exists script_locations_update on script_locations;
create policy script_locations_update on script_locations
  for update using (script_role_in(workspace_id) in ('owner','editor'))
  with check (script_role_in(workspace_id) in ('owner','editor'));

drop policy if exists script_locations_delete on script_locations;
create policy script_locations_delete on script_locations
  for delete using (script_role_in(workspace_id) in ('owner','editor'));

-- ============================================================
-- Realtime publication
-- ============================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table script_projects;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table script_nodes;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table script_characters;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table script_locations;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
