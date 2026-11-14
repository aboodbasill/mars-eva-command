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
| A-09 | VERIFY | NASEM objective numbers 1 and 3 come from the team plan. |
| A-10 | ASSUMPTION | A blocked stop is snapped to the nearest traversable cell within 15 m, and the displacement is disclosed. |
| A-11 | ASSUMPTION | Ascent and descent use a ~25 m moving average. Raw values are reported too. |
| A-12 | ASSUMPTION | Scout-score weights are design choices. Access cost uses the crew graph as a proxy, not a robot model. |
| V-01 | VERIFY | RAD 0.21 mGy/day and 0.64 mSv/day (Gale, 2012–13) are as cited in the team plan. The paper's full text was not reachable during the build, and a secondary summary quotes 0.67 mSv/day. |
| V-02 | VERIFY | Per-image acquisition dates of the HiRISE and CTX mosaics. |
| V-03 | VERIFY | Current Space Apps 2026 rules, the Local Lead cutoff and timezone, and the challenge Resources-tab dataset match. |

## Findings recorded during the build

- The MEDA `DER_ANCILLARY` column `SOLAR_LONGITUDE_ANGLE` is defined in its PDS4 label as **solar azimuth** in the rover frame. It is not Ls. Ls is computed from label UTC times instead (Allison & McEwen 2000, which reproduces the paper's worked example to 0.001°).
- A unit test caught Horn's kernel assigning slope 0 to a void centre cell. Fixed: voids are never flat.
- MEDA barocap 1 and barocap 2 differ by a median of about 9.4 Pa on every processed sol. This is disclosed on the data card.
- Median HiRISE − CTX in this AOI is −1.31 m (USGS product-wide figure: about −0.4 m). A local AOI can legitimately differ.
