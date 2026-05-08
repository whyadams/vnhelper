/**
 * Story-flow graph schema. Each node is a typed "block" (scene / choice /
 * condition / ending) with explicit handles. Edges connect a (node, handleId)
 * source to a (node, handleId) target. Persisted as JSON in
 * `graph_boards.data`.
 */

export type BlockType = "scene" | "choice" | "condition" | "ending";
export type HandleRole = "in" | "out";
export type HandleSide = "top" | "right" | "bottom" | "left";

/** Per-block-type data shapes — flattened onto each node row. */
export interface SceneData {
  character: string;
  text: string;
}
export interface ChoiceData {
  prompt: string;
  options: string[];
}
export interface ConditionData {
  flag: string;
}
export interface EndingData {
  title: string;
}

export type GraphNodeBase = {
  id: string;
  x: number;
  y: number;
};

export type SceneNode = GraphNodeBase & { type: "scene" } & SceneData;
export type ChoiceNode = GraphNodeBase & { type: "choice" } & ChoiceData;
export type ConditionNode = GraphNodeBase & { type: "condition" } & ConditionData;
export type EndingNode = GraphNodeBase & { type: "ending" } & EndingData;

export type GraphNode = SceneNode | ChoiceNode | ConditionNode | EndingNode;

export interface GraphEdge {
  id: string;
  from: string;
  fromHandle: string;
  to: string;
  toHandle: string;
  label: string;
}

export interface Viewport {
  panX: number;
  panY: number;
  zoom: number;
}

export const DEFAULT_VIEWPORT: Viewport = { panX: 0, panY: 0, zoom: 1 };

export interface GraphBoard {
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewport?: Viewport;
}

export interface HandleSpec {
  id: string;
  role: HandleRole;
  side: HandleSide;
  optionIndex?: number;
}

interface BlockTypeSpec {
  label: string;
  /** Pencil-palette muted accent shown on the left edge / glyph. */
  accent: string;
  defaultData: () => SceneData | ChoiceData | ConditionData | EndingData;
  size: (node: GraphNode) => { w: number; h: number };
  handles: (node: GraphNode) => HandleSpec[];
}

export const STUB = 22;
export const CORNER_RADIUS = 12;
export const HANDLE = 12;
export const HANDLE_HIT = 26;
export const PALETTE_WIDTH = 196;

export const BLOCK_TYPES: Record<BlockType, BlockTypeSpec> = {
  scene: {
    label: "Scene",
    accent: "#a89882",
    defaultData: (): SceneData => ({ character: "", text: "" }),
    size: () => ({ w: 220, h: 168 }),
    handles: () => [
      { id: "top", role: "in", side: "top" },
      { id: "bottom", role: "out", side: "bottom" },
    ],
  },
  choice: {
    label: "Choice",
    accent: "#9e8aa8",
    defaultData: (): ChoiceData => ({ prompt: "", options: ["", ""] }),
    size: (node) => {
      const opts = node.type === "choice" ? node.options.length : 2;
      return { w: 240, h: 80 + opts * 36 };
    },
    handles: (node) => {
      const list: HandleSpec[] = [{ id: "left", role: "in", side: "left" }];
      const opts = node.type === "choice" ? node.options : [];
      opts.forEach((_, i) => {
        list.push({
          id: `option-${i}`,
          role: "out",
          side: "right",
          optionIndex: i,
        });
      });
      return list;
    },
  },
  condition: {
    label: "Condition",
    accent: "#7a9994",
    defaultData: (): ConditionData => ({ flag: "" }),
    size: () => ({ w: 200, h: 130 }),
    handles: () => [
      { id: "top", role: "in", side: "top" },
      { id: "true", role: "out", side: "right" },
      { id: "false", role: "out", side: "left" },
    ],
  },
  ending: {
    label: "Ending",
    accent: "#a87080",
    defaultData: (): EndingData => ({ title: "" }),
    size: () => ({ w: 180, h: 96 }),
    handles: () => [{ id: "top", role: "in", side: "top" }],
  },
};

export function nodeSize(node: GraphNode): { w: number; h: number } {
  return BLOCK_TYPES[node.type].size(node);
}

export function nodeHandles(node: GraphNode): HandleSpec[] {
  return BLOCK_TYPES[node.type].handles(node);
}

export function findHandle(
  node: GraphNode,
  handleId: string,
): HandleSpec | null {
  return nodeHandles(node).find((h) => h.id === handleId) ?? null;
}

let idCounter = 0;
/** Bump the id counter so freshly-loaded nodes don't collide with new ones. */
export function bumpIdCounterFromNodes(nodes: GraphNode[]): void {
  for (const n of nodes) {
    const m = /^n(\d+)$/.exec(n.id);
    if (m) idCounter = Math.max(idCounter, parseInt(m[1], 10));
  }
}
export function nextNodeId(): string {
  return `n${++idCounter}`;
}
export function nextEdgeId(): string {
  return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Build a fully-typed node with defaults filled in. */
export function makeNode(type: BlockType, x: number, y: number): GraphNode {
  const data = BLOCK_TYPES[type].defaultData();
  const id = nextNodeId();
  // Trust the discriminated union — caller's `type` matches the data shape.
  return { id, type, x, y, ...(data as object) } as GraphNode;
}

/** Validate a node from JSON: ensure the type is known and required fields exist. */
export function reviveNode(raw: unknown): GraphNode | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = r.type as BlockType;
  if (!(type in BLOCK_TYPES)) return null;
  const id = typeof r.id === "string" ? r.id : null;
  if (!id) return null;
  const x = typeof r.x === "number" ? r.x : 0;
  const y = typeof r.y === "number" ? r.y : 0;
  const defaults = BLOCK_TYPES[type].defaultData();
  const merged: Record<string, unknown> = { id, type, x, y, ...defaults, ...r };
  // Trust merged shape — defaults guarantee required fields exist.
  return merged as unknown as GraphNode;
}
