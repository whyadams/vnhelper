-- Polymorphic attachments for calendar events.
-- An event can reference any of: kanban cards, script scene nodes, characters.
-- `entity_type` is a small enum-like text; `entity_id` is the target row's id.
-- `workspace_id` is denormalised so RLS can reuse the same helpers that
-- calendar_events already uses (private.is_workspace_member / can_edit_workspace).

create table public.calendar_event_attachments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('card', 'script_node', 'character')),
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique (event_id, entity_type, entity_id)
);

create index calendar_event_attachments_event_idx
  on public.calendar_event_attachments(event_id);
create index calendar_event_attachments_lookup_idx
  on public.calendar_event_attachments(entity_type, entity_id);
create index calendar_event_attachments_workspace_idx
  on public.calendar_event_attachments(workspace_id);

alter table public.calendar_event_attachments enable row level security;

create policy "calendar_event_attachments members read"
  on public.calendar_event_attachments
  for select
  using (private.is_workspace_member(workspace_id));

create policy "calendar_event_attachments editors insert"
  on public.calendar_event_attachments
  for insert
  with check (private.can_edit_workspace(workspace_id));

create policy "calendar_event_attachments editors update"
  on public.calendar_event_attachments
  for update
  using (private.can_edit_workspace(workspace_id))
  with check (private.can_edit_workspace(workspace_id));

create policy "calendar_event_attachments editors delete"
  on public.calendar_event_attachments
  for delete
  using (private.can_edit_workspace(workspace_id));
