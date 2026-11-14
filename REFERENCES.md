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
| D8 | Three Forks sample depot bundle, `sample_tube_locations.csv` v1.0 (urn:nasa:pds:mars2020_sample_depot_three_forks) | Mars 2020 | depot inspection point and 10 tube markers | https://pds-geosciences.wustl.edu/m2020/urn-nasa-pds-mars2020_sample_depot_three_forks/ |
| D7 | Perseverance traverse and waypoints `M20_traverse.json`, `M20_waypoints.json` | Mars 2020 | lander/station/depot positions, registration and plausibility checks | https://mars.nasa.gov/mmgis-maps/M20/Layers/json/ |
| E2 | Perseverance raw images (Mastcam-Z, Navcam) at each stop, chosen by a documented rule; image IDs shown in the app | Mars 2020 | point-of-view images on station cards | https://mars.nasa.gov/mars2020/multimedia/raw-images/ (challenge Resources tab) |
| E4 | NASA/JPL Mars Trek WMTS: Viking MDIM 2.1 colour mosaic (zoom 3 global, zoom 7 around Jezero) and MGS MOLA colour shaded relief (zoom 2) | NASA/JPL, USGS | the start globe and the regional ground around the HiRISE patch | https://trek.nasa.gov/mars/ (challenge Resources tab) |
| E3 | NASA CCMC DONKI (WSA-ENLIL simulations, CME list) via api.nasa.gov, 30-day snapshot | NASA CCMC | space-weather card and CME warnings | https://kauai.ccmc.gsfc.nasa.gov/DONKI/ |
| E1 | MEDA CAL_PS, CAL_ATS, DER_TIRS, DER_ANCILLARY, sols 656/663/670/677/684 | Mars 2020 MEDA | historical pressure and air temperature at the depot | https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/ |

Challenge Resources-tab items used: JPL Mars Trek (global mosaics), USGS-NASA Planetary Geologic Mapping Program (SIM 3464), Mars Perseverance Raw Images Gallery. The Curiosity route-map example inspired the planner's route view.

Credit: NASA/JPL-Caltech/University of Arizona/MSSS/ASU/USGS Astrogeology Science Center; MEDA team (CAB, Spain). No NASA logos or mission patches are used.

## Literature

- Herd, C.D.K., et al. (2025) Sampling Mars: Geologic context and preliminary characterization of samples collected by the NASA Mars 2020 Perseverance Rover Mission. *PNAS* 122(2), e2404255121. doi:10.1073/pnas.2404255121 (station samples, sols, formation).
- Hassler, D.M., et al. (2014) Mars' surface radiation environment measured with the Mars Science Laboratory's Curiosity rover. *Science* 343, 1244797. doi:10.1126/science.1244797 (RAD reference). Values 0.21 ± 0.04 mGy/day (tissue) and 0.64 ± 0.12 mSv/day are as tabulated with this citation in *Space Weather and Space Climate* (2016), article swsc150074, Table 2.
- Rodriguez-Manfredi, J.A., et al. (2021) The Mars Environmental Dynamics Analyzer, MEDA. *Space Sci. Rev.* 217, 48.
- Allison, M., McEwen, M. (2000) A post-Pathfinder evaluation of areocentric solar coordinates. *Planet. Space Sci.* 48, 215–235 (Ls and the Mars24 sun clock in `app/mars24.js`, tested against MEDA label times to ±5 s).
- Jones, E.M., *Apollo Lunar Surface Journal*, "Lunar Gaits" (2.7 km/h walk-back pace), and Apollo 14 traverse data (1.7 km/h uphill), as used by Marswalk Planner v4.1 for the pace model.
- Horn, B.K.P. (1981) Hill shading and the reflectance map. *Proc. IEEE* 69, 14–47 (slope kernel).
- National Academies of Sciences, Engineering, and Medicine (2026) *A Science Strategy for the Human Exploration of Mars*. doi:10.17226/28594 (objectives 1, 3, 5, 9, 11 cited).
- NASA (2020) *Topic 1: EVA Lunar Surface Concept of Operations* — suit walks up/down/across slopes up to 20° on traverses up to 2 km from the lander. https://www.nasa.gov/wp-content/uploads/2020/01/topic_1-_eva_lunar_surface_concept_of_operations.pdf
- Vos, J.R., Gernhardt, M.L., Lee, L.R. (2007) *The Walkback Test*. SAE Technical Paper 2007-01-3133 — suited 10 km return-walk study (basis of the optional 10 km preset).
- Williams, D.R., *Mars Fact Sheet*, NASA Space Science Data Coordinated Archive (NSSDC), https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html — surface gravity 3.73 m/s² used by the game.
- Waligora, J.M., Horrigan, D.J. (1975) Metabolism and heat dissipation during Apollo EVA periods. In *Biomedical Results of Apollo*, NASA SP-368, ch. 4 — measured EVA work rates (resting floor of about 100 kcal/h and the lunar-EVA averages).
- Gernhardt, M.L., et al., NASA Human Research Program evidence on EVA operations — EMU design average 1,000 Btu/h and peaks around 2,200 Btu/h, used as W_design and W_peak.
- NASA (2021) *Exploration EVA System Concept of Operations* (xEVA ConOps) — 8 h EVA duration and 4.3 psid suit pressure.
- Weir, J.B. de V. (1949) New methods for calculating metabolic rate with special reference to protein metabolism. *J. Physiol.* 109, 1–9 — O₂ energy equivalent 3.941 + 1.106·RQ kcal/L.
- Golombek, M., Rapp, D. (1997) Size-frequency distributions of rocks on Mars and Earth analog sites. *J. Geophys. Res.* 102(E2), 4117–4129 — rock model for the boulders scattered near the player.
- NASA Lunar Terrain Vehicle (Artemis) design figure of 15 km/h top speed; Apollo LRV records for comparison.
- Kring, D.A. (2023, interview) — early Artemis traverses on slopes < 20°, within ~2 km of the lander (phys.org, Oct 2023).
- Peña-Asensio, E., et al. (2023) — lunar south-pole traverse planning with a 15° slope cap (basis of the 15° scenario).

## Software

Leaflet 1.9.4 (BSD-2-Clause, `app/lib/LICENSE-leaflet.txt`), Roboto Condensed (SIL OFL 1.1, `app/lib/fonts/LICENSE-RobotoCondensed.txt`), Three.js r149 (MIT, `app/lib/LICENSE-three.txt`), Chart.js 4.4.1 (MIT, `app/lib/LICENSE-chartjs.md`), GDAL 3.12 via rasterio 1.5 and pyogrio 0.13, PROJ via pyproj 3.8, NumPy, SciPy, pandas, scikit-learn 1.9, shapely, tifffile, Pillow, pytest. Exact versions are in `requirements-lock.txt`.
