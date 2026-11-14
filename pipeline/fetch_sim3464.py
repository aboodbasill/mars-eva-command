# SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
"""Extract only the geodatabase, THEMIS rasters, coordinate systems and metadata
from the remote USGS SIM 3464 zip using HTTP range requests (avoids the 349 MB download)."""
import urllib.request, zipfile, os, sys, shutil
UA = {'User-Agent': 'mars-eva-command-pipeline/1.0'}
URL = 'https://pubs.usgs.gov/sim/3464/sim3464_database.zip'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw', 'sim3464')
KEEP = ('Geodatabase/', 'USGS_THEMIS_IR_controlled_mosaic_oct2018/', 'CoordinateSystems/', 'Metadata/')

class HttpFile:
    def __init__(s, u):
        s.u, s.pos = u, 0
        r = urllib.request.urlopen(urllib.request.Request(u, headers={**UA, 'Range': 'bytes=0-0'}))
        s.size = int(r.headers['Content-Range'].split('/')[1])
    def seek(s, o, w=0):
        s.pos = o if w == 0 else (s.pos + o if w == 1 else s.size + o); return s.pos
    def tell(s): return s.pos
    def seekable(s): return True
    def readable(s): return True
    def read(s, n=-1):
        if n < 0: n = s.size - s.pos
        if n == 0: return b''
        req = urllib.request.Request(s.u, headers={**UA, 'Range': f'bytes={s.pos}-{s.pos+n-1}'})
        d = urllib.request.urlopen(req).read(); s.pos += len(d); return d

if __name__ == '__main__':
    z = zipfile.ZipFile(HttpFile(URL))
    for i in z.infolist():
        if i.filename.startswith('__MACOSX') or i.is_dir() or not any(k in i.filename for k in KEEP):
            continue
        dest = os.path.join(OUT, i.filename.split('/', 1)[1])
        if os.path.exists(dest) and os.path.getsize(dest) == i.file_size:
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with z.open(i) as src, open(dest + '.part', 'wb') as dst:
            shutil.copyfileobj(src, dst, 1 << 20)
        os.replace(dest + '.part', dest)
        print('ok', i.filename, i.file_size, flush=True)
    print('DONE')
