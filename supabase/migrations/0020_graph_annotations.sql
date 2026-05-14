-- Sticky-note annotations on the story-flow Graph canvas. Not tied to any
-- label — exist as independent canvas elements holding "TODO" / "note to
-- self" content that doesn't belong inside a scene's rpy_blocks. Position
-- is in canvas-space (same coord system as graph_layouts).
create table public.graph_annotations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.script_projects(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  x double precision not null default 0,
  y double precision not null default 0,
  text text not null default '',
  -- Free-form colour key: ui maps yellow/blue/red/green/purple to tokens.
  -- text instead of enum so adding a colour is a frontend-only change.
  color text not null default 'yellow',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index graph_annotations_project_id_idx
  on public.graph_annotations(project_id);

alter table public.graph_annotations enable row level security;

-- Read: any role with script access (mirrors graph_layouts).
create policy "graph_annotations_select" on public.graph_annotations
  for select
  using (script_role_in(workspace_id) is not null);

-- Insert / update / delete: owner or editor — viewers can read but not
-- mutate. Same role set graph_layouts uses; consistency over fine-grain.
create policy "graph_annotations_insert" on public.graph_annotations
  for insert
  with check (script_role_in(workspace_id) = any (array['owner','editor']));

create policy "graph_annotations_update" on public.graph_annotations
  for update
  using (script_role_in(workspace_id) = any (array['owner','editor']))
  with check (script_role_in(workspace_id) = any (array['owner','editor']));

create policy "graph_annotations_delete" on public.graph_annotations
  for delete
  using (script_role_in(workspace_id) = any (array['owner','editor']));

-- Keep updated_at fresh on every write.
create trigger graph_annotations_touch_updated_at
  before update on public.graph_annotations
  for each row
  execute function public.touch_updated_at();

-- Realtime: sticky notes are collaboration-oriented, so live propagation
-- of inserts / updates / deletes is the expected UX.
alter table public.graph_annotations replica identity full;
alter publication supabase_realtime add table public.graph_annotations;
