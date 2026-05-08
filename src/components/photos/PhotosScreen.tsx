import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ChangeEvent,
} from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  PhotosIcon,
  TrashIcon,
  UploadIcon,
} from "../kanban/Icon";
import { StarIcon } from "../scripts/SharedIcons";

interface Photo {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
  addedAt: number;
  favorite: boolean;
}

type View = "all" | "favorites";

function formatBytes(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-US", {
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

export function PhotosScreen() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [view, setView] = useState<View>("all");
  const [dragOver, setDragOver] = useState(false);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      photos.forEach((p) => URL.revokeObjectURL(p.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const favoritesCount = useMemo(
    () => photos.filter((p) => p.favorite).length,
    [photos],
  );
  const visible = useMemo(
    () => (view === "favorites" ? photos.filter((p) => p.favorite) : photos),
    [photos, view],
  );
  const lightboxIdx = lightboxId
    ? visible.findIndex((p) => p.id === lightboxId)
    : -1;
  const lightboxPhoto = lightboxIdx >= 0 ? visible[lightboxIdx] : null;

  const addFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (!incoming.length) return;
    const newPhotos: Photo[] = incoming.map((f) => ({
      id:
        (crypto.randomUUID && crypto.randomUUID()) ||
        Math.random().toString(36).slice(2),
      name: f.name,
      size: f.size,
      type: f.type,
      url: URL.createObjectURL(f),
      addedAt: Date.now(),
      favorite: false,
    }));
    setPhotos((prev) => [...newPhotos, ...prev]);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const onDelete = (id: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((p) => p.id !== id);
    });
    if (lightboxId === id) setLightboxId(null);
  };

  const onDownload = (p: Photo) => {
    const a = document.createElement("a");
    a.href = p.url;
    a.download = p.name;
    a.click();
  };

  const onToggleFavorite = (id: string) => {
    setPhotos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)),
    );
  };

  // Lightbox keyboard
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

  const viewLabel = view === "favorites" ? "Favorites" : "All photos";

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
                "ph-side-row" + (view === "all" ? " is-active" : "")
              }
              onClick={() => setView("all")}
            >
              <PhotosIcon size={16} />
              <span className="ph-side-label">All photos</span>
              <span className="ph-side-count">{photos.length}</span>
            </button>
            <button
              type="button"
              className={
                "ph-side-row" + (view === "favorites" ? " is-active" : "")
              }
              onClick={() => setView("favorites")}
            >
              <StarIcon size={16} />
              <span className="ph-side-label">Favorites</span>
              <span className="ph-side-count">{favoritesCount}</span>
            </button>

            <div className="ph-side-section">FOLDERS</div>
            <div className="ph-side-empty">
              No folders yet
            </div>
          </nav>
        </aside>

        <section
          className={"ph-main" + (dragOver ? " is-drag" : "")}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="ph-main-topbar">
            <span className="ph-crumb">Photos</span>
            <span className="ph-crumb-sep">›</span>
            <span className="ph-crumb is-current">{viewLabel}</span>
            <span className="ph-spacer" />
            <button
              className="ph-upload-btn"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={onPick}
          />

          <div className="ph-main-body">
            {visible.length === 0 ? (
              <div
                className="ph-empty"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="ph-empty-icon">
                  <PhotosIcon size={32} />
                </div>
                <div className="ph-empty-title">
                  {view === "favorites"
                    ? "No favorites yet"
                    : "Drop photos here"}
                </div>
                <div className="ph-empty-sub">
                  {view === "favorites" ? (
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
                <div className="ph-grid">
                  {visible.map((p) => (
                    <PhotoTile
                      key={p.id}
                      photo={p}
                      onOpen={() => setLightboxId(p.id)}
                      onToggleFavorite={() => onToggleFavorite(p.id)}
                      onDownload={() => onDownload(p)}
                      onDelete={() => onDelete(p.id)}
                    />
                  ))}
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
          onDelete={() => onDelete(lightboxPhoto.id)}
          onDownload={() => onDownload(lightboxPhoto)}
        />
      )}
    </main>
  );
}

function PhotoTile({
  photo,
  onOpen,
  onToggleFavorite,
  onDownload,
  onDelete,
}: {
  photo: Photo;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="ph-tile">
      <button
        type="button"
        className="ph-tile-preview"
        onClick={onOpen}
        aria-label={`Open ${photo.name}`}
      >
        <img src={photo.url} alt={photo.name} loading="lazy" />
        <span className="ph-tile-badge">{formatBadge(photo.name, photo.type)}</span>
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

      <img
        className="lightbox-img"
        src={photo.url}
        alt={photo.name}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
