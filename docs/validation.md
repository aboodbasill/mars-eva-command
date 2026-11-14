# Validation log — build `mec-f947b66e0876`

Generated 2026-11-14T02:44:55+00:00 by `pipeline/08_validate.py`. All numbers below are measured from this build. Nothing was pre-filled.

## 1. Projection

- Forward/inverse round trip at the lander: 0.00e+00 m (mathematical consistency only).
- Lander waypoint (sol 13, RMC 3_0) vs the plan's reference coordinate 18.4447°N 77.4508°E: 6.5 m apart (the reference is rounded to 4 decimals).
- Max relative difference between local projected and great-circle distances over 15 site pairs: 0.0024 %.
- If we had used the source equatorial-true-scale grid directly, the E–W distance error would be +5.42 %.

## 2. Registration against rover-localized elevations

- 268 Perseverance waypoints fall inside the AOI.
- HiRISE DTM minus rover elevation: median -0.00 m, 5–95 % [-0.06, +0.05] m (n = 268).
- CTX DTM minus rover elevation: median +0.43 m, 5–95 % [-2.64, +4.74] m (n = 267).
- Limitation: Rover elevations come from localization against orbital maps, so this tests our reprojection and registration chain (a mis-registered grid would show large, spatially structured residuals), not independent DTM accuracy.

## 3. Raster alignment

- Common origin: True; common extent: True; common CRS: True.

## 4. HiRISE vs CTX elevation (common valid support, 20 m blocks)

- Median HiRISE − CTX = -1.31 m, 5–95 % [-7.20, +3.59] m, n = 35178 cells. USGS product-wide reference: about −0.4 m.

## 5. Rover plausibility check

- Traverse length inside the AOI: 17532 m, resampled every 1.0 m (length-weighted).

| θmax | passable | blocked | unknown |
|---|---|---|---|
| 15° | 98.1 % | 1.6 % | 0.4 % |
| 20° | 99.2 % | 0.5 % | 0.4 % |
| 25° | 99.5 % | 0.2 % | 0.4 % |

- Maximum mapped 5 m-cell slope sampled along the recorded path: 27.7° (99th percentile 16.0°).
- Maximum mapped 5 m-cell terrain slope sampled along the recorded path (subject to positional and grid support), not the maximum slope the rover physically crossed. A rover is not an astronaut.

## 6. Route constraints

- theta15: cells over θmax = 0, cells without support = 0, corner cuts = 0, recomputed cost matches = True.
- theta20: cells over θmax = 0, cells without support = 0, corner cuts = 0, recomputed cost matches = True.
- theta25: cells over θmax = 0, cells without support = 0, corner cuts = 0, recomputed cost matches = True.
- Weighted-cost monotonicity across scenarios: 8 leg comparisons, 0 violations; 4 skipped (stop snapped to different cells).

## 7. Return field

- θmax 15°: cost at lander 0.0, minimum neighbour cost 5.09 m; budgets truncated by the AOI: none.
- θmax 20°: cost at lander 0.0, minimum neighbour cost 5.09 m; budgets truncated by the AOI: none.
- θmax 25°: cost at lander 0.0, minimum neighbour cost 5.09 m; budgets truncated by the AOI: none.

## 8. Environment

- 480 30-minute bins over sols [656, 663, 670, 677, 684]; 381 have values; 99 stayed null (no records); units present on all: True.

## 9. Unit tests

- `python -m pytest -q tests` → 45 passed in 0.75s

**Overall pass: True**
