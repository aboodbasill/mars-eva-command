#!/usr/bin/env bash
# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
# Capture real app screenshots for the demo (serve the app first: cd app && python3 -m http.server 8765).
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p shots
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; UD="$(mktemp -d)"
shot(){ "$CH" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$UD/$1" --window-size=1600,1000 \
  --force-device-scale-factor=1 --virtual-time-budget=15000 --screenshot="shots/$1.png" "http://localhost:8765/$2" >/dev/null 2>&1; }
shot eva "#mode=eva"; shot station "#mode=eva&station=S2"; shot chip "#mode=eva&chip=S1&station=S1"
shot env "#mode=env"; shot recon "#mode=recon"; shot data "#mode=data"; shot theta15 "#mode=eva&theta=15&budget=10000"
# 3D game (software WebGL so it works headless; Ultra graphics)
gshot(){ "$CH" --headless=new --hide-scrollbars --use-angle=swiftshader --enable-unsafe-swiftshader --user-data-dir="$UD/g$1" --window-size=1600,1000 \
  --force-device-scale-factor=1 --virtual-time-budget=25000 --screenshot="shots/$1.png" "http://localhost:8765/game/$2" >/dev/null 2>&1; }
gshot game_tp "#play&at=S2&ltst=10&gfx=ultra" & gshot game_dusk "#play&at=S3&ltst=17.4&gfx=ultra" & gshot game_map "#play&at=S2&ltst=10&gfx=high&map" & wait
rm -rf "$UD"; echo "shots captured; now run: ../.venv/bin/python build_demo.py"
