# Thermal Intelligence (thermal map)

The 3D simulator can colour the terrain by thermal data from NASA, on the globe, in the site planner and in first-person exploration. It can also inspect any point, profile a planned route, and show Perseverance's measured ground and air temperature plus a climate-model estimate. Each source stays separate and is labelled with what it is.

## The four kinds of thermal information

| Layer | What it is | Evidence | Numbers? |
|---|---|---|---|
| **THEMIS brightness temperature, afternoon** | Mars Odyssey THEMIS IR band 9 (12.57 µm) *projected brightness temperature*, PDS product **I54976031PBT** (IRPBT2, data set ODY-M-THM-5-IRGEO-V2.0). Taken 2014-05-06 13:27 UTC at **17:49 local solar time**, Ls 126.7°. | Orbital observation, calibrated | Kelvin / °C |
| **THEMIS brightness temperature, pre-dawn** | Same product type, **I75929010PBT**. Taken 2019-01-26 06:55 UTC at **05:48 local solar time**, Ls 330.6°. | Orbital observation, calibrated | Kelvin / °C |
| **THEMIS day / night IR mosaics** | USGS SIM 3464 controlled mosaics (Oct 2018). They are 8-bit display images with no calibration in the file. | Orbital observation, qualitative | Relative only ("cooler → warmer") |
| **MEDA TIRS** | Perseverance's measured ground brightness temperature (`CAL_TIRS GROUND_TEMP`, only where the ground was not in the rover's shadow) and TIRS air temperature. These are 30-minute LMST means over sols 656–684 at the depot. | Surface measurement at one point | Kelvin / °C, as a chart and a marker |
| **Mars Climate Database v6.2** | Modelled surface temperature and air temperature 2 m above the ground at Jezero, for Ls 0/90/180/270 × 24 local hours (climatology, average solar). | Model | Kelvin / °C, as a chart only |

**How we checked the units.** The PBT labels say `ODY:SAMPLE_NAME = BRIGHTNESS_TEMPERATURE`, `ODY:SAMPLE_UNIT = KELVIN`, `PC_REAL`, `NULL_CONSTANT = 0`, sinusoidal projection, 100 m pixels. The pipeline asserts these before using the data. The controlled mosaics have no calibration, so the app never shows degrees for them.

**How we chose the images.** We searched the PDS Orbital Data Explorer for every THEMIS IRPBT2 image over the study area (43 found). For each one we tested its footprint polygon against the study area. We kept the latest afternoon image with the sun still up (incidence 80°) and a pre-dawn image (incidence 97°), and both cover **100 %** of the area. The first afternoon candidate covered only 17 %, and the pipeline's coverage check rejected it.

## What you can do in the game

- **Globe:** the **Thermal** button shows the brightness-temperature image on its own footprint strip only (about 1° × 3° around Jezero), never stretched over the planet. The camera flies there.
- **Site planner:** the thermal map colours the terrain.
  - The panel shows the value under the cursor.
  - *Click to inspect* pins a point instead of setting the route.
  - **Along your route** draws a profile with the coldest and warmest points, coverage and gaps.
- **First person:** press **H** or the thermometer button.
  - The overlay stays on the real terrain, and a HUD chip shows the value at the astronaut with its source and date.
  - It says "outside data coverage" beyond the mapped area.
- **Map (M):** the *Thermal* layer uses the same dataset and colour scale.
- **Panel settings:**
  - On/off, dataset (afternoon / pre-dawn / relative mosaics), opacity, and K / °C.
  - The legend shows the dataset's real minimum and maximum in the study area.
  - Provenance: instrument, product, observation time, local time, season, resolution, coverage and alignment.
  - The MEDA chart and terrain marker, the MCD chart with a season selector, and the limitations.
- **Links:** `game/#site&to=S3&thermal`, `#thermal=pbt_night`, `&celsius`.

**Colour scale:** dark blue → light blue → yellow → orange → red, stretched over the study-area minimum and maximum. In the afternoon image that is 222.1 to 231.1 K; pre-dawn it is 182.9 to 191.4 K. No-data cells are shown with grey hatching and never get a value.

## Processing (`pipeline/environment/04_thermal.py`)

1. Read the PDS labels and check the units, the null value and the projection.
2. Reproject each image (GDAL, bilinear) onto the app's local Mars grid (eqc centred on Jezero, 20 m cells). Any cell touching no-data is masked, so values never blend into gaps.
3. Also reproject each image onto a lon/lat grid over its own footprint, for the globe.
4. Encode as an 8-bit PNG: R holds the value code, alpha is 0 for no-data, and `value = vmin + R/254·(vmax − vmin)`. The step is under 0.3 K.
5. Write `thermal.json` with provenance, statistics, the legend range and the limitations.
6. **Registration and alignment check:** single THEMIS images carry spacecraft-pointing errors.
   - On a 100 m grid over the ~55 km overlap, each calibrated image is matched to the controlled SIM 3464 THEMIS mosaic of the same time of day (tied to MOLA/HRSC) by searching integer shifts.
   - Results:
     - Afternoon image: moved 100 m west and 400 m south; r rose from 0.71 to 0.80.
     - Pre-dawn image: moved 200 m east and 600 m north; r rose from 0.56 to 0.91.
   - After registration the remaining phase-correlation shift is at most 100 m (one THEMIS pixel).
   - Everything is recorded in `thermal.json → registration` and `alignment`.
7. MEDA `CAL_TIRS` files come from the PDS Atmospheres node and are binned like the other MEDA data. MCD values come from the MCD web interface and are cached in `data/raw/mcd/`.

Browser files are about 1.7 MB in total (study-area PNGs of 8–14 kB each, plus the globe footprints). They load only when the thermal layer is first opened, and the offline cache includes them.

## Tests

- **`tests/test_thermal.py`:**
  - Units and labels.
  - 200 random cells: the decoded PNG value matches the original PDS image at the same lon/lat, after the registration shift (median error under 0.6 K plus one encoding step).
  - Registration improves r, and the remaining shift is within one THEMIS pixel.
  - The alignment shift is within one THEMIS pixel.
  - MEDA and the model are stored as point values.
- **`tests/test_thermal.js`:** sampling, bilinear interpolation, outside-coverage and no-data handling, K/°C, the route profile with gaps, and the colour scale.

**Checked in the browser:**
- At S3 (Hidden Harbor) the afternoon image gives 227.8 K and the pre-dawn image 186.8 K.
- The legend switches to °C.
- Relative mosaics disable the unit buttons.
- First-person readout: 226.7 K at the start.
- No console errors.
- The hazard warnings and routes are unchanged (their tests still pass).

## Limitations

- These are **brightness** temperatures at 12.57 µm, not kinetic surface temperatures; emissivity is not removed.
- Each image is **one moment** (the date, local time and season shown). It is not the temperature during a future EVA, and the afternoon and pre-dawn images come from different seasons.
- The 100 m pixels average out boulders, small slopes and shadows.
- MEDA is a point measurement at the rover. It is never spread across the crater.
- MCD is a global-model estimate with one value for the whole study area.
- No safety level is derived from temperature.
