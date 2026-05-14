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
      return;
    }
    const first = stepLabel(start, ctx);
    if (!first) {
      setHistory([]);
      return;
    }
    setHistory([{ step: first, chosen: null }]);
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
      setHistory((curr) => {
        const last = curr[curr.length - 1];
        if (!last) return curr;
        const stamped: HistoryEntry = { step: last.step, chosen: opt };
        return [...curr.slice(0, -1), stamped, { step: nextStep, chosen: null }];
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
    [ctx, replayStage],
  );

  const onBack = useCallback(() => {
    setHistory((curr) => {
      if (curr.length <= 1) return curr;
      const trimmed = curr.slice(0, -1);
      const tail = trimmed[trimmed.length - 1];
      if (!tail) return trimmed;
      // Restore the previous step to the moment AFTER its readable events
      // (i.e. the choice screen the user was looking at when they advanced).
      const restored: HistoryEntry = { step: tail.step, chosen: null };
      const result = [...trimmed.slice(0, -1), restored];
      setEventIndex(tail.step.events.length);
      replayStage(tail.step, tail.step.events.length);
      return result;
    });
  }, [replayStage]);

  const onRestart = useCallback(() => {
    const start = startLabel ?? ctx.entryLabel;
    if (!start) return;
    const first = stepLabel(start, ctx);
    if (!first) return;
    setHistory([{ step: first, chosen: null }]);
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
        {/* Top bar: scene/label info + chrome (back / restart / history / close) */}
        <header className="path-sim-topbar">
          <div className="path-sim-topbar-left">
            <span className="path-sim-eyebrow">{current.step.sceneTitle}</span>
            <span className="path-sim-label-name">{current.step.labelName}</span>
          </div>
          <div className="path-sim-topbar-right">
            {bg && (
              <span className="path-sim-bg-tag" title="Current scene background">
                bg: {bg}
              </span>
            )}
            <button
              type="button"
              className="path-sim-action"
              onClick={onBack}
              disabled={history.length <= 1}
              title="Step back (Backspace)"
            >
              ← Back
            </button>
            <button
              type="button"
              className="path-sim-action"
              onClick={onRestart}
              title="Restart from entry"
            >
              ⟲ Restart
            </button>
            <button
              type="button"
              className={
                "path-sim-action" + (historyOpen ? " is-active" : "")
              }
              onClick={() => setHistoryOpen((v) => !v)}
              title="Toggle history"
            >
              ☰ {history.length}
            </button>
            {onJumpToLabel && (
              <button
                type="button"
                className="path-sim-action"
                onClick={() => onJumpToLabel(current.step.labelName)}
                title="Reveal this label on canvas"
              >
                ↗ Reveal
              </button>
            )}
            <button
              type="button"
              className="path-sim-close"
              onClick={onClose}
              aria-label="Close simulator"
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>
        </header>

        <div
          className={"path-sim-stage" + (choicesActive ? " is-choosing" : "")}
          onClick={onStageClick}
        >
          {/* Character chips — drift left/center/right based on `position`. */}
          <div className="path-sim-cast">
            {visibleChars.map((c) => {
              const resolved = charByVar.get(c.char.toLowerCase());
              return (
                <div
                  key={c.char}
                  className={
                    "path-sim-cast-chip is-pos-" + (c.position || "center")
                  }
                  style={
                    resolved
                      ? ({ "--char-color": resolved.color } as React.CSSProperties)
                      : undefined
                  }
                >
                  <span className="path-sim-cast-emoji">
                    {resolved && resolved.name
                      ? resolved.name.charAt(0).toUpperCase()
                      : c.char.charAt(0).toUpperCase()}
                  </span>
                  <span className="path-sim-cast-name">
                    {resolved ? resolved.name : c.char}
                  </span>
                  {c.expression && (
                    <span className="path-sim-cast-expr">[{c.expression}]</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Choice overlay — shown after all events in this step are read. */}
          {choicesActive && (
            <div className="path-sim-choices" onClick={(e) => e.stopPropagation()}>
              {current.step.isEnding ? (
                <div className="path-sim-end">
                  <span className="path-sim-end-tag">▣ THE END</span>
                  <p>
                    This label has no outbound flow.<br />
                    Use <kbd>Back</kbd> to explore a different branch or
                    {" "}<kbd>Restart</kbd> to begin again.
                  </p>
                </div>
              ) : (
                current.step.options.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    className={
                      "path-sim-choice is-" +
                      opt.variant +
                      (opt.target ? "" : " is-broken")
                    }
                    onClick={() => onChoose(opt)}
                    disabled={!opt.target}
                    title={
                      opt.target
                        ? `Go to ${opt.target}`
                        : "Target label doesn't exist in this project"
                    }
                  >
                    <span className="path-sim-choice-label">{opt.label}</span>
                    {opt.hint && (
                      <span className="path-sim-choice-hint">{opt.hint}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}

          {/* Bottom dialogue bar — Ren'Py-shaped. Speaker plate sits above
              the text panel; clicking anywhere on the stage advances. */}
          {currentSayEvent && (
            <div className="path-sim-dialogue">
              {currentSayEvent.kind === "say" && (
                <SpeakerPlate
                  speaker={currentSayEvent.speaker}
                  speakerVar={currentSayEvent.speakerVar}
                  charByVar={charByVar}
                />
              )}
              <div
                className={
                  "path-sim-dialogue-body is-" + currentSayEvent.kind
                }
              >
                <p className="path-sim-dialogue-text">
                  {currentSayEvent.kind === "note"
                    ? `# ${currentSayEvent.text}`
                    : currentSayEvent.text}
                </p>
                <span className="path-sim-advance-hint" aria-hidden>
                  Click ▸ <kbd>Space</kbd>
                </span>
              </div>
            </div>
          )}

          {/* Empty state — when a label has zero readable events AND no
              choices visible yet (rare, but possible for label that's just
              show/hide and then nothing). */}
          {!currentSayEvent && !choicesActive && (
            <div className="path-sim-stage-empty">
              <p>This label has no dialogue.</p>
              <button
                type="button"
                className="path-sim-action"
                onClick={advance}
              >
                Skip to options →
              </button>
            </div>
          )}
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
