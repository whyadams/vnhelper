import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readAuth, writeAuth, readEnv, type AuthState } from "./config.js";

let cached: SupabaseClient | null = null;

export async function getClient(): Promise<SupabaseClient> {
  if (cached) return cached;
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

  // If access token expires within 60s, refresh.
  const now = Math.floor(Date.now() / 1000);
  let active: AuthState = auth;
  if (auth.expires_at - now < 60) {
    const { data, error } = await client.auth.refreshSession({
      refresh_token: auth.refresh_token,
    });
    if (error || !data.session) {
      throw new Error(
        `Failed to refresh session: ${error?.message ?? "no session"}. Run \`vnhelper-mcp login\` again.`,
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
  } else {
    await client.auth.setSession({
      access_token: auth.access_token,
      refresh_token: auth.refresh_token,
    });
  }

  cached = client;
  return client;
}

export async function getCurrentUserId(): Promise<string> {
  const auth = readAuth();
  if (!auth) throw new Error("Not signed in.");
  return auth.user_id;
}
