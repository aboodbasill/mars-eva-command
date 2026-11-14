# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Build the Space Apps demo: a 7-slide deck (HTML + PDF) and a <=30 s silent captioned video.

Inputs: real app screenshots in demo/shots/ (captured with headless Chrome from the running app) and the
release data in app/data/ (all numbers on the slides are read from the exported JSON, not typed by hand).
Outputs: app/demo/index.html, app/demo/img/*.jpg, app/demo/Mars_EVA_Command_demo.pdf,
         app/demo/Mars_EVA_Command_demo_30s.mp4, app/demo/slides/*.png
"""
import json
import os
import shutil
import subprocess

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SHOTS = os.path.join(ROOT, 'demo', 'shots')
OUT = os.path.join(ROOT, 'app', 'demo')
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
TEAM = os.environ.get('MEC_TEAM', '')          # set MEC_TEAM="Team name" to print it on the title slide
APP_URL = 'https://aboodbasill.github.io/mars-eva-command/'
REPO_URL = 'https://github.com/aboodbasill/mars-eva-command'
DURATIONS = [3.5, 4.0, 4.5, 4.5, 4.5, 4.5, 3.5]   # seconds per slide; total 29.0 s (<= 30 s rule)


def load(name):
    with open(os.path.join(ROOT, 'app', 'data', name)) as f:
        return json.load(f)


def crops():
    os.makedirs(os.path.join(OUT, 'img'), exist_ok=True)
    spec = {  # (shot, box) — boxes in the 1600x1000 screenshot frame
        'map': ('eva', (250, 61, 1240, 772)),
        'eva_full': ('eva', (0, 0, 1600, 1000)),
        'station': ('station', (1240, 61, 1600, 1000)),
        'chip': ('chip', (250, 61, 1240, 772)),
        'env': ('env', (250, 61, 1600, 1000)),
        'recon': ('recon', (250, 61, 1600, 1000)),
        'profile': ('eva', (250, 772, 1240, 1000)),
        'game': ('game_dusk', (0, 0, 1600, 1000)),
    }
    for k, (shot, box) in spec.items():
        im = Image.open(os.path.join(SHOTS, f'{shot}.png')).convert('RGB').crop(box)
        im.save(os.path.join(OUT, 'img', f'{k}.jpg'), quality=86, optimize=True)


def slides_html():
    routes = load('routes_local.json')
    val = load('validation.json')
    env = load('environment.json')
    man = load('manifest.json')
    r20 = next(r for r in routes if r['theta_max_deg'] == 20.0)
    r15 = next(r for r in routes if r['theta_max_deg'] == 15.0)
    ex = r20['budget_exceedance']['2000']
    rv = val['rover_plausibility']['by_theta']['20.0']
    reg = val['registration_rover_elevation']['hirise_minus_rover_m']
    m = env['meda']
    P = [r['value'] for r in m['records'] if r['quantity'] == 'pressure' and r['value'] is not None]
    T = [r['value'] for r in m['records'] if r['quantity'] == 'air_temperature' and r['value'] is not None]
    rec = load('recon.json')['model']
    n_tests = val['unit_tests']['summary'].split(' passed')[0]
    team = f'<div class="team">{TEAM}</div>' if TEAM else ''
    S = []
    S.append(f'''<section class="s title"><img class="bg" src="img/map.jpg" alt="">
      <div class="veil"></div><div class="tc">
      <div class="kicker">NASA Space Apps 2026 · Interplanetary Survival Guide: Martian Map</div>
      <h1>Mars EVA Command</h1><h2>Marswalk 1 — an evidence-aware map for a crew's first walk at Jezero Crater</h2>{team}
      <div class="links">{APP_URL}</div></div></section>''')
    S.append(f'''<section class="s"><div class="txt"><div class="kicker">The problem</div>
      <h1>3–22 light-minutes from Earth, the crew plans its own walk.</h1>
      <ul><li>Global viewers show regions. Astronauts need <b>one route</b>, the <b>evidence behind it</b>, and a <b>way home</b>.</li>
      <li>Mars maps mix 25 cm images, 1 m and 20 m terrain, interpretations and gaps. Each needs its own trust level.</li></ul></div>
      <img class="pic" src="img/eva_full.jpg" alt="App overview"></section>''')
    S.append(f'''<section class="s"><div class="txt"><div class="kicker">What we built</div>
      <h1>One offline map, three connected systems</h1>
      <ol><li><b>EVA Planner</b>: slope-limited routes on HiRISE 1 m terrain, return-budget envelope, station cards</li>
      <li><b>Environment</b>: real Perseverance MEDA weather at the depot, plus a dated radiation reference</li>
      <li><b>Recon</b>: where the data are missing, and where robots should look next</li></ol>
      <p class="small">Data: MRO HiRISE · CTX · Mars Odyssey THEMIS · USGS geologic map · Perseverance traverse, raw images, MEDA · Curiosity RAD</p></div>
      <img class="pic tall" src="img/station.jpg" alt="Station card with rover view"></section>''')
    S.append(f'''<section class="s"><div class="txt"><div class="kicker">The route — a real finding</div>
      <h1>{r20["length_m"]/1000:.2f} km round trip; {ex["fraction"]*100:.0f} % beyond a 2 km return budget</h1>
      <ul><li>Lander → 4 sampled delta-front outcrops → Three Forks depot → lander</li>
      <li>Max slope {r20["max_slope_deg"]:.1f}° under a 20° limit; tightening to 15° adds {(r15["length_m"]-r20["length_m"]):.0f} m</li>
      <li><b>Finding:</b> this plan needs a closer lander or rover support</li></ul></div>
      <img class="pic" src="img/map.jpg" alt="Route map"><img class="strip" src="img/profile.jpg" alt="Elevation profile"></section>''')
    S.append(f'''<section class="s"><div class="txt"><div class="kicker">Trust every pixel — measured, not assumed</div>
      <h1>Every stop shows what supports it</h1>
      <ul><li>Provenance layer: 1 m HiRISE vs 20 m CTX vs no data; 25 cm close-ups and the rover's own view of each outcrop</li>
      <li>Real MEDA weather at the depot: {min(P):.0f}–{max(P):.0f} Pa, {min(T)-273.15:.0f} to {max(T)-273.15:.0f} °C</li>
      <li>Terrain vs {reg["count"]} rover waypoints: median {reg["median"]:+.2f} m · {rv["passable_fraction"]*100:.1f} % of the rover's path passable at 20°</li>
      <li>{n_tests} automated tests · our AI model failed its own release gate, so it is not shown as fact</li></ul></div>
      <img class="pic" src="img/chip.jpg" alt="25 cm HiRISE chip at S1"></section>''')
    S.append(f'''<section class="s"><div class="txt"><div class="kicker">Rehearse it in 3D</div>
      <h1>Walk the plan before you walk Mars</h1>
      <ul><li>First- or third-person on the real HiRISE terrain, under the Mars24 sun for the chosen sol</li>
      <li>Oxygen, CO₂, power and cooling from <b>NASA EVA work rates</b> (1,000 Btu/h design) and Mars gravity 3.73 m/s²</li>
      <li>Live return margin from the same cost-to-home fields as the planner's Go / No-go</li>
      <li>Runs offline in a browser, phones included</li></ul></div>
      <img class="pic" src="img/game.jpg" alt="3D field simulator at golden hour"></section>''')
    S.append(f'''<section class="s title"><img class="bg" src="img/chip.jpg" alt=""><div class="veil"></div><div class="tc">
      <div class="kicker">Try it — works offline</div><h1>Mars EVA Command</h1>
      <div class="links big">{APP_URL}</div><div class="links">{REPO_URL}</div>
      <p class="small">All imagery is NASA/USGS spacecraft or rover data. Code made with an AI coding assistant from the team's plan (see SI_DISCLOSURE.md). Build {man["build_id"]}.</p></div></section>''')
    css = '''*{box-sizing:border-box}html,body{margin:0;background:#0e1116;color:#e8edf3;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
      .s{position:relative;width:1600px;height:900px;overflow:hidden;display:flex;gap:40px;padding:60px 64px;background:#0e1116;page-break-after:always;break-after:page}
      .txt{flex:0 0 560px;display:flex;flex-direction:column;justify-content:center}
      .kicker{color:#ff9f43;font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:20px;margin-bottom:14px}
      h1{font-size:46px;line-height:1.12;margin:0 0 22px}h2{font-size:28px;font-weight:500;color:#c9d4e0;margin:0 0 18px}
      ul,ol{font-size:25px;line-height:1.4;padding-left:28px;margin:0}li{margin:0 0 12px}b{color:#ffd7a8}
      .small{font-size:18px;color:#9aa7b6;margin-top:18px}
      .pic{flex:1;min-width:0;height:100%;object-fit:cover;border-radius:12px;border:1px solid #2d3643}
      .pic.tall{flex:0 0 auto;width:430px;object-fit:cover;object-position:top}
      .strip{position:absolute;right:64px;bottom:60px;width:900px;height:200px;object-fit:cover;border-radius:10px;border:1px solid #2d3643}
      .s:has(.strip) .pic{height:560px;align-self:flex-start}
      .title{padding:0}.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
      .veil{position:absolute;inset:0;background:linear-gradient(90deg,rgba(14,17,22,.94) 0%,rgba(14,17,22,.75) 55%,rgba(14,17,22,.35) 100%)}
      .tc{position:relative;padding:120px 96px;display:flex;flex-direction:column;justify-content:center;max-width:1100px}
      .title h1{font-size:84px}.links{font-family:ui-monospace,Menlo,monospace;font-size:24px;color:#4cc9f0;margin-top:14px}
      .links.big{font-size:32px}.team{font-size:28px;margin-top:8px}
      @page{size:1600px 900px;margin:0}
      body.one .s{display:none}body.one .s.on{display:flex}'''
    js = '''const n=parseInt((location.hash.match(/slide=(\\d+)/)||[])[1]||0,10);
      if(n){document.body.classList.add('one');document.querySelectorAll('.s')[n-1].classList.add('on');}'''
    html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Mars EVA Command — Demo</title>
      <meta name="si-disclosure" content="Slides generated with the help of an AI coding assistant from the team's plan; all images are real NASA/USGS data and app screenshots.">
      <style>{css}</style></head><body>{''.join(S)}<script>{js}</script></body></html>'''
    with open(os.path.join(OUT, 'index.html'), 'w') as f:
        f.write(html)
    return len(S)


def chrome(args):
    ud = os.path.join(ROOT, 'demo', '.chrome-profile')
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', f'--user-data-dir={ud}', *args],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    os.makedirs(OUT, exist_ok=True)
    crops()
    n = slides_html()
    assert n <= 7, 'Space Apps limit: 7 slides'
    url = 'file://' + os.path.join(OUT, 'index.html')
    os.makedirs(os.path.join(OUT, 'slides'), exist_ok=True)
    for i in range(1, n + 1):
        chrome(['--window-size=1600,900', '--force-device-scale-factor=1', '--virtual-time-budget=3000',
                f'--screenshot={os.path.join(OUT, "slides", f"slide{i}.png")}', f'{url}#slide={i}'])
    chrome(['--no-pdf-header-footer', '--virtual-time-budget=3000',
            f'--print-to-pdf={os.path.join(OUT, "Mars_EVA_Command_demo.pdf")}', url])
    # 29 s silent video, 1600x900 -> 1920x1080 H.264, gentle cross-fades
    lst = os.path.join(ROOT, 'demo', 'concat.txt')
    with open(lst, 'w') as f:
        for i, d in enumerate(DURATIONS[:n], 1):
            f.write(f"file '{os.path.join(OUT, 'slides', f'slide{i}.png')}'\nduration {d}\n")
        f.write(f"file '{os.path.join(OUT, 'slides', f'slide{n}.png')}'\n")
    mp4 = os.path.join(OUT, 'Mars_EVA_Command_demo_30s.mp4')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst,
                    '-vf', 'scale=1920:1080:flags=lanczos,fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '20',
                    '-preset', 'slow', '-movflags', '+faststart', '-t', str(sum(DURATIONS[:n])), mp4], check=True)
    shutil.rmtree(os.path.join(ROOT, 'demo', '.chrome-profile'), ignore_errors=True)
    os.remove(lst)
    print('slides', n, 'video seconds', sum(DURATIONS[:n]))


if __name__ == '__main__':
    main()
