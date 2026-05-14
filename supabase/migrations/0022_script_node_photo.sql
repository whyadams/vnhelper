-- 0022_script_node_photo.sql
--
-- Bind a locally-stored Photo (IndexedDB-backed gallery in
-- `src/lib/photosDb.ts`) to a script node. The reference is a free-form
-- text id rather than a foreign key because photo storage lives entirely
-- in the user's browser IndexedDB — there is no Postgres table to FK to.
-- The graph simulator (`PathSimulator`) reads this column to pick up the
-- scene image and renders it as the stage backdrop while the user steps
-- through the story flow.
--
-- Nullable on purpose: most nodes will never have a photo, and the UI
-- distinguishes "no photo bound" from "photo bound but missing on this
-- device" by resolving the id against the local IndexedDB lazily.

alter table script_nodes
  add column if not exists photo_id text;
