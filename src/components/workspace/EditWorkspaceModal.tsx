import { useEffect, useRef, useState } from "react";
import type { WorkspaceListItem } from "../../state/kanbanStore";
import { useDialog } from "../ui/Dialog";

interface Props {
  open: boolean;
  workspace: WorkspaceListItem | null;
  onClose: () => void;
  onSave: (patch: { name: string }) => Promise<void> | void;
  onUploadAvatar: (file: File) => Promise<string | null>;
  onRemoveAvatar: () => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
}

export function EditWorkspaceModal({
  open,
  workspace,
  onClose,
  onSave,
  onUploadAvatar,
  onRemoveAvatar,
  onDelete,
}: Props) {
  const dialog = useDialog();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !workspace) return;
    setName(workspace.name);
    setAvatarUrl(workspace.avatar_url);
    setErr(null);
  }, [open, workspace]);

  if (!open || !workspace) return null;

  const isOwner = workspace.role === "owner";
  const canEdit = isOwner || workspace.role === "editor";

  const submit = async () => {
    if (!name.trim()) {
      setErr("Name is required");
      return;
    }
    await onSave({ name: name.trim() });
    onClose();
  };

  const pickFile = () => fileInputRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("File must be an image");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErr("Image must be under 5MB");
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      const url = await onUploadAvatar(file);
      if (url) setAvatarUrl(url);
      else setErr("Upload failed");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setAvatarUrl(null);
    await onRemoveAvatar();
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    const ok = await dialog.confirm({
      title: "Delete workspace",
      message: `Delete "${workspace.name}" and everything inside it (boards, scripts, characters, photos)? This cannot be undone.`,
      variant: "danger",
      confirmLabel: "Delete forever",
    });
    if (!ok) return;
    await onDelete();
    onClose();
  };

  const initial = name.trim().charAt(0).toUpperCase() || "W";

  return (
    <div className="vn-modal-backdrop" onClick={onClose}>
      <div
        className="vn-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="vn-modal-head">
          <h3>Workspace settings</h3>
          <button
            type="button"
            className="vn-drawer-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="vn-modal-body">
          <label className="vn-modal-label">Avatar</label>
          <div className="vn-cover-row">
            <button
              type="button"
              className="vn-cover-preview vn-cover-preview-round"
              onClick={pickFile}
              disabled={uploading || !canEdit}
              title={
                !canEdit
                  ? "Only owners and editors can change avatar"
                  : avatarUrl
                    ? "Replace avatar"
                    : "Upload avatar"
              }
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" />
              ) : (
                <span className="vn-cover-emoji-fallback">{initial}</span>
              )}
              {uploading && <span className="vn-cover-overlay">…</span>}
            </button>
            <div className="vn-cover-actions">
              <button
                type="button"
                className="hbtn"
                onClick={pickFile}
                disabled={uploading || !canEdit}
              >
                {avatarUrl ? "Replace" : "Upload"}
              </button>
              {avatarUrl && canEdit && (
                <button
                  type="button"
                  className="hbtn"
                  onClick={() => void handleRemoveAvatar()}
                  disabled={uploading}
                >
                  Remove
                </button>
              )}
              <p className="vn-cover-hint">PNG / JPG / WEBP, up to 5MB</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: "none" }}
              onChange={(e) => void onFileChange(e)}
            />
          </div>

          <label className="vn-modal-label">Name</label>
          <input
            className="vn-input"
            autoFocus
            value={name}
            disabled={!canEdit}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") onClose();
            }}
          />

          <p className="vn-cover-hint" style={{ margin: "0" }}>
            Your role: <strong>{workspace.role}</strong>
          </p>

          {err && <div className="vn-modal-error">{err}</div>}
        </div>
        <div className="vn-modal-foot">
          {isOwner && onDelete && (
            <button
              type="button"
              className="hbtn is-danger"
              onClick={() => void handleDelete()}
              style={{ marginRight: "auto" }}
            >
              Delete workspace
            </button>
          )}
          <button type="button" className="hbtn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="hbtn is-primary"
            onClick={() => void submit()}
            disabled={!name.trim() || uploading || !canEdit}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
