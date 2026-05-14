import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphCharacter } from "./graphBuild";
import {
  buildSimContext,
  stepLabel,
  type SimContext,
  type SimEvent,
  type SimOption,
  type SimSourceRow,
  type SimStep,
} from "./pathSimulate";
import { getFullBlob, listPhotos } from "../../lib/photosDb";

interface Props {
  open: boolean;
  /** Scene rows from the canvas — same shape the build consumes. */
  rows: SimSourceRow[];
  /** Project characters — used to resolve speaker → colour for the
   *  Ren'Py-style speaker name plate. */
  characters: GraphCharacter[];
  /** Where to start the playthrough. When undefined, picks the project's
   *  entry label (first label in tree-order). */
  startLabel?: string | null;
  onClose: () => void;
  /** Reveal the current label on the underlying canvas. */
  onJumpToLabel?: (labelName: string) => void;
}

interface VisibleChar {
  char: string;
  expression?: string;
  position?: string;
}

interface HistoryEntry {
  step: SimStep;
  /** Which option was picked to leave this step. null for the active one. */
  chosen: SimOption | null;
  /** Call-stack snapshot at the moment this step started. Captured so Back
   *  can restore the stack exactly. Older entries keep their original stack. */
  stackSnapshot: string[];
}

/**
 * Step-through simulator overlay — styled to feel like Ren'Py at play:
 * scene title across the top, character chips floating in the middle,
 * dialogue bar pinned to the bottom. Click anywhere (or press Space /
 * Enter / →) to advance one event at a time; when the current label's
 * events run out, choice buttons appear over the stage. Back-button
 * rewinds the most recent step.
 *
 * We don't run Python — every if/elif/else branch is exposed as a button
 * for the author to pick. Conditions, $-effects, and call/return are
 * surfaced visually but not evaluated.
 */
export function PathSimulator({
  open,
  rows,
  characters,
  startLabel,
  onClose,
  onJumpToLabel,
}: Props) {
  const ctx = useMemo<SimContext>(() => buildSimContext(rows), [rows]);
  const charByVar = useMemo(() => {
    const m = new Map<string, GraphCharacter>();
    for (const c of characters) m.set(c.name.toLowerCase(), c);
    return m;
  }, [characters]);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  /** Index of the next event to show inside the current step. When this
   *  equals `step.events.length`, the choice overlay is active. */
  const [eventIndex, setEventIndex] = useState(0);
  /** Live "stage" state — accumulated by scene/show/hide events as the
   *  user advances through the step. Rebuilt from history on Back. */
  const [bg, setBg] = useState<string | null>(null);
  const [visibleChars, setVisibleChars] = useState<VisibleChar[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** Active call frames — each entry is the caller label to resume at when
   *  the current execution path hits a `return`. Mutates on `call` (push)
   *  and `return` (pop). Snapshotted into each HistoryEntry so Back works. */
  const [callStack, setCallStack] = useState<string[]>([]);

  /** Replay events [0..targetIndex) on a fresh stage. Used by Back, by
   *  the initial step load, and any time we need to recompute the visible
   *  state without animating through each click. */
  const replayStage = useCallback(
    (step: SimStep, targetIndex: number) => {
      let nextBg: string | null = null;
      const next: VisibleChar[] = [];
      for (let i = 0; i < targetIndex && i < step.events.length; i++) {
        const e = step.events[i];
        if (e.kind === "scene") nextBg = e.bg;
        else if (e.kind === "show") {
          const found = next.findIndex((c) => c.char === e.char);
          if (found >= 0)
            next[found] = {
              char: e.char,
              expression: e.expression,
              position: e.position,
            };
          else
            next.push({
              char: e.char,
              expression: e.expression,
              position: e.position,
            });
        } else if (e.kind === "hide") {
          const idx = next.findIndex((c) => c.char === e.char);
          if (idx >= 0) next.splice(idx, 1);
        }
      }
      setBg(nextBg);
      setVisibleChars(next);
    },
    [],
  );

  /** Initialise on open or whenever the start label / context changes. */
  useEffect(() => {
    if (!open) return;
    const start = startLabel ?? ctx.entryLabel;
    if (!start) {
      setHistory([]);
      setEventIndex(0);
      setBg(null);
      setVisibleChars([]);
      setCallStack([]);
      return;
    }
    const first = stepLabel(start, ctx);
    if (!first) {
      setHistory([]);
      return;
    }
    setHistory([{ step: first, chosen: null, stackSnapshot: [] }]);
    setCallStack([]);
    // Auto-advance past leading scene/show/hide events — they're stage
    // setup, not "click to read" content. Stop at the first say/narrator/note
    // (or at the choice menu if none exists).
    let firstReadableIdx = 0;
    while (firstReadableIdx < first.events.length) {
      const k = first.events[firstReadableIdx].kind;
      if (k === "say" || k === "narrator" || k === "note") break;
      firstReadableIdx++;
    }
    setEventIndex(firstReadableIdx);
    replayStage(first, firstReadableIdx);
  }, [open, ctx, startLabel, replayStage]);

  const current = history.length > 0 ? history[history.length - 1] : null;

  /** Lookup table for resolving Ren'Py `scene <bg>` tags to local photo
   *  ids. Built once per simulator session — the user's gallery is a
   *  closed set during a single playthrough, so paying to rescan it
   *  on every `bg` change would just burn CPU. Stems are lowercased so
   *  `Drive_Jacob_84.JPG` and `drive_jacob_84.png` both resolve. */
  const [photoIdByStem, setPhotoIdByStem] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const photos = await listPhotos();
      if (cancelled) return;
      const m = new Map<string, string>();
      for (const p of photos) {
        const name = p.name ?? "";
        const dot = name.lastIndexOf(".");
        const stem = (dot >= 0 ? name.slice(0, dot) : name).toLowerCase();
        if (stem && !m.has(stem)) m.set(stem, p.id);
      }
      setPhotoIdByStem(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  /** Photo to render right now. Resolution order matches what a Ren'Py
   *  runtime would do:
   *
   *  1. The live `bg` tag — set by the most recent `scene <name>` block
   *     the user has stepped past. This is the per-step authoritative
   *     image and what makes long labels with multiple `scene` swaps
   *     actually show different photos as you click through.
   *  2. The scene-level `photo_id` (from script_nodes) — fallback for
   *     dialogue-only labels that never set a `scene` background.
   *
   *  The bg resolves via two passes:
   *   - exact stem match: `drive_jacob_84` ↔ `drive_jacob_84.jpg`
   *   - loose prefix match: bg like `bg room day` matches
   *     `bg_room_day_v2.jpg` via the same separator-aware rule used in
   *     the Graph auto-matcher.
   */
  const resolveBgPhotoId = useCallback(
    (bgName: string | null): string | null => {
      if (!bgName || !photoIdByStem) return null;
      const stem = bgName.toLowerCase().trim();
      if (!stem) return null;
      const exact = photoIdByStem.get(stem);
      if (exact) return exact;
      // Also try whitespace-collapsed variants since Ren'Py allows
      // multi-word bg tags but local files don't.
      if (/\s/.test(stem)) {
        const underscored = stem.replace(/\s+/g, "_");
        const dashed = stem.replace(/\s+/g, "-");
        const u = photoIdByStem.get(underscored);
        if (u) return u;
        const d = photoIdByStem.get(dashed);
        if (d) return d;
      }
      // Loose prefix fallback.
      for (const [s, id] of photoIdByStem) {
        if (
          s.length > stem.length &&
          s.startsWith(stem) &&
          /[_\-. ]/.test(s.charAt(stem.length))
        ) {
          return id;
        }
      }
      return null;
    },
    [photoIdByStem],
  );

  const activePhotoId = useMemo(() => {
    const fromBg = resolveBgPhotoId(bg);
    if (fromBg) return fromBg;
    return current?.step.photoId ?? null;
  }, [bg, resolveBgPhotoId, current]);

  /** Resolved ObjectURL for the active backdrop photo. Re-materialized
   *  whenever `activePhotoId` changes (i.e. on every `scene` swap or
   *  step transition that swaps photo). The previous URL is revoked so
   *  we don't leak ObjectURLs across a long label with 20+ bg swaps. */
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!activePhotoId) {
      setPhotoUrl((cur) => {
        if (cur) URL.revokeObjectURL(cur);
        return null;
      });
      return;
    }
    let cancelled = false;
    let created: string | null = null;
    void (async () => {
      const blob = await getFullBlob(activePhotoId);
      if (cancelled) return;
      if (!blob) {
        setPhotoUrl((cur) => {
          if (cur) URL.revokeObjectURL(cur);
          return null;
        });
        return;
      }
      const url = URL.createObjectURL(blob);
      created = url;
      setPhotoUrl((cur) => {
        if (cur) URL.revokeObjectURL(cur);
        return url;
      });
    })();
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [activePhotoId]);

  /** Speaker that "owns" the currently-displayed dialogue line, if any. */
  const currentSayEvent = useMemo<
    Extract<SimEvent, { kind: "say" | "narrator" | "note" }> | null
  >(() => {
    if (!current) return null;
    if (eventIndex <= 0 || eventIndex > current.step.events.length) return null;
    const e = current.step.events[eventIndex - 1];
    if (e.kind === "say" || e.kind === "narrator" || e.kind === "note")
      return e;
    return null;
  }, [current, eventIndex]);

  const choicesActive = useMemo(() => {
    if (!current) return false;
    return eventIndex >= current.step.events.length;
  }, [current, eventIndex]);

  /** Advance one event — applies its stage-mutation side-effect first, then
   *  if it's a "readable" event (say/narrator/note) we stop there for the
   *  user to read. Stage-only events (scene/show/hide) auto-chain so the
   *  user doesn't have to click through invisible state changes. */
  const advance = useCallback(() => {
    if (!current) return;
    if (eventIndex >= current.step.events.length) return; // already at choices
    let i = eventIndex;
    let nextBg = bg;
    let next = visibleChars;
    const cloneChars = () => {
      next = next.slice();
    };
    while (i < current.step.events.length) {
      const e = current.step.events[i];
      i++;
      if (e.kind === "scene") {
        nextBg = e.bg;
        continue;
      }
      if (e.kind === "show") {
        cloneChars();
        const found = next.findIndex((c) => c.char === e.char);
        if (found >= 0)
          next[found] = {
            char: e.char,
            expression: e.expression,
            position: e.position,
          };
        else
          next.push({
            char: e.char,
            expression: e.expression,
            position: e.position,
          });
        continue;
      }
      if (e.kind === "hide") {
        cloneChars();
        const idx = next.findIndex((c) => c.char === e.char);
        if (idx >= 0) next.splice(idx, 1);
        continue;
      }
      // Readable event — stop here.
      break;
    }
    setEventIndex(i);
    setBg(nextBg);
    setVisibleChars(next);
  }, [current, eventIndex, bg, visibleChars]);

  const onChoose = useCallback(
    (opt: SimOption) => {
      if (!opt.target) return;
      const nextStep = stepLabel(opt.target, ctx);
      if (!nextStep) return;
      // Two synthetic markers piggy-back on `variant` from the simulator UI:
      // an option with `data-return` semantics (rendered when isReturn && stack
      // non-empty) pops a frame; an option with `isCall` pushes the current
      // label as a return point. Both interactions happen here so history's
      // stack snapshot captures the post-mutation state.
      const isReturnAction = (opt as SimOption & { isReturnPop?: boolean })
        .isReturnPop === true;
      let nextStack = callStack;
      if (isReturnAction) {
        // Pop the topmost frame. Caller label IS opt.target.
        nextStack = callStack.slice(0, -1);
      } else if (opt.isCall) {
        // Push the current label so a future `return` resumes here.
        const currentLabel = history[history.length - 1]?.step.labelName;
        if (currentLabel) nextStack = [...callStack, currentLabel];
      }
      setCallStack(nextStack);
      setHistory((curr) => {
        const last = curr[curr.length - 1];
        if (!last) return curr;
        const stamped: HistoryEntry = {
          step: last.step,
          chosen: opt,
          stackSnapshot: last.stackSnapshot,
        };
        return [
          ...curr.slice(0, -1),
          stamped,
          { step: nextStep, chosen: null, stackSnapshot: nextStack },
        ];
      });
      // Reset stage to fresh for the new label, then auto-skip its setup
      // events the same way the initial step did.
      let firstReadable = 0;
      while (firstReadable < nextStep.events.length) {
        const k = nextStep.events[firstReadable].kind;
        if (k === "say" || k === "narrator" || k === "note") break;
        firstReadable++;
      }
      setEventIndex(firstReadable);
      replayStage(nextStep, firstReadable);
    },
    [ctx, replayStage, callStack, history],
  );

  const onBack = useCallback(() => {
    setHistory((curr) => {
      if (curr.length <= 1) return curr;
      const trimmed = curr.slice(0, -1);
      const tail = trimmed[trimmed.length - 1];
      if (!tail) return trimmed;
      // Restore the previous step to the moment AFTER its readable events
      // (i.e. the choice screen the user was looking at when they advanced).
      const restored: HistoryEntry = {
        step: tail.step,
        chosen: null,
        stackSnapshot: tail.stackSnapshot,
      };
      const result = [...trimmed.slice(0, -1), restored];
      setEventIndex(tail.step.events.length);
      replayStage(tail.step, tail.step.events.length);
      // Restore the call-stack to the snapshot captured when this step started.
      setCallStack(tail.stackSnapshot);
      return result;
    });
  }, [replayStage]);

  const onRestart = useCallback(() => {
    const start = startLabel ?? ctx.entryLabel;
    if (!start) return;
    const first = stepLabel(start, ctx);
    if (!first) return;
    setHistory([{ step: first, chosen: null, stackSnapshot: [] }]);
    setCallStack([]);
    let firstReadable = 0;
    while (firstReadable < first.events.length) {
      const k = first.events[firstReadable].kind;
      if (k === "say" || k === "narrator" || k === "note") break;
      firstReadable++;
    }
    setEventIndex(firstReadable);
    replayStage(first, firstReadable);
  }, [ctx, startLabel, replayStage]);

  /** Click anywhere on the stage to advance. We attach this to the stage
   *  wrapper so the dialogue bar and choice overlay also "absorb" the
   *  click. Choice mode disables advancing — picking is the action there. */
  const onStageClick = useCallback(() => {
    if (choicesActive) return;
    advance();
  }, [choicesActive, advance]);

  // Keyboard: Esc closes, Backspace = Back, Space/Enter/→ = advance.
  // We skip when an input/textarea has focus so users typing in the
  // history search (if we add one later) aren't disrupted.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (isTyping) return;
      if (e.key === "Backspace") {
        e.preventDefault();
        onBack();
        return;
      }
      if (
        !choicesActive &&
        (e.key === " " || e.key === "Enter" || e.key === "ArrowRight")
      ) {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, choicesActive, advance, onBack, onClose]);

  // Auto-scroll the history list to the latest entry whenever the stack grows.
  const historyEndRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (!historyOpen) return;
    historyEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [history.length, historyOpen]);

  if (!open) return null;

  if (!current) {
    return (
      <div className="path-sim-overlay" onClick={onClose}>
        <div className="path-sim" onClick={(e) => e.stopPropagation()}>
          <div className="path-sim-empty">
            No entry label found — add a label block somewhere first.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="path-sim-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="path-sim"
        role="dialog"
        aria-modal="true"
        aria-label="Path simulator"
      >
        {/* Discreet floating controls — top-right of the stage. Mirrors
            Ren'Py's affordance of keeping the photo unobstructed; the
            user reaches for keyboard shortcuts most of the time, these
            icons are a fallback for mouse-only users. */}
        <div className="path-sim-floating-controls">
          {onJumpToLabel && (
            <button
              type="button"
              className="path-sim-icon-btn"
              onClick={() => onJumpToLabel(current.step.labelName)}
              title={`Reveal "${current.step.labelName}" on canvas`}
              aria-label="Reveal on canvas"
            >
              ↗
            </button>
          )}
          <button
            type="button"
            className="path-sim-icon-btn"
            onClick={onRestart}
            title="Restart from entry"
            aria-label="Restart"
          >
            ⟲
          </button>
          <button
            type="button"
            className="path-sim-icon-btn"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close simulator"
          >
            ✕
          </button>
        </div>

        <div
          className={
            "path-sim-stage" +
            (choicesActive ? " is-choosing" : "") +
            (photoUrl ? " has-photo" : "")
          }
          onClick={onStageClick}
        >
          {photoUrl && (
            <img
              className="path-sim-stage-photo"
              src={photoUrl}
              alt=""
              aria-hidden
              draggable={false}
            />
          )}

          {/* Empty state — when a label has zero readable events AND no
              choices visible yet (rare, but possible for label that's
              just show/hide and then nothing). */}
          {!currentSayEvent && !choicesActive && (
            <div className="path-sim-stage-empty">
              <p>This label has no dialogue.</p>
            </div>
          )}
        </div>

        {/* Bottom Ren'Py panel. Replaces the old top-bar + dialogue chrome
            with a single bottom strip that swaps content based on state:
              - dialogue: speaker name in green + text
              - choices: a row of pill buttons
              - ending: a small "THE END" plate
            Below either content is a horizontal divider and the quick-
            menu toolbar (Auto / F.Save / F.Load / History) styled after
            Ren'Py's default UI. */}
        <div
          className={
            "path-sim-renpy-panel" +
            (choicesActive ? " is-choosing" : "")
          }
          onClick={(e) => e.stopPropagation()}
        >
          {/* Backdrop fade — softens the photo behind the panel so the
              text stays readable on bright CGs. Positioned as a separate
              div so its blur doesn't bleed into the text rendering. */}
          <div className="path-sim-renpy-fade" aria-hidden />

          <div className="path-sim-renpy-content">
            {choicesActive ? (
              <div className="path-sim-renpy-choices">
                {current.step.isReturn && callStack.length > 0 ? (
                  (() => {
                    const caller = callStack[callStack.length - 1];
                    const returnOpt: SimOption & { isReturnPop?: boolean } = {
                      label: `↩ Return to ${caller}`,
                      target: caller,
                      variant: "continue",
                      isReturnPop: true,
                    };
                    return (
                      <button
                        key="__return__"
                        type="button"
                        className="path-sim-renpy-choice is-return"
                        onClick={() => onChoose(returnOpt)}
                        title={`Pop call stack and resume in ${caller}`}
                      >
                        {returnOpt.label}
                      </button>
                    );
                  })()
                ) : current.step.isEnding ? (
                  <div className="path-sim-end">
                    <span className="path-sim-end-tag">▣ THE END</span>
                    <p>
                      This label has no outbound flow. Use{" "}
                      <kbd>Backspace</kbd> to step back or{" "}
                      <kbd>R</kbd> to restart.
                    </p>
                  </div>
                ) : (
                  current.step.options.map((opt, i) => (
                    <button
                      key={i}
                      type="button"
                      className={
                        "path-sim-renpy-choice is-" +
                        opt.variant +
                        (opt.target ? "" : " is-broken") +
                        (opt.isCall ? " is-call" : "")
                      }
                      onClick={() => onChoose(opt)}
                      disabled={!opt.target}
                      title={
                        opt.target
                          ? opt.isCall
                            ? `call ${opt.target} (returns here)`
                            : `Go to ${opt.target}`
                          : "Target label doesn't exist in this project"
                      }
                    >
                      {opt.label}
                    </button>
                  ))
                )}
              </div>
            ) : currentSayEvent ? (
              <div className="path-sim-renpy-dialogue">
                {currentSayEvent.kind === "say" && (
                  <SpeakerPlate
                    speaker={currentSayEvent.speaker}
                    speakerVar={currentSayEvent.speakerVar}
                    charByVar={charByVar}
                  />
                )}
                {currentSayEvent.kind === "narrator" && (
                  <div className="path-sim-renpy-speaker is-narrator">
                    Narration
                  </div>
                )}
                {currentSayEvent.kind === "note" && (
                  <div className="path-sim-renpy-speaker is-note">
                    Note
                  </div>
                )}
                <p
                  className={
                    "path-sim-renpy-text is-" + currentSayEvent.kind
                  }
                >
                  {currentSayEvent.text}
                </p>
              </div>
            ) : (
              <div className="path-sim-renpy-dialogue">
                <div className="path-sim-renpy-speaker is-narrator">
                  {current.step.labelName}
                </div>
                <p className="path-sim-renpy-text is-narrator">
                  Click anywhere or press <kbd>Space</kbd> to begin.
                </p>
              </div>
            )}
          </div>

          {/* Divider strip — design token from Figma (1138px max-width,
              centered, very subtle alpha). */}
          <div className="path-sim-renpy-divider" aria-hidden />

          {/* Quick menu — Auto / F.Save / F.Load / [stretch] / History.
              Matches Ren'Py's default bottom-bar layout. Save/Load/Auto
              are stubbed for now; History toggles the existing side
              panel. */}
          <div className="path-sim-renpy-toolbar">
            <button
              type="button"
              className="path-sim-renpy-btn is-primary"
              disabled
              title="Auto-advance — coming soon"
            >
              Auto
            </button>
            <span className="path-sim-renpy-toolbar-sep" aria-hidden />
            <button
              type="button"
              className="path-sim-renpy-btn"
              disabled
              title="Quick save — coming soon"
            >
              F. Save
            </button>
            <button
              type="button"
              className="path-sim-renpy-btn"
              disabled
              title="Quick load — coming soon"
            >
              F. Load
            </button>
            <button
              type="button"
              className="path-sim-renpy-btn"
              onClick={onBack}
              disabled={history.length <= 1}
              title="Step back (Backspace)"
            >
              ← Back
            </button>
            <span className="path-sim-renpy-toolbar-spacer" aria-hidden />
            <button
              type="button"
              className={
                "path-sim-renpy-btn" + (historyOpen ? " is-active" : "")
              }
              onClick={() => setHistoryOpen((v) => !v)}
              title="Toggle history"
            >
              History
            </button>
          </div>
        </div>

        {/* History side drawer — collapsible, doesn't steal space when closed. */}
        {historyOpen && (
          <aside className="path-sim-history">
            <div className="path-sim-history-head">
              History
              <button
                type="button"
                className="path-sim-history-close"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close history"
              >
                ✕
              </button>
            </div>
            <ol className="path-sim-history-list">
              {history.map((h, i) => {
                const isLast = i === history.length - 1;
                return (
                  <li
                    key={i}
                    ref={isLast ? historyEndRef : undefined}
                    className={
                      "path-sim-history-row" + (isLast ? " is-current" : "")
                    }
                  >
                    <div className="path-sim-history-label">
                      <span className="path-sim-history-name">
                        {h.step.labelName}
                      </span>
                      {onJumpToLabel && (
                        <button
                          type="button"
                          className="path-sim-history-jump"
                          onClick={() => onJumpToLabel(h.step.labelName)}
                          title="Reveal on canvas"
                        >
                          ↗
                        </button>
                      )}
                    </div>
                    <div className="path-sim-history-scene">
                      {h.step.sceneTitle}
                    </div>
                    {h.chosen && (
                      <div
                        className={
                          "path-sim-history-chosen is-" + h.chosen.variant
                        }
                      >
                        {h.chosen.variant === "choice"
                          ? `≡ ${h.chosen.label}`
                          : h.chosen.label}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </aside>
        )}
      </div>
    </div>
  );
}

function SpeakerPlate({
  speaker,
  speakerVar,
  charByVar,
}: {
  speaker: string;
  speakerVar: string;
  charByVar: Map<string, GraphCharacter>;
}) {
  // Try resolving by the display name first (more user-meaningful), then
  // by var. The lookup map is keyed by lowercased name, so we try both.
  const resolved =
    charByVar.get(speaker.toLowerCase()) ?? charByVar.get(speakerVar.toLowerCase());
  return (
    <div
      className="path-sim-speaker"
      style={
        resolved
          ? ({ "--char-color": resolved.color } as React.CSSProperties)
          : undefined
      }
    >
      {speaker}
    </div>
  );
}
