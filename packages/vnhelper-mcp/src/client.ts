import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readAuth, writeAuth, readEnv, type AuthState } from "./config.js";

let cached: { client: SupabaseClient; expiresAt: number } | null = null;

export async function getClient(): Promise<SupabaseClient> {
  // Reuse cached client only while its access token is still fresh.
  // Once near expiry, drop it so we re-create with refreshed JWT attached.
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - now > 60) return cached.client;
  cached = null;

  const env = readEnv();
  const client = createClient(env.supabase_url, env.supabase_anon_key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const auth = readAuth();
  if (!auth) {
    throw new Error(
      "Not signed in. Run `vnhelper-mcp login --email you@example.com --password ...` first.",
    );
  }

  let active: AuthState = auth;

  if (auth.expires_at - now < 60) {
    // Token expired or about to — refresh first.
    const { data, error } = await client.auth.refreshSession({
      refresh_token: auth.refresh_token,
    });
    if (error || !data.session) {
      throw new Error(
        `Failed to refresh session: ${error?.message ?? "no session"}. Re-login via VnHelper → Settings → Connect Claude, or run \`vnhelper-mcp login\`.`,
      );
    }
    active = {
      refresh_token: data.session.refresh_token,
      access_token: data.session.access_token,
      expires_at: data.session.expires_at ?? now + 3600,
      user_id: data.session.user.id,
      email: data.session.user.email ?? auth.email,
    };
    writeAuth(active);
  }

  // CRITICAL: explicitly attach the (refreshed or still-valid) JWT to the client.
  // refreshSession() on a fresh client doesn't always set the active session
  // internally with persistSession:false — without this call, queries go out
  // anonymously and RLS treats them as such.
  const { error: setErr } = await client.auth.setSession({
    access_token: active.access_token,
    refresh_token: active.refresh_token,
  });
  if (setErr) {
    throw new Error(
      `Failed to attach session to client: ${setErr.message}. Re-login via VnHelper → Settings → Connect Claude.`,
    );
  }

  cached = { client, expiresAt: active.expires_at };
  return client;
}

export async function getCurrentUserId(): Promise<string> {
  const auth = readAuth();
  if (!auth) throw new Error("Not signed in.");
  return auth.user_id;
}
