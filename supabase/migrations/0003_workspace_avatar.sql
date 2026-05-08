-- 1) Avatar column on workspaces
alter table workspaces
  add column if not exists avatar_url text null;

-- 2) Public storage bucket for workspace avatars
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'workspace-avatars',
  'workspace-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 3) RLS for storage.objects on this bucket
drop policy if exists workspace_avatars_select on storage.objects;
create policy workspace_avatars_select on storage.objects
  for select
  using (bucket_id = 'workspace-avatars');

drop policy if exists workspace_avatars_insert on storage.objects;
create policy workspace_avatars_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'workspace-avatars');

drop policy if exists workspace_avatars_update on storage.objects;
create policy workspace_avatars_update on storage.objects
  for update to authenticated
  using (bucket_id = 'workspace-avatars' and owner = auth.uid())
  with check (bucket_id = 'workspace-avatars' and owner = auth.uid());

drop policy if exists workspace_avatars_delete on storage.objects;
create policy workspace_avatars_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'workspace-avatars' and owner = auth.uid());

-- 4) Allow workspace owners/editors to update name + avatar_url
drop policy if exists workspaces_update_owner on workspaces;
create policy workspaces_update_owner on workspaces
  for update to authenticated
  using (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = id
        and wm.user_id = auth.uid()
        and wm.role in ('owner', 'editor')
    )
  )
  with check (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = id
        and wm.user_id = auth.uid()
        and wm.role in ('owner', 'editor')
    )
  );

drop policy if exists workspaces_delete_owner on workspaces;
create policy workspaces_delete_owner on workspaces
  for delete to authenticated
  using (
    exists (
      select 1 from workspace_members wm
      where wm.workspace_id = id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
    )
  );
