-- 1) Column for project cover image URL
alter table script_projects
  add column if not exists cover_image_url text null;

-- 2) Public storage bucket for project covers
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'script-covers',
  'script-covers',
  true,
  5242880, -- 5MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 3) RLS for storage.objects on this bucket
drop policy if exists script_covers_select on storage.objects;
create policy script_covers_select on storage.objects
  for select
  using (bucket_id = 'script-covers');

drop policy if exists script_covers_insert on storage.objects;
create policy script_covers_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'script-covers');

drop policy if exists script_covers_update on storage.objects;
create policy script_covers_update on storage.objects
  for update to authenticated
  using (bucket_id = 'script-covers' and owner = auth.uid())
  with check (bucket_id = 'script-covers' and owner = auth.uid());

drop policy if exists script_covers_delete on storage.objects;
create policy script_covers_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'script-covers' and owner = auth.uid());
