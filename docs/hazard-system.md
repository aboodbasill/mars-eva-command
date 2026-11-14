# Real-time hazard detection & warnings

The 3D simulator watches the ground around the astronaut. As you approach terrain the suit should not cross, it warns you with screen-edge lights, an LED panel, a direction arrow and alarm tones. The warnings get stronger as you get closer and clear when you move away. Every alert comes from the player's real position and the exported NASA grids, and every alert says what kind of evidence it rests on.

## Files

| File | What it does |
|---|---|
| `app/game/hazard.js` | `HazardDetector`, `HazardAlertManager`, `HazardAudio`, `HazardHUD` and `CONFIG` (new) |
| `app/game/game.js` | builds the detector from the grids; checks hazards 5 times a second while walking; route hazard summary in the planner; minimap and map overlay; menu settings; mute key **N** |
| `app/game/index.html` | `#hz` overlay, hazard-alarm mute button, loads `hazard.js` |
| `app/game/game.css` | edge glow, LEDs, panel, arrow, phone layout, reduced motion |
| `tests/test_hazard.js` | 22 checks covering the 10 scenarios below, run in CI |
| `pipeline/09_export.py`, `.github/workflows/tests.yml` | `hazard.js` added to the offline cache and to CI |

## What counts as a hazard

| Type | Evidence label | Rule (5 m grid) | Highest level |
|---|---|---|---|
| Steep terrain | **DEM-DERIVED** | HiRISE slope > the selected suit limit (15/20/25°) | Critical |
| Sharp elevation change | **DEM-DERIVED** | ≥ 4 m height range inside a 3 × 3 window (≈ 10 m) of the HiRISE DEM | Critical |
| No terrain data | **DATA GAP · UNVERIFIED** | no elevation support (the route planner treats these cells as blocked), or outside the mapped area | Critical |
| Low-resolution terrain | **DATA GAP · LOW RESOLUTION** | only 20 m CTX elevation (provenance class 2) | Warning |
| Route near suit limit | **ROUTE ANALYSIS · DEM** | planned-route cells within 2° of the limit | Caution |

In this build's area, HiRISE covers every cell that has data, so the low-resolution type never fires here; the tests cover it with a synthetic grid. Counts on the real grid at 20°: 18,547 steep cells, 16,117 sharp-step cells, 3,108 no-data cells.

**Never proximity hazards:** night temperature (MEDA, historical), radiation (Curiosity RAD at Gale, a reference value) and CMEs (NASA DONKI, a model forecast). They stay in the separate advisory line with their source named, and they never trigger the hazard alarm.

## Detection algorithm

1. **At start-up (~40 ms):** every cell is classified. Hazard cells are stored per type in a spatial index of 50 m buckets.
2. **Steep cells** are rebuilt when you change the slope limit. **Route cells** are rebuilt when a route is planned.
3. **While walking:** five times a second (not every frame), the detector scans only the buckets within the query radius. It returns, for each hazard type, the nearest cell and the distance to that cell's **edge** (0 when you are inside it). It also returns the direction to the closest point. One query costs about 25 µs on the real grid.
4. **Levels** come from configurable distances (defaults: Caution 50 m, Warning 20 m, Critical 5 m), capped by each type's highest level.
5. **Hysteresis:**
   - Escalation is immediate.
   - Dropping a level needs both: distance beyond `T × 1.2 + 3 m`, and at least 0.8 s spent in the current level.
   - This stops flicker at a threshold and keeps a brief crossing visible.
6. **Priority:** the highest level wins. On a tie, the order is steep > sharp step > no data > low resolution > route. The panel lists up to two other active hazards.
7. **Direction:** the bearing to the hazard relative to where the camera faces gives the edge arrow and the words *ahead*, *to your left/right* or *behind you*.

In the **planner**, `scanRoute()` walks the planned route. For each type it reports the closest approach and how much of the route runs within the Warning distance. The **map (M)** has a *Terrain hazards* layer, and the **minimap** shows the same overlay.

## How it looks and sounds

- **Caution:** steady amber edge glow, one LED, a two-note chime at most every 6 s.
- **Warning:** red edge glow that pulses at 0.8 Hz, two LEDs, a short beep that repeats every 1.3 s and speeds up to 0.75 s as you get closer.
- **Critical:** stronger red edge, three LEDs, a two-tone alarm every 0.55 s, and the reason (for example "Terrain slope exceeds the configured 20° limit").
- **Leaving the zone:** a soft falling "all clear" tone; the panel and lights fade out.
- **No strobing:** pulses stay at or below 1.4 Hz, and only the screen edge glows (the view stays clear).
- **Reduced motion:** turns pulsing off. It follows the system setting by default; change it in Menu → Reduced motion or with `#rm`.
- **Audio rules:** sounds start only after your first click or key press (a browser rule). Tones never overlap. Mute with the speaker button, the **N** key, Menu → Hazard alarm, or `#mute`; visual warnings stay on. Set the volume in Menu → Alarm volume.

## Adjusting warning distances

- **In the game:** Menu → *Alert distances* cycles through three presets: 50/20/5 m (Demo), 80/35/10 m (Conservative), 30/12/3 m (Minimal).
- **By link:** `game/#from=L0&to=S2&play&hz=60,25,8` sets caution, warning and critical (they must decrease).
- **In code:** change `HZ_PRESETS` in `app/game/game.js`, or `CONFIG` in `app/game/hazard.js`. `CONFIG` also holds `hysteresis`, `minDwellS`, `reliefM` (sharp-step height), `nearLimitDeg`, `bucketM` and `queryHz`.

These are gameplay settings, **not NASA-certified safety distances**.

## Changing warning sounds

All tones are synthesised in `HazardAudio.prototype._play` in `hazard.js`; there are no audio files. Each pattern is a few calls to `_tone(start, frequency Hz, duration s, waveform, peak gain, optional end frequency)`:

| Pattern | Now |
|---|---|
| `caution` | 660 Hz then 880 Hz, sine |
| `warning` | 920 Hz square beep |
| `critical` | 1040 Hz then 760 Hz, triangle |
| `clear` | 880 → 520 Hz sine glide |

Repeat intervals are set in `HazardAudio.prototype.update`. To use a recorded file instead, decode it once with `ctx.decodeAudioData`, play an `AudioBufferSourceNode` inside `_play`, and return its length so the no-overlap rule keeps working. Bundle the file under `app/` and add it to the precache list in `pipeline/09_export.py`.

## Test results (`node tests/test_hazard.js`: 22 passed)

1. **Approaching steep ground:** levels at 70/45/30/15/3 m read Clear, Caution, Caution, Warning, Critical. The message names the real slope and the limit, and the arrow points ahead.
2. **Warning zone:** the alarm starts at once and repeats 3 times in 3 s with no overlap.
3. **Moving away:** the level returns to Clear and the "all clear" tone plays once.
4. **Walking parallel at 30 m:** one change to Caution and one chime; the hazard is reported "to your right".
5. **Several hazards:** a Warning-level sharp step outranks a Caution-level steep strip. On a tie, steep wins and the other is listed.
6. **Missing data:** Warning when near, Critical inside (with "the route planner treats this as blocked"), Critical outside the mapped area. CTX-only terrain is capped at Warning. All are labelled DATA GAP.
7. **Muted:** no oscillators are created while muted; sound returns after unmuting.
8. **Fast crossing:** 70 m → 3 m jumps to Critical in one update. Hovering at the 20 m line for 5 s causes no flicker. A 0.1 s crossing stays visible for 0.8 s, then clears.
9. **Reduced motion:** the edge glow holds one steady value; normally it animates smoothly at ≤ 1.4 Hz.
10. **Real NASA grids:**
    - The detector's steep count equals the slope grid (18,547).
    - A real steep cell is found at 0 m.
    - A query costs about 25 µs.
    - The route scan works.
    - The other suites still pass: pytest (46), the route cross-check and the Mars24 tests.

**Checked in the browser:**
- A real 22° cell on the HiRISE DEM triggers Caution at 35 m, Warning at 12 m and Critical at 3 m, with the edge glow, LEDs and arrow.
- The planner lists route hazards; for Lander → S3 the nearest steep cell is 3 m from the route, with 73 m of route within 20 m.
- The phone layout works.
- No console errors.

## Scientific limitations

- **5 m slope:** the DEM cannot see rocks, ledges or steps smaller than about 1–2 m. A Clear status means "nothing found in the 5 m data", **not** "safe".
- **Lunar slope limits:** 15/20/25° come from lunar EVA planning and are shown as scenarios. Nobody has measured suited-walking limits on Mars.
- **Sharp-step threshold:** 4 m in about 10 m is our assumption. It mostly overlaps the steep cells; it adds 2,289 cells that are below 20° on average but contain an abrupt step.
- **DEM processing:** the HiRISE DTM has its own noise and stereo artefacts, and our slope is taken from it after reprojection. Cells near data gaps are less reliable.
- **No-data areas** are unknown, not known to be dangerous; they are labelled as unverified.
- **Distances** are measured on a flat map to the edge of 5 m cells, so the accuracy is about ±3 m.
- **Environment:** weather and radiation are historical or modelled references, never live detections.
