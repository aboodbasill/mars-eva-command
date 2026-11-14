# Assumptions and open items

Labels: **CONFIRMED** checked in a named primary source · **LIMITED** valid only in a stated regime · **ASSUMPTION** design choice · **VERIFY** unresolved.
The same register ships inside the app (Data & Limits) from `pipeline/09_export.py`.

| ID | Label | Statement |
|---|---|---|
| A-01 | ASSUMPTION | Local projection eqc lat_ts=18.45, lon_0=77.45, R=3,396,190 m. lat_0=18.45 is added only to move the origin (no change of scale). Measured distance error versus great circle is ≤ 0.0024 % across the sites. |
| A-02 | ASSUMPTION | Hard slope limits of 15/20/25° (default 20°) and θpref 15° are lunar-derived exploratory values, not Mars suit limits. |
| A-03 | ASSUMPTION | ×1.5 penalty on CTX-only cells, and no-data cells blocked. (In this AOI no 5 m cell is CTX-only, so the penalty is inactive.) |
| A-04 | ASSUMPTION | Symmetric edge cost c = d·(1+(max slope/15°)²)·max penalty (cost model `symmetric-max-v1`). |
| A-05 | LIMITED | 0.5/1/2/10 km-equivalent return budgets are demonstration presets, not life-support capability. |
| A-06 | ASSUMPTION | The 5 m cell slope is the maximum 1 m Horn slope in the cell. A cell counts as HiRISE-supported if ≥ 90 % of its 1 m slopes are valid. |
| A-07 | LIMITED | Each station position is the last rover waypoint at or before the sampling sol (Herd et al. 2025), ±5 m. |
| A-08 | VERIFY | The depot point is the centroid of 21 depot-build waypoints (spread ~50 m). Individual tube positions are not transcribed. |
| A-09 | CONFIRMED | NASEM (2026) objectives 1 (habitability and life) and 3 (geologic record and habitat mapping) checked against the report, doi:10.17226/28594, on 14 Nov 2026. |
| A-10 | ASSUMPTION | A blocked stop is snapped to the nearest traversable cell within 15 m, and the displacement is disclosed. |
| A-11 | ASSUMPTION | Ascent and descent use a ~25 m moving average. Raw values are reported too. |
| A-12 | ASSUMPTION | Scout-score weights are design choices. Access cost uses the crew graph as a proxy, not a robot model. |
| V-01 | LIMITED | RAD tissue dose 0.21 ± 0.04 mGy/day and dose equivalent 0.64 ± 0.12 mSv/day (Gale, 2012–13) were checked against a peer-reviewed table citing Hassler et al. 2014 (Space Weather and Space Climate 2016). The 0.67 mSv/day in one news summary is not used. The values are from another site and are not a Jezero dose. |
| V-02 | VERIFY | Per-image acquisition dates of the HiRISE and CTX mosaics. |
| V-03 | CONFIRMED (partly) | Challenge "Interplanetary Survival Guide: Martian Map". Two Resources-tab items are used (USGS-NASA Planetary Geologic Mapping Program; Perseverance Raw Images). Per the 2026 guide, submission closes Sun 15 Nov 23:59 local event time. **Still to confirm: your Local Lead's own cutoff.** |

## Findings recorded during the build

- The MEDA `DER_ANCILLARY` column `SOLAR_LONGITUDE_ANGLE` is defined in its PDS4 label as **solar azimuth** in the rover frame. It is not Ls. Ls is computed from label UTC times instead (Allison & McEwen 2000, which reproduces the paper's worked example to 0.001°).
- A unit test caught Horn's kernel assigning slope 0 to a void centre cell. Fixed: voids are never flat.
- MEDA barocap 1 and barocap 2 differ by a median of about 9.4 Pa on every processed sol. This is disclosed on the data card.
- Median HiRISE − CTX in this AOI is −1.31 m (USGS product-wide figure: about −0.4 m). A local AOI can legitimately differ.
