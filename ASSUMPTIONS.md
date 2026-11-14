# Assumptions and open items

Labels: **CONFIRMED** checked in a named primary source · **LIMITED** valid only in a stated regime · **ASSUMPTION** design choice · **VERIFY** unresolved.
The same register ships inside the app (Data & Limits) from `pipeline/09_export.py`.

| ID | Label | Statement |
|---|---|---|
| A-01 | ASSUMPTION | Local projection eqc lat_ts=18.45, lon_0=77.45, R=3,396,190 m. lat_0=18.45 is added only to move the origin (no change of scale). Measured distance error versus great circle is ≤ 0.0024 % across the sites. |
| A-02 | LIMITED | Hard slope limits of 15/20/25° (default 20°) and θpref 15° are lunar-derived: 20° from NASA's 2020 Lunar Surface EVA Concept of Operations, 15° from Peña-Asensio et al. 2023. They are not Mars suit limits. |
| A-03 | ASSUMPTION | ×1.5 penalty on CTX-only cells, and no-data cells blocked. (In this AOI no 5 m cell is CTX-only, so the penalty is inactive.) |
| A-04 | ASSUMPTION | Symmetric edge cost c = d·(1+(max slope/15°)²)·max penalty (cost model `symmetric-max-v1`). |
| A-05 | LIMITED | 0.5/1/2/10 km-equivalent return budgets are demonstration presets, not life-support capability. 2 km follows the Artemis EVA ConOps traverse radius; 10 km follows the suited Walkback Test (Vos et al. 2007, SAE 2007-01-3133). |
| A-06 | ASSUMPTION | The 5 m cell slope is the maximum 1 m Horn slope in the cell. A cell counts as HiRISE-supported if ≥ 90 % of its 1 m slopes are valid. |
| A-07 | LIMITED | Each station position is the last rover waypoint at or before the sampling sol (Herd et al. 2025), ±5 m. |
| A-08 | LIMITED | The depot point is the centroid of the 10 tube-drop rover positions in the PDS Three Forks depot bundle (sample_tube_locations.csv v1.0). Each tube is assumed to lie within ~1–2 m of its rover position. |
| A-09 | CONFIRMED | NASEM (2026) objectives 1 (habitability and life) and 3 (geologic record and habitat mapping) checked against the report, doi:10.17226/28594, on 14 Nov 2026. |
| A-10 | ASSUMPTION | A blocked stop is snapped to the nearest traversable cell within 15 m, and the displacement is disclosed. |
| A-11 | ASSUMPTION | Ascent and descent use a ~25 m moving average. Raw values are reported too. |
| A-12 | ASSUMPTION | Scout-score weights are design choices. Access cost uses the crew graph as a proxy, not a robot model. |
| V-01 | LIMITED | RAD tissue dose 0.21 ± 0.04 mGy/day and dose equivalent 0.64 ± 0.12 mSv/day (Gale, 2012–13) were checked against a peer-reviewed table citing Hassler et al. 2014 (Space Weather and Space Climate 2016). The 0.67 mSv/day in one news summary is not used. The values are from another site and are not a Jezero dose. |
| V-02 | LIMITED | Imagery dates: the USGS metadata gives a content period of 2006–2020. Source images are HiRISE PSP_002387 … ESP_048908 and CTX F05_037607 … J22_053233, all listed in the product XML. Per-image dates can be looked up by these IDs in PDS. |
| V-03 | CONFIRMED (partly) | Challenge "Interplanetary Survival Guide: Martian Map". Two Resources-tab items are used (USGS-NASA Planetary Geologic Mapping Program; Perseverance Raw Images). Per the 2026 guide, submission closes Sun 15 Nov 23:59 local event time. **Still to confirm: your Local Lead's own cutoff.** |

## Simulator (game) assumptions

| ID | Label | Statement |
|---|---|---|
| G-01 | ASSUMPTION | Life support is sized for the NASA 8 h EVA requirement plus a 30 min reserve at the NASA design work rate of 1,000 Btu/h (293 W): O₂ 620 g, CO₂ scrubber 773 g, cooling water 3.17 kg. O₂ use follows Weir (1949) with RQ 0.9. Work rate rises from 100 kcal/h at rest to 1,000 Btu/h at the Apollo pace for the local grade, capped at 2,200 Btu/h; the 1.5 exponent is ours. Power (765 Wh) covers avionics, fans and heaters, and heaters draw more below 245 K. |
| G-02 | ASSUMPTION | Walking pace follows the Apollo-based model (2.7 km/h flat, 1.7 at 10° uphill, 1.2 at 20°). Return-time estimates use a 2.4 km/h average plus 15 min for the airlock. |
| G-03 | ASSUMPTION | The backup rover is unpressurised (Artemis LTV-style), drives at up to 15 km/h on slopes up to 25°, and recharges consumables while you are seated. |
| G-04 | ASSUMPTION | The radiation dose uses the Gale RAD reference rate, ×3 within 24 h of a predicted CME. This is a game model, not a dose forecast. |
| G-05 | LIMITED | Boulders near the player are illustrative (denser on steeper cells). The DTM cannot resolve rocks smaller than about 1–2 m. |
| G-06 | LIMITED | The terrain colour is a false-colour tint of the grayscale HiRISE orthomosaic. |
| G-07 | ASSUMPTION | Distance-to-home fields are stored at 10 m, taking the maximum of each 2×2 block of 5 m cells (conservative). |
| G-08 | ASSUMPTION | "Time & travel" ×N (default ×30; ×10/×30/×60) speeds up the mission clock and the astronaut's movement together. Consumption is computed from the physical pace (1.0 m/s walk, 2.2 m/s lope) over mission time, so oxygen used per metre is the same at every setting. Gravity stays at the real 3.73 m/s². |
| G-09 | LIMITED | Cinematic graphics (bloom, auto-exposure, colour grade, film grain, lens glare) and the sub-metre surface detail are visual effects. The 1 m micro-relief normal map comes from the HiRISE DTM, but rock shapes, dust and footprints are illustrative. |
| G-10 | ASSUMPTION | Ground-detail textures (regolith with pebbles, layered bedrock, ripple sand, rock surfaces) are procedural. Their colours come from Perseverance Mastcam-Z frames at our stops; where each appears is set by HiRISE brightness and slope. They add sub-metre look, not data. |
| G-11 | LIMITED | Outside the 4.9 × 2.9 km HiRISE patch the ground is the Viking colour mosaic from Mars Trek (≈325 m/pixel), tinted like the HiRISE map, for context only. You cannot walk there. |
| G-12 | ASSUMPTION | Perseverance's 3D model is an approximation (3 m long, six 52.5 cm wheels, mast, MMRTG). It stands at its last localized position inside the study area (sol 736, NASA M20 waypoints). The globe marks its latest position in our cached waypoint file. |
| G-13 | ASSUMPTION | Planner times use the Apollo pace on each 5 m step of the route (uphill slows you, downhill does not speed you up). Task times: 25 min per outcrop, 30 min at the depot, 15 min at Perseverance, 10 min at a free point. |
| G-14 | ASSUMPTION | Suit sounds are synthesised. Breathing rate follows the work rate (12 breaths/min at rest, +1 per 30 W). |

## Findings recorded during the build

- The MEDA `DER_ANCILLARY` column `SOLAR_LONGITUDE_ANGLE` is defined in its PDS4 label as **solar azimuth** in the rover frame. It is not Ls. Ls is computed from label UTC times instead (Allison & McEwen 2000, which reproduces the paper's worked example to 0.001°).
- A unit test caught Horn's kernel assigning slope 0 to a void centre cell. Fixed: voids are never flat.
- The first JS Mars24 port had a solar-azimuth sign error (noon pointed north). A unit test caught it, and it is fixed. v4.1 reports the same class of bug.
- MEDA barocap 1 and barocap 2 differ by a median of about 9.4 Pa on every processed sol. This is disclosed on the data card.
- Median HiRISE − CTX in this AOI is −1.31 m (USGS product-wide figure: about −0.4 m). A local AOI can legitimately differ.
