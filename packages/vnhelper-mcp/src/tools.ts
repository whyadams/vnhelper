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

/* ---------- Tasks (kanban) ---------- */

const listTasks: ToolDef = {
  name: "list_tasks",
  description:
    "List kanban cards in the workspace. Filter by column key (todo/progress/review/done) or status.",
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
    return rows;
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
        "id, parent_id, kind, title, emoji, pinned, position, status, pov, tags, updated_at",
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
    "even after the user edited the document in the UI.",
  inputSchema: z.object({ node_id: z.string().uuid() }),
  handler: async (raw) => {
    const args = z.object({ node_id: z.string().uuid() }).parse(raw);
    const c = await getClient();
    const { data, error } = await c
      .from("script_nodes")
      .select(
        "id, project_id, parent_id, kind, title, emoji, body, content, status, pov, tags, position, updated_at",
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
    "line breaks (hardBreak), blank lines start a new paragraph.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
    parent_id: z.string().uuid().nullable().optional(),
    kind: z.enum(["chapter", "scene", "block"]).default("scene"),
    title: z.string().min(1),
    emoji: z.string().optional(),
    body: z.string().optional(),
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
    "editor content is regenerated from the markdown automatically.",
  inputSchema: z.object({
    node_id: z.string().uuid(),
    title: z.string().optional(),
    body: z.string().optional(),
    kind: z.enum(["chapter", "scene", "block"]).optional(),
    emoji: z.string().nullable().optional(),
    status: z.string().optional(),
    pov: z.string().nullable().optional(),
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
      })
      .parse(raw);
    const c = await getClient();
    const patch: Record<string, unknown> = {};
    for (const k of ["title", "body", "kind", "emoji", "status", "pov"] as const) {
      if (args[k] !== undefined) patch[k] = args[k];
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
    "state is preserved by serializing it back to markdown before appending.",
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
        "id, name, short_name, color, emoji, pronouns, age, role, voice_notes, traits, aliases",
      )
      .eq("project_id", project)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
};

const createCharacter: ToolDef = {
  name: "create_character",
  description: "Create a character in the project.",
  inputSchema: z.object({
    workspace_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
    name: z.string().min(1),
    short_name: z.string().optional(),
    color: z.string().default("#828c99"),
    emoji: z.string().optional(),
    pronouns: z.string().optional(),
    role: z.string().optional(),
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
        voice_notes: "",
        traits: {} as never,
        aliases: [],
      })
      .select("id, name")
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

/* ---------- Export ---------- */

export const TOOLS: ToolDef[] = [
  listWorkspaces,
  listProjects,
  listTasks,
  createTask,
  moveTask,
  updateTask,
  deleteTask,
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
  listCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  attachToCalendarEvent,
  detachFromCalendarEvent,
];
