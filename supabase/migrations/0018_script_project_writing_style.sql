-- Per-project writing style for AI-assisted authoring. JSONB so we can grow
-- the schema (add new dimensions like reading-age, target-audience, etc.)
-- without further migrations. UI / MCP read it as an opaque object and
-- validate fields client-side.

alter table public.script_projects
  add column if not exists writing_style jsonb not null default '{}'::jsonb;

comment on column public.script_projects.writing_style is
  'Per-project authoring style hints surfaced to AI/MCP. Loosely typed by the
   client: { language, tone[], pov, tense, sentence_length, vocabulary,
   do_examples[], dont_examples[], custom_rules, notes }.';
