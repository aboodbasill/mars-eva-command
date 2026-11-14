# Space Apps 2026 project page — ready-to-paste fields

Rules checked 14 Nov 2026 against the official [Project Submission Guide](https://www.spaceappschallenge.org/resources/project-submission-guide/):
- Submission is open from Sat 14 Nov 09:00 until **Sun 15 Nov 23:59**, local time of your team's event. Check your Local Lead's own cutoff too.
- The demo is either a video of **≤ 30 s** (English subtitles if spoken in another language) or **≤ 7 slides**, at a public link with no login.
- All text must be in English.
- At least one NASA data source or resource must be used for a Global Award (we use several).

**Challenge:** [Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/)

**Project name:** Mars EVA Command — Marswalk 1

**Link to Final Project:** https://aboodbasill.github.io/mars-eva-command/ (source: https://github.com/aboodbasill/mars-eva-command)

**Link to Project Demo:** _upload the 30 s video or the slide deck and paste its public link here_

**High-level summary.** Future Mars crews will have 3–22 minutes of one-way light delay, so they must plan their own walks. Mars EVA Command is an offline map for one hypothetical Marswalk at Jezero Crater. It goes from a crew lander at the Perseverance landing site to four sampled delta-front outcrops and the Three Forks sample depot, then back. It routes over real HiRISE 1 m terrain under adjustable slope limits, shows how far each point is from home, and shows the rover's own view of every stop. Every layer is labelled as measured, derived, interpretive, modelled or missing. Its headline finding is that the full trip is 6.7 km and 45 % of it lies outside a 2 km-equivalent return budget, which points to the need for a closer lander or rover support.

**Detailed description.** Three connected systems share one evidence catalog and one coordinate system:
1. *EVA Planner*: A* routing on a 5 m grid where each cell takes the maximum 1 m HiRISE slope. Three slope scenarios, a penalty for low-confidence terrain, a cost-to-lander field, and station cards citing the Perseverance samples (Herd et al. 2025) and NASEM objectives 1 and 3. Each card has a 25 cm HiRISE image and a Perseverance raw image. There is also an elevation profile and a printable briefing.
2. *Environmental Intelligence*: real MEDA pressure and air temperature from five sols Perseverance spent building the depot, with units, UTC, LMST, Ls and quality filters, and gaps left as gaps. Radiation context is Curiosity RAD at Gale (0.21 mGy/day tissue, 0.64 mSv/day), never presented as a Jezero dose.
3. *Recon*: a deterministic map of observation gaps and ranked candidates for robotic follow-up. An AI slope estimator was tested on held-out geography. It beat all baselines (MAE 1.49° vs 1.86°) but failed our interval-coverage gate (0.65 vs 0.70), so we do not ship its predictions.

Validation, measured in the build: projection distance error ≤ 0.0024 %, versus +5.42 % if the source grid were used directly. HiRISE elevations agree with 268 rover-localized waypoints with a median of −0.00 m. 99.2 % of the rover's 17.5 km local traverse lies on cells our model calls passable at 20°. 45 unit tests pass in CI.

Tools: Python (GDAL/rasterio, PROJ, NumPy/SciPy, pandas, scikit-learn), HTML/CSS/JavaScript with Leaflet and Chart.js, GitHub Pages and Actions.

**Challenge objective → feature:**
- Science goals at a chosen location: sourced station cards at Jezero's delta front.
- Layered data from multiple missions (at least three kinds): optical (HiRISE, CTX), topographic (HiRISE and CTX DTMs), thermal (THEMIS), geologic (SIM 3464), atmospheric (MEDA) and radiation context (RAD), from MRO, Mars Odyssey, Mars 2020 and MSL.
- Astronaut safety and space weather: the return-budget envelope, a dated radiation reference, and a "no live feed" slot.
- Suit mobility and obstacle avoidance: slope-limited routing, with the honest note that DTM slope cannot resolve rocks smaller than about 1–2 m.
- Tablet format and static snapshot: the offline app and the printable briefing.
- Point-of-view imagery: Perseverance raw images at every stop.
- Rovers and robots: the rover plausibility check and the robotic follow-up ranking.

**NASA Data:** HiRISE and CTX Mars 2020 TRN mosaics (USGS), USGS SIM 3464 geologic map (Planetary Geologic Mapping Program), THEMIS IR mosaics, Perseverance traverse, waypoints and raw images, MEDA (PDS Atmospheres Node). Details and DOIs are in `REFERENCES.md`.

**Space Agency Partner Data and Other References:** Herd et al. 2025 (PNAS), Hassler et al. 2014 (Science), NASEM 2026, Allison & McEwen 2000; Leaflet, Chart.js, GDAL, PROJ, NumPy, SciPy, pandas, scikit-learn.

**Use of Super Intelligence (SI):** Yes. An AI coding assistant (Claude, Anthropic) generated the data pipeline, tests, web app code and documentation, working from the team's own written plan. The project idea, mission concept and plan were the team's. All data are from NASA/USGS archives, and every displayed number is computed by the pipeline and checked in `docs/validation.md`. No images, audio or video are AI-generated. The acknowledgement also appears in the app (Data & Limits panel), in `SI_DISCLOSURE.md`, in `app/data/manifest.json`, and in a header line in each source file. _Team: check this matches what you actually did before submitting._
