# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Phases 4–5 — itineraries for each slope scenario, return-budget field, route statistics, station tags.

Outputs (data/intermediate):
  routes_local.json, walkback_local.json, profiles.json, stations_local.json,
  walkback_<theta>.npy (cost field), walkback_phys_<theta>.npy (physical length of least-cost return path)
"""
import os
import sys
import time

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
from common import META, INTER, load_config, Grid, write_json, read_json  # noqa: E402
from engine import CostGrid, itinerary, dijkstra_field, path_length_m, RoutingError  # noqa: E402

import numpy as np  # noqa: E402
import rasterio  # noqa: E402

SMOOTH_N = 5   # 5 vertices ~ 25 m moving average before ascent/descent (declared filter)


def load(name):
    with rasterio.open(os.path.join(INTER, name)) as d:
        return d.read(1)


def route_stats(path, g5, slope, elev, prov, wb_cost, wb_phys, budgets, cell):
    rc = np.asarray(path)
    r, c = rc[:, 0], rc[:, 1]
    xs, ys = g5.xy(r, c)
    seg = np.hypot(np.diff(r), np.diff(c)) * cell
    s_edge = np.maximum(slope[r[:-1], c[:-1]], slope[r[1:], c[1:]])
    ctx_edge = (prov[r[:-1], c[:-1]] == 2) | (prov[r[1:], c[1:]] == 2)
    z = elev[r, c].astype(float)
    zs = np.convolve(np.pad(z, (SMOOTH_N // 2, SMOOTH_N // 2), mode='edge'), np.ones(SMOOTH_N) / SMOOTH_N, mode='valid')
    dz = np.diff(zs)
    dz_raw = np.diff(z)
    dist = np.concatenate([[0], np.cumsum(seg)])
    ret = wb_cost[r, c]
    retp = wb_phys[r, c]
    L = float(seg.sum())
    exceed = {}
    for B in budgets:
        out = ret > B
        exceed[str(B)] = {'length_m': float(seg[(out[:-1] | out[1:])].sum()),
                          'fraction': float(seg[(out[:-1] | out[1:])].sum() / L) if L else 0.0,
                          'first_exceed_distance_m': float(dist[np.argmax(out)]) if out.any() else None}
    return {
        'length_m': L,
        'max_slope_deg': float(np.nanmax(slope[r, c])),
        'mean_slope_deg_length_weighted': float((s_edge * seg).sum() / L) if L else 0.0,
        'ascent_m': float(dz[dz > 0].sum()), 'descent_m': float(-dz[dz < 0].sum()),
        'ascent_raw_m': float(dz_raw[dz_raw > 0].sum()), 'descent_raw_m': float(-dz_raw[dz_raw < 0].sum()),
        'ctx_only_fraction': float(seg[ctx_edge].sum() / L) if L else 0.0,
        'max_return_cost_eq_m': float(np.nanmax(ret)), 'max_return_physical_m': float(np.nanmax(retp)),
        'budget_exceedance': exceed,
    }, {
        'distance_m': np.round(dist, 1).tolist(), 'elevation_m': np.round(z, 2).tolist(),
        'elevation_smoothed_m': np.round(zs, 2).tolist(), 'slope_deg': np.round(slope[r, c], 2).tolist(),
        'provenance': prov[r, c].astype(int).tolist(), 'return_cost_eq_m': np.round(ret, 1).tolist(),
        'return_physical_m': np.round(retp, 1).tolist(),
    }, np.round(np.column_stack([xs, ys]), 1).tolist()


def main():
    cfg = load_config()
    stats = read_json(os.path.join(META, 'terrain_stats.json'))
    g5 = Grid.from_dict(stats['grid_5m'])
    slope, elev, prov, pen = load('slope_5m.tif'), load('elev_5m.tif'), load('provenance_5m.tif'), load('penalty_5m.tif')
    sites = read_json(os.path.join(META, 'sites.json'))
    lander = next(s for s in sites if s['kind'] == 'lander')
    stations = [s for s in sites if s['kind'] == 'station']
    depot = next(s for s in sites if s['kind'] == 'depot')
    order = [lander] + stations + [depot] + [lander]
    stops = [(s['id'], g5.rc(s['x'], s['y'])) for s in order]
    budgets = cfg['walkback']['budgets_m']
    rt = cfg['routing']

    routes, profiles, walk = [], {}, []
    for th in rt['scenarios_deg']:
        t0 = time.time()
        g = CostGrid(slope, pen, g5.cell, theta_max=th, theta_pref=rt['theta_pref_deg'])
        lrc = g5.rc(lander['x'], lander['y'])
        wb, wbp = dijkstra_field(g, lrc, physical=True)
        np.save(os.path.join(INTER, f'walkback_{int(th)}.npy'), wb.astype(np.float32))
        np.save(os.path.join(INTER, f'walkback_phys_{int(th)}.npy'), wbp.astype(np.float32))
        border = np.concatenate([wb[0], wb[-1], wb[:, 0], wb[:, -1]])
        walk.append({'theta_max_deg': th, 'units': 'equivalent-flat-cost metres (weighted cost, not time or energy)',
                     'field_file': f'walkback_{int(th)}', 'reachable_fraction': float(np.isfinite(wb).mean()),
                     'contours': [{'budget_m': B, 'area_m2': float((wb <= B).sum() * g5.cell ** 2),
                                   'truncated_by_aoi': bool((border <= B).any())} for B in budgets],
                     'graph': 'symmetric 8-neighbour; single Dijkstra from lander equals cost-to-lander'})
        res = itinerary(g, stops)
        rec = {'scenario_id': f'theta{int(th)}', 'theta_max_deg': th, 'theta_pref_deg': rt['theta_pref_deg'],
               'is_default': th == rt['default_deg'], 'cost_model_version': rt['cost_model_version'],
               'penalties': {'hirise': rt['penalty_hirise'], 'ctx_only': rt['penalty_ctx_only'], 'no_data': 'blocked'},
               'station_order': [s['id'] for s in order], 'feasible': res['feasible'], 'snaps': res['snaps'],
               'blocked_fraction': float(g.blocked.mean())}
        if not res['feasible']:
            rec['failure'] = res['failure']
            rec['warnings'] = [f"No route: {res['failure']}"]
        else:
            st, prof, coords = route_stats(res['path'], g5, slope, elev, prov, wb, wbp, budgets, g5.cell)
            rec.update(weighted_cost=res['cost'], geometry_xy=coords, **st)
            rec['legs'] = [{k: v for k, v in l.items()} for l in res['legs']]
            # along-itinerary distance at each stop
            cum = 0.0
            for l in rec['legs']:
                l['distance_at_end_m'] = cum + l['length_m']
                cum += l['length_m']
            warns = []
            dB = cfg['walkback']['default_budget_m']
            if st['budget_exceedance'][str(dB)]['length_m'] > 0:
                warns.append(f"{st['budget_exceedance'][str(dB)]['fraction']*100:.0f}% of the itinerary lies outside the "
                             f"{dB} m-equivalent return budget")
            if st['ctx_only_fraction'] > 0:
                warns.append(f"{st['ctx_only_fraction']*100:.1f}% of route length on CTX-only (20 m) terrain")
            for sn in res['snaps']:
                warns.append(f"{sn['stop']} requested cell blocked; routed to nearest traversable cell {sn['displacement_m']} m away")
            warns.append('Planning candidate, not a certified safe route. DTM slope does not resolve rocks < ~1-2 m.')
            rec['warnings'] = warns
            profiles[rec['scenario_id']] = prof
        routes.append(rec)
        print(f"theta {th}: feasible={res['feasible']} "
              + (f"L={rec.get('length_m', 0):.0f} m cost={rec.get('weighted_cost', 0):.0f} maxslope={rec.get('max_slope_deg', 0):.1f}" if res['feasible'] else str(res.get('failure')))
              + f"  ({time.time()-t0:.1f}s)", flush=True)

    # Station tags (default scenario field)
    dth = int(rt['default_deg'])
    wb = np.load(os.path.join(INTER, f'walkback_{dth}.npy'))
    wbp = np.load(os.path.join(INTER, f'walkback_phys_{dth}.npy'))
    default_route = next(r for r in routes if r['is_default'])
    out_st = []
    for s in sites:
        r, c = g5.rc(s['x'], s['y'])
        leg_end = next((l['distance_at_end_m'] for l in default_route.get('legs', []) if l['to'] == s['id']), None)
        out_st.append({**s, 'cell_rc': [r, c], 'provenance': int(prov[r, c]), 'slope_5m_deg': float(slope[r, c]),
                       'elev_5m_m': float(elev[r, c]),
                       'direct_return_cost_eq_m': float(wb[r, c]), 'direct_return_physical_m': float(wbp[r, c]),
                       'straight_line_to_lander_m': float(np.hypot(s['x'] - lander['x'], s['y'] - lander['y'])),
                       'along_itinerary_distance_m': leg_end,
                       'outside_budget': {str(B): bool(wb[r, c] > B) for B in budgets}})
    write_json(os.path.join(INTER, 'routes_local.json'), routes)
    write_json(os.path.join(INTER, 'walkback_local.json'), walk)
    write_json(os.path.join(INTER, 'profiles.json'), {'smoothing': f'{SMOOTH_N}-vertex (~25 m) moving average of 5 m-cell mean elevation before ascent/descent',
                                                       'profiles': profiles})
    write_json(os.path.join(INTER, 'stations_local.json'), out_st)


if __name__ == '__main__':
    main()
