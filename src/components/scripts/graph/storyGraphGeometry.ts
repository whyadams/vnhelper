/**
 * Pure-geometry helpers for the story-flow canvas: handle positioning,
 * orthogonal route construction, rounded-corner SVG path generation, and
 * hit-testing utilities.
 */

import {
  CORNER_RADIUS,
  HANDLE_HIT,
  STUB,
  findHandle,
  nodeHandles,
  nodeSize,
  type GraphNode,
  type HandleRole,
  type HandleSide,
} from "./storyGraphTypes";

export interface Pt {
  x: number;
  y: number;
}

export function sideAxis(side: HandleSide): "h" | "v" {
  return side === "left" || side === "right" ? "h" : "v";
}

export function sideNormal(side: HandleSide): { dx: number; dy: number } {
  switch (side) {
    case "top":
      return { dx: 0, dy: -1 };
    case "right":
      return { dx: 1, dy: 0 };
    case "bottom":
      return { dx: 0, dy: 1 };
    case "left":
      return { dx: -1, dy: 0 };
  }
}

/**
 * World-space position of a specific handle on a node. For most handles we
 * use the side midpoint; for choice's `option-N` handles we offset vertically
 * so each output sits on the row of its option.
 */
export function handlePoint(node: GraphNode, handleId: string): Pt {
  const { w, h } = nodeSize(node);
  const handle = findHandle(node, handleId);
  if (!handle) return { x: node.x + w / 2, y: node.y + h / 2 };

  if (node.type === "choice" && handleId.startsWith("option-")) {
    const idx = handle.optionIndex ?? 0;
    // Layout inside choice: header + prompt = 60px before options.
    const optionsTop = 60;
    const rowH = 36;
    return {
      x: node.x + w,
      y: node.y + optionsTop + idx * rowH + rowH / 2,
    };
  }

  switch (handle.side) {
    case "top":
      return { x: node.x + w / 2, y: node.y };
    case "right":
      return { x: node.x + w, y: node.y + h / 2 };
    case "bottom":
      return { x: node.x + w / 2, y: node.y + h };
    case "left":
      return { x: node.x, y: node.y + h / 2 };
  }
}

/** Hit-test: any handle (of given role) within HANDLE_HIT of (wx, wy). */
export function handleAt(
  nodes: GraphNode[],
  wx: number,
  wy: number,
  ignoreNodeId: string | null,
  requireRole: HandleRole | null,
): { nodeId: string; handleId: string } | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.id === ignoreNodeId) continue;
    for (const h of nodeHandles(n)) {
      if (requireRole && h.role !== requireRole) continue;
      const p = handlePoint(n, h.id);
      const dx = wx - p.x;
      const dy = wy - p.y;
      if (dx * dx + dy * dy <= HANDLE_HIT * HANDLE_HIT) {
        return { nodeId: n.id, handleId: h.id };
      }
    }
  }
  return null;
}

/** Closest handle of a given role on a given node. */
export function bestHandleOnNode(
  node: GraphNode,
  wx: number,
  wy: number,
  requireRole: HandleRole | null,
): string | null {
  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const h of nodeHandles(node)) {
    if (requireRole && h.role !== requireRole) continue;
    const p = handlePoint(node, h.id);
    const d = (wx - p.x) ** 2 + (wy - p.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestId = h.id;
    }
  }
  return bestId;
}

export function nodeAt(
  nodes: GraphNode[],
  wx: number,
  wy: number,
  ignoreId: string | null = null,
): GraphNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.id === ignoreId) continue;
    const { w, h } = nodeSize(n);
    if (wx >= n.x && wx <= n.x + w && wy >= n.y && wy <= n.y + h) return n;
  }
  return null;
}

/**
 * Orthogonal Manhattan route between two handle points, biased to leave
 * each side along its normal (the STUB segment) before turning.
 */
export function orthogonalWaypoints(
  p1: Pt,
  n1: { dx: number; dy: number },
  side1: HandleSide,
  p2: Pt,
  n2: { dx: number; dy: number },
  side2: HandleSide,
): Pt[] {
  const s1: Pt = { x: p1.x + n1.dx * STUB, y: p1.y + n1.dy * STUB };
  const s2: Pt = { x: p2.x + n2.dx * STUB, y: p2.y + n2.dy * STUB };
  const ax1 = sideAxis(side1);
  const ax2 = sideAxis(side2);
  const points: Pt[] = [p1, s1];

  if (side1 === side2) {
    if (ax1 === "h") {
      const outerX =
        side1 === "right" ? Math.max(s1.x, s2.x) : Math.min(s1.x, s2.x);
      points.push({ x: outerX, y: s1.y });
      points.push({ x: outerX, y: s2.y });
    } else {
      const outerY =
        side1 === "bottom" ? Math.max(s1.y, s2.y) : Math.min(s1.y, s2.y);
      points.push({ x: s1.x, y: outerY });
      points.push({ x: s2.x, y: outerY });
    }
  } else if (ax1 === ax2) {
    if (ax1 === "h") {
      const midX = (s1.x + s2.x) / 2;
      points.push({ x: midX, y: s1.y });
      points.push({ x: midX, y: s2.y });
    } else {
      const midY = (s1.y + s2.y) / 2;
      points.push({ x: s1.x, y: midY });
      points.push({ x: s2.x, y: midY });
    }
  } else {
    if (ax1 === "h") points.push({ x: s2.x, y: s1.y });
    else points.push({ x: s1.x, y: s2.y });
  }

  points.push(s2);
  points.push(p2);
  return collapseColinear(points);
}

function collapseColinear(points: Pt[]): Pt[] {
  const cleaned: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = cleaned[cleaned.length - 1];
    const cur = points[i];
    if (Math.abs(prev.x - cur.x) < 0.01 && Math.abs(prev.y - cur.y) < 0.01) {
      continue;
    }
    if (cleaned.length >= 2) {
      const prev2 = cleaned[cleaned.length - 2];
      if (
        (prev2.y === prev.y && prev.y === cur.y) ||
        (prev2.x === prev.x && prev.x === cur.x)
      ) {
        cleaned[cleaned.length - 1] = cur;
        continue;
      }
    }
    cleaned.push(cur);
  }
  return cleaned;
}

/** Produces an SVG path string with rounded corners between waypoints. */
export function orthogonalPath(points: Pt[], radius = CORNER_RADIUS): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r <= 0.5) {
      d += ` L ${cur.x} ${cur.y}`;
      continue;
    }
    const inDx = (cur.x - prev.x) / inLen;
    const inDy = (cur.y - prev.y) / inLen;
    const beforeX = cur.x - inDx * r;
    const beforeY = cur.y - inDy * r;
    const outDx = (next.x - cur.x) / outLen;
    const outDy = (next.y - cur.y) / outLen;
    const afterX = cur.x + outDx * r;
    const afterY = cur.y + outDy * r;
    d += ` L ${beforeX} ${beforeY} Q ${cur.x} ${cur.y} ${afterX} ${afterY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** Length-weighted midpoint along a polyline — used to anchor edge labels. */
export function orthogonalMidpoint(points: Pt[]): Pt {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  let total = 0;
  const lens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
    lens.push(l);
    total += l;
  }
  const half = total / 2;
  let acc = 0;
  for (let i = 0; i < lens.length; i++) {
    if (acc + lens[i] >= half) {
      const t = (half - acc) / lens[i];
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    }
    acc += lens[i];
  }
  return points[points.length - 1];
}

/**
 * Route from a fixed handle to a free cursor point — used during edge
 * creation/reconnection drag previews.
 */
export function freeOrthogonalPath(
  x1: number,
  y1: number,
  n1: { dx: number; dy: number },
  side1: HandleSide,
  x2: number,
  y2: number,
): { d: string; points: Pt[] } {
  const s1: Pt = { x: x1 + n1.dx * STUB, y: y1 + n1.dy * STUB };
  const points: Pt[] = [{ x: x1, y: y1 }, s1];
  if (sideAxis(side1) === "h") points.push({ x: x2, y: s1.y });
  else points.push({ x: s1.x, y: y2 });
  points.push({ x: x2, y: y2 });

  const cleaned = collapseColinear(points);
  return { d: orthogonalPath(cleaned), points: cleaned };
}

export interface EdgeGeom {
  d: string;
  points: Pt[];
  start: Pt;
  end: Pt;
}

export function pathBetween(
  a: GraphNode,
  handleA: string,
  b: GraphNode,
  handleB: string,
): EdgeGeom {
  const pa = handlePoint(a, handleA);
  const pb = handlePoint(b, handleB);
  const sideA = findHandle(a, handleA)?.side ?? "right";
  const sideB = findHandle(b, handleB)?.side ?? "left";
  const points = orthogonalWaypoints(
    pa,
    sideNormal(sideA),
    sideA,
    pb,
    sideNormal(sideB),
    sideB,
  );
  return { d: orthogonalPath(points), points, start: pa, end: pb };
}
