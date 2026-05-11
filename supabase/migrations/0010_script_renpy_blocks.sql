-- ============================================================
-- Renpy-tab support for the Script feature.
--
-- Adds a structured Ren'Py block array per scene, a project-unique
-- Ren'Py label (used by Graph for edge resolution), and an origin
-- marker for nodes that came in via .rpy import. Also adds the
-- Ren'Py variable name to characters so Cast → say-block linkage
-- can be exact.
--
-- Existing data in `content` (Doc tab, TipTap doc) is untouched.
-- All new columns default to safe values, so existing rows stay
-- valid without backfill.
-- ============================================================

-- script_nodes ---------------------------------------------------
alter table script_nodes
  add column if not exists rpy_blocks  jsonb,
  add column if not exists rpy_label   text,
  add column if not exists source_kind text not null default 'vnhelper';

-- A scene's rpy_label is what jump/call statements reference, so it
-- must be unique per project. Partial index avoids forcing a label
-- on chapters / parts / unfilled scenes.
create unique index if not exists script_nodes_project_label_uniq
  on script_nodes (project_id, rpy_label)
  where rpy_label is not null;

-- script_characters ---------------------------------------------
alter table script_characters
  add column if not exists rpy_var text;

-- A character's rpy_var must be unique within a project — same
-- constraint Ren'Py applies at compile time.
create unique index if not exists script_characters_project_rpy_var_uniq
  on script_characters (project_id, rpy_var)
  where rpy_var is not null;
