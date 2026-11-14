"""Shared configuration, coordinate handling, and I/O helpers for the Mars EVA Command pipeline."""
from __future__ import annotations

import hashlib
import json
import math
import os
import concurrent.futures as cf
import urllib.request
from dataclasses import dataclass

import numpy as np
import yaml
from pyproj import CRS, Transformer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
RAW = os.path.join(ROOT, 'data', 'raw')
META = os.path.join(ROOT, 'data', 'metadata')
INTER = os.path.join(ROOT, 'data', 'intermediate')
APPDATA = os.path.join(ROOT, 'app', 'data')
for _d in (RAW, META, INTER, APPDATA):
    os.makedirs(_d, exist_ok=True)

MARS_R = 3396190.0
UA = {'User-Agent': 'mars-eva-command-pipeline/1.0'}

ASC = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn'
URLS = {
    'hirise_dtm': f'{ASC}/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif',
    'hirise_ortho': f'{ASC}/HiRISE/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif',
    'ctx_dtm': f'{ASC}/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif',
    'ctx_ortho': f'{ASC}/CTX/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif',
    'rover_traverse': 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json',
    'rover_waypoints': 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json',
    'sim3464': 'https://pubs.usgs.gov/sim/3464/sim3464_database.zip',
}


def load_config() -> dict:
    with open(os.path.join(ROOT, 'config', 'mission.yaml')) as f:
        cfg = yaml.safe_load(f)
    return cfg


def build_id(cfg: dict | None = None) -> str:
    """Deterministic build id: hash of the mission configuration."""
    with open(os.path.join(ROOT, 'config', 'mission.yaml'), 'rb') as f:
        return 'mec-' + hashlib.sha256(f.read()).hexdigest()[:12]


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def write_json(path: str, obj) -> None:
    def default(o):
        if isinstance(o, (np.floating,)):
            return None if not np.isfinite(o) else float(o)
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
        raise TypeError(type(o))
    def clean(o):  # non-finite floats are missing values -> null (never 0)
        if isinstance(o, float):
            return o if math.isfinite(o) else None
        if isinstance(o, dict):
            return {k: clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [clean(v) for v in o]
        return o
    with open(path, 'w') as f:
        json.dump(clean(obj), f, indent=1, default=default, allow_nan=False)


def read_json(path: str):
    with open(path) as f:
        return json.load(f)


# ----------------------------------------------------------------------------------------------
# Coordinates
# ----------------------------------------------------------------------------------------------
class Coords:
    """Forward/inverse transforms between Mars geographic, source eqc, and local eqc metres."""

    def __init__(self, cfg: dict):
        self.geo = CRS.from_proj4(cfg['crs']['geographic'])
        self.src = CRS.from_proj4(cfg['crs']['source_eqc'])
        self.local = CRS.from_proj4(cfg['crs']['local'])
        self.geo2local = Transformer.from_crs(self.geo, self.local, always_xy=True)
        self.local2geo = Transformer.from_crs(self.local, self.geo, always_xy=True)
        self.geo2src = Transformer.from_crs(self.geo, self.src, always_xy=True)
        self.src2local = Transformer.from_crs(self.src, self.local, always_xy=True)
        self.local2src = Transformer.from_crs(self.local, self.src, always_xy=True)

    def lonlat_to_local(self, lon, lat):
        return self.geo2local.transform(lon, lat)

    def local_to_lonlat(self, x, y):
        return self.local2geo.transform(x, y)


def great_circle_m(lon1, lat1, lon2, lat2, R=MARS_R) -> float:
    """Haversine distance on the Mars sphere (independent check for projected distances)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


# ----------------------------------------------------------------------------------------------
# Local grid definition (upper-left origin, pixel-is-area, row increases southwards)
# ----------------------------------------------------------------------------------------------
@dataclass
class Grid:
    x0: float      # west edge (local m)
    y0: float      # north edge (local m)
    cell: float
    ncols: int
    nrows: int

    @property
    def bounds(self):  # [[ymin, xmin], [ymax, xmax]] in Leaflet CRS.Simple order
        return [[self.y0 - self.nrows * self.cell, self.x0], [self.y0, self.x0 + self.ncols * self.cell]]

    def rc(self, x, y):
        return int((self.y0 - y) // self.cell), int((x - self.x0) // self.cell)

    def xy(self, r, c):  # cell centre
        return self.x0 + (c + 0.5) * self.cell, self.y0 - (r + 0.5) * self.cell

    def transform(self):
        from rasterio.transform import from_origin
        return from_origin(self.x0, self.y0, self.cell, self.cell)

    def to_dict(self):
        return {'x0': self.x0, 'y0': self.y0, 'cell_m': self.cell, 'ncols': self.ncols, 'nrows': self.nrows,
                'origin': 'upper-left', 'pixel_convention': 'area (value represents cell; centre = origin + (i+0.5)*cell)',
                'axis': 'x east, y north; row increases southward'}

    @staticmethod
    def from_dict(d):
        return Grid(d['x0'], d['y0'], d['cell_m'], d['ncols'], d['nrows'])


# ----------------------------------------------------------------------------------------------
# Remote reads of uncompressed, stripped GeoTIFFs via parallel HTTP range requests
# ----------------------------------------------------------------------------------------------
class _HttpFile:
    def __init__(self, url):
        self.url, self.pos = url, 0
        r = urllib.request.urlopen(urllib.request.Request(url, headers={**UA, 'Range': 'bytes=0-0'}), timeout=60)
        self.size = int(r.headers['Content-Range'].split('/')[1])

    def seek(self, o, w=0):
        self.pos = o if w == 0 else (self.pos + o if w == 1 else self.size + o)
        return self.pos

    def tell(self):
        return self.pos

    def seekable(self):
        return True

    def readable(self):
        return True

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        if n == 0:
            return b''
        d = _range(self.url, self.pos, n)
        self.pos += len(d)
        return d

    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)

    def close(self):
        pass


def _range(url, start, n, tries=5):
    last = None
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, headers={**UA, 'Range': f'bytes={start}-{start + n - 1}'})
            d = urllib.request.urlopen(req, timeout=120).read()
            if len(d) == n:
                return d
            last = IOError(f'short read {len(d)}/{n}')
        except Exception as e:  # noqa: BLE001 — retry transient network errors
            last = e
    raise last


def strip_layout(url):
    """Return (strip_offsets, strip_bytecounts, width, height, dtype, rows_per_strip) for a stripped TIFF."""
    import tifffile
    with tifffile.TiffFile(_HttpFile(url)) as t:
        p = t.pages[0]
        assert p.compression == 1, 'only uncompressed TIFFs are supported by the range reader'
        assert not p.is_tiled
        rps = p.tags['RowsPerStrip'].value
        return (np.asarray(p.dataoffsets, dtype=np.int64), np.asarray(p.databytecounts, dtype=np.int64),
                p.imagewidth, p.imagelength, np.dtype(p.dtype).newbyteorder('<' if t.byteorder == '<' else '>'), rps)


def read_window_remote(url, row0, col0, nrows, ncols, row_step=1, threads=16, layout=None):
    """Read a window (every row_step-th row) from an uncompressed stripped TIFF using range requests."""
    offs, counts, W, H, dt, rps = layout or strip_layout(url)
    assert rps == 1, 'expects one row per strip'
    rows = list(range(row0, row0 + nrows, row_step))
    bpp = dt.itemsize

    def fetch(r):
        return np.frombuffer(_range(url, int(offs[r]) + col0 * bpp, ncols * bpp), dtype=dt)

    out = np.empty((len(rows), ncols), dtype=dt.newbyteorder('='))
    with cf.ThreadPoolExecutor(threads) as ex:
        for i, arr in enumerate(ex.map(fetch, rows)):
            out[i] = arr
    return out
