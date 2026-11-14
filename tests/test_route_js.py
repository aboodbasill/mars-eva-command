# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""The simulator's in-browser planner (app/game/route.js) must reproduce the Python engine on the exported grids."""
import base64
import json
import os
import shutil
import subprocess
import sys

import numpy as np
import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(ROOT, 'pipeline', 'routing'))
from engine import CostGrid, astar  # noqa: E402

pytestmark = pytest.mark.skipif(shutil.which('node') is None, reason='node not installed')


def load():
    s = open(os.path.join(ROOT, 'app', 'data', 'grids.js')).read()
    G = json.loads(s[s.index('{'):s.rindex('}') + 1])
    g5 = G['grid_5m']
    sl = np.frombuffer(base64.b64decode(G['grids']['slope']['b64']), np.uint8).reshape(g5['nrows'], g5['ncols'])
    pv = np.frombuffer(base64.b64decode(G['grids']['provenance']['b64']), np.uint8).reshape(g5['nrows'], g5['ncols'])
    slope = np.where(sl == 255, np.nan, sl * 0.25)
    pen = np.where(pv == 2, 1.5, 1.0)
    return slope, pen, g5['cell_m']


def test_js_planner_matches_python_engine():
    slope, pen, cell = load()
    cases = []
    rng = np.random.default_rng(7)
    for th in (15.0, 20.0, 25.0):
        g = CostGrid(slope, pen, cell, th)
        free = np.argwhere(~g.blocked)
        for _ in range(3):
            a, b = free[rng.integers(len(free))], free[rng.integers(len(free))]
            cases.append((int(a[0]), int(a[1]), int(b[0]), int(b[1]), th))
    js = json.loads(subprocess.check_output(['node', os.path.join(ROOT, 'tests', 'route_cli.js'), json.dumps(cases)]))
    for (r0, c0, r1, c1, th), j in zip(cases, js):
        g = CostGrid(slope, pen, cell, th)
        try:
            path, cost = astar(g, (r0, c0), (r1, c1))
        except Exception:
            assert 'error' in j
            continue
        assert 'error' not in j, j
        assert abs(j['cost'] - cost) <= 1e-6 * max(1.0, cost), (j['cost'], cost)
        assert j['maxSlope'] <= th
