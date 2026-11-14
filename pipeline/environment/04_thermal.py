# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Thermal layers for Jezero (simulator "Thermal Intelligence").

Three kinds of thermal information, kept separate and labelled:

1. ORBITAL OBSERVATION, CALIBRATED: Mars Odyssey THEMIS IR band 9 (12.57 um) Projected Brightness Temperature
   (PDS product type IRPBT2, data set ODY-M-THM-5-IRGEO-V2.0). Label: ODY:SAMPLE_NAME = BRIGHTNESS_TEMPERATURE,
   ODY:SAMPLE_UNIT = KELVIN, PC_REAL, NULL_CONSTANT = 0, sinusoidal map projection, ~100 m pixels.
   One afternoon and one pre-dawn image that fully cover the study area are used. Values are band-9 BRIGHTNESS
   temperatures (emissivity not removed), at the image's own date, local time and season.
2. ORBITAL OBSERVATION, QUALITATIVE: THEMIS day/night IR controlled mosaics (Oct 2018) bundled in USGS SIM 3464.
   8-bit display mosaics without calibration in the file: shown as RELATIVE thermal intensity only (no kelvin).
3. SURFACE MEASUREMENT: Perseverance MEDA TIRS ground brightness temperature (CAL_TIRS GROUND_TEMP, K) and air
   temperature, 30-min LMST means for the depot sols; MEDA is a point measurement at the rover, never spread as a map.
4. MODEL: Mars Climate Database v6.2 (LMD/ESA/CNES web interface), surface and near-surface air temperature at Jezero
   for four seasons x 24 local hours (climatology average solar scenario). Point values, GCM resolution.

Outputs (app/data): thermal_<id>.png (study-area grid, 20 m: R = value code, A = 0 where no data),
thermal_<id>_geo.png (lon/lat footprint for the globe), thermal.json (metadata, legend, coverage, alignment, MEDA,
MCD). Encoding: value = vmin + R / 254 * (vmax - vmin).
"""
import importlib.util
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
import pandas as pd
import rasterio
from PIL import Image
from rasterio.warp import Resampling, reproject

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from common import APPDATA, INTER, META, RAW, UA, Coords, Grid, load_config, read_json, write_json  # noqa: E402

HERE = os.path.dirname(__file__)


def _mod(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


RP = _mod(os.path.join(HERE, '..', 'terrain', '03_reproject.py'), 'reproject03')
MD = _mod(os.path.join(HERE, '01_process_meda.py'), 'meda01')

PBT = {   # chosen from a PDS ODE footprint search (pt=IRPBT2): footprint polygon covers 100 % of the study area;
          # day = latest-afternoon image with the sun still up (incidence 80°), night = pre-dawn (incidence 97°)
    'pbt_day': {'pid': 'I54976031PBT', 'url': 'https://static.mars.asu.edu/pds/ODTGEO_v2/data/odtip2_0050/i549xxpbt/I54976031PBT.IMG'},
    'pbt_night': {'pid': 'I75929010PBT', 'url': 'https://static.mars.asu.edu/pds/ODTGEO_v2/data/odtip2_0069/i759xxpbt/I75929010PBT.IMG'},
}
PBT_DIR = os.path.join(RAW, 'themis_pbt')
TH_DIR = os.path.join(RAW, 'sim3464', 'Rasters', 'USGS_THEMIS_IR_controlled_mosaic_oct2018')
MCD_DIR = os.path.join(RAW, 'mcd')
TIRS_SOLS = (656, 663, 670, 677, 684)


def label(path):
    raw = open(path, 'rb').read(20000).decode('latin-1')
    raw = raw[:raw.find('\nEND\r') if '\nEND\r' in raw else 20000]
    get = lambda k: (re.search(rf'^\s*{k}\s*=\s*"?([^"\r\n]+?)"?\s*$', raw, re.M) or [None, None])[1]
    keys = ('START_TIME', 'STOP_TIME', 'LOCAL_TIME', 'SOLAR_LONGITUDE', 'BAND_NUMBER', 'BAND_CENTER', 'ODY:SAMPLE_NAME',
            'ODY:SAMPLE_UNIT', 'NULL_CONSTANT', 'MAP_PROJECTION_TYPE', 'MAP_SCALE', 'MAP_RESOLUTION', 'MINIMUM_LATITUDE',
            'MAXIMUM_LATITUDE', 'WESTERNMOST_LONGITUDE', 'EASTERNMOST_LONGITUDE', 'DATA_SET_ID', 'PRODUCT_ID',
            'INCIDENCE_ANGLE', 'EMISSION_ANGLE', 'ODY:CAM2MAP_VERSION', 'SAMPLE_TYPE')
    return {k: get(k) for k in keys}


def encode(arr, vmin, vmax, path):
    ok = np.isfinite(arr)
    code = np.where(ok, np.clip(np.round((arr - vmin) / (vmax - vmin) * 254), 0, 254), 0).astype(np.uint8)
    rgba = np.zeros(arr.shape + (4,), np.uint8)
    rgba[..., 0] = code
    rgba[..., 1] = code
    rgba[..., 2] = code
    rgba[..., 3] = np.where(ok, 255, 0)
    Image.fromarray(rgba, 'RGBA').save(path, optimize=True)


def warp_to(src, dst_shape, transform, crs, src_crs=None, nodata_is_zero=True, shift=(0.0, 0.0)):
    with rasterio.open(src) as s:
        a = s.read(1).astype(np.float32)
        st = rasterio.Affine.translation(shift[0], shift[1]) * s.transform
        a[(a <= 0) | ~np.isfinite(a)] = np.nan
        out = np.full(dst_shape, np.nan, np.float32)
        reproject(a, out, src_transform=st, src_crs=src_crs or s.crs, dst_transform=transform, dst_crs=crs,
                  src_nodata=np.nan, dst_nodata=np.nan, resampling=Resampling.bilinear)
        valid = np.isfinite(a).astype(np.float32)
        m = np.zeros(dst_shape, np.float32)
        reproject(valid, m, src_transform=st, src_crs=src_crs or s.crs, dst_transform=transform, dst_crs=crs,
                  resampling=Resampling.bilinear)
        out[m < 0.999] = np.nan                      # keep no-data honest: never blend values into gaps
    return out


def geo_footprint(src, src_crs=None, step=0.0025):
    """Reproject a raster to a lon/lat grid over its own footprint (for the globe overlay)."""
    with rasterio.open(src) as s:
        from rasterio.warp import transform_bounds
        w, so, e, n = transform_bounds(src_crs or s.crs, '+proj=longlat +R=3396190 +no_defs', *s.bounds)
    w, e, so, n = np.floor(w / step) * step, np.ceil(e / step) * step, np.floor(so / step) * step, np.ceil(n / step) * step
    nc, nr = int(round((e - w) / step)), int(round((n - so) / step))
    tr = rasterio.transform.from_origin(w, n, step, step)
    return warp_to(src, (nr, nc), tr, '+proj=longlat +R=3396190 +no_defs', src_crs), [float(w), float(so), float(e), float(n)]


def stats(a):
    v = a[np.isfinite(a)]
    if not v.size:
        return None
    p = np.percentile(v, [2, 50, 98])
    return {'min': float(v.min()), 'max': float(v.max()), 'p2': float(p[0]), 'median': float(p[1]), 'p98': float(p[2]),
            'valid_fraction': float(v.size / a.size)}


def phase_shift(a, b):
    """Integer-pixel shift of b relative to a by phase correlation (both normalised, NaN -> mean)."""
    A = np.nan_to_num((a - np.nanmean(a)) / np.nanstd(a))
    B = np.nan_to_num((b - np.nanmean(b)) / np.nanstd(b))
    R = np.fft.fft2(A) * np.conj(np.fft.fft2(B))
    r = np.real(np.fft.ifft2(R / (np.abs(R) + 1e-9)))
    dy, dx = np.unravel_index(np.argmax(r), r.shape)
    dy = dy - r.shape[0] if dy > r.shape[0] // 2 else dy
    dx = dx - r.shape[1] if dx > r.shape[1] // 2 else dx
    return int(dx), int(dy)


def corr(a, b):
    m = np.isfinite(a) & np.isfinite(b)
    return float(np.corrcoef(a[m], b[m])[0, 1]) if m.sum() > 100 else None


def meda_tirs(cfg):
    MD.PRODUCTS['CAL_TIRS'] = 'data_calibrated_env'
    co = Coords(cfg)
    wps = [f['properties'] for f in read_json(os.path.join(RAW, 'M20_waypoints.json'))['features']]
    out = []
    for sol in TIRS_SOLS:
        base = MD.fetch(sol, 'CAL_TIRS')
        lab = MD.label(base)
        assert lab['fields']['GROUND_TEMP'] == 'kelvin' and lab['fields']['AIR_TEMP'] == 'kelvin'
        d = pd.read_csv(base + '.CSV', usecols=['LMST', 'GROUND_TEMP', 'GROUND_TEMP_UNCERTAINTY', 'AIR_TEMP',
                                                'TIRS_GROUND_FOOTPRINT_NOT_IN_SHADOW'])
        s_, h = MD.lmst_hours(d['LMST'].astype(str))
        d = d.assign(lsol=s_, h=h)
        d = d[d['lsol'] == sol]
        g = pd.to_numeric(d['GROUND_TEMP'], errors='coerce')
        d = d.assign(g=g.where(d['TIRS_GROUND_FOOTPRINT_NOT_IN_SHADOW'] == 1), a=pd.to_numeric(d['AIR_TEMP'], errors='coerce'))
        d['bin'] = (d['h'] // 0.5) * 0.5
        bins = []
        for b in np.arange(0, 24, 0.5):
            x = d[d['bin'] == b]
            gv, av = x['g'].dropna(), x['a'].dropna()
            bins.append({'lmst_h': float(b), 'ground_K': round(float(gv.mean()), 2) if len(gv) else None, 'ground_n': int(len(gv)),
                         'air_K': round(float(av.mean()), 2) if len(av) else None, 'air_n': int(len(av))})
        here = [w for w in wps if w.get('sol') is not None and w['sol'] <= sol]
        p = here[-1]
        x, y = co.lonlat_to_local(p['lon'], p['lat'])
        out.append({'sol': sol, 'rover_x': float(x), 'rover_y': float(y), 'rover_sol_of_fix': p['sol'], 'bins': bins,
                    'product': os.path.basename(base) + '.CSV'})
        print('MEDA TIRS sol', sol, 'ground', np.nanmin([b['ground_K'] or np.nan for b in bins]), np.nanmax([b['ground_K'] or np.nan for b in bins]))
    return out


def mcd():
    os.makedirs(MCD_DIR, exist_ok=True)
    cache = os.path.join(MCD_DIR, 'jezero_diurnal_v62.json')
    if os.path.exists(cache):
        return read_json(cache)
    url = 'https://www-mars.lmd.jussieu.fr/mcd_python/cgi-bin/mcdcgi.py?'
    seasons = {}
    for ls in (0, 90, 180, 270):
        rows = []
        for lt in range(24):
            q = {'datekeyhtml': 1, 'ls': ls, 'localtime': lt, 'latitude': 18.44, 'longitude': 77.45, 'altitude': 2, 'zkey': 3,
                 'isfixedlt': 'off', 'dust': 1, 'hrkey': 1, 'zonmean': 'off', 'var1': 'tsurf', 'var2': 't', 'var3': 'none', 'var4': 'none'}
            for attempt in range(3):
                try:
                    t = urllib.request.urlopen(urllib.request.Request(url + urllib.parse.urlencode(q), headers=UA), timeout=60).read().decode('latin-1')
                    break
                except Exception:
                    time.sleep(3)
            txt = re.sub(r'<[^>]+>', ' ', t)
            ts = re.search(r'Surface temperature \(K\)\s*\.+\s*([\d.]+)', txt)
            ta = re.search(r'(?<!Surface )(?<!surface )Temperature \(K\)\s*\.+\s*([\d.]+)', txt)
            rows.append({'ltst_h': lt, 'tsurf_K': round(float(ts.group(1)), 2) if ts else None, 'tair_2m_K': round(float(ta.group(1)), 2) if ta else None})
            time.sleep(0.4)
        seasons[str(ls)] = rows
        print('MCD Ls', ls, [r['tsurf_K'] for r in rows][::6])
    res = {'model': 'Mars Climate Database v6.2 (LMD/ESA/CNES), web interface', 'scenario': 'climatology, average solar EUV (dust=1)',
           'point': {'lat': 18.44, 'lon_e': 77.45}, 'air_height_m': 2, 'time': 'local true solar time (h) as requested by the interface',
           'resolution': 'GCM grid ~5.625° lon × 3.75° lat with high-resolution topography correction; one value for the whole study area',
           'variables': {'tsurf_K': 'surface temperature (K)', 'tair_2m_K': 'atmospheric temperature 2 m above the surface (K)'},
           'seasons_ls_deg': seasons, 'url': 'https://www-mars.lmd.jussieu.fr/mcd_python/'}
    write_json(cache, res)
    return res


def main():
    cfg = load_config()
    aoi = read_json(os.path.join(META, 'aoi.json'))
    co = Coords(cfg)
    g20 = RP.grid_for(aoi, 20.0)
    local = co.local
    shp, tr = (g20.nrows, g20.ncols), g20.transform()
    os.makedirs(PBT_DIR, exist_ok=True)
    meta = {'datasets': {}, 'grid': g20.to_dict(), 'encoding': 'value = vmin + R/254*(vmax-vmin); alpha 0 = no data'}
    arrays = {}

    # ---- 0. register each calibrated image to the controlled THEMIS mosaic of the same time of day ----
    #      (single THEMIS images carry spacecraft-pointing errors of a few pixels; the SIM 3464 mosaic is tied to MOLA/HRSC)
    with rasterio.open(os.path.join(TH_DIR, 'nili_THEMIS_NightIR_Controlled_oct2018.tif')) as s:
        from rasterio.warp import transform_bounds
        mcrs = s.crs
        xb = transform_bounds(s.crs, local, *s.bounds)
    big = Grid(np.ceil(xb[0] / 100) * 100, np.floor(xb[3] / 100) * 100, 100.0, int((xb[2] - xb[0]) // 100) - 1, int((xb[3] - xb[1]) // 100) - 1)
    reg = {}
    for key, kind in (('pbt_day', 'DayIR'), ('pbt_night', 'NightIR')):
        pa = os.path.join(PBT_DIR, PBT[key]['pid'] + '.IMG')
        if not os.path.exists(pa):
            urllib.request.urlretrieve(PBT[key]['url'], pa)
        A = warp_to(pa, (big.nrows, big.ncols), big.transform(), local)
        B = warp_to(os.path.join(TH_DIR, f'nili_THEMIS_{kind}_Controlled_oct2018.tif'), (big.nrows, big.ncols), big.transform(), local, mcrs)
        best = (corr(A, B), 0, 0)
        r0 = best[0]
        for dy in range(-10, 11):
            for dx in range(-10, 11):
                As = np.full_like(A, np.nan)
                ys, yd = (slice(dy, None), slice(None, -dy or None)) if dy >= 0 else (slice(None, dy), slice(-dy, None))
                xs, xd = (slice(dx, None), slice(None, -dx or None)) if dx >= 0 else (slice(None, dx), slice(-dx, None))
                As[ys, xs] = A[yd, xd]                           # content moved +dx columns (east), +dy rows (south)
                r = corr(As, B)
                if r is not None and r > best[0]:
                    best = (r, dx, dy)
        reg[key] = {'r_before': r0, 'r_after': best[0], 'shift_px_100m': [best[1], best[2]], 'applied_shift_m': [best[1] * 100.0, -best[2] * 100.0],
                    'reference': f'nili_THEMIS_{kind}_Controlled_oct2018 (USGS SIM 3464, controlled mosaic)'}
        print('register', key, reg[key])

    # ---- 1. THEMIS projected brightness temperature (calibrated, K) ----
    for key, d in PBT.items():
        p = os.path.join(PBT_DIR, d['pid'] + '.IMG')
        if not os.path.exists(p):
            urllib.request.urlretrieve(d['url'], p)
        lab = label(p)
        assert lab['ODY:SAMPLE_NAME'] == 'BRIGHTNESS_TEMPERATURE' and lab['ODY:SAMPLE_UNIT'] == 'KELVIN', lab
        sh = tuple(reg[key]['applied_shift_m'])
        a = warp_to(p, shp, tr, local, shift=sh)
        st = stats(a)
        assert st and st['valid_fraction'] > 0.999, f'{key} does not fully cover the study area: {st}'
        geo, gb = geo_footprint(p)   # globe footprint: raw geometry (sub-pixel at globe scale)
        sg = stats(geo)
        vmin, vmax = float(np.floor(sg['min'])), float(np.ceil(sg['max']))
        encode(a, vmin, vmax, os.path.join(APPDATA, f'thermal_{key}.png'))
        encode(geo, vmin, vmax, os.path.join(APPDATA, f'thermal_{key}_geo.png'))
        arrays[key] = a
        lt = float(lab['LOCAL_TIME'])
        meta['datasets'][key] = {
            'id': key, 'kind': 'brightness_temperature', 'evidence': 'orbital_observation', 'units': 'K',
            'title': f"THEMIS brightness temperature · {'afternoon' if lt > 12 else 'pre-dawn'}",
            'daynight': 'day' if 7 < lt < 18 else 'night',
            'instrument': '2001 Mars Odyssey THEMIS, IR band 9 (12.57 µm)', 'product_id': d['pid'],
            'data_set': 'ODY-M-THM-5-IRGEO-V2.0 (IRPBT2, projected brightness temperature)', 'source_url': d['url'],
            'observation_utc': lab['START_TIME'], 'local_true_solar_time_h': lt, 'solar_longitude_deg': float(lab['SOLAR_LONGITUDE']),
            'native_resolution_m': 100, 'map_scale_km_per_px': lab['MAP_SCALE'], 'label_projection': lab['MAP_PROJECTION_TYPE'],
            'sample': f"{lab['SAMPLE_TYPE']} {lab['ODY:SAMPLE_NAME']} [{lab['ODY:SAMPLE_UNIT']}], null = {lab['NULL_CONSTANT']}",
            'footprint_lonlat': gb, 'encoding_vmin': vmin, 'encoding_vmax': vmax, 'stats_study_area': st, 'stats_footprint': sg,
            'study_area_grid_m': 20, 'resampling': 'bilinear to the 20 m local grid; cells touching no-data are masked',
            'registration': reg[key],
            'limitations': ['Brightness temperature at 12.57 µm, not kinetic surface temperature (emissivity ~0.9–1 not removed).',
                            'A single moment: the date, local time and season above; not the temperature during a future EVA.',
                            '100 m pixels: boulders, shadows and slopes smaller than the pixel are averaged.',
                            'Atmospheric and dust effects are not corrected in this product.'],
        }
        print(key, d['pid'], lab['START_TIME'], 'LTST', lt, 'Ls', lab['SOLAR_LONGITUDE'], 'AOI K', round(st['min'], 1), round(st['max'], 1))

    # ---- 2. THEMIS controlled mosaics (qualitative, relative) ----
    prj = None
    for key, kind in (('qual_day', 'DayIR'), ('qual_night', 'NightIR')):
        p = os.path.join(TH_DIR, f'nili_THEMIS_{kind}_Controlled_oct2018.tif')
        if not os.path.exists(p):
            continue
        with rasterio.open(p) as s:
            scrs = s.crs
        a = warp_to(p, shp, tr, local, scrs) / 255.0
        geo, gb = geo_footprint(p, scrs)
        encode(a, 0.0, 1.0, os.path.join(APPDATA, f'thermal_{key}.png'))
        encode(geo / 255.0, 0.0, 1.0, os.path.join(APPDATA, f'thermal_{key}_geo.png'))
        arrays[key] = a
        meta['datasets'][key] = {
            'id': key, 'kind': 'relative', 'evidence': 'orbital_observation (qualitative)', 'units': 'relative (0–1)',
            'title': f"THEMIS {'day' if kind == 'DayIR' else 'night'} IR mosaic · relative",
            'daynight': 'day' if kind == 'DayIR' else 'night', 'instrument': '2001 Mars Odyssey THEMIS IR',
            'product_id': f'nili_THEMIS_{kind}_Controlled_oct2018', 'data_set': 'USGS SIM 3464 GIS bundle (THEMIS IR controlled mosaic, Oct 2018)',
            'source_url': 'https://pubs.usgs.gov/sim/3464/', 'observation_utc': 'mosaic of many orbits (dates not in file)',
            'local_true_solar_time_h': None, 'solar_longitude_deg': None, 'native_resolution_m': 100, 'footprint_lonlat': gb,
            'encoding_vmin': 0.0, 'encoding_vmax': 1.0, 'stats_study_area': stats(a), 'study_area_grid_m': 20,
            'limitations': ['8-bit display mosaic without calibration in the file: brighter = warmer within this mosaic only; no kelvin values.',
                            'Built from many images taken at different dates and seasons.'],
        }

    # ---- 3. alignment: calibrated night image vs the controlled night mosaic (independent product) ----
    al = {}
    for a_key, b_key, kind in (('pbt_night', 'qual_night', 'NightIR'), ('pbt_day', 'qual_day', 'DayIR')):
        pa = os.path.join(PBT_DIR, PBT[a_key]['pid'] + '.IMG'); pb = os.path.join(TH_DIR, f'nili_THEMIS_{kind}_Controlled_oct2018.tif')
        with rasterio.open(pb) as s:
            scrs = s.crs
        A = warp_to(pa, (big.nrows, big.ncols), big.transform(), local, shift=tuple(reg[a_key]['applied_shift_m']))
        B = warp_to(pb, (big.nrows, big.ncols), big.transform(), local, scrs)
        m = np.isfinite(A) & np.isfinite(B)
        rows, cols = np.where(m)
        r0, r1, c0, c1 = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1          # overlap window
        Aw, Bw = A[r0:r1, c0:c1], B[r0:r1, c0:c1]
        dx, dy = phase_shift(Aw, Bw)
        al[f'{a_key}_vs_{b_key}'] = {'pearson_r': corr(Aw, Bw), 'shift_px_100m': [dx, dy], 'shift_m': [dx * 100, dy * 100],
                                      'overlap_km2': round(float(m.sum()) * 0.01, 1)}
    meta['alignment'] = {'method': 'Pearson r and phase-correlation shift between each calibrated THEMIS image and the independently '
                                   'controlled THEMIS mosaic of the same time of day, both reprojected to one 100 m local grid over their full '
                                   'overlap (~55 km), AFTER registering each image to that mosaic (see registration). A zero residual shift means the products line up.',
                         'results': al}
    print('alignment', json.dumps(al))

    # ---- 4. MEDA TIRS (surface measurements at the rover) ----
    meta['meda_tirs'] = {'instrument': 'Perseverance MEDA TIRS', 'variables': {'ground_K': 'GROUND_TEMP: ground brightness temperature, footprint not in rover shadow',
                                                                               'air_K': 'AIR_TEMP (TIRS)'},
                         'binning': '30-min LMST means within each LMST sol', 'evidence': 'direct_surface_measurement',
                         'source': 'NASA PDS Atmospheres node, mars2020_meda data_calibrated_env (CAL_TIRS)', 'sols': meda_tirs(cfg)}

    # ---- 5. Mars Climate Database (model) ----
    try:
        meta['mcd'] = mcd()
        meta['mcd']['evidence'] = 'model'
    except Exception as e:  # optional layer
        meta['mcd'] = {'available': False, 'reason': str(e)[:200]}

    write_json(os.path.join(APPDATA, 'thermal.json'), meta)
    print('thermal datasets:', list(meta['datasets']))


if __name__ == '__main__':
    main()
