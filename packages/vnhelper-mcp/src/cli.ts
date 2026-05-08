#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import {
  PATHS,
  readEnv,
  writeAuth,
  writeEnv,
  type EnvState,
} from "./config.js";
import { startServer } from "./server.js";
import { startHttpServer } from "./http.js";

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

async function cmdLogin(flags: Record<string, string | boolean>) {
  const email = typeof flags.email === "string" ? flags.email : null;
  const password = typeof flags.password === "string" ? flags.password : null;
  if (!email || !password) {
    console.error(
      "Usage: vnhelper-mcp login --email you@example.com --password ...",
    );
    process.exit(1);
  }
  const env = readEnv();
  const c = createClient(env.supabase_url, env.supabase_anon_key);
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.error("Sign-in failed:", error?.message ?? "no session");
    process.exit(1);
  }
  const s = data.session;
  writeAuth({
    refresh_token: s.refresh_token,
    access_token: s.access_token,
    expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    user_id: s.user.id,
    email: s.user.email ?? email,
  });
  console.log(`Signed in as ${s.user.email}.`);
  console.log(`Auth saved to ${PATHS.AUTH_FILE}.`);
}

async function cmdConfigure(flags: Record<string, string | boolean>) {
  const url =
    (typeof flags.url === "string" && flags.url) ||
    process.env.VNHELPER_SUPABASE_URL ||
    "";
  const key =
    (typeof flags.key === "string" && flags.key) ||
    process.env.VNHELPER_SUPABASE_ANON_KEY ||
    "";
  if (!url || !key) {
    console.error(
      "Usage: vnhelper-mcp configure --url https://<ref>.supabase.co --key <anon-key>",
    );
    process.exit(1);
  }
  const state: EnvState = {
    supabase_url: url,
    supabase_anon_key: key,
    default_workspace_id:
      typeof flags.workspace === "string" ? flags.workspace : undefined,
    default_project_id:
      typeof flags.project === "string" ? flags.project : undefined,
  };
  writeEnv(state);
  console.log(`Config saved to ${PATHS.ENV_FILE}.`);
}

async function cmdHttp(flags: Record<string, string | boolean>) {
  const port = Number(
    typeof flags.port === "string" ? flags.port : process.env.VNHELPER_HTTP_PORT ?? 3399,
  );
  const token =
    (typeof flags.token === "string" && flags.token) ||
    process.env.VNHELPER_HTTP_TOKEN ||
    "";
  const host = typeof flags.host === "string" ? flags.host : "127.0.0.1";
  if (!token || token.length < 16) {
    console.error(
      "vnhelper-mcp http requires --token <secret> (≥16 chars) or VNHELPER_HTTP_TOKEN env var.",
    );
    process.exit(1);
  }
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${port}`);
    process.exit(1);
  }
  await startHttpServer({ port, token, host });
  // Keep alive
  await new Promise(() => {});
}

async function cmdHelp() {
  console.log(`vnhelper-mcp — MCP server for VnHelper

Commands:
  configure --url <supabase-url> --key <anon-key>
                              Save Supabase project credentials.
                              Optional: --workspace <id> --project <id>
                              (or set VNHELPER_SUPABASE_URL / VNHELPER_SUPABASE_ANON_KEY env vars)
  login --email <e> --password <p>
                              Sign in and store the session token.
  serve                       Run the MCP stdio server (default — for Claude Code/Desktop).
  http --token <secret> [--port 3399] [--host 127.0.0.1]
                              Run the streamable-HTTP MCP server (for claude.ai connectors
                              via a public tunnel).
  help                        Show this message.

Files:
  Config:  ${PATHS.ENV_FILE}
  Auth:    ${PATHS.AUTH_FILE}
`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  switch (cmd) {
    case "login":
      await cmdLogin(flags);
      return;
    case "configure":
      await cmdConfigure(flags);
      return;
    case "http":
      await cmdHttp(flags);
      return;
    case "help":
    case "--help":
    case "-h":
      await cmdHelp();
      return;
    case undefined:
    case "serve":
      await startServer();
      return;
    default:
      console.error(`Unknown command: ${cmd}`);
      await cmdHelp();
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
