-- Tracks which calendar events have already triggered a desktop notification
-- for a given user. Dedup is per (user, event, kind) so day-of and
-- minutes-before notifications can both fire for the same event.

create table public.calendar_notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  /** 'day_start' for all-day events, 'minutes_before' for timed. */
  kind text not null check (kind in ('day_start', 'minutes_before')),
  fired_at timestamptz not null default now(),
  unique (user_id, event_id, kind)
);

create index calendar_notification_log_user_idx
  on public.calendar_notification_log(user_id, event_id);

alter table public.calendar_notification_log enable row level security;

create policy "calendar_notification_log self read"
  on public.calendar_notification_log
  for select
  using (user_id = auth.uid());

create policy "calendar_notification_log self insert"
  on public.calendar_notification_log
  for insert
  with check (user_id = auth.uid());

create policy "calendar_notification_log self delete"
  on public.calendar_notification_log
  for delete
  using (user_id = auth.uid());
