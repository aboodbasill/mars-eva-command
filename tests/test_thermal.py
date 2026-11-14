# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Thermal layers: the browser-ready rasters must return the source THEMIS brightness temperature at the same place."""
import json
import os
import sys

import numpy as np
import pytest
import rasterio
from PIL import Image
from pyproj import Transformer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
APP = os.path.join(ROOT, 'app', 'data')
META = os.path.join(APP, 'thermal.json')
pytestmark = pytest.mark.skipif(not os.path.exists(META), reason='thermal layers not exported')


def load():
    m = json.load(open(META))
    sys.path.insert(0, os.path.join(ROOT, 'pipeline'))
    from common import load_config
    cfg = load_config()
    return m, Transformer.from_crs(cfg['crs']['local'], cfg['crs']['geographic'], always_xy=True)


def decode(m, key):
    d = m['datasets'][key]
    a = np.asarray(Image.open(os.path.join(APP, f'thermal_{key}.png')).convert('RGBA')).astype(float)
    v = d['encoding_vmin'] + a[..., 0] / 254 * (d['encoding_vmax'] - d['encoding_vmin'])
    return np.where(a[..., 3] > 127, v, np.nan)


def test_labels_and_units():
    m, _ = load()
    for k, d in m['datasets'].items():
        if k.startswith('pbt'):
            assert d['kind'] == 'brightness_temperature' and d['units'] == 'K' and 'BRIGHTNESS_TEMPERATURE [KELVIN]' in d['sample']
            assert d['observation_utc'] and d['local_true_solar_time_h'] is not None and d['solar_longitude_deg'] is not None
            assert d['stats_study_area']['valid_fraction'] > 0.999          # full coverage of the study area
        else:
            assert d['kind'] == 'relative' and 'K' not in d['units']        # qualitative mosaics never carry kelvin


@pytest.mark.parametrize('key', ['pbt_day', 'pbt_night'])
def test_exported_values_match_source_raster(key):
    """Pick cell centres, convert to lon/lat, read the original PDS image there (minus the registration shift), compare."""
    m, l2g = load()
    g, d = m['grid'], m['datasets'][key]
    v = decode(m, key)
    src = os.path.join(ROOT, 'data', 'raw', 'themis_pbt', d['product_id'] + '.IMG')
    if not os.path.exists(src):
        pytest.skip('raw THEMIS image not downloaded')
    rng = np.random.default_rng(1)
    with rasterio.open(src) as s:
        tr = Transformer.from_crs('+proj=longlat +R=3396190 +no_defs', s.crs, always_xy=True)
        errs = []
        for _ in range(200):
            r, c = rng.integers(2, g['nrows'] - 2), rng.integers(2, g['ncols'] - 2)
            x, y = g['x0'] + (c + 0.5) * g['cell_m'], g['y0'] - (r + 0.5) * g['cell_m']
            lon, lat = l2g.transform(x, y)
            sx, sy = tr.transform(lon, lat)
            shx, shy = d['registration']['applied_shift_m']          # the image was registered to the controlled mosaic
            sx, sy = sx - shx, sy - shy
            rr, cc = s.index(sx, sy)
            win = s.read(1, window=((rr - 1, rr + 2), (cc - 1, cc + 2))).astype(float)   # neighbourhood: bilinear vs nearest
            errs.append(abs(v[r, c] - win[1, 1]))
            assert win.min() - 0.5 <= v[r, c] <= win.max() + 0.5
    step = (d['encoding_vmax'] - d['encoding_vmin']) / 254
    assert np.median(errs) < 0.6 + step, np.median(errs)


def test_alignment_with_controlled_mosaic():
    m, _ = load()
    for k in ('pbt_day', 'pbt_night'):
        g = m['datasets'][k]['registration']
        assert g['r_after'] > g['r_before'] and max(map(abs, g['applied_shift_m'])) <= 1000
    for k, r in m['alignment']['results'].items():
        assert max(abs(r['shift_m'][0]), abs(r['shift_m'][1])) <= 100, (k, r)     # within one THEMIS pixel
        assert r['pearson_r'] > 0.75, (k, r)


def test_meda_and_model_are_points_not_maps():
    m, _ = load()
    sols = m['meda_tirs']['sols']
    assert sols and all(len(s['bins']) == 48 for s in sols)
    g = [b['ground_K'] for s in sols for b in s['bins'] if b['ground_K'] is not None]
    assert 150 < min(g) < max(g) < 320
    if m.get('mcd', {}).get('seasons_ls_deg'):
        assert m['mcd']['evidence'] == 'model' and 'one value for the whole study area' in m['mcd']['resolution']
