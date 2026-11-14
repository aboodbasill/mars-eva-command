# Judge Q&A — rehearsal sheet

Short, honest answers backed by this build. Numbers come from `docs/validation.md` and the release data (build ID in the app header). If a judge asks something not covered here, the safe answer is: *"Here is what we measured, and here is what we did not."*

### "Is this route safe?"
We don't claim that. It is a **planning candidate**. The terrain model is HiRISE at 1 m, aggregated to 5 m cells, so it cannot see rocks or steps smaller than about 1–2 m. Every stop has 25 cm imagery and a rover photo so the crew can judge those themselves. The app says "not a certified safe route" on every screen.

### "Where do 20° and 15° come from?"
20° is the suit capability in NASA's 2020 Lunar Surface EVA Concept of Operations: walk up, down and across slopes of up to 20°, within 2 km of the lander. 15° is the stricter cap used in lunar south-pole traverse studies (Peña-Asensio et al. 2023). Both are **lunar** numbers. Mars has more gravity than the Moon, so we show them as adjustable scenarios, not Mars limits. Switching 20° → 15° makes the route about 0.2 km longer, and the 15° route never exceeds 14.1°.

### "What does the return envelope prove?"
Only that a point can be reached under our declared weighted-cost budget. It says nothing about oxygen, time or emergency capability. The 2 km preset follows the Artemis EVA radius, and 10 km follows NASA's 2007 suited Walkback Test. **Finding:** 45 % of our 6.67 km walk is outside 2 km-equivalent, so this mission needs a closer lander or a rover.

### "Why does the route prefer some ground over other ground?"
Cells with only 20 m CTX terrain cost 1.5× more, and cells with no elevation data are blocked. In this area HiRISE covers every routing cell, so the penalty never triggers; the provenance layer shows that. It is a design preference for ground we can actually see, not a measured risk.

### "What is actually measured?"
Open **Data & Limits**: every layer is labelled measured, orbital, derived, interpretive, modelled or missing.
- Weather: real MEDA pressure (716–769 Pa) and air temperature (−83 to −18 °C) from the 5 sols the rover spent at the depot.
- Radiation: Curiosity RAD at Gale crater (0.21 ± 0.04 mGy/day tissue, 0.64 ± 0.12 mSv/day). It is a different site, so we never call it a Jezero dose.
- Geology is an interpretation, with 100–200 m offsets.

### "How did you validate it?"
- **Projection:** we reprojected before computing slopes. Using the source grid directly would have made east–west distances 5.42 % too long. Our error versus great-circle distance is ≤ 0.0024 %.
- **Registration:** HiRISE elevations versus 268 rover-localized waypoints give a median of −0.00 m. (Rover positions are themselves tied to orbital maps, so this checks our processing chain, not the DTM's absolute accuracy.)
- **Rover plausibility:** 99.2 % of Perseverance's 17.5 km traverse in the area lies on cells we call passable at 20°.
- **Algorithms:** 45 automated tests, including A* checked against two independent Dijkstra implementations, no corner cutting, exact cost units, and "tighter limit never lowers cost". They run in CI on every push.

### "What does AI add?"
Two separate things:
1. **Our own ML model** (Recon mode). It estimates terrain slope where detailed data are missing and was tested on held-out geography. It beat every baseline (MAE 1.49° vs 1.86°), but its uncertainty band covered only 65 % of test cases against our 70 % threshold. **So we don't show its predictions as a product.** It never affects routing.
2. **SI use in development**, disclosed per the 2026 guide. An AI coding assistant wrote the code from our team's plan. The idea, scenario and plan are ours, and every number is computed from NASA data. See `SI_DISCLOSURE.md`.

### "Why not just use Mars Trek?"
Mars Trek is a global and regional viewer, and the challenge text says so. We add what a single Marswalk needs: a route under suit assumptions, a return budget, station cards tied to real sample sites, an evidence label on every layer, offline use and a printable briefing.

### "Why Jezero, and why these stops?"
It is the best-mapped human-scale terrain on Mars: 1 m terrain, 25 cm images, a USGS geologic map, and years of rover ground truth. The stops are four outcrops Perseverance actually sampled (Herd et al. 2025, PNAS), tied to NASEM objectives 1 (life and habitability) and 3 (geologic record). The depot holds the paired samples from three of them. The tube positions come from the PDS depot archive.

### "Is the game just decoration?"
No. It runs on the same data as the planner: real HiRISE heights, our slope grid, the cost-to-home fields, the real stop and tube positions, the Mars24 sun for the chosen date, MEDA temperatures and DONKI CMEs. It turns the plan into a rehearsal: the return margin you see while walking is computed from the same fields as the planner's Go / No-go. Suit consumption rates are declared assumptions.

### "What would you do next?"
- Mars-specific suit mobility data instead of lunar slope limits.
- A time and consumables model.
- Live space weather.
- Illumination and shadow timing.
- Rover-assisted traverses (the obvious fix for the 2 km finding).
- Running the same pipeline on other candidate sites.
