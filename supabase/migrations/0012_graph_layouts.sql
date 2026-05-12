-- ============================================================
-- Story-flow graph: persisted node positions per Ren'Py label.
--
-- The graph itself is derived purely from script_nodes + rpy_blocks
-- (see `collectOutboundRefs` in code), so the only state worth storing
-- is where the user has chosen to place each label-node on the canvas.
-- Dagre auto-layout is the fallback when a label has no saved position.
--
-- One row per (project, label). Labels are project-unique by design,
-- so the (project_id, label_name) composite makes sense as primary key.
-- workspace_id is denormalised so RLS can reuse script_role_in() without
-- joining back through script_projects on every check.
-- ============================================================

create table if not exists graph_layouts (
  project_id   uuid not null references script_projects(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  label_name   text not null,
  x            double precision not null,
  y            double precision not null,
  updated_by   uuid references profiles(id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (project_id, label_name)
);

create index if not exists graph_layouts_project_idx
  on graph_layouts (project_id);
create index if not exists graph_layouts_ws_idx
  on graph_layouts (workspace_id);

alter table graph_layouts enable row level security;

create policy graph_layouts_select on graph_layouts
  for select using (script_role_in(workspace_id) is not null);

create policy graph_layouts_insert on graph_layouts
  for insert with check (script_role_in(workspace_id) in ('owner','editor'));

create policy graph_layouts_update on graph_layouts
  for update using (script_role_in(workspace_id) in ('owner','editor'))
  with check (script_role_in(workspace_id) in ('owner','editor'));

create policy graph_layouts_delete on graph_layouts
  for delete using (script_role_in(workspace_id) in ('owner','editor'));
