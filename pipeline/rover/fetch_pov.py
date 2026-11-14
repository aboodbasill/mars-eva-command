# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Point-of-view imagery (challenge 'may consider' item; resource: Mars Perseverance Raw Images Gallery).

For each mission stop, pick one raw image taken by Perseverance at that stop's sol from the official raw-image
feed. Selection rule (deterministic, documented): full-frame (not subframe) images only; prefer Mastcam-Z left
(colour) over Navcam left; prefer mast elevation between -20 and +5 deg (looking out at the terrain ahead, not at rover hardware);
then the largest image; ties -> earliest image id. Sequences ZCAM05060-05079 (sampling documentation: drill bits, cores in
tubes; found by inspection to show rover hardware, not terrain) are excluded. Raw images are unprocessed and uncalibrated.
"""
import os
import sys
import json
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from common import META, APPDATA, UA, write_json, read_json  # noqa: E402

FEED = 'https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol={sol}'
GALLERY = 'https://mars.nasa.gov/mars2020/multimedia/raw-images/'
SOL_FOR = {'L0': 14, 'D1': 690}          # lander: first full imaging after landing; depot: last depot-build sol
EXCLUDE_SEQ = tuple(f'ZCAM050{n:02d}' for n in range(60, 80))   # sampling documentation sequences
CREDIT = {'MCZ': 'NASA/JPL-Caltech/ASU', 'NAVCAM': 'NASA/JPL-Caltech'}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()


def score(img):
    ext = img.get('extended', {})
    try:
        el = float(ext.get('mastEl', 'nan'))
    except ValueError:
        el = float('nan')
    w, h = (int(v) for v in ext.get('dimension', '(0,0)').strip('()').split(','))
    inst = img['camera']['instrument']
    return ((1 if inst == 'MCZ_LEFT' else 0), (1 if -20 <= el <= 5 else 0), w * h, el)


def pick(sol):
    imgs = json.loads(get(FEED.format(sol=sol)))['images']
    usable = [i for i in imgs if i['camera']['instrument'] in ('MCZ_LEFT', 'NAVCAM_LEFT')
              and not any(seq in i['imageid'] for seq in EXCLUDE_SEQ)]
    cand = [i for i in usable if i.get('extended', {}).get('subframeRect', '').startswith('(1,1,')]
    if not cand:
        cand = usable
    if not cand:
        return None
    cand.sort(key=lambda i: (tuple(-x for x in score(i)[:3]), i['imageid']))
    return cand[0]


def main():
    sites = read_json(os.path.join(META, 'sites.json'))
    out = {}
    for s in sites:
        sol = SOL_FOR.get(s['id'], s.get('sample_sol'))
        if sol is None:
            continue
        # fall back to earlier sols while the rover stood at the same waypoint (parsed from the site source)
        import re
        m = re.search(r'\(sol (\d+)', s.get('source', ''))
        first = int(m.group(1)) if m and s['id'] not in SOL_FOR else sol
        img = None
        for sl in range(sol, min(first, sol) - 1, -1):
            img = pick(sl)
            if img is not None:
                break
        if img is None:
            print('no POV image for', s['id'], 'sol', sol)
            continue
        fn = f"pov_{s['id']}.jpg"
        p = os.path.join(APPDATA, fn)
        if not os.path.exists(p):
            with open(p, 'wb') as f:
                f.write(get(img['image_files']['large']))
        inst = img['camera']['instrument']
        out[s['id']] = {
            'file': fn, 'sol': img['sol'], 'imageid': img['imageid'], 'camera': inst,
            'date_taken_utc': img.get('date_taken_utc'), 'mast_az_deg': img.get('extended', {}).get('mastAz'),
            'mast_el_deg': img.get('extended', {}).get('mastEl'),
            'source_url': img['image_files']['large'], 'gallery': GALLERY,
            'credit': CREDIT['MCZ' if inst.startswith('MCZ') else 'NAVCAM'],
            'note': 'Raw, unprocessed rover image taken at this stop; a rover camera is ~2 m above ground, not an astronaut eye line.',
        }
        print(s['id'], 'sol', img['sol'], inst, img['imageid'])
    write_json(os.path.join(META, 'pov.json'), out)


if __name__ == '__main__':
    main()
