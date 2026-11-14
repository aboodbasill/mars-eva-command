# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Phase 7 — reproducible validation. Every number written here is computed from this build; nothing is pre-filled.

Writes data/intermediate/validation.json and docs/validation.md.
"""
import os
import sys
import math
import subprocess
import datetime as dt

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, 'routing'))
from common import ROOT, META, INTER, RAW, load_config, build_id, Coords, Grid, great_circle_m, write_json, read_json  # noqa: E402
from engine import CostGrid, SQRT2  # noqa: E402

import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from scipy.ndimage import map_coordinates  # noqa: E402


def load(name):
    with rasterio.open(os.path.join(INTER, name)) as d:
        return d.read(1), d.transform


def sample_bilinear(arr, transform, xs, ys):
    inv = ~transform
    cols, rows = inv * (np.asarray(xs), np.asarray(ys))
    return map_coordinates(arr.astype(float), [np.asarray(rows) - 0.5, np.asarray(cols) - 0.5], order=1, mode='constant',
                           cval=np.nan)


def resample_polyline(xy, step):
    xy = np.asarray(xy, float)
    seg = np.hypot(*np.diff(xy, axis=0).T)
    keep = seg > 0
    if not keep.any():
        return np.empty((0, 2)), np.empty(0)
    xy = np.vstack([xy[0], xy[1:][keep]])
    seg = seg[keep]
    s = np.concatenate([[0], np.cumsum(seg)])
    t = np.arange(step / 2, s[-1], step)
    return np.column_stack([np.interp(t, s, xy[:, 0]), np.interp(t, s, xy[:, 1])]), np.full(len(t), step)


def main():
    cfg = load_config()
    co = Coords(cfg)
    stats = read_json(os.path.join(META, 'terrain_stats.json'))
    g5 = Grid.from_dict(stats['grid_5m'])
    sites = read_json(os.path.join(META, 'sites.json'))
    routes = read_json(os.path.join(INTER, 'routes_local.json'))
    walk = read_json(os.path.join(INTER, 'walkback_local.json'))
    V = {'build_id': build_id(), 'generated_utc': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
         'method_note': 'All values computed by pipeline/08_validate.py from this build.'}

    # 1. Projection -------------------------------------------------------------------------------
    lander = next(s for s in sites if s['kind'] == 'lander')
    x, y = co.lonlat_to_local(lander['lon'], lander['lat'])
    lo, la = co.local_to_lonlat(x, y)
    rt_err = great_circle_m(lander['lon'], lander['lat'], lo, la)
    ref = cfg['lander']['plan_reference']
    ref_d = great_circle_m(lander['lon'], lander['lat'], ref['lon'], ref['lat'])
    rel = []
    for a in sites:
        for b in sites:
            if a['id'] < b['id']:
                gc = great_circle_m(a['lon'], a['lat'], b['lon'], b['lat'])
                pr = math.hypot(a['x'] - b['x'], a['y'] - b['y'])
                rel.append(abs(pr - gc) / gc)
    sx0, _ = co.geo2src.transform(77.40, 18.45)
    sx1, _ = co.geo2src.transform(77.45, 18.45)
    src_err = (sx1 - sx0) / great_circle_m(77.40, 18.45, 77.45, 18.45) - 1
    V['projection'] = {
        'round_trip_error_m': rt_err,
        'lander_waypoint_vs_plan_reference_m': ref_d,
        'plan_reference': ref, 'lander_waypoint': [lander['lon'], lander['lat']],
        'max_relative_distance_error_local_vs_great_circle': max(rel), 'site_pairs': len(rel),
        'source_projection_ew_scale_error': src_err,
        'pass': rt_err < 0.01 and max(rel) < 1e-3,
        'note': 'Round trip tests mathematical consistency only; registration is tested in section 2.'}

    # 2. Registration: DTM vs rover-localized elevations --------------------------------------------
    wl = read_json(os.path.join(INTER, 'rover_waypoints_local.json'))
    z1, t1 = load('dtm_hirise_1m.tif')
    zc, tc = load('dtm_ctx_20m.tif')
    wx, wy = [w['x'] for w in wl], [w['y'] for w in wl]
    we = np.array([w['elev_geoid'] for w in wl], float)
    dh = sample_bilinear(z1, t1, wx, wy) - we
    dc = sample_bilinear(zc, tc, wx, wy) - we
    ok_h, ok_c = np.isfinite(dh), np.isfinite(dc)
    V['registration_rover_elevation'] = {
        'waypoints_in_aoi': len(wl),
        'hirise_minus_rover_m': {'count': int(ok_h.sum()), 'median': float(np.median(dh[ok_h])), 'p05': float(np.percentile(dh[ok_h], 5)),
                                 'p95': float(np.percentile(dh[ok_h], 95)), 'mad': float(np.median(np.abs(dh[ok_h] - np.median(dh[ok_h]))))},
        'ctx_minus_rover_m': {'count': int(ok_c.sum()), 'median': float(np.median(dc[ok_c])), 'p05': float(np.percentile(dc[ok_c], 5)),
                              'p95': float(np.percentile(dc[ok_c], 95))},
        'limitation': 'Rover elevations come from localization against orbital maps, so this tests our reprojection and '
                      'registration chain (a mis-registered grid would show large, spatially structured residuals), not '
                      'independent DTM accuracy.'}

    # 3. Raster alignment --------------------------------------------------------------------------
    al = {}
    for name in ('dtm_hirise_1m.tif', 'slope_hirise_1m.tif', 'dtm_ctx_20m.tif', 'slope_5m.tif', 'provenance_5m.tif', 'elev_5m.tif'):
        with rasterio.open(os.path.join(INTER, name)) as d:
            al[name] = {'origin': [d.transform.c, d.transform.f], 'cell': d.transform.a, 'shape': [d.height, d.width],
                        'crs': d.crs.to_proj4()}
    origins = {tuple(v['origin']) for v in al.values()}
    extents = {(v['cell'] * v['shape'][0], v['cell'] * v['shape'][1]) for v in al.values()}
    V['raster_alignment'] = {'grids': al, 'common_origin': len(origins) == 1, 'common_extent_m': len(extents) == 1,
                             'common_crs': len({v['crs'] for v in al.values()}) == 1,
                             'pass': len(origins) == 1 and len(extents) == 1}

    # 4. HiRISE vs CTX ------------------------------------------------------------------------------
    V['hirise_vs_ctx'] = {**stats['hirise_minus_ctx_m'],
                          'usgs_product_wide_reference_m': -0.4,
                          'note': 'USGS reports HiRISE ~0.4 m below CTX product-wide; a local AOI can differ.'}

    # 5. Rover plausibility ------------------------------------------------------------------------
    slope = load('slope_5m.tif')[0]
    prov = load('provenance_5m.tif')[0]
    trav = read_json(os.path.join(INTER, 'rover_traverse_local.json'))
    pts, wts = [], []
    b = read_json(os.path.join(META, 'aoi.json'))['local_bounds_m']
    for s in trav:
        p, w = resample_polyline(s['xy'], 1.0)
        if len(p):
            inside = (p[:, 0] > b['xmin']) & (p[:, 0] < b['xmax']) & (p[:, 1] > b['ymin']) & (p[:, 1] < b['ymax'])
            pts.append(p[inside]); wts.append(w[inside])
    P = np.vstack(pts)
    W = np.concatenate(wts)
    rr = ((g5.y0 - P[:, 1]) // g5.cell).astype(int)
    cc = ((P[:, 0] - g5.x0) // g5.cell).astype(int)
    s_on = slope[rr, cc]
    p_on = prov[rr, cc]
    total = float(W.sum())
    rover = {'traverse_length_in_aoi_m': total, 'sample_spacing_m': 1.0, 'by_theta': {}}
    for th in cfg['routing']['scenarios_deg']:
        unknown = ~np.isfinite(s_on)
        blocked = ~unknown & (s_on > th)
        passable = ~unknown & ~blocked
        rover['by_theta'][str(th)] = {'passable_fraction': float(W[passable].sum() / total),
                                      'blocked_fraction': float(W[blocked].sum() / total),
                                      'unknown_fraction': float(W[unknown].sum() / total)}
    rover['max_mapped_slope_sampled_deg'] = float(np.nanmax(s_on))
    rover['p99_mapped_slope_sampled_deg'] = float(np.nanpercentile(s_on, 99))
    rover['hirise_supported_fraction'] = float(W[p_on == 1].sum() / total)
    rover['wording'] = ('Maximum mapped 5 m-cell terrain slope sampled along the recorded path (subject to positional and '
                        'grid support), not the maximum slope the rover physically crossed. A rover is not an astronaut.')
    V['rover_plausibility'] = rover

    # 6. Route constraints ---------------------------------------------------------------------------
    pen = load('penalty_5m.tif')[0]
    rc_checks = []
    for r in routes:
        if not r['feasible']:
            rc_checks.append({'scenario': r['scenario_id'], 'feasible': False, 'failure': r.get('failure')})
            continue
        g = CostGrid(slope, pen, g5.cell, theta_max=r['theta_max_deg'], theta_pref=cfg['routing']['theta_pref_deg'])
        xy = np.asarray(r['geometry_xy'])
        R = ((g5.y0 - xy[:, 1]) // g5.cell).astype(int)
        C = ((xy[:, 0] - g5.x0) // g5.cell).astype(int)
        over = int((slope[R, C] > r['theta_max_deg']).sum())
        nodata = int((prov[R, C] == 0).sum())
        corner = 0
        cost = 0.0
        for i in range(len(R) - 1):
            dr, dc = R[i + 1] - R[i], C[i + 1] - C[i]
            assert max(abs(dr), abs(dc)) == 1, 'non-adjacent step'
            diag = dr != 0 and dc != 0
            if diag and (g.blocked[R[i], C[i + 1]] or g.blocked[R[i + 1], C[i]]):
                corner += 1
            cost += g.edge_cost(R[i] * g.ncols + C[i], R[i + 1] * g.ncols + C[i + 1], diag)
        rc_checks.append({'scenario': r['scenario_id'], 'feasible': True, 'cells_over_theta': over, 'cells_without_support': nodata,
                          'corner_cuts': corner, 'recomputed_cost': cost, 'reported_cost': r['weighted_cost'],
                          'cost_matches': abs(cost - r['weighted_cost']) < 1e-6 * max(1, cost),
                          'pass': over == 0 and nodata == 0 and corner == 0 and abs(cost - r['weighted_cost']) < 1e-6 * max(1, cost)})
    # Monotonicity of weighted objective per leg across scenarios
    feas = sorted([r for r in routes if r['feasible']], key=lambda r: -r['theta_max_deg'])
    mono, skipped = [], []
    for a, b2 in zip(feas, feas[1:]):
        snapped = lambda r: {sn['stop']: tuple(sn['used_rc']) for sn in r['snaps']}  # noqa: E731
        sa, sb = snapped(a), snapped(b2)
        for la, lb in zip(a['legs'], b2['legs']):
            if any(sa.get(k) != sb.get(k) for k in (la['from'], la['to'])):
                skipped.append({'leg': f"{la['from']}->{la['to']}", 'looser': a['theta_max_deg'], 'tighter': b2['theta_max_deg'],
                                'reason': 'endpoint snapped to different cells; monotonicity applies only to identical endpoints'})
                continue
            mono.append({'leg': f"{la['from']}->{la['to']}", 'looser': a['theta_max_deg'], 'tighter': b2['theta_max_deg'],
                         'cost_looser': la['cost'], 'cost_tighter': lb['cost'], 'ok': lb['cost'] >= la['cost'] - 1e-6,
                         'length_looser_m': la['length_m'], 'length_tighter_m': lb['length_m']})
    V['route_constraints'] = {'routes': rc_checks, 'monotonic_weighted_cost': mono, 'monotonic_skipped': skipped,
                              'pass': all(c.get('pass', True) for c in rc_checks) and all(m['ok'] for m in mono)}

    # 7. Return field -----------------------------------------------------------------------------
    lr, lc = g5.rc(lander['x'], lander['y'])
    wbc = []
    for w in walk:
        f = np.load(os.path.join(INTER, w['field_file'] + '.npy'))
        wbc.append({'theta_max_deg': w['theta_max_deg'], 'cost_at_lander': float(f[lr, lc]),
                    'truncated_budgets': [c['budget_m'] for c in w['contours'] if c['truncated_by_aoi']],
                    'min_neighbour_cost_m': float(np.nanmin([f[lr + dr, lc + dc] for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc]))})
    V['return_field'] = {'fields': wbc, 'pass': all(x['cost_at_lander'] == 0 and x['min_neighbour_cost_m'] >= g5.cell - 1e-9 for x in wbc)}

    # 8. Environment -------------------------------------------------------------------------------
    envp = os.path.join(META, 'environment_meda.json')
    if os.path.exists(envp):
        env = read_json(envp)
        recs = env['records']
        V['environment'] = {'bins': len(recs), 'bins_with_value': sum(r['value'] is not None for r in recs),
                            'bins_null_kept_null': sum(r['value'] is None for r in recs),
                            'all_have_units': all(r['units'] for r in recs),
                            'sols': [s['sol'] for s in env['sols']],
                            'zero_count_bins_with_value': sum(1 for r in recs if r['valid_count'] == 0 and r['value'] is not None),
                            'pass': all(r['units'] for r in recs) and not any(r['valid_count'] == 0 and r['value'] is not None for r in recs)}
    else:
        V['environment'] = {'available': False}

    # 9. Unit tests --------------------------------------------------------------------------------
    p = subprocess.run([sys.executable, '-m', 'pytest', '-q', os.path.join(ROOT, 'tests'), '-p', 'no:cacheprovider'],
                       capture_output=True, text=True, cwd=ROOT)
    tail = p.stdout.strip().splitlines()[-1] if p.stdout.strip() else p.stderr[-300:]
    V['unit_tests'] = {'command': 'python -m pytest -q tests', 'summary': tail, 'exit_code': p.returncode, 'pass': p.returncode == 0}

    V['overall_pass'] = all(V[k].get('pass', True) for k in V if isinstance(V[k], dict))
    write_json(os.path.join(INTER, 'validation.json'), V)
    write_md(V)
    print('overall', V['overall_pass'], {k: V[k].get('pass') for k in V if isinstance(V[k], dict)})


def write_md(V):
    pr, rg, rv = V['projection'], V['registration_rover_elevation'], V['rover_plausibility']
    lines = [f"# Validation log — build `{V['build_id']}`", '', f"Generated {V['generated_utc']} by `pipeline/08_validate.py`. "
             'All numbers below are measured from this build. Nothing was pre-filled.', '',
             '## 1. Projection', '',
             f"- Forward/inverse round trip at the lander: {pr['round_trip_error_m']:.2e} m (mathematical consistency only).",
             f"- Lander waypoint (sol 13, RMC 3_0) vs the plan's reference coordinate 18.4447°N 77.4508°E: {pr['lander_waypoint_vs_plan_reference_m']:.1f} m apart (the reference is rounded to 4 decimals).",
             f"- Max relative difference between local projected and great-circle distances over {pr['site_pairs']} site pairs: {pr['max_relative_distance_error_local_vs_great_circle']*100:.4f} %.",
             f"- If we had used the source equatorial-true-scale grid directly, the E–W distance error would be {pr['source_projection_ew_scale_error']*100:+.2f} %.", '',
             '## 2. Registration against rover-localized elevations', '',
             f"- {rg['waypoints_in_aoi']} Perseverance waypoints fall inside the AOI.",
             f"- HiRISE DTM minus rover elevation: median {rg['hirise_minus_rover_m']['median']:+.2f} m, 5–95 % [{rg['hirise_minus_rover_m']['p05']:+.2f}, {rg['hirise_minus_rover_m']['p95']:+.2f}] m (n = {rg['hirise_minus_rover_m']['count']}).",
             f"- CTX DTM minus rover elevation: median {rg['ctx_minus_rover_m']['median']:+.2f} m, 5–95 % [{rg['ctx_minus_rover_m']['p05']:+.2f}, {rg['ctx_minus_rover_m']['p95']:+.2f}] m (n = {rg['ctx_minus_rover_m']['count']}).",
             f"- Limitation: {rg['limitation']}", '',
             '## 3. Raster alignment', '',
             f"- Common origin: {V['raster_alignment']['common_origin']}; common extent: {V['raster_alignment']['common_extent_m']}; common CRS: {V['raster_alignment']['common_crs']}.", '',
             '## 4. HiRISE vs CTX elevation (common valid support, 20 m blocks)', '',
             f"- Median HiRISE − CTX = {V['hirise_vs_ctx']['median']:+.2f} m, 5–95 % [{V['hirise_vs_ctx']['p05']:+.2f}, {V['hirise_vs_ctx']['p95']:+.2f}] m, n = {V['hirise_vs_ctx']['count_20m_cells']} cells. USGS product-wide reference: about −0.4 m.", '',
             '## 5. Rover plausibility check', '',
             f"- Traverse length inside the AOI: {rv['traverse_length_in_aoi_m']:.0f} m, resampled every {rv['sample_spacing_m']} m (length-weighted).",
             '', '| θmax | passable | blocked | unknown |', '|---|---|---|---|']
    for th, v in rv['by_theta'].items():
        lines.append(f"| {float(th):.0f}° | {v['passable_fraction']*100:.1f} % | {v['blocked_fraction']*100:.1f} % | {v['unknown_fraction']*100:.1f} % |")
    lines += ['', f"- Maximum mapped 5 m-cell slope sampled along the recorded path: {rv['max_mapped_slope_sampled_deg']:.1f}° (99th percentile {rv['p99_mapped_slope_sampled_deg']:.1f}°).",
              f"- {rv['wording']}", '', '## 6. Route constraints', '']
    for c in V['route_constraints']['routes']:
        if c['feasible']:
            lines.append(f"- {c['scenario']}: cells over θmax = {c['cells_over_theta']}, cells without support = {c['cells_without_support']}, corner cuts = {c['corner_cuts']}, recomputed cost matches = {c['cost_matches']}.")
        else:
            lines.append(f"- {c['scenario']}: no feasible itinerary — {c['failure']}")
    bad = [m for m in V['route_constraints']['monotonic_weighted_cost'] if not m['ok']]
    lines += [f"- Weighted-cost monotonicity across scenarios: {len(V['route_constraints']['monotonic_weighted_cost'])} leg comparisons, {len(bad)} violations; {len(V['route_constraints']['monotonic_skipped'])} skipped (stop snapped to different cells).", '',
              '## 7. Return field', '']
    for f in V['return_field']['fields']:
        lines.append(f"- θmax {f['theta_max_deg']:.0f}°: cost at lander {f['cost_at_lander']}, minimum neighbour cost {f['min_neighbour_cost_m']:.2f} m; budgets truncated by the AOI: {f['truncated_budgets'] or 'none'}.")
    e = V['environment']
    lines += ['', '## 8. Environment', '']
    if e.get('available', True) and 'bins' in e:
        lines.append(f"- {e['bins']} 30-minute bins over sols {e['sols']}; {e['bins_with_value']} have values; {e['bins_null_kept_null']} stayed null (no records); units present on all: {e['all_have_units']}.")
    lines += ['', '## 9. Unit tests', '', f"- `{V['unit_tests']['command']}` → {V['unit_tests']['summary']}", '',
              f"**Overall pass: {V['overall_pass']}**", '']
    os.makedirs(os.path.join(ROOT, 'docs'), exist_ok=True)
    with open(os.path.join(ROOT, 'docs', 'validation.md'), 'w') as f:
        f.write('\n'.join(lines))


if __name__ == '__main__':
    main()
