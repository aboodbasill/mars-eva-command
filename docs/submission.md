# Space Apps 2026 project page (draft fields)

**Project name:** Mars EVA Command — Marswalk 1

**High-level summary.** Future Mars crews will have 3–22 minutes of one-way light delay, so they must plan their own walks. Mars EVA Command is an offline map for one hypothetical EVA at Jezero Crater. It goes from a crew lander at the Perseverance landing site to four sampled delta-front outcrops and the Three Forks sample depot, then back. It routes over real HiRISE 1 m terrain under adjustable slope limits, shows how far each point is from home in a return-budget envelope, and labels every layer as measured, derived, interpretive, modelled or missing. Its headline finding is that the full trip is 6.7 km and 45 % of it lies outside a 2 km-equivalent return budget. That points to the need for a closer lander or rover support.

**Detailed description.** Three connected systems share one evidence catalog and coordinate system:
1. *EVA Planner*: A* over a 5 m grid where each cell takes the maximum 1 m HiRISE slope. Three slope scenarios, an explicit evidence penalty, a Dijkstra cost-to-lander field, station cards with sample sources, an elevation profile, and a printable briefing.
2. *Environmental Intelligence*: real MEDA pressure and air temperature from the five sols Perseverance spent building the depot. Units, UTC, LMST, Ls and quality filters are shown, and gaps stay gaps. Radiation context is a dated Gale RAD reference, never a Jezero dose.
3. *Recon*: a deterministic map of observation gaps and ranked follow-up candidates. An AI slope estimator was trained on held-out geography. It beat all baselines (MAE 1.49° vs 1.86°) but failed our interval-coverage gate (0.65 vs 0.70), so we do not ship its predictions.

Validation, measured in the build: projection distance error ≤ 0.0024 %, versus +5.42 % if the source grid had been used directly. HiRISE elevation agrees with 268 rover-localized waypoints with a median of −0.00 m. 99.2 % of the rover's 17.5 km local traverse lies on cells our model calls passable at 20°. 45 unit tests pass.

**Challenge-needs traceability:** science goals and location → sourced station cards · multi-mission integration → MRO HiRISE/CTX, Mars Odyssey THEMIS, Mars 2020 traverse + MEDA, USGS geology · astronaut tool → offline tablet UI + printed briefing · mobility/obstacles → slope-limited routing with stated resolution limits · safety/radiation → return envelope, dated RAD reference · hyperlocal → 1 m terrain, 25 cm chips · rovers/robots → rover plausibility check, robotic follow-up ranking.

**NASA data:** see `REFERENCES.md` (D1–D7, E1). **Other resources:** Leaflet, Chart.js, GDAL/rasterio, PROJ, NumPy/SciPy/pandas/scikit-learn, Herd et al. 2025, Hassler et al. 2014, Allison & McEwen 2000.

**Use of AI (edit to match the team's actual use):** Claude (Anthropic) was used to draft and implement the data pipeline, tests, web app and documentation from the team's written plan. All data comes from the cited archives, and every number in the app is computed by the pipeline and logged in `docs/validation.md`. Team members must review the claims before submission. The project's own ML model (scikit-learn gradient boosting) is documented in the Recon panel and was not released.

**Before submitting:** check the current 2026 rules, Local Lead cutoff, team membership, and the Resources-tab dataset match. Publish the repo and the app (e.g. GitHub Pages serving `app/`), test every link in a private window, and save the confirmation.
