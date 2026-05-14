/**
 * Pure path-comparison helper. Given the graph adjacency (from buildGraph's
 * non-broken edges) and two target labels, computes:
 *   - their lowest common ancestor (LCA) in the DAG — the latest point at
 *     which the story still flowed identically toward both targets;
 *   - the set of nodes / edges lying on any path LCA → A, and LCA → B;
 *   - per-branch counts (label count, edge count, accumulated word count).
 *
 * "Lowest" here is "deepest from entry" — the LCA closest to the targets,
 * matching how authors think about it ("where did the story diverge").
 * DAGs can have multiple deepest common ancestors; we pick one canonically
 * (max BFS depth from entry, ties broken lexicographically by label name)
 * so the result is stable across renders.
 *
 * No React, no DOM. Call site supplies primitives — easy to unit-test.
 */

export interface CompareEdge {
  id: string;
  source: string;
  target: string;
}

export interface CompareNodeMeta {
  /** label id == name */
  id: string;
  /** Word count of the segment — accumulates into branch totals. */
  wordCount: number;
}

export interface CompareInput {
  entry: string | null;
  /** All non-broken edges. Direction matters. */
  edges: CompareEdge[];
  /** Word-count map per label, drives the per-branch wordCount sums. */
  nodes: Map<string, CompareNodeMeta>;
  /** First target ("A"). */
  a: string;
  /** Second target ("B"). */
  b: string;
}

export interface CompareBranch {
  /** Every node reachable from LCA on some path to the target (inclusive). */
  nodeIds: Set<string>;
  /** Every edge lying on such a path. */
  edgeIds: Set<string>;
  /** Length of the *shortest* LCA → target path in edges. */
  shortestEdges: number;
  /** Sum of `nodes.get(...).wordCount` across `nodeIds` excluding LCA itself. */
  wordCount: number;
}

export interface CompareResult {
  lca: string;
  /** Common prefix: any node + edge lying on a path entry → LCA (inclusive
   *  of LCA, exclusive of entry's edges into nothing). Highlighted in
   *  a neutral colour by the UI so the user sees the "shared story". */
  commonNodeIds: Set<string>;
  commonEdgeIds: Set<string>;
  branchA: CompareBranch;
  branchB: CompareBranch;
}

/** Build forward + reverse adjacency once. Returns helpers. */
function buildAdjacency(edges: CompareEdge[]) {
  const fwd = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  for (const e of edges) {
    (fwd.get(e.source) ?? fwd.set(e.source, []).get(e.source)!).push(e.target);
    (rev.get(e.target) ?? rev.set(e.target, []).get(e.target)!).push(e.source);
  }
  return { fwd, rev };
}

/** BFS from `start` via the given adjacency. Returns visited set + depths. */
function bfs(
  start: string,
  adj: Map<string, string[]>,
): { visited: Set<string>; depth: Map<string, number> } {
  const visited = new Set<string>([start]);
  const depth = new Map<string, number>([[start, 0]]);
  const queue: string[] = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    const next = adj.get(cur);
    if (!next) continue;
    for (const n of next) {
      if (visited.has(n)) continue;
      visited.add(n);
      depth.set(n, d + 1);
      queue.push(n);
    }
  }
  return { visited, depth };
}

/**
 * Edges that lie on some forward path from `from` to anywhere in `endpoints`.
 * Computed as: edges where source is reachable forward from `from` AND
 * target is reachable backward from one of `endpoints` AND both endpoints
 * are within the LCA's descendants. Cheap when run on a single branch.
 */
function pathEdges(
  edges: CompareEdge[],
  fromDescendants: Set<string>,
  toAncestors: Set<string>,
): Set<string> {
  const out = new Set<string>();
  for (const e of edges) {
    if (fromDescendants.has(e.source) && toAncestors.has(e.target)) {
      out.add(e.id);
    }
  }
  return out;
}

export function comparePaths(input: CompareInput): CompareResult | null {
  const { entry, edges, nodes, a, b } = input;
  if (a === b) return null;
  if (!nodes.has(a) || !nodes.has(b)) return null;

  const { fwd, rev } = buildAdjacency(edges);

  // Ancestor sets (inclusive of self) — used both for LCA selection and
  // for path-edge filtering downstream.
  const ancA = bfs(a, rev).visited;
  const ancB = bfs(b, rev).visited;

  // Common ancestors — the candidate set for LCA.
  const common = new Set<string>();
  for (const n of ancA) if (ancB.has(n)) common.add(n);
  if (common.size === 0) return null;

  // Pick the deepest common ancestor by depth-from-entry. If entry is
  // unknown OR not in `common` we fall back to picking the candidate with
  // the most ancestors-in-common (a structural depth proxy).
  let lca: string | null = null;
  if (entry && common.has(entry)) {
    // Common ancestors include entry — measure depth from there.
    const { depth } = bfs(entry, fwd);
    let best = -1;
    let bestId: string | null = null;
    for (const c of common) {
      const d = depth.get(c) ?? -1;
      if (
        d > best ||
        (d === best && bestId !== null && c.localeCompare(bestId) < 0)
      ) {
        best = d;
        bestId = c;
      }
    }
    lca = bestId;
  } else {
    // No entry context — use ancestor count: more ancestors == deeper in
    // the topology. Tie-break by name for stability.
    let best = -1;
    let bestId: string | null = null;
    for (const c of common) {
      const ancC = bfs(c, rev).visited;
      const score = ancC.size;
      if (
        score > best ||
        (score === best && bestId !== null && c.localeCompare(bestId) < 0)
      ) {
        best = score;
        bestId = c;
      }
    }
    lca = bestId;
  }
  if (!lca) return null;

  // Descendants of LCA — restricts paths to the post-divergence sub-graph.
  const descLCA = bfs(lca, fwd).visited;

  // For each branch: edges whose source is a descendant of LCA AND whose
  // target is an ancestor (or equal) of the target. Plus the node set.
  const branchEdges = (target: string, targetAncestors: Set<string>) => {
    const eIds = pathEdges(edges, descLCA, targetAncestors);
    // Node set: any node that's on the source or target end of one of these
    // edges. We also include LCA + target explicitly (covers degenerate
    // single-step LCA == target.parent cases and direct LCA == target).
    const nIds = new Set<string>([lca!, target]);
    for (const e of edges) {
      if (!eIds.has(e.id)) continue;
      nIds.add(e.source);
      nIds.add(e.target);
    }
    return { eIds, nIds };
  };

  const A = branchEdges(a, ancA);
  const B = branchEdges(b, ancB);

  // Shortest-path-in-edges via forward BFS from LCA, restricted to nodes
  // in the branch. Returns Infinity if unreachable (shouldn't happen given
  // the construction, but guard the math anyway).
  const shortest = (target: string, allowed: Set<string>): number => {
    if (target === lca) return 0;
    const visited = new Set<string>([lca!]);
    const queue: Array<{ id: string; d: number }> = [{ id: lca!, d: 0 }];
    while (queue.length > 0) {
      const { id, d } = queue.shift()!;
      const next = fwd.get(id);
      if (!next) continue;
      for (const n of next) {
        if (!allowed.has(n) || visited.has(n)) continue;
        if (n === target) return d + 1;
        visited.add(n);
        queue.push({ id: n, d: d + 1 });
      }
    }
    return Infinity;
  };

  const sumWords = (ids: Set<string>): number => {
    let total = 0;
    for (const id of ids) {
      if (id === lca) continue;
      total += nodes.get(id)?.wordCount ?? 0;
    }
    return total;
  };

  // Common prefix: entry → LCA. Build when we have an entry; otherwise
  // leave empty (rare path, e.g. project with no canonical start).
  const commonNodeIds = new Set<string>();
  const commonEdgeIds = new Set<string>();
  if (entry && entry !== lca) {
    const ancLCA = bfs(lca, rev).visited;
    const descEntry = bfs(entry, fwd).visited;
    for (const e of edges) {
      if (descEntry.has(e.source) && ancLCA.has(e.target)) {
        commonEdgeIds.add(e.id);
        commonNodeIds.add(e.source);
        commonNodeIds.add(e.target);
      }
    }
  }
  // Always include LCA in the common-node set so the UI paints it as the
  // divergence point even when entry == LCA.
  commonNodeIds.add(lca);

  return {
    lca,
    commonNodeIds,
    commonEdgeIds,
    branchA: {
      nodeIds: A.nIds,
      edgeIds: A.eIds,
      shortestEdges: shortest(a, A.nIds),
      wordCount: sumWords(A.nIds),
    },
    branchB: {
      nodeIds: B.nIds,
      edgeIds: B.eIds,
      shortestEdges: shortest(b, B.nIds),
      wordCount: sumWords(B.nIds),
    },
  };
}
