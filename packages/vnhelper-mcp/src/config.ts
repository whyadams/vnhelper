import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const CONFIG_DIR = join(homedir(), ".vnhelper");
const AUTH_FILE = join(CONFIG_DIR, "auth.json");
const ENV_FILE = join(CONFIG_DIR, "env.json");

export interface AuthState {
  refresh_token: string;
  access_token: string;
  expires_at: number;
  user_id: string;
  email: string;
}

export interface EnvState {
  supabase_url: string;
  supabase_anon_key: string;
  default_workspace_id?: string;
  default_project_id?: string;
}

function ensureDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function readAuth(): AuthState | null {
  if (!existsSync(AUTH_FILE)) return null;
  try {
    return JSON.parse(readFileSync(AUTH_FILE, "utf8")) as AuthState;
  } catch {
    return null;
  }
}

export function writeAuth(state: AuthState): void {
  ensureDir();
  writeFileSync(AUTH_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function clearAuth(): void {
  if (existsSync(AUTH_FILE)) {
    writeFileSync(AUTH_FILE, "");
  }
}

export function readEnv(): EnvState {
  // Env vars take precedence over the file.
  const url = process.env.VNHELPER_SUPABASE_URL;
  const key = process.env.VNHELPER_SUPABASE_ANON_KEY;
  if (url && key) {
    return {
      supabase_url: url,
      supabase_anon_key: key,
      default_workspace_id: process.env.VNHELPER_DEFAULT_WORKSPACE_ID,
      default_project_id: process.env.VNHELPER_DEFAULT_PROJECT_ID,
    };
  }
  if (!existsSync(ENV_FILE)) {
    throw new Error(
      `vnhelper-mcp is not configured.\n` +
        `Set VNHELPER_SUPABASE_URL and VNHELPER_SUPABASE_ANON_KEY env vars,\n` +
        `or create ${ENV_FILE} with { "supabase_url": "...", "supabase_anon_key": "..." }`,
    );
  }
  const parsed = JSON.parse(readFileSync(ENV_FILE, "utf8")) as EnvState;
  if (!parsed.supabase_url || !parsed.supabase_anon_key) {
    throw new Error(`Invalid ${ENV_FILE}: missing supabase_url / supabase_anon_key`);
  }
  return parsed;
}

export function writeEnv(state: EnvState): void {
  ensureDir();
  writeFileSync(ENV_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

export const PATHS = { CONFIG_DIR, AUTH_FILE, ENV_FILE };
