# Use of Super Intelligence (SI) — disclosure

The NASA Space Apps 2026 Project Submission Guide requires code and data made with SI help to be acknowledged in descriptive text and metadata. This file is that acknowledgement.

| Part of the project | SI involvement | Human role |
|---|---|---|
| Mission concept, scenario and implementation plan | **None.** The team wrote the plan (`Mars EVA Command — Final Build Plan v2` and the consolidated master plan). | Authored by the team |
| Data pipeline (`pipeline/`), tests (`tests/`), web app (`app/`), docs | **Generated with an AI coding assistant** (Claude, Anthropic), working from the team's plan | Team reviews and owns the result |
| Scientific data | **None.** All data come from NASA/USGS/PDS archives (see `REFERENCES.md`) and are processed by deterministic code | Values computed by the pipeline; checks in `docs/validation.md` |
| Images in the app | **None generated.** Every image is HiRISE/CTX/THEMIS orbital data or Perseverance raw rover imagery | — |
| ML model in Recon mode | A small scikit-learn model trained on this project's data (not generative). It **failed its release gate** and is not used for any map product | Gate and metrics shown in the app |

Machine-readable copies of this acknowledgement are in `app/data/manifest.json` (`si_acknowledgement`), the `<meta name="si-disclosure">` tag in `app/index.html`, the header line of each source file, and the Data & Limits panel of the app.
