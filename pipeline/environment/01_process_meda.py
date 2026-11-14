"""Phase 6 — historical MEDA sample at the Three Forks depot (Perseverance stationary inside the AOI).

Products (PDS4, PDS Atmospheres Node, mars2020_meda bundle):
  CAL_PS   : BAROCAP1_PRESSURE [Pa] (selected transducer), PRESSURE_MEASUREMENT_MODE
  CAL_ATS  : ATS_LOCAL_TEMP1..3 [K]  (mast/RSM booms; TEMP4/5 are body-mounted and excluded)
  DER_TIRS : ROVER_STILL flag (used to report the motion fraction per bin)
  DER_ANCILLARY : SOLAR_LONGITUDE_ANGLE [deg]
Rules: labels read first; units kept; nulls stay null (never converted to 0); every aggregate reports
statistic, interval, valid count, quality filter and source file. 30-minute LMST bins.
"""
import os
import sys
import glob
import re
import math
import datetime as dt
import urllib.request
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from common import RAW, META, UA, write_json, read_json, sha256  # noqa: E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

BASE = 'https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda'
SOLS = [656, 663, 670, 677, 684]          # weekly sample through the depot build (sols 653-690)
PRODUCTS = {'CAL_PS': 'data_calibrated_env', 'CAL_ATS': 'data_calibrated_env',
            'DER_TIRS': 'data_derived_env', 'DER_ANCILLARY': 'data_derived_env'}
MEDA_DIR = os.path.join(RAW, 'meda')
NS = {'p': 'http://pds.nasa.gov/pds4/pds/v1'}
BIN_H = 0.5


def folder(sol):
    edges = [0, 90, 180, 300, 420, 540, 660, 780, 900, 1020]
    for a, b in zip(edges, edges[1:]):
        if a <= sol < b:
            return f'sol_{a:04d}_{b - 1:04d}/sol_{sol:04d}'
    raise ValueError(sol)


def fname(sol, prod, ver='P01'):
    return f'WE__{sol:04d}___________{prod}' + '_' * (24 - len(prod)) + ver


def latest_version(sol, prod):
    """Product versions differ per sol (P01, P02, ...): list the archive folder and take the highest."""
    local = sorted(glob.glob(os.path.join(MEDA_DIR, fname(sol, prod, 'P??') + '.CSV')))
    if local:
        return os.path.basename(local[-1])[-7:-4]
    url = f'{BASE}/{PRODUCTS[prod]}/{folder(sol)}/'
    html = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read().decode()
    vers = sorted(set(re.findall(re.escape(fname(sol, prod, '')) + r'(P\d\d)\.CSV', html)))
    if not vers:
        raise FileNotFoundError(f'{prod} not archived for sol {sol}')
    return vers[-1]


def fetch(sol, prod):
    os.makedirs(MEDA_DIR, exist_ok=True)
    name = fname(sol, prod, latest_version(sol, prod))
    for ext in ('xml', 'CSV'):
        p = os.path.join(MEDA_DIR, f'{name}.{ext}')
        if os.path.exists(p) and os.path.getsize(p) > 0:
            continue
        url = f'{BASE}/{PRODUCTS[prod]}/{folder(sol)}/{name}.{ext}'
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r, open(p + '.part', 'wb') as f:
            f.write(r.read())
        os.replace(p + '.part', p)
    return os.path.join(MEDA_DIR, name)


def label(path_noext):
    t = ET.parse(path_noext + '.xml')
    fields = {}
    for fld in t.iter('{http://pds.nasa.gov/pds4/pds/v1}Field_Delimited'):
        n = fld.find('p:name', NS).text
        u = fld.find('p:unit', NS)
        fields[n] = (u.text if u is not None else None)
    g = lambda k: (t.find('.//p:' + k, NS).text if t.find('.//p:' + k, NS) is not None else None)  # noqa: E731
    return {'fields': fields, 'start_utc': g('start_date_time'), 'stop_utc': g('stop_date_time'),
            'lid': g('logical_identifier'), 'version': g('version_id')}


def lmst_hours(s: pd.Series):
    # format '00670M00:00:00.376' -> (sol, hours)
    m = s.str.extract(r'^(\d+)M(\d\d):(\d\d):(\d\d(?:\.\d+)?)$')
    sol = m[0].astype(float)
    h = m[1].astype(float) + m[2].astype(float) / 60 + m[3].astype(float) / 3600
    return sol, h


def solar_longitude(t_utc: dt.datetime) -> float:
    """Areocentric solar longitude Ls (deg), Allison & McEwen 2000 (Planet. Space Sci. 48, 215), as in Mars24.
    TT - UTC = 37 leap s + 32.184 s (valid 2017-2026)."""
    jd_utc = t_utc.timestamp() / 86400.0 + 2440587.5
    d = jd_utc + 69.184 / 86400.0 - 2451545.0
    M = math.radians(19.3871 + 0.52402073 * d)
    a_fms = 270.3871 + 0.524038496 * d
    A = (0.0071, 0.0057, 0.0039, 0.0037, 0.0021, 0.0020, 0.0018)
    tau = (2.2353, 2.7543, 1.1177, 15.7866, 2.1354, 2.4694, 32.8493)
    phi = (49.409, 168.173, 191.837, 21.736, 15.704, 95.528, 49.095)
    pbs = sum(a * math.cos(math.radians(0.985626 * d / t + p)) for a, t, p in zip(A, tau, phi))
    eoc = ((10.691 + 3.0e-7 * d) * math.sin(M) + 0.623 * math.sin(2 * M) + 0.050 * math.sin(3 * M)
           + 0.005 * math.sin(4 * M) + 0.0005 * math.sin(5 * M) + pbs)
    return (a_fms + eoc) % 360.0


def process_sol(sol):
    paths = {p: fetch(sol, p) for p in PRODUCTS}
    labs = {p: label(paths[p]) for p in PRODUCTS}
    assert labs['CAL_PS']['fields']['BAROCAP1_PRESSURE'] == 'pascal'
    assert all(labs['CAL_ATS']['fields'][f'ATS_LOCAL_TEMP{i}'] == 'kelvin' for i in (1, 2, 3))

    ps = pd.read_csv(paths['CAL_PS'] + '.CSV', usecols=['SCLK', 'LMST', 'BAROCAP1_PRESSURE', 'BAROCAP2_PRESSURE',
                                                        'PRESSURE_MEASUREMENT_MODE'])
    ats = pd.read_csv(paths['CAL_ATS'] + '.CSV', usecols=['SCLK', 'LMST', 'ATS_LOCAL_TEMP1', 'ATS_LOCAL_TEMP2', 'ATS_LOCAL_TEMP3'])
    tirs = pd.read_csv(paths['DER_TIRS'] + '.CSV', usecols=['SCLK', 'ROVER_STILL'])

    out = []
    for name, df, cols, unit, sensor, qf in (
        ('pressure', ps, ['BAROCAP1_PRESSURE'], 'Pa', 'MEDA PS (BAROCAP1, selected transducer)',
         "PRESSURE_MEASUREMENT_MODE == 'nominal'; non-null values only"),
        ('air_temperature', ats, ['ATS_LOCAL_TEMP1', 'ATS_LOCAL_TEMP2', 'ATS_LOCAL_TEMP3'], 'K',
         'MEDA ATS 1-3 (mast booms, ~1.5 m above ground)', 'non-null values only; record value = mean of available ATS1-3'),
    ):
        d = df.copy()
        if name == 'pressure':
            d = d[d['PRESSURE_MEASUREMENT_MODE'] == 'nominal']
        s_, h = lmst_hours(d['LMST'].astype(str))
        d = d.assign(lsol=s_, h=h)
        d = d[d['lsol'] == sol]                       # keep only records within this LMST sol
        vals = d[cols].apply(pd.to_numeric, errors='coerce')
        d = d.assign(v=vals.mean(axis=1, skipna=True), vmin=vals.min(axis=1), vmax=vals.max(axis=1))
        d = d.merge(tirs, on='SCLK', how='left')
        d['bin'] = (d['h'] // BIN_H) * BIN_H
        for b in np.arange(0, 24, BIN_H):
            g = d[(d['bin'] == b) & d['v'].notna()]
            n = int(len(g))
            rec = {'quantity': name, 'units': unit, 'sol': sol, 'lmst_bin_start_h': float(b), 'bin_h': BIN_H,
                   'statistic': 'mean', 'valid_count': n,
                   'value': round(float(g['v'].mean()), 3) if n else None,
                   'min': round(float(g['vmin'].min()), 3) if n else None,
                   'max': round(float(g['vmax'].max()), 3) if n else None,
                   'rover_moving_fraction': (round(float((g['ROVER_STILL'] == 0).mean()), 3) if n and g['ROVER_STILL'].notna().any() else None),
                   'sensor': sensor, 'quality_filter': qf}
            out.append(rec)
        if name == 'pressure':
            both = d[['BAROCAP1_PRESSURE', 'BAROCAP2_PRESSURE']].dropna()
            inter = float((both['BAROCAP1_PRESSURE'] - both['BAROCAP2_PRESSURE']).median()) if len(both) else None
    t0 = dt.datetime.fromisoformat(labs['CAL_PS']['start_utc'].replace('Z', '+00:00'))
    t1 = dt.datetime.fromisoformat(labs['CAL_PS']['stop_utc'].replace('Z', '+00:00'))
    ls = solar_longitude(t0 + (t1 - t0) / 2)
    anc_label = labs['DER_ANCILLARY']['fields'].get('SOLAR_LONGITUDE_ANGLE')
    meta = {'sol': sol, 'utc_start': labs['CAL_PS']['start_utc'], 'utc_stop': labs['CAL_PS']['stop_utc'],
            'solar_longitude_deg': round(ls, 2),
            'solar_longitude_method': 'Allison & McEwen (2000) from label UTC midpoint (TT = UTC + 69.184 s)',
            'ancillary_note': 'DER_ANCILLARY SOLAR_LONGITUDE_ANGLE is defined in its label as solar AZIMUTH in the '
                              f'rover local-level frame (unit {anc_label}); it is not used as Ls.',
            'barocap1_minus_barocap2_median_pa': None if inter is None else round(inter, 2),
            'files': {p: {'file': os.path.basename(paths[p]) + '.CSV', 'lid': labs[p]['lid'], 'version': labs[p]['version'],
                          'sha256': sha256(paths[p] + '.CSV')} for p in PRODUCTS}}
    return out, meta


def main():
    sites = read_json(os.path.join(META, 'sites.json'))
    depot = next(s for s in sites if s['kind'] == 'depot')
    records, sols = [], []
    for sol in SOLS:
        r, m = process_sol(sol)
        records += r
        sols.append(m)
        print('sol', sol, 'records', sum(1 for x in r if x['value'] is not None), 'Ls', m['solar_longitude_deg'], flush=True)
    env = {
        'schema': 'environment/1.0',
        'evidence_class': 'direct_surface_measurement',
        'site': {'name': 'Three Forks depot area (Perseverance stationary during depot build)', 'lon': depot['lon'],
                 'lat': depot['lat'], 'x': depot['x'], 'y': depot['y'],
                 'support': 'single rover position ±~50 m over the period; NOT a map of Jezero weather'},
        'archive': {'name': 'Mars 2020 MEDA bundle, PDS Atmospheres Node', 'url': BASE + '/',
                    'citation': 'Rodriguez-Manfredi, J.A., et al. (2021) Mars 2020 MEDA bundle, NASA PDS. '
                                'Instrument: Rodriguez-Manfredi et al. 2021, Space Sci. Rev. 217:48.'},
        'time_conventions': 'LMST = local mean solar time at the rover; sol numbers per Mars 2020 mission count; '
                            'UTC from PDS4 label start/stop; Ls = areocentric solar longitude computed from UTC (Allison & McEwen 2000).',
        'sols': sols,
        'records': records,
        'limitations': [
            'Historical records from one rover location; clicking elsewhere on the map does not create a local reading.',
            'Not a forecast. Conditions vary with season (Ls), dust, and local time.',
            'ATS sensors can be affected by rover thermal contamination depending on wind direction; mean of ATS1-3 is a simplification.',
            'Pressure transducers differ by several Pa (barocap1 minus barocap2 median recorded per sol).',
            'MEDA RDS measures sunlight and dust, not ionizing radiation; no crew dose is derived here.',
        ],
    }
    write_json(os.path.join(META, 'environment_meda.json'), env)
    print('wrote environment_meda.json with', len(records), 'bins')


if __name__ == '__main__':
    main()
