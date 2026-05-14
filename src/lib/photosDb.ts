/**
 * Local-only photo storage on top of IndexedDB.
 *
 * Two-store split so the gallery can boot fast even with thousands of
 * photos in storage:
 *
 *   - `photos`      — metadata + small JPEG thumbnail (~30–80 KB each).
 *                     Read on startup. Drives the grid view.
 *   - `photo_blobs` — original full-resolution blob (the 2 MB+ JPEG /
 *                     PNG / WebP / GIF as uploaded). Read on demand
 *                     when the user opens the lightbox or downloads.
 *   - `folders`     — id, name, colour for the sidebar.
 *
 * Schema bumped to v2 to introduce `photo_blobs`. On upgrade from v1 we
 * migrate every existing row by lifting `blob` into the new store; the
 * thumbnail field stays null until the runtime backfills it lazily.
 *
 * Why not just lazy-create ObjectURLs in v1 schema? Because reading
 * 1400 × 2 MB blobs from IndexedDB on startup already costs gigabytes
 * of memory and seconds of wall time. Keeping the full blob out of the
 * startup transaction is the win.
 */

const DB_NAME = "vnhelper-photos";
const DB_VERSION = 3;
const STORE_PHOTOS = "photos";
const STORE_BLOBS = "photo_blobs";
const STORE_FOLDERS = "folders";

export interface StoredPhoto {
  id: string;
  name: string;
  size: number;
  type: string;
  addedAt: number;
  favorite: boolean;
  /** null = root (no folder); folder id otherwise. */
  folderId: string | null;
  /** Downscaled JPEG ~480px longest-side. Null when not yet generated —
   *  consumers should backfill via `setThumbnail` after generating one. */
  thumbnail: Blob | null;
}

export interface StoredFolder {
  id: string;
  name: string;
  color: string;
  addedAt: number;
  /** Parent folder id, or null for top-level folders. Drives the sidebar
   *  tree. Added in schema v3 — every pre-existing folder is backfilled
   *  with `null` (top-level) on upgrade. */
  parentId: string | null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      const oldVersion = (ev as IDBVersionChangeEvent).oldVersion;
      // -- v1: original single-blob `photos` store + `folders`. -----------
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
        const store = db.createObjectStore(STORE_PHOTOS, { keyPath: "id" });
        store.createIndex("addedAt", "addedAt");
        store.createIndex("folderId", "folderId");
      }
      if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
        db.createObjectStore(STORE_FOLDERS, { keyPath: "id" });
      }
      // -- v2: lift full blobs out into a separate store, leave thumb-
      //        only rows in `photos`. We do the copy inside the upgrade
      //        txn (which is allowed to read+write both stores). ---------
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(STORE_BLOBS)) {
          db.createObjectStore(STORE_BLOBS, { keyPath: "id" });
        }
        const tx = req.transaction!;
        const photos = tx.objectStore(STORE_PHOTOS);
        const blobs = tx.objectStore(STORE_BLOBS);
        photos.openCursor().onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (!cursor) return;
          const row = cursor.value as StoredPhoto & { blob?: Blob };
          if (row.blob) {
            blobs.put({ id: row.id, blob: row.blob });
            delete row.blob;
          }
          if (!("thumbnail" in row)) {
            (row as StoredPhoto).thumbnail = null;
          }
          cursor.update(row);
          cursor.continue();
        };
      }
      // -- v3: folders gain a `parentId` so the sidebar can render them
      //        as a tree. Every legacy folder is treated as top-level
      //        (parentId = null), preserving the previous flat layout
      //        until the user moves something. ---------------------------
      if (oldVersion < 3) {
        const tx = req.transaction!;
        const folders = tx.objectStore(STORE_FOLDERS);
        folders.openCursor().onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
          if (!cursor) return;
          const row = cursor.value as StoredFolder & { parentId?: string | null };
          if (row.parentId === undefined) {
            row.parentId = null;
            cursor.update(row);
          }
          cursor.continue();
        };
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
  return dbPromise;
}

/** Promisified `IDBRequest` — drops the boilerplate at every call site. */
function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

function awaitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// -- Photos -----------------------------------------------------------------

/** List metadata + thumbnails for every photo. Does NOT touch the heavy
 *  full-blob store — that's what makes startup fast even at 1k+ photos. */
export async function listPhotos(): Promise<StoredPhoto[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_PHOTOS, "readonly");
  const items = await reqAsPromise(tx.objectStore(STORE_PHOTOS).getAll());
  return (items as StoredPhoto[]).sort((a, b) => b.addedAt - a.addedAt);
}

/** Fetch one photo's metadata + thumbnail by id. Used by callers that
 *  hold a photo reference (e.g. a script node's `photo_id`) and need to
 *  resolve it for a small preview without iterating `listPhotos()`. */
export async function getPhoto(id: string): Promise<StoredPhoto | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_PHOTOS, "readonly");
  const row = await reqAsPromise(tx.objectStore(STORE_PHOTOS).get(id));
  return (row as StoredPhoto | undefined) ?? null;
}

/** Fetch the full-resolution blob for ONE photo. Used by the lightbox
 *  and downloads — never on the grid path. */
export async function getFullBlob(id: string): Promise<Blob | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_BLOBS, "readonly");
  const row = await reqAsPromise(tx.objectStore(STORE_BLOBS).get(id));
  return (row as { blob: Blob } | undefined)?.blob ?? null;
}

interface AddPhotoInput {
  meta: StoredPhoto;
  blob: Blob;
}

/** Insert N photos. Each input carries the full blob + a (possibly null)
 *  thumbnail; we split them across the two stores in a single transaction
 *  so partial writes can't leave a metadata row without its blob. */
export async function addPhotos(items: AddPhotoInput[]): Promise<void> {
  if (items.length === 0) return;
  const db = await openDb();
  const tx = db.transaction([STORE_PHOTOS, STORE_BLOBS], "readwrite");
  const photos = tx.objectStore(STORE_PHOTOS);
  const blobs = tx.objectStore(STORE_BLOBS);
  for (const it of items) {
    photos.put(it.meta);
    blobs.put({ id: it.meta.id, blob: it.blob });
  }
  await awaitTx(tx);
}

/** Patch metadata (favorite, folderId, thumbnail, etc.). Touches only
 *  the small `photos` store. */
export async function updatePhoto(
  id: string,
  patch: Partial<Omit<StoredPhoto, "id">>,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PHOTOS, "readwrite");
  const store = tx.objectStore(STORE_PHOTOS);
  const existing = (await reqAsPromise(store.get(id))) as
    | StoredPhoto
    | undefined;
  if (!existing) return;
  store.put({ ...existing, ...patch });
  await awaitTx(tx);
}

/** Lazy thumbnail backfill for legacy photos that pre-date the v2
 *  schema (no thumbnail yet). Updates both stores in one txn. */
export async function setThumbnail(id: string, thumb: Blob): Promise<void> {
  return updatePhoto(id, { thumbnail: thumb });
}

export async function deletePhoto(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STORE_PHOTOS, STORE_BLOBS], "readwrite");
  tx.objectStore(STORE_PHOTOS).delete(id);
  tx.objectStore(STORE_BLOBS).delete(id);
  await awaitTx(tx);
}

// -- Folders ----------------------------------------------------------------

export async function listFolders(): Promise<StoredFolder[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_FOLDERS, "readonly");
  const items = await reqAsPromise(tx.objectStore(STORE_FOLDERS).getAll());
  return (items as StoredFolder[]).sort((a, b) => a.addedAt - b.addedAt);
}

export async function addFolder(folder: StoredFolder): Promise<void> {
  return addFolders([folder]);
}

/** Bulk-insert folders in a single transaction. Used by folder-import
 *  flows that need every level of a directory tree to commit together —
 *  a one-folder-per-txn loop is both slower and risks leaving an
 *  inconsistent partial tree in IDB if the WebView is killed mid-run. */
export async function addFolders(folders: StoredFolder[]): Promise<void> {
  if (folders.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(STORE_FOLDERS, "readwrite");
  const store = tx.objectStore(STORE_FOLDERS);
  for (const f of folders) store.put(f);
  await awaitTx(tx);
}

export async function updateFolder(
  id: string,
  patch: Partial<Omit<StoredFolder, "id">>,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_FOLDERS, "readwrite");
  const store = tx.objectStore(STORE_FOLDERS);
  const existing = (await reqAsPromise(store.get(id))) as
    | StoredFolder
    | undefined;
  if (!existing) return;
  store.put({ ...existing, ...patch });
  await awaitTx(tx);
}

/** Delete a folder and (recursively) every descendant folder. Photos
 *  inside any of those folders are detached to root (folderId = null) so
 *  no metadata orphans are left behind. The full transitive set of ids
 *  is computed by the caller via `descendantFolderIds` and passed in;
 *  this keeps the IDB transaction tight (no awaits between writes). */
export async function deleteFolders(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  const tx = db.transaction([STORE_FOLDERS, STORE_PHOTOS], "readwrite");
  const folders = tx.objectStore(STORE_FOLDERS);
  const photos = tx.objectStore(STORE_PHOTOS);
  for (const id of ids) folders.delete(id);
  const idSet = new Set(ids);
  const idx = photos.index("folderId");
  for (const id of ids) {
    const cursorReq = idx.openCursor(IDBKeyRange.only(id));
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result;
      if (!cur) return;
      const ph = cur.value as StoredPhoto;
      // Detach to root — the folder (and any ancestor we're deleting)
      // won't exist after the txn commits.
      if (ph.folderId !== null && idSet.has(ph.folderId)) {
        cur.update({ ...ph, folderId: null });
      }
      cur.continue();
    };
  }
  await awaitTx(tx);
}

/** Back-compat alias for the single-folder case. Cascading is the
 *  caller's responsibility — see `deleteFolders` for the bulk path. */
export async function deleteFolder(id: string): Promise<void> {
  return deleteFolders([id]);
}

/** Total bytes of every stored photo — sums the metadata `size` field
 *  (recorded at upload) so we don't need to read blobs to compute it. */
export async function getStorageBytes(): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(STORE_PHOTOS, "readonly");
  const items = await reqAsPromise(tx.objectStore(STORE_PHOTOS).getAll());
  let total = 0;
  for (const p of items as StoredPhoto[]) total += p.size;
  return total;
}
