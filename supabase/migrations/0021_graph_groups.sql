-- Named coloured groups over sticky-note-style label clusters on the
-- Graph canvas. Authors mark "this is the Alice romance arc" or "all
-- side-quest scenes" as a translucent rectangle behind the labels.
-- Stored as a list of label_names (the same string ids graph_layouts
-- and the xyflow graph use), not via a join table — labels are project-
-- unique strings, the list rarely grows past a dozen entries per group,
-- and this keeps the table flat enough for cheap realtime payloads.
create table public.graph_groups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.script_projects(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null default '',
  -- Free-form colour key: ui maps blue/green/purple/amber/red to tokens.
  color text not null default 'blue',
  label_names text[] not null default array[]::text[],
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index graph_groups_project_id_idx on public.graph_groups(project_id);

alter table public.graph_groups enable row level security;

create policy "graph_groups_select" on public.graph_groups
  for select
  using (script_role_in(workspace_id) is not null);

create policy "graph_groups_insert" on public.graph_groups
  for insert
  with check (script_role_in(workspace_id) = any (array['owner','editor']));

create policy "graph_groups_update" on public.graph_groups
  for update
  using (script_role_in(workspace_id) = any (array['owner','editor']))
  with check (script_role_in(workspace_id) = any (array['owner','editor']));

create policy "graph_groups_delete" on public.graph_groups
  for delete
  using (script_role_in(workspace_id) = any (array['owner','editor']));

create trigger graph_groups_touch_updated_at
  before update on public.graph_groups
  for each row
  execute function public.touch_updated_at();

alter table public.graph_groups replica identity full;
alter publication supabase_realtime add table public.graph_groups;
