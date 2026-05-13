-- Free-tier cap: at most 2 translation projects per workspace. Mirrors the
-- script_projects guard but with a different threshold.

create or replace function private.guard_translation_project_insert()
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
    select count(*) into cnt from public.translation_projects
      where workspace_id = new.workspace_id;
    if cnt >= 2 then
      raise exception 'free-tier workspace may host at most 2 translation projects'
        using errcode = 'P0001', hint = 'upgrade';
    end if;
  end if;
  return new;
end;
$$;

create trigger translation_projects_quota_guard
  before insert on public.translation_projects
  for each row execute function private.guard_translation_project_insert();
