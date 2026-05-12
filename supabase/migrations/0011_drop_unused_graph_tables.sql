-- Drop the legacy Graph storage. The new story-flow view is derived purely
-- from script_nodes + rpy_blocks (via collectOutboundRefs in code), so none
-- of these tables hold canonical data anymore.
--
-- Layered cleanup, in order:
--   - graph_boards : Excalidraw + xyflow-board snapshots (1 row per project)
--   - graph_edges  : edges from the original xyflow story-flow editor
--   - graph_nodes  : nodes from the original xyflow story-flow editor
--
-- The triplet was unused for ~2 weeks before this migration and the
-- application no longer references the underlying types. Drop with CASCADE
-- so any forgotten policies / triggers go with them.

DROP TABLE IF EXISTS public.graph_boards CASCADE;
DROP TABLE IF EXISTS public.graph_edges CASCADE;
DROP TABLE IF EXISTS public.graph_nodes CASCADE;
