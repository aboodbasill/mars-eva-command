# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Phase 3 — terrain and evidence grids.

slope (deg) = atan(sqrt((dz/dx)^2 + (dz/dy)^2)) using Horn's 3x3 kernel on local metres (no scale fudge).
A slope cell is NaN unless all 8 neighbours are valid (nodata-aware; voids are never treated as flat).
5 m routing cells: maximum valid 1 m slope; HiRISE-supported only if >= min_valid_fraction of 1 m slopes valid.
CTX 20 m slope is computed at its native 20 m and mapped (nearest) to 5 m cells; it remains '20 m source'.
Provenance codes: 1 = HiRISE-derived (1 m DTM), 2 = CTX-only (20 m DTM), 0 = no elevation support.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from common import META, INTER, load_config, Grid, write_json, read_json  # noqa: E402

import numpy as np  # noqa: E402
import rasterio  # noqa: E402


def horn_slope(z, cell):
    """Slope in degrees with Horn's method. NaN where any 3x3 neighbour is NaN or at the border."""
    p = np.pad(z, 1, constant_values=np.nan)
    a, b, c = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    d, f = p[1:-1, :-2], p[1:-1, 2:]
    g, h, i = p[2:, :-2], p[2:, 1:-1], p[2:, 2:]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * cell)
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * cell)   # row increases southward; sign irrelevant to magnitude
    void = ~np.isfinite(z)            # Horn's kernel ignores the centre: mask it explicitly
    dzdx[void] = np.nan
    dzdy[void] = np.nan
    return np.degrees(np.arctan(np.sqrt(dzdx ** 2 + dzdy ** 2))), dzdx, -dzdy


def hillshade(z, cell, az=315.0, alt=45.0):
    _, dx, dy = horn_slope(z, cell)
    slope = np.arctan(np.hypot(dx, dy))
    aspect = np.arctan2(-dx, -dy)  # azimuth (from north, clockwise) of steepest descent; dx east, dy north
    zen, azr = np.radians(90 - alt), np.radians(az)
    hs = np.cos(zen) * np.cos(slope) + np.sin(zen) * np.sin(slope) * np.cos(azr - aspect)
    return np.clip(hs, 0, 1)


def block(a, k, fn):
    H, W = a.shape[0] // k * k, a.shape[1] // k * k
    r = a[:H, :W].reshape(H // k, k, W // k, k)
    return fn(r)


def read(path):
    with rasterio.open(path) as d:
        return d.read(1), d.crs


def save(path, arr, grid, crs, nodata=None):
    prof = dict(driver='GTiff', width=grid.ncols, height=grid.nrows, count=1, dtype=arr.dtype.name, crs=crs,
                transform=grid.transform(), compress='deflate', tiled=True, nodata=nodata)
    with rasterio.open(path, 'w', **prof) as d:
        d.write(arr, 1)


def main():
    cfg = load_config()
    aoi = read_json(os.path.join(META, 'aoi.json'))
    b = aoi['local_bounds_m']
    k = int(cfg['terrain']['route_cell_m'] / cfg['terrain']['dtm_cell_m'])
    g1 = Grid(b['xmin'], b['ymax'], 1.0, int(b['xmax'] - b['xmin']), int(b['ymax'] - b['ymin']))
    g5 = Grid(b['xmin'], b['ymax'], 5.0, g1.ncols // k, g1.nrows // k)
    g20 = Grid(b['xmin'], b['ymax'], 20.0, g1.ncols // 20, g1.nrows // 20)

    z1, crs = read(os.path.join(INTER, 'dtm_hirise_1m.tif'))
    s1, _, _ = horn_slope(z1, 1.0)
    save(os.path.join(INTER, 'slope_hirise_1m.tif'), s1.astype(np.float32), g1, crs, np.nan)
    hs = hillshade(z1, 1.0)
    save(os.path.join(INTER, 'hillshade_1m.tif'), hs.astype(np.float32), g1, crs, np.nan)

    # 5 m aggregation: max valid slope, valid fraction, mean elevation
    valid = np.isfinite(s1)
    frac = block(valid.astype(np.float32), k, lambda r: r.mean(axis=(1, 3)))
    with np.errstate(all='ignore'):
        smax = block(np.where(valid, s1, -np.inf), k, lambda r: r.max(axis=(1, 3)))
        zmean = block(np.where(np.isfinite(z1), z1, np.nan), k, lambda r: np.nanmean(r, axis=(1, 3)))
    smax[~np.isfinite(smax)] = np.nan

    zc, _ = read(os.path.join(INTER, 'dtm_ctx_20m.tif'))
    sc, _, _ = horn_slope(zc, 20.0)
    save(os.path.join(INTER, 'slope_ctx_20m.tif'), sc.astype(np.float32), g20, crs, np.nan)
    r4 = 20 // 5
    sc5 = np.repeat(np.repeat(sc, r4, axis=0), r4, axis=1)[:g5.nrows, :g5.ncols]
    zc5 = np.repeat(np.repeat(zc, r4, axis=0), r4, axis=1)[:g5.nrows, :g5.ncols]

    hi = frac >= cfg['terrain']['min_valid_fraction']
    prov = np.where(hi, 1, np.where(np.isfinite(sc5), 2, 0)).astype(np.uint8)
    slope5 = np.where(prov == 1, smax, np.where(prov == 2, sc5, np.nan)).astype(np.float32)
    elev5 = np.where(prov == 1, zmean, np.where(prov == 2, zc5, np.nan)).astype(np.float32)
    penalty = np.where(prov == 2, cfg['routing']['penalty_ctx_only'], cfg['routing']['penalty_hirise']).astype(np.float32)

    for name, arr, nod in (('slope_5m', slope5, np.nan), ('elev_5m', elev5, np.nan), ('provenance_5m', prov, 255),
                           ('valid_frac_5m', frac.astype(np.float32), np.nan), ('penalty_5m', penalty, np.nan)):
        save(os.path.join(INTER, f'{name}.tif'), arr, g5, crs, nod)

    # HiRISE - CTX elevation on common valid support at 20 m (block mean of complete HiRISE blocks)
    with np.errstate(all='ignore'):
        v20 = block(np.isfinite(z1).astype(np.float32), 20, lambda r: r.mean(axis=(1, 3)))
        h20 = block(z1, 20, lambda r: np.nanmean(r, axis=(1, 3)))
    common = (v20 == 1) & np.isfinite(zc)
    diff = (h20 - zc)[common]

    # Seam check: slopes at HiRISE/CTX provenance boundaries vs interior
    from scipy.ndimage import binary_dilation
    edge = binary_dilation(prov == 2, iterations=1) & (prov == 1)
    stats = {
        'grid_1m': g1.to_dict(), 'grid_5m': g5.to_dict(), 'grid_20m': g20.to_dict(),
        'hirise_1m_valid_fraction': float(np.isfinite(z1).mean()),
        'slope_1m_valid_fraction': float(valid.mean()),
        'ctx_20m_valid_fraction': float(np.isfinite(zc).mean()),
        'route_cells': {'hirise': int((prov == 1).sum()), 'ctx_only': int((prov == 2).sum()), 'none': int((prov == 0).sum()),
                        'total': int(prov.size)},
        'slope_5m_hirise_percentiles_deg': np.nanpercentile(slope5[prov == 1], [50, 90, 99]).round(2).tolist() if (prov == 1).any() else None,
        'slope_ctx_20m_percentiles_deg': np.nanpercentile(sc, [50, 90, 99]).round(2).tolist(),
        'hirise_minus_ctx_m': {'median': float(np.median(diff)), 'p05': float(np.percentile(diff, 5)),
                               'p95': float(np.percentile(diff, 95)), 'mad': float(np.median(np.abs(diff - np.median(diff)))),
                               'count_20m_cells': int(diff.size),
                               'sign': 'HiRISE minus CTX (negative = HiRISE below CTX)'},
        'seam_check': {'hirise_cells_adjacent_to_ctx_only': int(edge.sum()),
                       'median_slope_at_seam_deg': float(np.nanmedian(slope5[edge])) if edge.any() else None,
                       'median_slope_hirise_interior_deg': float(np.nanmedian(slope5[(prov == 1) & ~edge])) if (prov == 1).any() else None},
        'aggregation': '5 m cell slope = max of 1 m Horn slopes; HiRISE-supported if valid fraction >= '
                       f"{cfg['terrain']['min_valid_fraction']}; otherwise CTX 20 m slope if available; otherwise blocked",
    }
    write_json(os.path.join(META, 'terrain_stats.json'), stats)
    print({k: v for k, v in stats.items() if not k.startswith('grid')})


if __name__ == '__main__':
    main()
