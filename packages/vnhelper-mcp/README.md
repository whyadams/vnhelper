# vnhelper-mcp

MCP server exposing VnHelper (Supabase-backed) workspace operations to Claude.
Lets Claude create kanban tasks, draft script scenes, manage characters, etc.

## Tools

**Workspaces / projects**
- `list_workspaces`
- `list_script_projects`

**Tasks (kanban)**
- `list_tasks` — filter by column, optionally include `done`
- `create_task`
- `move_task`
- `update_task`
- `delete_task`

**Script (chapters / scenes / blocks)**
- `list_script_nodes`
- `read_script_node`
- `create_script_node`
- `update_script_node`
- `append_to_scene` — useful for AI line-by-line drafting
- `delete_script_node`

**Characters**
- `list_characters`
- `create_character`

## Install

```bash
cd packages/vnhelper-mcp
pnpm install
pnpm run build
```

## Configure

Two ways — pick one.

**Env vars** (recommended for Claude Code config):
```
VNHELPER_SUPABASE_URL=https://<ref>.supabase.co
VNHELPER_SUPABASE_ANON_KEY=<anon-key>
VNHELPER_DEFAULT_WORKSPACE_ID=<uuid>   # optional, omit to disambiguate
VNHELPER_DEFAULT_PROJECT_ID=<uuid>     # optional, for script tools
```

**Or persistent file:**
```bash
node dist/cli.js configure \
  --url https://<ref>.supabase.co \
  --key <anon-key> \
  --workspace <workspace-uuid> \
  --project <project-uuid>
```
Saved to `~/.vnhelper/env.json` (mode 600).

## Sign in

```bash
node dist/cli.js login --email you@example.com --password '...'
```
Token saved to `~/.vnhelper/auth.json`. RLS still applies — the server uses
your user session, not a service-role key.

## Add to Claude Code

```bash
claude mcp add vnhelper \
  --scope user \
  --env VNHELPER_SUPABASE_URL=https://<ref>.supabase.co \
  --env VNHELPER_SUPABASE_ANON_KEY=<anon-key> \
  --env VNHELPER_DEFAULT_WORKSPACE_ID=<workspace-uuid> \
  -- node E:/Desktop/VnHelper/packages/vnhelper-mcp/dist/cli.js
```

Restart Claude Code; tools appear in the MCP list. Then in any conversation:
> Add a high-priority task "draft chapter 3 ending"

## Auth refresh

The server auto-refreshes the session if `expires_at` is within 60 seconds.
Refresh tokens are long-lived; if refresh fails, run `login` again.

## HTTP mode (for claude.ai web Connectors)

claude.ai web only accepts **remote HTTP MCP servers**. Run the same server in
HTTP mode and expose it via Cloudflare Tunnel:

```bash
# pick a long random token (≥16 chars). PowerShell:
#   [Convert]::ToBase64String((1..24 | %{[byte](Get-Random -Max 256)}))

node dist/cli.js http --token <YOUR_TOKEN> --port 3399
```

In a second terminal — quick public tunnel (no signup):

```bash
# install once: winget install Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3399
```

Cloudflared prints a URL like `https://random-name.trycloudflare.com`.
On claude.ai → Settings → Connectors → **Add custom connector**:

- **Name:** `vnhelper`
- **Remote MCP server URL:** `https://random-name.trycloudflare.com/mcp?token=<YOUR_TOKEN>`

Hit Add. Tools appear in chat. RLS still works — server uses your locally-stored
session (`~/.vnhelper/auth.json`).

**Caveats:**
- The tunnel URL changes each time you restart `cloudflared`. For a stable URL,
  register a named tunnel (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/).
- Both `vnhelper-mcp http` and `cloudflared` must keep running while you use it.
- The token is in the URL — do not share it.

## Files

- `~/.vnhelper/env.json` — Supabase URL + anon key + defaults
- `~/.vnhelper/auth.json` — your session tokens (mode 600)
