/* SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md. */
/* Marswalk 1 — Field Simulator.
 * A first/third-person EVA on real Jezero terrain (HiRISE 1 m DTM aggregated to 5 m), with stations, depot tubes,
 * weather, sun and space weather from the release data. Life-support rates are declared game assumptions.
 * Coordinates: local metres x east / y north (pipeline); Three.js X = x - x_lander, Z = -(y - y_lander), Y = up. */
(function () {
  'use strict';
  const D = window.MEC_DATA, G = window.MEC_GRIDS, M24 = window.Mars24;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const fmt = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v)) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const hm = (h) => { if (!Number.isFinite(h)) return '—'; const s = h < 0 ? '−' : ''; const m = Math.round(Math.abs(h) * 60); return `${s}${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
  const D2R = Math.PI / 180;
  const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (TOUCH) document.body.classList.add('touch');

  // ------------------------------------------------------------------------------------------------ data
  function decode(g) {
    const bin = atob(g.b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return { arr: g.dtype === 'uint16' ? new Uint16Array(u8.buffer) : u8, scale: g.scale, offset: g.offset || 0, nodata: g.nodata, f: g.factor || 1, nc: g.ncols, nr: g.nrows };
  }
  const grids = {};
  for (const [k, g] of Object.entries(G.grids)) if (!k.startsWith('recon')) grids[k] = decode(g);
  const g5 = G.grid_5m, NC = g5.ncols, NR = g5.nrows, CELL = g5.cell_m;
  const gv = (name, r, c) => {
    const g = grids[name];
    if (!g || r < 0 || c < 0 || r >= NR || c >= NC) return null;
    const rr = Math.floor(r / g.f), cc = Math.floor(c / g.f), nc = g.nc || NC;
    if (rr >= (g.nr || NR) || cc >= nc) return null;
    const v = g.arr[rr * nc + cc];
    return g.nodata !== null && v === g.nodata ? null : v * g.scale + g.offset;
  };
  const rcOf = (x, y) => [Math.floor((g5.y0 - y) / CELL), Math.floor((x - g5.x0) / CELL)];
  const ST = D.stations, lander = ST.find((s) => s.kind === 'lander'), depot = ST.find((s) => s.kind === 'depot');
  const AOI = D.manifest.aoi.local_bounds_m;
  const CX = lander.x, CY = lander.y;
  const W = (x, y) => ({ X: x - CX, Z: -(y - CY) });
  const Lc = (X, Z) => ({ x: X + CX, y: CY - Z });

  // elevation field (fill rare voids with the mean so the mesh has no holes; voids stay "no data" for slope)
  const elev = new Float32Array(NC * NR);
  { let s = 0, n = 0; for (let i = 0; i < NC * NR; i++) { const v = grids.elevation.arr[i]; if (v !== 65535) { s += v; n++; } }
    const mean = s / n; for (let i = 0; i < NC * NR; i++) { const v = grids.elevation.arr[i]; elev[i] = (v === 65535 ? mean : v) * 0.1 - 3000; } }
  const STEP = TOUCH ? 2 : 1;                       // mesh decimation (10 m on phones)
  const MR = Math.floor((NR - 1) / STEP) + 1, MC = Math.floor((NC - 1) / STEP) + 1;
  const node = (r, c) => elev[Math.min(NR - 1, r * STEP) * NC + Math.min(NC - 1, c * STEP)];
  function heightLocal(x, y) {                       // matches the mesh (bilinear on mesh nodes)
    const cf = ((x - g5.x0) / CELL - 0.5) / STEP, rf = ((g5.y0 - y) / CELL - 0.5) / STEP;
    const c0 = clamp(Math.floor(cf), 0, MC - 2), r0 = clamp(Math.floor(rf), 0, MR - 2);
    const tc = clamp(cf - c0, 0, 1), tr = clamp(rf - r0, 0, 1);
    return lerp(lerp(node(r0, c0), node(r0, c0 + 1), tc), lerp(node(r0 + 1, c0), node(r0 + 1, c0 + 1), tc), tr);
  }
  const E0 = heightLocal(CX, CY);
  const groundY = (X, Z) => { const p = Lc(X, Z); return heightLocal(p.x, p.y) - E0; };

  // MEDA climatology by LMST (mean of the 5 depot sols) — historical reference, not a forecast
  const medaRef = (() => {
    const m = D.environment.meda; if (!m) return null;
    const bins = {}; for (const r of m.records) { if (r.value === null) continue; const k = r.quantity + ':' + r.lmst_bin_start_h; (bins[k] = bins[k] || []).push(r.value); }
    const curve = (q) => Array.from({ length: 48 }, (_, i) => { const a = bins[q + ':' + i * 0.5]; return a ? a.reduce((s, v) => s + v, 0) / a.length : null; });
    return { T: curve('air_temperature'), P: curve('pressure'), sols: m.sols.map((s) => s.sol), ls: [m.sols[0].solar_longitude_deg, m.sols.at(-1).solar_longitude_deg] };
  })();
  function medaAt(q, lmst) {
    if (!medaRef) return null;
    const a = medaRef[q], i = Math.floor(lmst * 2) % 48;
    for (let k = 0; k < 6; k++) { const v = a[(i + k) % 48] ?? a[(i - k + 48) % 48]; if (v !== null && v !== undefined) return v; }
    return null;
  }
  const swx = D.environment.spaceweather;
  const cmeNear = (t) => (swx?.cme_mars || []).filter((c) => c.arrival_utc && Math.abs(new Date(c.arrival_utc).getTime() - t) <= 24 * 3600e3);
  const routeOf = (th) => D.routes.find((r) => r.theta_max_deg === th);
  const roverPark = (th) => D.rover?.scenarios?.[String(th.toFixed ? th.toFixed(1) : th)] || D.rover?.scenarios?.[String(th)];

  // pace model (Apollo-based, as in Marswalk Planner v4.1): km/h vs uphill grade in degrees
  const paceKmh = (gradeDeg) => gradeDeg <= 3 ? 2.7 : gradeDeg <= 10 ? lerp(2.7, 1.7, (gradeDeg - 3) / 7) : lerp(1.7, 1.2, clamp((gradeDeg - 10) / 10, 0, 1.5));
  function plannedWalkHours(th) {
    const r = routeOf(th), p = D.profiles.profiles[r.scenario_id]; let h = 0;
    for (let i = 10; i < p.distance_m.length; i += 10) {
      const dd = p.distance_m[i] - p.distance_m[i - 10], dz = p.elevation_smoothed_m[i] - p.elevation_smoothed_m[i - 10];
      h += dd / 1000 / paceKmh(Math.atan2(dz, dd) / D2R);
    }
    return h;
  }

  // ------------------------------------------------------------------------------------------------ settings & state
  const S = {
    theta: D.manifest.config.routing.default_deg, speed: 30, rover: true, view: 'tp', mode: 'walk',
    sim: Date.now(), evaStart: null, playing: false, paused: false, over: false, routeLine: true, headlamp: false,
    score: 0, done: new Set(), waypoint: null, trail: [], walked: 0, minMargin: Infinity,
    res: { o2: 1, co2: 1, pwr: 1, h2o: 1, integ: 1, dose: 0 }, wAvg: 200, hr: 70, lastJumpW: 0,
  };
  const CAP = { o2: 8.5 * 300, co2: 9 * 300, pwr: 8.5 * 95, h2o: 8.5 * 300 };   // W·h of metabolic/heat/electric budget (ASSUMPTION)
  const RES_INFO = {
    o2: ['Oxygen', 'Primary O₂ for ~8.5 h at 300 W average work rate'], co2: ['CO₂ scrubber', 'CO₂ removal capacity ~9 h at 300 W'],
    pwr: ['Suit power', 'Avionics, radio, fans and heaters'], h2o: ['Cooling water', 'Rejects body heat; drains faster when working hard in sunlight'],
    integ: ['Suit pressure', 'Nominal 4.3 psi; hard landings can cause a slow leak'], dose: ['Radiation dose', 'Gale RAD reference rate; ×3 if a CME is predicted within 24 h (assumption)'],
  };

  // ------------------------------------------------------------------------------------------------ renderer & scene
  const canvas = $('#view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !TOUCH, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, TOUCH ? 1.5 : 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.08, 12000);
  function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize); resize();

  // sky dome
  const skyU = { sunDir: { value: new THREE.Vector3(0, 1, 0) }, day: { value: 1 } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: skyU,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 sunDir; uniform float day; varying vec3 vD;
      void main(){
        float h = clamp(vD.y, -0.2, 1.0);
        vec3 zen = vec3(0.36,0.25,0.19), hor = vec3(0.86,0.66,0.48);
        vec3 col = mix(hor, zen, pow(max(h,0.0), 0.55));
        float sd = max(dot(normalize(vD), normalize(sunDir)), 0.0);
        float low = 1.0 - smoothstep(0.0, 0.35, sunDir.y);
        col = mix(col, vec3(0.42,0.58,0.86), low * pow(sd, 6.0) * 0.9);      // blue Martian sunset around the Sun
        col += vec3(1.0,0.86,0.66) * pow(sd, 400.0) * 3.0;                     // sun disc
        col *= day;
        col += vec3(0.012,0.010,0.016) * (1.0 - day);
        gl_FragColor = vec4(col, 1.0);
      }` }));
  scene.add(sky);
  const stars = (() => {
    const n = 1800, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = 8500, s = Math.sqrt(1 - u * u);
      pos[i * 3] = r * s * Math.cos(a); pos[i * 3 + 1] = Math.abs(r * u); pos[i * 3 + 2] = r * s * Math.sin(a); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    scene.add(p); return p;
  })();
  scene.fog = new THREE.Fog(0xcfa27a, 350, 4200);
  const sun = new THREE.DirectionalLight(0xfff0dc, 1.5);
  sun.castShadow = true; sun.shadow.mapSize.set(TOUCH ? 1024 : 2048, TOUCH ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 400 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xe8c3a0, 0x5a3420, 0.45); scene.add(hemi);
  const lamp = new THREE.SpotLight(0xdff1ff, 0, 60, 0.55, 0.5, 1.2); scene.add(lamp, lamp.target);

  // terrain mesh
  function buildTerrain() {
    const pos = new Float32Array(MR * MC * 3), uv = new Float32Array(MR * MC * 2);
    const w = AOI.xmax - AOI.xmin, h = AOI.ymax - AOI.ymin;
    for (let r = 0; r < MR; r++) for (let c = 0; c < MC; c++) {
      const x = g5.x0 + (Math.min(NC - 1, c * STEP) + 0.5) * CELL, y = g5.y0 - (Math.min(NR - 1, r * STEP) + 0.5) * CELL;
      const i = r * MC + c, p = W(x, y);
      pos[i * 3] = p.X; pos[i * 3 + 1] = node(r, c) - E0; pos[i * 3 + 2] = p.Z;
      uv[i * 2] = (x - AOI.xmin) / w; uv[i * 2 + 1] = (y - AOI.ymin) / h;
    }
    const idx = new Uint32Array((MR - 1) * (MC - 1) * 6); let k = 0;
    for (let r = 0; r < MR - 1; r++) for (let c = 0; c < MC - 1; c++) {
      const a = r * MC + c, b = a + 1, d = a + MC, e = d + 1;
      idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = e;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
    const tex = new THREE.TextureLoader().load('../data/game_terrain.jpg', () => { S.texReady = true; });
    tex.encoding = THREE.sRGBEncoding; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const det = detailTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: det };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec3 vWPos;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float dd = distance(vWPos, cameraPosition);
          float dm = texture2D(detailMap, vWPos.xz * 0.45).r * 0.55 + texture2D(detailMap, vWPos.xz * 0.07).r * 0.45;
          diffuseColor.rgb *= mix(0.72 + 0.56 * dm, 1.0, smoothstep(25.0, 260.0, dd));`);
    };
    const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; scene.add(mesh); return mesh;
  }
  function detailTexture() {
    const n = 256, cv = document.createElement('canvas'); cv.width = cv.height = n; const ctx = cv.getContext('2d'); const img = ctx.createImageData(n, n);
    const rnd = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let v = 0, a = 0.5, f = 1 / 32;
      for (let o = 0; o < 4; o++) { const X = x * f, Y = y * f, xi = Math.floor(X), yi = Math.floor(Y), tx = X - xi, ty = Y - yi, p = n * f;
        const r00 = rnd(xi % p, yi % p), r10 = rnd((xi + 1) % p, yi % p), r01 = rnd(xi % p, (yi + 1) % p), r11 = rnd((xi + 1) % p, (yi + 1) % p);
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        v += a * lerp(lerp(r00, r10, sx), lerp(r01, r11, sx), sy); a *= 0.5; f *= 2; }
      const g = clamp(v * 255, 0, 255), i = (y * n + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  }

  // ------------------------------------------------------------------------------------------------ models
  const M = {
    suit: new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.78 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xff6a2b, roughness: 0.55 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.6, metalness: 0.3 }),
    visor: new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.12, metalness: 1.0 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.35, metalness: 0.8 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.4, metalness: 0.9 }),
  };
  const shadowAll = (o) => o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  function limb(r, len, mat) { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat); m.position.y = -len / 2 - r * 0.4; g.add(m); return g; }
  function makeAstronaut() {
    const g = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.42, 6, 14), M.suit); torso.position.y = 1.17; g.add(torso);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.08), M.dark); chest.position.set(0, 1.25, 0.25); g.add(chest);
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.02), new THREE.MeshBasicMaterial({ color: 0x4fe3a4 })); light.position.set(0.07, 1.28, 0.3); g.add(light);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.26), M.suit); pack.position.set(0, 1.22, -0.3); g.add(pack);
    const packTop = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.22), M.dark); packTop.position.set(0, 1.56, -0.3); g.add(packTop);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), M.suit); helmet.position.y = 1.7; g.add(helmet);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.19, 24, 16, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.22, Math.PI * 0.5), M.visor);
    visor.position.set(0, 1.7, 0.045); g.add(visor);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 24), M.accent); band.rotation.x = Math.PI / 2; band.position.y = 1.52; g.add(band);
    const parts = {};
    for (const s of [-1, 1]) {
      const arm = limb(0.075, 0.42, M.suit); arm.position.set(0.34 * s, 1.43, 0); g.add(arm); parts[s < 0 ? 'armL' : 'armR'] = arm;
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.06, 12), M.accent); cuff.position.y = -0.45; arm.add(cuff);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), M.dark); glove.position.y = -0.58; arm.add(glove);
      const leg = limb(0.1, 0.5, M.suit); leg.position.set(0.14 * s, 0.9, 0); g.add(leg); parts[s < 0 ? 'legL' : 'legR'] = leg;
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.3), M.dark); boot.position.set(0, -0.78, 0.05); leg.add(boot);
    }
    g.userData.parts = parts; shadowAll(g); return g;
  }
  function makeRover() {
    const g = new THREE.Group();
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.28, 3.4), M.metal); chassis.position.y = 0.8; g.add(chassis);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 3.3), M.dark); deck.position.y = 0.97; g.add(deck);
    for (const s of [-1, 1]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.55), M.suit); seat.position.set(0.45 * s, 1.25, 0.2); g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.12), M.suit); back.position.set(0.45 * s, 1.55, -0.07); g.add(back);
      for (const z of [-1.25, 0, 1.25]) {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.32, 18), M.dark); wh.rotation.z = Math.PI / 2; wh.position.set(1.15 * s, 0.45, z); g.add(wh);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.34, 10), M.accent); hub.rotation.z = Math.PI / 2; hub.position.copy(wh.position); g.add(hub);
      }
      const fender = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 3.5), M.accent); fender.position.set(1.15 * s, 0.95, 0); g.add(fender);
    }
    const console_ = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 0.25), M.dark); console_.position.set(0, 1.25, 0.85); g.add(console_);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 8), M.metal); mast.position.set(-0.8, 1.7, -1.3); g.add(mast);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), M.suit); dish.position.set(-0.8, 2.45, -1.3); dish.rotation.x = -0.6; g.add(dish);
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 0.9), M.suit); cargo.position.set(0, 1.2, -1.15); g.add(cargo);
    shadowAll(g); return g;
  }
  function makeLander() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 4.4, 28), M.suit); body.position.y = 4.4; g.add(body);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.85, 2.85, 0.35, 28), M.accent); ring.position.y = 2.4; g.add(ring);
    const top = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.2, 28), M.suit); top.position.y = 7.7; g.add(top);
    const foil = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.6, 1.2, 28), M.gold); foil.position.y = 1.7; g.add(foil);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4, leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.6, 8), M.metal);
      leg.position.set(Math.cos(a) * 3.0, 1.4, Math.sin(a) * 3.0); leg.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); g.add(leg);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.12, 14), M.metal); pad.position.set(Math.cos(a) * 3.8, 0.06, Math.sin(a) * 3.8); g.add(pad);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.9, 0.2), M.dark); door.position.set(0, 3.9, 2.55); g.add(door);
    const doorRim = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.1, 0.12), M.accent); doorRim.position.set(0, 3.9, 2.5); g.add(doorRim);
    for (let i = 0; i < 6; i++) { const rung = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), M.metal); rung.position.set(0, 0.4 + i * 0.5, 3.0 + i * 0.06); g.add(rung); }
    const ant = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), M.suit); ant.position.set(1.2, 9.0, 0); ant.rotation.z = 0.5; g.add(ant);
    shadowAll(g); return g;
  }
  function label(text, color = '#ffd27a') {
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d'); const f = 44;
    ctx.font = `700 ${f}px Inter, system-ui, sans-serif`; const w = Math.ceil(ctx.measureText(text).width) + 40; cv.width = w; cv.height = f + 28;
    ctx.font = `700 ${f}px Inter, system-ui, sans-serif`; ctx.fillStyle = 'rgba(12,14,20,.72)'; roundRect(ctx, 0, 0, w, cv.height, 18); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 3; roundRect(ctx, 1.5, 1.5, w - 3, cv.height - 3, 16); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(text, 20, cv.height / 2 + 2);
    const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
    sp.scale.set(0.00045 * w, 0.00045 * cv.height, 1); sp.renderOrder = 10; return sp;
  }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function beacon(color) {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 70, 16, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 35; g.add(beam);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.0, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; g.add(ring);
    g.userData = { beam, ring }; return g;
  }

  // ------------------------------------------------------------------------------------------------ world objects
  let terrain, astro, roverObj, landerObj, routeLine, rocks;
  const beacons = {};
  const place = (obj, x, y, dy = 0) => { const p = W(x, y); obj.position.set(p.X, groundY(p.X, p.Z) + dy, p.Z); };
  function buildWorld() {
    terrain = buildTerrain();
    landerObj = makeLander(); place(landerObj, lander.x, lander.y, -0.05); scene.add(landerObj);
    const lab = label('L0 · Lander (airlock)', '#ffffff'); lab.position.y = 12; landerObj.add(lab);
    for (const s of ST.filter((x) => x.kind !== 'lander')) {
      const b = beacon(s.kind === 'depot' ? 0xc77dff : 0xff8c42); place(b, s.x, s.y); scene.add(b); beacons[s.id] = b;
      const lb = label(`${s.id} · ${s.name.split(' —')[0].replace(' (inspection only)', '')}`, s.kind === 'depot' ? '#c77dff' : '#ffb070'); lb.position.y = 9; b.add(lb);
    }
    for (const t of D.depot_tubes?.tubes || []) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.21, 10), M.metal);
      const a = t.tube_azimuth_deg * D2R; tube.rotation.set(0, -a, Math.PI / 2); tube.rotateY(Math.PI / 2);
      place(tube, t.x, t.y, 0.05); scene.add(tube); tube.castShadow = true;
      const mk = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.42, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      mk.rotation.x = -Math.PI / 2; place(mk, t.x, t.y, 0.04); scene.add(mk);
    }
    buildRouteLine(); buildRocks();
    astro = makeAstronaut(); scene.add(astro);
    roverObj = makeRover(); scene.add(roverObj);
    const rl = label('Backup rover', '#6fd3ff'); rl.position.y = 4; roverObj.add(rl);
  }
  function buildRouteLine() {
    if (routeLine) scene.remove(routeLine);
    const r = routeOf(S.theta); if (!r?.feasible) return;
    const pts = r.geometry_xy.map(([x, y]) => { const p = W(x, y); return new THREE.Vector3(p.X, groundY(p.X, p.Z) + 0.25, p.Z); });
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    routeLine = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0xffa04d, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.85 }));
    routeLine.computeLineDistances(); routeLine.visible = S.routeLine; scene.add(routeLine);
  }
  function buildRocks() {
    // Illustrative boulders: the DTM cannot resolve rocks < ~1–2 m, so these are decorative, denser on steeper cells.
    const n = TOUCH ? 7000 : 22000, geo = new THREE.DodecahedronGeometry(1, 0);
    rocks = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x7a4a33, roughness: 0.95 }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const r20 = routeOf(20) || D.routes[0]; const path = r20.geometry_xy; let k = 0, tries = 0;
    while (k < n && tries < n * 6) {
      tries++;
      let x, y;
      if (rnd() < 0.7) { const [px, py] = path[Math.floor(rnd() * path.length)]; x = px + (rnd() - 0.5) * 700; y = py + (rnd() - 0.5) * 700; }
      else { x = AOI.xmin + rnd() * (AOI.xmax - AOI.xmin); y = AOI.ymin + rnd() * (AOI.ymax - AOI.ymin); }
      const [r, c] = rcOf(x, y), sl = gv('slope', r, c); if (sl === null) continue;
      if (rnd() > 0.25 + sl / 18) continue;
      if (Math.hypot(x - lander.x, y - lander.y) < 14 || ST.some((st) => Math.hypot(x - st.x, y - st.y) < 6)) continue;
      const sz = 0.07 + Math.pow(rnd(), 3) * 0.9; const w = W(x, y);
      p.set(w.X, groundY(w.X, w.Z) + sz * 0.25, w.Z); e.set(rnd() * 3, rnd() * 3, rnd() * 3); q.setFromEuler(e); s.set(sz * (0.8 + rnd() * 0.6), sz * (0.5 + rnd() * 0.3), sz * (0.8 + rnd() * 0.6));
      m.compose(p, q, s); rocks.setMatrixAt(k, m); col.setHSL(0.055 + rnd() * 0.02, 0.45, 0.2 + rnd() * 0.12); rocks.setColorAt(k, col); k++;
    }
    rocks.count = k; rocks.castShadow = true; rocks.receiveShadow = true; scene.add(rocks);
  }

  // ------------------------------------------------------------------------------------------------ player
  const P = { X: 0, Z: 0, Y: 0, vy: 0, yaw: 0, camYaw: 0, camPitch: -0.18, camDist: 7, onGround: true, phase: 0, speed: 0, run: false,
    rover: { X: 0, Z: 0, yaw: 0, v: 0 }, upDeg: 0, blocked: false, edge: false };
  const keys = new Set(); const joy = { x: 0, y: 0, active: false };
  function resetPlayer() {
    const doorDir = 0; // lander door faces +Z (south of the lander in world terms)
    P.X = 0; P.Z = 7.5; P.Y = groundY(P.X, P.Z); P.vy = 0;
    // face the first objective so the chase camera starts outside the lander
    const first = ST.find((s) => s.id === nextObj()); const p0 = Lc(P.X, P.Z);
    const brg = Math.atan2(first.x - p0.x, first.y - p0.y); P.yaw = P.camYaw = -brg; P.camPitch = -0.12;
    const park = S.rover ? roverPark(S.theta) : null;
    if (park) { const w = W(park.park_xy[0] + 8, park.park_xy[1] + 6); P.rover.X = w.X; P.rover.Z = w.Z; P.rover.yaw = 0.6; roverObj.visible = true; }
    else { roverObj.visible = false; }
    void doorDir;
  }

  // ------------------------------------------------------------------------------------------------ input
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    if (!S.playing) return;
    if ($('#mapview').classList.contains('hidden') === false) { if (k === 'm' || k === 'escape') toggleMap(false); return; }
    if (!$('#modal').classList.contains('hidden')) { if (k === 'escape' || k === 'enter') { closeModal(); if (S.paused) setPaused(false); } return; }
    keys.add(k);
    if (k === ' ') { e.preventDefault(); jump(); }
    if (k === 'e') interact();
    if (k === 'v') toggleView();
    if (k === 'm') toggleMap(true);
    if (k === 'h') showHelp();
    if (k === 'p' || k === 'escape') setPaused(!S.paused);
    if (k === 't') cycleSpeed();
    if (k === 'r') { S.routeLine = !S.routeLine; if (routeLine) routeLine.visible = S.routeLine; flash(S.routeLine ? 'Route guide on' : 'Route guide off', 'info'); }
    if (k === 'l') { S.headlamp = !S.headlamp; flash(S.headlamp ? 'Helmet lights on' : 'Helmet lights off', 'info'); }
    if (k === 'shift') P.run = true;
  });
  addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); keys.delete(k); if (k === 'shift') P.run = false; });
  // mouse look
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!S.playing || S.paused) return;
    if (S.view === 'fp' && !TOUCH && document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
    if (TOUCH && e.pointerType === 'touch' && joy.active && e.pointerId === joy.id) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (document.pointerLockElement === canvas) { look(e.movementX, e.movementY); return; }
    if (drag && e.pointerId === drag.id) { look(e.clientX - drag.x, e.clientY - drag.y, 2.2); drag.x = e.clientX; drag.y = e.clientY; }
  });
  canvas.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.id) drag = null; });
  canvas.addEventListener('wheel', (e) => { if (S.view === 'tp') P.camDist = clamp(P.camDist * (e.deltaY > 0 ? 1.12 : 0.89), 3, 40); }, { passive: true });
  function look(dx, dy, k = 1) { P.camYaw -= dx * 0.0024 * k; P.camPitch = clamp(P.camPitch - dy * 0.0022 * k, S.view === 'fp' ? -1.35 : -1.2, S.view === 'fp' ? 1.2 : 0.35); }
  // joystick
  const stick = $('#stick'), knob = $('#knob');
  stick.addEventListener('pointerdown', (e) => { joy.active = true; joy.id = e.pointerId; try { stick.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ } moveJoy(e); });
  stick.addEventListener('pointermove', (e) => { if (joy.active && e.pointerId === joy.id) moveJoy(e); });
  const endJoy = () => { joy.active = false; joy.x = joy.y = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', endJoy); stick.addEventListener('pointercancel', endJoy);
  function moveJoy(e) {
    const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
    let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    joy.x = dx; joy.y = -dy; knob.style.transform = `translate(${dx * 40}px, ${-joy.y * 40}px)`;
  }
  const hold = (id, on, off) => { const b = $(id); b.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); }); if (off) { b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); } };
  hold('#t-jump', () => jump());
  hold('#t-run', () => { P.run = !P.run; $('#t-run').classList.toggle('on', P.run); });
  hold('#t-act', () => interact());
  $('#b-map').onclick = () => toggleMap(true);
  $('#b-view').onclick = () => toggleView();
  $('#b-help').onclick = () => showHelp();
  $('#b-pause').onclick = () => setPaused(!S.paused);
  $('#h-speed').onclick = () => cycleSpeed();
  function cycleSpeed() { const o = [1, 10, 30, 60]; S.speed = o[(o.indexOf(S.speed) + 1) % o.length]; $('#h-speed').textContent = `×${S.speed}`; flash(`Time ×${S.speed}`, 'info'); }
  function toggleView() {
    S.view = S.view === 'tp' ? 'fp' : 'tp'; document.body.classList.toggle('fp', S.view === 'fp');
    if (S.view === 'tp' && document.pointerLockElement) document.exitPointerLock();
    flash(S.view === 'fp' ? 'First person — click to look around (Esc releases the mouse)' : 'Third person — drag to orbit, scroll to zoom', 'info');
  }
  function jump() { if (S.mode !== 'walk' || !P.onGround || S.paused) return; P.vy = 2.3; P.onGround = false; S.lastJumpW = 1.0; }

  // ------------------------------------------------------------------------------------------------ simulation
  const clock = new THREE.Clock();
  let hudT = 0, mapT = 0;
  const flashes = [];
  function flash(text, kind = 'warn', secs = 3) { flashes.push({ text, kind, until: performance.now() + secs * 1000 }); }
  function state() { return M24.at(new Date(S.sim)); }
  const sunCache = {};
  function sunTimes() { const sol = M24.at(new Date(S.sim)).sol; return sunCache[sol] || (sunCache[sol] = M24.sunTimes(new Date(S.sim))); }
  function haven(X, Z) {
    const p = Lc(X, Z); let [r, c] = rcOf(p.x, p.y);
    const kp = S.rover && D.rover ? `haven_phys_${S.theta}` : `walkback_phys_${S.theta}`;
    let best = null;
    for (let d = 0; d <= 4 && !best; d++) for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) {
      const v = gv(kp, r + dr * 2, c + dc * 2); if (v !== null && (!best || v < best.phys)) best = { phys: v + d * 2 * CELL };
    }
    return best;
  }
  function airTemp(st) { return medaAt('T', st.lmst) ?? 210; }

  function step(dt) {
    const st = state();
    const dh = (dt * S.speed) / 3600;                 // simulated hours this frame
    S.sim += dt * S.speed * 1000;
    // ---- movement
    let mx = 0, mz = 0;
    if (keys.has('w') || keys.has('arrowup')) mz += 1;
    if (keys.has('s') || keys.has('arrowdown')) mz -= 1;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
    if (keys.has('d') || keys.has('arrowright')) mx += 1;
    if (joy.active) { mx += joy.x; mz += joy.y; }
    const mag = Math.min(1, Math.hypot(mx, mz));
    let W_met = 140;
    if (S.mode === 'walk') {
      let vx = 0, vz = 0;
      P.blocked = false;
      if (mag > 0.05) {
        // direction relative to camera yaw; world: heading h -> (sin h, -cos h)
        const ang = P.camYaw - Math.atan2(mx, mz);
        const dx = -Math.sin(ang), dz = -Math.cos(ang);
        const base = (P.run ? 2.2 : 1.15) * mag;
        const ahead = groundY(P.X + dx * 2, P.Z + dz * 2) - groundY(P.X, P.Z);
        P.upDeg = Math.atan2(ahead, 2) / D2R;
        let f = paceKmh(Math.max(0, P.upDeg)) / 2.7;
        if (P.upDeg > S.theta + 2) { f = 0; P.blocked = true; }
        else if (P.upDeg < -(S.theta + 4)) f *= 0.55;
        if (S.res.h2o <= 0) f *= 0.5;
        vx = dx * base * f; vz = dz * base * f;
        const tYaw = Math.atan2(-dx, -dz);
        P.yaw = S.view === 'fp' ? P.camYaw : angLerp(P.yaw, tYaw, 1 - Math.exp(-dt * 10));
      } else P.upDeg = 0;
      const nx = clamp(P.X + vx * dt, AOI.xmin - CX + 15, AOI.xmax - CX - 15), nz = clamp(P.Z + vz * dt, -(AOI.ymax - CY) + 15, -(AOI.ymin - CY) - 15);
      P.edge = nx !== P.X + vx * dt || nz !== P.Z + vz * dt;
      const moved = Math.hypot(nx - P.X, nz - P.Z); S.walked += moved; P.X = nx; P.Z = nz;
      P.speed = moved / Math.max(dt, 1e-6);
      // vertical (Mars g = 3.721 m/s²)
      const gy = groundY(P.X, P.Z);
      P.vy -= 3.721 * dt; P.Y += P.vy * dt;
      if (P.Y <= gy) { if (!P.onGround && P.vy < -3.6) { S.res.integ = Math.max(0, S.res.integ - 0.06); flash('Hard landing — suit seal damaged, small leak', 'bad'); }
        P.Y = gy; P.vy = 0; P.onGround = true; }
      if (P.onGround && P.Y > gy + 0.05 && P.vy === 0) P.Y = gy;
      if (P.onGround) P.Y = gy;
      W_met = 140 + 170 * (P.speed / 1.15) + 14 * Math.max(0, P.upDeg) * (P.speed / 1.15) + S.lastJumpW * 380;
      S.lastJumpW = Math.max(0, S.lastJumpW - dt * 2);
      P.phase += P.speed * dt * 3.0;
    } else {
      // rover driving: W/S throttle, A/D steer
      const R = P.rover; const thr = (mz > 0 ? 1 : mz < 0 ? -0.6 : 0) * Math.max(mag, Math.abs(mz)); const steerIn = -mx;
      R.v = lerp(R.v, thr * 4.2, 1 - Math.exp(-dt * 1.5));
      R.yaw += steerIn * dt * 0.9 * clamp(R.v / 2, -1, 1);
      const dx = -Math.sin(R.yaw), dz = -Math.cos(R.yaw);
      const ahead = groundY(R.X + dx * 3 * Math.sign(R.v || 1), R.Z + dz * 3 * Math.sign(R.v || 1)) - groundY(R.X, R.Z);
      P.upDeg = Math.atan2(ahead, 3) / D2R; P.blocked = P.upDeg > 25;
      if (!P.blocked) {
        const nx = clamp(R.X + dx * R.v * dt, AOI.xmin - CX + 15, AOI.xmax - CX - 15), nz = clamp(R.Z + dz * R.v * dt, -(AOI.ymax - CY) + 15, -(AOI.ymin - CY) - 15);
        S.walked += Math.hypot(nx - R.X, nz - R.Z); R.X = nx; R.Z = nz;
      } else R.v = 0;
      P.speed = Math.abs(R.v); P.X = R.X; P.Z = R.Z; P.Y = groundY(R.X, R.Z) + 0.85; P.yaw = R.yaw; W_met = 125;
      // rover carries spare consumables (game assumption): recharge while seated
      for (const k of ['o2', 'co2', 'pwr', 'h2o']) S.res[k] = Math.min(1, S.res[k] + dh * 1.6);
    }
    // ---- life support
    const T = airTemp(st), leak = (1 - S.res.integ) * 1.5, sunUp = st.elev > 0;
    S.wAvg = lerp(S.wAvg, W_met, 1 - Math.exp(-dt * S.speed / 600));
    S.hr = lerp(S.hr, 62 + W_met / 4.2, 1 - Math.exp(-dt * 0.8));
    const heater = Math.max(0, 245 - T) * 0.9 + (S.headlamp || !sunUp ? 8 : 0);
    S.res.o2 -= (W_met * (1 + leak) * dh) / CAP.o2;
    S.res.co2 -= (W_met * dh) / CAP.co2;
    S.res.pwr -= ((55 + 0.08 * W_met + heater) * dh) / CAP.pwr;
    S.res.h2o -= (Math.max(30, W_met + (sunUp ? 60 * Math.sin(st.elev * D2R) : 0) - Math.max(0, 250 - T) * 0.8) * dh) / CAP.h2o;
    const cme = cmeNear(S.sim).length > 0;
    S.res.dose += (0.64 / 24) * (cme ? 3 : 1) * dh;
    for (const k of ['o2', 'co2', 'pwr', 'h2o']) S.res[k] = clamp(S.res[k], 0, 1);
    if (S.res.o2 <= 0 || S.res.co2 <= 0) return endGame(false, S.res.o2 <= 0 ? 'Oxygen exhausted before reaching a safe haven.' : 'CO₂ scrubber saturated before reaching a safe haven.');
    if (S.res.pwr <= 0) return endGame(false, 'Suit power depleted: no heating, fans or radio.');
    // trail for the map
    if (!S.trail.length || Math.hypot(S.trail.at(-1)[0] - P.X, S.trail.at(-1)[1] - P.Z) > 6) S.trail.push([P.X, P.Z]);
  }
  const angLerp = (a, b, t) => { let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

  // ------------------------------------------------------------------------------------------------ predictions & verdict
  function predict() {
    const st = state(), h = haven(P.X, P.Z), leak = (1 - S.res.integ) * 1.5;
    const etaH = h ? h.phys / 1000 / 2.4 + 0.25 : null;                 // average pace 2.4 km/h + 15 min airlock (ASSUMPTION)
    const o2H = (S.res.o2 * CAP.o2) / (300 * (1 + leak));
    const co2H = (S.res.co2 * CAP.co2) / 300;
    const lifeH = Math.min(o2H, co2H);
    const margin = etaH === null ? null : lifeH - etaH - 0.5;              // 30 min reserve
    const sun = sunTimes();
    let toSunset = sun.sunsetLtst !== null ? sun.sunsetLtst - st.ltst : null; if (toSunset !== null && toSunset < -6) toSunset += 24;
    const evaH = S.evaStart ? (S.sim - S.evaStart) / 3600e3 : 0;
    const issues = [];
    let level = 'go';
    const bump = (l, t) => { issues.push([l, t]); if (l === 'nogo') level = 'nogo'; else if (l === 'cond' && level === 'go') level = 'cond'; };
    if (margin !== null && margin < 0) bump('nogo', `Return margin ${hm(margin)}: life support may run out before you reach ${S.rover ? 'the lander or rover' : 'the lander'}.`);
    else if (margin !== null && margin < 0.75) bump('cond', `Return margin only ${hm(margin)}. Head home soon.`);
    if (toSunset !== null && etaH !== null && toSunset - etaH < 0) bump('nogo', `Arrival home would be after sunset (${M24.fmtH(sun.sunsetLtst)} LTST).`);
    else if (toSunset !== null && etaH !== null && toSunset - etaH < 1) bump('cond', `Less than 1 h of daylight to spare on the way home.`);
    if (evaH + (etaH || 0) > 8) bump('cond', 'Total EVA would exceed the 8 h suit requirement.');
    if (cmeNear(S.sim).length) bump('cond', 'A CME is predicted to reach Mars within 24 h (NASA DONKI): limit time outside.');
    if (st.dustSeason) bump('cond', 'Dust-storm season (Ls 180–360°).');
    if (S.res.integ < 0.999) bump('cond', `Suit leak: pressure ${fmt(4.3 * (0.5 + 0.5 * S.res.integ), 2)} psi, extra O₂ use.`);
    if (S.res.h2o < 0.15) bump('cond', 'Cooling water low: slow down to avoid overheating.');
    if (S.res.pwr < 0.2) bump('cond', 'Suit power low.');
    if (!h) bump('cond', 'Standing on ground with no mapped way home at this slope limit. Move to gentler terrain.');
    return { st, h, etaH, o2H, co2H, lifeH, margin, sun, toSunset, evaH, issues, level };
  }

  // ------------------------------------------------------------------------------------------------ objectives & interaction
  const order = () => (routeOf(S.theta)?.station_order || ST.map((s) => s.id)).filter((id, i, a) => id !== lander.id || i === a.length - 1);
  const nextObj = () => order().find((id) => id !== lander.id && !S.done.has(id)) || lander.id;
  function nearest() {
    const p = Lc(P.X, P.Z); const out = [];
    for (const s of ST) {
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (s.kind === 'station' && d < 20 && !S.done.has(s.id)) out.push({ d, kind: 'station', s, text: `Document ${s.id} · ${s.name.split(' —')[0]}` });
      if (s.kind === 'depot' && d < 30 && !S.done.has(s.id)) out.push({ d, kind: 'depot', s, text: 'Inspect the sample tubes at the depot' });
      if (s.kind === 'lander' && d < 10) out.push({ d, kind: 'airlock', s, text: 'Enter the lander airlock (end EVA)' });
    }
    if (roverObj.visible) {
      const d = Math.hypot(P.X - P.rover.X, P.Z - P.rover.Z);
      if (S.mode === 'drive') out.push({ d: 0, kind: 'exit', text: 'Get out of the rover' });
      else if (d < 4.5) out.push({ d, kind: 'rover', text: 'Board the rover (recharge & drive)' });
    }
    return out.sort((a, b) => a.d - b.d)[0] || null;
  }
  function interact() {
    if (!S.playing || S.paused) return;
    const n = nearest(); if (!n) { flash('Nothing to use here', 'info', 1.5); return; }
    if (n.kind === 'station' || n.kind === 'depot') return document_(n.s);
    if (n.kind === 'airlock') return confirmAirlock();
    if (n.kind === 'rover') { S.mode = 'drive'; P.rover.v = 0; flash('Driving: W/S throttle · A/D steer · E to get out. Consumables recharge while seated.', 'info', 5); return; }
    if (n.kind === 'exit') { S.mode = 'walk'; const R = P.rover; P.X = R.X + Math.cos(R.yaw) * 2.2; P.Z = R.Z - Math.sin(R.yaw) * 2.2; P.Y = groundY(P.X, P.Z); flash('On foot', 'info'); }
  }
  function document_(s) {
    const mins = s.kind === 'depot' ? 30 : 25;
    // time passes while working (light work, 220 W)
    const dh = mins / 60; S.sim += mins * 60e3;
    S.res.o2 -= (220 * (1 + (1 - S.res.integ) * 1.5) * dh) / CAP.o2; S.res.co2 -= (220 * dh) / CAP.co2; S.res.pwr -= (90 * dh) / CAP.pwr; S.res.h2o -= (220 * dh) / CAP.h2o;
    S.done.add(s.id); S.score += s.kind === 'depot' ? 150 : 100;
    beacons[s.id].userData.beam.material.color.set(0x4fe3a4); beacons[s.id].userData.ring.material.color.set(0x4fe3a4);
    const pov = D.pov?.[s.id];
    let body;
    if (s.kind === 'depot') {
      body = `<div class="kicker">Task complete · ${mins} min</div><h2>Three Forks sample depot</h2>
        <p>${esc(s.note)}</p>
        <div class="grid2">${(D.depot_tubes?.tubes || []).map((t) => `<div class="sci-card done"><b>${esc(t.name)}</b><br><span class="note">${esc(t.designation)} · dropped sol ${t.drop_sol} · azimuth ${t.tube_azimuth_deg}°</span></div>`).join('')}</div>
        ${pov ? `<img src="../data/${esc(pov.file)}" alt="Perseverance view at the depot"><div class="note">Perseverance ${esc(pov.camera.replace('_LEFT', ''))}, sol ${pov.sol} · ${esc(pov.credit)}</div>` : ''}
        <p class="note">Tube positions: NASA PDS Three Forks depot bundle (rover position at each drop).</p>`;
    } else {
      const nasem = (s.nasem || []).map((k) => `${k}. ${esc((D.manifest.nasem_objectives || {})[k] || '')}`).join('<br>');
      body = `<div class="kicker">Outcrop documented · ${mins} min</div><h2>${esc(s.name)}</h2>
        <p><b>Rock:</b> ${esc(s.rock)}<br><b>Unit:</b> ${esc(s.formation)}<br><b>Perseverance sample:</b> ${esc(s.sample)}</p>
        <p>${esc(s.rationale)}</p><p><b>Your task:</b> ${esc(s.task)}</p>
        ${pov ? `<img src="../data/${esc(pov.file)}" alt="Perseverance view of this outcrop"><div class="note">What Perseverance saw here: ${esc(pov.camera.replace('_LEFT', ''))}, sol ${pov.sol} · ${esc(pov.credit)}</div>` : ''}
        <p class="note"><b>NASEM objectives:</b><br>${nasem}</p>`;
    }
    openModal(body, [['Continue EVA', closeModal, true]]);
  }
  function confirmAirlock() {
    const left = order().filter((id) => id !== lander.id && !S.done.has(id));
    if (!left.length) return endGame(true, 'All stops documented and the crew is back inside the lander.');
    openModal(`<h2>End the EVA now?</h2><p>${left.length} objective(s) not yet done: ${left.map(esc).join(', ')}.</p><p class="note">Coming home early with a healthy margin is a safe call, not a failure.</p>`,
      [['Enter airlock', () => { closeModal(); endGame(true, `Returned safely with ${left.length} objective(s) left.`); }, true], ['Keep exploring', closeModal]]);
  }
  function endGame(success, why) {
    if (S.over) return; S.over = true; S.playing = false; if (document.pointerLockElement) document.exitPointerLock();
    const pr = predict();
    const bonus = success ? Math.round(clamp(pr.lifeH, 0, 4) * 50) : 0;
    const total = S.score + bonus;
    openModal(`<div class="kicker">${success ? 'EVA complete' : 'EVA failed'}</div><h2>${success ? 'Welcome back' : 'Mission lost'}</h2><p>${esc(why)}</p>
      <dl class="kv"><dt>Science documented</dt><dd>${S.done.size} of ${order().length - 1}</dd><dt>Time outside</dt><dd>${hm(pr.evaH)}</dd>
      <dt>Distance travelled</dt><dd>${fmt(S.walked / 1000, 2)} km</dd><dt>O₂ left</dt><dd>${fmt(S.res.o2 * 100)} %</dd>
      <dt>Radiation dose (model)</dt><dd>${fmt(S.res.dose, 3)} mSv</dd><dt>Science points</dt><dd>${S.score}</dd><dt>Safety bonus</dt><dd>${bonus}</dd><dt><b>Total</b></dt><dd><b>${total}</b></dd></dl>
      <p class="note">Real crews plan with large reserves: the best score comes from documenting every stop <i>and</i> coming home with life support to spare.</p>`,
      [['Play again', () => location.reload(), true], ['Open planner', () => { location.href = '../'; }]]);
  }

  // ------------------------------------------------------------------------------------------------ camera & visuals per frame
  const tmpV = new THREE.Vector3();
  function updateVisuals(dt) {
    const st = state();
    const el = st.elev * D2R, az = st.az * D2R;
    const sd = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const day = clamp((st.elev + 6) / 16, 0, 1);
    skyU.sunDir.value.copy(sd); skyU.day.value = 0.06 + 0.94 * day;
    stars.material.opacity = clamp(1 - day * 1.6, 0, 0.9);
    sun.intensity = clamp(Math.sin(el) * 3, 0, 1) * 1.7;
    hemi.intensity = 0.06 + 0.42 * day;
    const fogC = new THREE.Color(0.86, 0.66, 0.48).multiplyScalar(0.07 + 0.93 * day);
    scene.fog.color.copy(fogC);
    const dust = st.dustSeason ? 0.6 : 1; scene.fog.near = 300 * dust; scene.fog.far = 4200 * dust;
    sun.position.set(P.X + sd.x * 200, P.Y + Math.max(sd.y, 0.05) * 200, P.Z + sd.z * 200); sun.target.position.set(P.X, P.Y, P.Z);
    // astronaut pose
    astro.visible = !(S.view === 'fp' && S.mode === 'walk');
    if (S.mode === 'walk') { astro.position.set(P.X, P.Y, P.Z); astro.rotation.set(0, P.yaw + Math.PI, 0); }
    else { const R = P.rover; tmpV.set(0.45, 0.95, 0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), R.yaw); astro.position.set(R.X + tmpV.x, groundY(R.X, R.Z) + 0.55, R.Z + tmpV.z); astro.rotation.set(0, R.yaw + Math.PI, 0); }
    const pa = astro.userData.parts, sw = S.mode === 'walk' ? Math.sin(P.phase) * Math.min(1, P.speed / 1.2) : 0;
    pa.legL.rotation.x = sw * 0.6; pa.legR.rotation.x = -sw * 0.6; pa.armL.rotation.x = -sw * 0.45; pa.armR.rotation.x = sw * 0.45;
    if (S.mode === 'drive') { pa.legL.rotation.x = pa.legR.rotation.x = -1.4; pa.armL.rotation.x = pa.armR.rotation.x = -0.9; }
    if (!P.onGround) { pa.legL.rotation.x = -0.5; pa.legR.rotation.x = -0.2; }
    // rover pose: align with terrain
    if (roverObj.visible) {
      const R = P.rover, f = new THREE.Vector3(-Math.sin(R.yaw), 0, -Math.cos(R.yaw)), r = new THREE.Vector3(Math.cos(R.yaw), 0, -Math.sin(R.yaw));
      const hF = groundY(R.X + f.x * 1.4, R.Z + f.z * 1.4), hB = groundY(R.X - f.x * 1.4, R.Z - f.z * 1.4), hR = groundY(R.X + r.x, R.Z + r.z), hL = groundY(R.X - r.x, R.Z - r.z);
      f.y = (hF - hB) / 2.8; f.normalize(); r.y = (hR - hL) / 2; r.normalize(); const up = new THREE.Vector3().crossVectors(r, f).normalize();
      const back = f.clone().negate(); const m = new THREE.Matrix4().makeBasis(r, up, back);
      roverObj.quaternion.setFromRotationMatrix(m); roverObj.position.set(R.X, (hF + hB + hR + hL) / 4, R.Z);
      roverObj.rotateY(Math.PI);
    }
    // beacons pulse
    const t = performance.now() / 1000;
    for (const [id, b] of Object.entries(beacons)) { b.userData.beam.material.opacity = (S.done.has(id) ? 0.1 : 0.16) + 0.08 * Math.sin(t * 2 + id.length); b.userData.ring.rotation.z = t * 0.3; }
    // camera
    const head = new THREE.Vector3(P.X, P.Y + (S.mode === 'drive' ? 1.1 : 1.68), P.Z);
    if (S.view === 'fp') {
      const yaw = S.mode === 'drive' ? P.rover.yaw + P.camYaw - P.yaw : P.camYaw;
      camera.position.copy(head).add(new THREE.Vector3(-Math.sin(yaw) * 0.18, 0, -Math.cos(yaw) * 0.18));
      const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(P.camPitch), Math.sin(P.camPitch), -Math.cos(yaw) * Math.cos(P.camPitch));
      camera.lookAt(camera.position.clone().add(dir));
      if (S.mode === 'walk' && P.speed > 0.1) camera.position.y += Math.abs(Math.sin(P.phase)) * 0.04;
    } else {
      const yaw = P.camYaw, pitch = P.camPitch, d = S.mode === 'drive' ? Math.max(P.camDist, 9) : P.camDist;
      const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch) * d, -Math.sin(pitch) * d + 0.6, Math.cos(yaw) * Math.cos(pitch) * d);
      const want = head.clone().add(off);
      const gmin = groundY(want.x, want.z) + 0.6; if (want.y < gmin) want.y = gmin;
      camera.position.lerp(want, 1 - Math.exp(-dt * 12)); camera.lookAt(head);
    }
    // helmet lamp at night or on demand
    const lampOn = S.headlamp || st.elev < 2;
    lamp.intensity = lampOn ? 2.2 : 0;
    lamp.position.copy(head); const ld = new THREE.Vector3(); camera.getWorldDirection(ld); lamp.target.position.copy(head).add(ld.multiplyScalar(10));
  }

  // ------------------------------------------------------------------------------------------------ HUD
  function updateHUD() {
    const pr = predict(), st = pr.st;
    $('#h-ltst').textContent = M24.fmtH(st.ltst);
    $('#h-sol').textContent = `Sol ${st.sol}`;
    $('#h-eva').textContent = `EVA ${hm(pr.evaH).replace(' h ', ':').replace(' min', '')}`;
    $('#h-sun').textContent = st.elev > 0 ? `☀ ${fmt(st.elev)}° · sunset ${M24.fmtH(pr.sun.sunsetLtst)}` : `☾ night · sunrise ${M24.fmtH(pr.sun.sunriseLtst)}`;
    // resources
    const pct = (v) => Math.round(v * 100);
    const lvl = (v, warn = 0.35, bad = 0.15) => v <= bad ? 'bad' : v <= warn ? 'warn' : '';
    const rate = S.wAvg;
    const left = { o2: (S.res.o2 * CAP.o2) / (rate * (1 + (1 - S.res.integ) * 1.5)), co2: (S.res.co2 * CAP.co2) / rate };
    const T = airTemp(st), sunUp = st.elev > 0;
    left.pwr = (S.res.pwr * CAP.pwr) / (55 + 0.08 * rate + Math.max(0, 245 - T) * 0.9 + (S.headlamp || !sunUp ? 8 : 0));
    left.h2o = (S.res.h2o * CAP.h2o) / Math.max(30, rate + (sunUp ? 60 * Math.sin(st.elev * D2R) : 0) - Math.max(0, 250 - T) * 0.8);
    const row = (k, val, sub, cls) => `<div class="res ${cls}" title="${esc(RES_INFO[k][1])}"><div class="res-h"><b>${RES_INFO[k][0]}</b><small>${sub}</small></div><div class="bar"><i style="width:${clamp(val, 0, 100)}%"></i></div></div>`;
    $('#res').innerHTML = `<h4>Life support</h4>`
      + row('o2', pct(S.res.o2), `${pct(S.res.o2)}% · ${hm(left.o2)}`, lvl(S.res.o2))
      + row('co2', pct(S.res.co2), `${pct(S.res.co2)}% · ${hm(left.co2)}`, lvl(S.res.co2))
      + row('pwr', pct(S.res.pwr), `${pct(S.res.pwr)}% · ${hm(left.pwr)}`, lvl(S.res.pwr))
      + row('h2o', pct(S.res.h2o), `${pct(S.res.h2o)}% · ${hm(left.h2o)}`, lvl(S.res.h2o, 0.25, 0.1))
      + row('integ', pct(S.res.integ), `${fmt(4.3 * (0.5 + 0.5 * S.res.integ), 2)} psi`, S.res.integ < 0.999 ? 'bad' : '')
      + row('dose', clamp(S.res.dose / 0.64 * 100, 0, 100), `${fmt(S.res.dose, 3)} mSv`, cmeNear(S.sim).length ? 'warn' : 'info')
      + `<div class="res-h extra" style="margin-top:6px"><b>Heart rate</b><small>${fmt(S.hr)} bpm · ${fmt(S.wAvg)} W</small></div>
         <div class="res-h extra"><b>Outside</b><small>${fmt(T - 273.15)} °C · ${fmt(medaAt('P', st.lmst) ?? NaN)} Pa</small></div>`;
    // objectives
    const nx = nextObj();
    $('#objectives').innerHTML = order().map((id) => { const s = ST.find((x) => x.id === id); const done = S.done.has(id); const short = id === lander.id ? 'Return to the lander airlock' : `${id} · ${s.name.split(' —')[0].replace(' (inspection only)', '')}`;
      return `<li class="${done ? 'done' : id === nx ? 'next' : ''}">${esc(short)}</li>`; }).join('');
    $('#h-score').textContent = S.score;
    // status
    const m = pr.margin; S.minMargin = Math.min(S.minMargin, m ?? Infinity);
    const mEl = $('#h-margin'); mEl.textContent = m === null ? '—' : (m >= 0 ? '+' : '') + hm(m); mEl.style.color = m === null ? '' : m < 0 ? 'var(--bad)' : m < 0.75 ? 'var(--warn)' : 'var(--ok)';
    $('#h-home').textContent = pr.h ? `${fmt(pr.h.phys / 1000, 2)} km · ${hm(pr.etaH)}` : 'no path';
    const p = Lc(P.X, P.Z), [r, c] = rcOf(p.x, p.y), sl = gv('slope', r, c), pv = gv('provenance', r, c);
    const sEl = $('#h-slope'); sEl.textContent = sl === null ? '—' : `${fmt(sl, 1)}°`; sEl.style.color = sl !== null && sl > S.theta ? 'var(--bad)' : sl !== null && sl > S.theta - 5 ? 'var(--warn)' : '';
    $('#h-speedv').textContent = `${fmt(P.speed * 3.6, 1)} km/h`;
    $('#h-src').textContent = pv === 1 ? 'HiRISE 1 m' : pv === 2 ? 'CTX 20 m' : 'none';
    // target / compass
    let tx, ty, tname;
    if (S.waypoint) { tx = S.waypoint.x; ty = S.waypoint.y; tname = 'Waypoint'; }
    else { const s = ST.find((x) => x.id === (m !== null && m < 0.5 ? lander.id : nx)); tx = s.x; ty = s.y; tname = m !== null && m < 0.5 ? 'Head home: lander' : s.id; }
    const brg = ((Math.atan2(tx - p.x, ty - p.y) / D2R) + 360) % 360, dist = Math.hypot(tx - p.x, ty - p.y);
    const heading = (((-(S.view === 'fp' ? P.camYaw : (S.mode === 'drive' ? P.rover.yaw : P.camYaw))) / D2R) % 360 + 360) % 360;
    drawTape(heading, brg);
    $('#h-target').textContent = `${tname} · ${fmt(dist)} m · ${fmt(brg)}°`;
    // prompt
    const n = nearest();
    $('#prompt').classList.toggle('hidden', !n);
    if (n) $('#prompt').innerHTML = `<kbd>${TOUCH ? 'Use' : 'E'}</kbd>${esc(n.text)}`;
    // alerts
    const al = [];
    if (P.blocked) al.push(['bad', S.mode === 'drive' ? 'Too steep for the rover (>25°)' : `Too steep for the suit (>${S.theta}° limit)`]);
    if (P.edge) al.push(['warn', 'Edge of the mapped area']);
    if (m !== null && m < 0) al.push(['bad', 'PAST POINT OF NO RETURN — head for the nearest safe haven now']);
    else if (m !== null && m < 0.75) al.push(['warn', `Return margin ${hm(m)} — consider heading home`]);
    if (S.res.o2 < 0.15) al.push(['bad', 'Oxygen critical']);
    if (S.res.integ < 0.999) al.push(['bad', 'Suit leak detected']);
    if (st.elev < 0) al.push(['warn', 'Night: −' + fmt(Math.abs(T - 273.15)) + ' °C, heaters drawing extra power']);
    if (cmeNear(S.sim).length) al.push(['warn', 'Space weather: CME arriving at Mars within 24 h']);
    if (S.updateReady) al.push(['info', 'A newer version is ready — reload the page when convenient']);
    const now = performance.now(); for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].until < now) flashes.splice(i, 1);
    for (const f of flashes.slice(-2)) al.push([f.kind, f.text]);
    $('#alerts').innerHTML = al.slice(0, 4).map(([k, t]) => `<div class="alert ${k === 'bad' ? '' : k}">${esc(t)}</div>`).join('');
  }
  function drawTape(heading, brg) {
    const tape = $('#tape'), w = $('.hud-compass').clientWidth, pxPerDeg = w / 120;
    if (!tape.dataset.built) {
      let h = '';
      for (let d = -360; d <= 720; d += 15) { const v = ((d % 360) + 360) % 360; const lbl = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[v];
        h += lbl ? `<span class="card" style="left:${d * pxPerDeg}px">${lbl}</span>` : d % 45 === 0 ? `<span style="left:${d * pxPerDeg}px">${v}</span>` : `<i style="left:${d * pxPerDeg}px"></i>`; }
      h += '<b class="obj" id="tape-obj">▼</b>'; tape.innerHTML = h; tape.dataset.built = '1';
    }
    tape.style.transform = `translateX(${w / 2 - heading * pxPerDeg}px)`;
    let rel = brg; if (rel - heading > 180) rel -= 360; if (heading - rel > 180) rel += 360;
    $('#tape-obj').style.left = `${rel * pxPerDeg}px`;
  }

  // ------------------------------------------------------------------------------------------------ map & data overlay
  const mapCv = $('#map'), mctx = mapCv.getContext('2d');
  const ortho = new Image(); ortho.src = '../data/hirise_ortho_1m.jpg';
  const MV = { s: 1, ox: 0, oy: 0, tab: 'pred', layers: { safe: true, route: true, steep: false, track: true } };
  let safeCanvas = null, safeKey = '';
  function toggleMap(open) {
    $('#mapview').classList.toggle('hidden', !open);
    if (open) { if (document.pointerLockElement) document.exitPointerLock(); S.mapPaused = true; sizeMap(); centerMap(); renderTab(); drawMap(); }
    else { S.mapPaused = false; clock.getDelta(); }
  }
  $('#m-close').onclick = () => toggleMap(false);
  $('#m-center').onclick = () => { centerMap(); drawMap(); };
  $('#m-clear').onclick = () => { S.waypoint = null; drawMap(); };
  document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => { MV.tab = b.dataset.tab; document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b))); renderTab(); });
  function sizeMap() { const r = mapCv.parentElement.getBoundingClientRect(); mapCv.width = r.width * devicePixelRatio; mapCv.height = r.height * devicePixelRatio; }
  addEventListener('resize', () => { if (!$('#mapview').classList.contains('hidden')) { sizeMap(); drawMap(); } });
  const W_AOI = AOI.xmax - AOI.xmin, H_AOI = AOI.ymax - AOI.ymin;
  function centerMap() { MV.s = Math.max(mapCv.width / W_AOI, mapCv.height / H_AOI) * 1.6; const p = Lc(P.X, P.Z); MV.ox = mapCv.width / 2 - (p.x - AOI.xmin) * MV.s; MV.oy = mapCv.height / 2 - (AOI.ymax - p.y) * MV.s; }
  const toScr = (x, y) => [MV.ox + (x - AOI.xmin) * MV.s, MV.oy + (AOI.ymax - y) * MV.s];
  const fromScr = (sx, sy) => [AOI.xmin + (sx - MV.ox) / MV.s, AOI.ymax - (sy - MV.oy) / MV.s];
  function safeZone() {
    const pr = predict(); const reachKm = Math.max(0, (pr.lifeH - 0.5 - 0.25) * 2.4);
    const key = `${S.theta}|${S.rover}|${Math.round(reachKm * 20)}`; if (key === safeKey && safeCanvas) return safeCanvas;
    const kp = S.rover && D.rover ? `haven_phys_${S.theta}` : `walkback_phys_${S.theta}`, g = grids[kp], gw = g.nc || NC, gh = g.nr || NR;
    const cv = document.createElement('canvas'); cv.width = gw; cv.height = gh; const ctx = cv.getContext('2d'); const img = ctx.createImageData(gw, gh);
    for (let i = 0; i < gw * gh; i++) { const v = g.arr[i]; if (v !== 65535 && v / 1000 <= reachKm) { const o = i * 4; img.data[o] = 79; img.data[o + 1] = 227; img.data[o + 2] = 164; img.data[o + 3] = 70; } }
    ctx.putImageData(img, 0, 0); safeCanvas = cv; safeKey = key; return cv;
  }
  let steepCanvas = null;
  function steepZone() {
    if (steepCanvas && steepCanvas.th === S.theta) return steepCanvas;
    const cv = document.createElement('canvas'); cv.width = NC; cv.height = NR; const ctx = cv.getContext('2d'); const img = ctx.createImageData(NC, NR);
    for (let i = 0; i < NC * NR; i++) { const v = grids.slope.arr[i]; if (v === 255 || v * 0.25 > S.theta) { const o = i * 4; img.data[o] = 255; img.data[o + 1] = 77; img.data[o + 2] = 94; img.data[o + 3] = 120; } }
    ctx.putImageData(img, 0, 0); cv.th = S.theta; steepCanvas = cv; return cv;
  }
  function drawMap() {
    const c = mctx, w = mapCv.width, h = mapCv.height, k = devicePixelRatio;
    c.fillStyle = '#0d0907'; c.fillRect(0, 0, w, h);
    const [x0, y0] = toScr(AOI.xmin, AOI.ymax);
    if (ortho.complete) { c.globalAlpha = 1; c.drawImage(ortho, x0, y0, W_AOI * MV.s, H_AOI * MV.s); }
    c.imageSmoothingEnabled = false;
    if (MV.layers.steep) c.drawImage(steepZone(), x0, y0, W_AOI * MV.s, H_AOI * MV.s);
    if (MV.layers.safe) c.drawImage(safeZone(), x0, y0, W_AOI * MV.s, H_AOI * MV.s);
    c.imageSmoothingEnabled = true;
    if (MV.layers.track) { c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.2 * k; c.setLineDash([2 * k, 4 * k]);
      for (const sgm of D.rover_track.traverse) { c.beginPath(); sgm.xy.forEach(([x, y], i) => { const [sx, sy] = toScr(x, y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.stroke(); } c.setLineDash([]); }
    if (MV.layers.route) { const r = routeOf(S.theta); if (r?.feasible) { c.strokeStyle = '#ff9f43'; c.lineWidth = 3 * k; c.beginPath(); r.geometry_xy.forEach(([x, y], i) => { const [sx, sy] = toScr(x, y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.stroke(); } }
    // trail
    if (S.trail.length > 1) { c.strokeStyle = '#6fd3ff'; c.lineWidth = 2.5 * k; c.beginPath(); S.trail.forEach(([X, Z], i) => { const p = Lc(X, Z); const [sx, sy] = toScr(p.x, p.y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.stroke(); }
    // tubes
    for (const t of D.depot_tubes?.tubes || []) { const [sx, sy] = toScr(t.x, t.y); c.fillStyle = '#fff'; c.beginPath(); c.arc(sx, sy, 2 * k, 0, 7); c.fill(); }
    // stations
    c.font = `700 ${12 * k}px system-ui`;
    for (const s of ST) {
      const [sx, sy] = toScr(s.x, s.y); const done = S.done.has(s.id);
      c.fillStyle = s.kind === 'lander' ? '#ffffff' : done ? '#4fe3a4' : s.kind === 'depot' ? '#c77dff' : '#ff8c42';
      c.beginPath(); c.arc(sx, sy, 7 * k, 0, 7); c.fill(); c.strokeStyle = '#000'; c.lineWidth = 1.5 * k; c.stroke();
      c.fillStyle = '#000'; c.fillText(s.id, sx + 9 * k + 1, sy - 6 * k + 1); c.fillStyle = '#fff'; c.fillText(s.id, sx + 9 * k, sy - 6 * k);
    }
    if (roverObj.visible) { const p = Lc(P.rover.X, P.rover.Z); const [sx, sy] = toScr(p.x, p.y); c.fillStyle = '#6fd3ff'; c.fillRect(sx - 6 * k, sy - 4 * k, 12 * k, 8 * k); c.fillStyle = '#fff'; c.fillText('Rover', sx + 9 * k, sy + 4 * k); }
    if (S.waypoint) { const [sx, sy] = toScr(S.waypoint.x, S.waypoint.y); c.strokeStyle = '#ffd27a'; c.lineWidth = 2.5 * k; c.beginPath(); c.arc(sx, sy, 9 * k, 0, 7); c.moveTo(sx - 13 * k, sy); c.lineTo(sx + 13 * k, sy); c.moveTo(sx, sy - 13 * k); c.lineTo(sx, sy + 13 * k); c.stroke(); }
    // player arrow
    { const p = Lc(P.X, P.Z); const [sx, sy] = toScr(p.x, p.y); const yaw = S.mode === 'drive' ? P.rover.yaw : (S.view === 'fp' ? P.camYaw : P.yaw);
      c.save(); c.translate(sx, sy); c.rotate(-yaw); c.fillStyle = '#ffd27a'; c.strokeStyle = '#000'; c.lineWidth = 1.5 * k;
      c.beginPath(); c.moveTo(0, -12 * k); c.lineTo(8 * k, 9 * k); c.lineTo(0, 4 * k); c.lineTo(-8 * k, 9 * k); c.closePath(); c.fill(); c.stroke(); c.restore(); }
    // scale bar
    const m100 = 100 * MV.s, len = m100 > 160 * k ? 100 : m100 > 40 * k ? 500 : 1000; const L = len * MV.s;
    c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(w - L - 30 * k, h - 50 * k, L + 20 * k, 30 * k); c.fillStyle = '#fff'; c.fillRect(w - L - 20 * k, h - 30 * k, L, 4 * k); c.fillText(`${len} m`, w - L - 20 * k, h - 36 * k);
    $('#map-legend').innerHTML = [['safe', 'Safe-return zone (remaining O₂/CO₂)', 'rgba(79,227,164,.6)'], ['route', `Planned route (${S.theta}°)`, '#ff9f43'], ['steep', `Too steep (> ${S.theta}°) / no data`, 'rgba(255,77,94,.7)'], ['track', 'Perseverance\'s real track', '#ccc']]
      .map(([k2, t, col]) => `<div><input type="checkbox" data-l="${k2}" ${MV.layers[k2] ? 'checked' : ''}><span class="sw" style="background:${col}"></span>${esc(t)}</div>`).join('')
      + `<div><span class="sw" style="background:#6fd3ff"></span>Your trail · <span style="color:#ffd27a">▲</span> you</div>`;
    $('#map-legend').querySelectorAll('input').forEach((i) => i.onchange = () => { MV.layers[i.dataset.l] = i.checked; drawMap(); });
  }
  // pan / zoom / waypoint
  const ptrs = new Map(); let moved = 0, pinch0 = null;
  mapCv.addEventListener('pointerdown', (e) => { try { mapCv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: MV.s }; } });
  mapCv.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return; const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2 && pinch0) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (pinch0.s * d / pinch0.d) / MV.s); moved += 10; return; }
    const dx = (e.clientX - prev[0]) * devicePixelRatio, dy = (e.clientY - prev[1]) * devicePixelRatio; moved += Math.abs(dx) + Math.abs(dy); MV.ox += dx; MV.oy += dy; drawMap();
  });
  mapCv.addEventListener('pointerup', (e) => {
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null;
    if (moved < 6) { const r = mapCv.getBoundingClientRect(); const [x, y] = fromScr((e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio);
      if (x > AOI.xmin && x < AOI.xmax && y > AOI.ymin && y < AOI.ymax) { S.waypoint = { x, y }; drawMap(); renderTab(); } }
  });
  mapCv.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 0.85 : 1.18); }, { passive: false });
  function zoomAt(cx, cy, f) { const r = mapCv.getBoundingClientRect(); const sx = (cx - r.left) * devicePixelRatio, sy = (cy - r.top) * devicePixelRatio;
    const ns = clamp(MV.s * f, Math.min(mapCv.width / W_AOI, mapCv.height / H_AOI) * 0.8, 6 * devicePixelRatio); MV.ox = sx - (sx - MV.ox) * ns / MV.s; MV.oy = sy - (sy - MV.oy) * ns / MV.s; MV.s = ns; drawMap(); }

  function renderTab() {
    const pr = predict(), st = pr.st, b = $('#tab-body');
    const vClass = { go: 'go', cond: 'cond', nogo: 'nogo' }[pr.level], vText = { go: 'GO — continue', cond: 'CONDITIONAL — continue with care', nogo: 'NO-GO — return now' }[pr.level];
    if (MV.tab === 'pred') {
      const arrive = pr.etaH !== null ? st.ltst + pr.etaH : null;
      let wp = '';
      if (S.waypoint) { const p = Lc(P.X, P.Z); const d = Math.hypot(S.waypoint.x - p.x, S.waypoint.y - p.y); const [r, c] = rcOf(S.waypoint.x, S.waypoint.y);
        const hw = gv(S.rover && D.rover ? `haven_phys_${S.theta}` : `walkback_phys_${S.theta}`, r, c); const tGo = d * 1.25 / 1000 / 2.4; const o2After = pr.lifeH - tGo - (hw !== null ? hw / 1000 / 2.4 + 0.25 : 0);
        wp = `<div class="sec">If you go to the waypoint, then home</div><dl class="kv"><dt>Distance (straight ×1.25)</dt><dd>${fmt(d * 1.25)} m</dd><dt>Walk home from there</dt><dd>${hw === null ? 'no path' : fmt(hw) + ' m'}</dd><dt>Life support left at home</dt><dd style="color:${o2After < 0.5 ? 'var(--bad)' : 'var(--ok)'}">${hm(o2After)}</dd></dl>`; }
      b.innerHTML = `<div class="verdict ${vClass}">${vText}</div>
        ${pr.issues.length ? `<ul class="issues">${pr.issues.map(([l, t]) => `<li style="color:${l === 'nogo' ? 'var(--bad)' : 'var(--warn)'}">${esc(t)}</li>`).join('')}</ul>` : '<p class="note">No warnings. Rules from the Go / No-go model (merged from Marswalk Planner v4.1).</p>'}
        <div class="sec">If you turn back now</div>
        <dl class="kv"><dt>Nearest safe haven</dt><dd>${S.rover && D.rover ? 'lander or rover' : 'lander'}</dd><dt>Walk home</dt><dd>${pr.h ? fmt(pr.h.phys) + ' m' : 'no path'}</dd>
        <dt>Time to get there</dt><dd>${hm(pr.etaH)}</dd><dt>Arrive (LTST)</dt><dd>${arrive === null ? '—' : M24.fmtH(arrive)}</dd>
        <dt>Life support left (300 W)</dt><dd>${hm(pr.lifeH)}</dd><dt>Return margin (−30 min reserve)</dt><dd style="color:${pr.margin < 0 ? 'var(--bad)' : pr.margin < 0.75 ? 'var(--warn)' : 'var(--ok)'}">${pr.margin === null ? '—' : hm(pr.margin)}</dd>
        <dt>Daylight left</dt><dd>${pr.toSunset === null ? '—' : hm(pr.toSunset)}</dd><dt>EVA so far</dt><dd>${hm(pr.evaH)}</dd></dl>${wp}
        <div class="sec">Resources</div>
        <dl class="kv"><dt>O₂</dt><dd>${fmt(S.res.o2 * 100)} %</dd><dt>CO₂ scrubber</dt><dd>${fmt(S.res.co2 * 100)} %</dd><dt>Power</dt><dd>${fmt(S.res.pwr * 100)} %</dd><dt>Cooling water</dt><dd>${fmt(S.res.h2o * 100)} %</dd><dt>Suit pressure</dt><dd>${fmt(4.3 * (0.5 + 0.5 * S.res.integ), 2)} psi</dd><dt>Dose so far (model)</dt><dd>${fmt(S.res.dose, 3)} mSv</dd></dl>
        <p class="note">Green zone on the map = everywhere you could still walk home from with current O₂/CO₂ at 2.4 km/h, keeping a 30 min reserve. Uses the real cost-to-haven field for your ${S.theta}° slope limit.</p>`;
    } else if (MV.tab === 'cond') {
      const near = cmeNear(S.sim), list = (swx?.cme_mars || []).slice(-5).reverse();
      b.innerHTML = `<div class="sec">Time & sun (Mars24)</div>
        <dl class="kv"><dt>Mars local true solar time</dt><dd>${M24.fmtH(st.ltst)}</dd><dt>Mars local mean solar time</dt><dd>${M24.fmtH(st.lmst)}</dd><dt>Mars 2020 sol</dt><dd>${st.sol}</dd>
        <dt>Earth UTC</dt><dd>${new Date(S.sim).toISOString().slice(0, 16).replace('T', ' ')}</dd><dt>Season (Ls)</dt><dd>${fmt(st.Ls, 1)}° · ${st.season}</dd>
        <dt>Dust-storm season</dt><dd>${st.dustSeason ? 'yes (Ls 180–360°)' : 'no'}</dd><dt>Sun elevation / azimuth</dt><dd>${fmt(st.elev, 1)}° / ${fmt(st.az)}°</dd>
        <dt>Sunrise / sunset (LTST)</dt><dd>${M24.fmtH(pr.sun.sunriseLtst)} / ${M24.fmtH(pr.sun.sunsetLtst)}</dd><dt>Radio delay to Earth</dt><dd>${fmt(st.lightMin, 1)} min one way</dd></dl>
        <div class="sec">Weather reference (Perseverance MEDA)</div>
        <dl class="kv"><dt>Air temperature at this hour</dt><dd>${fmt(airTemp(st) - 273.15)} °C</dd><dt>Pressure at this hour</dt><dd>${fmt(medaAt('P', st.lmst) ?? NaN)} Pa</dd></dl>
        <p class="note">Historical means at the depot, sols ${medaRef?.sols.join(', ')} (Ls ${fmt(medaRef?.ls[0], 0)}–${fmt(medaRef?.ls[1], 0)}°). A reference, not a forecast for today.</p>
        <div class="sec">Space weather (NASA DONKI)</div>
        <p style="color:${near.length ? 'var(--warn)' : 'var(--ok)'};font-weight:700">${near.length ? `${near.length} CME arrival(s) at Mars within 24 h` : 'No CME predicted at Mars within 24 h of now'}</p>
        <ul class="issues">${list.map((c) => `<li>${esc(c.arrival_utc?.replace('T', ' ').replace('Z', ' UTC'))} · ${c.glancing_blow ? 'glancing blow' : c.minor_impact ? 'minor impact' : 'impact'} · ${fmt(c.speed_km_s)} km/s</li>`).join('') || '<li>none in snapshot</li>'}</ul>
        <p class="note">Snapshot window ${esc(swx?.window?.join(' → '))}; ${esc(swx?.endpoint_status?.WSAEnlilSimulations || '')}. WSA-ENLIL arrival errors are several hours.</p>
        <div class="sec">Radiation</div><p class="note">Reference rate 0.64 mSv/day dose equivalent (Curiosity RAD at Gale, 2012–13; Hassler et al. 2014). Not measured at Jezero. The game multiplies it ×3 near a CME (assumption).</p>`;
    } else if (MV.tab === 'sci') {
      b.innerHTML = `<p>Science points: <b style="color:var(--accent-2)">${S.score}</b></p>` + order().filter((id) => id !== lander.id).map((id) => {
        const s = ST.find((x) => x.id === id), done = S.done.has(id), pov = D.pov?.[id];
        return `<div class="sci-card ${done ? 'done' : ''}"><b>${esc(id)} · ${esc(s.name)}</b> ${done ? '<span class="tag" style="color:var(--ok)">documented</span>' : '<span class="tag">to do</span>'}
          <div class="note">${esc(s.sample || s.note || '')}</div>${done && pov ? `<img src="../data/${esc(pov.file)}" alt="">` : ''}</div>`;
      }).join('');
    } else {
      b.innerHTML = `<div class="sec">Real data in this simulator</div><ul class="issues">
        <li>Terrain: MRO HiRISE 1 m DTM (USGS doi:10.5066/P9REJ9JN), 5 m mesh${STEP > 1 ? ' (10 m on this device)' : ''}; image: HiRISE orthomosaic, false-colour tint</li>
        <li>Slopes, return-to-haven fields and the planned route: this project's pipeline</li>
        <li>Stops: Perseverance sample sites (Herd et al. 2025); depot tubes: NASA PDS depot bundle</li>
        <li>Rover photos: Perseverance raw images; weather: MEDA (PDS); sun & time: Mars24 (Allison & McEwen 2000)</li>
        <li>Space weather: NASA CCMC DONKI; radiation reference: Curiosity RAD</li></ul>
        <div class="sec">Game assumptions</div><ul class="issues">
        <li>Life support sized for ~8.5 h at 300 W; heaters, sunlight and leaks change the rates</li>
        <li>Walking pace from Apollo data (2.7 km/h flat → 1.2 km/h at 20° uphill); 2.4 km/h average for return estimates</li>
        <li>Backup rover carries spare consumables and recharges you while seated</li>
        <li>Rocks near you are illustrative: the DTM cannot see rocks smaller than ~1–2 m</li></ul>
        <p><a href="../">Open the full planner</a> · <a href="../#mode=data">Data & Limits</a></p>
        <p class="note">${esc(D.manifest.si_acknowledgement)}</p>`;
    }
  }

  // ------------------------------------------------------------------------------------------------ modals, help, pause
  function openModal(html, actions) {
    $('#modal-body').innerHTML = html; const a = $('#modal-actions'); a.innerHTML = '';
    for (const [t, fn, primary] of actions) { const bt = document.createElement('button'); bt.className = 'btn' + (primary ? ' primary' : ''); bt.textContent = t; bt.onclick = fn; a.appendChild(bt); }
    $('#modal').classList.remove('hidden'); if (document.pointerLockElement) document.exitPointerLock(); S.modal = true;
    a.querySelector('button')?.focus();
  }
  function closeModal() { $('#modal').classList.add('hidden'); S.modal = false; clock.getDelta(); }
  function helpHtml() {
    return `<h2>How to play</h2>
      <p>Document every orange beacon (Perseverance sample sites), inspect the purple depot, and walk back into the lander airlock before life support runs out. Watch the <b>return margin</b>: it is your time to spare after walking home with a 30-minute reserve.</p>
      <div class="keys">${TOUCH ? '<kbd>Left stick</kbd><span>Walk / drive</span><kbd>Drag</kbd><span>Look around</span><kbd>Run</kbd><span>Toggle loping</span><kbd>Use</kbd><span>Document, board rover, airlock</span>' :
        '<kbd>W A S D</kbd><span>Walk (or drive the rover)</span><kbd>Mouse</kbd><span>Look (click to lock in first person; drag in third person)</span><kbd>Shift</kbd><span>Lope (faster, uses more O₂)</span><kbd>Space</kbd><span>Jump (Mars gravity, 0.38 g)</span><kbd>E</kbd><span>Document / inspect / board rover / airlock</span><kbd>V</kbd><span>First / third person</span><kbd>M</kbd><span>Map, predictions, conditions</span><kbd>T</kbd><span>Time speed</span><kbd>R</kbd><span>Route guide line</span><kbd>L</kbd><span>Helmet lights</span><kbd>P / Esc</kbd><span>Pause</span>'}</div>
      <p class="note">Suits can't climb slopes steeper than your chosen limit. Hard landings from jumps can damage the suit seal. Night is cold: heaters drain power.</p>`;
  }
  function showHelp() { openModal(helpHtml(), [['Got it', closeModal, true]]); }
  function setPaused(p) {
    S.paused = p; if (p && document.pointerLockElement) document.exitPointerLock();
    if (p) openModal('<h2>Paused</h2><p class="note">The simulation clock is stopped.</p>', [['Resume', () => { closeModal(); setPaused(false); }, true], ['Help', showHelp], ['Open planner', () => { location.href = '../'; }]]);
    else clock.getDelta();
  }

  // ------------------------------------------------------------------------------------------------ start screen
  function initStart() {
    const today = new Date(); $('#s-date').value = today.toISOString().slice(0, 10);
    const dep = $('#s-dep'); for (let h = 6; h <= 15.5; h += 0.5) { const o = document.createElement('option'); o.value = h; o.textContent = M24.fmtH(h) + ' LTST'; if (h === 8) o.selected = true; dep.appendChild(o); }
    const upd = () => {
      const d = new Date($('#s-date').value + 'T12:00:00Z'); const sol = M24.at(d).sol; const depH = +dep.value, th = +$('#s-theta').value;
      const t0 = M24.utcForLtst(sol, depH), st = M24.at(t0), sun = M24.sunTimes(t0);
      const walkH = plannedWalkHours(th), stops = (order().length - 1) * 25 / 60 + 5 / 60, evaH = walkH + stops + 0.5;
      const back = depH + evaH, cme = cmeNear(t0.getTime()).length;
      const ok = sun.sunsetLtst === null || back < sun.sunsetLtst - 1;
      $('#s-forecast').innerHTML = `<b>Sol ${st.sol}</b> · Ls ${fmt(st.Ls, 1)}° (${st.season}${st.dustSeason ? ', dust season' : ''}) · sunrise ${M24.fmtH(sun.sunriseLtst)}, sunset ${M24.fmtH(sun.sunsetLtst)} · radio delay ${fmt(st.lightMin, 1)} min<br>
        Planned EVA ≈ <b>${hm(evaH)}</b> (walk ${hm(walkH)} on the ${th}° route, ${order().length - 1} stops, airlock) → back at <b>${M24.fmtH(back)}</b> ${ok ? '✓ daylight' : '⚠ after sunset margin'}${cme ? ' · ⚠ CME predicted within 24 h (DONKI)' : ''}`;
    };
    ['#s-date', '#s-dep', '#s-theta'].forEach((s) => $(s).addEventListener('change', upd)); upd();
    setInterval(() => { if (S.updateReady && !S.playing && !$('#s-update')) { const b = document.createElement('button'); b.id = 's-update'; b.className = 'btn';
      b.textContent = '⟳ Update ready — reload'; b.onclick = () => location.reload(); $('#start .actions').appendChild(b); } }, 1000);
    $('#s-help').onclick = () => openModal(helpHtml(), [['Close', closeModal, true]]);
    $('#s-go').onclick = () => {
      S.theta = +$('#s-theta').value; S.speed = +$('#s-speed').value; S.rover = $('#s-rover').checked; $('#h-speed').textContent = `×${S.speed}`;
      const d = new Date($('#s-date').value + 'T12:00:00Z'); S.sim = M24.utcForLtst(M24.at(d).sol, +dep.value).getTime(); S.evaStart = S.sim;
      buildRouteLine(); resetPlayer(); $('#start').classList.add('hidden'); $('#hud').classList.remove('hidden'); S.playing = true; document.body.classList.add('playing');
      clock.getDelta(); flash(TOUCH ? 'Left stick to walk · drag to look · Map for data' : 'WASD to walk · mouse to look · M for the map · H for help', 'info', 6);
    };
  }

  // ------------------------------------------------------------------------------------------------ main loop
  let orbit = 0;
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (S.playing && !S.paused && !S.mapPaused && !S.modal) step(dt);
    if (!S.playing && !S.over) {          // attract mode behind the start screen
      astro.visible = false; orbit += dt * 0.04; const r = 60; P.X = 0; P.Z = 7.5; P.Y = groundY(0, 7.5);
      camera.position.set(Math.sin(orbit) * r, groundY(Math.sin(orbit) * r, Math.cos(orbit) * r) + 18, Math.cos(orbit) * r); camera.lookAt(0, 5, 0);
      const st = state(); const el = st.elev * D2R, az = st.az * D2R; skyU.sunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      const day = clamp((st.elev + 6) / 16, 0, 1); skyU.day.value = 0.06 + 0.94 * day; sun.intensity = clamp(Math.sin(el) * 3, 0, 1) * 1.7; hemi.intensity = 0.06 + 0.42 * day;
      stars.material.opacity = clamp(1 - day * 1.6, 0, 0.9); sun.position.set(skyU.sunDir.value.x * 200, Math.max(skyU.sunDir.value.y, 0.05) * 200, skyU.sunDir.value.z * 200);
    } else updateVisuals(dt);
    hudT += dt; if (S.playing && hudT > 0.2) { hudT = 0; updateHUD(); }
    mapT += dt; if (S.playing && !$('#mapview').classList.contains('hidden') && mapT > 1) { mapT = 0; renderTab(); }
    renderer.render(scene, camera);
  }

  // ------------------------------------------------------------------------------------------------ offline cache + update check (same scheme as the planner)
  function offline() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    const bid = D.manifest.build_id, swUrl = (id) => `../service-worker.js?build=${encodeURIComponent(id)}`;
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const c = navigator.serviceWorker.controller; const b = c ? new URL(c.scriptURL).searchParams.get('build') : null;
      if (had && b !== bid) S.updateReady = true;
    });
    navigator.serviceWorker.register(swUrl(bid), { scope: '../', updateViaCache: 'none' }).then(() => {
      fetch(`../data/manifest.json?version-check=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()).then((m) => {
        if (m.build_id && m.build_id !== bid) navigator.serviceWorker.register(swUrl(m.build_id), { scope: '../', updateViaCache: 'none' });
      }).catch(() => {});
    }).catch(() => {});
  }

  // ------------------------------------------------------------------------------------------------ boot
  try {
    $('#load-msg').textContent = 'Building Jezero terrain from the HiRISE DTM…';
    setTimeout(() => {                      // not requestAnimationFrame: build even if the tab starts hidden
      buildWorld(); resetPlayer();
      S.sim = M24.utcForLtst(M24.at(new Date()).sol, 9).getTime();
      initStart(); $('#loading').classList.add('hidden'); frame(); offline();
      // deep links: #play starts immediately; #view=fp first person; #map opens the data map
      const H = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
      if ('play' in H) { $('#s-go').click(); if (H.view === 'fp') toggleView(); if ('map' in H) setTimeout(() => toggleMap(true), 300); }
      window.MEC_GAME = { S, P, predict, toggleMap, interact, endGame, groundY, Lc, W };   // debugging / tests
    });
  } catch (e) {
    $('#load-msg').textContent = 'Could not start 3D: ' + e.message;
  }
})();
