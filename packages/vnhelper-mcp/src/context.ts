import type { SupabaseClient } from "@supabase/supabase-js";
import { readEnv } from "./config.js";

/**
 * Resolves the workspace_id to operate on.
 * - explicit arg wins
 * - env default next
 * - if user has exactly one workspace, use it
 * - otherwise throw
 */
export async function resolveWorkspaceId(
  client: SupabaseClient,
  explicit?: string,
): Promise<string> {
  if (explicit) return explicit;
  const env = readEnv();
  if (env.default_workspace_id) return env.default_workspace_id;
  const { data, error } = await client
    .from("workspaces")
    .select("id")
    .limit(2);
  if (error) throw new Error(`Cannot list workspaces: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error("No workspaces found for this user.");
  }
  if (data.length > 1) {
    throw new Error(
      "Multiple workspaces — pass workspace_id explicitly or set VNHELPER_DEFAULT_WORKSPACE_ID.",
    );
  }
  return data[0].id;
}

/**
 * Resolves the active board id for the workspace (kanban tasks live on a board).
 */
export async function resolveBoardId(
  client: SupabaseClient,
  workspaceId: string,
): Promise<string> {
  const { data, error } = await client
    .from("boards")
    .select("id")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw new Error(`Cannot find board: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`No board exists in workspace ${workspaceId}.`);
  }
  return data[0].id;
}

export async function resolveColumnId(
  client: SupabaseClient,
  boardId: string,
  columnKey: string,
): Promise<string> {
  const { data, error } = await client
    .from("columns")
    .select("id")
    .eq("board_id", boardId)
    .eq("key", columnKey)
    .limit(1);
  if (error) throw new Error(`Cannot find column: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`Column "${columnKey}" not found on board ${boardId}.`);
  }
  return data[0].id;
}

export async function resolveProjectId(
  client: SupabaseClient,
  workspaceId: string,
  explicit?: string,
): Promise<string> {
  if (explicit) return explicit;
  const env = readEnv();
  if (env.default_project_id) return env.default_project_id;
  const { data, error } = await client
    .from("script_projects")
    .select("id")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .limit(2);
  if (error) throw new Error(`Cannot list projects: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error("No script projects in this workspace.");
  }
  if (data.length > 1) {
    throw new Error(
      "Multiple script projects — pass project_id explicitly or set VNHELPER_DEFAULT_PROJECT_ID.",
    );
  }
  return data[0].id;
}
