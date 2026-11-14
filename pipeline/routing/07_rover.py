# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Backup rover as a second safe haven (merged from Marswalk Planner v4.1; ASSUMPTION: an unpressurised
Artemis-LTV-style rover that can drive the route and carry the crew).

For each slope scenario: compute the cost field from every candidate park position (each stop), then pick the
stop that minimises the worst 'walk home' along the itinerary, where walk home = min(cost to lander, cost to rover).
Writes data/intermediate/haven_<theta>.npy (+ _phys) and rover.json.
"""
import os
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
from common import META, INTER, load_config, Grid, write_json, read_json  # noqa: E402
from engine import CostGrid, dijkstra_field, snap_to_traversable  # noqa: E402

import numpy as np  # noqa: E402
import rasterio  # noqa: E402


def load(name):
    with rasterio.open(os.path.join(INTER, name)) as d:
        return d.read(1)


def main():
    cfg = load_config()
    g5 = Grid.from_dict(read_json(os.path.join(META, 'terrain_stats.json'))['grid_5m'])
    slope, pen = load('slope_5m.tif'), load('penalty_5m.tif')
    sites = read_json(os.path.join(INTER, 'stations_local.json'))
    routes = read_json(os.path.join(INTER, 'routes_local.json'))
    cands = [s for s in sites if s['kind'] in ('station', 'depot')]
    out = {'assumption': 'Unpressurised Artemis-LTV-style rover parked at one stop as a second safe haven; '
                         'walk home = min(cost to lander, cost to rover).', 'scenarios': {}}
    for r in routes:
        th = r['theta_max_deg']
        if not r['feasible']:
            continue
        g = CostGrid(slope, pen, g5.cell, theta_max=th, theta_pref=cfg['routing']['theta_pref_deg'])
        lander_c = np.load(os.path.join(INTER, f'walkback_{int(th)}.npy')).astype(float)
        lander_p = np.load(os.path.join(INTER, f'walkback_phys_{int(th)}.npy')).astype(float)
        xy = np.asarray(r['geometry_xy'])
        R = ((g5.y0 - xy[:, 1]) // g5.cell).astype(int)
        C = ((xy[:, 0] - g5.x0) // g5.cell).astype(int)
        best = None
        for s in cands:
            rc, _ = snap_to_traversable(g, tuple(s['cell_rc']), 15.0)
            if rc is None:
                continue
            f, fp = dijkstra_field(g, rc, physical=True)
            haven = np.minimum(lander_c, f)
            worst = float(np.nanmax(haven[R, C]))
            if best is None or worst < best[1]:
                best = (s, worst, haven, np.where(f < lander_c, fp, lander_p), rc)
        s, worst, haven, havenp, rc = best
        np.save(os.path.join(INTER, f'haven_{int(th)}.npy'), haven.astype(np.float32))
        np.save(os.path.join(INTER, f'haven_phys_{int(th)}.npy'), havenp.astype(np.float32))
        x, y = g5.xy(*rc)
        out['scenarios'][str(th)] = {'park_stop': s['id'], 'park_xy': [round(x, 1), round(y, 1)],
                                     'max_walkhome_lander_only_eq_m': float(np.nanmax(lander_c[R, C])),
                                     'max_walkhome_with_rover_eq_m': worst,
                                     'max_walkhome_with_rover_phys_m': float(np.nanmax(havenp[R, C]))}
        print(f"theta {th}: park at {s['id']}  worst walk-home {out['scenarios'][str(th)]['max_walkhome_lander_only_eq_m']:.0f} -> {worst:.0f} m-eq")
    write_json(os.path.join(INTER, 'rover.json'), out)


if __name__ == '__main__':
    main()
