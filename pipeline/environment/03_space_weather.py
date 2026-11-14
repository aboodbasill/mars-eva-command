# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Phase 6 — space-weather snapshot from NASA CCMC DONKI (via api.nasa.gov).

Keeps CMEs whose most-accurate WSA-ENLIL run predicts an impact at Mars (arrival time, glancing blow flag).
Rule used by the app/game (ASSUMPTION): a predicted Mars arrival within 24 h of the EVA is a warning.
Failed or rate-limited endpoints are recorded as such, never filled with defaults. Set NASA_API_KEY to avoid
the DEMO_KEY rate limit.
"""
import os
import sys
import json
import datetime as dt
import urllib.request
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from common import META, UA, write_json  # noqa: E402

API = 'https://api.nasa.gov/DONKI/{ep}?startDate={s}&endDate={e}&api_key={k}'


CACHE = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'raw', 'donki')


def get(ep, s, e, key):
    """Live request; on failure (e.g. DEMO_KEY rate limit) fall back to the last good raw response, labelled."""
    os.makedirs(CACHE, exist_ok=True)
    cpath = os.path.join(CACHE, f'{ep}.json')
    try:
        with urllib.request.urlopen(urllib.request.Request(API.format(ep=ep, s=s, e=e, k=key), headers=UA), timeout=60) as r:
            body = r.read().decode() or '[]'
            with open(cpath, 'w') as f:
                f.write(body)
            return {'ok': True, 'data': json.loads(body) if body.strip() else [], 'from': 'live'}
    except Exception as ex:  # noqa: BLE001
        err = f'HTTP {ex.code}' if isinstance(ex, urllib.error.HTTPError) else repr(ex)[:120]
        if os.path.exists(cpath):
            t = dt.datetime.fromtimestamp(os.path.getmtime(cpath), dt.timezone.utc).isoformat(timespec='seconds')
            with open(cpath) as f:
                return {'ok': True, 'data': json.load(f), 'from': f'cached response fetched {t} (live request failed: {err})'}
        return {'ok': False, 'error': err}


def main():
    key = os.environ.get('NASA_API_KEY', 'DEMO_KEY')
    end = dt.datetime.now(dt.timezone.utc).date()
    start = end - dt.timedelta(days=30)
    s, e = start.isoformat(), end.isoformat()
    res = {ep: get(ep, s, e, key) for ep in ('WSAEnlilSimulations', 'CME', 'FLR', 'SEP')}
    mars = []
    if res['WSAEnlilSimulations']['ok']:
        for sim in res['WSAEnlilSimulations']['data'] or []:
            if not any(c.get('isMostAccurate') for c in sim.get('cmeInputs') or []):
                continue
            for imp in sim.get('impactList') or []:
                if (imp.get('location') or '').lower() == 'mars':
                    c = (sim.get('cmeInputs') or [{}])[0]
                    mars.append({'arrival_utc': imp.get('arrivalTime'), 'glancing_blow': bool(imp.get('isGlancingBlow')),
                                 'minor_impact': bool(imp.get('isMinorImpact')), 'cme_start_utc': c.get('cmeStartTime'),
                                 'speed_km_s': c.get('speed'), 'cme_id': c.get('CMEID'), 'link': sim.get('link')})
    # de-duplicate by CME id keeping the latest model run
    seen = {}
    for m in mars:
        seen[m['cme_id']] = m
    mars = sorted(seen.values(), key=lambda m: m['arrival_utc'] or '')
    n_cme = len(res['CME']['data']) if res['CME']['ok'] else None
    out = {'source': 'NASA CCMC DONKI via api.nasa.gov (WSA-ENLIL simulations, CME, FLR, SEP)',
           'fetched_utc': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
           'window': [s, e], 'cme_count': n_cme, 'cme_mars': mars,
           'flares': [{'class': f.get('classType'), 'peak_utc': f.get('peakTime')} for f in (res['FLR']['data'] or [])] if res['FLR']['ok'] else None,
           'sep': [{'start_utc': x.get('eventTime'), 'instruments': [i.get('displayName') for i in x.get('instruments') or []]} for x in (res['SEP']['data'] or [])] if res['SEP']['ok'] else None,
           'endpoint_status': {k: (v['from'] if v['ok'] else v['error']) for k, v in res.items()},
           'rule': 'A CME predicted to arrive at Mars within 24 h of the EVA is flagged (raises particle radiation, can disturb radio). '
                   'WSA-ENLIL arrival-time errors are typically several hours.',
           'evidence_class': 'scientific_model_estimate'}
    write_json(os.path.join(META, 'spaceweather.json'), out)
    print('CMEs', n_cme, 'predicted at Mars', len(mars), 'status', out['endpoint_status'])


if __name__ == '__main__':
    main()
