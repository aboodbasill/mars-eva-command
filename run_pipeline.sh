#!/usr/bin/env bash
# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
# Reproduce the full Mars EVA Command build from the original archives.
set -euo pipefail
cd "$(dirname "$0")"
[ -d .venv ] || { python3 -m venv .venv && .venv/bin/pip install -r requirements-lock.txt; }
P=.venv/bin/python
B=https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn
mkdir -p data/raw
for f in CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif CTX/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif; do
  [ -f "data/raw/$(basename $f)" ] || curl -sSfL -o "data/raw/$(basename $f)" "$B/$f"
done
for f in M20_traverse.json M20_waypoints.json; do
  [ -f "data/raw/$f" ] || curl -sSfL -o "data/raw/$f" "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/$f"
done
$P pipeline/fetch_sim3464.py
mkdir -p data/raw/depot && [ -f data/raw/depot/sample_tube_locations.csv ] || curl -sSfL -o data/raw/depot/sample_tube_locations.csv https://pds-geosciences.wustl.edu/m2020/urn-nasa-pds-mars2020_sample_depot_three_forks/miscellaneous/sample_metadata/sample_tube_locations.csv
$P pipeline/terrain/01_inspect.py
$P pipeline/terrain/02_prepare_aoi.py
$P pipeline/terrain/03_reproject.py
$P pipeline/terrain/04_derive_terrain.py
$P pipeline/routing/06_routes.py
$P pipeline/environment/01_process_meda.py
$P pipeline/environment/02_context.py
$P pipeline/rover/fetch_pov.py
$P pipeline/recon/recon.py
$P pipeline/08_validate.py
$P pipeline/09_export.py
echo "Done. Serve with: cd app && python3 -m http.server 8765"
