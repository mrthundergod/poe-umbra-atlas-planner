// Path planner: picks which nodes to allocate, starting from the root, so that the
// chosen target nodes get covered within a point budget (1 point per node).
//
// This is a budgeted, prize-collecting Steiner tree problem (NP-hard), solved with:
//   1. greedy growth: repeatedly connect the target with the best value / cost,
//      along the shortest path that passes the most other targets on the way;
//   2. pruning of dead-end nodes that carry no value;
//   3. local search: drop one or two target branches, regrow greedily, keep if better;
//   4. randomized restarts, keeping the best tree found.
// Scoring is lexicographic: total target weight first, then fewest points used.
const Solver = (() => {
  function build(edges) {
    const ids = [], index = new Map();
    const idx = id => { if (!index.has(id)) { index.set(id, ids.length); ids.push(id); } return index.get(id); };
    const lists = [];
    for (const [a, b] of edges) {
      const i = idx(a), j = idx(b);
      (lists[i] = lists[i] || []).push(j);
      (lists[j] = lists[j] || []).push(i);
    }
    const N = ids.length, off = new Int32Array(N + 1);
    for (let i = 0; i < N; i++) off[i + 1] = off[i] + (lists[i] ? lists[i].length : 0);
    const nb = new Int32Array(off[N]);
    for (let i = 0; i < N; i++) if (lists[i]) nb.set(lists[i], off[i]);
    return { ids, index, N, off, nb };
  }

  // seeded RNG so results are reproducible
  function rng(seed) {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // blocked: ids that must never be allocated or passed through
  // fixed: ids that every tree must keep (e.g. a smaller plan the bigger one has to grow out of)
  function create(g, rootId, weights, tieWeights, blockedIds, fixedIds) {
    const { N, off, nb } = g;
    const root = g.index.get(rootId);
    const w = new Float64Array(N), baseTie = new Float64Array(N), tie = new Float64Array(N);
    for (const [id, x] of weights) if (g.index.has(id) && g.index.get(id) !== root) w[g.index.get(id)] = x;
    if (tieWeights) for (const [id, x] of tieWeights) if (g.index.has(id)) baseTie[g.index.get(id)] = x;
    tie.set(baseTie);
    const blocked = new Uint8Array(N), fixed = new Uint8Array(N);
    if (fixedIds) for (const id of fixedIds) if (g.index.has(id)) fixed[g.index.get(id)] = 1;
    if (blockedIds) for (const id of blockedIds) if (g.index.has(id) && g.index.get(id) !== root) blocked[g.index.get(id)] = 1;
    const targets = [];
    for (let i = 0; i < N; i++) if (w[i] > 0) targets.push(i);

    const dist = new Int32Array(N), prev = new Int32Array(N), gain = new Float64Array(N), queue = new Int32Array(N);

    // multi-source BFS from the current tree; among equally short paths keep the one with most value
    function bfs(inTree, maxDist) {
      dist.fill(-1);
      let head = 0, tail = 0;
      for (let i = 0; i < N; i++) if (inTree[i]) { dist[i] = 0; gain[i] = 0; prev[i] = -1; queue[tail++] = i; }
      while (head < tail) {
        const u = queue[head++], du = dist[u];
        if (du >= maxDist) continue;
        for (let k = off[u]; k < off[u + 1]; k++) {
          const v = nb[k];
          if (blocked[v]) continue;
          const gv = gain[u] + w[v] + tie[v];
          if (dist[v] === -1) { dist[v] = du + 1; prev[v] = u; gain[v] = gv; queue[tail++] = v; }
          else if (dist[v] === du + 1 && gv > gain[v]) { prev[v] = u; gain[v] = gv; }
        }
      }
    }

    function size(inTree) { let s = 0; for (let i = 0; i < N; i++) if (inTree[i] && i !== root) s++; return s; }
    function value(inTree) { let s = 0; for (const t of targets) if (inTree[t]) s += w[t]; return s; }

    function greedy(inTree, budget, rand, alpha, noise) {
      let used = size(inTree);
      for (;;) {
        const left = budget - used;
        if (left <= 0) break;
        bfs(inTree, left);
        let best = -1, bestScore = -Infinity;
        for (const t of targets) {
          if (inTree[t] || dist[t] <= 0) continue;
          let s = gain[t] / Math.pow(dist[t], alpha);
          if (noise) s *= 1 + noise * (rand() - 0.5);
          if (s > bestScore) { bestScore = s; best = t; }
        }
        if (best < 0) break;
        for (let v = best; !inTree[v]; v = prev[v]) { inTree[v] = 1; used++; }
      }
      return inTree;
    }

    // remove dead-end nodes that have no target weight
    function prune(inTree) {
      const deg = new Int32Array(N), stack = [];
      for (let i = 0; i < N; i++) if (inTree[i])
        for (let k = off[i]; k < off[i + 1]; k++) if (inTree[nb[k]]) deg[i]++;
      for (let i = 0; i < N; i++) if (inTree[i] && i !== root && deg[i] <= 1 && !w[i] && !fixed[i]) stack.push(i);
      while (stack.length) {
        const u = stack.pop();
        if (!inTree[u]) continue;
        inTree[u] = 0;
        for (let k = off[u]; k < off[u + 1]; k++) {
          const v = nb[k];
          if (inTree[v] && --deg[v] <= 1 && v !== root && !w[v] && !fixed[v]) stack.push(v);
        }
      }
      return inTree;
    }

    // a node can be dropped without cutting the tree only while it has at most one tree neighbour
    function isLeaf(inTree, t) {
      let d = 0;
      for (let k = off[t]; k < off[t + 1]; k++) if (inTree[nb[k]] && ++d > 1) return false;
      return true;
    }

    function leafTargets(inTree) {
      const out = [];
      for (const t of targets) {
        if (!inTree[t] || fixed[t]) continue;
        let d = 0;
        for (let k = off[t]; k < off[t + 1]; k++) if (inTree[nb[k]]) d++;
        if (d <= 1) out.push(t);
      }
      return out;
    }

    const better = (a, b) => !b || a.value > b.value + 1e-9 || (Math.abs(a.value - b.value) <= 1e-9 && a.size < b.size);
    const evaluate = inTree => ({ tree: inTree, value: value(inTree), size: size(inTree) });

    function improve(cur, budget, rand, deadline) {
      for (let round = 0; round < 50 && Date.now() < deadline; round++) {
        let improved = false;
        const leaves = leafTargets(cur.tree);
        for (let i = leaves.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [leaves[i], leaves[j]] = [leaves[j], leaves[i]]; }
        // single branch removal
        for (const t of leaves) {
          // the tree may have changed since the list was made: only drop t if it is still a leaf
          if (!cur.tree[t] || !isLeaf(cur.tree, t)) continue;
          const tree = cur.tree.slice();
          tree[t] = 0;
          const cand = evaluate(prune(greedy(prune(tree), budget, rand, 1, 0)));
          if (better(cand, cur)) { cur = cand; improved = true; }
        }
        // pairs of branches, a few random tries
        if (!improved && leaves.length > 1) {
          for (let k = 0; k < Math.min(30, leaves.length * 2) && Date.now() < deadline; k++) {
            const a = leaves[Math.floor(rand() * leaves.length)], b = leaves[Math.floor(rand() * leaves.length)];
            if (a === b || !cur.tree[a] || !cur.tree[b] || !isLeaf(cur.tree, a) || !isLeaf(cur.tree, b)) continue;
            const tree = cur.tree.slice();
            tree[a] = 0;
            if (!isLeaf(tree, b)) continue;
            tree[b] = 0;
            const cand = evaluate(prune(greedy(prune(tree), budget, rand, 0.5 + rand(), 0.2)));
            if (better(cand, cur)) { cur = cand; improved = true; break; }
          }
        }
        if (!improved) break;
      }
      return cur;
    }

    // one restart; call repeatedly (e.g. across animation frames) and keep the best
    function attempt(budget, r, rand, deadline) {
      const tree = fixed.slice();
      tree[root] = 1;
      // random tiny jitter so equally short paths get explored across restarts
      for (let i = 0; i < N; i++) tie[i] = baseTie[i] + (r === 0 ? 0 : rand() * 1e-6);
      const alpha = r === 0 ? 1 : 0.5 + rand() * 1.2;
      const noise = r === 0 ? 0 : 0.4;
      let cur = evaluate(prune(greedy(tree, budget, rand, alpha, noise)));
      return improve(cur, budget, rand, deadline);
    }

    const greedyFrom = (tree, budget) => greedy(tree, budget, null, 1, 0);
    return { attempt, better, greedyFrom, targets, root, w };
  }

  // Full solve. weights: Map id -> value of covering it. Returns Promise<{ids, value, size}>.
  // Runs restarts until timeMs elapses, yielding to the browser between restarts.
  function solve(g, rootId, weights, budget, { tieWeights, blocked, fixed, timeMs = 1500, seed = 1, onProgress } = {}) {
    const s = create(g, rootId, weights, tieWeights, blocked, fixed);
    const rand = rng(seed);
    const end = Date.now() + timeMs;
    let best = null, r = 0;
    const toIds = tree => { const out = []; for (let i = 0; i < g.N; i++) if (tree[i] && i !== s.root) out.push(g.ids[i]); return out; };
    return new Promise(resolve => {
      const step = () => {
        const until = Math.min(end, Date.now() + 50);
        do {
          const cand = s.attempt(budget, r++, rand, end);
          if (s.better(cand, best)) best = cand;
        } while (Date.now() < until);
        if (onProgress) onProgress(r, best);
        if (Date.now() < end && s.targets.length) setTimeout(step, 0);
        else resolve({ ids: toIds(best.tree), value: best.value, size: best.size, restarts: r });
      };
      step();
    });
  }

  // Greedy extension of an existing tree (used for leftover points).
  function extend(g, rootId, treeIds, weights, budget, blocked) {
    const s = create(g, rootId, weights, null, blocked);
    const tree = new Uint8Array(g.N);
    tree[s.root] = 1;
    for (const id of treeIds) if (g.index.has(id)) tree[g.index.get(id)] = 1;
    s.greedyFrom(tree, budget);
    const out = [];
    for (let i = 0; i < g.N; i++) if (tree[i] && i !== s.root) out.push(g.ids[i]);
    return out;
  }

  return { build, solve, extend, create, rng };
})();
if (typeof module !== 'undefined') module.exports = Solver;
