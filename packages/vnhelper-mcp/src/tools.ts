import { z } from "zod";
import { getClient } from "./client.js";
import {
  resolveBoardId,
  resolveColumnId,
  resolveProjectId,
  resolveWorkspaceId,
} from "./context.js";
import {
  markdownToTiptapDoc,
  tiptapDocToMarkdown,
} from "./markdown.js";

/* ============================================================
   Tool definitions for vnhelper-mcp.
   Each tool: name, description, JSON schema (built from zod),
   and a handler that returns plain JS — wrapped to MCP later.
   ============================================================ */

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: Handler;
}

/* ---------- Ren'Py blocks (Renpy tab / Graph source of truth) ----------
 * `script_nodes.rpy_blocks` is a jsonb array of structured blocks that the
 * Renpy-tab editor and the Graph view consume. It is INDEPENDENT from the
 * Doc tab (`content`/`body`). Each block is `{ id, kind, depth, ...fields }`.
 *
 * Supported kinds & their extra fields:
 *   label    { name }                                  depth 0, jump/call target
 *   scene    { bg, transition? }
 *   show     { char, expression?, position?, transition? }
 *   hide     { char, transition? }
 *   say      { char_var, char_id|null, char_name, text, expression? }
 *   narrator { text }
 *   menu     {}                                        owns choice blocks at depth+1
 *   choice   { text, condition? }                      depth = menu.depth + 1
 *   jump     { target }
 *   call     { target }
 *   return   { expression? }
 *   with     { transition }
 *   pause    { duration? }                              seconds; omit = until click
 *   note     { text }                                   emitted as a # comment
 *   raw      { lines: string[], head }                  verbatim escape hatch
 *
 * Indentation: label = 0, most blocks = 1, choice = menu.depth+1, blocks
 * inside a choice deeper still. `id` is any stable string — when omitted on
 * a block we generate one so the agent can pass plain block objects. */
const rpyBlockSchema = z
  .object({
    id: z.string().optional(),
    kind: z.string(),
    depth: z.number().int().min(0).default(1),
  })
  .passthrough();

const RPY_BLOCKS_DESC =
  "Structured Ren'Py blocks (jsonb array) for the Renpy tab / Graph — " +
  "independent from the Doc-tab `body`. Kinds: label{name}, scene{bg," +
  "transition?}, show{char,expression?,position?,transition?}, hide{char," +
  "transition?}, say{char_var,char_id,char_name,text,expression?}, " +
  "narrator{text}, menu{}, choice{text,condition?}, jump{target}, " +
  "call{target}, return{expression?}, with{transition}, pause{duration?}, " +
  "note{text}, raw{lines[],head}. Indentation via `depth` (label=0, body=1, " +
  "choice=menu.depth+1). `id` auto-filled when omitted.";

let rpyIdSeq = 0;
/** Ensure every block carries a stable `id` so the editor's React keys and
 *  drag/drop stay consistent — the agent can omit them. */
function normalizeRpyBlocks(
  blocks: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return blocks.map((b) => ({
    ...b,
    id:
      typeof b.id === "string" && b.id.length > 0
        ? b.id
        : `mcp_${Date.now().toString(36)}_${(rpyIdSeq++).toString(36)}`,
    depth: typeof b.depth === "number" ? b.depth : 1,
  }));
}

/* ---------- Workspaces / projects ---------- */

const listWorkspaces: ToolDef = {
  name: "list_workspaces",
  description: "List workspaces the current user is a member of.",
  inputSchema: z.object({}),
  handler: async () => {
    const c = await getClient();
    const { data, error } = await c
      .from("workspaces")
      .select("id, name, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};

const listProjects: ToolDef = {
  name: "list_script_projects",
  description: "List script projects in a workspace.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({ workspace_id: z.string().uuid().optional() })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    const { data, error } = await c
      .from("script_projects")
      .select("id, title, cover_emoji, created_at")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};

const createScriptProject: ToolDef = {
  name: "create_script_project",
  description:
    "Create a new script project in a workspace. Note: the free tier is " +
    "capped at 1 script project per workspace (call `get_subscription` " +
    "first if unsure) — the DB quota guard will reject the insert otherwise.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    title: z.string().min(1),
    synopsis: z.string().optional(),
    cover_emoji: z.string().nullable().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        workspace_id: z.string().uuid().optional(),
        title: z.string().min(1),
        synopsis: z.string().optional(),
        cover_emoji: z.string().nullable().optional(),
      })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    const { data, error } = await c
      .from("script_projects")
      .insert({
        workspace_id: ws,
        title: args.title.trim(),
        synopsis: args.synopsis ?? "",
        cover_emoji: args.cover_emoji ?? null,
        position: Date.now(),
      })
      .select("id, title, cover_emoji, created_at")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const updateScriptProject: ToolDef = {
  name: "update_script_project",
  description:
    "Patch a script project's title / synopsis / cover_emoji. Only the " +
    "fields you pass are updated. To change writing style use " +
    "`update_writing_style` instead.",
  inputSchema: z.object({
    project_id: z.string().uuid(),
    title: z.string().min(1).optional(),
    synopsis: z.string().optional(),
    cover_emoji: z.string().nullable().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        project_id: z.string().uuid(),
        title: z.string().min(1).optional(),
        synopsis: z.string().optional(),
        cover_emoji: z.string().nullable().optional(),
      })
      .parse(raw);
    const c = await getClient();
    const { project_id, ...rest } = args;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) patch[k] = v;
    }
    if (Object.keys(patch).length === 0) {
      throw new Error("Nothing to update.");
    }
    const { data, error } = await c
      .from("script_projects")
      .update(patch)
      .eq("id", project_id)
      .select("id, title, synopsis, cover_emoji")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const deleteScriptProject: ToolDef = {
  name: "delete_script_project",
  description:
    "Permanently delete a script project AND all its nodes, characters and " +
    "locations (DB cascade). Irreversible — confirm with the user first.",
  inputSchema: z.object({ project_id: z.string().uuid() }),
  handler: async (raw) => {
    const args = z.object({ project_id: z.string().uuid() }).parse(raw);
    const c = await getClient();
    const { error } = await c
      .from("script_projects")
      .delete()
      .eq("id", args.project_id);
    if (error) throw new Error(error.message);
    return { deleted: args.project_id };
  },
};

/* ---------- Tasks (kanban) ---------- */

const listTasks: ToolDef = {
  name: "list_tasks",
  description:
    "List kanban cards in the workspace. Filter by column key (todo/progress/review/done) or status. Each card includes a `subtasks` summary `{ done, total }` so you can see checklist progress at a glance — use `list_task_subtasks` for the individual items.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    column: z.string().optional(),
    include_done: z.boolean().default(false),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        workspace_id: z.string().uuid().optional(),
        column: z.string().optional(),
        include_done: z.boolean().default(false),
      })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    const boardId = await resolveBoardId(c, ws);
    let q = c
      .from("cards")
      .select(
        "id, title, subtitle, description, priority, due_date, position, columns!inner(key, title)",
      )
      .eq("board_id", boardId)
      .order("position", { ascending: true });
    if (args.column) {
      const colId = await resolveColumnId(c, boardId, args.column);
      q = q.eq("column_id", colId);
    } else if (!args.include_done) {
      // exclude done column by joining and filtering — simpler: post-filter
    }
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    type Row = {
      columns: { key: string } | { key: string }[] | null;
      [k: string]: unknown;
    };
    let rows = (data ?? []) as Row[];
    if (!args.column && !args.include_done) {
      rows = rows.filter((r) => {
        const c = r.columns;
        const key = Array.isArray(c) ? c[0]?.key : c?.key;
        return key !== "done";
      });
    }

    // Attach a checklist summary per card in one extra round-trip so the
    // agent "sees" subtask progress without N follow-up calls.
    const cardIds = rows
      .map((r) => r.id)
      .filter((v): v is string => typeof v === "string");
    const summary = new Map<string, { done: number; total: number }>();
    if (cardIds.length > 0) {
      const { data: subs, error: subErr } = await c
        .from("card_subtasks")
        .select("card_id, done")
        .in("card_id", cardIds);
      if (subErr) throw new Error(subErr.message);
      for (const s of (subs ?? []) as Array<{
        card_id: string;
        done: boolean;
      }>) {
        const cur = summary.get(s.card_id) ?? { done: 0, total: 0 };
        cur.total += 1;
        if (s.done) cur.done += 1;
        summary.set(s.card_id, cur);
      }
    }

    return rows.map((r) => ({
      ...r,
      subtasks: summary.get(r.id as string) ?? { done: 0, total: 0 },
    }));
  },
};

const createTask: ToolDef = {
  name: "create_task",
  description:
    "Create a kanban card. Defaults to 'todo' column. Optional priority: low|medium|high|urgent.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    title: z.string().min(1),
    column: z.string().default("todo"),
    description: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        workspace_id: z.string().uuid().optional(),
        title: z.string().min(1),
        column: z.string().default("todo"),
        description: z.string().optional(),
        priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    const boardId = await resolveBoardId(c, ws);
    const colId = await resolveColumnId(c, boardId, args.column);

    const { data: maxRow } = await c
      .from("cards")
      .select("position")
      .eq("column_id", colId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = (maxRow?.position ?? 0) + 1024;

    const { data, error } = await c
      .from("cards")
      .insert({
        board_id: boardId,
        column_id: colId,
        title: args.title,
        subtitle: "",
        brand: "linear",
        brand_fallback: args.title.charAt(0).toUpperCase() || "•",
        description: args.description,
        priority: args.priority ?? null,
        position: nextPos,
        meta: {} as never,
      })
      .select("id, title, position")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const moveTask: ToolDef = {
  name: "move_task",
  description: "Move a card to another column (todo/progress/review/done).",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    card_id: z.string().uuid(),
    column: z.string(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        workspace_id: z.string().uuid().optional(),
        card_id: z.string().uuid(),
        column: z.string(),
      })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    const boardId = await resolveBoardId(c, ws);
    const colId = await resolveColumnId(c, boardId, args.column);
    const { data: maxRow } = await c
      .from("cards")
      .select("position")
      .eq("column_id", colId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = (maxRow?.position ?? 0) + 1024;
    const { data, error } = await c
      .from("cards")
      .update({ column_id: colId, position: nextPos })
      .eq("id", args.card_id)
      .select("id, column_id, position")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const updateTask: ToolDef = {
  name: "update_task",
  description: "Update card fields: title, description, priority.",
  inputSchema: z.object({
    card_id: z.string().uuid(),
    title: z.string().optional(),
    description: z.string().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        card_id: z.string().uuid(),
        title: z.string().optional(),
        description: z.string().optional(),
        priority: z
          .enum(["low", "medium", "high", "urgent"])
          .nullable()
          .optional(),
      })
      .parse(raw);
    const c = await getClient();
    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) patch.title = args.title;
    if (args.description !== undefined) patch.description = args.description;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (Object.keys(patch).length === 0) {
      throw new Error("Nothing to update.");
    }
    const { data, error } = await c
      .from("cards")
      .update(patch)
      .eq("id", args.card_id)
      .select("id, title, priority")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const deleteTask: ToolDef = {
  name: "delete_task",
  description: "Delete a card.",
  inputSchema: z.object({ card_id: z.string().uuid() }),
  handler: async (raw) => {
    const args = z.object({ card_id: z.string().uuid() }).parse(raw);
    const c = await getClient();
    const { error } = await c.from("cards").delete().eq("id", args.card_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  },
};

/* ---------- Card subtasks (checklist items inside a kanban card) ---------- */

const listTaskSubtasks: ToolDef = {
  name: "list_task_subtasks",
  description:
    "List the checklist subtasks of a kanban card, in display order. Each " +
    "row is { id, label, done, position }. Use this to inspect a card's " +
    "progress in detail (list_tasks already returns a {done,total} summary).",
  inputSchema: z.object({ card_id: z.string().uuid() }),
  handler: async (raw) => {
    const args = z.object({ card_id: z.string().uuid() }).parse(raw);
    const c = await getClient();
    const { data, error } = await c
      .from("card_subtasks")
      .select("id, label, done, position, created_at")
      .eq("card_id", args.card_id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};

const addTaskSubtask: ToolDef = {
  name: "add_task_subtask",
  description:
    "Add a checklist subtask to a kanban card. Appended to the end of the " +
    "list. New subtasks start unchecked unless `done` is passed.",
  inputSchema: z.object({
    card_id: z.string().uuid(),
    label: z.string().min(1),
    done: z.boolean().default(false),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        card_id: z.string().uuid(),
        label: z.string().min(1),
        done: z.boolean().default(false),
      })
      .parse(raw);
    const c = await getClient();
    const { data: maxRow } = await c
      .from("card_subtasks")
      .select("position")
      .eq("card_id", args.card_id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = (maxRow?.position ?? 0) + 1024;
    const { data, error } = await c
      .from("card_subtasks")
      .insert({
        card_id: args.card_id,
        label: args.label.trim(),
        done: args.done,
        position: nextPos,
      })
      .select("id, label, done, position")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const updateTaskSubtask: ToolDef = {
  name: "update_task_subtask",
  description:
    "Patch a subtask: toggle `done` and/or rename `label`. Only the fields " +
    "you pass are changed. Use this to tick items off as work completes.",
  inputSchema: z.object({
    subtask_id: z.string().uuid(),
    label: z.string().min(1).optional(),
    done: z.boolean().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        subtask_id: z.string().uuid(),
        label: z.string().min(1).optional(),
        done: z.boolean().optional(),
      })
      .parse(raw);
    const patch: Record<string, unknown> = {};
    if (args.label !== undefined) patch.label = args.label.trim();
    if (args.done !== undefined) patch.done = args.done;
    if (Object.keys(patch).length === 0) {
      throw new Error("Nothing to update.");
    }
    const c = await getClient();
    const { data, error } = await c
      .from("card_subtasks")
      .update(patch)
      .eq("id", args.subtask_id)
      .select("id, label, done, position")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const deleteTaskSubtask: ToolDef = {
  name: "delete_task_subtask",
  description: "Delete a single checklist subtask by its id.",
  inputSchema: z.object({ subtask_id: z.string().uuid() }),
  handler: async (raw) => {
    const args = z.object({ subtask_id: z.string().uuid() }).parse(raw);
    const c = await getClient();
    const { error } = await c
      .from("card_subtasks")
      .delete()
      .eq("id", args.subtask_id);
    if (error) throw new Error(error.message);
    return { deleted: args.subtask_id };
  },
};

/* ---------- Script nodes (chapters/scenes/blocks) ---------- */

const listScriptNodes: ToolDef = {
  name: "list_script_nodes",
  description:
    "List script nodes (chapters/scenes/blocks) in a project. Returns flat list with parent_id.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
    kind: z.enum(["chapter", "scene", "block"]).optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        workspace_id: z.string().uuid().optional(),
        project_id: z.string().uuid().optional(),
        kind: z.enum(["chapter", "scene", "block"]).optional(),
      })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    const project = await resolveProjectId(c, ws, args.project_id);
    let q = c
      .from("script_nodes")
      .select(
        "id, parent_id, kind, title, emoji, pinned, position, status, pov, tags, rpy_label, source_kind, location_id, photo_id, updated_at",
      )
      .eq("project_id", project)
      .order("position", { ascending: true });
    if (args.kind) q = q.eq("kind", args.kind);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};

const readScriptNode: ToolDef = {
  name: "read_script_node",
  description:
    "Read full content of a script node (chapter/scene/block). " +
    "Returns `body` as markdown — derived from the editor's structured " +
    "content if present, so it always reflects the latest visible state " +
    "even after the user edited the document in the UI. Also returns " +
    "`rpy_blocks` (the structured Ren'Py array powering the Renpy tab / " +
    "Graph — independent from `body`), `rpy_label`, `source_kind`, " +
    "`location_id` and `photo_id`.",
  inputSchema: z.object({ node_id: z.string().uuid() }),
  handler: async (raw) => {
    const args = z.object({ node_id: z.string().uuid() }).parse(raw);
    const c = await getClient();
    const { data, error } = await c
      .from("script_nodes")
      .select(
        "id, project_id, parent_id, kind, title, emoji, body, content, rpy_blocks, rpy_label, source_kind, status, pov, tags, location_id, photo_id, position, updated_at",
      )
      .eq("id", args.node_id)
      .single();
    if (error) throw new Error(error.message);
    // Prefer the structured content as the source of truth for AI
    // round-trips: if the user edited the doc in the UI, `content` is
    // current while `body` may be a stale markdown snapshot.
    if (data && data.content) {
      const md = tiptapDocToMarkdown(data.content);
      if (md) data.body = md;
    }
    return data;
  },
};

const createScriptNode: ToolDef = {
  name: "create_script_node",
  description:
    "Create a script node (chapter/scene/block). parent_id can be null for root. " +
    "`body` accepts markdown (#/##/### headings, **bold**, *italic*, ~~strike~~, " +
    "--- horizontal rule, > blockquote, - lists). Single newlines render as visible " +
    "line breaks (hardBreak), blank lines start a new paragraph. " +
    "For Ren'Py scenes you may also pass `rpy_blocks` (structured Renpy-tab " +
    "content, independent from `body`), plus `rpy_label`, `location_id` and " +
    "`photo_id`. " + RPY_BLOCKS_DESC + " " +
    "Tip: call `get_writing_style` first to read the project's author voice " +
    "preferences (language, tone, POV, …) before drafting content.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
    parent_id: z.string().uuid().nullable().optional(),
    kind: z.enum(["chapter", "scene", "block"]).default("scene"),
    title: z.string().min(1),
    emoji: z.string().optional(),
    body: z.string().optional(),
    rpy_label: z.string().optional(),
    rpy_blocks: z.array(rpyBlockSchema).optional(),
    location_id: z.string().uuid().nullable().optional(),
    photo_id: z.string().nullable().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        workspace_id: z.string().uuid().optional(),
        project_id: z.string().uuid().optional(),
        parent_id: z.string().uuid().nullable().optional(),
        kind: z.enum(["chapter", "scene", "block"]).default("scene"),
        title: z.string().min(1),
        emoji: z.string().optional(),
        body: z.string().optional(),
        rpy_label: z.string().optional(),
        rpy_blocks: z.array(rpyBlockSchema).optional(),
        location_id: z.string().uuid().nullable().optional(),
        photo_id: z.string().nullable().optional(),
      })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    const project = await resolveProjectId(c, ws, args.project_id);
    const parentId = args.parent_id ?? null;
    const { data: maxRow } = await c
      .from("script_nodes")
      .select("position")
      .eq("project_id", project)
      .eq("parent_id", parentId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = (maxRow?.position ?? 0) + 1024;
    const body = args.body ?? "";
    const insert: Record<string, unknown> = {
      workspace_id: ws,
      project_id: project,
      parent_id: parentId,
      kind: args.kind,
      title: args.title,
      emoji: args.emoji ?? null,
      body,
      position: nextPos,
    };
    // Always populate `content` so the editor renders rich text instead
    // of literal markdown characters. Empty body → empty doc.
    insert.content = markdownToTiptapDoc(body);
    if (args.rpy_label !== undefined) insert.rpy_label = args.rpy_label;
    if (args.rpy_blocks !== undefined) {
      insert.rpy_blocks = normalizeRpyBlocks(
        args.rpy_blocks as Array<Record<string, unknown>>,
      );
    }
    if (args.location_id !== undefined) insert.location_id = args.location_id;
    if (args.photo_id !== undefined) insert.photo_id = args.photo_id;
    const { data, error } = await c
      .from("script_nodes")
      .insert(insert)
      .select("id, parent_id, kind, title, position")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const updateScriptNode: ToolDef = {
  name: "update_script_node",
  description:
    "Update title / body / kind / emoji / status / pov of a script node. " +
    "`body` accepts markdown (#/##/### headings, **bold**, *italic*, ~~strike~~, " +
    "--- horizontal rule, > blockquote, - lists). Single newlines render as visible " +
    "line breaks (hardBreak), blank lines start a new paragraph. The structured " +
    "editor content is regenerated from the markdown automatically. " +
    "`rpy_blocks` replaces the whole Renpy-tab block array (independent from " +
    "`body`); `rpy_label` / `location_id` / `photo_id` accept null to clear. " +
    RPY_BLOCKS_DESC,
  inputSchema: z.object({
    node_id: z.string().uuid(),
    title: z.string().optional(),
    body: z.string().optional(),
    kind: z.enum(["chapter", "scene", "block"]).optional(),
    emoji: z.string().nullable().optional(),
    status: z.string().optional(),
    pov: z.string().nullable().optional(),
    rpy_label: z.string().nullable().optional(),
    rpy_blocks: z.array(rpyBlockSchema).optional(),
    location_id: z.string().uuid().nullable().optional(),
    photo_id: z.string().nullable().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        node_id: z.string().uuid(),
        title: z.string().optional(),
        body: z.string().optional(),
        kind: z.enum(["chapter", "scene", "block"]).optional(),
        emoji: z.string().nullable().optional(),
        status: z.string().optional(),
        pov: z.string().nullable().optional(),
        rpy_label: z.string().nullable().optional(),
        rpy_blocks: z.array(rpyBlockSchema).optional(),
        location_id: z.string().uuid().nullable().optional(),
        photo_id: z.string().nullable().optional(),
      })
      .parse(raw);
    const c = await getClient();
    const patch: Record<string, unknown> = {};
    for (const k of ["title", "body", "kind", "emoji", "status", "pov"] as const) {
      if (args[k] !== undefined) patch[k] = args[k];
    }
    if (args.rpy_label !== undefined) patch.rpy_label = args.rpy_label;
    if (args.location_id !== undefined) patch.location_id = args.location_id;
    if (args.photo_id !== undefined) patch.photo_id = args.photo_id;
    if (args.rpy_blocks !== undefined) {
      patch.rpy_blocks = normalizeRpyBlocks(
        args.rpy_blocks as Array<Record<string, unknown>>,
      );
    }
    if (Object.keys(patch).length === 0) {
      throw new Error("Nothing to update.");
    }
    // When body changes, regenerate the structured `content` so the editor
    // renders the new markdown as rich text. Without this, the editor reads
    // `content` and ignores `body`, so markdown characters like ## / ** / ---
    // would appear as literal text.
    if (args.body !== undefined) {
      patch.content = markdownToTiptapDoc(args.body);
    }
    const { data, error } = await c
      .from("script_nodes")
      .update(patch)
      .eq("id", args.node_id)
      .select("id, title, kind, status")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const appendToScene: ToolDef = {
  name: "append_to_scene",
  description:
    "Append markdown content to a scene's body. Useful for AI drafting " +
    "line-by-line. The appended text supports the same markdown as " +
    "update_script_node (#/##/### headings, **bold**, *italic*, ~~strike~~, " +
    "--- horizontal rule, > blockquote, - lists). The structured editor " +
    "content is regenerated from the merged markdown automatically. If the " +
    "scene was edited in the UI since the last write, the current editor " +
    "state is preserved by serializing it back to markdown before appending. " +
    "Tip: call `get_writing_style` first so the appended lines match the " +
    "project's tone, POV, vocabulary, etc.",
  inputSchema: z.object({
    node_id: z.string().uuid(),
    text: z.string().min(1),
    separator: z.string().default("\n\n"),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        node_id: z.string().uuid(),
        text: z.string().min(1),
        separator: z.string().default("\n\n"),
      })
      .parse(raw);
    const c = await getClient();
    const { data: cur, error: gErr } = await c
      .from("script_nodes")
      .select("body, content")
      .eq("id", args.node_id)
      .single();
    if (gErr) throw new Error(gErr.message);
    // Source of truth: prefer the editor's structured content (it's always
    // current after manual UI edits). Fall back to body markdown.
    let baseMd = "";
    if (cur?.content) {
      baseMd = tiptapDocToMarkdown(cur.content) || (cur?.body ?? "");
    } else {
      baseMd = cur?.body ?? "";
    }
    const next = baseMd + (baseMd ? args.separator : "") + args.text;
    const { error } = await c
      .from("script_nodes")
      .update({
        body: next,
        content: markdownToTiptapDoc(next),
      })
      .eq("id", args.node_id);
    if (error) throw new Error(error.message);
    return { ok: true, length: next.length };
  },
};

const deleteScriptNode: ToolDef = {
  name: "delete_script_node",
  description: "Delete a script node and its descendants.",
  inputSchema: z.object({ node_id: z.string().uuid() }),
  handler: async (raw) => {
    const args = z.object({ node_id: z.string().uuid() }).parse(raw);
    const c = await getClient();
    const { error } = await c
      .from("script_nodes")
      .delete()
      .eq("id", args.node_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  },
};

/* ---------- Characters & locations ---------- */

const listCharacters: ToolDef = {
  name: "list_characters",
  description: "List characters defined in a script project.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        workspace_id: z.string().uuid().optional(),
        project_id: z.string().uuid().optional(),
      })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    const project = await resolveProjectId(c, ws, args.project_id);
    const { data, error } = await c
      .from("script_characters")
      .select(
        "id, name, short_name, color, emoji, pronouns, age, role, voice_notes, traits, aliases, rpy_var",
      )
      .eq("project_id", project)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};

/* ---------- Subscription / tier ----------
 * Lets Claude check the user's plan + remaining trial before attempting
 * actions that the DB-side quota triggers might reject. Returns the same
 * shape the frontend `useSubscription()` hook exposes, so prompts that
 * reference "free plan limits" stay consistent across UI and agent.
 *
 * Keep `TIER_LIMITS` in sync with `src/state/subscription.tsx#LIMITS`.
 */

type Tier = "free" | "pro";

/** Mirrors the LIMITS map in src/state/subscription.tsx. The frontend is the
 *  source of truth for the *display* of limits, but Claude needs to see them
 *  here without an extra round-trip. If you change one, change both. */
const TIER_LIMITS: Record<Tier, Record<string, number | boolean>> = {
  free: {
    max_workspaces: 1,
    max_script_projects_per_workspace: 1,
    max_translation_projects_per_workspace: 2,
    can_invite_collaborators: false,
    can_use_graph: false,
    can_export_rpy: false,
  },
  pro: {
    max_workspaces: Number.POSITIVE_INFINITY,
    max_script_projects_per_workspace: Number.POSITIVE_INFINITY,
    max_translation_projects_per_workspace: Number.POSITIVE_INFINITY,
    can_invite_collaborators: true,
    can_use_graph: true,
    can_export_rpy: true,
  },
};

const getSubscription: ToolDef = {
  name: "get_subscription",
  description:
    "Inspect the signed-in user's subscription state — tier (`free` | `pro`), raw status (`trialing` | `active` | `expired` | …), trial countdown, and the resolved limit map (max workspaces / script projects / translations, plus capability booleans). Call this BEFORE attempting actions that may be quota-blocked so you can warn the user up front and offer the right upgrade hint instead of surfacing a raw DB error.",
  inputSchema: z.object({}),
  handler: async () => {
    const c = await getClient();
    const { data, error } = await c
      .from("my_subscription")
      .select(
        "effective_tier, status, trial_ends_at, current_period_end, raw_tier",
      )
      .maybeSingle();
    if (error) throw new Error(error.message);
    // No row → treat as free. The frontend uses the same fallback to avoid
    // accidental unlock on a transient fetch failure.
    if (!data) {
      return {
        tier: "free" as Tier,
        raw_tier: null,
        status: "expired",
        trial_ends_at: null,
        current_period_end: null,
        is_trial: false,
        trial_days_left: null,
        limits: TIER_LIMITS.free,
      };
    }

    const tier: Tier = data.effective_tier === "pro" ? "pro" : "free";
    const trialEndsAt = data.trial_ends_at ? new Date(data.trial_ends_at) : null;
    const isTrial =
      data.status === "trialing" &&
      tier === "pro" &&
      trialEndsAt !== null &&
      trialEndsAt.getTime() > Date.now();
    const trialDaysLeft =
      isTrial && trialEndsAt
        ? Math.max(
            0,
            Math.ceil(
              (trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
            ),
          )
        : null;

    return {
      tier,
      raw_tier: data.raw_tier ?? null,
      status: data.status ?? "expired",
      trial_ends_at: data.trial_ends_at ?? null,
      current_period_end: data.current_period_end ?? null,
      is_trial: isTrial,
      trial_days_left: trialDaysLeft,
      limits: TIER_LIMITS[tier],
    };
  },
};

const getWritingStyle: ToolDef = {
  name: "get_writing_style",
  description:
    "Read the per-project writing style hints (language, tone, POV, tense, sentence length, vocabulary, do/don't examples, custom rules). Call this BEFORE drafting new scene content with create_script_node / append_to_scene so the output matches the author's voice. Returns an empty object when the author hasn't configured anything — in that case, default to a neutral style.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        workspace_id: z.string().uuid().optional(),
        project_id: z.string().uuid().optional(),
      })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    const project = await resolveProjectId(c, ws, args.project_id);
    const { data, error } = await c
      .from("script_projects")
      .select("id, title, writing_style")
      .eq("id", project)
      .single();
    if (error) throw new Error(error.message);
    return {
      project_id: data.id,
      project_title: data.title,
      writing_style: data.writing_style ?? {},
    };
  },
};

/** Schema shared by `update_writing_style` — keep this in sync with the
 *  TypeScript `WritingStyle` shape in the frontend. */
const writingStylePatchSchema = z.object({
  language: z.string().nullish(),
  tone: z.array(z.string()).nullish(),
  pov: z.enum(["first", "second", "third", "mixed"]).nullish(),
  tense: z.enum(["past", "present", "mixed"]).nullish(),
  sentence_length: z.enum(["short", "varied", "long"]).nullish(),
  vocabulary: z.enum(["simple", "moderate", "rich"]).nullish(),
  do_examples: z.array(z.string()).nullish(),
  dont_examples: z.array(z.string()).nullish(),
  custom_rules: z.string().nullish(),
  notes: z.string().nullish(),
});

const updateWritingStyle: ToolDef = {
  name: "update_writing_style",
  description:
    "Patch the per-project writing style. Use this to capture an author's request like 'make the style darker and more concise' — call `get_writing_style` first to see the current state, then apply your changes. Only the fields you pass are touched (merge semantics); pass `null` for a field to clear it. When `mode='replace'` the existing object is discarded and only your patch fields remain.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
    /** "merge" (default) — keys present in the patch overwrite, others are
     *  kept. "replace" — the new object equals exactly the patch. */
    mode: z.enum(["merge", "replace"]).default("merge"),
    patch: writingStylePatchSchema,
  }),
  handler: async (raw) => {
    const args = z
      .object({
        workspace_id: z.string().uuid().optional(),
        project_id: z.string().uuid().optional(),
        mode: z.enum(["merge", "replace"]).default("merge"),
        patch: writingStylePatchSchema,
      })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    const project = await resolveProjectId(c, ws, args.project_id);

    // Drop `null` entries from the incoming patch — they signal "clear this
    // field". After merging we strip undefined/null/empty so the stored
    // JSONB stays tight (matters because the agent later reads it back).
    const cleanedPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args.patch)) {
      // `undefined` means "don't touch"; `null` means "clear" (handled below
      // by simply omitting from the merge target).
      if (v === undefined) continue;
      if (v === null) {
        cleanedPatch[k] = null;
        continue;
      }
      cleanedPatch[k] = v;
    }

    let next: Record<string, unknown>;
    if (args.mode === "replace") {
      next = {};
      for (const [k, v] of Object.entries(cleanedPatch)) {
        if (v !== null) next[k] = v;
      }
    } else {
      // Merge: fetch current, layer patch on top.
      const { data, error } = await c
        .from("script_projects")
        .select("writing_style")
        .eq("id", project)
        .single();
      if (error) throw new Error(error.message);
      const current = (data?.writing_style ?? {}) as Record<string, unknown>;
      next = { ...current };
      for (const [k, v] of Object.entries(cleanedPatch)) {
        if (v === null) {
          delete next[k];
        } else {
          next[k] = v;
        }
      }
    }

    const { data: saved, error: saveErr } = await c
      .from("script_projects")
      .update({ writing_style: next as never })
      .eq("id", project)
      .select("id, writing_style")
      .single();
    if (saveErr) throw new Error(saveErr.message);
    return {
      project_id: saved.id,
      writing_style: saved.writing_style ?? {},
    };
  },
};

const createCharacter: ToolDef = {
  name: "create_character",
  description:
    "Create a character in the project. `rpy_var` is the Ren'Py variable " +
    "name (e.g. `mc`, `eileen`) used by say-blocks for exact Cast linkage — " +
    "must be unique within the project when set.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
    name: z.string().min(1),
    short_name: z.string().optional(),
    color: z.string().default("#828c99"),
    emoji: z.string().optional(),
    pronouns: z.string().optional(),
    role: z.string().optional(),
    rpy_var: z.string().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        workspace_id: z.string().uuid().optional(),
        project_id: z.string().uuid().optional(),
        name: z.string().min(1),
        short_name: z.string().optional(),
        color: z.string().default("#828c99"),
        emoji: z.string().optional(),
        pronouns: z.string().optional(),
        role: z.string().optional(),
        rpy_var: z.string().optional(),
      })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    const project = await resolveProjectId(c, ws, args.project_id);
    const { data, error } = await c
      .from("script_characters")
      .insert({
        project_id: project,
        workspace_id: ws,
        name: args.name,
        short_name: args.short_name ?? null,
        color: args.color,
        emoji: args.emoji ?? null,
        pronouns: args.pronouns ?? null,
        role: args.role ?? null,
        rpy_var: args.rpy_var ?? null,
        voice_notes: "",
        traits: {} as never,
        aliases: [],
      })
      .select("id, name, rpy_var")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

/* ---------- Character symmetry (update / delete) ---------- */

const updateCharacter: ToolDef = {
  name: "update_character",
  description:
    "Patch a character. Only the fields you pass are updated; others are left alone.",
  inputSchema: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).optional(),
    short_name: z.string().nullable().optional(),
    color: z.string().optional(),
    emoji: z.string().nullable().optional(),
    pronouns: z.string().nullable().optional(),
    age: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    voice_notes: z.string().optional(),
    rpy_var: z.string().nullable().optional(),
    aliases: z.array(z.string()).optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        short_name: z.string().nullable().optional(),
        color: z.string().optional(),
        emoji: z.string().nullable().optional(),
        pronouns: z.string().nullable().optional(),
        age: z.string().nullable().optional(),
        role: z.string().nullable().optional(),
        voice_notes: z.string().optional(),
        rpy_var: z.string().nullable().optional(),
        aliases: z.array(z.string()).optional(),
      })
      .parse(raw);
    const c = await getClient();
    const { id, ...patch } = args;
    // Strip undefined so we don't overwrite columns with NULL by accident
    // when the caller omits a field.
    const cleanPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) cleanPatch[k] = v;
    }
    const { data, error } = await c
      .from("script_characters")
      .update(cleanPatch)
      .eq("id", id)
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const deleteCharacter: ToolDef = {
  name: "delete_character",
  description:
    "Permanently delete a character (cascades to nothing — only the row itself is removed; references in script bodies stay textual).",
  inputSchema: z.object({ id: z.string().uuid() }),
  handler: async (raw) => {
    const args = z.object({ id: z.string().uuid() }).parse(raw);
    const c = await getClient();
    const { error } = await c
      .from("script_characters")
      .delete()
      .eq("id", args.id);
    if (error) throw new Error(error.message);
    return { deleted: args.id };
  },
};

/* ---------- Script locations ----------------------------------------------
 * Locations describe the physical (or imaginary) places a scene happens in —
 * "Bar at midnight", "Eileen's flat", "Cosmodrome control room". Each scene
 * can be linked to one location via `script_nodes.location_id`; the editor
 * surfaces the mood and description as worldbuilding hints. CRUD mirrors the
 * `script_characters` tools above.
 */

const listLocations: ToolDef = {
  name: "list_locations",
  description: "List locations in a project — places used as scene settings.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        workspace_id: z.string().uuid().optional(),
        project_id: z.string().uuid().optional(),
      })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    const project = await resolveProjectId(c, ws, args.project_id);
    const { data, error } = await c
      .from("script_locations")
      .select("id, name, description, mood, image_url, position")
      .eq("project_id", project)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};

const createLocation: ToolDef = {
  name: "create_location",
  description:
    "Create a location (place / setting) inside a script project. Use for worldbuilding entries the user can later attach to scenes via the UI or update_script_node.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    mood: z.string().optional(),
    image_url: z.string().url().nullable().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        workspace_id: z.string().uuid().optional(),
        project_id: z.string().uuid().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        mood: z.string().optional(),
        image_url: z.string().url().nullable().optional(),
      })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    const project = await resolveProjectId(c, ws, args.project_id);
    const { data, error } = await c
      .from("script_locations")
      .insert({
        project_id: project,
        workspace_id: ws,
        name: args.name,
        description: args.description ?? "",
        mood: args.mood ?? null,
        image_url: args.image_url ?? null,
      })
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const updateLocation: ToolDef = {
  name: "update_location",
  description:
    "Patch a location. Only the fields you pass are updated; others are left alone. Useful for refining descriptions or mood notes as the story evolves.",
  inputSchema: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    mood: z.string().nullable().optional(),
    image_url: z.string().url().nullable().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        mood: z.string().nullable().optional(),
        image_url: z.string().url().nullable().optional(),
      })
      .parse(raw);
    const c = await getClient();
    const { id, ...patch } = args;
    // Strip undefined so we don't overwrite columns with NULL when caller
    // omits a field. Explicit `null` is preserved (allowed clear-to-null
    // for mood / image_url).
    const cleanPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) cleanPatch[k] = v;
    }
    const { data, error } = await c
      .from("script_locations")
      .update(cleanPatch)
      .eq("id", id)
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const deleteLocation: ToolDef = {
  name: "delete_location",
  description:
    "Permanently delete a location. Scenes linked via location_id keep working — the FK is `ON DELETE SET NULL` so they just lose the location reference (text references to the location's name stay intact in scene bodies).",
  inputSchema: z.object({ id: z.string().uuid() }),
  handler: async (raw) => {
    const args = z.object({ id: z.string().uuid() }).parse(raw);
    const c = await getClient();
    const { error } = await c
      .from("script_locations")
      .delete()
      .eq("id", args.id);
    if (error) throw new Error(error.message);
    return { deleted: args.id };
  },
};

/* ---------- Calendar events ---------- */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const isoTime = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, "expected HH:MM or HH:MM:SS");
const colorEnum = z.enum([
  "pink",
  "green",
  "amber",
  "violet",
  "sky",
  "rose",
  "teal",
]);

const listCalendarEvents: ToolDef = {
  name: "list_calendar_events",
  description:
    "List calendar events in a workspace, optionally bounded by a date range (inclusive). Returns events with their attachments resolved to names.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        workspace_id: z.string().uuid().optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
      })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);

    let q = c
      .from("calendar_events")
      .select(
        "id, title, event_date, event_time, color, description, created_at",
      )
      .eq("workspace_id", ws)
      .order("event_date", { ascending: true })
      .order("event_time", { ascending: true, nullsFirst: true });
    if (args.from) q = q.gte("event_date", args.from);
    if (args.to) q = q.lte("event_date", args.to);
    const { data: events, error } = await q;
    if (error) throw new Error(error.message);

    const rows = events ?? [];
    if (rows.length === 0) return [];

    // Fetch attachments in a single round-trip and resolve entity names so
    // the agent can reason about what each event links to without follow-up
    // tool calls.
    const eventIds = rows.map((e) => e.id);
    const { data: atts, error: attErr } = await c
      .from("calendar_event_attachments")
      .select("id, event_id, entity_type, entity_id")
      .in("event_id", eventIds);
    if (attErr) throw new Error(attErr.message);

    const cardIds: string[] = [];
    const nodeIds: string[] = [];
    const charIds: string[] = [];
    for (const a of atts ?? []) {
      if (a.entity_type === "card") cardIds.push(a.entity_id);
      else if (a.entity_type === "script_node") nodeIds.push(a.entity_id);
      else if (a.entity_type === "character") charIds.push(a.entity_id);
    }
    const nameOf = new Map<string, string>();
    // Supabase query builder is PromiseLike, not Promise — Promise.all takes
    // an iterable of PromiseLike so this typing covers both.
    const fetches: PromiseLike<unknown>[] = [];
    if (cardIds.length > 0) {
      fetches.push(
        c
          .from("cards")
          .select("id, title")
          .in("id", cardIds)
          .then(({ data }) => {
            for (const r of data ?? []) nameOf.set(`card:${r.id}`, r.title);
          }),
      );
    }
    if (nodeIds.length > 0) {
      fetches.push(
        c
          .from("script_nodes")
          .select("id, title")
          .in("id", nodeIds)
          .then(({ data }) => {
            for (const r of data ?? [])
              nameOf.set(`script_node:${r.id}`, r.title);
          }),
      );
    }
    if (charIds.length > 0) {
      fetches.push(
        c
          .from("script_characters")
          .select("id, name")
          .in("id", charIds)
          .then(({ data }) => {
            for (const r of data ?? [])
              nameOf.set(`character:${r.id}`, r.name);
          }),
      );
    }
    await Promise.all(fetches);

    const attByEvent = new Map<
      string,
      Array<{
        attachment_id: string;
        entity_type: string;
        entity_id: string;
        name: string | null;
      }>
    >();
    for (const a of atts ?? []) {
      const list = attByEvent.get(a.event_id) ?? [];
      list.push({
        attachment_id: a.id,
        entity_type: a.entity_type,
        entity_id: a.entity_id,
        name: nameOf.get(`${a.entity_type}:${a.entity_id}`) ?? null,
      });
      attByEvent.set(a.event_id, list);
    }

    return rows.map((e) => ({
      ...e,
      attachments: attByEvent.get(e.id) ?? [],
    }));
  },
};

const createCalendarEvent: ToolDef = {
  name: "create_calendar_event",
  description:
    "Create a calendar event. `event_date` is YYYY-MM-DD; `event_time` is optional HH:MM. Returns the new event id.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    title: z.string().min(1),
    event_date: isoDate,
    event_time: isoTime.optional(),
    color: colorEnum.default("violet"),
    description: z.string().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        workspace_id: z.string().uuid().optional(),
        title: z.string().min(1),
        event_date: isoDate,
        event_time: isoTime.optional(),
        color: colorEnum.default("violet"),
        description: z.string().optional(),
      })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    // Server-side `created_by` is captured from the JWT — no need to pass it.
    const { data, error } = await c
      .from("calendar_events")
      .insert({
        workspace_id: ws,
        title: args.title.trim(),
        event_date: args.event_date,
        // Normalise HH:MM → HH:MM:00 (postgres `time` column is happy either way).
        event_time: args.event_time
          ? args.event_time.length === 5
            ? `${args.event_time}:00`
            : args.event_time
          : null,
        color: args.color,
        description: args.description ?? null,
      })
      .select("id, title, event_date, event_time, color")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const updateCalendarEvent: ToolDef = {
  name: "update_calendar_event",
  description:
    "Patch a calendar event. Only fields you pass are updated.",
  inputSchema: z.object({
    id: z.string().uuid(),
    title: z.string().min(1).optional(),
    event_date: isoDate.optional(),
    event_time: isoTime.nullable().optional(),
    color: colorEnum.optional(),
    description: z.string().nullable().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        id: z.string().uuid(),
        title: z.string().min(1).optional(),
        event_date: isoDate.optional(),
        event_time: isoTime.nullable().optional(),
        color: colorEnum.optional(),
        description: z.string().nullable().optional(),
      })
      .parse(raw);
    const c = await getClient();
    const { id, event_time, ...rest } = args;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) patch[k] = v;
    }
    if (event_time !== undefined) {
      patch.event_time =
        event_time === null
          ? null
          : event_time.length === 5
            ? `${event_time}:00`
            : event_time;
    }
    const { data, error } = await c
      .from("calendar_events")
      .update(patch)
      .eq("id", id)
      .select("id, title, event_date, event_time, color")
      .single();
    if (error) throw new Error(error.message);
    return data;
  },
};

const deleteCalendarEvent: ToolDef = {
  name: "delete_calendar_event",
  description:
    "Delete a calendar event. Attachments cascade-delete with it (DB ON DELETE CASCADE).",
  inputSchema: z.object({ id: z.string().uuid() }),
  handler: async (raw) => {
    const args = z.object({ id: z.string().uuid() }).parse(raw);
    const c = await getClient();
    const { error } = await c
      .from("calendar_events")
      .delete()
      .eq("id", args.id);
    if (error) throw new Error(error.message);
    return { deleted: args.id };
  },
};

/* ---------- Calendar attachments (polymorphic links to other entities) ---------- */

const attachmentEntityType = z.enum(["card", "script_node", "character"]);

const attachToCalendarEvent: ToolDef = {
  name: "attach_to_calendar_event",
  description:
    "Link a kanban task / script node / character to a calendar event. Idempotent — if the link already exists the existing attachment id is returned.",
  inputSchema: z.object({
    event_id: z.string().uuid(),
    entity_type: attachmentEntityType,
    entity_id: z.string().uuid(),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        event_id: z.string().uuid(),
        entity_type: attachmentEntityType,
        entity_id: z.string().uuid(),
      })
      .parse(raw);
    const c = await getClient();

    // The attachment row carries `workspace_id` for RLS scoping — look it
    // up from the parent event so the caller doesn't have to know it.
    const { data: ev, error: evErr } = await c
      .from("calendar_events")
      .select("workspace_id")
      .eq("id", args.event_id)
      .single();
    if (evErr) throw new Error(`event not found: ${evErr.message}`);

    // Idempotency: if this exact tuple is already attached, return it
    // rather than failing on the unique constraint.
    const { data: existing } = await c
      .from("calendar_event_attachments")
      .select("id")
      .eq("event_id", args.event_id)
      .eq("entity_type", args.entity_type)
      .eq("entity_id", args.entity_id)
      .maybeSingle();
    if (existing) return { id: existing.id, already_attached: true };

    const { data, error } = await c
      .from("calendar_event_attachments")
      .insert({
        event_id: args.event_id,
        workspace_id: ev.workspace_id,
        entity_type: args.entity_type,
        entity_id: args.entity_id,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id, already_attached: false };
  },
};

const detachFromCalendarEvent: ToolDef = {
  name: "detach_from_calendar_event",
  description:
    "Remove an attachment from a calendar event by attachment id (the id returned from `attach_to_calendar_event` or surfaced via `list_calendar_events`).",
  inputSchema: z.object({ attachment_id: z.string().uuid() }),
  handler: async (raw) => {
    const args = z.object({ attachment_id: z.string().uuid() }).parse(raw);
    const c = await getClient();
    const { error } = await c
      .from("calendar_event_attachments")
      .delete()
      .eq("id", args.attachment_id);
    if (error) throw new Error(error.message);
    return { deleted: args.attachment_id };
  },
};

/* ---------- Translations ----------------------------------------------------
 *
 * Designed for "give Claude one prompt and it does the work" rather than
 * step-by-step navigation. The killer combo is:
 *
 *   1. `translation_overview`     — one call, get the whole language → file → progress map
 *   2. `find_translation_strings` — flexible filter (status / glob / speaker / query)
 *   3. `update_translation_strings` — bulk patch N rows at once
 *
 * With those three an agent can translate a chapter in two tool calls.
 */

/** "Pending" is a convenience grouping for users — it means anything not yet
 *  marked `done`. The DB stores three statuses (empty / draft / done). */
function statusFilter(
  status: "pending" | "done" | "all" | undefined,
): string[] | null {
  if (!status || status === "all") return null;
  if (status === "done") return ["done"];
  return ["empty", "draft"];
}

/** Translate user-friendly glob into PostgREST `like` pattern.
 *  `*` → `%`, `?` → `_`. We treat the underscore as a literal first so a
 *  filename like `chapter_1` doesn't accidentally match `chapter-1`. */
function globToLike(glob: string): string {
  return glob
    .replace(/_/g, "\\_") // escape SQL wildcard
    .replace(/\*/g, "%")
    .replace(/\?/g, "_");
}

const listTranslationProjects: ToolDef = {
  name: "list_translation_projects",
  description: "List translation projects (target languages) in a workspace.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
  }),
  handler: async (raw) => {
    const args = z
      .object({ workspace_id: z.string().uuid().optional() })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    const { data, error } = await c
      .from("translation_projects")
      .select("id, name, source_lang, created_at")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};

const translationOverview: ToolDef = {
  name: "translation_overview",
  description:
    "Snapshot of all translation projects in a workspace WITH per-file progress (done/total). Use this as the first call when you need to find out which translation/file to work on — saves a chain of list_translation_projects + list_translation_files + per-file stat queries.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    include_files: z.boolean().default(true),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        workspace_id: z.string().uuid().optional(),
        include_files: z.boolean().default(true),
      })
      .parse(raw);
    const c = await getClient();
    const ws = await resolveWorkspaceId(c, args.workspace_id);
    const { data: projects, error } = await c
      .from("translation_projects")
      .select("id, name, source_lang, created_at")
      .eq("workspace_id", ws)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const projRows = projects ?? [];
    if (projRows.length === 0) return [];

    if (!args.include_files) {
      return projRows.map((p) => ({ ...p, files: [] }));
    }

    const projectIds = projRows.map((p) => p.id);
    const { data: files, error: filesErr } = await c
      .from("translation_files")
      .select("id, project_id, filename, folder_path, uploaded_at")
      .in("project_id", projectIds)
      .order("folder_path", { ascending: true })
      .order("filename", { ascending: true });
    if (filesErr) throw new Error(filesErr.message);
    const fileRows = files ?? [];

    // Batch stat lookup — one RPC call returns done/total per file_id.
    const fileIds = fileRows.map((f) => f.id);
    const statsByFile = new Map<string, { done: number; total: number }>();
    if (fileIds.length > 0) {
      const { data: stats, error: statsErr } = await c.rpc(
        "translation_file_stats",
        { _file_ids: fileIds },
      );
      if (statsErr) throw new Error(statsErr.message);
      for (const r of (stats ?? []) as Array<{
        file_id: string;
        done: number;
        total: number;
      }>) {
        statsByFile.set(r.file_id, { done: r.done, total: r.total });
      }
    }

    return projRows.map((p) => {
      const myFiles = fileRows
        .filter((f) => f.project_id === p.id)
        .map((f) => {
          const stats = statsByFile.get(f.id) ?? { done: 0, total: 0 };
          return {
            id: f.id,
            filename: f.filename,
            folder_path: f.folder_path,
            full_path: f.folder_path
              ? `${f.folder_path}/${f.filename}`
              : f.filename,
            stats,
          };
        });
      const total = myFiles.reduce((acc, f) => acc + f.stats.total, 0);
      const done = myFiles.reduce((acc, f) => acc + f.stats.done, 0);
      return {
        id: p.id,
        name: p.name,
        source_lang: p.source_lang,
        stats: { total, done, pending: total - done },
        files: myFiles,
      };
    });
  },
};

const listTranslationFiles: ToolDef = {
  name: "list_translation_files",
  description:
    "List .rpy files in a translation project, with per-file progress (done/total).",
  inputSchema: z.object({ project_id: z.string().uuid() }),
  handler: async (raw) => {
    const args = z.object({ project_id: z.string().uuid() }).parse(raw);
    const c = await getClient();
    const { data, error } = await c
      .from("translation_files")
      .select("id, filename, folder_path, uploaded_at")
      .eq("project_id", args.project_id)
      .order("folder_path", { ascending: true })
      .order("filename", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const { data: stats, error: statsErr } = await c.rpc(
      "translation_file_stats",
      { _file_ids: ids },
    );
    if (statsErr) throw new Error(statsErr.message);
    const statsByFile = new Map(
      ((stats ?? []) as Array<{ file_id: string; done: number; total: number }>).map(
        (s) => [s.file_id, s],
      ),
    );
    return rows.map((f) => ({
      ...f,
      full_path: f.folder_path ? `${f.folder_path}/${f.filename}` : f.filename,
      stats: statsByFile.get(f.id) ?? { done: 0, total: 0 },
    }));
  },
};

const findTranslationStrings: ToolDef = {
  name: "find_translation_strings",
  description:
    "Cross-file search for translation strings inside a project. Supports filtering by status ('pending' = empty+draft / 'done' / 'all'), speaker, full_path glob (e.g. 'chapter_1/*'), and a free-text query that scans source_text and translated_text. Default `status` is 'pending' and default `limit` is 100 (max 500). Use this instead of walking project → file → strings yourself.",
  inputSchema: z.object({
    project_id: z.string().uuid(),
    status: z.enum(["pending", "done", "all"]).default("pending"),
    query: z.string().optional(),
    speaker: z.string().optional(),
    file_path_glob: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        project_id: z.string().uuid(),
        status: z.enum(["pending", "done", "all"]).default("pending"),
        query: z.string().optional(),
        speaker: z.string().optional(),
        file_path_glob: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
      })
      .parse(raw);
    const c = await getClient();

    // Resolve project's files; optionally narrow by glob. We need the full
    // path map either way to enrich the response, so do this in one round.
    const { data: files, error: filesErr } = await c
      .from("translation_files")
      .select("id, filename, folder_path")
      .eq("project_id", args.project_id);
    if (filesErr) throw new Error(filesErr.message);
    const pathOf = new Map<string, string>();
    let candidateFileIds: string[] = [];
    for (const f of files ?? []) {
      const full = f.folder_path ? `${f.folder_path}/${f.filename}` : f.filename;
      pathOf.set(f.id, full);
      if (args.file_path_glob) {
        // Compile the glob to a regex once per row — small N, fine.
        const pattern = new RegExp(
          "^" + globToLike(args.file_path_glob).replace(/%/g, ".*").replace(/\\_/g, "_") + "$",
          "i",
        );
        if (pattern.test(full)) candidateFileIds.push(f.id);
      } else {
        candidateFileIds.push(f.id);
      }
    }
    if (candidateFileIds.length === 0) return [];

    let q = c
      .from("translation_strings")
      .select(
        "id, file_id, source_text, translated_text, speaker, status, source_line, source_path",
      )
      .in("file_id", candidateFileIds)
      .order("source_line", { ascending: true })
      .range(args.offset, args.offset + args.limit - 1);

    const allowedStatuses = statusFilter(args.status);
    if (allowedStatuses) q = q.in("status", allowedStatuses);
    if (args.speaker) q = q.eq("speaker", args.speaker);
    if (args.query) {
      // Match either side of the string — useful for finding a placeholder
      // in the source or spotting earlier translations to mimic.
      const safe = args.query.replace(/[%_]/g, (m) => "\\" + m);
      q = q.or(
        `source_text.ilike.%${safe}%,translated_text.ilike.%${safe}%`,
      );
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data ?? []).map((s) => ({
      id: s.id,
      file_id: s.file_id,
      full_path: pathOf.get(s.file_id) ?? null,
      source_line: s.source_line,
      speaker: s.speaker,
      status: s.status,
      source_text: s.source_text,
      translated_text: s.translated_text,
    }));
  },
};

const readTranslationStrings: ToolDef = {
  name: "read_translation_strings",
  description:
    "Sequential dump of a translation file's strings with pagination. Use when you need adjacent strings for context (the previous lines of dialogue) rather than a sparse filtered set.",
  inputSchema: z.object({
    file_id: z.string().uuid(),
    status: z.enum(["pending", "done", "all"]).default("all"),
    limit: z.number().int().min(1).max(500).default(200),
    offset: z.number().int().min(0).default(0),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        file_id: z.string().uuid(),
        status: z.enum(["pending", "done", "all"]).default("all"),
        limit: z.number().int().min(1).max(500).default(200),
        offset: z.number().int().min(0).default(0),
      })
      .parse(raw);
    const c = await getClient();
    let q = c
      .from("translation_strings")
      .select(
        "id, source_text, translated_text, speaker, status, source_line, source_path, group_label",
      )
      .eq("file_id", args.file_id)
      .order("source_line", { ascending: true })
      .range(args.offset, args.offset + args.limit - 1);
    const allowedStatuses = statusFilter(args.status);
    if (allowedStatuses) q = q.in("status", allowedStatuses);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};

const updateTranslationStrings: ToolDef = {
  name: "update_translation_strings",
  description:
    "Bulk-patch translation strings — pass an array of {id, translated_text, status?} and they're all updated in one round trip. The most efficient way for an agent to ship a chunk of translations. `status` defaults to 'done' when not provided. Returns a per-row result so partial failures don't lose the rest.",
  inputSchema: z.object({
    updates: z
      .array(
        z.object({
          id: z.string().uuid(),
          translated_text: z.string(),
          status: z.enum(["empty", "draft", "done"]).optional(),
        }),
      )
      .min(1)
      .max(500),
  }),
  handler: async (raw) => {
    const args = z
      .object({
        updates: z
          .array(
            z.object({
              id: z.string().uuid(),
              translated_text: z.string(),
              status: z.enum(["empty", "draft", "done"]).optional(),
            }),
          )
          .min(1)
          .max(500),
      })
      .parse(raw);
    const c = await getClient();
    // Supabase doesn't have a clean multi-row UPDATE-WHERE-id-IN-VALUES API,
    // so we issue one UPDATE per row but in parallel. Sub-second for ~100
    // rows; safer than a CTE workaround that needs an RPC.
    const results = await Promise.all(
      args.updates.map(async (u) => {
        const { error } = await c
          .from("translation_strings")
          .update({
            translated_text: u.translated_text,
            status: u.status ?? "done",
          })
          .eq("id", u.id);
        return { id: u.id, ok: !error, error: error?.message };
      }),
    );
    const failed = results.filter((r) => !r.ok);
    return {
      updated: results.length - failed.length,
      failed: failed.length,
      errors: failed,
    };
  },
};

const listTranslationSpeakers: ToolDef = {
  name: "list_translation_speakers",
  description:
    "Distinct speakers in a translation project (e.g. 'dg', 'alice', null for narrator). Useful for 'translate everything Alice says'-style queries — feed the speaker into find_translation_strings.",
  inputSchema: z.object({ project_id: z.string().uuid() }),
  handler: async (raw) => {
    const args = z.object({ project_id: z.string().uuid() }).parse(raw);
    const c = await getClient();
    // Resolve file ids first; Supabase has no DISTINCT clause via PostgREST,
    // so we dedupe client-side over a bounded set.
    const { data: files, error: filesErr } = await c
      .from("translation_files")
      .select("id")
      .eq("project_id", args.project_id);
    if (filesErr) throw new Error(filesErr.message);
    const ids = (files ?? []).map((f) => f.id);
    if (ids.length === 0) return [];
    const { data, error } = await c
      .from("translation_strings")
      .select("speaker")
      .in("file_id", ids)
      .limit(10000);
    if (error) throw new Error(error.message);
    const counts = new Map<string | null, number>();
    for (const r of data ?? []) {
      const k = r.speaker;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([speaker, count]) => ({ speaker, count }))
      .sort((a, b) => b.count - a.count);
  },
};

const deleteTranslationFile: ToolDef = {
  name: "delete_translation_file",
  description:
    "Delete a translation file (all its strings cascade-delete with it).",
  inputSchema: z.object({ id: z.string().uuid() }),
  handler: async (raw) => {
    const args = z.object({ id: z.string().uuid() }).parse(raw);
    const c = await getClient();
    const { error } = await c
      .from("translation_files")
      .delete()
      .eq("id", args.id);
    if (error) throw new Error(error.message);
    return { deleted: args.id };
  },
};

const deleteTranslationProject: ToolDef = {
  name: "delete_translation_project",
  description:
    "Delete an entire translation project (all files + strings cascade-delete).",
  inputSchema: z.object({ id: z.string().uuid() }),
  handler: async (raw) => {
    const args = z.object({ id: z.string().uuid() }).parse(raw);
    const c = await getClient();
    const { error } = await c
      .from("translation_projects")
      .delete()
      .eq("id", args.id);
    if (error) throw new Error(error.message);
    return { deleted: args.id };
  },
};

/* ---------- Export ---------- */

export const TOOLS: ToolDef[] = [
  listWorkspaces,
  listProjects,
  createScriptProject,
  updateScriptProject,
  deleteScriptProject,
  listTasks,
  createTask,
  moveTask,
  updateTask,
  deleteTask,
  listTaskSubtasks,
  addTaskSubtask,
  updateTaskSubtask,
  deleteTaskSubtask,
  listScriptNodes,
  readScriptNode,
  createScriptNode,
  updateScriptNode,
  appendToScene,
  deleteScriptNode,
  listCharacters,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  listLocations,
  createLocation,
  updateLocation,
  deleteLocation,
  getSubscription,
  getWritingStyle,
  updateWritingStyle,
  listCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  attachToCalendarEvent,
  detachFromCalendarEvent,
  listTranslationProjects,
  translationOverview,
  listTranslationFiles,
  findTranslationStrings,
  readTranslationStrings,
  updateTranslationStrings,
  listTranslationSpeakers,
  deleteTranslationFile,
  deleteTranslationProject,
];
