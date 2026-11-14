"""Phase 2 — reproject every product onto shared, snapped local grids (local eqc, lat_ts = 18.45).

Continuous elevation: bilinear, then any destination cell whose bilinear footprint touched a void is
re-masked (validity mask warped as float, kept only where == 1) so voids never blend into terrain.
Imagery: bilinear for display. Vectors (geology, rover traverse): coordinate transforms with pyproj.
"""
import os
import sys
import glob

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from common import RAW, META, INTER, load_config, Coords, Grid, write_json, read_json  # noqa: E402

import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from rasterio.warp import reproject, Resampling  # noqa: E402

os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')


def grid_for(aoi, cell):
    b = aoi['local_bounds_m']
    return Grid(b['xmin'], b['ymax'], cell, int(round((b['xmax'] - b['xmin']) / cell)), int(round((b['ymax'] - b['ymin']) / cell)))


def warp(src_path, grid, dst_crs, kind, src_crs=None):
    with rasterio.open(src_path) as s:
        a = s.read(1)
        nod = s.nodata
        scrs = src_crs or s.crs
        if kind == 'elev':
            valid = np.isfinite(a) & (a > -1e30) if nod is None or nod < -1e30 else (a != nod) & np.isfinite(a)
            a = np.where(valid, a, np.nan).astype(np.float32)
            out = np.full((grid.nrows, grid.ncols), np.nan, np.float32)
            reproject(a, out, src_transform=s.transform, src_crs=scrs, dst_transform=grid.transform(), dst_crs=dst_crs,
                      src_nodata=np.nan, dst_nodata=np.nan, resampling=Resampling.bilinear)
            m = np.zeros((grid.nrows, grid.ncols), np.float32)
            reproject(valid.astype(np.float32), m, src_transform=s.transform, src_crs=scrs, dst_transform=grid.transform(),
                      dst_crs=dst_crs, resampling=Resampling.bilinear)
            out[m < 0.9999] = np.nan
            return out
        out = np.zeros((grid.nrows, grid.ncols), np.float32)
        reproject(a.astype(np.float32), out, src_transform=s.transform, src_crs=scrs, dst_transform=grid.transform(),
                  dst_crs=dst_crs, src_nodata=0, dst_nodata=0, resampling=Resampling.bilinear)
        return out


def save(path, arr, grid, crs, nodata=None):
    prof = dict(driver='GTiff', width=grid.ncols, height=grid.nrows, count=1, dtype=arr.dtype.name, crs=crs,
                transform=grid.transform(), compress='deflate', tiled=True, nodata=nodata)
    with rasterio.open(path, 'w', **prof) as d:
        d.write(arr, 1)


def main():
    cfg = load_config()
    co = Coords(cfg)
    aoi = read_json(os.path.join(META, 'aoi.json'))
    local = rasterio.crs.CRS.from_proj4(cfg['crs']['local'])
    g1, g6, g20 = grid_for(aoi, 1.0), grid_for(aoi, 6.0), grid_for(aoi, 20.0)

    dtm = warp(os.path.join(INTER, 'hirise_dtm_src.tif'), g1, local, 'elev')
    save(os.path.join(INTER, 'dtm_hirise_1m.tif'), dtm, g1, local, np.nan)
    print('HiRISE DTM 1 m valid fraction', round(float(np.isfinite(dtm).mean()), 4))

    ctx = warp(os.path.join(RAW, 'JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif'), g20, local, 'elev')
    save(os.path.join(INTER, 'dtm_ctx_20m.tif'), ctx, g20, local, np.nan)
    print('CTX DTM 20 m valid fraction', round(float(np.isfinite(ctx).mean()), 4))

    ho = warp(os.path.join(INTER, 'hirise_ortho_src.tif'), g1, local, 'img')
    save(os.path.join(INTER, 'ortho_hirise_1m.tif'), ho.round().clip(0, 255).astype(np.uint8), g1, local, 0)
    co6 = warp(os.path.join(RAW, 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif'), g6, local, 'img')
    save(os.path.join(INTER, 'ortho_ctx_6m.tif'), co6.round().clip(0, 255).astype(np.uint8), g6, local, 0)

    # 25 cm chips around sites
    sites = read_json(os.path.join(META, 'sites.json'))
    chips = {}
    for s in sites:
        p = os.path.join(INTER, f"chip_{s['id']}_src.tif")
        if not os.path.exists(p):
            continue
        half = 80.0
        gc = Grid(np.floor(s['x'] - half), np.floor(s['y'] + half), 0.25, int(2 * half / 0.25), int(2 * half / 0.25))
        c = warp(p, gc, local, 'img')
        save(os.path.join(INTER, f"chip_{s['id']}_local.tif"), c.round().clip(0, 255).astype(np.uint8), gc, local, 0)
        chips[s['id']] = gc.to_dict()
    write_json(os.path.join(META, 'chips.json'), chips)

    # THEMIS controlled IR mosaics (inside SIM 3464 bundle; MTM projection read from the raster/.prj)
    th_dir = os.path.join(RAW, 'sim3464', 'Rasters', 'USGS_THEMIS_IR_controlled_mosaic_oct2018')
    g50 = grid_for(aoi, 20.0)
    for kind in ('NightIR', 'DayIR'):
        p = os.path.join(th_dir, f'nili_THEMIS_{kind}_Controlled_oct2018.tif')
        if os.path.exists(p):
            with rasterio.open(p) as s:
                scrs = s.crs
                info = {'res': s.res, 'dtype': s.dtypes[0], 'crs': scrs.to_proj4() if scrs else None}
            if scrs is None:
                prj = open(os.path.join(RAW, 'sim3464', 'CoordinateSystems', 'MTM_clon77_5E.prj')).read()
                scrs = rasterio.crs.CRS.from_wkt(prj)
            t = warp(p, g50, local, 'img', src_crs=scrs)
            save(os.path.join(INTER, f'themis_{kind.lower()}_20m.tif'), t.round().clip(0, 255).astype(np.uint8), g50, local, 0)
            print('THEMIS', kind, info)

    # Rover traverse -> local metres, clipped to AOI (+200 m) ; keep sol and segment ids
    trav = read_json(os.path.join(RAW, 'M20_traverse.json'))['features']
    b = aoi['local_bounds_m']
    segs = []
    for f in trav:
        cs = np.asarray(f['geometry']['coordinates'], dtype=float)
        if cs.ndim != 2 or len(cs) < 2:
            continue
        x, y = co.lonlat_to_local(cs[:, 0], cs[:, 1])
        inside = (x > b['xmin'] - 200) & (x < b['xmax'] + 200) & (y > b['ymin'] - 200) & (y < b['ymax'] + 200)
        if inside.any():
            segs.append({'sol': f['properties']['sol'], 'from': f['properties'].get('fromRMC'), 'to': f['properties'].get('toRMC'),
                         'xy': np.round(np.column_stack([x, y]), 2).tolist()})
    write_json(os.path.join(INTER, 'rover_traverse_local.json'), segs)
    wps = [f['properties'] for f in read_json(os.path.join(RAW, 'M20_waypoints.json'))['features']]
    wl = []
    for w in wps:
        x, y = co.lonlat_to_local(w['lon'], w['lat'])
        if b['xmin'] <= x <= b['xmax'] and b['ymin'] <= y <= b['ymax']:
            wl.append({'sol': w['sol'], 'rmc': w['RMC'], 'x': round(x, 2), 'y': round(y, 2), 'lon': w['lon'], 'lat': w['lat'],
                       'elev_geoid': w['elev_geoid']})
    write_json(os.path.join(INTER, 'rover_waypoints_local.json'), wl)
    print('rover traverse segments in AOI', len(segs), 'waypoints', len(wl))

    # Geology (SIM 3464 GeoUnits) -> local metres, clipped to AOI
    gdb = os.path.join(RAW, 'sim3464', 'Geodatabase', 'Nili.gdb')
    try:
        from pyogrio.raw import read as ogr_read
        from shapely import box, transform as shp_transform, from_wkb
        from shapely.geometry import mapping
        from pyproj import CRS, Transformer
        meta, _, geoms, fields = ogr_read(gdb, layer='GeoUnits_v1')
        cols = list(meta['fields'])
        tr = Transformer.from_crs(CRS.from_user_input(meta['crs']), co.local, always_xy=True)
        clip = box(b['xmin'], b['ymin'], b['xmax'], b['ymax'])
        feats = []
        iu, iname, isym = cols.index('unit'), cols.index('name'), cols.index('symbol')
        for k, wkb in enumerate(geoms):
            gm = shp_transform(from_wkb(wkb), lambda xy: np.column_stack(tr.transform(xy[:, 0], xy[:, 1])))
            if not gm.intersects(clip):
                continue
            gm = gm.intersection(clip).simplify(2.0)
            if gm.is_empty or gm.geom_type not in ('Polygon', 'MultiPolygon'):
                continue
            feats.append({'unit': str(fields[iu][k]), 'name': str(fields[iname][k]), 'symbol': str(fields[isym][k]),
                          'geometry': mapping(gm)})
        write_json(os.path.join(INTER, 'geology_local.json'), {'columns': cols, 'unit_field': 'unit', 'name_field': 'name',
                                                               'source_crs': meta['crs'], 'features': feats})
        print('geology polygons in AOI', len(feats), 'units', sorted({f['unit'] for f in feats}))
    except Exception as e:  # noqa: BLE001
        print('GEOLOGY NOT AVAILABLE:', repr(e))
        write_json(os.path.join(INTER, 'geology_local.json'), {'error': repr(e), 'features': []})


if __name__ == '__main__':
    main()
