import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readDir, readFile, stat } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  FolderIcon,
  PhotosIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
} from "../kanban/Icon";
import { StarIcon } from "../scripts/SharedIcons";
import {
  addFolder,
  addFolders,
  addPhotos,
  deleteFolders,
  deletePhoto,
  getFullBlob,
  getStorageBytes,
  listFolders,
  listPhotos,
  setThumbnail,
  updateFolder,
  updatePhoto,
  type StoredFolder,
  type StoredPhoto,
} from "../../lib/photosDb";
import { generateThumbnail } from "../../lib/photoThumbnail";

interface Photo {
  id: string;
  name: string;
  size: number;
  type: string;
  addedAt: number;
  favorite: boolean;
  folderId: string | null;
  /** ObjectURL for the downscaled thumbnail. Null while a background
   *  backfill is still generating one — the tile shows a skeleton in
   *  that window. */
  thumbUrl: string | null;
  /** ObjectURL for the full-resolution blob. Lazily created the first
   *  time the user opens the lightbox / hits Download, then kept until
   *  the photo is deleted. */
  fullUrl: string | null;
}

/** UI view across the top of the gallery — driven by the sidebar nav. */
type View =
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "folder"; folderId: string };

function formatBytes(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatBadge(name: string, type: string) {
  const ext = name.split(".").pop()?.toUpperCase();
  if (ext && ext.length <= 5 && ext !== name.toUpperCase()) return ext;
  const fromMime = type.split("/")[1]?.toUpperCase();
  return fromMime || "IMG";
}

function newId() {
  return (
    (crypto.randomUUID && crypto.randomUUID()) ||
    Math.random().toString(36).slice(2)
  );
}

/** Same monochrome palette graph-groups use — keeps folder tints aligned
 *  with the rest of the app's accent vocabulary. */
const FOLDER_COLORS = [
  "#828c99",
  "#8d9982",
  "#a89882",
  "#a87080",
  "#9382a8",
] as const;

/** Image-extension allow-list shared by every native-path entry point.
 *  Browser-side we filtered on `file.type.startsWith("image/")`, but
 *  bytes read off disk through `@tauri-apps/plugin-fs` carry no MIME, so
 *  we have to gate by extension before reading the blob. */
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
};

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function basename(p: string): string {
  // Native paths come back from Tauri as platform-native strings (back-
  // slashes on Windows). Strip both separators so the same helper works
  // everywhere.
  const trimmed = p.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/** Read a single image file off disk through Tauri's fs plugin and wrap
 *  the bytes in a `File` so the rest of the pipeline (thumbnail gen +
 *  IndexedDB blob store) can stay agnostic to where the bytes came from. */
async function readImageFile(absPath: string): Promise<File | null> {
  try {
    const bytes = await readFile(absPath);
    const name = basename(absPath) || "image";
    // Construct from a fresh ArrayBuffer copy. `readFile` hands back a
    // Uint8Array whose underlying buffer may include padding; slicing
    // through .buffer would expose that to the Blob constructor.
    return new File([new Uint8Array(bytes)], name, {
      type: mimeFromName(name),
    });
  } catch (e) {
    console.error("readImageFile failed", absPath, e);
    return null;
  }
}

/** Folder discovered during a directory walk, used to recreate the
 *  same shape in the sidebar tree. `relPath` is the key the file-side
 *  uses to look up the folder's IDB id at ingest time. */
interface WalkedFolder {
  relPath: string;
  name: string;
  parentRelPath: string | null;
  absPath: string;
}

/** Image file discovered during a directory walk. We collect only the
 *  path + name here — bytes are read later, one batch at a time, so the
 *  whole-folder import never needs to hold every byte in memory. */
interface WalkedFile {
  absPath: string;
  name: string;
  /** rel-path of the directory the file lives in — joins back to a
   *  `WalkedFolder` entry. */
  parentRelPath: string;
}

/** Walk a directory tree off disk and return its shape — every nested
 *  folder, every image inside — WITHOUT reading any image bytes. This
 *  lets the caller plan the IDB-folder layout (and create folders eagerly
 *  so the sidebar updates) before streaming files in batches. */
async function walkFolderTree(
  rootAbs: string,
): Promise<{ folders: WalkedFolder[]; files: WalkedFile[] }> {
  const rootName = basename(rootAbs) || "Imported";
  const folders: WalkedFolder[] = [
    { relPath: rootName, name: rootName, parentRelPath: null, absPath: rootAbs },
  ];
  const files: WalkedFile[] = [];

  async function recurse(absDir: string, relDir: string) {
    let entries: Awaited<ReturnType<typeof readDir>>;
    try {
      entries = await readDir(absDir);
    } catch (e) {
      console.error("readDir failed", absDir, e);
      return;
    }
    for (const ent of entries) {
      const full = `${absDir}/${ent.name}`;
      const rel = `${relDir}/${ent.name}`;
      if (ent.isDirectory) {
        folders.push({
          relPath: rel,
          name: ent.name,
          parentRelPath: relDir,
          absPath: full,
        });
        await recurse(full, rel);
      } else if (ent.isFile && IMAGE_EXT_RE.test(ent.name)) {
        files.push({ absPath: full, name: ent.name, parentRelPath: relDir });
      }
    }
  }
  await recurse(rootAbs, rootName);
  return { folders, files };
}

/** One image to ingest. `source` is either a browser `File` (used by
 *  the "Upload" button — bytes already lazy-loaded by the WebView) or
 *  an absolute on-disk path (used by every Tauri-side entry point —
 *  bytes are streamed in only at the moment we hit the file's batch). */
interface IngestItem {
  source:
    | { kind: "file"; file: File }
    | { kind: "path"; absPath: string; name: string };
  folderId: string | null;
}

/** Progress snapshot for the import overlay. `null` when no import is
 *  active; non-null states render the inline progress UI inside the
 *  toolbar. */
interface UploadProgress {
  done: number;
  total: number;
  label: string;
}

/** Flatten a nested folder list into a DFS-ordered array with depth, so
 *  the "Move to…" dropdown can render the tree as an indented flat list
 *  (popovers don't read well with nested elements). Sort is by creation
 *  order within each parent, matching the sidebar's stable order. */
function flattenFolderTreeForMenu(
  folders: ReadonlyArray<StoredFolder>,
): Array<{ folder: StoredFolder; depth: number }> {
  const byParent = new Map<string | null, StoredFolder[]>();
  const sorted = [...folders].sort((a, b) => a.addedAt - b.addedAt);
  for (const f of sorted) {
    const arr = byParent.get(f.parentId) ?? [];
    arr.push(f);
    byParent.set(f.parentId, arr);
  }
  const out: Array<{ folder: StoredFolder; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of byParent.get(parentId) ?? []) {
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function PhotosScreen() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [folders, setFolders] = useState<StoredFolder[]>([]);
  const [view, setView] = useState<View>({ kind: "all" });
  const [dragOver, setDragOver] = useState(false);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [storageBytes, setStorageBytes] = useState(0);
  const [creatingFolder, setCreatingFolder] = useState(false);
  // Folder-creation modal — `parent` is the prospective parent id (null
  // for top-level). Driven by the "+" buttons in the sidebar tree.
  const [creatingFolderParent, setCreatingFolderParent] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  // Which folders the user has expanded in the sidebar tree. Default
  // collapsed so a 20-folder tree doesn't blast the rail with rows.
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  // Streaming-upload progress shown above the gallery while a folder
  // import / large drop is being ingested.
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Column count is recomputed from the scroller's content width and mirrors
  // the CSS auto-fill formula (`minmax(180px, 1fr)` with a 14 px gap), so the
  // virtualized layout matches the look of the non-virtualized one pixel-for-
  // pixel at any window width.
  const [colCount, setColCount] = useState(4);

  // -- Track the column count of the virtualized grid so it matches the
  //    CSS auto-fill formula at every viewport size. The scroller has 32 px
  //    of horizontal padding on each side; available content width is
  //    `clientWidth - 64`. With a 180 px min tile and 14 px gap, the column
  //    count is `floor((W + gap) / (tile + gap))` — same arithmetic that
  //    `grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))` does
  //    internally.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const PAD_X = 64;
    const MIN_TILE = 180;
    const GAP = 14;
    const compute = () => {
      const w = Math.max(0, el.clientWidth - PAD_X);
      const cols = Math.max(1, Math.floor((w + GAP) / (MIN_TILE + GAP)));
      setColCount((prev) => (prev === cols ? prev : cols));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // -- Initial load from IndexedDB. Reads only thumbnails + metadata —
  //    full-resolution blobs stay on disk until the lightbox / download
  //    asks for them. With 1k+ photos at ~2 MB each, this is the single
  //    biggest perf win: startup memory stays tens of MB, not multiple
  //    GB.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [storedPhotos, storedFolders, bytes] = await Promise.all([
        listPhotos(),
        listFolders(),
        getStorageBytes(),
      ]);
      if (cancelled) return;
      const hydrated: Photo[] = storedPhotos.map((p) => ({
        id: p.id,
        name: p.name,
        size: p.size,
        type: p.type,
        addedAt: p.addedAt,
        favorite: p.favorite,
        folderId: p.folderId,
        // Pre-existing thumbnail → instant render. Otherwise null, and the
        // backfill effect below fills it in batches.
        thumbUrl: p.thumbnail ? URL.createObjectURL(p.thumbnail) : null,
        fullUrl: null,
      }));
      setPhotos(hydrated);
      setFolders(storedFolders);
      setStorageBytes(bytes);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // -- Component-unmount cleanup: revoke every live ObjectURL. Per-delete
  //    revokes still handle the steady-state case; this catches the URLs
  //    that survived all the way to navigation.
  useEffect(() => {
    return () => {
      for (const p of photos) {
        if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl);
        if (p.fullUrl) URL.revokeObjectURL(p.fullUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- Background thumbnail backfill for photos imported under the v1
  //    schema (no thumbnail yet). Walks the gallery one photo at a time
  //    so the main thread stays free for scroll / clicks. Batched at
  //    ~6 thumbs/sec via a small delay between iterations.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Snapshot ids needing a thumbnail; we re-check live state inside the
      // loop so freshly-uploaded photos (already thumbed) get skipped.
      const ids = photos.filter((p) => !p.thumbUrl).map((p) => p.id);
      for (const id of ids) {
        if (cancelled) return;
        const blob = await getFullBlob(id);
        if (!blob || cancelled) continue;
        const thumb = await generateThumbnail(blob);
        if (!thumb || cancelled) continue;
        try {
          await setThumbnail(id, thumb);
        } catch (e) {
          console.error("setThumbnail failed", e);
        }
        if (cancelled) return;
        const url = URL.createObjectURL(thumb);
        setPhotos((curr) =>
          curr.map((p) => {
            if (p.id !== id) return p;
            // If a thumbUrl appeared between snapshot and now (e.g. user
            // re-uploaded), drop ours so we don't leak.
            if (p.thumbUrl) {
              URL.revokeObjectURL(url);
              return p;
            }
            return { ...p, thumbUrl: url };
          }),
        );
        // 150ms breather between thumbs — keeps the main thread responsive
        // for scroll while still backfilling ~6/sec.
        await new Promise((r) => setTimeout(r, 150));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-run when the photo list changes shape (count or ids) so newly-
    // imported photos that arrive without thumbs also get filled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length]);

  const favoritesCount = useMemo(
    () => photos.filter((p) => p.favorite).length,
    [photos],
  );
  const folderCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of photos) {
      if (!p.folderId) continue;
      m.set(p.folderId, (m.get(p.folderId) ?? 0) + 1);
    }
    return m;
  }, [photos]);

  /** Group folders by their parentId so the sidebar tree can render each
   *  level in a single hop. `null` key holds the top-level row set. */
  const folderChildren = useMemo(() => {
    const m = new Map<string | null, StoredFolder[]>();
    // Stable order = creation order (`addedAt`), matching the flat layout
    // we shipped before nesting existed.
    const sorted = [...folders].sort((a, b) => a.addedAt - b.addedAt);
    for (const f of sorted) {
      const arr = m.get(f.parentId) ?? [];
      arr.push(f);
      m.set(f.parentId, arr);
    }
    return m;
  }, [folders]);

  /** Total photo count for a folder INCLUDING every descendant — the
   *  number shown next to a collapsed branch should reflect everything
   *  the branch contains, not just direct children. */
  const folderSubtreeCounts = useMemo(() => {
    const direct = folderCounts;
    const out = new Map<string, number>();
    // Iterate leaves-up so each parent can sum already-computed children.
    // Build a reverse adjacency from `folderChildren` and recurse via DFS
    // memoized through `out`.
    const computed = new Set<string>();
    const visit = (id: string): number => {
      const cached = out.get(id);
      if (cached !== undefined) return cached;
      let sum = direct.get(id) ?? 0;
      for (const child of folderChildren.get(id) ?? []) {
        sum += visit(child.id);
      }
      out.set(id, sum);
      computed.add(id);
      return sum;
    };
    for (const f of folders) visit(f.id);
    return out;
  }, [folderCounts, folderChildren, folders]);

  const visible = useMemo(() => {
    switch (view.kind) {
      case "favorites":
        return photos.filter((p) => p.favorite);
      case "folder":
        return photos.filter((p) => p.folderId === view.folderId);
      case "all":
      default:
        return photos;
    }
  }, [photos, view]);

  const activeFolder =
    view.kind === "folder"
      ? folders.find((f) => f.id === view.folderId) ?? null
      : null;

  const lightboxIdx = lightboxId
    ? visible.findIndex((p) => p.id === lightboxId)
    : -1;
  const lightboxPhoto = lightboxIdx >= 0 ? visible[lightboxIdx] : null;

  // -- Grid virtualization. Without this, mounting 1400 PhotoTile components
  //    at once costs hundreds of ms on first paint and turns every scroll
  //    frame into a layout-thrash storm. The virtualizer keeps the DOM at
  //    ~`(visibleRows + 2 * overscan) * cols` tiles regardless of total
  //    photo count, which collapses startup, scroll cost, and the standing
  //    ObjectURL footprint that the GC was previously pinning. Row stride
  //    (220) = 160 preview + 6 inner gap + ~17 name + 6 inner gap + ~16 sub
  //    + 14 inter-row gap; if `.ph-tile` ever changes shape, update this
  //    constant alongside the CSS.
  const ROW_STRIDE = 220;
  const rowCount = Math.max(1, Math.ceil(visible.length / colCount));
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_STRIDE,
    overscan: 4,
  });

  /** Switching views clears the selection so a dangling selection from a
   *  hidden photo can't survive into a multi-delete on the new view. */
  useEffect(() => {
    setSelectedIds(new Set());
  }, [view.kind, view.kind === "folder" ? view.folderId : null]);

  /** Core ingest pipeline. Runs `CONCURRENCY` workers in parallel, each
   *  pulling one item at a time off `items` and feeding the finished
   *  Photo / StoredPhoto pair into a debounced flush queue. The user-
   *  visible effects of this design — and the reason we don't just
   *  prepare in fixed batches anymore — are:
   *
   *  - **Progress ticks per file, not per batch.** A 1400-photo run
   *    moves the indicator ~5–10×/sec instead of once every few seconds.
   *    With the old per-batch model the user thought the import had
   *    hung (no indicator updates for the duration of a 10-photo
   *    decode pass) and reloaded the page mid-run.
   *  - **Tiles appear in the gallery as they're decoded.** The flush
   *    queue pushes accumulated photos into React state every 200 ms
   *    OR every 8 photos (whichever comes first), so the grid fills
   *    progressively instead of staying empty until the whole import
   *    finishes.
   *  - **Memory stays bounded.** Concurrency caps how many full-res
   *    Blobs are alive at once; once a flush hands them to IndexedDB
   *    they drop out of JS heap on the next GC pass.
   */
  const streamIngest = useCallback(
    async (items: IngestItem[], label: string) => {
      if (items.length === 0) return;
      const CONCURRENCY = 3;
      const FLUSH_MS = 200;
      const FLUSH_N = 8;

      // `setTimeout(0)` lands on the macrotask queue, which React's
      // scheduler drains AFTER queued renders — so by the time it
      // resolves the latest setState has painted. Used to give the
      // progress bar a chance to appear before the CPU pass starts,
      // and again whenever the flush queue commits.
      const yieldToBrowser = () =>
        new Promise<void>((resolve) => setTimeout(resolve, 0));

      let done = 0;
      const total = items.length;
      setUploadProgress({ done: 0, total, label });
      await yieldToBrowser();

      let pendingCreated: Photo[] = [];
      let pendingStore: Array<{ meta: StoredPhoto; blob: Blob }> = [];
      let pendingBytes = 0;
      let lastFlushAt = Date.now();

      const flush = async (force: boolean) => {
        const enoughItems = pendingCreated.length >= FLUSH_N;
        const enoughTime = Date.now() - lastFlushAt >= FLUSH_MS;
        if (!force && !enoughItems && !enoughTime) return;
        if (pendingCreated.length === 0) return;
        const created = pendingCreated;
        const toStore = pendingStore;
        const bytes = pendingBytes;
        pendingCreated = [];
        pendingStore = [];
        pendingBytes = 0;
        lastFlushAt = Date.now();
        setPhotos((prev) => [...created, ...prev]);
        if (bytes > 0) setStorageBytes((b) => b + bytes);
        try {
          await addPhotos(toStore);
        } catch (e) {
          console.error("addPhotos failed", e);
        }
        // Yield so the new tiles paint before we resume decoding.
        await yieldToBrowser();
      };

      let cursor = 0;
      const runWorker = async () => {
        while (cursor < items.length) {
          const idx = cursor++;
          const it = items[idx];
          let file: File | null = null;
          if (it.source.kind === "file") {
            file = it.source.file;
          } else {
            file = await readImageFile(it.source.absPath);
          }
          if (file) {
            const thumb = await generateThumbnail(file);
            const id = newId();
            const addedAt = Date.now();
            pendingCreated.push({
              id,
              name: file.name,
              size: file.size,
              type: file.type,
              addedAt,
              favorite: false,
              folderId: it.folderId,
              thumbUrl: thumb ? URL.createObjectURL(thumb) : null,
              fullUrl: null,
            });
            pendingStore.push({
              meta: {
                id,
                name: file.name,
                size: file.size,
                type: file.type,
                addedAt,
                favorite: false,
                folderId: it.folderId,
                thumbnail: thumb,
              },
              blob: file,
            });
            pendingBytes += file.size;
          }
          done++;
          setUploadProgress({ done, total, label });
          await flush(false);
        }
      };

      try {
        await Promise.all(
          Array.from({ length: CONCURRENCY }, () => runWorker()),
        );
        await flush(true);
      } finally {
        setUploadProgress(null);
      }
    },
    [],
  );

  /** Browser-side entry point (used by the "Upload" file input). Files
   *  are already lazy-loaded by the WebView, so we route them straight
   *  through `streamIngest` as file-sourced items — batching still
   *  matters because each batch holds the decoded thumbnail canvas
   *  buffer for the items being processed. */
  const addFiles = useCallback(
    async (files: FileList | File[], targetFolderId?: string | null) => {
      const incoming = Array.from(files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (!incoming.length) return;
      const folderId =
        targetFolderId !== undefined
          ? targetFolderId
          : view.kind === "folder"
            ? view.folderId
            : null;
      const items: IngestItem[] = incoming.map((f) => ({
        source: { kind: "file", file: f },
        folderId,
      }));
      await streamIngest(items, `Uploading ${incoming.length} photo${incoming.length === 1 ? "" : "s"}…`);
    },
    [view, streamIngest],
  );

  /** Pick a fresh, non-conflicting name within a given parent folder.
   *  Folders nest, so the uniqueness check is scoped to siblings of the
   *  same parent — two top-level "Album"s would clash but "A/sub" and
   *  "B/sub" are fine. */
  const uniqueSiblingName = useCallback(
    (
      desired: string,
      parentId: string | null,
      siblings: ReadonlyArray<StoredFolder>,
    ) => {
      const taken = new Set(
        siblings
          .filter((f) => f.parentId === parentId)
          .map((f) => f.name),
      );
      if (!taken.has(desired)) return desired;
      let n = 2;
      while (taken.has(`${desired} (${n})`)) n++;
      return `${desired} (${n})`;
    },
    [],
  );

  /** Import a walked directory tree: creates the matching folder hierarchy
   *  in IDB (top-level name deduped against existing siblings), then
   *  streams every image into the correct sub-folder via `streamIngest`.
   *  Called from both the "Upload folder" button and folder drag-drops.
   */
  const importWalkedTree = useCallback(
    async (tree: { folders: WalkedFolder[]; files: WalkedFile[] }) => {
      if (tree.files.length === 0 && tree.folders.length <= 1) return;

      // Plan: assign IDs to every walked folder, mapped by relPath. Build
      // the StoredFolder records with parentId wired through the same map.
      const idByRelPath = new Map<string, string>();
      // Dedup only the root-level walked folder against existing top-level
      // siblings; nested folders carry the user-chosen subfolder names as-is.
      const planned: StoredFolder[] = [];
      const baseColorOffset = folders.length;
      tree.folders.forEach((wf, idx) => {
        const id = newId();
        idByRelPath.set(wf.relPath, id);
        let name = wf.name;
        if (wf.parentRelPath === null) {
          name = uniqueSiblingName(name, null, folders);
        }
        planned.push({
          id,
          name,
          color: FOLDER_COLORS[(baseColorOffset + idx) % FOLDER_COLORS.length],
          addedAt: Date.now() + idx, // preserve walk order in sort
          parentId: wf.parentRelPath
            ? idByRelPath.get(wf.parentRelPath) ?? null
            : null,
        });
      });

      // Apply folder creates: update React state up-front so the sidebar
      // tree appears instantly, then commit them all in a single IDB
      // transaction so a partial tree never survives across reloads
      // (which is what made deep imports look like "subfolders disappear
      // on refresh" — the per-folder loop occasionally bailed midway).
      setFolders((curr) => [...curr, ...planned]);
      setExpandedFolders((curr) => {
        const next = new Set(curr);
        for (const pf of planned) next.add(pf.id);
        return next;
      });
      try {
        await addFolders(planned);
      } catch (e) {
        console.error("addFolders failed", e);
      }

      // Switch to the new root folder so the user lands inside the import.
      const rootId = planned[0]?.id;
      if (rootId) setView({ kind: "folder", folderId: rootId });

      // Stream files in, mapping each file's parent rel-path to its
      // freshly-minted folder id.
      const items: IngestItem[] = tree.files.map((f) => ({
        source: { kind: "path", absPath: f.absPath, name: f.name },
        folderId: idByRelPath.get(f.parentRelPath) ?? rootId ?? null,
      }));
      const rootName = planned[0]?.name ?? "folder";
      await streamIngest(
        items,
        `Importing ${tree.files.length} photo${tree.files.length === 1 ? "" : "s"} from "${rootName}"…`,
      );
    },
    [folders, streamIngest, uniqueSiblingName],
  );

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) void addFiles(e.target.files);
    e.target.value = "";
  };

  /**
   * Open the Tauri folder picker, walk the chosen directory through the fs
   * plugin, then hand the result to `importFolder`. The older HTML5 path
   * (`<input webkitdirectory>`) was unreliable inside WebView2 — the dialog
   * sometimes opened in plain-file mode, and even when a folder was picked
   * the per-entry `webkitRelativePath` was empty often enough that the
   * importer lost the root name. Going through the OS dialog directly side-
   * steps both pitfalls.
   */
  const onClickFolderUpload = useCallback(async () => {
    let picked: string | string[] | null;
    try {
      picked = await openDialog({ directory: true, multiple: false });
    } catch (e) {
      console.error("folder dialog failed", e);
      return;
    }
    if (typeof picked !== "string") return;
    const tree = await walkFolderTree(picked);
    if (tree.files.length === 0) return;
    await importWalkedTree(tree);
  }, [importWalkedTree]);

  // -- Latest closures accessible to the drag-drop listener without
  //    re-subscribing. The listener is mounted once and reads through
  //    these refs, so closures pick up the freshest view / folders
  //    state every drop. Re-subscribing on every dep change would tear
  //    down and rebuild the OS-level event hook constantly.
  const addFilesRef = useRef(addFiles);
  const importWalkedTreeRef = useRef(importWalkedTree);
  const streamIngestRef = useRef(streamIngest);
  const currentFolderIdRef = useRef<string | null>(null);
  useEffect(() => {
    addFilesRef.current = addFiles;
    importWalkedTreeRef.current = importWalkedTree;
    streamIngestRef.current = streamIngest;
    currentFolderIdRef.current =
      view.kind === "folder" ? view.folderId : null;
  }, [addFiles, importWalkedTree, streamIngest, view]);

  /** Drop handler: stat every dropped path to split dirs from loose
   *  files, then walk dirs lazily and ingest. Dirs become nested
   *  sidebar-folder trees; loose files land in whatever view is currently
   *  open (or root). */
  const handleDroppedPaths = useCallback(async (paths: string[]) => {
    const dirs: string[] = [];
    const looseAbsPaths: string[] = [];
    for (const p of paths) {
      try {
        const info = await stat(p);
        if (info.isDirectory) {
          dirs.push(p);
        } else if (info.isFile && IMAGE_EXT_RE.test(p)) {
          looseAbsPaths.push(p);
        }
      } catch (e) {
        console.error("stat failed", p, e);
      }
    }
    // One sidebar folder-tree per dropped directory.
    for (const d of dirs) {
      const tree = await walkFolderTree(d);
      if (tree.files.length > 0) await importWalkedTreeRef.current(tree);
    }
    // Loose files: stream straight in, no folder creation. We funnel
    // them through `streamIngest` directly so each file is read off
    // disk only at the moment its batch is processed.
    if (looseAbsPaths.length > 0) {
      // Build IngestItem[] from absolute paths so `streamIngest` can
      // read bytes one batch at a time. Going through `addFilesRef`
      // would force us to materialize every File up-front, defeating
      // the streaming purpose.
      const items: IngestItem[] = looseAbsPaths.map((p) => ({
        source: { kind: "path", absPath: p, name: basename(p) },
        folderId: currentFolderIdRef.current,
      }));
      await streamIngestRef.current(
        items,
        `Uploading ${items.length} photo${items.length === 1 ? "" : "s"}…`,
      );
    }
  }, []);

  /**
   * Native Tauri drag-drop listener. With `dragDropEnabled: true` in
   * tauri.conf.json, OS-level file drops no longer reach the WebView as
   * HTML5 DragEvents — instead Tauri emits an event with absolute file
   * paths, which works the same for loose files and folders. This is the
   * only reliable path on Windows WebView2: the HTML5 `webkitGetAsEntry`
   * surface was empirically returning bogus directory entries for OS drops,
   * which is what made every drop look like "a folder was added, not the
   * files inside".
   */
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const webview = getCurrentWebview();
        const u = await webview.onDragDropEvent((ev) => {
          const payload = ev.payload;
          if (payload.type === "enter" || payload.type === "over") {
            setDragOver(true);
          } else if (payload.type === "leave") {
            setDragOver(false);
          } else if (payload.type === "drop") {
            setDragOver(false);
            void handleDroppedPaths(payload.paths);
          }
        });
        if (cancelled) u();
        else unlisten = u;
      } catch (e) {
        console.error("onDragDropEvent subscribe failed", e);
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [handleDroppedPaths]);

  const onDelete = useCallback(
    async (id: string) => {
      const target = photos.find((p) => p.id === id);
      setPhotos((prev) => prev.filter((p) => p.id !== id));
      if (target) {
        if (target.thumbUrl) URL.revokeObjectURL(target.thumbUrl);
        if (target.fullUrl) URL.revokeObjectURL(target.fullUrl);
        setStorageBytes((b) => Math.max(0, b - target.size));
      }
      setSelectedIds((s) => {
        if (!s.has(id)) return s;
        const next = new Set(s);
        next.delete(id);
        return next;
      });
      if (lightboxId === id) setLightboxId(null);
      try {
        await deletePhoto(id);
      } catch (e) {
        console.error("deletePhoto failed", e);
      }
    },
    [photos, lightboxId],
  );

  /**
   * Ensure the full-resolution ObjectURL exists for one photo. Used by the
   * lightbox and the download button — fetches the blob from the separate
   * `photo_blobs` store and caches the URL on the photo so subsequent
   * opens of the same image are instant. */
  const ensureFullUrl = useCallback(
    async (id: string): Promise<string | null> => {
      const cached = photos.find((p) => p.id === id)?.fullUrl;
      if (cached) return cached;
      const blob = await getFullBlob(id);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      setPhotos((curr) =>
        curr.map((p) => {
          if (p.id !== id) return p;
          // Race guard: if another caller filled fullUrl between our read
          // and now, discard ours so we don't leak.
          if (p.fullUrl) {
            URL.revokeObjectURL(url);
            return p;
          }
          return { ...p, fullUrl: url };
        }),
      );
      return url;
    },
    [photos],
  );

  const onDownload = async (p: Photo) => {
    const url = p.fullUrl ?? (await ensureFullUrl(p.id));
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = p.name;
    a.click();
  };

  // -- Eagerly hydrate the full blob whenever lightbox shows a photo
  //    without one. Keeps the lightbox snappy — by the time the user has
  //    finished the open animation, the image is ready. */
  useEffect(() => {
    if (!lightboxId) return;
    const p = photos.find((x) => x.id === lightboxId);
    if (!p || p.fullUrl) return;
    void ensureFullUrl(lightboxId);
  }, [lightboxId, photos, ensureFullUrl]);

  const onToggleFavorite = async (id: string) => {
    setPhotos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)),
    );
    const next = photos.find((p) => p.id === id);
    if (!next) return;
    try {
      await updatePhoto(id, { favorite: !next.favorite });
    } catch (e) {
      console.error("updatePhoto favorite failed", e);
    }
  };

  const onMoveTo = async (id: string, folderId: string | null) => {
    setPhotos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, folderId } : p)),
    );
    try {
      await updatePhoto(id, { folderId });
    } catch (e) {
      console.error("updatePhoto folder failed", e);
    }
  };

  // -- Multi-select ---------------------------------------------------------

  const toggleSelect = (id: string, range?: boolean) => {
    setSelectedIds((curr) => {
      const next = new Set(curr);
      if (range) {
        // shift-click — select every photo between the most-recent click
        // and this one in current visible order. Cheap, no anchor tracking.
        const idxA = visible.findIndex((p) => next.has(p.id));
        const idxB = visible.findIndex((p) => p.id === id);
        if (idxA >= 0 && idxB >= 0) {
          const [from, to] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
          for (let i = from; i <= to; i++) next.add(visible[i].id);
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const deleteSelected = async () => {
    const ids = Array.from(selectedIds);
    for (const id of ids) await onDelete(id);
    clearSelection();
  };

  const favoriteSelected = async () => {
    const ids = Array.from(selectedIds);
    for (const id of ids) await onToggleFavorite(id);
  };

  const moveSelectedTo = async (folderId: string | null) => {
    const ids = Array.from(selectedIds);
    for (const id of ids) await onMoveTo(id, folderId);
    clearSelection();
  };

  // -- Folders --------------------------------------------------------------

  const submitFolder = async () => {
    const name = folderDraft.trim();
    const parentId = creatingFolderParent;
    setCreatingFolder(false);
    setCreatingFolderParent(null);
    setFolderDraft("");
    if (!name) return;
    const folder: StoredFolder = {
      id: newId(),
      name: uniqueSiblingName(name, parentId, folders),
      color: FOLDER_COLORS[folders.length % FOLDER_COLORS.length],
      addedAt: Date.now(),
      parentId,
    };
    setFolders((f) => [...f, folder]);
    // Auto-expand the parent so the new child is visible immediately.
    if (parentId) {
      setExpandedFolders((s) => {
        if (s.has(parentId)) return s;
        const next = new Set(s);
        next.add(parentId);
        return next;
      });
    }
    try {
      await addFolder(folder);
    } catch (e) {
      console.error("addFolder failed", e);
    }
  };

  const renameFolder = async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setFolders((f) =>
      f.map((x) => (x.id === id ? { ...x, name: trimmed } : x)),
    );
    try {
      await updateFolder(id, { name: trimmed });
    } catch (e) {
      console.error("updateFolder failed", e);
    }
  };

  /** Collect a folder and every descendant in the tree. Used to cascade
   *  delete and to keep the active view from pointing at a folder that's
   *  about to vanish. */
  const collectFolderSubtree = useCallback(
    (rootId: string, all: ReadonlyArray<StoredFolder>): string[] => {
      const childrenByParent = new Map<string | null, StoredFolder[]>();
      for (const f of all) {
        const arr = childrenByParent.get(f.parentId) ?? [];
        arr.push(f);
        childrenByParent.set(f.parentId, arr);
      }
      const out: string[] = [];
      const stack: string[] = [rootId];
      while (stack.length) {
        const id = stack.pop()!;
        out.push(id);
        const kids = childrenByParent.get(id);
        if (kids) for (const k of kids) stack.push(k.id);
      }
      return out;
    },
    [],
  );

  const removeFolder = async (id: string) => {
    const ids = collectFolderSubtree(id, folders);
    const idSet = new Set(ids);
    setFolders((f) => f.filter((x) => !idSet.has(x.id)));
    setPhotos((p) =>
      p.map((x) =>
        x.folderId && idSet.has(x.folderId) ? { ...x, folderId: null } : x,
      ),
    );
    if (view.kind === "folder" && idSet.has(view.folderId)) {
      setView({ kind: "all" });
    }
    setExpandedFolders((s) => {
      let changed = false;
      const next = new Set(s);
      for (const fid of ids) if (next.delete(fid)) changed = true;
      return changed ? next : s;
    });
    try {
      await deleteFolders(ids);
    } catch (e) {
      console.error("deleteFolders failed", e);
    }
  };

  // -- Lightbox keyboard ----------------------------------------------------

  useEffect(() => {
    if (!lightboxPhoto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxId(null);
      if (e.key === "ArrowLeft" && lightboxIdx > 0)
        setLightboxId(visible[lightboxIdx - 1].id);
      if (e.key === "ArrowRight" && lightboxIdx < visible.length - 1)
        setLightboxId(visible[lightboxIdx + 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxPhoto, lightboxIdx, visible]);

  const viewLabel =
    view.kind === "favorites"
      ? "Favorites"
      : view.kind === "folder"
        ? activeFolder?.name ?? "Folder"
        : "All photos";

  const hasSelection = selectedIds.size > 0;

  return (
    <main className="main photos-screen">
      <div className="ph-screen">
        <aside className="ph-sidebar">
          <div className="ph-sidebar-head">
            <span className="ph-sidebar-title">Photos</span>
            <span className="ph-sidebar-count">{photos.length}</span>
          </div>

          <nav className="ph-sidebar-nav">
            <button
              type="button"
              className={
                "ph-side-row" + (view.kind === "all" ? " is-active" : "")
              }
              onClick={() => setView({ kind: "all" })}
            >
              <PhotosIcon size={16} />
              <span className="ph-side-label">All photos</span>
              <span className="ph-side-count">{photos.length}</span>
            </button>
            <button
              type="button"
              className={
                "ph-side-row" + (view.kind === "favorites" ? " is-active" : "")
              }
              onClick={() => setView({ kind: "favorites" })}
            >
              <StarIcon size={16} />
              <span className="ph-side-label">Favorites</span>
              <span className="ph-side-count">{favoritesCount}</span>
            </button>

            <div className="ph-side-section">
              <span>FOLDERS</span>
              <button
                type="button"
                className="ph-side-section-add"
                onClick={() => {
                  setCreatingFolder(true);
                  setCreatingFolderParent(null);
                  setFolderDraft("");
                }}
                title="New folder"
                aria-label="New folder"
              >
                <PlusIcon size={12} />
              </button>
            </div>

            {folders.length === 0 && !creatingFolder && (
              <div className="ph-side-empty">No folders yet</div>
            )}

            <FolderTree
              parentId={null}
              depth={0}
              childrenByParent={folderChildren}
              expanded={expandedFolders}
              activeFolderId={
                view.kind === "folder" ? view.folderId : null
              }
              subtreeCounts={folderSubtreeCounts}
              creatingFolder={creatingFolder}
              creatingFolderParent={creatingFolderParent}
              folderDraft={folderDraft}
              onToggleExpand={(id) =>
                setExpandedFolders((s) => {
                  const next = new Set(s);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onOpen={(id) => setView({ kind: "folder", folderId: id })}
              onRename={(id, name) => void renameFolder(id, name)}
              onDelete={(id) => void removeFolder(id)}
              onAddChild={(id) => {
                setCreatingFolder(true);
                setCreatingFolderParent(id);
                setFolderDraft("");
                setExpandedFolders((s) => {
                  if (s.has(id)) return s;
                  const next = new Set(s);
                  next.add(id);
                  return next;
                });
              }}
              onSubmitNew={() => void submitFolder()}
              onCancelNew={() => {
                setCreatingFolder(false);
                setCreatingFolderParent(null);
                setFolderDraft("");
              }}
              onDraftChange={(v) => setFolderDraft(v)}
            />

            {creatingFolder && creatingFolderParent === null && (
              <input
                className="ph-side-folder-input"
                autoFocus
                value={folderDraft}
                onChange={(e) => setFolderDraft(e.target.value)}
                onBlur={() => void submitFolder()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitFolder();
                  if (e.key === "Escape") {
                    setCreatingFolder(false);
                    setCreatingFolderParent(null);
                    setFolderDraft("");
                  }
                }}
                placeholder="Folder name…"
                spellCheck={false}
              />
            )}
          </nav>

          <div className="ph-sidebar-foot">
            <span className="ph-sidebar-foot-label">Local storage</span>
            <span className="ph-sidebar-foot-value">
              {formatBytes(storageBytes)}
            </span>
          </div>
        </aside>

        <section
          className={
            "ph-main" +
            (dragOver ? " is-drag" : "") +
            (uploadProgress ? " is-uploading" : "")
          }
        >
          <div className="ph-main-topbar">
            <span className="ph-crumb">Photos</span>
            <span className="ph-crumb-sep">›</span>
            <span className="ph-crumb is-current">{viewLabel}</span>
            <span className="ph-spacer" />
            {uploadProgress ? (
              <InlineUploadProgress progress={uploadProgress} />
            ) : (
              <>
                <button
                  className="ph-upload-btn ph-upload-btn-secondary"
                  type="button"
                  onClick={() => void onClickFolderUpload()}
                  title="Pick a folder — every image inside (recursive) gets imported into a new sidebar folder"
                >
                  <FolderIcon size={14} />
                  <span>Upload folder</span>
                </button>
                <button
                  className="ph-upload-btn"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadIcon size={14} />
                  <span>Upload</span>
                </button>
              </>
            )}
          </div>
          {uploadProgress && (
            <div
              className="ph-upload-progress-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={uploadProgress.total}
              aria-valuenow={uploadProgress.done}
            >
              <div
                className="ph-upload-progress-bar-fill"
                style={{
                  width:
                    uploadProgress.total > 0
                      ? `${(uploadProgress.done / uploadProgress.total) * 100}%`
                      : "0%",
                }}
              />
            </div>
          )}

          {hasSelection && (
            <SelectionBar
              count={selectedIds.size}
              folders={folders}
              activeFolderId={
                view.kind === "folder" ? view.folderId : null
              }
              onClear={clearSelection}
              onDelete={() => void deleteSelected()}
              onFavorite={() => void favoriteSelected()}
              onMoveTo={(id) => void moveSelectedTo(id)}
            />
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={onPick}
          />

          <div className="ph-main-body" ref={scrollRef}>
            {visible.length === 0 ? (
              <div
                className="ph-empty"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="ph-empty-icon">
                  <PhotosIcon size={32} />
                </div>
                <div className="ph-empty-title">
                  {view.kind === "favorites"
                    ? "No favorites yet"
                    : view.kind === "folder"
                      ? "This folder is empty"
                      : "Drop photos here"}
                </div>
                <div className="ph-empty-sub">
                  {view.kind === "favorites" ? (
                    <>Star photos to keep them here</>
                  ) : (
                    <>
                      or{" "}
                      <span className="ph-empty-link">click to browse</span> ·
                      PNG, JPG, WebP, GIF
                    </>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="ph-section-head">
                  <span className="ph-section-title">{viewLabel}</span>
                  <span className="ph-section-count">{visible.length}</span>
                </div>
                <div
                  className="ph-grid-virt"
                  style={{
                    position: "relative",
                    width: "100%",
                    height: rowVirtualizer.getTotalSize(),
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((row) => {
                    const start = row.index * colCount;
                    const slice = visible.slice(start, start + colCount);
                    return (
                      <div
                        key={row.key}
                        className="ph-grid-row"
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${row.start}px)`,
                          display: "grid",
                          gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
                          gap: "14px",
                        }}
                      >
                        {slice.map((p) => (
                          <PhotoTile
                            key={p.id}
                            photo={p}
                            selected={selectedIds.has(p.id)}
                            onOpen={() => setLightboxId(p.id)}
                            onSelectToggle={(range) => toggleSelect(p.id, range)}
                            onToggleFavorite={() => void onToggleFavorite(p.id)}
                            onDownload={() => onDownload(p)}
                            onDelete={() => void onDelete(p.id)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {dragOver && (
            <div className="ph-drop-overlay">
              <div className="ph-drop-card">
                <UploadIcon size={28} />
                <div>Drop to upload</div>
              </div>
            </div>
          )}
        </section>
      </div>

      {lightboxPhoto && (
        <Lightbox
          photo={lightboxPhoto}
          hasPrev={lightboxIdx > 0}
          hasNext={lightboxIdx < visible.length - 1}
          onPrev={() =>
            lightboxIdx > 0 && setLightboxId(visible[lightboxIdx - 1].id)
          }
          onNext={() =>
            lightboxIdx < visible.length - 1 &&
            setLightboxId(visible[lightboxIdx + 1].id)
          }
          onClose={() => setLightboxId(null)}
          onDelete={() => void onDelete(lightboxPhoto.id)}
          onDownload={() => onDownload(lightboxPhoto)}
        />
      )}
    </main>
  );
}

interface FolderTreeBaseProps {
  childrenByParent: Map<string | null, StoredFolder[]>;
  expanded: Set<string>;
  activeFolderId: string | null;
  subtreeCounts: Map<string, number>;
  creatingFolder: boolean;
  creatingFolderParent: string | null;
  folderDraft: string;
  onToggleExpand: (id: string) => void;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onAddChild: (id: string) => void;
  onSubmitNew: () => void;
  onCancelNew: () => void;
  onDraftChange: (v: string) => void;
}

/** Recursive sidebar tree. `parentId === null` renders the top-level
 *  branch; each row recurses into its children only when expanded, so a
 *  10-deep import doesn't blow up the DOM until the user actually drills
 *  in. The shared `creatingFolder*` state lets ONE inline-create input
 *  hang underneath whichever row the user clicked "+" on. */
function FolderTree(
  props: FolderTreeBaseProps & { parentId: string | null; depth: number },
) {
  const kids = props.childrenByParent.get(props.parentId) ?? [];
  if (kids.length === 0) return null;
  return (
    <>
      {kids.map((f) => {
        const isExpanded = props.expanded.has(f.id);
        const hasChildren =
          (props.childrenByParent.get(f.id) ?? []).length > 0;
        return (
          <div key={f.id}>
            <FolderRow
              folder={f}
              depth={props.depth}
              isActive={props.activeFolderId === f.id}
              count={props.subtreeCounts.get(f.id) ?? 0}
              hasChildren={hasChildren}
              isExpanded={isExpanded}
              onToggleExpand={() => props.onToggleExpand(f.id)}
              onOpen={() => props.onOpen(f.id)}
              onRename={(name) => props.onRename(f.id, name)}
              onDelete={() => props.onDelete(f.id)}
              onAddChild={() => props.onAddChild(f.id)}
            />
            {isExpanded && hasChildren && (
              <FolderTree
                {...props}
                parentId={f.id}
                depth={props.depth + 1}
              />
            )}
            {isExpanded &&
              props.creatingFolder &&
              props.creatingFolderParent === f.id && (
                <input
                  className="ph-side-folder-input is-inline"
                  autoFocus
                  value={props.folderDraft}
                  onChange={(e) => props.onDraftChange(e.target.value)}
                  onBlur={() => props.onSubmitNew()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") props.onSubmitNew();
                    if (e.key === "Escape") props.onCancelNew();
                  }}
                  placeholder="Folder name…"
                  spellCheck={false}
                  style={{ marginLeft: 18 + (props.depth + 1) * 12 }}
                />
              )}
          </div>
        );
      })}
    </>
  );
}

function FolderRow({
  folder,
  depth,
  isActive,
  count,
  hasChildren,
  isExpanded,
  onToggleExpand,
  onOpen,
  onRename,
  onDelete,
  onAddChild,
}: {
  folder: StoredFolder;
  depth: number;
  isActive: boolean;
  count: number;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onAddChild: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(folder.name);

  return (
    <div
      className={"ph-side-folder" + (isActive ? " is-active" : "")}
      style={{ paddingLeft: 6 + depth * 12 }}
      onClick={() => !renaming && onOpen()}
    >
      <button
        type="button"
        className={"ph-side-folder-chev" + (isExpanded ? " is-open" : "")}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggleExpand();
        }}
        aria-label={isExpanded ? "Collapse" : "Expand"}
        // Reserve the same slot even when there are no children so rows
        // at every depth line up vertically.
        style={{ visibility: hasChildren ? "visible" : "hidden" }}
        tabIndex={hasChildren ? 0 : -1}
      >
        <ChevronRightIcon size={10} />
      </button>
      <span
        className="ph-side-folder-dot"
        style={{ background: folder.color }}
        aria-hidden
      />
      {renaming ? (
        <input
          className="ph-side-folder-input is-inline"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => {
            setRenaming(false);
            if (draft.trim() && draft.trim() !== folder.name) onRename(draft);
            else setDraft(folder.name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") {
              setDraft(folder.name);
              setRenaming(false);
            }
          }}
        />
      ) : (
        <span
          className="ph-side-folder-name"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setRenaming(true);
          }}
          title={folder.name}
        >
          {folder.name}
        </span>
      )}
      <span className="ph-side-count">{count}</span>
      <button
        type="button"
        className="ph-side-folder-add"
        onClick={(e) => {
          e.stopPropagation();
          onAddChild();
        }}
        title="New subfolder"
        aria-label="New subfolder"
      >
        <PlusIcon size={10} />
      </button>
      <button
        type="button"
        className="ph-side-folder-del"
        onClick={(e) => {
          e.stopPropagation();
          if (
            count === 0 ||
            confirm(
              `Delete folder "${folder.name}" and any sub-folders? Photos inside will move to All photos.`,
            )
          ) {
            onDelete();
          }
        }}
        title="Delete folder"
        aria-label="Delete folder"
      >
        <CloseIcon size={11} />
      </button>
    </div>
  );
}

/** Live progress strip shown while a streaming import is running.
 *  Renders a determinate bar plus a "done / total" counter so the user
 *  has a concrete sense of how much of a multi-thousand-photo import is
 *  left. Aria attributes match the standard progressbar role for screen
 *  readers. */
function InlineUploadProgress({ progress }: { progress: UploadProgress }) {
  const pct =
    progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : 0;
  return (
    <div
      className="ph-upload-inline"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={progress.total}
      aria-valuenow={progress.done}
    >
      <span className="ph-upload-inline-spinner" aria-hidden />
      <span className="ph-upload-inline-label" title={progress.label}>
        {progress.label}
      </span>
      <span className="ph-upload-inline-count">
        {progress.done} / {progress.total}
      </span>
      <span className="ph-upload-inline-pct">{pct}%</span>
    </div>
  );
}

function SelectionBar({
  count,
  folders,
  activeFolderId,
  onClear,
  onDelete,
  onFavorite,
  onMoveTo,
}: {
  count: number;
  folders: StoredFolder[];
  activeFolderId: string | null;
  onClear: () => void;
  onDelete: () => void;
  onFavorite: () => void;
  onMoveTo: (folderId: string | null) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="ph-selection-bar">
      <span className="ph-selection-count">
        {count} selected
      </span>
      <span className="ph-selection-sep" aria-hidden />
      <button
        type="button"
        className="ph-selection-btn"
        onClick={onFavorite}
        title="Toggle favorite"
      >
        <StarIcon size={13} /> Favorite
      </button>
      <div className="ph-selection-move-wrap">
        <button
          type="button"
          className="ph-selection-btn"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <FolderIcon size={13} /> Move to…
        </button>
        {menuOpen && (
          <div
            className="ph-selection-menu"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button
              type="button"
              className="ph-selection-menu-row"
              disabled={activeFolderId === null}
              onClick={() => {
                onMoveTo(null);
                setMenuOpen(false);
              }}
            >
              <span
                className="ph-side-folder-dot"
                style={{ background: "rgba(200,199,202,0.3)" }}
              />
              All photos (no folder)
            </button>
            {flattenFolderTreeForMenu(folders).map(({ folder: f, depth }) => (
              <button
                key={f.id}
                type="button"
                className="ph-selection-menu-row"
                disabled={activeFolderId === f.id}
                onClick={() => {
                  onMoveTo(f.id);
                  setMenuOpen(false);
                }}
                style={{ paddingLeft: 10 + depth * 14 }}
              >
                <span
                  className="ph-side-folder-dot"
                  style={{ background: f.color }}
                />
                {f.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="ph-selection-btn ph-danger"
        onClick={onDelete}
      >
        <TrashIcon size={13} /> Delete
      </button>
      <span className="ph-spacer" />
      <button
        type="button"
        className="ph-selection-btn"
        onClick={onClear}
        title="Clear selection"
      >
        <CloseIcon size={13} />
      </button>
    </div>
  );
}

function PhotoTile({
  photo,
  selected,
  onOpen,
  onSelectToggle,
  onToggleFavorite,
  onDownload,
  onDelete,
}: {
  photo: Photo;
  selected: boolean;
  onOpen: () => void;
  onSelectToggle: (range?: boolean) => void;
  onToggleFavorite: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={"ph-tile" + (selected ? " is-selected" : "")}>
      <button
        type="button"
        className="ph-tile-preview"
        onClick={(e) => {
          // Cmd/Ctrl/Shift click = select toggle (range on shift).
          if (e.metaKey || e.ctrlKey || e.shiftKey) {
            onSelectToggle(e.shiftKey);
            return;
          }
          onOpen();
        }}
        aria-label={`Open ${photo.name}`}
      >
        {photo.thumbUrl ? (
          <img
            src={photo.thumbUrl}
            alt={photo.name}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <span className="ph-tile-placeholder" aria-hidden />
        )}
        <span className="ph-tile-badge">{formatBadge(photo.name, photo.type)}</span>
        <span
          className={
            "ph-tile-checkbox" + (selected ? " is-checked" : "")
          }
          onClick={(e) => {
            e.stopPropagation();
            onSelectToggle(e.shiftKey);
          }}
          role="checkbox"
          aria-checked={selected}
          tabIndex={0}
        >
          {selected ? "✓" : ""}
        </span>
        <div className="ph-tile-actions">
          <button
            type="button"
            className={
              "ph-icon-btn" + (photo.favorite ? " is-fav" : "")
            }
            aria-label={photo.favorite ? "Unfavorite" : "Favorite"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
          >
            <StarIcon size={14} />
          </button>
          <button
            type="button"
            className="ph-icon-btn"
            aria-label="Download"
            onClick={(e) => {
              e.stopPropagation();
              onDownload();
            }}
          >
            <DownloadIcon />
          </button>
          <button
            type="button"
            className="ph-icon-btn ph-danger"
            aria-label="Delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <TrashIcon />
          </button>
        </div>
      </button>
      <div className="ph-tile-name">{photo.name}</div>
      <div className="ph-tile-sub">
        {formatBytes(photo.size)} · {formatDate(photo.addedAt)}
      </div>
    </div>
  );
}

function Lightbox({
  photo,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onDelete,
  onDownload,
}: {
  photo: Photo;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-topbar" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-meta">
          <div className="lightbox-name">{photo.name}</div>
          <div className="lightbox-sub">
            {formatBytes(photo.size)} · {formatDate(photo.addedAt)}
          </div>
        </div>
        <div className="lightbox-actions">
          <button
            className="ph-icon-btn"
            type="button"
            aria-label="Download"
            onClick={onDownload}
          >
            <DownloadIcon />
          </button>
          <button
            className="ph-icon-btn ph-danger"
            type="button"
            aria-label="Delete"
            onClick={onDelete}
          >
            <TrashIcon />
          </button>
          <button
            className="ph-icon-btn"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {hasPrev && (
        <button
          className="lightbox-nav lightbox-prev"
          type="button"
          aria-label="Previous"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
        >
          <ChevronLeftIcon size={20} />
        </button>
      )}
      {hasNext && (
        <button
          className="lightbox-nav lightbox-next"
          type="button"
          aria-label="Next"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
        >
          <ChevronRightIcon size={20} />
        </button>
      )}

      {/* Full-res blob is hydrated lazily once the lightbox opens. The
          thumbnail fills in for the few frames between "open lightbox"
          and "full image ready" so the screen never flashes black. */}
      <img
        className="lightbox-img"
        src={photo.fullUrl ?? photo.thumbUrl ?? ""}
        alt={photo.name}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
