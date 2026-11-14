"""Routing engine — explicit A* and Dijkstra on an 8-neighbour grid (plan §10.2–10.3).

Edge semantics (cost model 'symmetric-max-v1'):
    s(u,v) = max(slope[u], slope[v])
    p(u,v) = max(penalty[u], penalty[v])
    c(u,v) = d(u,v) * (1 + (s / theta_pref)^2) * p
    d = cell (cardinal) or cell*sqrt(2) (diagonal), in metres — cell size applied exactly once.
A cell is blocked when slope is NaN (no elevation support) or slope > theta_max.
Diagonal moves are forbidden when either adjacent cardinal cell is blocked (no corner cutting).
Because every factor >= 1, straight-line ground distance is an admissible A* heuristic.
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field

import numpy as np

SQRT2 = math.sqrt(2.0)
# (dr, dc, is_diagonal)
NEIGHBOURS = ((-1, 0, False), (1, 0, False), (0, -1, False), (0, 1, False),
              (-1, -1, True), (-1, 1, True), (1, -1, True), (1, 1, True))


class RoutingError(Exception):
    """Raised with an explicit reason: 'outside', 'blocked-start', 'blocked-goal', 'no-route'."""

    def __init__(self, reason: str, detail: str = ''):
        super().__init__(f'{reason}: {detail}')
        self.reason, self.detail = reason, detail


@dataclass
class CostGrid:
    slope: np.ndarray          # degrees, NaN = no support
    penalty: np.ndarray        # evidence penalty (1.0 HiRISE, 1.5 CTX-only)
    cell: float                # metres
    theta_max: float
    theta_pref: float = 15.0
    blocked: np.ndarray = field(init=False)
    factor: np.ndarray = field(init=False)

    def __post_init__(self):
        s = self.slope
        self.blocked = ~np.isfinite(s) | (np.nan_to_num(s, nan=0.0) > self.theta_max)
        self.factor = (1.0 + (np.nan_to_num(s, nan=0.0) / self.theta_pref) ** 2)
        self.nrows, self.ncols = s.shape
        # Flattened Python lists are much faster to index in the inner loop than numpy scalars.
        self._blk = self.blocked.ravel().tolist()
        self._slope = np.nan_to_num(s, nan=0.0).ravel().tolist()
        self._pen = self.penalty.ravel().astype(float).tolist()

    # -- edge cost -----------------------------------------------------------------------------
    def edge_cost(self, u: int, v: int, diagonal: bool) -> float:
        s = max(self._slope[u], self._slope[v])
        p = max(self._pen[u], self._pen[v])
        d = self.cell * (SQRT2 if diagonal else 1.0)
        return d * (1.0 + (s / self.theta_pref) ** 2) * p

    def neighbours(self, u: int):
        nc, nr = self.ncols, self.nrows
        r, c = divmod(u, nc)
        blk = self._blk
        for dr, dc, diag in NEIGHBOURS:
            rr, cc = r + dr, c + dc
            if rr < 0 or cc < 0 or rr >= nr or cc >= nc:
                continue
            v = rr * nc + cc
            if blk[v]:
                continue
            if diag and (blk[r * nc + cc] or blk[rr * nc + c]):
                continue  # no corner cutting
            yield v, self.edge_cost(u, v, diag)

    def check(self, rc, role):
        r, c = rc
        if not (0 <= r < self.nrows and 0 <= c < self.ncols):
            raise RoutingError('outside', f'{role} {rc} outside grid {self.nrows}x{self.ncols}')
        if self.blocked[r, c]:
            raise RoutingError(f'blocked-{role}', f'{role} cell {rc} is blocked (slope '
                               f'{self.slope[r, c]:.1f} deg > {self.theta_max} or no data)')
        return r * self.ncols + c


def astar(g: CostGrid, start_rc, goal_rc):
    """Return (path as list of (r,c), total weighted cost). Raises RoutingError."""
    s = g.check(start_rc, 'start')
    t = g.check(goal_rc, 'goal')
    if s == t:
        return [start_rc], 0.0
    nc, cell = g.ncols, g.cell
    tr, tc = divmod(t, nc)

    def h(u):
        r, c = divmod(u, nc)
        return cell * math.hypot(r - tr, c - tc)

    best = {s: 0.0}
    parent = {s: -1}
    closed = set()
    heap = [(h(s), 0.0, s)]
    while heap:
        f, gu, u = heapq.heappop(heap)
        if u in closed:
            continue          # stale entry
        if gu > best.get(u, math.inf):
            continue
        if u == t:
            break
        closed.add(u)
        for v, w in g.neighbours(u):
            if v in closed:
                continue
            nv = gu + w
            if nv < best.get(v, math.inf):
                best[v] = nv
                parent[v] = u
                heapq.heappush(heap, (nv + h(v), nv, v))
    if t not in best:
        raise RoutingError('no-route', f'no traversable path {start_rc} -> {goal_rc} at theta_max={g.theta_max}')
    path, u = [], t
    while u != -1:
        path.append(divmod(u, nc))
        u = parent[u]
    path.reverse()
    return path, best[t]


def dijkstra_field(g: CostGrid, source_rc, physical=False):
    """Minimum weighted cost from source to every cell (np.inf where unreachable).

    With physical=True also returns the physical ground length (m) of that least-cost path.
    The edge cost is symmetric, so cost-from-lander equals cost-to-lander. If a directional cost is
    introduced later, run this on the reversed graph instead (plan §10.3)."""
    s = g.check(source_rc, 'start')
    n = g.nrows * g.ncols
    nc, cell = g.ncols, g.cell
    dist = [math.inf] * n
    phys = [math.inf] * n
    dist[s] = 0.0
    phys[s] = 0.0
    heap = [(0.0, s)]
    done = bytearray(n)
    while heap:
        d, u = heapq.heappop(heap)
        if done[u]:
            continue
        done[u] = 1
        pu = phys[u]
        for v, w in g.neighbours(u):
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                if physical:
                    phys[v] = pu + (cell * SQRT2 if (u % nc != v % nc and u // nc != v // nc) else cell)
                heapq.heappush(heap, (nd, v))
    D = np.asarray(dist, dtype=np.float64).reshape(g.nrows, g.ncols)
    if physical:
        return D, np.asarray(phys, dtype=np.float64).reshape(g.nrows, g.ncols)
    return D


def dijkstra_path(g: CostGrid, start_rc, goal_rc):
    """Reference shortest path cost by plain Dijkstra (used to cross-check A*)."""
    f = dijkstra_field(g, start_rc)
    return f[goal_rc]


def path_length_m(path, cell):
    L = 0.0
    for (r0, c0), (r1, c1) in zip(path, path[1:]):
        L += cell * (SQRT2 if (r0 != r1 and c0 != c1) else 1.0)
    return L


def path_cost(g: CostGrid, path):
    tot = 0.0
    for (r0, c0), (r1, c1) in zip(path, path[1:]):
        u, v = r0 * g.ncols + c0, r1 * g.ncols + c1
        tot += g.edge_cost(u, v, r0 != r1 and c0 != c1)
    return tot


def snap_to_traversable(g: CostGrid, rc, max_m: float):
    """Nearest unblocked cell within max_m. Returns (rc, displacement_m) or (None, None).
    Callers must disclose the displacement and keep the requested coordinate."""
    r, c = rc
    if 0 <= r < g.nrows and 0 <= c < g.ncols and not g.blocked[r, c]:
        return rc, 0.0
    k = int(math.ceil(max_m / g.cell))
    best = None
    for dr in range(-k, k + 1):
        for dc in range(-k, k + 1):
            rr, cc = r + dr, c + dc
            if 0 <= rr < g.nrows and 0 <= cc < g.ncols and not g.blocked[rr, cc]:
                d = g.cell * math.hypot(dr, dc)
                if d <= max_m and (best is None or d < best[1]):
                    best = ((rr, cc), d)
    return best if best else (None, None)


def itinerary(g: CostGrid, stops, snap_m=15.0):
    """Route consecutive pairs of stops [(id, (r,c)), ...]. The caller passes lander ... lander.

    Returns dict with feasibility, joined path (no duplicated join vertices), per-leg results,
    and snapping disclosures. Never routes lander->lander as a zero-length 'mission'."""
    assert len(stops) >= 3 and stops[0][0] == stops[-1][0], 'itinerary must start and end at the lander'
    snapped, disclosures = [], []
    for sid, rc in stops:
        s_rc, d = snap_to_traversable(g, rc, snap_m)
        if s_rc is None:
            return {'feasible': False, 'failure': {'reason': 'blocked-stop', 'stop': sid,
                    'detail': f'no traversable cell within {snap_m} m of requested position'},
                    'legs': [], 'path': [], 'snaps': disclosures}
        if d > 0:
            disclosures.append({'stop': sid, 'requested_rc': list(rc), 'used_rc': list(s_rc), 'displacement_m': round(d, 2)})
        snapped.append((sid, s_rc))
    legs, full = [], []
    for (a, ra), (b, rb) in zip(snapped, snapped[1:]):
        try:
            p, cost = astar(g, ra, rb)
        except RoutingError as e:
            return {'feasible': False, 'failure': {'reason': e.reason, 'from': a, 'to': b, 'detail': e.detail},
                    'legs': legs, 'path': full, 'snaps': disclosures}
        legs.append({'from': a, 'to': b, 'cost': cost, 'length_m': path_length_m(p, g.cell),
                     'start_index': max(len(full) - 1, 0)})
        full.extend(p if not full else p[1:])   # drop duplicated join vertex
    return {'feasible': True, 'legs': legs, 'path': full, 'snaps': disclosures,
            'cost': sum(l['cost'] for l in legs)}
