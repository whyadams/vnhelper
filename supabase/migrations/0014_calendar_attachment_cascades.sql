-- Polymorphic FK cleanup: when the target entity is deleted, remove the
-- attachment row so calendar events don't accumulate dangling references.
-- A real FK can't be written across multiple parent tables, so we wire one
-- trigger per source table to do the same job.

create or replace function public.delete_calendar_attachments_for_entity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.calendar_event_attachments
  where entity_type = tg_argv[0]
    and entity_id = old.id;
  return old;
end;
$$;

create trigger cards_delete_calendar_attachments
  before delete on public.cards
  for each row execute function public.delete_calendar_attachments_for_entity('card');

create trigger script_nodes_delete_calendar_attachments
  before delete on public.script_nodes
  for each row execute function public.delete_calendar_attachments_for_entity('script_node');

create trigger script_characters_delete_calendar_attachments
  before delete on public.script_characters
  for each row execute function public.delete_calendar_attachments_for_entity('character');
