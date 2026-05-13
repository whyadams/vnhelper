-- DB-level quota enforcement. Layered with the existing RLS policies; these
-- triggers raise when a free-tier user exceeds their allowance. The client
-- preempts this in the happy path with a paywall modal — the trigger is the
-- backstop for direct-API bypass.

create or replace function private.guard_workspace_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cnt int;
begin
  if private.user_tier(new.owner_id) = 'free' then
    select count(*) into cnt from public.workspaces where owner_id = new.owner_id;
    if cnt >= 1 then
      raise exception 'free-tier user may own only 1 workspace'
        using errcode = 'P0001', hint = 'upgrade';
    end if;
  end if;
  return new;
end;
$$;

create trigger workspaces_quota_guard
  before insert on public.workspaces
  for each row execute function private.guard_workspace_insert();

create or replace function private.guard_script_project_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_uid uuid;
  cnt int;
begin
  select owner_id into owner_uid from public.workspaces where id = new.workspace_id;
  if owner_uid is null then return new; end if;
  if private.user_tier(owner_uid) = 'free' then
    select count(*) into cnt from public.script_projects
      where workspace_id = new.workspace_id;
    if cnt >= 1 then
      raise exception 'free-tier workspace may host only 1 script project'
        using errcode = 'P0001', hint = 'upgrade';
    end if;
  end if;
  return new;
end;
$$;

create trigger script_projects_quota_guard
  before insert on public.script_projects
  for each row execute function private.guard_script_project_insert();

create or replace function private.guard_workspace_invitation_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_uid uuid;
begin
  select owner_id into owner_uid from public.workspaces where id = new.workspace_id;
  if owner_uid is null then return new; end if;
  if private.user_tier(owner_uid) = 'free' then
    raise exception 'free-tier workspace may not invite collaborators'
      using errcode = 'P0001', hint = 'upgrade';
  end if;
  return new;
end;
$$;

create trigger workspace_invitations_quota_guard
  before insert on public.workspace_invitations
  for each row execute function private.guard_workspace_invitation_insert();
