import { useTranslation } from "react-i18next";
import {
  ChartBarSquareIcon,
  ChatBubbleLeftEllipsisIcon,
  CursorArrowRaysIcon,
  HandRaisedIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/solid";

export type ToolMode = "select" | "pan" | "add-scene" | "add-note";

interface Props {
  mode: ToolMode;
  onChange: (m: ToolMode) => void;
  onAutoMatch: () => void;
  onSearch: () => void;
  onCoverageToggle: () => void;
  coverageActive: boolean;
}

interface Tool {
  id: ToolMode;
  labelKey: string;
  shortcut: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

/**
 * Bottom-center floating tool palette — Figma-style.
 *
 * Lives inside the canvas stage, centered along the bottom edge. Holds the
 * primary tools (Select / Pan / Add scene / Add note) plus quick-access
 * actions (Auto-match, Coverage, Search). Same floating-overlay surface
 * tokens as the minimap / controls dock so it reads as part of the same
 * chrome system.
 */
export function GraphBottomToolbar({
  mode,
  onChange,
  onAutoMatch,
  onSearch,
  onCoverageToggle,
  coverageActive,
}: Props) {
  const { t } = useTranslation();

  const tools: Tool[] = [
    { id: "select", labelKey: "graph.tool.select", shortcut: "V", Icon: CursorArrowRaysIcon },
    { id: "pan", labelKey: "graph.tool.pan", shortcut: "H", Icon: HandRaisedIcon },
    { id: "add-scene", labelKey: "graph.tool.add_scene", shortcut: "S", Icon: Squares2X2Icon },
    { id: "add-note", labelKey: "graph.tool.add_note", shortcut: "N", Icon: ChatBubbleLeftEllipsisIcon },
  ];

  return (
    <div className="graph-bottom-toolbar" role="toolbar" aria-label="Canvas tools">
      {tools.map((tool) => {
        const label = t(tool.labelKey);
        const isActive = mode === tool.id;
        return (
          <button
            key={tool.id}
            type="button"
            className={"graph-bt-btn" + (isActive ? " is-active" : "")}
            onClick={() => onChange(tool.id)}
            title={`${label} (${tool.shortcut})`}
            aria-label={label}
            aria-pressed={isActive}
          >
            <tool.Icon className="graph-bt-icon" />
          </button>
        );
      })}

      <span className="graph-bt-divider" aria-hidden />

      <button
        type="button"
        className="graph-bt-btn"
        onClick={onAutoMatch}
        title="Auto-match scenes to photos by filename"
        aria-label="Auto-match"
      >
        <SparklesIcon className="graph-bt-icon" />
      </button>

      <button
        type="button"
        className={"graph-bt-btn" + (coverageActive ? " is-active" : "")}
        onClick={onCoverageToggle}
        title="Path coverage panel"
        aria-label="Coverage"
        aria-pressed={coverageActive}
      >
        <ChartBarSquareIcon className="graph-bt-icon" />
      </button>

      <span className="graph-bt-divider" aria-hidden />

      <button
        type="button"
        className="graph-bt-btn"
        onClick={onSearch}
        title={t("graph.search_labels")}
        aria-label={t("graph.search_labels")}
      >
        <MagnifyingGlassIcon className="graph-bt-icon" />
      </button>
    </div>
  );
}
