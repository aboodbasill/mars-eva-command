# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Phase 1/2 — derive mission sites from the rover waypoint archive, build the AOI, fetch source windows.

* Lander / stations / depot come from M20_waypoints.json (no hand-typed coordinates).
* AOI = bbox(lander, stations, depot) + margin, computed in the local projection, snapped to 20 m.
* HiRISE DTM window: every row, native 1 m (source eqc).  HiRISE ortho: every 4th row at 25 cm with a
  4-column mean -> ~1 m display basemap; plus full 25 cm chips around every site.
Outputs data/metadata/sites.json, data/metadata/aoi.json and source-CRS GeoTIFF windows in data/intermediate.
"""
import os
import sys
import math

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from common import (RAW, META, INTER, URLS, load_config, Coords, Grid, write_json, read_json,  # noqa: E402
                    strip_layout, read_window_remote)

import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from rasterio.transform import from_origin  # noqa: E402

CHIP_HALF_M = 80.0  # 160 m x 160 m chips at 25 cm


def waypoint_at(wps, sol):
    """Last waypoint at or before `sol` (the rover is parked while sampling)."""
    cand = [w for w in wps if int(w['sol']) <= sol]
    return cand[-1]


def sites(cfg, co):
    wps = [f['properties'] for f in read_json(os.path.join(RAW, 'M20_waypoints.json'))['features']]
    out = []
    lw = next(w for w in wps if w['RMC'] == cfg['lander']['rmc'])
    out.append(dict(kind='lander', id=cfg['lander']['id'], name=cfg['lander']['name'], lon=lw['lon'], lat=lw['lat'],
                    rover_elev_m=lw['elev_geoid'], source=f"M20_waypoints.json RMC {lw['RMC']} (sol {lw['sol']})",
                    position_uncertainty_m=5.0))
    for s in cfg['stations']:
        w = waypoint_at(wps, s['sample_sol'])
        out.append(dict(kind='station', **{k: s[k] for k in ('id', 'name', 'sample', 'sample_sol', 'formation', 'rock',
                                                              'rationale', 'task', 'nasem')},
                        lon=w['lon'], lat=w['lat'], rover_elev_m=w['elev_geoid'],
                        source=f"M20_waypoints.json RMC {w['RMC']} (sol {w['sol']}, last fix before sampling sol {s['sample_sol']})",
                        position_uncertainty_m=5.0))
    d = cfg['depot']
    dw = [w for w in wps if d['sol_range'][0] <= int(w['sol']) <= d['sol_range'][1]]
    lon, lat = float(np.mean([w['lon'] for w in dw])), float(np.mean([w['lat'] for w in dw]))
    xs, ys = co.lonlat_to_local([w['lon'] for w in dw], [w['lat'] for w in dw])
    spread = float(max(np.ptp(xs), np.ptp(ys)))
    out.append(dict(kind='depot', id=d['id'], name=d['name'], lon=lon, lat=lat,
                    rover_elev_m=float(np.mean([w['elev_geoid'] for w in dw])), tubes=d['tubes'], note=d['note'],
                    source=f"centroid of {len(dw)} M20 waypoints, sols {d['sol_range'][0]}-{d['sol_range'][1]}",
                    position_uncertainty_m=round(spread / 2 + 5, 1)))
    for s in out:
        s['x'], s['y'] = co.lonlat_to_local(s['lon'], s['lat'])
    return out


def src_window(ds_bounds, res, co, x0, y0, x1, y1, pad_px=12):
    """Pixel window in a source eqc raster that covers the local rectangle (densified edges)."""
    t = np.linspace(0, 1, 50)
    ex = np.concatenate([x0 + (x1 - x0) * t, np.full(50, x1), x0 + (x1 - x0) * t, np.full(50, x0)])
    ey = np.concatenate([np.full(50, y0), y0 + (y1 - y0) * t, np.full(50, y1), y0 + (y1 - y0) * t])
    sx, sy = co.local2src.transform(ex, ey)
    left, top = ds_bounds[0], ds_bounds[3]
    c0 = int(math.floor((sx.min() - left) / res)) - pad_px
    c1 = int(math.ceil((sx.max() - left) / res)) + pad_px
    r0 = int(math.floor((top - sy.max()) / res)) - pad_px
    r1 = int(math.ceil((top - sy.min()) / res)) + pad_px
    return r0, c0, r1 - r0, c1 - c0


def save_src(path, arr, left, top, res_x, res_y, crs, nodata):
    prof = dict(driver='GTiff', width=arr.shape[1], height=arr.shape[0], count=1, dtype=arr.dtype.name, crs=crs,
                transform=rasterio.Affine(res_x, 0, left, 0, -res_y, top), nodata=nodata, compress='deflate', tiled=True)
    with rasterio.open(path, 'w', **prof) as d:
        d.write(arr, 1)


def main():
    cfg = load_config()
    co = Coords(cfg)
    st = sites(cfg, co)
    xs, ys = [s['x'] for s in st], [s['y'] for s in st]
    m = cfg['aoi']['margin_m']
    snap = cfg['terrain']['ctx_cell_m']
    x0 = math.floor((min(xs) - m) / snap) * snap
    x1 = math.ceil((max(xs) + m) / snap) * snap
    y0 = math.floor((min(ys) - m) / snap) * snap
    y1 = math.ceil((max(ys) + m) / snap) * snap
    lon_a, lat_a = co.local_to_lonlat([x0, x1, x1, x0], [y0, y0, y1, y1])
    grid1 = Grid(x0, y1, cfg['terrain']['dtm_cell_m'], int(round((x1 - x0) / 1)), int(round((y1 - y0) / 1)))
    aoi = {'local_bounds_m': {'xmin': x0, 'xmax': x1, 'ymin': y0, 'ymax': y1},
           'size_m': [x1 - x0, y1 - y0], 'margin_m': m, 'snap_m': snap,
           'geographic_corners_lonlat': [[float(a), float(b)] for a, b in zip(lon_a, lat_a)],
           'rule': 'bbox(lander, stations, depot) + margin, snapped outward to the 20 m CTX lattice',
           'grid_1m': grid1.to_dict()}
    write_json(os.path.join(META, 'sites.json'), st)
    write_json(os.path.join(META, 'aoi.json'), aoi)
    print('AOI', aoi['size_m'], 'm  corners', aoi['geographic_corners_lonlat'])

    # ---- HiRISE DTM window (1 m, every row) ----
    src_crs = rasterio.crs.CRS.from_proj4(cfg['crs']['source_eqc'])
    for key, res, step in (('hirise_dtm', 1.0, 1), ('hirise_ortho', 0.25, 4)):
        out = os.path.join(INTER, f'{key}_src.tif')
        if os.path.exists(out):
            print('cached', out); continue
        with rasterio.open('/vsicurl/' + URLS[key]) as d:
            b, nod = d.bounds, d.nodata
        r0, c0, nr, nc = src_window(b, res, co, x0, y0, x1, y1)
        lay = strip_layout(URLS[key])
        print(f'fetching {key}: rows {r0}+{nr} cols {c0}+{nc} step {step}', flush=True)
        if step == 1:
            arr = read_window_remote(URLS[key], r0, c0, nr, nc, layout=lay)
            save_src(out, arr, b[0] + c0 * res, b[3] - r0 * res, res, res, src_crs, nod)
        else:
            # Row r0+1 of each 4-row block (centre offset 0.125 m from block centre), 4-column mean.
            arr = read_window_remote(URLS[key], r0 + 1, c0, nr - 1, nc, row_step=step, layout=lay)
            nc4 = (nc // step) * step
            a = arr[:, :nc4].reshape(arr.shape[0], nc4 // step, step).astype(np.float32)
            valid = (a > 0).sum(axis=2)
            img = np.where(valid == step, a.mean(axis=2), 0).round().astype(np.uint8)
            save_src(out, img, b[0] + c0 * res, b[3] - r0 * res, res * step, res * step, src_crs, 0)
        print('saved', out, flush=True)

    # ---- 25 cm chips around each site ----
    with rasterio.open('/vsicurl/' + URLS['hirise_ortho']) as d:
        b = d.bounds
    lay = strip_layout(URLS['hirise_ortho'])
    for s in st:
        out = os.path.join(INTER, f"chip_{s['id']}_src.tif")
        if os.path.exists(out):
            continue
        r0, c0, nr, nc = src_window(b, 0.25, co, s['x'] - CHIP_HALF_M, s['y'] - CHIP_HALF_M,
                                    s['x'] + CHIP_HALF_M, s['y'] + CHIP_HALF_M, pad_px=8)
        arr = read_window_remote(URLS['hirise_ortho'], r0, c0, nr, nc, layout=lay)
        save_src(out, arr, b[0] + c0 * 0.25, b[3] - r0 * 0.25, 0.25, 0.25, src_crs, 0)
        print('chip', s['id'], arr.shape, flush=True)


if __name__ == '__main__':
    main()
