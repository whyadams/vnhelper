-- ============================================================
-- Fix 1: RLS auth.uid() initplan
--   Wrap bare `auth.uid()` in `(select auth.uid())` so Postgres
--   evaluates it ONCE per query instead of once per row.
--   See https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--   USING / WITH CHECK logic is copied verbatim from the existing
--   policies (read from pg_policies) — only the wrapper changes.
--
-- Fix 4: Storage workspace gating
--   `script-covers` and `workspace-avatars` previously gated
--   INSERT/UPDATE/DELETE only by `owner = auth.uid()`. Any
--   authenticated user could upload into any workspace's prefix
--   because the path's leading workspace_id was never validated.
--   Add `script_role_in((storage.foldername(name))[1]::uuid)`
--   check (mirrors what `character-avatars` already does).
--   `character-avatars` already has the workspace gate — skipped.
-- ============================================================

-- ------------------------------------------------------------
-- Fix 1: calendar_notification_log
-- ------------------------------------------------------------
drop policy if exists "calendar_notification_log self delete" on public.calendar_notification_log;
create policy "calendar_notification_log self delete" on public.calendar_notification_log
  for delete
  using (user_id = (select auth.uid()));

drop policy if exists "calendar_notification_log self insert" on public.calendar_notification_log;
create policy "calendar_notification_log self insert" on public.calendar_notification_log
  for insert
  with check (user_id = (select auth.uid()));

drop policy if exists "calendar_notification_log self read" on public.calendar_notification_log;
create policy "calendar_notification_log self read" on public.calendar_notification_log
  for select
  using (user_id = (select auth.uid()));

-- ------------------------------------------------------------
-- Fix 1: card_comments
-- ------------------------------------------------------------
drop policy if exists "card_comments author or owner delete" on public.card_comments;
create policy "card_comments author or owner delete" on public.card_comments
  for delete to authenticated
  using (
    (author_id = (select auth.uid()))
    or (exists (
      select 1
      from workspaces w
        join boards b on b.workspace_id = w.id
        join cards  c on c.board_id    = b.id
      where c.id = card_comments.card_id
        and w.owner_id = (select auth.uid())
    ))
  );

drop policy if exists "card_comments author update" on public.card_comments;
create policy "card_comments author update" on public.card_comments
  for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));

drop policy if exists "card_comments editors insert" on public.card_comments;
create policy "card_comments editors insert" on public.card_comments
  for insert to authenticated
  with check (
    (author_id = (select auth.uid()))
    and private.can_edit_workspace(private.card_workspace_id(card_id))
  );

-- ------------------------------------------------------------
-- Fix 1: notifications
-- ------------------------------------------------------------
drop policy if exists "notifications delete own" on public.notifications;
create policy "notifications delete own" on public.notifications
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "notifications read own" on public.notifications;
create policy "notifications read own" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "notifications update own" on public.notifications;
create policy "notifications update own" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ------------------------------------------------------------
-- Fix 1: profiles
-- ------------------------------------------------------------
drop policy if exists "profiles read self and shared" on public.profiles;
create policy "profiles read self and shared" on public.profiles
  for select to authenticated
  using (
    (id = (select auth.uid()))
    or private.shares_workspace_with(id)
  );

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ------------------------------------------------------------
-- Fix 1: subscriptions
-- ------------------------------------------------------------
drop policy if exists "subscriptions self read" on public.subscriptions;
create policy "subscriptions self read" on public.subscriptions
  for select
  using ((select auth.uid()) = user_id);

-- ------------------------------------------------------------
-- Fix 1: translation_files
--   Only _select and _update have bare auth.uid() (inside the
--   translator branch). _insert and _delete only call
--   translation_role_in(), so they don't need wrapping here.
-- ------------------------------------------------------------
drop policy if exists translation_files_select on public.translation_files;
create policy translation_files_select on public.translation_files
  for select
  using (exists (
    select 1
    from translation_projects p
    where p.id = translation_files.project_id
      and (
        (translation_role_in(p.workspace_id) = any (array['owner','editor','viewer']))
        or (
          translation_role_in(p.workspace_id) = 'translator'
          and translation_files.target_language = (
            select wm.target_language
            from workspace_members wm
            where wm.workspace_id = p.workspace_id
              and wm.user_id = (select auth.uid())
            limit 1
          )
        )
      )
  ));

drop policy if exists translation_files_update on public.translation_files;
create policy translation_files_update on public.translation_files
  for update
  using (exists (
    select 1
    from translation_projects p
    where p.id = translation_files.project_id
      and translation_role_in(p.workspace_id) = any (array['owner','editor'])
  ))
  with check (exists (
    select 1
    from translation_projects p
    where p.id = translation_files.project_id
      and translation_role_in(p.workspace_id) = any (array['owner','editor'])
  ));

-- ------------------------------------------------------------
-- Fix 1: translation_strings
--   Same pattern: _select and _update wrap; _insert/_delete are
--   untouched (no bare auth.uid()).
-- ------------------------------------------------------------
drop policy if exists translation_strings_select on public.translation_strings;
create policy translation_strings_select on public.translation_strings
  for select
  using (exists (
    select 1
    from translation_files f
      join translation_projects p on p.id = f.project_id
    where f.id = translation_strings.file_id
      and (
        (translation_role_in(p.workspace_id) = any (array['owner','editor','viewer']))
        or (
          translation_role_in(p.workspace_id) = 'translator'
          and f.target_language = (
            select wm.target_language
            from workspace_members wm
            where wm.workspace_id = p.workspace_id
              and wm.user_id = (select auth.uid())
            limit 1
          )
        )
      )
  ));

drop policy if exists translation_strings_update on public.translation_strings;
create policy translation_strings_update on public.translation_strings
  for update
  using (exists (
    select 1
    from translation_files f
      join translation_projects p on p.id = f.project_id
    where f.id = translation_strings.file_id
      and (
        (translation_role_in(p.workspace_id) = any (array['owner','editor']))
        or (
          translation_role_in(p.workspace_id) = 'translator'
          and f.target_language = (
            select wm.target_language
            from workspace_members wm
            where wm.workspace_id = p.workspace_id
              and wm.user_id = (select auth.uid())
            limit 1
          )
        )
      )
  ))
  with check (exists (
    select 1
    from translation_files f
      join translation_projects p on p.id = f.project_id
    where f.id = translation_strings.file_id
      and (
        (translation_role_in(p.workspace_id) = any (array['owner','editor']))
        or (
          translation_role_in(p.workspace_id) = 'translator'
          and f.target_language = (
            select wm.target_language
            from workspace_members wm
            where wm.workspace_id = p.workspace_id
              and wm.user_id = (select auth.uid())
            limit 1
          )
        )
      )
  ));

-- ------------------------------------------------------------
-- Fix 1: workspace_invitations
--   Note: `auth.jwt()` in the SELECT policy is left as-is per the
--   fix scope ("bare auth.uid() only"). Wrapping it can be done
--   in a follow-up if the initplan advisor still flags it.
-- ------------------------------------------------------------
drop policy if exists "invitations read" on public.workspace_invitations;
create policy "invitations read" on public.workspace_invitations
  for select to authenticated
  using (
    (invited_user_id = (select auth.uid()))
    or (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    or (exists (
      select 1
      from workspaces w
      where w.id = workspace_invitations.workspace_id
        and w.owner_id = (select auth.uid())
    ))
  );

drop policy if exists workspace_invitations_owner_update on public.workspace_invitations;
create policy workspace_invitations_owner_update on public.workspace_invitations
  for update to authenticated
  using (exists (
    select 1
    from workspaces w
    where w.id = workspace_invitations.workspace_id
      and w.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1
    from workspaces w
    where w.id = workspace_invitations.workspace_id
      and w.owner_id = (select auth.uid())
  ));

-- ------------------------------------------------------------
-- Fix 1: workspace_members
--   `members read` uses private.is_workspace_member only — no
--   bare auth.uid(), skipped.
-- ------------------------------------------------------------
drop policy if exists "workspace_members owner insert" on public.workspace_members;
create policy "workspace_members owner insert" on public.workspace_members
  for insert to authenticated
  with check (exists (
    select 1
    from workspaces w
    where w.id = workspace_members.workspace_id
      and w.owner_id = (select auth.uid())
  ));

drop policy if exists "workspace_members owner or self delete" on public.workspace_members;
create policy "workspace_members owner or self delete" on public.workspace_members
  for delete to authenticated
  using (
    (user_id = (select auth.uid()))
    or (exists (
      select 1
      from workspaces w
      where w.id = workspace_members.workspace_id
        and w.owner_id = (select auth.uid())
    ))
  );

drop policy if exists "workspace_members owner update" on public.workspace_members;
create policy "workspace_members owner update" on public.workspace_members
  for update to authenticated
  using (exists (
    select 1
    from workspaces w
    where w.id = workspace_members.workspace_id
      and w.owner_id = (select auth.uid())
  ));

-- ------------------------------------------------------------
-- Fix 1: workspaces
--   `members read` uses private.is_workspace_member — skipped.
--   Duplicate-permissive cleanup is out of scope for this PR.
-- ------------------------------------------------------------
drop policy if exists "workspaces auth create" on public.workspaces;
create policy "workspaces auth create" on public.workspaces
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "workspaces owner delete" on public.workspaces;
create policy "workspaces owner delete" on public.workspaces
  for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "workspaces owner update" on public.workspaces;
create policy "workspaces owner update" on public.workspaces
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists workspaces_delete_owner on public.workspaces;
create policy workspaces_delete_owner on public.workspaces
  for delete to authenticated
  using (exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = workspaces.id
      and wm.user_id = (select auth.uid())
      and wm.role = 'owner'::workspace_role
  ));

drop policy if exists workspaces_update_owner on public.workspaces;
create policy workspaces_update_owner on public.workspaces
  for update to authenticated
  using (exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = workspaces.id
      and wm.user_id = (select auth.uid())
      and wm.role = any (array['owner'::workspace_role, 'editor'::workspace_role])
  ))
  with check (exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = workspaces.id
      and wm.user_id = (select auth.uid())
      and wm.role = any (array['owner'::workspace_role, 'editor'::workspace_role])
  ));

-- ============================================================
-- Fix 4: Storage workspace gating
--   Path conventions:
--     - script-covers:     ${workspace_id}/${project_id}/cover-...
--     - workspace-avatars: ${workspace_id}/avatar-...
--   So (storage.foldername(name))[1] is the workspace UUID.
--   character-avatars already gates this way (see migration that
--   created it) — left untouched here.
--
--   Existing `owner = auth.uid()` check is preserved (defense in
--   depth: even a workspace editor can't delete an asset they
--   didn't upload), and wrapped with (select ...) per Fix 1.
-- ============================================================

drop policy if exists script_covers_insert on storage.objects;
create policy script_covers_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'script-covers'
    and script_role_in(((storage.foldername(name))[1])::uuid)
        in ('owner','editor')
  );

drop policy if exists script_covers_update on storage.objects;
create policy script_covers_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'script-covers'
    and owner = (select auth.uid())
    and script_role_in(((storage.foldername(name))[1])::uuid)
        in ('owner','editor')
  )
  with check (
    bucket_id = 'script-covers'
    and owner = (select auth.uid())
    and script_role_in(((storage.foldername(name))[1])::uuid)
        in ('owner','editor')
  );

drop policy if exists script_covers_delete on storage.objects;
create policy script_covers_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'script-covers'
    and owner = (select auth.uid())
    and script_role_in(((storage.foldername(name))[1])::uuid)
        in ('owner','editor')
  );

drop policy if exists workspace_avatars_insert on storage.objects;
create policy workspace_avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'workspace-avatars'
    and script_role_in(((storage.foldername(name))[1])::uuid)
        in ('owner','editor')
  );

drop policy if exists workspace_avatars_update on storage.objects;
create policy workspace_avatars_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'workspace-avatars'
    and owner = (select auth.uid())
    and script_role_in(((storage.foldername(name))[1])::uuid)
        in ('owner','editor')
  )
  with check (
    bucket_id = 'workspace-avatars'
    and owner = (select auth.uid())
    and script_role_in(((storage.foldername(name))[1])::uuid)
        in ('owner','editor')
  );

drop policy if exists workspace_avatars_delete on storage.objects;
create policy workspace_avatars_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'workspace-avatars'
    and owner = (select auth.uid())
    and script_role_in(((storage.foldername(name))[1])::uuid)
        in ('owner','editor')
  );
