# vnhelper-mcp

MCP server exposing VnHelper (Supabase-backed) workspace operations to Claude.
Lets Claude create kanban tasks, draft script scenes, manage characters, etc.

## Installation for end users

You don't have to install anything separately. The MCP server is **bundled
inside the VnHelper installer as a single-file native binary** (compiled with
`bun build --compile` — no Node, npm, or build tools required).

To connect Claude:

1. Install VnHelper.
2. Open **Settings → Integrations → Connect Claude**.
3. Pick **Claude Desktop** (config file) or **Claude Code** (CLI command),
   copy the generated snippet, paste/run.
4. Restart Claude.

Token + workspace defaults are written to `~/.vnhelper/auth.json` and
`~/.vnhelper/env.json` automatically. The generated snippet points directly
at the bundled sidecar — typically
`<install dir>/resources/binaries/vnhelper-mcp.exe` on Windows.

The rest of this README covers the **developer** workflow (building from
source, custom auth, HTTP transport, etc.).

---

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
- `update_character` — patch fields (name/short_name/color/emoji/pronouns/age/role/voice_notes/rpy_var/aliases)
- `delete_character`

**Locations**
- `list_locations`
- `create_location` — name + optional description / mood / image_url
- `update_location`
- `delete_location` — scenes linked via location_id stay (FK is ON DELETE SET NULL)

**Calendar**
- `list_calendar_events` — optional `from`/`to` (YYYY-MM-DD) date-range filter; attachments are resolved to entity names inline
- `create_calendar_event` — title + date + optional time/color/description
- `update_calendar_event`
- `delete_calendar_event` — attachments cascade
- `attach_to_calendar_event` — link card / script_node / character (idempotent)
- `detach_from_calendar_event`

**Subscription**
- `get_subscription` — returns the user's tier (`free` | `pro`), raw status, trial countdown, and the resolved limit map. Call before attempting quota-bound actions so you can warn the user instead of surfacing a raw DB error.

**Writing style (per project)**
- `get_writing_style` — read the project's author voice preferences (language, tone, POV, tense, sentence length, vocabulary, do/don't examples, custom rules). Call before drafting new scenes so output matches the author.
- `update_writing_style` — patch (or replace) the style. Use when the user says "make my style darker and more concise" — call `get_writing_style` first, then write the merged patch. `mode: 'replace'` discards the previous object entirely.

**Translations** — designed so one prompt = 1-3 tool calls, not 50:
- `translation_overview` — whole language → file → progress map in **one call**. Start here.
- `list_translation_projects` / `list_translation_files`
- `find_translation_strings` — cross-file search with `status` ('pending' / 'done' / 'all'), `file_path_glob` (`chapter_1/*`), `speaker`, free-text `query`. Default returns pending strings, paginated.
- `read_translation_strings` — sequential dump of one file for context.
- `update_translation_strings` — **bulk patch up to 500 rows per call**, returns per-row results.
- `list_translation_speakers` — distinct speakers for "translate everything by Alice"-style prompts.
- `delete_translation_file` / `delete_translation_project`

Typical agent workflow for "translate pending in chapter_1":
```
1. find_translation_strings({status:'pending', file_path_glob:'chapter_1/*'})
2. → think over translations →
3. update_translation_strings({updates: [{id, translated_text}, …]})
```
Two tool calls regardless of file count.

## Build from source (dev)

```bash
cd packages/vnhelper-mcp
pnpm install
pnpm run build           # tsc → dist/cli.js (run via `node`)
pnpm run bundle:win      # bun --compile → dist/vnhelper-mcp.exe (single file)
# also: bundle:mac / bundle:linux
```

The bundled binary is what the Tauri installer ships. `bun --compile` embeds
the Bun runtime into the exe (~115 MB) so the binary runs on a machine
without Node/Bun installed.

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
