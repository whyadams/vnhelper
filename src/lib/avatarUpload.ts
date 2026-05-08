import { supabase } from "./supabase";

const BUCKET = "character-avatars";
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * Upload an avatar to Supabase Storage and return its public URL.
 * Path layout: <workspace_id>/<character_id>/<timestamp>.<ext>
 *
 * Storage RLS requires the authenticated user to be a member of the
 * workspace whose id is the first path segment.
 */
export async function uploadCharacterAvatar(
  file: File,
  workspaceId: string,
  characterId: string,
): Promise<string> {
  if (!ALLOWED.includes(file.type)) {
    throw new Error(`Unsupported image type: ${file.type}`);
  }
  if (file.size > MAX_BYTES) {
    throw new Error(
      `Image too large (${(file.size / 1024 / 1024).toFixed(2)} MB, max 2 MB).`,
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : "png";
  const path = `${workspaceId}/${characterId}/${Date.now()}.${safeExt}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type,
    });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Try to delete the storage object behind a public URL.
 * Best-effort — errors are swallowed so callers can keep going if RLS
 * disagrees (e.g. the file was uploaded by someone else).
 */
export async function deleteCharacterAvatar(publicUrl: string): Promise<void> {
  const marker = `/${BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return;
  const path = publicUrl.slice(idx + marker.length);
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.warn("avatar delete failed", error);
}
