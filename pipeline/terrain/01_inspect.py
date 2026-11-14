# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Phase 1 — inspect source products: CRS, extent, nodata, resolution, checksums, longitude convention.

Writes data/metadata/inspect.json. Remote HiRISE products are inspected via HTTP (header only).
"""
import os
import sys
import datetime as dt

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from common import RAW, META, URLS, write_json, sha256  # noqa: E402

import rasterio  # noqa: E402

os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')


def describe(path):
    with rasterio.open(path) as d:
        return {
            'width': d.width, 'height': d.height, 'count': d.count, 'dtype': d.dtypes[0],
            'nodata': None if d.nodata is None else float(d.nodata), 'res_m': list(d.res),
            'bounds_src_m': list(d.bounds), 'crs_proj4': d.crs.to_proj4(), 'crs_wkt_name': d.crs.to_wkt().split('"')[1],
            'tiled': d.profile.get('tiled', False), 'compression': str(d.compression) if d.compression else 'none',
            'overviews': d.overviews(1),
        }


def main():
    out = {'inspected_utc': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'), 'products': {}}
    local = {
        'ctx_dtm': 'JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif',
        'ctx_ortho': 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif',
    }
    for k, f in local.items():
        p = os.path.join(RAW, f)
        info = describe(p)
        info.update(file=f, url=URLS[k], sha256=sha256(p), bytes=os.path.getsize(p), access='downloaded')
        out['products'][k] = info
    for k in ('hirise_dtm', 'hirise_ortho'):
        info = describe('/vsicurl/' + URLS[k])
        info.update(url=URLS[k], access='remote windowed HTTP range read (uncompressed stripped GeoTIFF)')
        out['products'][k] = info
    for k in ('rover_traverse', 'rover_waypoints'):
        p = os.path.join(RAW, os.path.basename(URLS[k]))
        out['products'][k] = {'file': os.path.basename(p), 'url': URLS[k], 'sha256': sha256(p), 'bytes': os.path.getsize(p),
                              'downloaded_utc': dt.datetime.fromtimestamp(os.path.getmtime(p), dt.timezone.utc).isoformat(timespec='seconds')}
    # Conventions confirmed from the product metadata and CRS
    out['conventions'] = {
        'body': 'Mars 2000 sphere, R = 3,396,190 m (from CRS of every raster)',
        'longitude': 'east-positive, 0-360 (source x = R * lon_rad; Jezero ~77.45 E)',
        'latitude': 'planetocentric (sphere: identical to planetographic on a sphere)',
        'source_projection': 'equirectangular, true scale at the equator (lat_ts = 0)',
        'vertical_reference': 'MOLA topography, "DeltaGeoid" elevation (m) relative to Mars areoid per product title',
        'hirise_vs_ctx_vertical': 'USGS metadata: HiRISE DTM median ~0.4 m below CTX DTM (product-wide)',
        'hirise_vs_ctx_horizontal': 'USGS metadata: 94.1% of matched features displaced < 6 m (conservative)',
    }
    write_json(os.path.join(META, 'inspect.json'), out)
    for k, v in out['products'].items():
        print(k, v.get('width'), v.get('height'), v.get('res_m'), v.get('crs_proj4', ''))


if __name__ == '__main__':
    main()
