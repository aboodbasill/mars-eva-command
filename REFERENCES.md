# References and credits

## NASA / USGS data actually used in the release

| ID | Product | Mission / instrument | How used | Access |
|---|---|---|---|---|
| D1 | Mars 2020 TRN CTX DTM mosaic `JEZ_ctx_B_soc_008_DTM_..._20m` | MRO CTX | 20 m fallback terrain, HiRISE−CTX check, AI predictors | https://www.usgs.gov/data/mars-2020-terrain-relative-navigation-ctx-dtm-mosaic |
| D2 | Mars 2020 TRN CTX orthomosaic `JEZ_ctx_B_soc_008_orthoMosaic_6m`, doi:10.5066/P9GV1ND3 | MRO CTX | context basemap, texture predictors | https://doi.org/10.5066/P9GV1ND3 |
| D3 | Mars 2020 TRN HiRISE DTM mosaic `JEZ_hirise_soc_006_DTM_..._1m_..._blend40`, doi:10.5066/P9REJ9JN | MRO HiRISE | slope, routing, return field, profile (AOI window by HTTP range reads) | https://doi.org/10.5066/P9REJ9JN |
| D4 | Mars 2020 TRN HiRISE orthomosaic `JEZ_hirise_soc_006_orthoMosaic_25cm_..._first`, doi:10.5066/P9QJDP48 | MRO HiRISE | ~1 m display basemap; native 25 cm station chips | https://doi.org/10.5066/P9QJDP48 |
| D5 | Sun & Stack 2020, *Geologic map of Jezero crater and the Nili Planum region*, USGS SIM 3464, doi:10.3133/sim3464 (GeoUnits_v1) | USGS PGM | interpretive geology layer | https://pubs.usgs.gov/sim/3464/ |
| D6 | THEMIS Day/Night IR controlled mosaics (Oct 2018), inside the SIM 3464 GIS bundle | 2001 Mars Odyssey THEMIS | qualitative thermal layer, AI predictor | same as D5 |
| D7 | Perseverance traverse and waypoints `M20_traverse.json`, `M20_waypoints.json` | Mars 2020 | lander/station/depot positions, registration and plausibility checks | https://mars.nasa.gov/mmgis-maps/M20/Layers/json/ |
| E1 | MEDA CAL_PS, CAL_ATS, DER_TIRS, DER_ANCILLARY, sols 656/663/670/677/684 | Mars 2020 MEDA | historical pressure and air temperature at the depot | https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/ |

Credit: NASA/JPL-Caltech/University of Arizona/MSSS/ASU/USGS Astrogeology Science Center; MEDA team (CAB, Spain). No NASA logos or mission patches are used.

## Literature

- Herd, C.D.K., et al. (2025) Sampling Mars: Geologic context and preliminary characterization of samples collected by the NASA Mars 2020 Perseverance Rover Mission. *PNAS* 122(2), e2404255121. doi:10.1073/pnas.2404255121 (station samples, sols, formation).
- Hassler, D.M., et al. (2014) Mars' surface radiation environment measured with the Mars Science Laboratory's Curiosity rover. *Science* 343, 1244797. doi:10.1126/science.1244797 (RAD reference; numeric values are labelled VERIFY).
- Rodriguez-Manfredi, J.A., et al. (2021) The Mars Environmental Dynamics Analyzer, MEDA. *Space Sci. Rev.* 217, 48.
- Allison, M., McEwen, M. (2000) A post-Pathfinder evaluation of areocentric solar coordinates. *Planet. Space Sci.* 48, 215–235 (Ls algorithm).
- Horn, B.K.P. (1981) Hill shading and the reflectance map. *Proc. IEEE* 69, 14–47 (slope kernel).
- National Academies (2025) *A Science Strategy for the Human Exploration of Mars* (objective numbering VERIFY).
- Lunar EVA slope and walk-back studies cited in the team plan (NTRS identifiers VERIFY).

## Software

Leaflet 1.9.4 (BSD-2-Clause, `app/lib/LICENSE-leaflet.txt`), Chart.js 4.4.1 (MIT, `app/lib/LICENSE-chartjs.md`), GDAL 3.12 via rasterio 1.5 and pyogrio 0.13, PROJ via pyproj 3.8, NumPy, SciPy, pandas, scikit-learn 1.9, shapely, tifffile, Pillow, pytest. Exact versions are in `requirements-lock.txt`.
