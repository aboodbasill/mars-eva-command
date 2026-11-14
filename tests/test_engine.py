# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Routing semantics tests (plan §15: A*, scenarios, cost units, return field, statistics)."""
import math
import os
import sys

import numpy as np
import pytest
from scipy.sparse import lil_matrix
from scipy.sparse.csgraph import dijkstra as sp_dijkstra

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'pipeline', 'routing'))
from engine import (CostGrid, astar, dijkstra_field, itinerary, path_cost, path_length_m,  # noqa: E402
                    RoutingError, NEIGHBOURS, SQRT2)


def flat(n=20, m=20, cell=5.0, theta=20.0, pen=1.0):
    return CostGrid(np.zeros((n, m)), np.full((n, m), pen), cell, theta_max=theta)


def scipy_reference(g: CostGrid, s_rc):
    """Independent shortest-path reference built from the documented edge definition."""
    n = g.nrows * g.ncols
    A = lil_matrix((n, n))
    for u in range(n):
        if g.blocked.ravel()[u]:
            continue
        for v, w in g.neighbours(u):
            A[u, v] = w
    return sp_dijkstra(A.tocsr(), indices=s_rc[0] * g.ncols + s_rc[1]).reshape(g.nrows, g.ncols)


# ---- cost units -----------------------------------------------------------------------------
def test_flat_cardinal_cost_is_exact_metres():
    g = flat()
    p, c = astar(g, (5, 2), (5, 12))
    assert c == pytest.approx(50.0)
    assert path_length_m(p, 5.0) == pytest.approx(50.0)


def test_flat_diagonal_cost_is_exact():
    g = flat()
    p, c = astar(g, (0, 0), (10, 10))
    assert c == pytest.approx(10 * 5.0 * SQRT2)
    assert len(p) == 11


def test_ctx_penalty_multiplies_once():
    g = flat(pen=1.5)
    _, c = astar(g, (5, 2), (5, 12))
    assert c == pytest.approx(75.0)


def test_slope_factor():
    s = np.full((5, 20), 15.0)
    g = CostGrid(s, np.ones((5, 20)), 5.0, theta_max=20.0, theta_pref=15.0)
    _, c = astar(g, (2, 0), (2, 10))
    assert c == pytest.approx(50.0 * 2.0)   # (1 + (15/15)^2) = 2


def test_symmetric_edge_uses_max_of_endpoints():
    s = np.zeros((1, 3)); s[0, 1] = 15.0
    pen = np.ones((1, 3)); pen[0, 2] = 1.5
    g = CostGrid(s, pen, 5.0, theta_max=20)
    assert g.edge_cost(0, 1, False) == pytest.approx(5 * 2.0)
    assert g.edge_cost(1, 0, False) == pytest.approx(5 * 2.0)
    assert g.edge_cost(1, 2, False) == pytest.approx(5 * 2.0 * 1.5)


# ---- A* vs Dijkstra --------------------------------------------------------------------------
@pytest.mark.parametrize('seed', range(8))
def test_astar_matches_dijkstra_and_scipy(seed):
    rng = np.random.default_rng(seed)
    s = rng.uniform(0, 30, (25, 25))
    s[rng.random((25, 25)) < 0.08] = np.nan
    pen = np.where(rng.random((25, 25)) < 0.3, 1.5, 1.0)
    g = CostGrid(s, pen, 5.0, theta_max=22.0)
    free = np.argwhere(~g.blocked)
    a, b = tuple(free[0]), tuple(free[-1])
    ref_own = dijkstra_field(g, a)
    ref_sp = scipy_reference(g, a)
    np.testing.assert_allclose(np.where(np.isfinite(ref_own), ref_own, -1), np.where(np.isfinite(ref_sp), ref_sp, -1), rtol=1e-9)
    if np.isfinite(ref_own[b]):
        p, c = astar(g, a, b)
        assert c == pytest.approx(ref_own[b], rel=1e-9)
        assert path_cost(g, p) == pytest.approx(c, rel=1e-9)
        assert not any(g.blocked[r, cc] for r, cc in p)
    else:
        with pytest.raises(RoutingError) as e:
            astar(g, a, b)
        assert e.value.reason == 'no-route'


def test_no_corner_cutting():
    s = np.zeros((3, 3)); s[0, 1] = np.nan   # block north cardinal neighbour of (1,0)->(0,1)? use explicit layout
    s = np.zeros((2, 2)); s[0, 1] = 99.0      # blocked (0,1)
    g = CostGrid(s, np.ones((2, 2)), 5.0, theta_max=20)
    nbrs = dict(g.neighbours(1 * 2 + 0))      # from (1,0)
    assert 0 * 2 + 1 not in nbrs              # (0,1) blocked
    s = np.zeros((2, 2)); s[1, 1] = 99.0      # block (1,1); diagonal (1,0)->(0,1) would cut its corner
    g = CostGrid(s, np.ones((2, 2)), 5.0, theta_max=20)
    nbrs = dict(g.neighbours(2))
    assert 1 not in nbrs


def test_blocked_and_outside_errors():
    s = np.zeros((5, 5)); s[0, 0] = np.nan; s[4, 4] = 30
    g = CostGrid(s, np.ones((5, 5)), 5.0, theta_max=20)
    for start, goal, reason in (((0, 0), (2, 2), 'blocked-start'), ((2, 2), (4, 4), 'blocked-goal'),
                                ((2, 2), (9, 9), 'outside')):
        with pytest.raises(RoutingError) as e:
            astar(g, start, goal)
        assert e.value.reason == reason


def test_disconnected_region_is_no_route():
    s = np.zeros((5, 9)); s[:, 4] = np.nan
    g = CostGrid(s, np.ones((5, 9)), 5.0, theta_max=20)
    with pytest.raises(RoutingError) as e:
        astar(g, (2, 0), (2, 8))
    assert e.value.reason == 'no-route'


# ---- scenarios -------------------------------------------------------------------------------
@pytest.mark.parametrize('seed', range(5))
def test_tighter_slope_limit_cannot_improve_cost(seed):
    rng = np.random.default_rng(100 + seed)
    s = rng.uniform(0, 28, (30, 30))
    s[0, 0] = s[29, 29] = 0.0         # keep endpoints traversable in every scenario
    pen = np.ones((30, 30))
    costs = []
    for th in (25.0, 20.0, 15.0):
        g = CostGrid(s, pen, 5.0, theta_max=th)
        try:
            costs.append(astar(g, (0, 0), (29, 29))[1])
        except RoutingError:
            costs.append(math.inf)
    assert costs[0] <= costs[1] + 1e-9 <= costs[2] + 2e-9


# ---- return field ----------------------------------------------------------------------------
def test_return_field_flat_is_octile_distance():
    g = flat(15, 15)
    f, phys = dijkstra_field(g, (7, 7), physical=True)
    for r, c in ((7, 14), (0, 0), (3, 10)):
        dr, dc = abs(r - 7), abs(c - 7)
        octile = 5.0 * (max(dr, dc) - min(dr, dc) + SQRT2 * min(dr, dc))
        assert f[r, c] == pytest.approx(octile)
        assert phys[r, c] == pytest.approx(octile)


def test_return_field_ridge_costs_more():
    s = np.zeros((11, 11)); s[:, 6] = 18.0
    g = CostGrid(s, np.ones((11, 11)), 5.0, theta_max=20)
    f = dijkstra_field(g, (5, 0))
    assert f[5, 10] > f[5, 4] + 6 * 5.0     # crossing the ridge adds cost beyond flat distance


def test_field_symmetry_equals_cost_to_base():
    rng = np.random.default_rng(7)
    g = CostGrid(rng.uniform(0, 19, (12, 12)), np.ones((12, 12)), 5.0, theta_max=20)
    fa = dijkstra_field(g, (0, 0))
    fb = dijkstra_field(g, (11, 11))
    assert fa[11, 11] == pytest.approx(fb[0, 0])


# ---- itinerary -------------------------------------------------------------------------------
def test_itinerary_joins_without_duplicate_vertices():
    g = flat()
    res = itinerary(g, [('L', (0, 0)), ('A', (0, 10)), ('B', (10, 10)), ('L', (0, 0))])
    assert res['feasible']
    p = res['path']
    assert all(p[i] != p[i + 1] for i in range(len(p) - 1))
    assert p[0] == (0, 0) and p[-1] == (0, 0)
    assert res['cost'] == pytest.approx(sum(l['cost'] for l in res['legs']))


def test_itinerary_requires_round_trip():
    g = flat()
    with pytest.raises(AssertionError):
        itinerary(g, [('L', (0, 0)), ('L', (0, 0))])


def test_itinerary_snaps_with_disclosure_and_reports_infeasible():
    s = np.zeros((20, 20)); s[10, 10] = 40.0
    g = CostGrid(s, np.ones((20, 20)), 5.0, theta_max=20)
    res = itinerary(g, [('L', (0, 0)), ('A', (10, 10)), ('L', (0, 0))], snap_m=10)
    assert res['feasible'] and res['snaps'][0]['displacement_m'] == pytest.approx(5.0)
    s[5:16, 5:16] = 40.0
    g = CostGrid(s, np.ones((20, 20)), 5.0, theta_max=20)
    res = itinerary(g, [('L', (0, 0)), ('A', (10, 10)), ('L', (0, 0))], snap_m=10)
    assert not res['feasible'] and res['failure']['reason'] == 'blocked-stop'


def test_neighbour_table_is_eight_connected():
    assert len(NEIGHBOURS) == 8 and sum(d for *_, d in NEIGHBOURS) == 4
