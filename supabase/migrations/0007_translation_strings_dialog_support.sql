-- Support Ren'Py dialog blocks (`translate <lang> <id>:`) alongside the
-- existing strings: blocks. Dialog rows carry a translate_id and an
-- optional speaker prefix (e.g. dg, dm); both are NULL for strings: rows.
alter table translation_strings
  add column if not exists translate_id text null,
  add column if not exists speaker      text null;

create index if not exists translation_strings_file_translate_id_idx
  on translation_strings (file_id, translate_id);
