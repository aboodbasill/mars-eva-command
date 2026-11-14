/* SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md. */
/* In-browser route planner — a JavaScript port of pipeline/routing/engine.py (cost model "symmetric-max-v1"):
 *   s(u,v) = max(slope[u], slope[v]);  p(u,v) = max(penalty[u], penalty[v])  (1.0 HiRISE, 1.5 CTX-only)
 *   c(u,v) = d(u,v) · (1 + (s / θ_pref)²) · p,   d = cell or cell·√2,  θ_pref = 15°
 *   blocked: no elevation support or slope > θ_max; no corner cutting on diagonals.
 * A* with the straight-line ground distance heuristic (admissible because every factor ≥ 1).
 * Runs on the exported 5 m HiRISE slope grid; tests/test_route.js checks it against the Python engine. */
(function (root) {
  'use strict';
  const SQRT2 = Math.SQRT2;
  const NB = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [-1, -1, 1], [-1, 1, 1], [1, -1, 1], [1, 1, 1]];

  /** slopeU8: quantised slope (value·scale = degrees, nodata = no support); provU8: 1 HiRISE, 2 CTX-only, 0 none. */
  function makeGrid(slopeU8, provU8, ncols, nrows, cell, opts = {}) {
    const scale = opts.scale ?? 0.25, nodata = opts.nodata ?? 255, n = ncols * nrows;
    const slope = new Float32Array(n), pen = new Float32Array(n), nod = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = slopeU8[i];
      if (v === nodata) { nod[i] = 1; slope[i] = 0; } else slope[i] = v * scale;
      pen[i] = provU8 && provU8[i] === 2 ? (opts.penaltyCtx ?? 1.5) : 1.0;
    }
    return { slope, pen, nod, nc: ncols, nr: nrows, cell, n };
  }

  // binary min-heap on (f, node) with typed arrays
  function Heap(cap) { this.f = new Float64Array(cap); this.v = new Int32Array(cap); this.size = 0; }
  Heap.prototype.push = function (f, v) {
    if (this.size >= this.f.length) { const f2 = new Float64Array(this.f.length * 2), v2 = new Int32Array(this.f.length * 2); f2.set(this.f); v2.set(this.v); this.f = f2; this.v = v2; }
    let i = this.size++; const F = this.f, V = this.v;
    while (i > 0) { const p = (i - 1) >> 1; if (F[p] <= f) break; F[i] = F[p]; V[i] = V[p]; i = p; }
    F[i] = f; V[i] = v;
  };
  Heap.prototype.pop = function () {
    const F = this.f, V = this.v, top = V[0], last = --this.size; if (last < 0) return -1;
    const f = F[last], v = V[last]; let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= last) break; if (c + 1 < last && F[c + 1] < F[c]) c++; if (F[c] >= f) break; F[i] = F[c]; V[i] = V[c]; i = c; }
    F[i] = f; V[i] = v; return top;
  };

  function blockedFn(g, thetaMax) { return (i) => g.nod[i] === 1 || g.slope[i] > thetaMax; }

  /** Nearest traversable cell within maxM metres (like engine.snap_to_traversable). Returns {r,c,dispM} or null. */
  function snap(g, r, c, thetaMax, maxM = 40) {
    const blk = blockedFn(g, thetaMax);
    if (r >= 0 && c >= 0 && r < g.nr && c < g.nc && !blk(r * g.nc + c)) return { r, c, dispM: 0 };
    const k = Math.ceil(maxM / g.cell); let best = null;
    for (let dr = -k; dr <= k; dr++) for (let dc = -k; dc <= k; dc++) {
      const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= g.nr || cc >= g.nc || blk(rr * g.nc + cc)) continue;
      const d = g.cell * Math.hypot(dr, dc); if (d <= maxM && (!best || d < best.dispM)) best = { r: rr, c: cc, dispM: d };
    }
    return best;
  }

  /** A* from (r0,c0) to (r1,c1). Returns { cells: Int32Array of indices, cost, lengthM, maxSlope, expanded } or { error }. */
  function astar(g, r0, c0, r1, c1, thetaMax, thetaPref = 15) {
    const { nc, nr, cell, slope, pen } = g, blk = blockedFn(g, thetaMax);
    if (r0 < 0 || c0 < 0 || r0 >= nr || c0 >= nc || r1 < 0 || c1 < 0 || r1 >= nr || c1 >= nc) return { error: 'outside' };
    const s = r0 * nc + c0, t = r1 * nc + c1;
    if (blk(s)) return { error: 'blocked-start' }; if (blk(t)) return { error: 'blocked-goal' };
    const best = new Float64Array(g.n).fill(Infinity), parent = new Int32Array(g.n).fill(-1), closed = new Uint8Array(g.n);
    const h = (u) => { const r = (u / nc) | 0, c = u - r * nc; return cell * Math.hypot(r - r1, c - c1); };
    const heap = new Heap(1 << 16); best[s] = 0; heap.push(h(s), s); let expanded = 0;
    const invPref2 = 1 / (thetaPref * thetaPref);
    while (heap.size) {
      const u = heap.pop(); if (closed[u]) continue; if (u === t) break; closed[u] = 1; expanded++;
      const r = (u / nc) | 0, c = u - r * nc, gu = best[u], su = slope[u], pu = pen[u];
      for (let k = 0; k < 8; k++) {
        const rr = r + NB[k][0], cc = c + NB[k][1]; if (rr < 0 || cc < 0 || rr >= nr || cc >= nc) continue;
        const v = rr * nc + cc; if (closed[v] || blk(v)) continue;
        const diag = NB[k][2]; if (diag && (blk(r * nc + cc) || blk(rr * nc + c))) continue;
        const sv = slope[v], ss = su > sv ? su : sv, pp = pu > pen[v] ? pu : pen[v];
        const w = cell * (diag ? SQRT2 : 1) * (1 + ss * ss * invPref2) * pp, nv = gu + w;
        if (nv < best[v]) { best[v] = nv; parent[v] = u; heap.push(nv + h(v), v); }
      }
    }
    if (!Number.isFinite(best[t])) return { error: 'no-route' };
    const out = []; for (let u = t; u !== -1; u = parent[u]) out.push(u); out.reverse();
    let len = 0, maxS = 0;
    for (let i = 0; i < out.length; i++) {
      maxS = Math.max(maxS, slope[out[i]]);
      if (i) { const a = out[i - 1], b = out[i]; len += cell * (((a / nc) | 0) !== ((b / nc) | 0) && a % nc !== b % nc ? SQRT2 : 1); }
    }
    return { cells: Int32Array.from(out), cost: best[t], lengthM: len, maxSlope: maxS, expanded };
  }

  /** Douglas–Peucker simplification of a polyline [[x,y],...] (display only). */
  function simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
    while (st.length) { const [a, b] = st.pop(); let md = 0, mi = -1; const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > md) { md = d; mi = i; } }
      if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); } }
    return pts.filter((_, i) => keep[i]);
  }

  const api = { makeGrid, astar, snap, simplify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MarsRoute = api;
})(typeof window !== 'undefined' ? window : globalThis);
