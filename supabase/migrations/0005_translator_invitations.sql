-- ============================================================
-- Translator invitations: per-invitation target_language and a
-- BEFORE INSERT trigger on workspace_members that propagates the
-- language at acceptance time. Avoids touching the existing
-- invite_to_workspace / accept_invitation RPCs.
-- ============================================================

-- 1) workspace_invitations.target_language ---------------------
alter table workspace_invitations
  add column if not exists target_language text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspace_invitations_target_language_chk'
  ) then
    alter table workspace_invitations
      add constraint workspace_invitations_target_language_chk
      check (
        (target_language is null or role::text = 'translator')
        and ((role::text = 'translator') = (target_language is not null))
      );
  end if;
end $$;

-- 2) Inviter (workspace owner) UPDATE policy -------------------
-- The existing schema has only a SELECT policy on workspace_invitations.
-- INSERT/DELETE flow through invite_to_workspace / accept_invitation
-- (SECURITY DEFINER), but the frontend needs to set target_language via a
-- direct UPDATE after invite_to_workspace returns. Restrict to workspace
-- owner — matches the invite_to_workspace authorization check.
drop policy if exists workspace_invitations_owner_update on workspace_invitations;
create policy workspace_invitations_owner_update on workspace_invitations
  for update to authenticated
  using (
    exists (
      select 1 from workspaces w
      where w.id = workspace_invitations.workspace_id
        and w.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from workspaces w
      where w.id = workspace_invitations.workspace_id
        and w.owner_id = auth.uid()
    )
  );

-- 3) Propagation trigger on workspace_members ------------------
-- Fires on accept_invitation's INSERT INTO workspace_members. If the new
-- row is a translator without target_language, copy it from the matching
-- invitation row. If no match, leave NULL — the CHECK constraint added in
-- 0004 will then reject the insert and surface the error.
create or replace function workspace_members_inherit_target_language()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  caller_email text;
  inv_lang text;
begin
  if new.role::text = 'translator' and new.target_language is null then
    select lower(u.email) into caller_email
      from auth.users u
     where u.id = new.user_id
     limit 1;

    if caller_email is not null then
      select target_language into inv_lang
        from workspace_invitations
       where workspace_id = new.workspace_id
         and lower(email) = caller_email
         and role::text = 'translator'
       order by created_at desc
       limit 1;

      if inv_lang is not null then
        new.target_language := inv_lang;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_workspace_members_inherit_target_language
  on workspace_members;
create trigger trg_workspace_members_inherit_target_language
  before insert on workspace_members
  for each row execute function workspace_members_inherit_target_language();
