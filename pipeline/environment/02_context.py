# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Phase 6 — non-MEDA environmental context cards (radiation reference, communications, thermal, limits).

Each card carries an evidence class and a claim label: CONFIRMED / LIMITED / ASSUMPTION / VERIFY.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from common import META, write_json  # noqa: E402

C_KM_S = 299792.458
AU_KM = 149597870.7


def main():
    d_min_km, d_max_km = 54.6e6, 401e6
    cards = [
        {
            'id': 'radiation',
            'title': 'Ionizing radiation — reference only',
            'evidence_class': 'direct_surface_measurement (different site)',
            'label': 'LIMITED',
            'site': 'Gale crater (Curiosity RAD), ~3,700 km from Jezero',
            'period': 'Aug 2012 – Jun 2013 (~300 sols, near solar maximum)',
            'values': [
                {'quantity': 'absorbed dose rate (tissue)', 'value': 0.21, 'uncertainty': 0.04, 'units': 'mGy/day'},
                {'quantity': 'dose equivalent rate', 'value': 0.64, 'uncertainty': 0.12, 'units': 'mSv/day'},
            ],
            'source': 'Hassler et al. 2014, Science 343, 1244797, doi:10.1126/science.1244797; values as tabulated '
                      'with citation in Space Weather and Space Climate (2016), article swsc150074, Table 2',
            'verification_note': 'Checked 14 Nov 2026 against a peer-reviewed table citing Hassler et al. 2014 '
                                 '(tissue dose 0.21 ± 0.04 mGy/day; dose equivalent 0.64 ± 0.12 mSv/day). The paper '
                                 'full text itself was not accessible during the build. Gray and sievert are different quantities.',
            'limitations': ['Not measured at Jezero; not a forecast for this route.',
                            'Do not multiply by EVA duration to obtain a crew dose: shielding, solar events and atmosphere matter.',
                            'Perseverance carries no ionizing-radiation dosimeter; MEDA RDS measures sunlight and dust.'],
        },
        {
            'id': 'comms',
            'title': 'Earth–Mars communication delay',
            'evidence_class': 'scientific model estimate (orbital geometry)',
            'label': 'LIMITED',
            'values': [
                {'quantity': 'one-way light time, closest approach', 'value': round(d_min_km / C_KM_S / 60, 1), 'units': 'min',
                 'basis': f'{d_min_km/1e6:.1f} million km'},
                {'quantity': 'one-way light time, near conjunction', 'value': round(d_max_km / C_KM_S / 60, 1), 'units': 'min',
                 'basis': f'{d_max_km/1e6:.0f} million km'},
            ],
            'source': 'Computed d / c with c = 299,792.458 km/s; NASA outreach commonly quotes "4 to 24 minutes".',
            'limitations': ['Actual latency depends on date and relay pass schedules; surface links need orbiter relays.',
                            'Solar conjunction constrains operations for a period; duration is mission-specific (not modelled here).',
                            'The plan therefore has to be decided locally; this tool works offline.'],
        },
        {
            'id': 'space_weather',
            'title': 'Space weather',
            'evidence_class': 'insufficient information',
            'label': 'ASSUMPTION',
            'values': [],
            'source': 'Reserved slot for a future live feed (e.g. MAVEN / RAD / MEDA based decision support).',
            'limitations': ['No live data is ingested. The panel shows "no feed", never a default value.'],
        },
        {
            'id': 'thermal',
            'title': 'THEMIS controlled IR mosaics (qualitative layer)',
            'evidence_class': 'orbital observation',
            'label': 'LIMITED',
            'values': [],
            'source': 'Mars Odyssey THEMIS day/night IR controlled mosaics (Oct 2018), bundled in USGS SIM 3464 GIS database',
            'limitations': ['Shown as relative brightness (DN) only, not calibrated temperature or thermal inertia.',
                            'A dated orbital observation at ~100 m scale, not a route temperature forecast.'],
        },
        {
            'id': 'unknowns',
            'title': 'What this map cannot know',
            'evidence_class': 'insufficient information',
            'label': 'CONFIRMED',
            'values': [],
            'source': 'Resolution limits of the DTM products used (1 m HiRISE posting; 20 m CTX posting).',
            'limitations': ['Rocks and steps smaller than ~1–2 m (DTM slope is terrain slope at the DTM scale).',
                            'Current dust loading, wind, and dust-devil activity.',
                            'Live radiation and solar particle events.',
                            'Soil bearing strength / traction; frost; illumination and shadow timing.',
                            'Planetary-protection zones (no authoritative map in this build).'],
        },
    ]
    write_json(os.path.join(META, 'environment_context.json'), cards)
    print('context cards', len(cards))


if __name__ == '__main__':
    main()
