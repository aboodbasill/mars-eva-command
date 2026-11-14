# Mars EVA Command — Marswalk 1 (Jezero Crater)

**Human EVA Exploration Planner · Mars Environmental Intelligence · AI-Assisted Reconnaissance**
NASA Space Apps Challenge 2026 — challenge **[Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/)**. Code: Apache-2.0.

**Live app:** https://aboodbasill.github.io/mars-eva-command/ · **Demo:** [30 s video](https://aboodbasill.github.io/mars-eva-command/demo/Mars_EVA_Command_demo_30s.mp4) · [7 slides](https://aboodbasill.github.io/mars-eva-command/demo/) · [PDF](https://aboodbasill.github.io/mars-eva-command/demo/Mars_EVA_Command_demo.pdf)

**Guided demo tour:** press **▶ Demo tour** in the app, or open https://aboodbasill.github.io/mars-eva-command/#tour. It has 13 steps (about 2 minutes), with Next/Back and arrow keys, and works on phones.

Deep links open the app in a given state, e.g. `#mode=env`, `#mode=recon`, `#station=S2`, `#theta=15&budget=10000`, `#tour`.

> **Use of SI:** the code and docs were generated with the help of an AI coding assistant (Claude, Anthropic) from the team's own plan. All data are NASA/USGS archive data, and no imagery is AI-generated. See [SI_DISCLOSURE.md](SI_DISCLOSURE.md).

> Where could a hypothetical crew walk, what supports that route, what environmental information actually exists here, and where should robots look next?

A fictional two-person EVA at a real robotic site: hypothetical crew lander at Octavia E. Butler Landing → four Perseverance sample outcrops on the delta front → Three Forks sample depot (inspection only) → return. **Planning candidate, not a certified safe route.**

## Run it

```bash
cd app && python3 -m http.server 8765        # then open http://localhost:8765
```

On the first load the service worker caches every file. The badge shows **Offline ready ✓** only after all assets are cached and checked for the current build. You can also open `app/index.html` directly from disk: all data is bundled as JS, so it works with no server and no network.

Rebuild everything from the original NASA/USGS products (about 140 MB of HTTP range reads, roughly 10 minutes on a slow link):

```bash
./run_pipeline.sh
```

## What it shows (all real data, nothing synthetic)

| System | Status | What you see |
|---|---|---|
| 1. EVA Planner | **MVP complete** | HiRISE 1 m terrain, three slope scenarios (15/20/25°), confidence-aware A* routes, return-budget envelope (0.5/1/2/10 km-equivalent), station cards with 25 cm HiRISE chips **and Perseverance point-of-view images**, profile, printable briefing |
| 2. Environmental Intelligence | **MVP complete** | Real MEDA pressure and air temperature for 5 sols at the depot (sols 656–684), with Ls, UTC, quality filters and nulls kept as null. Gale RAD reference (VERIFY), light-time, "no feed" space-weather slot, limits card |
| 3. Recon | **Gap map shipped; AI not released** | Deterministic coverage gaps and ranked follow-up candidates. The AI slope estimator was trained and tested on held-out geography but **failed its release gate** (interval coverage 0.65 < 0.70), so its predictions are not shown as a product layer |

### Key findings (build values, see `docs/validation.md`)

- Itinerary at the 20° default: **6.67 km** physical, 7.46 km-eq weighted cost, max cell slope 19.6°, about 81 m ascent and 81 m descent, 0 % on CTX-only terrain (the whole AOI has HiRISE DTM coverage).
- **45 % of the itinerary lies outside the 2 km-equivalent return budget.** The depot is about 2.8 km-eq from the lander. This is a finding, not a failure: the trip needs a closer lander, a pressurised rover, or fewer stops. Every stop lies inside the optional 10 km-eq preset.
- S1 (Skinner Ridge) sits on a 24° mapped cell. At 15° and 20° the router snaps it 5–7 m to the nearest traversable cell and says so.
- Tightening the limit from 20° to 15° lengthens the route by 202 m (6.87 vs 6.67 km). Loosening it to 25° changes almost nothing.
- Reprojection matters: using the source equatorial-true-scale grid would overstate east–west distance by **5.42 %**.
- Rover plausibility at 20°: 99.2 % of 17.5 km of Perseverance traverse in the AOI is on passable mapped cells, 0.5 % blocked, 0.4 % unknown.

## Repository

```
config/mission.yaml          single mission configuration (sites from rover archive, scenarios, weights)
pipeline/terrain/            01 inspect · 02 AOI + remote HiRISE windows · 03 reproject · 04 slope/provenance
pipeline/routing/            engine.py (A*, Dijkstra, cost model) · 06_routes.py (itineraries, return field)
pipeline/environment/        01 MEDA (PDS4) · 02 context cards
pipeline/recon/recon.py      coverage gaps · spatially validated AI experiment · scout ranking
pipeline/08_validate.py      measured validation → docs/validation.md
pipeline/09_export.py        contracts, overlays, bundle, manifest + checksums, service-worker asset list
tests/                       45 pytest checks (A* vs Dijkstra vs SciPy, cost units, corner cutting, slope planes, voids, projection, MEDA parsing, Ls)
app/                         offline static web app (Leaflet 1.9.4 + Chart.js 4.4.1 bundled)
docs/                        methods, validation, submission text, demo script
```

## Honesty rules this build follows

- Every displayed number has units, source, time and scale. Missing values stay `null`, never zero.
- The default route uses measured and derived terrain only. AI never alters routing. Environment never silently alters cost.
- Geology is interpretive (offsets of 100–200 m). DTM slope does not resolve rocks smaller than about 1–2 m. Gale RAD values are not a Jezero dose.
- Verified on 14 Nov 2026: the RAD values, the NASEM objective numbering, the challenge and its Resources-tab match, and the 2026 submission rules. Still open: per-image acquisition dates, individual depot tube positions, and your Local Lead's cutoff. See `ASSUMPTIONS.md`.

See `REFERENCES.md` for every dataset, paper and library, and `docs/judge-qa.md` for rehearsed answers to likely judge questions.
