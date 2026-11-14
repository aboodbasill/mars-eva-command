# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Phase 7/9 — export compact release artefacts for the static app (plan §8 data contracts).

Writes app/data/*.json (contracts), image overlays, compact binary grids, a JS bundle (so the app also runs from
file:// without fetch), and manifest.json with SHA-256 checksums. Mock data is never written here.
"""
import base64
import io
import os
import sys
import json
import datetime as dt

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
from common import ROOT, META, INTER, APPDATA, URLS, load_config, build_id, Grid, write_json, read_json, sha256  # noqa: E402

import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from PIL import Image  # noqa: E402

SCHEMA = '1.0.0'
ASSUMPTIONS = [
    {'id': 'A-01', 'label': 'ASSUMPTION', 'text': 'Local projection eqc lat_ts=18.45, lon_0=77.45, R=3,396,190 m; lat_0=18.45 added only to move the origin (no scale change).'},
    {'id': 'A-02', 'label': 'LIMITED', 'text': 'Slope limits 15/20/25° (default 20°) and θpref 15° are lunar-derived (20°: NASA 2020 Lunar Surface EVA ConOps; 15°: Peña-Asensio et al. 2023), not Mars suit limits.'},
    {'id': 'A-03', 'label': 'ASSUMPTION', 'text': 'Evidence penalty ×1.5 on CTX-only cells and blocking of no-data cells is a design preference, not measured risk.'},
    {'id': 'A-04', 'label': 'ASSUMPTION', 'text': 'Symmetric edge cost c = d·(1+(max slope/15°)²)·max penalty (model symmetric-max-v1); no uphill/downhill asymmetry.'},
    {'id': 'A-05', 'label': 'LIMITED', 'text': 'Return budgets 0.5/1/2/10 km-equivalent are demonstration presets (2 km: Artemis EVA ConOps radius; 10 km: Walkback Test, SAE 2007-01-3133); they do not validate a weighted budget or life support.'},
    {'id': 'A-06', 'label': 'ASSUMPTION', 'text': '5 m routing cell slope = maximum 1 m Horn slope; cell HiRISE-supported only if ≥ 90 % of 1 m slopes valid.'},
    {'id': 'A-07', 'label': 'LIMITED', 'text': 'Station positions = last Perseverance waypoint at or before the sampling sol (Herd et al. 2025), ±5 m assumed.'},
    {'id': 'A-08', 'label': 'LIMITED', 'text': 'Depot inspection point = centroid of the 10 tube-drop rover positions from the PDS depot bundle; each tube lies within ~1-2 m of its rover position (assumed).'},
    {'id': 'A-09', 'label': 'CONFIRMED', 'text': 'NASEM (2026) objective numbers 1 (habitability/life) and 3 (geologic record) on station cards checked against the report, doi:10.17226/28594, on 14 Nov 2026.'},
    {'id': 'A-10', 'label': 'ASSUMPTION', 'text': 'Snapping a blocked stop to the nearest traversable cell within 15 m is disclosed with its displacement; the requested point is preserved.'},
    {'id': 'A-11', 'label': 'ASSUMPTION', 'text': 'Ascent/descent use a 5-vertex (~25 m) moving average of 5 m-cell elevation; raw values reported alongside.'},
    {'id': 'A-12', 'label': 'ASSUMPTION', 'text': 'Scout score weights and normalisations are design choices; access uses the crew cost graph as a proxy (no robot mobility model).'},
]


def load(name):
    with rasterio.open(os.path.join(INTER, name)) as d:
        return d.read(1)


def stretch(a, lo=1, hi=99):
    v = a[np.isfinite(a) & (a > 0)]
    p0, p1 = np.percentile(v, [lo, hi])
    return np.clip((a - p0) / (p1 - p0) * 255, 0, 255)


def save_jpg(name, a, q=82):
    Image.fromarray(a.astype(np.uint8), 'L').save(os.path.join(APPDATA, name), quality=q, optimize=True)


def save_png(name, rgba):
    Image.fromarray(rgba.astype(np.uint8), 'RGBA').save(os.path.join(APPDATA, name), optimize=True)


def hex2rgb(h):
    h = h.lstrip('#')
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def hatch(shape, spacing=6, cross=False, scale=1):
    r, c = np.mgrid[0:shape[0], 0:shape[1]]
    m = ((r + c) // scale) % spacing == 0
    if cross:
        m |= ((r - c) // scale) % spacing == 0
    return m


SLOPE_CLASSES = [(0, 10, '#1a9850', '0–10°'), (10, 15, '#91cf60', '10–15°'), (15, 20, '#fee08b', '15–20°'),
                 (20, 25, '#fc8d59', '20–25°'), (25, 90, '#d73027', '> 25°')]
PROV = {1: ('#3fb6c4', 'Derived, high-res (HiRISE 1 m DTM)'), 2: ('#f2a541', 'Derived, low-res (CTX 20 m DTM only)'),
        0: ('#e5383b', 'No elevation data')}
BUDGET_COL = {500: '#9be7ff', 1000: '#4cc9f0', 2000: '#4361ee', 10000: '#7209b7'}


def coarsen2(f):
    """10 m version of a 5 m distance field: max of each 2x2 block (conservative), unreachable only if all 4 are."""
    H, W = (f.shape[0] // 2) * 2, (f.shape[1] // 2) * 2
    b = f[:H, :W].reshape(H // 2, 2, W // 2, 2)
    fin = np.where(np.isfinite(b), b, -np.inf).max(axis=(1, 3))
    return np.where(np.isfinite(fin), fin, np.inf)


def u16grid(f, factor=1, units='m'):
    q = np.where(np.isfinite(f), np.clip(np.round(f), 0, 65534), 65535).astype('<u2')
    return {'dtype': 'uint16', 'scale': 1.0, 'nodata': 65535, 'units': units, 'factor': factor,
            'ncols': int(q.shape[1]), 'nrows': int(q.shape[0]), 'b64': b64(q)}


def b64(arr):
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode()


def main():
    cfg = load_config()
    bid = build_id()
    os.makedirs(APPDATA, exist_ok=True)
    stats = read_json(os.path.join(META, 'terrain_stats.json'))
    aoi = read_json(os.path.join(META, 'aoi.json'))
    insp = read_json(os.path.join(META, 'inspect.json'))
    g1, g5, g20 = Grid.from_dict(stats['grid_1m']), Grid.from_dict(stats['grid_5m']), Grid.from_dict(stats['grid_20m'])
    b = aoi['local_bounds_m']
    full_bounds = [[b['ymin'], b['xmin']], [b['ymax'], b['xmax']]]
    layers = []

    def layer(**kw):
        kw.setdefault('bounds', full_bounds)
        layers.append(kw)

    # ---- imagery ----
    ho = load('ortho_hirise_1m.tif').astype(float)
    ho[ho == 0] = np.nan
    im = np.nan_to_num(stretch(ho), nan=0)
    save_jpg('hirise_ortho_1m.jpg', im, q=78)
    layer(id='hirise_ortho', title='HiRISE orthomosaic', file='hirise_ortho_1m.jpg', group='Imagery', default=True,
          mission='Mars Reconnaissance Orbiter', instrument='HiRISE', product='JEZ_hirise_soc_006_orthoMosaic_25cm (first)',
          native_resolution_m=0.25, display_resolution_m=1.0, evidence='orbital_observation', units='DN (8-bit, contrast stretched)',
          processing='Remote range read of every 4th 25 cm row, 4-column mean (≈1 m), reprojected to local eqc (bilinear), 1–99 % stretch',
          date='HiRISE images 2007–2014 (mosaic released 2020; VERIFY per-image dates in product metadata)',
          url=URLS['hirise_ortho'], doi='10.5066/P9QJDP48', license='Public domain (USGS); credit NASA/JPL/UArizona/USGS',
          limitations='Imagery does not establish trafficability. Display is decimated; native 25 cm chips are provided at stations.')
    co6 = load('ortho_ctx_6m.tif').astype(float)
    co6[co6 == 0] = np.nan
    save_jpg('ctx_ortho_6m.jpg', np.nan_to_num(stretch(co6), nan=0), q=85)
    layer(id='ctx_ortho', title='CTX orthomosaic', file='ctx_ortho_6m.jpg', group='Imagery', default=False,
          mission='Mars Reconnaissance Orbiter', instrument='CTX', product='JEZ_ctx_B_soc_008_orthoMosaic_6m',
          native_resolution_m=6.0, display_resolution_m=6.0, evidence='orbital_observation', units='DN (8-bit)',
          processing='Reprojected to local eqc (bilinear), 1–99 % stretch', date='CTX images 2007–2018 (VERIFY)',
          url=URLS['ctx_ortho'], doi='10.5066/P9GV1ND3', license='Public domain (USGS)',
          limitations='Context imagery; registered to HiRISE with 94.1 % of matched features < 6 m (USGS metadata).')

    # ---- terrain ----
    hs = load('hillshade_1m.tif')
    save_jpg('hillshade_1m.jpg', np.nan_to_num(hs * 255, nan=0), q=75)
    layer(id='hillshade', title='Hillshade (HiRISE DTM)', file='hillshade_1m.jpg', group='Terrain', default=False,
          mission='Mars Reconnaissance Orbiter', instrument='HiRISE stereo', product='JEZ_hirise_soc_006_DTM_1m_blend40',
          native_resolution_m=1.0, display_resolution_m=1.0, evidence='orbital_observation', derived=True, units='relative illumination',
          processing='Horn 3×3 gradient on 1 m local DTM; sun azimuth 315°, altitude 45°; voids black',
          url=URLS['hirise_dtm'], doi='10.5066/P9REJ9JN', license='CC0 / public domain (USGS)', date='DTM mosaic released 2020',
          limitations='Visualisation only.')
    s5 = load('slope_5m.tif')
    prov = load('provenance_5m.tif')
    rgba = np.zeros(s5.shape + (4,), np.uint8)
    for lo, hi, col, _ in SLOPE_CLASSES:
        m = np.isfinite(s5) & (s5 >= lo) & (s5 < hi)
        rgba[m, :3] = hex2rgb(col)
        rgba[m, 3] = 255
    # pattern for the two blocked-by-default classes (colour is not the only signal)
    over = np.isfinite(s5) & (s5 >= 20)
    hm = hatch(s5.shape, spacing=4) & over
    rgba[hm, :3] = [40, 0, 0]
    save_png('slope_classes_5m.png', rgba)
    layer(id='slope', title='Slope classes (5 m routing cells)', file='slope_classes_5m.png', group='Terrain', default=False,
          mission='Mars Reconnaissance Orbiter', instrument='HiRISE stereo / CTX stereo', product='derived', native_resolution_m=1.0,
          display_resolution_m=5.0, evidence='orbital_observation', derived=True, units='degrees',
          processing='5 m cell = max of 1 m Horn slopes (HiRISE, ≥90 % support) else CTX 20 m slope; classes ≥20° hatched',
          classes=[{'range': lbl, 'color': col} for _, _, col, lbl in SLOPE_CLASSES], url=URLS['hirise_dtm'], doi='10.5066/P9REJ9JN',
          license='CC0 / public domain', date='derived in this build',
          limitations='Terrain slope at DTM scale; does not resolve individual rocks or steps smaller than ~1–2 m.')
    rgba = np.zeros(prov.shape + (4,), np.uint8)
    for code, (col, _) in PROV.items():
        m = prov == code
        rgba[m, :3] = hex2rgb(col)
        rgba[m, 3] = 70 if code == 1 else 200
    hc = hatch(prov.shape, spacing=5) & (prov == 2)
    rgba[hc, :3] = [90, 50, 0]
    hn = hatch(prov.shape, spacing=5, cross=True) & (prov == 0)
    rgba[hn, :3] = [60, 0, 0]
    save_png('provenance_5m.png', rgba)
    layer(id='provenance', title='Elevation provenance / data confidence', file='provenance_5m.png', group='Evidence', default=True,
          mission='Mars Reconnaissance Orbiter', instrument='HiRISE / CTX', product='derived support mask', native_resolution_m=5.0,
          display_resolution_m=5.0, evidence='derived', units='class',
          classes=[{'code': k, 'label': v[1], 'color': v[0], 'pattern': {1: 'solid (light)', 2: 'diagonal hatch', 0: 'cross hatch'}[k]}
                   for k, v in PROV.items()],
          processing='HiRISE-supported if ≥90 % of 1 m slopes in the 5 m cell are valid', date='derived in this build',
          url=URLS['hirise_dtm'], license='derived', limitations='Support is property-specific: imagery coverage does not imply elevation coverage.')

    # ---- THEMIS ----
    if os.path.exists(os.path.join(INTER, 'themis_nightir_20m.tif')):
        t = load('themis_nightir_20m.tif').astype(float)
        t[t == 0] = np.nan
        save_jpg('themis_night_20m.jpg', np.nan_to_num(stretch(t), nan=0), q=85)
        layer(id='themis_night', title='THEMIS night IR (qualitative)', file='themis_night_20m.jpg', group='Thermal', default=False,
              mission='2001 Mars Odyssey', instrument='THEMIS', product='nili_THEMIS_NightIR_Controlled_oct2018 (SIM 3464 bundle)',
              native_resolution_m=100.0, display_resolution_m=20.0, evidence='orbital_observation', units='DN (relative brightness)',
              processing='Reprojected from MTM 77.5°E to local eqc; 1–99 % stretch', date='mosaic Oct 2018 (multi-year compilation)',
              url=URLS['sim3464'], doi='10.3133/sim3464', license='Public domain (USGS)',
              limitations='Qualitative: brighter at night generally indicates higher thermal inertia (rockier/indurated). '
                          'Not calibrated temperature, not a route forecast. Native ~100 m.')

    # ---- geology ----
    geo = read_json(os.path.join(INTER, 'geology_local.json'))
    for f in geo['features']:
        f['unit'] = f.get('symbol') or f['unit']   # map symbol (e.g. NHjf2) is the readable unit label
    units = sorted({f['unit'] for f in geo['features']})
    pal = ['#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd',
           '#ccebc5', '#ffed6f', '#a6cee3', '#b2df8a', '#fb9a99', '#cab2d6']
    unit_col = {u: pal[i % len(pal)] for i, u in enumerate(units)}
    unit_name = {f['unit']: f.get('name') for f in geo['features']}
    write_json(os.path.join(APPDATA, 'geology_local.json'), {'features': geo['features'], 'colors': unit_col, 'names': unit_name})
    layer(id='geology', title='Geologic units (SIM 3464)', file='geology_local.json', kind='vector', group='Geology', default=False,
          mission='USGS Planetary Geologic Mapping (on MRO CTX base)', instrument='photogeologic mapping', product='SIM 3464 GeoUnits_v1',
          native_resolution_m=None, scale='1:75,000', evidence='interpretive', units='geologic unit',
          known_offset_m='100–200 m (semi-controlled CTX base; USGS readme)', processing='MTM 77.5°E → local eqc; clipped; simplified 2 m',
          date='published 2020 (Sun & Stack)', url='https://pubs.usgs.gov/sim/3464/', doi='10.3133/sim3464', license='Public domain (USGS)',
          legend=[{'unit': u, 'name': unit_name[u], 'color': unit_col[u]} for u in units],
          limitations='Scientific interpretation at 1:75,000 with 100–200 m registration offsets; never used for routing.')

    # ---- rover ----
    trav = read_json(os.path.join(INTER, 'rover_traverse_local.json'))
    wps = read_json(os.path.join(INTER, 'rover_waypoints_local.json'))
    write_json(os.path.join(APPDATA, 'rover_local.json'), {'traverse': [{'sol': s['sol'], 'xy': s['xy'][::2] + [s['xy'][-1]]} for s in trav],
                                                           'waypoints': wps})
    layer(id='rover', title='Perseverance traverse & waypoints', file='rover_local.json', kind='vector', group='Rover', default=True,
          mission='Mars 2020', instrument='rover localization', product='M20_traverse.json / M20_waypoints.json',
          native_resolution_m=None, evidence='direct_surface_measurement', units='position',
          processing='lon/lat (Mars 2000 sphere) → local eqc', date=f"sols {min(w['sol'] for w in wps)}–{max(w['sol'] for w in wps)}",
          downloaded=insp['products']['rover_waypoints']['downloaded_utc'], url=URLS['rover_waypoints'],
          license='NASA/JPL-Caltech (credit required)',
          limitations='Plausibility reference, not astronaut ground truth. Legacy endpoint; archive copy recommended (PDS Analyst\'s Notebook).')

    # ---- depot tubes (PDS) ----
    tubes_p = os.path.join(META, 'depot_tubes.json')
    depot_tubes = read_json(tubes_p) if os.path.exists(tubes_p) else None
    if depot_tubes:
        layer(id='depot_tubes', title='Depot sample tubes (PDS)', file='bundle', kind='vector', group='Rover', default=True,
              mission='Mars 2020', instrument='rover localization at tube drop', product='mars2020_sample_depot_three_forks: sample_tube_locations v1.0',
              native_resolution_m=None, evidence='direct_surface_measurement', units='position, azimuth',
              processing='lat/lon (planetocentric) -> local eqc', date='sols 653-690 (Dec 2022 - Jan 2023)',
              url=depot_tubes['url'], license='NASA PDS (public)', limitations=depot_tubes['position_meaning'])

    # ---- walk-back fields ----
    walk = read_json(os.path.join(INTER, 'walkback_local.json'))
    grids = {}
    for w in walk:
        th = int(w['theta_max_deg'])
        f = np.load(os.path.join(INTER, f'walkback_{th}.npy'))
        rgba = np.zeros(f.shape + (4,), np.uint8)
        for B in sorted(cfg['walkback']['budgets_m'], reverse=True):
            m = f <= B
            rgba[m, :3] = hex2rgb(BUDGET_COL[B])
            rgba[m, 3] = 95
        # contour edges
        for B in cfg['walkback']['budgets_m']:
            m = f <= B
            e = m & ~(np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1))
            rgba[e] = [255, 255, 255, 230]
        save_png(f'walkback_{th}.png', rgba)
        w['file'] = f'walkback_{th}.png'
        w['bounds'] = full_bounds
        grids[f'walkback_{th}'] = u16grid(coarsen2(f.astype(float)), 2, 'equivalent-flat m')
        fp = np.load(os.path.join(INTER, f'walkback_phys_{th}.npy'))
        grids[f'walkback_phys_{th}'] = u16grid(coarsen2(fp.astype(float)), 2)
    for w in walk:
        w['budget_colors'] = {str(k): v for k, v in BUDGET_COL.items()}
    write_json(os.path.join(APPDATA, 'walkback_local.json'), walk)

    # ---- backup-rover safe-haven fields (merged from Marswalk Planner v4.1) ----
    rover = read_json(os.path.join(INTER, 'rover.json')) if os.path.exists(os.path.join(INTER, 'rover.json')) else None
    if rover:
        for th_s in rover['scenarios']:
            th = int(float(th_s))
            f = np.load(os.path.join(INTER, f'haven_phys_{th}.npy'))
            grids[f'haven_phys_{th}'] = u16grid(coarsen2(f.astype(float)), 2)

    # ---- game terrain texture: HiRISE ortho, false-colour Mars tint x hillshade, <= 4096 px wide ----
    ho = load('ortho_hirise_1m.tif').astype(float)
    hs1 = load('hillshade_1m.tif')
    w = 4096
    h = int(round(ho.shape[0] * w / ho.shape[1]))
    gray = np.asarray(Image.fromarray(np.nan_to_num(stretch(np.where(ho > 0, ho, np.nan)), nan=0).astype(np.uint8)).resize((w, h), Image.LANCZOS), float) / 255
    shade = np.asarray(Image.fromarray((np.nan_to_num(hs1, nan=0.5) * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR), float) / 255
    stops_c = np.array([[0.0, 58, 34, 22], [0.45, 150, 88, 52], [0.75, 205, 140, 92], [1.0, 238, 205, 165]])
    rgb = np.stack([np.interp(gray, stops_c[:, 0], stops_c[:, k]) for k in (1, 2, 3)], -1)
    rgb *= (0.78 + 0.35 * shade)[..., None]
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB').save(os.path.join(APPDATA, 'game_terrain.jpg'), quality=84, optimize=True)

    # ---- game micro-relief normal map from the HiRISE 1 m DTM (real sub-5 m relief, high-pass) ----
    from scipy.ndimage import gaussian_filter
    z1 = load('dtm_hirise_1m.tif').astype(float)
    zf = np.where(np.isfinite(z1), z1, np.nanmean(z1))
    resid = zf - gaussian_filter(zf, 3.0)                       # remove what the 5 m mesh already carries
    gy_, gx_ = np.gradient(resid)                               # per 1 m: rows (south), cols (east)
    nx, ny, nz = -gx_, gy_, np.ones_like(gx_)                   # tangent frame: x = east (u), y = north (v), z = up
    nrm = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    rgb = np.stack([nx / nrm, ny / nrm, nz / nrm], -1) * 0.5 + 0.5
    img = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), 'RGB').resize((w, h), Image.BILINEAR)
    img.save(os.path.join(APPDATA, 'game_normal.jpg'), quality=88, optimize=True)

    # ---- compact readout grids (5 m) ----
    sq = np.where(np.isfinite(s5), np.clip(np.round(s5 * 4), 0, 254), 255).astype(np.uint8)
    grids['slope'] = {'dtype': 'uint8', 'scale': 0.25, 'nodata': 255, 'units': 'deg', 'b64': b64(sq)}
    grids['provenance'] = {'dtype': 'uint8', 'scale': 1, 'nodata': None, 'units': 'class', 'b64': b64(prov.astype(np.uint8))}
    e5 = load('elev_5m.tif')
    eq = np.where(np.isfinite(e5), np.clip(np.round((e5 + 3000) * 10), 0, 65534), 65535).astype('<u2')
    grids['elevation'] = {'dtype': 'uint16', 'scale': 0.1, 'offset': -3000, 'nodata': 65535, 'units': 'm', 'b64': b64(eq)}

    # ---- station chips (25 cm) ----
    chips = read_json(os.path.join(META, 'chips.json'))
    chip_out = {}
    for sid, gd in chips.items():
        p = os.path.join(INTER, f'chip_{sid}_local.tif')
        if os.path.exists(p):
            with rasterio.open(p) as d:
                a = d.read(1).astype(float)
            a[a == 0] = np.nan
            save_jpg(f'chip_{sid}.jpg', np.nan_to_num(stretch(a, 0.5, 99.5), nan=0), q=85)
            g = Grid.from_dict(gd)
            chip_out[sid] = {'file': f'chip_{sid}.jpg', 'bounds': g.bounds, 'resolution_m': 0.25, 'size_m': g.ncols * 0.25}

    # ---- recon ----
    rec = read_json(os.path.join(INTER, 'recon.json'))
    gb = Grid.from_dict(rec['block_grid'])
    cov = np.load(os.path.join(INTER, 'recon_coverage.npy'))
    rgba = np.zeros(cov.shape + (4,), np.uint8)
    rgba[cov == 1] = [63, 182, 196, 40]
    rgba[cov == 2] = [242, 165, 65, 190]
    rgba[cov == 0] = [229, 56, 59, 210]
    up = lambda a, k=10: np.repeat(np.repeat(a, k, 0), k, 1)  # noqa: E731
    big = up(rgba)
    hm = hatch(big.shape[:2], 6) & (up(cov) == 2)
    big[hm, :3] = [90, 50, 0]
    hm = hatch(big.shape[:2], 6, True) & (up(cov) == 0)
    big[hm, :3] = [60, 0, 0]
    save_png('recon_coverage.png', big)
    rec_layers = [{'id': 'recon_coverage', 'file': 'recon_coverage.png', 'bounds': gb.bounds, 'title': 'Elevation-detail coverage (100 m blocks)'}]
    if os.path.exists(os.path.join(INTER, 'recon_pred.npy')):
        pred = np.load(os.path.join(INTER, 'recon_pred.npy'))
        dom = np.load(os.path.join(INTER, 'recon_in_domain.npy'))
        split = np.load(os.path.join(INTER, 'recon_split.npy'))
        resid = np.load(os.path.join(INTER, 'recon_resid.npy'))
        tgt = np.load(os.path.join(INTER, 'recon_target.npy'))
        # split map
        rgba = np.zeros(split.shape + (4,), np.uint8)
        rgba[split == 0] = [180, 180, 180, 50]
        rgba[split == 1] = [255, 210, 63, 120]
        rgba[split == 2] = [131, 56, 236, 120]
        rgba[split == -1] = [0, 0, 0, 0]
        save_png('recon_split.png', up(rgba))
        rec_layers.append({'id': 'recon_split', 'file': 'recon_split.png', 'bounds': gb.bounds, 'title': 'Spatial split (train / calibration / test)'})
        # residuals on test blocks (diverging), only where labels exist
        rgba = np.zeros(resid.shape + (4,), np.uint8)
        ok = np.isfinite(resid)
        v = np.clip(resid / 3.0, -1, 1)
        rgba[ok & (v >= 0)] = np.column_stack([np.full((ok & (v >= 0)).sum(), 215), (255 * (1 - v[ok & (v >= 0)])).astype(int),
                                               (255 * (1 - v[ok & (v >= 0)])).astype(int), np.full((ok & (v >= 0)).sum(), 200)])
        rgba[ok & (v < 0)] = np.column_stack([(255 * (1 + v[ok & (v < 0)])).astype(int), (255 * (1 + v[ok & (v < 0)])).astype(int),
                                              np.full((ok & (v < 0)).sum(), 215), np.full((ok & (v < 0)).sum(), 200)])
        save_png('recon_residuals.png', up(rgba))
        rec_layers.append({'id': 'recon_residuals', 'file': 'recon_residuals.png', 'bounds': gb.bounds,
                           'title': 'Held-out residuals (prediction − HiRISE label), ±3° scale'})
        grids['recon_pred'] = {'dtype': 'uint8', 'scale': 0.25, 'nodata': 255, 'units': 'deg',
                               'b64': b64(np.where(np.isfinite(pred), np.clip(np.round(pred * 4), 0, 254), 255).astype(np.uint8)),
                               'shape': list(pred.shape)}
        grids['recon_domain'] = {'dtype': 'uint8', 'scale': 1, 'nodata': None, 'units': 'flag', 'b64': b64(dom.astype(np.uint8)),
                                 'shape': list(dom.shape)}
        grids['recon_target'] = {'dtype': 'uint8', 'scale': 0.25, 'nodata': 255, 'units': 'deg',
                                 'b64': b64(np.where(np.isfinite(tgt), np.clip(np.round(tgt * 4), 0, 254), 255).astype(np.uint8)),
                                 'shape': list(tgt.shape)}
        if rec['model'].get('released'):
            # released predictions only where HiRISE label is absent and inside feature domain; hatched distinct pattern
            show = dom & ~np.isfinite(tgt) & np.isfinite(pred)
            rgba = np.zeros(pred.shape + (4,), np.uint8)
            for lo, hi, col, _ in SLOPE_CLASSES:
                m = show & (pred >= lo) & (pred < hi)
                rgba[m, :3] = hex2rgb(col)
                rgba[m, 3] = 210
            big = up(rgba)
            hm = hatch(big.shape[:2], 3, True, 1) & (big[..., 3] > 0)
            big[hm, :3] = [255, 255, 255]
            save_png('recon_prediction.png', big)
            rec_layers.append({'id': 'recon_prediction', 'file': 'recon_prediction.png', 'bounds': gb.bounds,
                               'title': 'AI estimate of mean slope in HiRISE gaps (dotted pattern)'})
    rec['layers'] = rec_layers
    rec['chips'] = chip_out

    # ---- contracts ----
    routes = read_json(os.path.join(INTER, 'routes_local.json'))
    stations = read_json(os.path.join(INTER, 'stations_local.json'))
    profiles = read_json(os.path.join(INTER, 'profiles.json'))
    validation = read_json(os.path.join(INTER, 'validation.json'))
    env = read_json(os.path.join(META, 'environment_meda.json')) if os.path.exists(os.path.join(META, 'environment_meda.json')) else None
    ctx = read_json(os.path.join(META, 'environment_context.json'))
    swx_p = os.path.join(META, 'spaceweather.json')
    environment = {'meda': env, 'context': ctx, 'spaceweather': read_json(swx_p) if os.path.exists(swx_p) else None}
    write_json(os.path.join(APPDATA, 'layers.json'), layers)
    write_json(os.path.join(APPDATA, 'routes_local.json'), routes)
    write_json(os.path.join(APPDATA, 'stations_local.json'), stations)
    write_json(os.path.join(APPDATA, 'profiles.json'), profiles)
    write_json(os.path.join(APPDATA, 'environment.json'), environment)
    write_json(os.path.join(APPDATA, 'validation.json'), validation)
    write_json(os.path.join(APPDATA, 'recon.json'), rec)
    grid_meta = {'grid_5m': g5.to_dict(), 'block_grid': rec['block_grid'], 'grids': grids}
    with open(os.path.join(APPDATA, 'grids.js'), 'w') as fh:
        fh.write('window.MEC_GRIDS=' + json.dumps(grid_meta, separators=(',', ':')) + ';\n')

    # Build id = hash(config + every exported data file + app code) so any change invalidates the offline cache.
    import hashlib
    h = hashlib.sha256(open(os.path.join(ROOT, 'config', 'mission.yaml'), 'rb').read())
    for f in sorted(os.listdir(APPDATA)):
        if f not in ('bundle.js', 'manifest.json'):
            h.update(f.encode()); h.update(sha256(os.path.join(APPDATA, f)).encode())
    for f in ('index.html', 'app.js', 'style.css', 'service-worker.js', 'mars24.js', 'game/index.html', 'game/game.js', 'game/game.css',
              'game/route.js', 'game/audio.js'):
        h.update(sha256(os.path.join(ROOT, 'app', f)).encode())
    h.update(json.dumps([layers, routes, stations, rec['model'], ASSUMPTIONS], sort_keys=True, default=str).encode())
    bid = 'mec-' + h.hexdigest()[:12]
    manifest = {
        'schema_version': SCHEMA, 'build_id': bid, 'built_utc': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
        'mission': cfg['mission'], 'synthetic': False,
        'crs': {'local': cfg['crs']['local'], 'geographic': cfg['crs']['geographic'], 'source': cfg['crs']['source_eqc'],
                'leaflet': 'CRS.Simple; points passed as [y, x] local metres; bounds [[ymin,xmin],[ymax,xmax]]',
                'geojson_note': 'Vector files here are custom local-metre JSON, deliberately NOT standard (WGS84) GeoJSON.'},
        'aoi': aoi, 'grids': {'g1': g1.to_dict(), 'g5': g5.to_dict(), 'g20': g20.to_dict()},
        'cost_model_version': cfg['routing']['cost_model_version'],
        'config': {'routing': cfg['routing'], 'walkback': cfg['walkback'], 'terrain': cfg['terrain'], 'recon': cfg['recon']},
        'sources_inspected': {k: {kk: v.get(kk) for kk in ('url', 'sha256', 'bytes', 'width', 'height', 'res_m', 'crs_proj4')}
                              for k, v in insp['products'].items()},
        'conventions': insp['conventions'],
        'assumptions': ASSUMPTIONS,
        'nasem_objectives': {str(k): v for k, v in cfg['nasem_objectives'].items()},
        'challenge': cfg['challenge'],
        'si_acknowledgement': cfg['si_acknowledgement'],
    }
    pov = read_json(os.path.join(META, 'pov.json')) if os.path.exists(os.path.join(META, 'pov.json')) else {}
    bundle = {'manifest': manifest, 'pov': pov, 'depot_tubes': depot_tubes, 'rover': rover, 'layers': layers, 'routes': routes, 'stations': stations, 'profiles': profiles,
              'walkback': walk, 'environment': environment, 'validation': validation, 'recon': rec,
              'geology': read_json(os.path.join(APPDATA, 'geology_local.json')), 'rover_track': read_json(os.path.join(APPDATA, 'rover_local.json')),
              'game': read_json(os.path.join(APPDATA, 'game_assets.json')) if os.path.exists(os.path.join(APPDATA, 'game_assets.json')) else None}
    with open(os.path.join(APPDATA, 'bundle.js'), 'w') as fh:
        fh.write('window.MEC_DATA=' + json.dumps(bundle, separators=(',', ':'), allow_nan=False) + ';\n')
    files = sorted(f for f in os.listdir(APPDATA) if f != 'manifest.json')
    manifest['assets'] = [{'file': f, 'bytes': os.path.getsize(os.path.join(APPDATA, f)), 'sha256': sha256(os.path.join(APPDATA, f))} for f in files]
    manifest['total_bytes'] = sum(a['bytes'] for a in manifest['assets'])
    write_json(os.path.join(APPDATA, 'manifest.json'), manifest)
    # asset list for the service worker (versioned by build id)
    app_root = os.path.join(ROOT, 'app')
    static = ['./', 'index.html', 'app.js', 'style.css', 'mars24.js', 'lib/leaflet.min.js', 'lib/leaflet.min.css', 'lib/chart.umd.min.js',
              'lib/three.min.js', 'lib/fonts/RobotoCondensed-latin.woff2', 'game/', 'game/index.html', 'game/game.js', 'game/game.css',
              'game/route.js', 'game/audio.js']
    with open(os.path.join(app_root, 'precache.js'), 'w') as fh:
        fh.write(f"self.MEC_BUILD={json.dumps(bid)};\nself.MEC_ASSETS={json.dumps(static + ['data/' + f for f in files] + ['data/manifest.json'])};\n")
    print('exported', len(files), 'files,', round(manifest['total_bytes'] / 1e6, 2), 'MB; build', bid)


if __name__ == '__main__':
    main()
