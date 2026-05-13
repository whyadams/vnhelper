import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useKanban } from "../../state/kanbanStore";
import type {
  ScriptCharacter,
  ScriptLocation,
} from "../../state/scripts";
import {
  deleteCharacterAvatar,
  uploadCharacterAvatar,
} from "../../lib/avatarUpload";
import { UsersFilledIcon } from "../kanban/SidebarIcons";
import { useDialog } from "../ui/Dialog";
import { SkeletonBlock, SkeletonBox } from "../ui/Skeleton";
import { LinkedEventsSection } from "../calendar/LinkedEventsSection";

type ScriptsApi = ReturnType<typeof import("../../state/scripts").useScripts>;

/* Pencil-muted accent palette — same family as role/status tokens */
const PRESET_COLORS = [
  "#a89882", // owner / warm
  "#8d9982", // ok / sage
  "#828c99", // info / steel
  "#a87080", // danger / rose
  "#9e8aa8", // muted violet
  "#a8907a", // muted ochre
  "#7a9994", // muted teal
];

interface PageProps {
  scripts: ScriptsApi;
  onBack: () => void;
  onAddCharacter: () => void;
  /** If set, the page opens the editor for this character on mount and
   *  whenever the prop changes. Cleared by the consumer once consumed. */
  initialEditingId?: string | null;
  /** Invoked once `initialEditingId` has been applied so the parent can
   *  clear its pending-focus state and not re-trigger on the next render. */
  onConsumeInitialEditingId?: () => void;
}

type Tab = "characters" | "locations";

export function ScriptCharactersPage({
  scripts,
  onBack,
  onAddCharacter,
  initialEditingId,
  onConsumeInitialEditingId,
}: PageProps) {
  const [tab, setTab] = useState<Tab>("characters");
  const [filter, setFilter] = useState("");
  const [editingCharId, setEditingCharId] = useState<string | null>(null);
  const [editingLocId, setEditingLocId] = useState<string | null>(null);

  // External focus request — e.g. from a Calendar attachment click.
  useEffect(() => {
    if (!initialEditingId) return;
    setTab("characters");
    setEditingCharId(initialEditingId);
    onConsumeInitialEditingId?.();
  }, [initialEditingId, onConsumeInitialEditingId]);
  const dialog = useDialog();

  const q = filter.trim().toLowerCase();
  const filteredCharacters = useMemo(() => {
    if (!q) return scripts.characters;
    return scripts.characters.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.short_name?.toLowerCase().includes(q) ||
        (c.role ?? "").toLowerCase().includes(q) ||
        c.aliases.some((a) => a.toLowerCase().includes(q)),
    );
  }, [scripts.characters, q]);
  const filteredLocations = useMemo(() => {
    if (!q) return scripts.locations;
    return scripts.locations.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.mood ?? "").toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q),
    );
  }, [scripts.locations, q]);

  const onCreateLocation = async () => {
    const name = await dialog.prompt({
      title: "New location",
      message: "Location name",
      placeholder: "e.g. Cafe, Rooftop",
      confirmLabel: "Create",
    });
    if (!name?.trim()) return;
    const id = await scripts.createLocation(name.trim());
    if (id) setEditingLocId(id);
  };

  // Loading: skeleton instead of empty-state flash on workspace switch.
  if (!scripts.projectsReady) {
    return (
      <main className="main vn-main">
        <div className="topbar tmt-bar vn-cast-topbar">
          <button
            type="button"
            className="vn-cast-back"
            onClick={onBack}
            aria-label="Back to script"
            title="Back to script"
          >
            ←
          </button>
          <UsersFilledIcon size={20} className="tmt-ico" />
          <span className="tmt-title">Cast</span>
        </div>
        <div className="notes-empty-doc">
          <SkeletonBox style={{ width: 320, maxWidth: "60%" }}>
            <SkeletonBlock height={20} width="80%" />
            <SkeletonBlock height={14} width="60%" style={{ marginTop: 12 }} />
          </SkeletonBox>
        </div>
      </main>
    );
  }

  if (!scripts.activeProjectId) {
    return (
      <main className="main vn-main">
        <div className="topbar tmt-bar vn-cast-topbar">
          <button
            type="button"
            className="vn-cast-back"
            onClick={onBack}
            aria-label="Back to script"
            title="Back to script"
          >
            ←
          </button>
          <UsersFilledIcon size={20} className="tmt-ico" />
          <span className="tmt-title">Cast</span>
        </div>
        <div className="notes-empty-doc fade-in">
          <p>Pick or create a script project first.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="main vn-main">
      <div className="topbar tmt-bar vn-cast-topbar">
        <button
          type="button"
          className="vn-cast-back"
          onClick={onBack}
          aria-label="Back to script"
          title="Back to script"
        >
          ←
        </button>
        <UsersFilledIcon size={20} className="tmt-ico" />
        <span className="tmt-title">Cast</span>
        <span className="tmt-sep">·</span>
        <span className="vn-cast-project">
          {scripts.activeProject?.title}
        </span>
        <span className="tmt-spacer" />
        {tab === "characters" ? (
          <button
            type="button"
            className="tmt-add"
            onClick={onAddCharacter}
          >
            + New character
          </button>
        ) : (
          <button
            type="button"
            className="tmt-add"
            onClick={() => void onCreateLocation()}
          >
            + New location
          </button>
        )}
      </div>

      <div className="vn-cast-page-head">
        <div className="vn-cast-tabs">
          <button
            type="button"
            className={
              "vn-cast-tab" + (tab === "characters" ? " is-active" : "")
            }
            onClick={() => setTab("characters")}
          >
            Characters
            <span className="vn-cast-tab-ct">
              {scripts.characters.length}
            </span>
          </button>
          <button
            type="button"
            className={
              "vn-cast-tab" + (tab === "locations" ? " is-active" : "")
            }
            onClick={() => setTab("locations")}
          >
            Locations
            <span className="vn-cast-tab-ct">
              {scripts.locations.length}
            </span>
          </button>
        </div>
        <span className="tmt-spacer" />
        <input
          className="vn-cast-search-input"
          placeholder={
            tab === "characters" ? "Filter cast…" : "Filter locations…"
          }
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="doc-scroll vn-cast-scroll">
        <div className="vn-cast-page">
          {tab === "characters" ? (
            filteredCharacters.length === 0 ? (
              <div className="vn-cast-empty">
                {q
                  ? `No matches for "${filter}"`
                  : "No characters yet. Click + New character to start your cast."}
              </div>
            ) : (
              <div className="vn-cast-list">
                {filteredCharacters.map((c) =>
                  editingCharId === c.id ? (
                    <CharacterEditCardFull
                      key={c.id}
                      character={c}
                      onClose={() => setEditingCharId(null)}
                      onSave={(patch) =>
                        void scripts.updateCharacter(c.id, patch)
                      }
                      onDelete={async () => {
                        const ok = await dialog.confirm({
                          title: "Delete character",
                          message: `Delete "${c.name}"? This cannot be undone.`,
                          variant: "danger",
                          confirmLabel: "Delete",
                        });
                        if (ok) {
                          void scripts.deleteCharacter(c.id);
                          setEditingCharId(null);
                        }
                      }}
                    />
                  ) : (
                    <CharacterCardLarge
                      key={c.id}
                      character={c}
                      onEdit={() => setEditingCharId(c.id)}
                    />
                  ),
                )}
              </div>
            )
          ) : filteredLocations.length === 0 ? (
            <div className="vn-cast-empty">
              {q
                ? `No matches for "${filter}"`
                : "No locations yet."}
            </div>
          ) : (
            <div className="vn-cast-grid">
              {filteredLocations.map((l) =>
                editingLocId === l.id ? (
                  <LocationEditCardFull
                    key={l.id}
                    location={l}
                    onClose={() => setEditingLocId(null)}
                    onSave={(patch) =>
                      void scripts.updateLocation(l.id, patch)
                    }
                    onDelete={async () => {
                      const ok = await dialog.confirm({
                        title: "Delete location",
                        message: `Delete "${l.name}"?`,
                        variant: "danger",
                        confirmLabel: "Delete",
                      });
                      if (ok) {
                        void scripts.deleteLocation(l.id);
                        setEditingLocId(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    key={l.id}
                    type="button"
                    className="vn-cast-card"
                    onClick={() => setEditingLocId(l.id)}
                  >
                    <span className="vn-cast-card-loc-icon">📍</span>
                    <span className="vn-cast-card-name">{l.name}</span>
                    {l.mood && (
                      <span className="vn-mood">{l.mood}</span>
                    )}
                    <span className="vn-cast-card-desc">
                      {l.description.slice(0, 140) || "—"}
                    </span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// ============================================================
// Large character card (view mode)
// ============================================================

function CharacterCardLarge({
  character,
  onEdit,
}: {
  character: ScriptCharacter;
  onEdit: () => void;
}) {
  const subBits = [character.pronouns, character.age]
    .filter(Boolean)
    .join(" · ");
  const visibleAliases = character.aliases.slice(0, 2);
  const extraAliases = character.aliases.length - visibleAliases.length;
  return (
    <button
      type="button"
      className="vn-cast-row"
      onClick={onEdit}
    >
      {character.avatar_url ? (
        <span
          className="vn-cast-row-avatar"
          style={{ borderColor: character.color }}
        >
          <img src={character.avatar_url} alt={character.name} />
        </span>
      ) : (
        <span
          className="vn-cast-row-avatar vn-cast-row-avatar-fallback"
          style={{ background: character.color }}
        >
          {character.emoji ??
            (character.short_name ?? character.name).slice(0, 2).toUpperCase()}
        </span>
      )}
      <div className="vn-cast-row-main">
        <span className="vn-cast-row-name">{character.name}</span>
        {character.role && (
          <span className="vn-cast-row-role">{character.role}</span>
        )}
        {subBits && <span className="vn-cast-row-sub">{subBits}</span>}
        {character.voice_notes && (
          <span className="vn-cast-row-voice">{character.voice_notes}</span>
        )}
      </div>
      <div className="vn-cast-row-meta">
        {visibleAliases.length > 0 && (
          <div className="vn-cast-row-aliases">
            {visibleAliases.map((a) => (
              <span key={a} className="vn-cast-row-alias">
                {a}
              </span>
            ))}
            {extraAliases > 0 && (
              <span className="vn-cast-row-alias-more">
                +{extraAliases}
              </span>
            )}
          </div>
        )}
        <span className="vn-cast-row-sep" aria-hidden />
        <span
          className="vn-cast-row-color"
          style={{ background: character.color }}
          aria-hidden
        />
      </div>
    </button>
  );
}

// ============================================================
// Editable character card (full layout)
// ============================================================

function CharacterEditCardFull({
  character,
  onClose,
  onSave,
  onDelete,
}: {
  character: ScriptCharacter;
  onClose: () => void;
  onSave: (patch: Partial<ScriptCharacter>) => void;
  onDelete: () => void;
}) {
  const { state } = useKanban();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState(character.name);
  const [shortName, setShortName] = useState(character.short_name ?? "");
  const [rpyVar, setRpyVar] = useState(character.rpy_var ?? "");
  const [color, setColor] = useState(character.color);
  const [emoji, setEmoji] = useState(character.emoji ?? "");
  const [pronouns, setPronouns] = useState(character.pronouns ?? "");
  const [age, setAge] = useState(character.age ?? "");
  const [role, setRole] = useState(character.role ?? "");
  const [voiceNotes, setVoiceNotes] = useState(character.voice_notes ?? "");
  const [aliases, setAliases] = useState<string[]>(character.aliases ?? []);
  const [aliasDraft, setAliasDraft] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(character.avatar_url);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const onPickAvatar = () => fileInputRef.current?.click();
  const onAvatarFile = async (file: File | null) => {
    if (!file) return;
    if (!state.workspaceId) {
      setUploadErr("No active workspace");
      return;
    }
    setUploadErr(null);
    setUploading(true);
    try {
      const oldUrl = avatarUrl;
      const url = await uploadCharacterAvatar(
        file,
        state.workspaceId,
        character.id,
      );
      setAvatarUrl(url);
      onSave({ avatar_url: url });
      if (oldUrl) void deleteCharacterAvatar(oldUrl);
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };
  const onRemoveAvatar = () => {
    const old = avatarUrl;
    setAvatarUrl(null);
    onSave({ avatar_url: null });
    if (old) void deleteCharacterAvatar(old);
  };

  const addAlias = () => {
    const v = aliasDraft.trim();
    if (!v) return;
    if (aliases.some((a) => a.toLowerCase() === v.toLowerCase())) {
      setAliasDraft("");
      return;
    }
    setAliases([...aliases, v]);
    setAliasDraft("");
  };
  const removeAlias = (a: string) =>
    setAliases(aliases.filter((x) => x !== a));
  const onAliasKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addAlias();
    } else if (e.key === "Backspace" && !aliasDraft && aliases.length > 0) {
      removeAlias(aliases[aliases.length - 1]);
    }
  };

  const save = () => {
    onSave({
      name: name.trim() || character.name,
      short_name: shortName.trim() || null,
      rpy_var: rpyVar.trim() || null,
      color,
      emoji: emoji.trim() || null,
      pronouns: pronouns.trim() || null,
      age: age.trim() || null,
      role: role.trim() || null,
      voice_notes: voiceNotes,
      aliases,
    });
    onClose();
  };

  return (
    <div className="vn-cast-card vn-cast-card-edit">
      <div className="vn-cast-edit-head">
        <button
          type="button"
          className="vn-avatar-uploader"
          onClick={onPickAvatar}
          style={{ background: color, borderColor: color }}
          title={avatarUrl ? "Replace avatar" : "Upload avatar"}
          disabled={uploading}
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt={name} className="vn-avatar-img" />
          ) : (
            <span className="vn-avatar-placeholder">
              {emoji || (shortName || name).slice(0, 2).toUpperCase()}
            </span>
          )}
          <span className="vn-avatar-edit-overlay">
            {uploading ? "…" : avatarUrl ? "↻" : "+"}
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: "none" }}
          onChange={(e) => void onAvatarFile(e.target.files?.[0] ?? null)}
        />
        <div className="vn-cast-edit-name-col">
          <input
            className="vn-input vn-input-large"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {avatarUrl && (
            <button
              type="button"
              className="vn-avatar-remove"
              onClick={onRemoveAvatar}
            >
              Remove avatar
            </button>
          )}
          {uploadErr && <div className="vn-quick-warn">{uploadErr}</div>}
        </div>
      </div>

      <div className="vn-char-edit-grid">
        <input
          className="vn-input"
          placeholder="Short name"
          value={shortName}
          onChange={(e) => setShortName(e.target.value)}
        />
        <input
          className="vn-input vn-input-mono"
          placeholder="Ren'Py var (e.g. mc, eileen)"
          value={rpyVar}
          onChange={(e) =>
            setRpyVar(
              e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9_]/g, "")
                .slice(0, 32),
            )
          }
          spellCheck={false}
          title="Lower-case Python identifier used in say blocks. Empty = not linked."
        />
        <input
          className="vn-input"
          placeholder="Emoji"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          maxLength={4}
        />
        <input
          className="vn-input"
          placeholder="Pronouns"
          value={pronouns}
          onChange={(e) => setPronouns(e.target.value)}
        />
        <input
          className="vn-input"
          placeholder="Age"
          value={age}
          onChange={(e) => setAge(e.target.value)}
        />
        <input
          className="vn-input vn-span2"
          placeholder="Role (protagonist · antagonist · side · npc)"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
      </div>

      <div className="vn-color-row">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={"vn-color-dot" + (c === color ? " is-active" : "")}
            style={{ background: c }}
            onClick={() => setColor(c)}
          />
        ))}
        <input
          type="color"
          className="vn-color-picker"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </div>

      <div>
        <label
          className="vn-modal-label"
          style={{ marginBottom: 4, display: "block" }}
        >
          Aliases — alt names that should highlight too
        </label>
        <div className="vn-alias-chips" style={{ borderColor: color }}>
          {aliases.map((a) => (
            <span
              key={a}
              className="vn-alias-chip"
              style={{
                background: color + "22",
                borderColor: color + "55",
                color,
              }}
              onClick={() => removeAlias(a)}
              title="Click to remove"
            >
              {a}
              <span className="tag-x">×</span>
            </span>
          ))}
          <input
            className="vn-alias-input"
            value={aliasDraft}
            onChange={(e) => setAliasDraft(e.target.value)}
            onKeyDown={onAliasKey}
            onBlur={addAlias}
            placeholder={
              aliases.length === 0
                ? "MC, Тайлер, Ty… (Enter to add)"
                : "+ alias"
            }
          />
        </div>
      </div>

      <textarea
        className="vn-textarea"
        placeholder="Voice notes — speech patterns, vocabulary, quirks…"
        value={voiceNotes}
        onChange={(e) => setVoiceNotes(e.target.value)}
        rows={3}
      />

      <LinkedEventsSection
        entity_type="character"
        entity_id={character.id}
        variant="compact"
      />

      <div className="vn-char-actions">
        <button type="button" className="hbtn is-danger" onClick={onDelete}>
          Delete
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="hbtn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="hbtn is-primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Editable location card
// ============================================================

function LocationEditCardFull({
  location,
  onClose,
  onSave,
  onDelete,
}: {
  location: ScriptLocation;
  onClose: () => void;
  onSave: (patch: Partial<ScriptLocation>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(location.name);
  const [description, setDescription] = useState(location.description);
  const [mood, setMood] = useState(location.mood ?? "");

  const save = () => {
    onSave({
      name: name.trim() || location.name,
      description,
      mood: mood.trim() || null,
    });
    onClose();
  };

  return (
    <div className="vn-cast-card vn-cast-card-edit">
      <input
        className="vn-input vn-input-large"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="vn-input"
        placeholder="Mood (cozy, ominous, neon)"
        value={mood}
        onChange={(e) => setMood(e.target.value)}
      />
      <textarea
        className="vn-textarea"
        placeholder="Description — sensory details, layout, atmosphere…"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={5}
      />
      <div className="vn-char-actions">
        <button type="button" className="hbtn is-danger" onClick={onDelete}>
          Delete
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="hbtn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="hbtn is-primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
