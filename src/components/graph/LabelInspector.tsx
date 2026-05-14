import { useMemo } from "react";
import type { RpyBlocks } from "../../lib/renpy/blocks";
import type { GraphSourceRow } from "./graphBuild";
import type { LabelNodeDatum } from "./graphLayout";
import { findLabelSlice, parseLabelDetails } from "./labelDetails";

interface Props {
  /** The label node selected in xyflow (id == label name). Null hides the panel. */
  selected:
    | (LabelNodeDatum & { id: string })
    | null;
  /** All scene rows currently loaded — used to look up rpy_blocks by sceneId. */
  sourceRows: GraphSourceRow[];
  /** Inbound edges into the selected label (label names of sources).
   *  Lets the user see "who lands here" without hunting in the canvas. */
  inboundLabels: string[];
  /** Set of label names that exist in the graph. Refs to labels OUTSIDE
   *  this set are dangling (broken); we render those as plain text rather
   *  than clickable buttons so the user understands they go nowhere. */
  knownLabels: Set<string>;
  /** Camera-jump + select a label by name. Called from clickable refs in
   *  outbound/inbound/conditional/choice.outgoing rows. No-op for broken refs. */
  onJumpToLabel: (labelName: string) => void;
  /** Open the scene in Script editor (positions to this label's parent scene). */
  onOpenScene: () => void;
  onClose: () => void;
}

export function LabelInspector({
  selected,
  sourceRows,
  inboundLabels,
  knownLabels,
  onJumpToLabel,
  onOpenScene,
  onClose,
}: Props) {
  // Memo so a re-render from xyflow drag doesn't reparse blocks.
  const details = useMemo(() => {
    if (!selected) return null;
    const scene = sourceRows.find((r) => r.id === selected.sceneId);
    const blocks: RpyBlocks | null = scene?.rpy_blocks ?? null;
    if (!blocks) return null;
    const slice = findLabelSlice(blocks, selected.id);
    if (!slice) return null;
    return parseLabelDetails(slice);
  }, [selected, sourceRows]);

  if (!selected) return null;

  // Renders a label target as a button when it exists in the graph, or a
  // dimmed code span when it's dangling. Click on a valid target pans the
  // camera + selects that node.
  const renderTarget = (name: string) => {
    const exists = knownLabels.has(name);
    if (exists) {
      return (
        <button
          type="button"
          className="graph-inspector-target"
          onClick={() => onJumpToLabel(name)}
          title={`Jump to ${name}`}
        >
          {name}
        </button>
      );
    }
    return (
      <code
        className="graph-inspector-target is-broken"
        title="Target not found in this project"
      >
        {name}
      </code>
    );
  };

  return (
    <aside className="graph-inspector">
      <header className="graph-inspector-header">
        <div className="graph-inspector-title">
          <div className="graph-inspector-label">
            {selected.emoji && <span>{selected.emoji}</span>}
            <span className="graph-inspector-label-name">{selected.label}</span>
          </div>
          <div className="graph-inspector-scene">
            {selected.chapter && <span>{selected.chapter} · </span>}
            <span>{selected.sceneTitle}</span>
          </div>
          {(selected.povName || selected.wordCount > 0) && (
            <div className="graph-inspector-meta">
              {selected.povName && (
                <span
                  className="graph-inspector-pov"
                  style={
                    selected.povColor
                      ? { color: selected.povColor }
                      : undefined
                  }
                >
                  <span
                    className="graph-inspector-pov-dot"
                    style={
                      selected.povColor
                        ? { background: selected.povColor }
                        : undefined
                    }
                  />
                  POV: {selected.povName}
                </span>
              )}
              {selected.wordCount > 0 && (
                <span className="graph-inspector-words">
                  {selected.wordCount} words
                </span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          className="graph-inspector-close"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close inspector"
        >
          ✕
        </button>
      </header>

      {/* ---- Flags ------------------------------------------------------ */}
      {(selected.isEntry ||
        selected.isOrphan ||
        selected.isUnreachable ||
        selected.isEnding ||
        selected.brokenOutboundCount > 0 ||
        selected.isImplicit) && (
        <div className="graph-inspector-flags">
          {selected.isEntry && (
            <span className="graph-flag graph-flag-entry">START</span>
          )}
          {!selected.isEntry && selected.isOrphan && (
            <span className="graph-flag graph-flag-orphan">ORPHAN</span>
          )}
          {!selected.isEntry &&
            selected.isUnreachable &&
            !selected.isOrphan && (
              <span className="graph-flag graph-flag-unreachable">
                UNREACHABLE
              </span>
            )}
          {!selected.isEntry && selected.isEnding && (
            <span className="graph-flag graph-flag-ending">ENDING</span>
          )}
          {selected.brokenOutboundCount > 0 && (
            <span className="graph-flag graph-flag-broken">
              ⚠ {selected.brokenOutboundCount} BROKEN OUT
            </span>
          )}
          {selected.isImplicit && (
            <span className="graph-flag graph-flag-implicit">
              IMPLICIT LABEL
            </span>
          )}
        </div>
      )}

      <div className="graph-inspector-body">
        {!details && (
          <p className="graph-inspector-empty">
            No structured body parsed for this label. Open it in Script to see
            the raw content.
          </p>
        )}

        {/* ---- Menus ---------------------------------------------------- */}
        {details && details.menus.length > 0 && (
          <section className="graph-inspector-section">
            <h3 className="graph-inspector-heading">
              Choices
              <span className="graph-inspector-count">
                {details.menus.reduce((n, m) => n + m.choices.length, 0)}
              </span>
            </h3>
            {details.menus.map((menu, mi) => (
              <div key={mi} className="graph-inspector-menu">
                {menu.choices.map((c, ci) => (
                  <div key={ci} className="graph-inspector-choice">
                    <div className="graph-inspector-choice-text">
                      ≡ {c.text}
                      {c.condition && (
                        <span className="graph-inspector-choice-cond">
                          {" "}if {c.condition}
                        </span>
                      )}
                    </div>
                    {c.outgoing && (
                      <div className="graph-inspector-choice-out">
                        {c.outgoing.kind === "jump" ? "→ jump " : "↪ call "}
                        {renderTarget(c.outgoing.target)}
                      </div>
                    )}
                    {c.effects.length > 0 && (
                      <ul className="graph-inspector-effects">
                        {c.effects.map((e, ei) => (
                          <li key={ei}>
                            <code>{e}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                    {!c.outgoing && c.effects.length === 0 && (
                      <div className="graph-inspector-choice-empty">
                        (no effect — pure dialog branch)
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </section>
        )}

        {/* ---- Direct refs --------------------------------------------- */}
        {details && details.directRefs.length > 0 && (
          <section className="graph-inspector-section">
            <h3 className="graph-inspector-heading">
              Outbound
              <span className="graph-inspector-count">
                {details.directRefs.length}
              </span>
            </h3>
            <ul className="graph-inspector-refs">
              {details.directRefs.map((r, i) => (
                <li key={i}>
                  <span className="graph-inspector-ref-kind">{r.kind}</span>
                  {renderTarget(r.target)}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---- Conditional branches ------------------------------------ */}
        {details && details.conditionals.length > 0 && (
          <section className="graph-inspector-section">
            <h3 className="graph-inspector-heading">
              Conditional
              <span className="graph-inspector-count">
                {details.conditionals.length}
              </span>
            </h3>
            {details.conditionals.map((c, i) => (
              <div key={i} className="graph-inspector-cond">
                <div className="graph-inspector-cond-head">
                  <code>{c.condition}</code>
                </div>
                <ul className="graph-inspector-refs">
                  {c.refs.map((r, ri) => (
                    <li key={ri}>
                      <span className="graph-inspector-ref-kind">{r.kind}</span>
                      {renderTarget(r.target)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        {/* ---- Inbound -------------------------------------------------- */}
        {inboundLabels.length > 0 && (
          <section className="graph-inspector-section">
            <h3 className="graph-inspector-heading">
              Inbound
              <span className="graph-inspector-count">
                {inboundLabels.length}
              </span>
            </h3>
            <ul className="graph-inspector-refs">
              {inboundLabels.map((src) => (
                <li key={src}>
                  <span className="graph-inspector-ref-kind">from</span>
                  {renderTarget(src)}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---- Called from -------------------------------------------- */}
        {/* Subset of Inbound: only labels that reach this one via `call`.
            Surfaced separately because for a subroutine these are the
            real "users" — control comes back to each of them via return. */}
        {selected.isSubroutine && selected.callers.length > 0 && (
          <section className="graph-inspector-section">
            <h3 className="graph-inspector-heading">
              Called from
              <span className="graph-inspector-count">
                {selected.callers.length}
              </span>
            </h3>
            <ul className="graph-inspector-refs">
              {selected.callers.map((src) => (
                <li key={src}>
                  <span className="graph-inspector-ref-kind">⤴ call</span>
                  {renderTarget(src)}
                </li>
              ))}
            </ul>
          </section>
        )}
        {selected.isSubroutine && selected.callers.length === 0 && (
          <section className="graph-inspector-section">
            <h3 className="graph-inspector-heading">Subroutine</h3>
            <p className="graph-inspector-empty">
              This label ends with <code>return</code> but nothing
              <code> call</code>s it. It will run only if reached via a
              fall-through or jump — control then ends the story instead
              of resuming a caller.
            </p>
          </section>
        )}

        {/* ---- Top-level $-effects ------------------------------------- */}
        {details && details.topLevelEffects.length > 0 && (
          <section className="graph-inspector-section">
            <h3 className="graph-inspector-heading">
              Effects
              <span className="graph-inspector-count">
                {details.topLevelEffects.length}
              </span>
            </h3>
            <ul className="graph-inspector-effects">
              {details.topLevelEffects.map((e, i) => (
                <li key={i}>
                  <code>{e}</code>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <footer className="graph-inspector-footer">
        <button
          type="button"
          className="graph-inspector-open"
          onClick={onOpenScene}
        >
          Open in Script →
        </button>
      </footer>
    </aside>
  );
}
