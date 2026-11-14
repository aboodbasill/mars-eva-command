"""Slope, projection, provenance and environment-parsing semantics (plan §15)."""
import importlib.util
import math
import os
import sys

import numpy as np
import pandas as pd
import pytest

ROOT = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, os.path.join(ROOT, 'pipeline'))
from common import load_config, Coords, great_circle_m, Grid  # noqa: E402


def _load(rel):
    spec = importlib.util.spec_from_file_location(os.path.basename(rel)[:-3], os.path.join(ROOT, 'pipeline', rel))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


terrain = _load('terrain/04_derive_terrain.py')
meda = _load('environment/01_process_meda.py')


# ---- slope -----------------------------------------------------------------------------------
@pytest.mark.parametrize('deg', [0.0, 5.0, 10.0, 20.0, 30.0])
def test_inclined_plane_slope(deg):
    y, x = np.mgrid[0:30, 0:30].astype(float)
    z = np.tan(np.radians(deg)) * (0.6 * x + 0.8 * y)      # unit gradient direction
    s, _, _ = terrain.horn_slope(z, 1.0)
    inner = s[1:-1, 1:-1]
    assert np.allclose(inner, deg, atol=1e-6)


def test_slope_cell_size_scaling():
    y, x = np.mgrid[0:10, 0:10].astype(float)
    z = 20.0 * x * np.tan(np.radians(12))                  # 20 m posting
    s, _, _ = terrain.horn_slope(z, 20.0)
    assert np.allclose(s[1:-1, 1:-1], 12.0, atol=1e-6)


def test_void_is_not_flat():
    z = np.zeros((10, 10)); z[5, 5] = np.nan
    s, _, _ = terrain.horn_slope(z, 1.0)
    assert np.isnan(s[4:7, 4:7]).all()                     # every neighbour of the void lacks support
    assert np.isnan(s[0]).all() and np.isnan(s[:, 0]).all()  # borders lack neighbours
    assert s[2, 2] == 0.0


def test_block_max_is_conservative():
    a = np.zeros((10, 10)); a[3, 3] = 17.0
    m = terrain.block(a, 5, lambda r: r.max(axis=(1, 3)))
    assert m[0, 0] == 17.0 and m[1, 1] == 0.0


def test_hillshade_flat_is_cos_zenith():
    hs = terrain.hillshade(np.zeros((6, 6)), 1.0, alt=45.0)
    assert np.allclose(hs[1:-1, 1:-1], math.cos(math.radians(45)))


# ---- projection ------------------------------------------------------------------------------
def test_projection_round_trip():
    co = Coords(load_config())
    lon, lat = 77.45088572, 18.44462715
    x, y = co.lonlat_to_local(lon, lat)
    lo, la = co.local_to_lonlat(x, y)
    assert abs(lo - lon) < 1e-9 and abs(la - lat) < 1e-9


def test_local_distances_match_great_circle():
    co = Coords(load_config())
    pairs = [((77.45088572, 18.44462715), (77.40824, 18.45283)),     # lander -> depot
             ((77.3814, 18.4277), (77.4689, 18.4760))]               # AOI diagonal
    for (a, b), (c, d) in pairs:
        x0, y0 = co.lonlat_to_local(a, b)
        x1, y1 = co.lonlat_to_local(c, d)
        proj = math.hypot(x1 - x0, y1 - y0)
        gc = great_circle_m(a, b, c, d)
        assert abs(proj - gc) / gc < 1e-3                         # < 0.1 % in the AOI


def test_source_projection_would_be_wrong():
    """The source mosaic's equatorial true scale overstates E-W distance by ~1/cos(18.45) at Jezero."""
    co = Coords(load_config())
    sx0, sy0 = co.geo2src.transform(77.40, 18.45)
    sx1, sy1 = co.geo2src.transform(77.45, 18.45)
    gc = great_circle_m(77.40, 18.45, 77.45, 18.45)
    assert (sx1 - sx0) / gc == pytest.approx(1 / math.cos(math.radians(18.45)), rel=2e-3)


def test_grid_rc_xy_inverse():
    g = Grid(100.0, 500.0, 5.0, 40, 30)
    x, y = g.xy(7, 11)
    assert g.rc(x, y) == (7, 11)
    assert g.bounds == [[350.0, 100.0], [500.0, 300.0]]


# ---- environment -----------------------------------------------------------------------------
def test_lmst_parse():
    sol, h = meda.lmst_hours(pd.Series(['00670M00:00:00.376', '00670M13:30:00.000']))
    assert list(sol) == [670, 670]
    assert h.iloc[0] == pytest.approx(0.376 / 3600) and h.iloc[1] == pytest.approx(13.5)


def test_meda_names():
    assert meda.fname(670, 'CAL_PS') == 'WE__0670___________CAL_PS__________________P01'
    assert meda.fname(656, 'DER_ANCILLARY', 'P02') == 'WE__0656___________DER_ANCILLARY___________P02'
    assert meda.folder(656) == 'sol_0540_0659/sol_0656' and meda.folder(670) == 'sol_0660_0779/sol_0670'


def test_missing_values_are_not_zero():
    df = pd.DataFrame({'a': [1.0, None, 3.0], 'b': [None, None, 5.0]})
    v = df.apply(pd.to_numeric, errors='coerce').mean(axis=1, skipna=True)
    assert v.iloc[0] == 1.0 and np.isnan(v.iloc[1]) and v.iloc[2] == 4.0


def test_solar_longitude_matches_allison_mcewen_worked_example():
    import datetime as dt
    t = dt.datetime(2000, 1, 6, tzinfo=dt.timezone.utc) - dt.timedelta(seconds=64.184)   # TT 2000-01-06 00:00
    assert meda.solar_longitude(t) == pytest.approx(277.18758, abs=0.002)
