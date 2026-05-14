import { useEffect, useMemo, useRef, useState } from "react";
import {
  listFolders,
  listPhotos,
  type StoredFolder,
  type StoredPhoto,
} from "../../lib/photosDb";

/**
 * Modal photo picker. Lists every photo from the local IndexedDB gallery
 * as a thumbnail grid; the caller passes a current selection and gets a
 * new id (or null = detach) back through `onSelect`.
 *
 * Lives outside `PhotosScreen` on purpose — the picker has no folder-
 * editing or upload affordances, so re-using `PhotosScreen` would mean
 * gating all of its mutations behind a "read-only" flag. A separate
 * lightweight component is simpler to reason about.
 *
 * The grid is intentionally NOT virtualized — pickers run against
 * already-loaded thumbnails (tens to low thousands of items), and the
 * scroll viewport is small enough that vanilla rendering stays smooth.
 * If you find this picker getting opened against a 5k-photo library,
 * port the virtualization from `PhotosScreen` over.
 */
export function PhotoPicker({
  open,
  currentId,
  onSelect,
  onClose,
}: {
  open: boolean;
  currentId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  const [folders, setFolders] = useState<StoredFolder[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null | "all">(
    "all",
  );
  const [query, setQuery] = useState("");
  const [thumbUrls, setThumbUrls] = useState<Map<string, string>>(new Map());

  // -- Load metadata + thumbnails on open. We re-read each time so a
  //    picker that's been open through an import sees the freshly-added
  //    photos without manual refresh. Thumbnails are Blobs from IDB; we
  //    materialize them as ObjectURLs and revoke on close to avoid
  //    leaking once the user picks/cancels.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const created: string[] = [];
    void (async () => {
      const [storedPhotos, storedFolders] = await Promise.all([
        listPhotos(),
        listFolders(),
      ]);
      if (cancelled) return;
      const urls = new Map<string, string>();
      for (const p of storedPhotos) {
        if (p.thumbnail) {
          const u = URL.createObjectURL(p.thumbnail);
          urls.set(p.id, u);
          created.push(u);
        }
      }
      setPhotos(storedPhotos);
      setFolders(storedFolders);
      setThumbUrls(urls);
    })();
    return () => {
      cancelled = true;
      // Revoke after a microtask so the in-flight render that referenced
      // these URLs has a chance to finish painting.
      queueMicrotask(() => {
        for (const u of created) URL.revokeObjectURL(u);
      });
    };
  }, [open]);

  // Build folder counts once per photo-list change so the sidebar
  // numbers stay in sync without recomputing per render.
  const folderCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of photos) {
      if (!p.folderId) continue;
      m.set(p.folderId, (m.get(p.folderId) ?? 0) + 1);
    }
    return m;
  }, [photos]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = photos;
    if (activeFolderId === null) {
      list = list.filter((p) => p.folderId === null);
    } else if (typeof activeFolderId === "string" && activeFolderId !== "all") {
      list = list.filter((p) => p.folderId === activeFolderId);
    }
    if (q) {
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    return list.sort((a, b) => b.addedAt - a.addedAt);
  }, [photos, activeFolderId, query]);

  // Close on Esc — pickers are throwaway UI, the user shouldn't have to
  // mouse-aim at the close button to dismiss.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="photo-picker-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="photo-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Pick a photo"
      >
        <header className="photo-picker-head">
          <div className="photo-picker-title">Attach a photo</div>
          <input
            className="photo-picker-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            spellCheck={false}
            autoFocus
          />
          <button
            type="button"
            className="photo-picker-close"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            ✕
          </button>
        </header>

        <div className="photo-picker-body">
          <nav className="photo-picker-side">
            <button
              type="button"
              className={
                "photo-picker-side-row" +
                (activeFolderId === "all" ? " is-active" : "")
              }
              onClick={() => setActiveFolderId("all")}
            >
              <span className="photo-picker-side-name">All photos</span>
              <span className="photo-picker-side-count">{photos.length}</span>
            </button>
            <button
              type="button"
              className={
                "photo-picker-side-row" +
                (activeFolderId === null ? " is-active" : "")
              }
              onClick={() => setActiveFolderId(null)}
            >
              <span className="photo-picker-side-name">Unsorted</span>
              <span className="photo-picker-side-count">
                {photos.filter((p) => p.folderId === null).length}
              </span>
            </button>
            <div className="photo-picker-side-sep" />
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                className={
                  "photo-picker-side-row" +
                  (activeFolderId === f.id ? " is-active" : "")
                }
                onClick={() => setActiveFolderId(f.id)}
                title={f.name}
              >
                <span
                  className="photo-picker-side-dot"
                  style={{ background: f.color }}
                  aria-hidden
                />
                <span className="photo-picker-side-name">{f.name}</span>
                <span className="photo-picker-side-count">
                  {folderCounts.get(f.id) ?? 0}
                </span>
              </button>
            ))}
          </nav>

          <div className="photo-picker-grid-wrap">
            {visible.length === 0 ? (
              <div className="photo-picker-empty">
                {photos.length === 0
                  ? "No photos in the gallery yet. Upload some from the Photos screen first."
                  : "No matches in this view."}
              </div>
            ) : (
              <div className="photo-picker-grid">
                {currentId && (
                  <button
                    type="button"
                    className="photo-picker-detach"
                    onClick={() => {
                      onSelect(null);
                      onClose();
                    }}
                    title="Remove the currently attached photo"
                  >
                    <span className="photo-picker-detach-glyph">✕</span>
                    <span>Detach photo</span>
                  </button>
                )}
                {visible.map((p) => {
                  const url = thumbUrls.get(p.id);
                  const isCurrent = p.id === currentId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={
                        "photo-picker-tile" +
                        (isCurrent ? " is-current" : "")
                      }
                      onClick={() => {
                        onSelect(p.id);
                        onClose();
                      }}
                      title={p.name}
                    >
                      {url ? (
                        <img src={url} alt={p.name} loading="lazy" />
                      ) : (
                        <span className="photo-picker-tile-skel" aria-hidden />
                      )}
                      <span className="photo-picker-tile-name">{p.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
