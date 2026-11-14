# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Assets for the 3D simulator (Marswalk 1).

1. Global Mars for the start globe, from NASA/JPL Mars Trek WMTS (a resource listed on the challenge page):
   - Viking MDIM 2.1 colour mosaic (optical), zoom 3 -> 4096x2048 equirectangular
   - MGS MOLA colour shaded relief (topography), zoom 2 -> 2048x1024
   - Viking colour around Jezero at zoom 7 (regional view used during the descent)
2. Perseverance's position: last known in the cached M20 waypoint file (globe), and its last position inside the
   study area (fixed in the 3D site), both from NASA's M20 MMGIS waypoint layer.
3. Tileable ground-detail textures (regolith with pebbles, layered bedrock, dark ripple sand). These are procedural
   (ASSUMPTION: illustrative sub-metre detail); their colours are taken from Perseverance Mastcam-Z frames of our stops.
Outputs: app/data/mars_globe_4k.jpg, mars_mola_2k.jpg, jezero_regional.jpg, tex_*.jpg, game_assets.json
"""
import io
import json
import math
import os
import sys
import urllib.request

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from common import APPDATA, META, RAW, UA, Coords, load_config, read_json, write_json  # noqa: E402

TREK = 'https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{row}/{col}.jpg'
CACHE = os.path.join(RAW, 'trek')
os.makedirs(CACHE, exist_ok=True)


def tile(layer, z, row, col):
    p = os.path.join(CACHE, f'{layer}_{z}_{row}_{col}.jpg')
    if not os.path.exists(p):
        req = urllib.request.Request(TREK.format(layer=layer, z=z, row=row, col=col), headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        with open(p, 'wb') as fh:
            fh.write(data)
    return Image.open(p).convert('RGB')


def mosaic(layer, z, rows, cols):
    out = Image.new('RGB', (256 * len(cols), 256 * len(rows)))
    for i, r in enumerate(rows):
        for j, c in enumerate(cols):
            out.paste(tile(layer, z, r, c), (j * 256, i * 256))
    return out


def globe():
    viking = 'Mars_Viking_MDIM21_ClrMosaic_global_232m'
    mola = 'Mars_MGS_MOLA_ClrShade_merge_global_463m'
    g = mosaic(viking, 3, range(8), range(16))                     # zoom 3: 16x8 tiles of 22.5 deg
    g.save(os.path.join(APPDATA, 'mars_globe_4k.jpg'), quality=86, optimize=True)
    m = mosaic(mola, 2, range(4), range(8))                        # zoom 2: 8x4 tiles of 45 deg
    m.save(os.path.join(APPDATA, 'mars_mola_2k.jpg'), quality=84, optimize=True)
    # regional Viking colour around Jezero (zoom 7: 1.40625 deg per tile)
    deg = 360 / 256
    lon, lat = 77.45, 18.45
    c0, r0 = int((lon + 180) / deg), int((90 - lat) / deg)
    cols, rows = range(c0 - 2, c0 + 3), range(r0 - 2, r0 + 3)
    reg = mosaic(viking, 7, rows, cols)
    reg.save(os.path.join(APPDATA, 'jezero_regional.jpg'), quality=86, optimize=True)
    return {
        'globe': {'file': 'mars_globe_4k.jpg', 'layer': viking, 'source': 'NASA/JPL Mars Trek WMTS (Viking MDIM 2.1 colour mosaic, USGS)', 'bounds_lonlat': [-180, -90, 180, 90]},
        'mola': {'file': 'mars_mola_2k.jpg', 'layer': mola, 'source': 'NASA/JPL Mars Trek WMTS (MGS MOLA colour shaded relief)', 'bounds_lonlat': [-180, -90, 180, 90]},
        'regional': {'file': 'jezero_regional.jpg', 'layer': viking, 'source': 'NASA/JPL Mars Trek WMTS zoom 7',
                     'bounds_lonlat': [cols[0] * deg - 180, 90 - (rows[-1] + 1) * deg, (cols[-1] + 1) * deg - 180, 90 - rows[0] * deg]},
    }


def perseverance(cfg):
    co = Coords(cfg)
    wp = read_json(os.path.join(RAW, 'M20_waypoints.json'))['features']
    pts = [f['properties'] for f in wp if f['properties'].get('lon') is not None]
    last = pts[-1]
    aoi = read_json(os.path.join(META, 'aoi.json'))['local_bounds_m']
    inside = []
    for p in pts:
        x, y = co.lonlat_to_local(p['lon'], p['lat'])
        if aoi['xmin'] + 60 < x < aoi['xmax'] - 60 and aoi['ymin'] + 60 < y < aoi['ymax'] - 60:
            inside.append((p, float(x), float(y)))
    p, x, y = inside[-1]
    return {
        'latest': {'lon': last['lon'], 'lat': last['lat'], 'sol': last['sol'], 'note': 'last waypoint in the cached NASA M20 waypoint layer'},
        'site': {'x': x, 'y': y, 'sol': p['sol'], 'yaw_deg': p.get('yaw'), 'lon': p['lon'], 'lat': p['lat'],
                 'note': f"Perseverance's last localized position inside the study area (sol {p['sol']}), NASA M20 waypoints"},
    }


# ---------------------------------------------------------------- tileable procedural detail textures
N = 1024
rng = np.random.default_rng(2026)


def fbm(beta, seed, lo=2.0, hi=None):
    r = np.random.default_rng(seed)
    w = r.standard_normal((N, N))
    f = np.fft.fftfreq(N) * N
    fx, fy = np.meshgrid(f, f)
    k = np.hypot(fx, fy)
    k[0, 0] = 1
    amp = 1 / k ** beta
    amp[k < lo] = 0
    if hi:
        amp[k > hi] = 0
    out = np.real(np.fft.ifft2(np.fft.fft2(w) * amp))
    return (out - out.min()) / (out.max() - out.min())


def worley(G, seed, jitter=0.9, warp=None):
    """F1, F2 and nearest-cell id on a G x G jittered grid (tileable)."""
    r = np.random.default_rng(seed)
    pts = np.stack([np.arange(G)[None, :].repeat(G, 0) + 0.5 + (r.random((G, G)) - 0.5) * jitter,
                    np.arange(G)[:, None].repeat(G, 1) + 0.5 + (r.random((G, G)) - 0.5) * jitter], -1)
    s = N / G
    yy, xx = np.mgrid[0:N, 0:N] / s
    if warp is not None:
        xx = xx + warp[0]; yy = yy + warp[1]
    ci, cj = np.floor(yy).astype(int), np.floor(xx).astype(int)
    F1 = np.full((N, N), 9.0)
    F2 = np.full((N, N), 9.0)
    ID = np.zeros((N, N), int)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            ni, nj = ci + di, cj + dj
            p = pts[ni % G, nj % G]
            px = p[..., 0] + (nj - nj % G)
            py = p[..., 1] + (ni - ni % G)
            d = np.hypot(xx - px, yy - py)
            nid = (ni % G) * G + (nj % G)
            closer = d < F1
            F2 = np.where(closer, F1, np.minimum(F2, d))
            ID = np.where(closer, nid, ID)
            F1 = np.where(closer, d, F1)
    return F1, F2, ID


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-dx, dy, np.ones_like(h)], -1)        # tangent space, +y up the texture
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return ((n * 0.5 + 0.5) * 255).astype(np.uint8)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def save(name, rgb, nrm):
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), 'RGB').save(os.path.join(APPDATA, f'tex_{name}_albedo.jpg'), quality=88, optimize=True)
    Image.fromarray(nrm, 'RGB').save(os.path.join(APPDATA, f'tex_{name}_normal.jpg'), quality=90, optimize=True)


def textures():
    # Palette (sRGB) from Perseverance Mastcam-Z frames at S3/S4 (median of the foreground), see docstring.
    REG = np.array([176, 126, 86.0]); PEB = np.array([98, 80, 66.0]); BED = np.array([192, 160, 124.0]); SAND = np.array([96, 76, 62.0])
    # 1) regolith: dusty soil with irregular gravel and pebbles of mixed lithology   (tile = 3 m)
    n1, n2, n3 = fbm(1.2, 1), fbm(0.8, 2, lo=40), fbm(1.6, 3)
    wx, wy = (fbm(1.3, 31) - 0.5), (fbm(1.3, 32) - 0.5)
    h = 0.22 * n1 + 0.10 * n2
    rgb = REG * (0.84 + 0.24 * n3 + 0.12 * (n2 - 0.5))[..., None]
    lith = np.array([[92, 78, 70], [120, 84, 60], [150, 120, 96], [70, 62, 58], [134, 100, 74.0]])
    for G, keep, rmin, rmax, seed, amp in ((90, 0.40, 0.18, 0.40, 4, 0.35), (40, 0.30, 0.20, 0.42, 8, 0.6), (18, 0.18, 0.22, 0.40, 9, 0.9)):
        F1, F2, ID = worley(G, seed, 0.9, (wx * 0.9, wy * 0.9))
        rr = np.random.default_rng(seed + 50).random((3, G * G))
        rad = rmin + (rmax - rmin) * rr[0][ID]
        on = rr[1][ID] < keep
        m = np.where(on, smooth(rad, rad * 0.6, F1), 0.0)
        dome = np.where(on, np.sqrt(np.clip(1 - (F1 / rad) ** 2, 0, 1)), 0.0)
        col = lith[(rr[2][ID] * len(lith)).astype(int)] * (0.85 + 0.3 * n2[..., None])
        rgb = rgb * (1 - m[..., None]) + col * m[..., None]
        h = np.maximum(h, 0.2 + amp * dome * m)
    rgb *= (0.78 + 0.22 * smooth(0.05, 0.45, h))[..., None]          # cavity darkening
    nrm = normal_from_height(h, 9.0)
    lit = ((nrm[..., 0] / 255.0 - 0.5) * -0.6 + (nrm[..., 1] / 255.0 - 0.5) * 0.6)      # gentle baked key light
    rgb *= (1 + 0.35 * lit)[..., None]
    save('regolith', rgb, nrm)
    # 2) layered bedrock (Jezero delta-front sandstone/mudstone)   (tile = 4 m, layers run along texture x)
    yy = np.mgrid[0:N, 0:N][0] / N
    warp = fbm(1.4, 11) * 0.08
    layers = np.sin((yy + warp) * 2 * np.pi * 22) * 0.5 + 0.5
    thick = np.sin((yy + warp * 1.4) * 2 * np.pi * 5) * 0.5 + 0.5
    W1, W2, _ = worley(9, 12, 0.7)
    crack = smooth(0.06, 0.0, W2 - W1)
    nb = fbm(1.0, 13, lo=30)
    h = 0.45 * smooth(0.3, 0.7, layers) * (0.5 + 0.5 * thick) + 0.25 * fbm(1.6, 14) + 0.08 * nb - 0.5 * crack
    rgb = BED * (0.78 + 0.22 * layers[..., None] + 0.12 * (nb[..., None] - 0.5)) * (0.9 + 0.2 * thick[..., None])
    rgb = rgb * (1 - 0.45 * crack[..., None]) + REG * 0.8 * 0.45 * crack[..., None]
    save('bedrock', rgb, normal_from_height(h, 7.0))
    # 3) dark ripple sand   (tile = 6 m)
    xx = np.mgrid[0:N, 0:N][1] / N
    w2 = fbm(1.8, 21) * 0.12
    ph = (xx + w2 + 0.25 * yy) * 2 * np.pi * 9
    rip = (np.sin(ph) * 0.5 + 0.5) ** 1.6
    g = fbm(0.5, 22, lo=200)
    h = 0.75 * rip + 0.1 * g + 0.15 * fbm(1.5, 23)
    rgb = SAND * (0.85 + 0.25 * rip[..., None] + 0.12 * (g[..., None] - 0.5)) + np.array([40, 26, 14.0]) * smooth(0.6, 1.0, rip)[..., None] * 0.5
    save('sand', rgb, normal_from_height(h, 5.0))
    # 4) rock surface for boulders: weathered basalt/sandstone with pits, faint fractures and dust
    r1, r2, r3 = fbm(1.1, 41), fbm(0.7, 42, lo=60), fbm(1.7, 43)
    P1, P2, _ = worley(28, 44, 0.9)
    pit = smooth(0.22, 0.05, P1) * (np.random.default_rng(45).random((N, N)) > -1)
    F1b, F2b, _ = worley(4, 46, 0.8, ((fbm(1.4, 47) - 0.5) * 0.6, (fbm(1.4, 48) - 0.5) * 0.6))
    frac = smooth(0.025, 0.0, F2b - F1b) * smooth(0.3, 0.7, fbm(1.2, 49))
    h = 0.55 * r1 + 0.18 * r2 - 0.2 * pit - 0.25 * frac + 0.1 * r3
    ROCK = np.array([118, 92, 74.0])
    rgb = ROCK * (0.75 + 0.35 * r1[..., None] + 0.18 * (r2[..., None] - 0.5))
    rgb = rgb * (1 - 0.25 * frac[..., None] - 0.12 * pit[..., None]) + REG * 0.9 * (smooth(0.55, 0.85, r3) * 0.45)[..., None]     # dust in hollows
    nrm = normal_from_height(h, 8.0)
    rgb *= (1 + 0.3 * ((nrm[..., 0] / 255.0 - 0.5) * -0.6 + (nrm[..., 1] / 255.0 - 0.5) * 0.6))[..., None]
    save('rock', rgb, nrm)
    def mean_lin(name):   # mean linear colour, used by the shader to keep HiRISE tones and add only local variation
        a = np.asarray(Image.open(os.path.join(APPDATA, f'tex_{name}_albedo.jpg')).convert('RGB')).astype(float) / 255
        return [round(float(v), 4) for v in (a ** 2.2).reshape(-1, 3).mean(0)]
    return {'regolith': {'tile_m': 3.0, 'mean_linear': mean_lin('regolith')}, 'bedrock': {'tile_m': 4.0, 'mean_linear': mean_lin('bedrock')},
            'sand': {'tile_m': 6.0, 'mean_linear': mean_lin('sand')},
            'note': 'Procedural tileable detail (ASSUMPTION); palette from Perseverance Mastcam-Z frames at the study stops.'}


def main():
    cfg = load_config()
    out = {'globe_layers': globe(), 'perseverance': perseverance(cfg), 'ground_textures': textures(),
           'globe_sites': [
               {'id': 'jezero', 'name': 'Jezero Crater', 'lon': 77.45, 'lat': 18.44, 'active': True, 'mission': 'Perseverance (Mars 2020)'},
               {'id': 'gale', 'name': 'Gale Crater', 'lon': 137.44, 'lat': -4.59, 'active': False, 'mission': 'Curiosity (MSL)'},
               {'id': 'utopia', 'name': 'Utopia Planitia', 'lon': 109.93, 'lat': 25.07, 'active': False, 'mission': 'Zhurong (CNSA)'},
               {'id': 'meridiani', 'name': 'Meridiani Planum', 'lon': -5.53, 'lat': -1.95, 'active': False, 'mission': 'Opportunity (MER)'},
           ],
           'globe_labels': [
               {'name': 'Olympus Mons', 'lon': -133.8, 'lat': 18.65}, {'name': 'Valles Marineris', 'lon': -59.2, 'lat': -13.9},
               {'name': 'Hellas Planitia', 'lon': 70.0, 'lat': -42.4}, {'name': 'Syrtis Major', 'lon': 69.5, 'lat': 8.4},
               {'name': 'Isidis Planitia', 'lon': 87.0, 'lat': 12.9}, {'name': 'Tharsis', 'lon': -112.0, 'lat': 0.0},
           ]}
    write_json(os.path.join(APPDATA, 'game_assets.json'), out)
    print('game assets:', json.dumps(out['perseverance']), 'regional', out['globe_layers']['regional']['bounds_lonlat'])


if __name__ == '__main__':
    main()
