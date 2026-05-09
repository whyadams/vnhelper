-- Preserve Ren'Py trailing modifiers like `with dissolve`, `pause 0.5`,
-- `id "label"` etc. so import + export round-trip is lossless. Without
-- this column the parser couldn't handle dialog lines that had any
-- modifier after the closing quote and silently dropped the entire entry.
alter table translation_strings
  add column if not exists "trailing" text null;
