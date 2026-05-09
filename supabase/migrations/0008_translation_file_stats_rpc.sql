-- One round-trip aggregate of total+done counts per file. The previous
-- client-side implementation issued 2*N parallel head-count queries (with
-- N being the number of files in the project) which choked on big projects
-- and blocked the editor for 10–15 seconds. SECURITY INVOKER so the
-- existing RLS on translation_strings still applies — callers only count
-- rows they can already SELECT.
drop function if exists public.translation_file_stats(uuid[]);

create or replace function public.translation_file_stats(_file_ids uuid[])
returns table (file_id uuid, total bigint, done bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    file_id,
    count(*)::bigint as total,
    count(*) filter (where status = 'done')::bigint as done
  from translation_strings
  where file_id = any(_file_ids)
  group by file_id
$$;

revoke all on function public.translation_file_stats(uuid[]) from public;
grant execute on function public.translation_file_stats(uuid[]) to authenticated;
