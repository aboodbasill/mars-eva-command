/* SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md. */
/* Marswalk (v3) — globe → site planner → descent → EVA on real Jezero terrain.
 * Data: NASA/JPL Mars Trek global mosaics (Viking colour, MOLA), MRO HiRISE 1 m DTM + orthomosaic, Perseverance waypoints,
 * sample sites and raw images, PDS depot tubes, MEDA weather, Curiosity RAD, NASA DONKI, USGS SIM 3464 geology.
 * Physics: every constant in PHYS carries its source; routes use app/game/route.js (port of the pipeline's A*).
 * Coordinates: pipeline local metres x east / y north; Three.js X = x − x_lander, Z = −(y − y_lander), Y = up. */
(function () {
  'use strict';
  const D = window.MEC_DATA, G = window.MEC_GRIDS, M24 = window.Mars24, RT = window.MarsRoute, HZ = window.MarsHazard;
  const HZS = { audio: null };
  const AU = Object.assign({}, window.SuitAudio, { start() { window.SuitAudio.start(); if (HZS.audio) HZS.audio.start(); } });
  const GA = D.game || {};
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const fmt = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v)) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const hm = (h) => { if (!Number.isFinite(h)) return '—'; const s = h < 0 ? '−' : ''; const m = Math.round(Math.abs(h) * 60); return `${s}${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
  const km = (m) => m >= 1000 ? `${fmt(m / 1000, 2)} km` : `${fmt(m)} m`;
  const D2R = Math.PI / 180;
  const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (TOUCH) document.body.classList.add('touch');
  const store = { get(k, d) { try { const v = localStorage.getItem('mw.' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('mw.' + k, JSON.stringify(v)); } catch (_) { /* private mode */ } } };

  // ============================================================================================ PHYSICAL MODEL (sourced)
  const BTU = 0.29307107;                                    // W per Btu/h (exact unit conversion)
  const PHYS = {
    g: 3.73,                 // m/s² — NASA NSSDC Mars Fact Sheet
    W_rest: 100 * 1.16222,   // W — 100 kcal/h resting floor (Waligora & Horrigan 1975, NASA SP-368)
    W_design: 1000 * BTU,    // W — 1,000 Btu/h: NASA EMU design average and Apollo lunar-EVA average
    W_peak: 2200 * BTU,      // W — 2,200 Btu/h Apollo lunar-EVA peaks
    RQ: 0.9,                 // respiratory quotient used in NASA EVA CO₂ analyses
    evaH: 8,                 // h — NASA exploration EVA requirement (xEVA ConOps)
    reserveH: 0.5,           // h — planning reserve (ASSUMPTION)
    psi: 4.3,                // psid — nominal suit pressure (NASA xEVA ConOps 2021)
    pace: [[0, 2.7], [3, 2.7], [10, 1.7], [20, 1.2]],   // km/h vs uphill grade: Apollo walk-back pace (ALSJ "Lunar Gaits"), Apollo 14 uphill; 20° extrapolated
    vWalk: 1.0, vLope: 2.2,  // m/s physical gait speeds
    roverKmh: 15, roverSlope: 25,   // Artemis LTV design figure; slope limit ASSUMPTION
    Lsub: 2.83e6,            // J/kg latent heat of sublimation of ice (sublimator cooling)
    RAD: 0.64,               // mSv/day — Curiosity RAD at Gale (Hassler et al. 2014)
    powerW: 90,              // W suit electrical load (ASSUMPTION; heaters below 245 K)
  };
  const kcalPerLO2 = 3.941 + 1.106 * PHYS.RQ;                // Weir (1949)
  const o2Lph = (W) => (W * 3600) / (kcalPerLO2 * 4184);
  const O2_G_PER_L = 1.429, CO2_G_PER_L = 1.977;
  const SIZE_H = PHYS.evaH + PHYS.reserveH;
  const CAP = { o2kg: (o2Lph(PHYS.W_design) * SIZE_H * O2_G_PER_L) / 1000, co2kg: (o2Lph(PHYS.W_design) * PHYS.RQ * SIZE_H * CO2_G_PER_L) / 1000,
    h2okg: (PHYS.W_design * 3600 * SIZE_H) / PHYS.Lsub, wh: PHYS.powerW * SIZE_H };
  const paceKmh = (deg) => { const p = PHYS.pace; if (deg <= p[0][0]) return p[0][1]; for (let i = 1; i < p.length; i++) if (deg <= p[i][0]) return lerp(p[i - 1][1], p[i][1], (deg - p[i - 1][0]) / (p[i][0] - p[i - 1][0])); return Math.max(0.6, p.at(-1)[1] - (deg - 20) * 0.05); };
  const metabolic = (v, upDeg) => v < 0.05 ? PHYS.W_rest : clamp(PHYS.W_rest + (PHYS.W_design - PHYS.W_rest) * Math.pow(v / (paceKmh(Math.max(0, upDeg)) / 3.6), 1.5), PHYS.W_rest, PHYS.W_peak);

  // ============================================================================================ data & grids
  function decode(g) { const bin = atob(g.b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return { arr: g.dtype === 'uint16' ? new Uint16Array(u8.buffer) : u8, u8, scale: g.scale, offset: g.offset || 0, nodata: g.nodata, f: g.factor || 1, nc: g.ncols, nr: g.nrows }; }
  const grids = {}; for (const [k, g] of Object.entries(G.grids)) if (!k.startsWith('recon')) grids[k] = decode(g);
  const g5 = G.grid_5m, NC = g5.ncols, NR = g5.nrows, CELL = g5.cell_m;
  const gv = (name, r, c) => { const g = grids[name]; if (!g || r < 0 || c < 0 || r >= NR || c >= NC) return null;
    const rr = Math.floor(r / g.f), cc = Math.floor(c / g.f), nc = g.nc || NC; if (rr >= (g.nr || NR) || cc >= nc) return null;
    const v = g.arr[rr * nc + cc]; return g.nodata !== null && v === g.nodata ? null : v * g.scale + g.offset; };
  const rcOf = (x, y) => [Math.floor((g5.y0 - y) / CELL), Math.floor((x - g5.x0) / CELL)];
  const xyOfIdx = (i) => { const r = (i / NC) | 0, c = i - r * NC; return [g5.x0 + (c + 0.5) * CELL, g5.y0 - (r + 0.5) * CELL]; };
  const ST = D.stations, lander = ST.find((s) => s.kind === 'lander');
  const AOI = D.manifest.aoi.local_bounds_m;
  const CX = lander.x, CY = lander.y;
  const W = (x, y) => ({ X: x - CX, Z: -(y - CY) });
  const Lc = (X, Z) => ({ x: X + CX, y: CY - Z });
  const elev = new Float32Array(NC * NR);
  { let s = 0, n = 0; for (let i = 0; i < NC * NR; i++) { const v = grids.elevation.arr[i]; if (v !== 65535) { s += v; n++; } }
    const mean = s / n; for (let i = 0; i < NC * NR; i++) { const v = grids.elevation.arr[i]; elev[i] = (v === 65535 ? mean : v) * 0.1 - 3000; } }
  const routeGrid = RT.makeGrid(grids.slope.u8, grids.provenance.u8, NC, NR, CELL);
  const PERS = GA.perseverance?.site || null;

  // ============================================================================================ settings & quality
  const SET = { speed: store.get('speed', 30), gfx: store.get('gfx', 'auto'), view: store.get('view', 'tp'), sound: store.get('sound', true), guide: true,
    alarmVol: store.get('alarmVol', 0.8), alarmMute: store.get('alarmMute', false), hzPreset: store.get('hzPreset', 0),
    reduced: store.get('reduced', matchMedia('(prefers-reduced-motion: reduce)').matches) };
  const HZ_PRESETS = [[50, 20, 5, 'Demo'], [80, 35, 10, 'Conservative'], [30, 12, 3, 'Minimal']];   // gameplay settings, not NASA safety distances
  const QUAL = {
    ultra: { step: 1, post: true, bloom: true, shadow: 4096, detail: true, rocksR: 120, pebbles: 1800, dust: 900, aa: 4, dpr: 1.5 },
    high: { step: 1, post: true, bloom: true, shadow: 2048, detail: true, rocksR: 90, pebbles: 1100, dust: 500, aa: 2, dpr: 1.25 },
    low: { step: 2, post: false, bloom: false, shadow: 1024, detail: false, rocksR: 50, pebbles: 300, dust: 160, aa: 0, dpr: 1.0 },
  };
  const qName = (n) => n === 'auto' ? (TOUCH ? 'low' : 'ultra') : n;
  let Q = QUAL[qName(SET.gfx)];
  const STEP = Q.step;
  const MR = Math.floor((NR - 1) / STEP) + 1, MC = Math.floor((NC - 1) / STEP) + 1;
  const node = (r, c) => elev[Math.min(NR - 1, r * STEP) * NC + Math.min(NC - 1, c * STEP)];
  function heightLocal(x, y) {
    const cf = ((x - g5.x0) / CELL - 0.5) / STEP, rf = ((g5.y0 - y) / CELL - 0.5) / STEP;
    const c0 = clamp(Math.floor(cf), 0, MC - 2), r0 = clamp(Math.floor(rf), 0, MR - 2), tc = clamp(cf - c0, 0, 1), tr = clamp(rf - r0, 0, 1);
    return lerp(lerp(node(r0, c0), node(r0, c0 + 1), tc), lerp(node(r0 + 1, c0), node(r0 + 1, c0 + 1), tc), tr);
  }
  const E0 = heightLocal(CX, CY);
  const groundY = (X, Z) => { const p = Lc(X, Z); return heightLocal(p.x, p.y) - E0; };
  const EDGE = 150, CLAMP_IN = 165;            // terrain fades into the regional mosaic over the outer 150 m; walking stops 165 m inside

  // environment references
  const medaRef = (() => { const m = D.environment.meda; if (!m) return null; const bins = {};
    for (const r of m.records) { if (r.value === null) continue; const k = r.quantity + ':' + r.lmst_bin_start_h; (bins[k] = bins[k] || []).push(r.value); }
    const curve = (q) => Array.from({ length: 48 }, (_, i) => { const a = bins[q + ':' + i * 0.5]; return a ? a.reduce((s, v) => s + v, 0) / a.length : null; });
    return { T: curve('air_temperature'), P: curve('pressure') }; })();
  function medaAt(q, lmst) { if (!medaRef) return null; const a = medaRef[q], i = Math.floor(lmst * 2) % 48; for (let k = 0; k < 6; k++) { const v = a[(i + k) % 48] ?? a[(i - k + 48) % 48]; if (v !== null && v !== undefined) return v; } return null; }
  const swx = D.environment.spaceweather;
  const cmeNear = (t) => (swx?.cme_mars || []).filter((c) => c.arrival_utc && Math.abs(new Date(c.arrival_utc).getTime() - t) <= 24 * 3600e3);

  // ============================================================================================ state
  const S = {
    phase: 'boot', theta: D.manifest.config.routing.default_deg, speed: SET.speed, view: SET.view, mode: 'walk',
    sim: Date.now(), evaStart: null, paused: false, over: false, auto: false, leg: 'out', legPath: null, legIdx: 0,
    done: new Set(), trail: [], walked: 0, lastLook: 0, rover: true, updateReady: false,
    res: { o2: CAP.o2kg, co2: 0, h2o: CAP.h2okg, wh: CAP.wh, integ: 1, dose: 0 }, wAvg: PHYS.W_design, jumpW: 0, alertKey: '',
  };
  const PL = { start: null, dest: null, active: 'dest', dep: 9, plan: null };

  // ============================================================================================ HAZARD SYSTEM (app/game/hazard.js)
  const hzLevels = (i) => { const p = HZ_PRESETS[i] || HZ_PRESETS[0]; return { caution: p[0], warning: p[1], critical: p[2] }; };
  const hazard = new HZ.HazardDetector({ slopeU8: grids.slope.u8, slopeScale: 0.25, slopeNodata: 255, provU8: grids.provenance.u8, elev, nc: NC, nr: NR, cell: CELL, x0: g5.x0, y0: g5.y0 },
    { theta: S.theta, levels: hzLevels(SET.hzPreset) });
  const alertMgr = new HZ.HazardAlertManager({ levels: hzLevels(SET.hzPreset) });
  const hzAudio = HZS.audio = new HZ.HazardAudio({ volume: SET.alarmVol, muted: SET.alarmMute });
  const hzHud = new HZ.HazardHUD($('#hz'), { reducedMotion: SET.reduced });
  const HZRUN = { t: 0, list: [], state: null, msg: null };
  function setHzLevels(L) { hazard.cfg.levels = L; alertMgr.cfg.levels = L; }
  function hazardTick(dt, t) {
    HZRUN.t += dt; const p = Lc(P.X, P.Z);
    if (HZRUN.t >= 1 / HZ.CONFIG.queryHz) { HZRUN.t = 0; HZRUN.list = hazard.query(p.x, p.y); }        // spatial query at 5 Hz, not every frame
    const yaw = S.mode === 'drive' ? P.rover.yaw : P.camYaw;
    const st = alertMgr.update(HZRUN.list, dt, { heading: -yaw }); const msg = alertMgr.message(st, S.theta);
    HZRUN.state = st; HZRUN.msg = msg; hzHud.render(st, msg, t); document.body.classList.toggle('hz-on', st.level > 0);
    if (!S.paused) hzAudio.update(st, t);
  }
  function hazardOff() { alertMgr.state = {}; alertMgr.level = 0; HZRUN.list = []; hzHud.render({ level: 0, others: [] }, null, 0); document.body.classList.remove('hz-on'); hzAudio.level = 0; }
  let hzCanvas = null;
  function hazardCanvas() {   // map/minimap overlay: steep (red), sharp steps (orange), no data (grey)
    if (hzCanvas && hzCanvas.theta === S.theta) return hzCanvas;
    const cv = document.createElement('canvas'); cv.width = NC; cv.height = NR; const ctx = cv.getContext('2d'), im = ctx.createImageData(NC, NR);
    const put = (i, r, g, b, a) => { const o = i * 4; im.data[o] = r; im.data[o + 1] = g; im.data[o + 2] = b; im.data[o + 3] = a; };
    for (const i of hazard.static.relief) put(i, 255, 140, 40, 150);
    for (let i = 0; i < NC * NR; i++) { const s2 = hazard.slopeAt(i); if (s2 !== null && s2 > S.theta) put(i, 225, 45, 30, 170); }
    for (const i of hazard.static.nodata) put(i, 150, 150, 150, 200);
    ctx.putImageData(im, 0, 0); cv.theta = S.theta; hzCanvas = cv; return cv;
  }

  // ============================================================================================ renderer
  const canvas = $('#view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, TOUCH ? 1.5 : Q.dpr));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 1, 0.08, 15000);
  const gScene = new THREE.Scene(), gCam = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
  const manager = new THREE.LoadingManager(); const tl = new THREE.TextureLoader(manager);
  const maxA = renderer.capabilities.getMaxAnisotropy();
  const tex = (f, srgb = true, rep = false) => { const t = tl.load('../data/' + f); if (srgb) t.encoding = THREE.sRGBEncoding; t.anisotropy = maxA; if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };

  // sky, stars, light
  const skyU = { sunDir: { value: new THREE.Vector3(0, 1, 0) }, day: { value: 1 }, dust: { value: 0.0 } };
  const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 sunDir; uniform float day; uniform float dust; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float h = clamp(d.y, -0.25, 1.0);
        vec3 zen = vec3(0.26,0.18,0.14), hor = vec3(0.90,0.68,0.49), low = vec3(0.62,0.42,0.28);
        vec3 col = mix(hor, zen, pow(max(h,0.0), 0.45)); col = mix(col, low, smoothstep(0.0,-0.25,h));
        float sd = max(dot(d, normalize(sunDir)), 0.0), sunLow = 1.0 - smoothstep(-0.05, 0.4, sunDir.y);
        col = mix(col, vec3(0.38,0.56,0.92), sunLow * pow(sd, 5.0) * 0.95);
        col += vec3(1.0,0.82,0.62) * pow(sd, 18.0) * 0.55 * (0.4 + sunLow);
        col += vec3(1.0,0.95,0.85) * smoothstep(0.9993, 0.99975, sd) * 18.0;
        col = mix(col, hor*0.8, dust*0.5); col *= day; col += vec3(0.010,0.008,0.014) * (1.0 - day);
        gl_FragColor = vec4(col, 1.0); }` });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), skyMat); sky.frustumCulled = false; scene.add(sky);
  function starField(r, n, size) { const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u); pos[i * 3] = r * s * Math.cos(a); pos[i * 3 + 1] = r * u; pos[i * 3 + 2] = r * s * Math.sin(a); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false })); }
  const stars = starField(8500, 2400, 1.7); scene.add(stars);
  scene.fog = new THREE.FogExp2(0xcfa27a, 0.00022);
  const sun = new THREE.DirectionalLight(0xffeedd, 2.4); sun.castShadow = true; sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 600 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xf0c9a5, 0x4a2a18, 0.25); scene.add(hemi);
  const lampL = new THREE.SpotLight(0xe6f3ff, 0, 70, 0.5, 0.45, 1.3), lampR = lampL.clone(); scene.add(lampL, lampL.target, lampR, lampR.target);
  const pmrem = new THREE.PMREMGenerator(renderer); const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  let envRT = null, envSunEl = -99;
  function updateEnv(el) { if (Math.abs(el - envSunEl) < 2.5 && envRT) return; envSunEl = el; const old = envRT; envRT = pmrem.fromScene(envScene, 0.04); scene.environment = envRT.texture; if (old) old.dispose(); }

  // ============================================================================================ post-processing
  const post = (() => {
    const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), fsGeo = new THREE.PlaneGeometry(2, 2);
    const mk = (frag, uniforms) => { const m = new THREE.ShaderMaterial({ uniforms, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }', fragmentShader: frag, depthTest: false, depthWrite: false });
      const sc = new THREE.Scene(); sc.add(new THREE.Mesh(fsGeo, m)); return { m, sc }; };
    const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    let rt = null, b1 = null, b2 = null;
    const bright = mk(`uniform sampler2D t; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb; float l = dot(c, vec3(.2126,.7152,.0722)); gl_FragColor = vec4(c * smoothstep(1.0, 2.6, l), 1.); }`, { t: { value: null } });
    const blur = mk(`uniform sampler2D t; uniform vec2 dir; varying vec2 vUv;
      void main(){ vec3 c = texture2D(t,vUv).rgb*0.227; c += texture2D(t,vUv+dir*1.384).rgb*0.316; c += texture2D(t,vUv-dir*1.384).rgb*0.316;
        c += texture2D(t,vUv+dir*3.230).rgb*0.070; c += texture2D(t,vUv-dir*3.230).rgb*0.070; gl_FragColor = vec4(c,1.); }`, { t: { value: null }, dir: { value: new THREE.Vector2() } });
    const comp = mk(`uniform sampler2D t; uniform sampler2D tb; uniform float time; uniform float bloomK; uniform vec2 sunUv; uniform float sunVis; uniform float exposure; uniform float night; uniform float sat; varying vec2 vUv;
      vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.); }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){ vec2 d = vUv - 0.5; vec3 c;
        c.r = texture2D(t, vUv + d*0.0012).r; c.g = texture2D(t, vUv).g; c.b = texture2D(t, vUv - d*0.0012).b;
        c += texture2D(tb, vUv).rgb * bloomK;
        vec2 sd = vUv - sunUv; sd.x *= 1.6; float r = length(sd);
        c += vec3(1.0,0.78,0.55) * sunVis * (0.08/(r*18.0+0.6));
        c *= exposure; c = aces(c);
        float l = dot(c, vec3(.2126,.7152,.0722));
        c = mix(c * vec3(0.95,1.0,1.05), c * vec3(1.05,1.0,0.93), smoothstep(0.15,0.7,l));
        c = mix(vec3(l), c, 1.05 * sat);
        c *= 1.0 - dot(d,d)*0.7;
        c += (hash(vUv*vec2(1920.,1080.) + time) - 0.5) * (0.012 + night*0.02);
        gl_FragColor = vec4(pow(max(c,0.), vec3(1.0/2.2)), 1.0); }`,
    { t: { value: null }, tb: { value: null }, time: { value: 0 }, bloomK: { value: 0.6 }, sunUv: { value: new THREE.Vector2(-9, -9) }, sunVis: { value: 0 }, exposure: { value: 1.0 }, night: { value: 0 }, sat: { value: 1 } });
    function size() { const w = Math.floor(innerWidth * renderer.getPixelRatio()), h = Math.floor(innerHeight * renderer.getPixelRatio());
      for (const r of [rt, b1, b2]) r?.dispose(); rt = new THREE.WebGLRenderTarget(w, h, opt); rt.samples = Q.aa;
      b1 = new THREE.WebGLRenderTarget(w >> 2, h >> 2, opt); b2 = new THREE.WebGLRenderTarget(w >> 2, h >> 2, opt); }
    const o = { size, expo: 0.9, sat: 1,
      render(sc, cam, time, sunWorld, night) {
        renderer.setRenderTarget(rt); renderer.render(sc, cam);
        if (Q.bloom) { bright.m.uniforms.t.value = rt.texture; renderer.setRenderTarget(b1); renderer.render(bright.sc, fsCam);
          for (let i = 0; i < 2; i++) { blur.m.uniforms.t.value = b1.texture; blur.m.uniforms.dir.value.set(1 / b1.width, 0); renderer.setRenderTarget(b2); renderer.render(blur.sc, fsCam);
            blur.m.uniforms.t.value = b2.texture; blur.m.uniforms.dir.value.set(0, 1 / b1.height); renderer.setRenderTarget(b1); renderer.render(blur.sc, fsCam); } }
        let vis = 0; if (sunWorld) { const p = sunWorld.clone().project(cam); const on = p.z < 1 && Math.abs(p.x) < 1.3 && Math.abs(p.y) < 1.3;
          comp.m.uniforms.sunUv.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5); vis = on ? clamp(1.3 - Math.max(Math.abs(p.x), Math.abs(p.y)), 0, 1) * (1 - night) : 0; }
        const u = comp.m.uniforms; u.sunVis.value = vis; u.t.value = rt.texture; u.tb.value = Q.bloom ? b1.texture : null; u.bloomK.value = Q.bloom ? 0.6 : 0;
        u.exposure.value = o.expo; u.sat.value = o.sat; u.time.value = time % 100; u.night.value = night || 0;
        renderer.setRenderTarget(null); renderer.render(comp.sc, fsCam); } };
    return o;
  })();
  function applyRendererMode() {
    renderer.toneMapping = Q.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    renderer.outputEncoding = Q.post ? THREE.LinearEncoding : THREE.sRGBEncoding;
    for (const sc of [scene, gScene]) sc.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  }
  function resize() { renderer.setSize(innerWidth, innerHeight, false); for (const c of [camera, gCam]) { c.aspect = innerWidth / innerHeight; c.updateProjectionMatrix(); } if (Q.post) post.size(); }
  addEventListener('resize', resize);

  // ============================================================================================ GLOBE (NASA/JPL Mars Trek mosaics)
  const GL = { lon: 40, lat: 12, dist: 3.6, tLon: 40, tLat: 12, tDist: 3.6, auto: true, sel: null, fly: null, layer: 'viking', vx: 0, vy: 0 };
  const gdir = (lat, lon, r = 1) => new THREE.Vector3(r * Math.cos(lat * D2R) * Math.cos(lon * D2R), r * Math.sin(lat * D2R), -r * Math.cos(lat * D2R) * Math.sin(lon * D2R));
  let globeMat, globeTex = {};
  function buildGlobe() {
    globeTex.viking = tex(GA.globe_layers?.globe?.file || 'mars_globe_4k.jpg'); globeTex.mola = tex(GA.globe_layers?.mola?.file || 'mars_mola_2k.jpg');
    globeMat = new THREE.MeshStandardMaterial({ map: globeTex.viking, roughness: 1, metalness: 0 });
    const mars = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), globeMat); gScene.add(mars);
    const atm = new THREE.Mesh(new THREE.SphereGeometry(1.07, 96, 48), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
      uniforms: { sunDir: { value: new THREE.Vector3(1, 0.3, 0.6).normalize() } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `uniform vec3 sunDir; varying vec3 vW; void main(){ vec3 dir = normalize(vW - cameraPosition);
        float t = -dot(cameraPosition, dir); vec3 cp = cameraPosition + dir * t; float imp = length(cp);      // closest approach of the view ray to the centre
        float g = smoothstep(1.07, 1.0, imp); g = g * g; float lit = 0.25 + 1.2 * smoothstep(-0.4, 0.7, dot(normalize(cp), sunDir));
        gl_FragColor = vec4(vec3(0.96,0.58,0.38) * g * lit * 0.9, g); }` }));
    gScene.add(atm);
    const gs = starField(60, 3500, 1.4); gs.material.opacity = 0.9; gScene.add(gs);
    const gsun = new THREE.DirectionalLight(0xfff1e0, 3.0); gsun.position.set(5, 1.5, 3); gScene.add(gsun); gScene.add(new THREE.AmbientLight(0x6b5548, 0.55));
    GL.sun = gsun; GL.atm = atm;
    // HTML markers
    const box = $('#labels');
    GL.marks = [];
    for (const l of (GA.globe_labels || []).filter((l) => !(GA.globe_sites || []).some((q) => q.active && Math.hypot(q.lon - l.lon, q.lat - l.lat) < 12))) { const el = document.createElement('div'); el.className = 'glabel'; el.textContent = l.name; box.appendChild(el); GL.marks.push({ el, p: gdir(l.lat, l.lon, 1.005), kind: 'label' }); }
    for (const s of GA.globe_sites || []) {
      const el = document.createElement('div'); el.className = `gsite ${s.active ? 'active' : 'dim'}`;
      el.innerHTML = `<i></i><div><b>${esc(s.name)}</b><small>${esc(s.mission)}${s.active ? '' : ' · no HiRISE terrain processed'}</small></div>`;
      el.onclick = (e) => { e.stopPropagation(); selectSite(s); }; box.appendChild(el); GL.marks.push({ el, p: gdir(s.lat, s.lon, 1.005), kind: 'site', s });
    }
    if (GA.perseverance?.latest) { const p = GA.perseverance.latest; const el = document.createElement('div'); el.className = 'glabel'; el.style.color = '#e0863a'; el.textContent = `▲ Perseverance · sol ${p.sol}`;
      box.appendChild(el); GL.marks.push({ el, p: gdir(p.lat, p.lon, 1.006), kind: 'pers', off: 30 }); }
  }
  function selectSite(s) {
    AU.start(); AU.click(); GL.sel = s; GL.auto = false; GL.fly = { lon: s.lon, lat: s.lat, dist: s.active ? 1.75 : 2.3, t: 0 };
    GL.marks.forEach((m) => m.kind === 'site' && m.el.classList.toggle('sel', m.s === s));
    const card = $('#site-card'); card.classList.remove('hidden');
    if (!s.active) { card.innerHTML = `<h2>${esc(s.name)}</h2><div class="coords">${fmt(Math.abs(s.lat), 2)}°${s.lat >= 0 ? 'N' : 'S'} · ${fmt(Math.abs(s.lon), 2)}°${s.lon >= 0 ? 'E' : 'W'}</div><p>${esc(s.mission)} explored here. This build has processed HiRISE terrain for Jezero only; the same pipeline can be run on this site.</p><button class="btn ghost" id="sc-close">Close</button>`;
      $('#sc-close').onclick = () => card.classList.add('hidden'); return; }
    const lay = (D.layers || []).length;
    card.innerHTML = `<h2>Jezero Crater</h2><div class="coords">18.44°N · 77.45°E · Perseverance landing site</div>
      <p>An ancient lake with a river delta. Perseverance sampled its rocks for return to Earth. Plan a walk between real sample sites on 1 m terrain.</p>
      <div class="tags"><span>HiRISE 1 m terrain</span><span>CTX 6 m</span><span>THEMIS thermal</span><span>USGS geology</span><span>MEDA weather</span><span>RAD radiation</span><span>DONKI space weather</span><span>Perseverance photos</span></div>
      <button class="btn go" id="sc-enter">${manager.done ? 'Enter site' : 'Loading terrain…'}</button>`;
    $('#sc-enter').onclick = () => { if (manager.done && worldReady) enterSite(); };
    void lay;
  }
  $('#globe-ui .seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; GL.layer = b.dataset.g; globeMat.map = globeTex[GL.layer]; globeMat.needsUpdate = true;
    $('#globe-ui .seg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); AU.click(); });
  // globe input
  { let drag = null, pinch = null; const pts = new Map();
    canvas.addEventListener('pointerdown', (e) => { if (S.phase !== 'globe') return; AU.start(); pts.set(e.pointerId, [e.clientX, e.clientY]); GL.auto = false; GL.fly = null;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), dist: GL.tDist }; } drag = { x: e.clientX, y: e.clientY }; });
    addEventListener('pointermove', (e) => { if (S.phase !== 'globe' || !pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()]; GL.tDist = clamp(pinch.dist * pinch.d / Math.hypot(a[0] - b[0], a[1] - b[1]), 1.35, 6); return; }
      if (!drag) return; const k = 0.18 * (GL.dist - 0.9); GL.vx = -(e.clientX - drag.x) * k; GL.vy = (e.clientY - drag.y) * k;
      GL.tLon += GL.vx; GL.tLat = clamp(GL.tLat + GL.vy, -75, 75); drag = { x: e.clientX, y: e.clientY }; });
    addEventListener('pointerup', (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) drag = null; });
    canvas.addEventListener('wheel', (e) => { if (S.phase !== 'globe') return; GL.fly = null; GL.tDist = clamp(GL.tDist * (e.deltaY > 0 ? 1.1 : 0.9), 1.35, 6); }, { passive: true });
  }
  function updateGlobe(dt) {
    if (GL.fly) { const f = GL.fly; f.t = Math.min(1, f.t + dt * 0.9); const k = 1 - Math.exp(-dt * 4);
      let dl = ((f.lon - GL.tLon + 540) % 360) - 180; GL.tLon += dl * k; GL.tLat += (f.lat - GL.tLat) * k; GL.tDist += (f.dist - GL.tDist) * k; }
    else if (GL.auto) GL.tLon += dt * 4;
    else { GL.tLon += GL.vx * 0; }
    const k = 1 - Math.exp(-dt * 6); GL.lon += (((GL.tLon - GL.lon + 540) % 360) - 180) * k; GL.lat += (GL.tLat - GL.lat) * k; GL.dist += (GL.tDist - GL.dist) * k;
    gCam.position.copy(gdir(GL.lat, GL.lon, GL.dist)); gCam.lookAt(0, 0, 0);
    // keep the lit side towards the viewer, terminator off to one side
    GL.sun.position.copy(gdir(GL.lat + 18, GL.lon + 55, 5)); GL.atm.material.uniforms.sunDir.value.copy(GL.sun.position).normalize();
    const camDir = gCam.position.clone().normalize(), w = innerWidth, h = innerHeight;
    for (const m of GL.marks) { const facing = m.p.clone().normalize().dot(camDir); const q = m.p.clone().project(gCam);
      const show = !GL.entering && facing > (m.kind === 'label' ? 0.35 : 0.15) && q.z < 1 && (m.kind !== 'label' || GL.dist > 1.6);
      m.el.style.display = show ? '' : 'none'; if (show) { m.el.style.left = `${(q.x * 0.5 + 0.5) * w}px`; m.el.style.top = `${(-q.y * 0.5 + 0.5) * h + (m.off || 0)}px`; m.el.style.opacity = clamp((facing - 0.15) * 4, 0, 1); } }
  }
  function showGlobeMarks(on) { for (const m of GL.marks || []) m.el.style.display = on ? '' : 'none'; }

  // ============================================================================================ TERRAIN (HiRISE + detail splat)
  const TEXDEF = GA.ground_textures || {};
  let terrain, regional, worldReady = false, planeH = 0;
  function buildTerrain() {
    // regional context (Viking colour around Jezero) under/around the HiRISE patch
    let edgeSum = 0, edgeN = 0;
    for (let c = 0; c < NC; c += 4) { edgeSum += elev[c] + elev[(NR - 1) * NC + c]; edgeN += 2; }
    for (let r = 0; r < NR; r += 4) { edgeSum += elev[r * NC] + elev[r * NC + NC - 1]; edgeN += 2; }
    planeH = edgeSum / edgeN - E0;
    const rb = GA.globe_layers?.regional?.bounds_lonlat; const Rm = 3396190, kx = D2R * Rm * Math.cos(18.45 * D2R), ky = D2R * Rm;
    const reg = rb ? { x0: (rb[0] - 77.45) * kx, x1: (rb[2] - 77.45) * kx, y0: (rb[1] - 18.45) * ky, y1: (rb[3] - 18.45) * ky } : null;
    const regTex = rb ? tex(GA.globe_layers.regional.file) : null;
    if (reg) {   // four strips around the HiRISE patch (no overlap with the terrain, so no z-fighting)
      const A = { x0: AOI.xmin, x1: AOI.xmax, y0: AOI.ymin, y1: AOI.ymax };
      const rects = [[reg.x0, A.y1, reg.x1, reg.y1], [reg.x0, reg.y0, reg.x1, A.y0], [reg.x0, A.y0, A.x0, A.y1], [A.x1, A.y0, reg.x1, A.y1]];
      const P3 = [], UV = [], IX = [];
      for (const [x0, y0, x1, y1] of rects) { const b0 = P3.length / 3;
        for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { const w = W(x, y); P3.push(w.X, planeH, w.Z); UV.push((x - reg.x0) / (reg.x1 - reg.x0), (y - reg.y0) / (reg.y1 - reg.y0)); }
        IX.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3); }
      const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(P3, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); rg.setIndex(IX); rg.computeVertexNormals();
      const rmat = new THREE.MeshStandardMaterial({ map: regTex, roughness: 1, metalness: 0, envMapIntensity: 0.2, side: THREE.DoubleSide });
      rmat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = dot(diffuseColor.rgb, vec3(.2126,.7152,.0722)) * vec3(2.15, 0.73, 0.26) * 1.25;`); };   // same Mars tint as the HiRISE base map
      regional = new THREE.Mesh(rg, rmat); scene.add(regional);
    }
    const pos = new Float32Array(MR * MC * 3), uv = new Float32Array(MR * MC * 2), edge = new Float32Array(MR * MC);
    const w = AOI.xmax - AOI.xmin, h = AOI.ymax - AOI.ymin;
    for (let r = 0; r < MR; r++) for (let c = 0; c < MC; c++) {
      const x = g5.x0 + (Math.min(NC - 1, c * STEP) + 0.5) * CELL, y = g5.y0 - (Math.min(NR - 1, r * STEP) + 0.5) * CELL;
      const de = Math.min(x - AOI.xmin, AOI.xmax - x, y - AOI.ymin, AOI.ymax - y), f = sstep(0, EDGE, de);
      const i = r * MC + c, p = W(x, y); pos[i * 3] = p.X; pos[i * 3 + 1] = lerp(planeH, node(r, c) - E0, f); pos[i * 3 + 2] = p.Z;
      uv[i * 2] = (x - AOI.xmin) / w; uv[i * 2 + 1] = (y - AOI.ymin) / h; edge[i] = f;
    }
    const idx = new Uint32Array((MR - 1) * (MC - 1) * 6); let k = 0;
    for (let r = 0; r < MR - 1; r++) for (let c = 0; c < MC - 1; c++) { const a = r * MC + c, b = a + 1, d = a + MC, e = d + 1; idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = e; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('edge', new THREE.BufferAttribute(edge, 1)); geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: tex('game_terrain.jpg'), roughness: 0.95, metalness: 0, envMapIntensity: 0.3 });
    mat.normalMap = tex('game_normal.jpg', false); mat.normalScale = new THREE.Vector2(2.0, 2.0);
    const U = { tReg: { value: tex('tex_regolith_albedo.jpg', true, true) }, tRegN: { value: tex('tex_regolith_normal.jpg', false, true) },
      tBed: { value: tex('tex_bedrock_albedo.jpg', true, true) }, tBedN: { value: tex('tex_bedrock_normal.jpg', false, true) },
      tSand: { value: tex('tex_sand_albedo.jpg', true, true) }, tSandN: { value: tex('tex_sand_normal.jpg', false, true) },
      mReg: { value: new THREE.Vector3(...(TEXDEF.regolith?.mean_linear || [0.26, 0.13, 0.06])) }, mBed: { value: new THREE.Vector3(...(TEXDEF.bedrock?.mean_linear || [0.42, 0.28, 0.16])) },
      mSand: { value: new THREE.Vector3(...(TEXDEF.sand?.mean_linear || [0.12, 0.07, 0.04])) },
      tRegional: { value: regTex }, regB: { value: reg ? new THREE.Vector4(reg.x0, reg.y0, reg.x1 - reg.x0, reg.y1 - reg.y0) : new THREE.Vector4(0, 0, 1, 1) }, cxy: { value: new THREE.Vector2(CX, CY) } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float edge; varying float vEdge; varying vec3 vWPos; varying vec3 vWN;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWN = normalize(objectNormal);')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vEdge = edge;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform sampler2D tReg, tRegN, tBed, tBedN, tSand, tSandN, tRegional; uniform vec3 mReg, mBed, mSand; uniform vec4 regB; uniform vec2 cxy;
        varying float vEdge; varying vec3 vWPos; varying vec3 vWN;
        vec3 nmap(sampler2D t, vec2 uv){ return texture2D(t, uv).xyz * 2.0 - 1.0; }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec2 lp = vec2(vWPos.x + cxy.x, cxy.y - vWPos.z);
          vec3 regc = texture2D(tRegional, (lp - regB.xy) / regB.zw).rgb; regc = dot(regc, vec3(.2126,.7152,.0722)) * vec3(2.15, 0.73, 0.26) * 1.25;
          diffuseColor.rgb = mix(regc, diffuseColor.rgb, vEdge);
          float camD = distance(vWPos, cameraPosition), near = (1.0 - smoothstep(35.0, 380.0, camD)) * vEdge;
          vec3 nDet = vec3(0.0);
          ${Q.detail ? `if (near > 0.001) {
            vec3 base = diffuseColor.rgb; float lum = dot(base, vec3(.2126,.7152,.0722));
            vec2 q = vec2(lp.x, lp.y);
            vec2 q2 = mat2(0.8,-0.6,0.6,0.8) * q;
            float wBed = clamp(max(smoothstep(0.955, 0.90, vWN.y), smoothstep(0.16, 0.28, lum)), 0.0, 1.0);
            float wSand = (1.0 - wBed) * smoothstep(0.075, 0.045, lum);
            float wReg = max(0.0, 1.0 - wBed - wSand);
            vec3 aR = mix(texture2D(tReg, q / 3.0).rgb, texture2D(tReg, q2 / 11.0).rgb, 0.35) / mReg;
            vec3 aB = texture2D(tBed, q / 4.0).rgb / mBed;
            vec3 aS = texture2D(tSand, q2 / 6.0).rgb / mSand;
            vec3 det = aR * wReg + aB * wBed + aS * wSand;
            diffuseColor.rgb = base * mix(vec3(1.0), clamp(det, 0.0, 2.5), near);
            nDet = (nmap(tRegN, q / 3.0) * wReg + nmap(tBedN, q / 4.0) * wBed + nmap(tSandN, q2 / 6.0) * wSand) * near;
          }` : ''}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = normalize(normal + (mat3(viewMatrix) * vec3(nDet.x, 0.0, -nDet.y)) * 0.9);`);
    };
    terrain = new THREE.Mesh(geo, mat); terrain.receiveShadow = true; scene.add(terrain);
  }

  // ============================================================================================ MODELS
  const M = {
    suit: new THREE.MeshStandardMaterial({ color: 0xb4afa5, roughness: 0.85, metalness: 0.0, envMapIntensity: 0.35 }),
    suit2: new THREE.MeshStandardMaterial({ color: 0xa39d92, roughness: 0.9, envMapIntensity: 0.45 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xb8582c, roughness: 0.55 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.55, metalness: 0.35 }),
    black: new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.6, metalness: 0.2 }),
    visor: new THREE.MeshStandardMaterial({ color: 0xc89b3c, roughness: 0.04, metalness: 1.0, envMapIntensity: 2.2 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb9bdc4, roughness: 0.3, metalness: 0.9, envMapIntensity: 1.3 }),
    alu: new THREE.MeshStandardMaterial({ color: 0x8d9097, roughness: 0.45, metalness: 0.85, envMapIntensity: 1.0 }),
    white: new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.55, metalness: 0.1, envMapIntensity: 0.6 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4aa38, roughness: 0.32, metalness: 1.0, envMapIntensity: 1.6 }),
    glowW: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdff1ff, emissiveIntensity: 0 }),
    glowG: new THREE.MeshBasicMaterial({ color: 0x86d06a }),
  };
  const shadowAll = (o) => o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
  const cyl = (r1, r2, h, mat, seg = 16) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat);
  function seg(r, len, mat) { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat); m.position.y = -len / 2 - r * 0.5; g.add(m); return g; }
  function joint(r) { return new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.22, 8, 20), M.dark); }
  function makeAstronaut() {
    const g = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.4, 8, 18), M.suit); torso.position.y = 1.18; torso.scale.set(1.08, 1, 0.9); g.add(torso);
    const hip = cyl(0.25, 0.23, 0.18, M.suit2, 20); hip.position.y = 0.92; g.add(hip);
    const hipRing = joint(0.24); hipRing.rotation.x = Math.PI / 2; hipRing.position.y = 1.0; g.add(hipRing);
    g.add(box(0.3, 0.17, 0.1, M.dark, 0, 1.25, 0.27)); g.add(box(0.06, 0.03, 0.02, M.glowG, 0.08, 1.29, 0.33));
    g.add(box(0.54, 0.68, 0.3, M.suit, 0, 1.24, -0.32)); g.add(box(0.5, 0.06, 0.26, M.dark, 0, 1.6, -0.32));
    for (const s of [-1, 1]) { const tank = cyl(0.06, 0.06, 0.5, M.metal, 12); tank.position.set(0.2 * s, 1.22, -0.5); g.add(tank); }
    const ring = joint(0.2); ring.rotation.x = Math.PI / 2; ring.position.y = 1.5; g.add(ring);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.235, 32, 24), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.35, envMapIntensity: 1.5 }));
    helmet.position.y = 1.71; g.add(helmet);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.245, 32, 24, Math.PI * 0.62, Math.PI * 1.76, 0, Math.PI * 0.62), M.suit); shell.position.y = 1.71; g.add(shell);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.228, 32, 24, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.2, Math.PI * 0.48), M.visor); visor.position.set(0, 1.71, 0.01); g.add(visor);
    for (const s of [-1, 1]) { const lamp = cyl(0.03, 0.03, 0.06, M.glowW, 12); lamp.rotation.x = Math.PI / 2; lamp.position.set(0.17 * s, 1.86, 0.12); g.add(lamp); }
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.05, 24, 1, true), M.accent); band.position.y = 1.36; g.add(band);
    const parts = {};
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(0.36 * s, 1.43, 0); g.add(sh); const sj = joint(0.085); sj.rotation.z = Math.PI / 2; sh.add(sj); sh.add(seg(0.08, 0.22, M.suit));
      const el = new THREE.Group(); el.position.y = -0.36; sh.add(el); const ej = joint(0.075); ej.rotation.z = Math.PI / 2; el.add(ej); el.add(seg(0.072, 0.2, M.suit));
      const cuff = cyl(0.08, 0.08, 0.05, M.accent, 14); cuff.position.y = -0.31; el.add(cuff);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), M.dark); glove.position.y = -0.4; glove.scale.set(1, 1.2, 0.8); el.add(glove);
      const hp = new THREE.Group(); hp.position.set(0.14 * s, 0.88, 0); g.add(hp); hp.add(seg(0.105, 0.26, M.suit));
      const kn = new THREE.Group(); kn.position.y = -0.43; hp.add(kn); const kj = joint(0.095); kj.rotation.z = Math.PI / 2; kn.add(kj); kn.add(seg(0.09, 0.24, M.suit));
      kn.add(box(0.17, 0.12, 0.32, M.dark, 0, -0.42, 0.05));
      Object.assign(parts, s < 0 ? { shL: sh, elL: el, hpL: hp, knL: kn } : { shR: sh, elR: el, hpR: hp, knR: kn });
    }
    g.userData.parts = parts; shadowAll(g); helmet.castShadow = false; return g;
  }
  function makeRover() {
    const g = new THREE.Group(); g.add(box(2.0, 0.24, 3.4, M.metal, 0, 0.8, 0)); g.add(box(1.9, 0.05, 3.3, M.dark, 0, 0.95, 0)); const wheels = [];
    for (const s of [-1, 1]) { g.add(box(0.62, 0.45, 0.55, M.suit, 0.45 * s, 1.22, 0.2)); g.add(box(0.62, 0.72, 0.1, M.suit, 0.45 * s, 1.55, -0.07));
      for (const z of [-1.25, 0, 1.25]) { const wg = new THREE.Group(); wg.position.set(1.15 * s, 0.45, z); g.add(wg);
        const tire = cyl(0.45, 0.45, 0.32, M.black, 24); tire.rotation.z = Math.PI / 2; wg.add(tire);
        for (let k = 0; k < 8; k++) { const tr = box(0.34, 0.05, 0.1, M.metal); const a = k * Math.PI / 4; tr.position.set(0, Math.cos(a) * 0.45, Math.sin(a) * 0.45); tr.rotation.x = a; wg.add(tr); }
        wheels.push(wg); }
      g.add(box(0.38, 0.04, 3.55, M.accent, 1.15 * s, 0.97, 0)); g.add(box(0.22, 0.1, 0.05, M.glowW, 0.7 * s, 0.86, 1.72)); }
    g.add(box(1.2, 0.32, 0.25, M.dark, 0, 1.22, 0.85)); g.add(box(1.6, 0.42, 0.9, M.suit, 0, 1.18, -1.15));
    const mast = cyl(0.035, 0.035, 1.4, M.metal, 8); mast.position.set(-0.8, 1.7, -1.3); g.add(mast);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 10, 0, Math.PI * 2, 0, Math.PI / 3), M.suit); dish.position.set(-0.8, 2.45, -1.3); dish.rotation.x = -0.6; g.add(dish);
    g.userData.wheels = wheels; shadowAll(g); return g;
  }
  function makeLander() {
    const g = new THREE.Group();
    const body = cyl(2.4, 2.8, 4.4, M.suit, 40); body.position.y = 4.4; g.add(body);
    for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(2.42 + i * 0.13, 2.42 + i * 0.13, 0.06, 40, 1, true), M.dark); r.position.y = 3.2 + i * 1.2; g.add(r); }
    const ring = cyl(2.85, 2.85, 0.35, M.accent, 40); ring.position.y = 2.4; g.add(ring);
    const top = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.2, 40), M.suit); top.position.y = 7.7; g.add(top);
    const foil = cyl(2.9, 2.6, 1.2, M.gold, 40); foil.position.y = 1.7; g.add(foil);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4, leg = cyl(0.12, 0.12, 3.6, M.metal, 10);
      leg.position.set(Math.cos(a) * 3.0, 1.4, Math.sin(a) * 3.0); leg.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); g.add(leg);
      const pad = cyl(0.55, 0.65, 0.12, M.metal, 18); pad.position.set(Math.cos(a) * 3.8, 0.06, Math.sin(a) * 3.8); g.add(pad); }
    g.add(box(1.3, 1.9, 0.2, M.dark, 0, 3.9, 2.55)); g.add(box(1.5, 2.1, 0.12, M.accent, 0, 3.9, 2.5)); g.add(box(1.0, 0.06, 0.05, M.glowG, 0, 5.0, 2.62));
    for (let i = 0; i < 6; i++) g.add(box(0.9, 0.06, 0.06, M.metal, 0, 0.4 + i * 0.5, 3.0 + i * 0.06));
    shadowAll(g); return g;
  }
  // NASA Perseverance (procedural approximation: 3 m long, 2.7 m wide, 2.2 m tall; six 52.5 cm wheels, rocker-bogie, RSM mast, MMRTG)
  function makePerseverance() {
    const g = new THREE.Group();
    g.add(box(1.15, 0.62, 1.75, M.white, 0, 1.0, 0.05));                         // warm electronics box
    g.add(box(1.2, 0.05, 1.8, M.alu, 0, 1.33, 0.05));
    const rtg = new THREE.Group(); rtg.position.set(0, 1.25, -1.05); rtg.rotation.x = 0.55; g.add(rtg);
    const core = cyl(0.21, 0.21, 0.72, M.black, 16); core.rotation.x = Math.PI / 2; rtg.add(core);
    for (let k = 0; k < 8; k++) { const fin = box(0.02, 0.62, 0.6, M.black); fin.rotation.z = k * Math.PI / 8; rtg.add(fin); }
    const mast = cyl(0.05, 0.06, 1.15, M.white, 12); mast.position.set(0.42, 1.88, 0.72); g.add(mast);
    const head = box(0.42, 0.24, 0.22, M.white, 0.42, 2.48, 0.74); g.add(head);
    for (const s of [-1, 1]) g.add(box(0.07, 0.07, 0.04, M.black, 0.42 + 0.12 * s, 2.47, 0.86));
    g.add(box(0.14, 0.14, 0.05, M.dark, 0.42, 2.62, 0.84));                        // SuperCam
    const hga = cyl(0.17, 0.17, 0.04, M.alu, 20); hga.position.set(-0.42, 1.48, -0.5); hga.rotation.x = 1.1; g.add(hga);
    const arm = new THREE.Group(); arm.position.set(-0.35, 1.05, 0.95); g.add(arm);
    const a1 = cyl(0.045, 0.045, 1.0, M.white, 10); a1.rotation.z = Math.PI / 2; a1.position.set(0.3, 0, 0.12); arm.add(a1);
    arm.add(box(0.32, 0.3, 0.3, M.alu, 0.85, -0.05, 0.16));                       // turret
    const wheels = [], zs = [0.95, 0.05, -0.85];
    for (const s of [-1, 1]) {
      const rocker = box(0.06, 0.08, 1.4, M.white, 0.68 * s, 0.82, 0.35); rocker.rotation.x = -0.25; g.add(rocker);
      const bogie = box(0.06, 0.07, 1.0, M.white, 0.68 * s, 0.6, -0.4); bogie.rotation.x = 0.2; g.add(bogie);
      for (const z of zs) { const wg = new THREE.Group(); wg.position.set(0.95 * s, 0.27, z); g.add(wg);
        const tire = cyl(0.262, 0.262, 0.4, M.alu, 28); tire.rotation.z = Math.PI / 2; wg.add(tire);
        for (let k = 0; k < 12; k++) { const gr = box(0.41, 0.025, 0.04, M.dark); const a = k * Math.PI / 6; gr.position.set(0, Math.cos(a) * 0.262, Math.sin(a) * 0.262); gr.rotation.x = a; wg.add(gr); }
        const hub = cyl(0.1, 0.1, 0.42, M.dark, 12); hub.rotation.z = Math.PI / 2; wg.add(hub); wheels.push(wg);
        const leg = cyl(0.03, 0.03, 0.55, M.white, 8); leg.position.set(0.8 * s, 0.55, z); g.add(leg); }
    }
    shadowAll(g); return g;
  }

  // ============================================================================================ FX: rocks (Golombek & Rapp), pebbles, dust, footprints
  let rockSets = [], pebbles = null, rockCenter = null, pebCenter = null, motes = null, prints = null, printIdx = 0, puffs = null; const puffData = [];
  function noise3(x, y, z) { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); }
  function rockGeo(seed, detail = 3) {
    const geo = new THREE.IcosahedronGeometry(1, detail); const pa = geo.attributes.position; const v = new THREE.Vector3();
    const ax = 0.8 + noise3(seed, 1, 2) * 0.5, ay = 0.5 + noise3(seed, 3, 4) * 0.35, az = 0.8 + noise3(seed, 5, 6) * 0.5;
    const planes = Array.from({ length: 7 }, (_, i) => { const n = new THREE.Vector3(noise3(seed, i, 7) - 0.5, noise3(seed, i, 8) - 0.5, noise3(seed, i, 9) - 0.5).normalize(); return { n, d: 0.62 + noise3(seed, i, 10) * 0.3 }; });
    for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i);
      let r = 1 + 0.12 * Math.sin(v.x * 4.1 + seed) * Math.cos(v.z * 3.3 + seed * 2) + 0.06 * Math.sin(v.y * 9.7 + v.x * 7.1);
      v.multiplyScalar(r);
      for (const p of planes) { const d = v.dot(p.n); if (d > p.d) v.addScaledVector(p.n, p.d - d); }   // chipped facets
      v.set(v.x * ax, v.y * ay, v.z * az); if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.2;          // flat, buried base
      pa.setXYZ(i, v.x, v.y, v.z); }
    geo.computeVertexNormals(); return geo;
  }
  function buildFX() {
    const rmat = new THREE.MeshStandardMaterial({ map: tex('tex_rock_albedo.jpg', true, true), normalMap: tex('tex_rock_normal.jpg', false, true), normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.92, envMapIntensity: 0.35 });
    rmat.map.repeat.set(2, 2); rmat.normalMap.repeat.set(2, 2);
    const R = QUAL.ultra.rocksR, maxN = Math.round(Math.PI * R * R * 0.08);
    for (let k = 0; k < 4; k++) { const im = new THREE.InstancedMesh(rockGeo(k * 3.7 + 1, k < 2 ? 3 : 2), rmat, maxN); im.castShadow = true; im.receiveShadow = true; im.setColorAt(0, new THREE.Color(0.5, 0.4, 0.3)); im.count = 0; scene.add(im); rockSets.push(im); }
    pebbles = new THREE.InstancedMesh(rockGeo(9.1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), QUAL.ultra.pebbles); pebbles.setColorAt(0, new THREE.Color(1, 1, 1)); pebbles.count = 0; pebbles.receiveShadow = true; scene.add(pebbles);
    const n = QUAL.ultra.dust, pos = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) pos[i] = (Math.random() - 0.5) * 50;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    motes = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.05, map: softTex(), color: 0xe9c29a, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(motes);
    prints = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.17, 0.33), new THREE.MeshStandardMaterial({ map: printTex(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 1 }), 700);
    prints.count = 0; prints.receiveShadow = true; scene.add(prints);
    const pn = 400, pp = new Float32Array(pn * 3).fill(-1e5), pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    puffs = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.5, map: softTex(), color: 0xc49064, transparent: true, opacity: 0.45, depthWrite: false })); puffs.frustumCulled = false; scene.add(puffs);
    for (let i = 0; i < pn; i++) puffData.push({ life: 0 });
  }
  function softTex() { const n = 64, cv = document.createElement('canvas'); cv.width = cv.height = n; const c = cv.getContext('2d'); const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, n, n); return new THREE.CanvasTexture(cv); }
  function printTex() { const n = 128, cv = document.createElement('canvas'); cv.width = cv.height = n; const c = cv.getContext('2d'); c.fillStyle = 'rgba(40,20,10,0.7)';
    c.beginPath(); c.ellipse(n / 2, n * 0.3, n * 0.22, n * 0.24, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(n / 2, n * 0.72, n * 0.18, n * 0.2, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,220,180,0.22)'; for (let i = 0; i < 9; i++) c.fillRect(n * 0.3, n * (0.1 + i * 0.09), n * 0.4, n * 0.025); return new THREE.CanvasTexture(cv); }
  const hash = (a, b, c) => { const h = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return h - Math.floor(h); };
  // Golombek & Rapp (1997): cumulative fractional area F(D) = k·exp(−q·D), q = 1.79 + 0.152/k; k per 5 m cell is an ASSUMPTION (3–12 %, more on steeper cells)
  function scatterRocks(X0, Z0) {
    const R = Q.rocksR, Dmin = 0.16, cell = 2.0; const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const counts = [0, 0, 0, 0];
    for (let gx = Math.floor((X0 - R) / cell); gx <= Math.floor((X0 + R) / cell); gx++) for (let gz = Math.floor((Z0 - R) / cell); gz <= Math.floor((Z0 + R) / cell); gz++) {
      const cx = gx * cell, cz = gz * cell; if ((cx - X0) ** 2 + (cz - Z0) ** 2 > R * R) continue;
      const lp = Lc(cx, cz), [r, c] = rcOf(lp.x, lp.y), sl = gv('slope', r, c); if (sl === null) continue;
      const de = Math.min(lp.x - AOI.xmin, AOI.xmax - lp.x, lp.y - AOI.ymin, AOI.ymax - lp.y); if (de < EDGE + 5) continue;
      const kAb = clamp(0.03 + sl / 200, 0.03, 0.12), qq = 1.79 + 0.152 / kAb;
      const area = kAb * Math.exp(-qq * Dmin) * cell * cell, meanD = Dmin + 1 / qq, n = area / (Math.PI / 4 * meanD * meanD);
      if (hash(gx, gz, 1) > n) continue;
      if (Math.hypot(lp.x - lander.x, lp.y - lander.y) < 12 || ST.some((st) => Math.hypot(lp.x - st.x, lp.y - st.y) < 4) || (PERS && Math.hypot(lp.x - PERS.x, lp.y - PERS.y) < 6)) continue;
      const kk = Math.floor(hash(gx, gz, 13) * 4), im = rockSets[kk]; if (counts[kk] >= im.instanceMatrix.count) continue;
      const D = Dmin - Math.log(1 - hash(gx, gz, 2) * 0.999) / qq;
      const x = cx + (hash(gx, gz, 3) - 0.5) * cell, z = cz + (hash(gx, gz, 4) - 0.5) * cell;
      p.set(x, groundY(x, z) + D * 0.12, z); e.set((hash(gx, gz, 5) - 0.5) * 0.5, hash(gx, gz, 6) * 6.3, (hash(gx, gz, 7) - 0.5) * 0.5); q.setFromEuler(e);
      const sc = D * 0.5; s.set(sc * (0.85 + hash(gx, gz, 8) * 0.4), sc * (0.8 + hash(gx, gz, 9) * 0.4), sc * (0.85 + hash(gx, gz, 10) * 0.4));
      m.compose(p, q, s); im.setMatrixAt(counts[kk], m); col.setHSL(0.045 + hash(gx, gz, 11) * 0.03, 0.22 + hash(gx, gz, 14) * 0.18, 0.2 + hash(gx, gz, 12) * 0.16); im.setColorAt(counts[kk], col); counts[kk]++;
    }
    rockSets.forEach((im, i) => { im.count = counts[i]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }); rockCenter = [X0, Z0];
  }
  function scatterPebbles(X0, Z0) {
    const R = 26, cell = 0.9, N = Q.pebbles; const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color(); let k = 0;
    for (let gx = Math.floor((X0 - R) / cell); gx <= Math.floor((X0 + R) / cell) && k < N; gx++) for (let gz = Math.floor((Z0 - R) / cell); gz <= Math.floor((Z0 + R) / cell) && k < N; gz++) {
      const cx = gx * cell, cz = gz * cell; if ((cx - X0) ** 2 + (cz - Z0) ** 2 > R * R || hash(gx, gz, 21) > 0.55) continue;
      const x = cx + (hash(gx, gz, 22) - 0.5) * cell, z = cz + (hash(gx, gz, 23) - 0.5) * cell, d = 0.025 + hash(gx, gz, 24) ** 2 * 0.09;
      p.set(x, groundY(x, z) + d * 0.15, z); e.set(hash(gx, gz, 25) * 3, hash(gx, gz, 26) * 6, 0); q.setFromEuler(e); s.set(d, d * 0.6, d * (0.8 + hash(gx, gz, 27) * 0.5));
      m.compose(p, q, s); pebbles.setMatrixAt(k, m); col.setHSL(0.04 + hash(gx, gz, 28) * 0.05, 0.28, 0.12 + hash(gx, gz, 29) * 0.16); pebbles.setColorAt(k, col); k++;
    }
    pebbles.count = k; pebbles.instanceMatrix.needsUpdate = true; if (pebbles.instanceColor) pebbles.instanceColor.needsUpdate = true; pebCenter = [X0, Z0];
  }
  let puffI = 0;
  function puff(x, y, z, n, spread, up) { for (let i = 0; i < n; i++) { const d = puffData[puffI]; puffI = (puffI + 1) % puffData.length;
    Object.assign(d, { x, y: y + 0.05, z, vx: (Math.random() - 0.5) * spread, vy: Math.random() * up, vz: (Math.random() - 0.5) * spread, life: 1.4 + Math.random() }); } }
  function footprint(X, Z, yaw, side) {
    const ox = Math.cos(yaw) * 0.12 * side, oz = -Math.sin(yaw) * 0.12 * side; const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(X + ox, groundY(X + ox, Z + oz) + 0.02, Z + oz), new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, yaw, 'YXZ')), new THREE.Vector3(1, 1, 1));
    prints.setMatrixAt(printIdx, m); printIdx = (printIdx + 1) % 700; prints.count = Math.max(prints.count, printIdx); prints.instanceMatrix.needsUpdate = true;
  }
  function updateFX(dt, st) {
    const a = motes.geometry.attributes.position, cp = camera.position;
    for (let i = 0; i < a.count; i++) { let x = a.getX(i) + dt * 0.8, y = a.getY(i) + Math.sin(i + performance.now() / 1500) * dt * 0.05, z = a.getZ(i) + dt * 0.3;
      if (x - cp.x > 25) x -= 50; if (x - cp.x < -25) x += 50; if (z - cp.z > 25) z -= 50; if (z - cp.z < -25) z += 50; if (y - cp.y > 12) y -= 20; if (y - cp.y < -8) y += 20; a.setXYZ(i, x, y, z); }
    a.needsUpdate = true; motes.material.opacity = 0.12 + 0.35 * clamp((st.elev + 4) / 20, 0, 1); motes.visible = S.phase === 'play';
    const pp = puffs.geometry.attributes.position;
    for (let i = 0; i < puffData.length; i++) { const d = puffData[i]; if (d.life > 0) { d.life -= dt; d.vy -= PHYS.g * 0.15 * dt; d.vx *= 0.97; d.vz *= 0.97; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; pp.setXYZ(i, d.x, d.y, d.z); } else pp.setXYZ(i, 0, -1e5, 0); }
    pp.needsUpdate = true;
    if (!rockCenter || Math.hypot(P.X - rockCenter[0], P.Z - rockCenter[1]) > Q.rocksR * 0.35) scatterRocks(P.X, P.Z);
    if (!pebCenter || Math.hypot(P.X - pebCenter[0], P.Z - pebCenter[1]) > 9) scatterPebbles(P.X, P.Z);
  }

  // ============================================================================================ route ribbon & markers
  const ribbonMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4,
    uniforms: { uW: { value: 1 }, uT: { value: 0 }, uC: { value: new THREE.Color(0xff5a0a) }, uO: { value: 0.85 }, uDone: { value: 0 } },
    vertexShader: `attribute vec2 perp; attribute float side; attribute float dist; uniform float uW; varying float vD; varying float vS;
      void main(){ vec3 p = position + vec3(perp.x, 0.0, perp.y) * side * uW * 0.5; vD = dist; vS = side; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `uniform float uT; uniform vec3 uC; uniform float uO; uniform float uW; uniform float uDone; varying float vD; varying float vS;
      void main(){ float edge = 1.0 - smoothstep(0.55, 1.0, abs(vS)); float pulse = 0.55 + 0.45 * smoothstep(0.75, 1.0, fract((vD - uT) / max(uW * 6.0, 4.0)));
        vec3 c = vD < uDone ? vec3(0.55,0.62,0.5) : uC; gl_FragColor = vec4(c * (0.55 + 0.45*pulse), uO * (0.35 + 0.65 * edge) * (vD < uDone ? 0.35 : 1.0)); }` });
  let ribbon = null;
  function buildRibbon(pts /* [[x,y]] local metres, dense */) {
    if (ribbon) { scene.remove(ribbon); ribbon.geometry.dispose(); ribbon = null; } if (!pts || pts.length < 2) return;
    const dense = []; for (let i = 1; i < pts.length; i++) { const [ax, ay] = pts[i - 1], [bx, by] = pts[i], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 2));
      for (let k = 0; k < n; k++) dense.push([lerp(ax, bx, k / n), lerp(ay, by, k / n)]); } dense.push(pts.at(-1));
    const n = dense.length, pos = new Float32Array(n * 6), perp = new Float32Array(n * 4), side = new Float32Array(n * 2), dist = new Float32Array(n * 2); let cum = 0;
    for (let i = 0; i < n; i++) { const p = W(dense[i][0], dense[i][1]); const y = groundY(p.X, p.Z) + 0.32;
      const a = W(...dense[Math.max(0, i - 1)]), b = W(...dense[Math.min(n - 1, i + 1)]); let dx = b.X - a.X, dz = b.Z - a.Z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      if (i) { const q = W(...dense[i - 1]); cum += Math.hypot(p.X - q.X, p.Z - q.Z); }
      for (let s = 0; s < 2; s++) { const j = i * 2 + s; pos.set([p.X, y, p.Z], j * 3); perp.set([-dz, dx], j * 2); side[j] = s ? 1 : -1; dist[j] = cum; } }
    const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('perp', new THREE.BufferAttribute(perp, 2));
    g.setAttribute('side', new THREE.BufferAttribute(side, 1)); g.setAttribute('dist', new THREE.BufferAttribute(dist, 1)); g.setIndex(idx);
    ribbon = new THREE.Mesh(g, ribbonMat); ribbon.frustumCulled = false; ribbon.renderOrder = 3; scene.add(ribbon);
  }
  function makeFlag(color) { const g = new THREE.Group(); const pole = cyl(0.03, 0.03, 2.6, M.alu, 8); pole.position.y = 1.3; g.add(pole);
    const fl = box(0.7, 0.42, 0.02, new THREE.MeshStandardMaterial({ color, roughness: 0.7, emissive: color, emissiveIntensity: 0.25 }), 0.36, 2.35, 0); g.add(fl);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.9, 120, 16, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.position.y = 60; g.add(beam); g.userData.beam = beam; shadowAll(g); beam.castShadow = false; g.visible = false; scene.add(g); return g; }
  let flagS, flagD;

  // ============================================================================================ world
  let astro, roverObj, landerObj, persObj;
  const place = (obj, x, y, dy = 0) => { const p = W(x, y); obj.position.set(p.X, groundY(p.X, p.Z) + dy, p.Z); };
  function buildWorld() {
    buildTerrain();
    landerObj = makeLander(); place(landerObj, lander.x, lander.y, -0.05); scene.add(landerObj);
    for (const t of D.depot_tubes?.tubes || []) { const tube = cyl(0.035, 0.035, 0.21, M.metal, 12); tube.rotation.set(0, -t.tube_azimuth_deg * D2R + Math.PI / 2, Math.PI / 2, 'YXZ'); place(tube, t.x, t.y, 0.05); tube.castShadow = true; scene.add(tube); }
    if (PERS) { persObj = makePerseverance(); place(persObj, PERS.x, PERS.y, 0); persObj.rotation.y = -((PERS.yaw_deg || 0) * D2R) + Math.PI; scene.add(persObj); }
    astro = makeAstronaut(); astro.visible = false; scene.add(astro);
    roverObj = makeRover(); scene.add(roverObj); roverObj.visible = false;
    flagS = makeFlag(0x86a94a); flagD = makeFlag(0xe0863a);
    buildFX(); worldReady = true;
  }

  // ============================================================================================ POIs & HTML labels
  const POIS = [
    ...ST.map((s) => ({ id: s.id, kind: s.kind, x: s.x, y: s.kind === 'lander' ? s.y - 9 : s.y, name: s.kind === 'lander' ? 'Lander' : s.kind === 'depot' ? 'Three Forks depot' : s.name.split(' —')[0], s })),
    ...(PERS ? [{ id: 'P', kind: 'perseverance', x: PERS.x, y: PERS.y, name: 'Perseverance', sol: PERS.sol }] : []),
  ];
  const poiById = (id) => POIS.find((p) => p.id === id);
  const labelEls = new Map();
  function poiLabel(p) {
    if (labelEls.has(p.id)) return labelEls.get(p.id);
    const el = document.createElement('div'); el.className = 'gsite'; el.innerHTML = `<i></i><div><b></b><small></small></div>`;
    el.onclick = (e) => { e.stopPropagation(); if (S.phase === 'site') pickPOI(p); }; $('#labels').appendChild(el); labelEls.set(p.id, el); return el;
  }
  function updateLabels() {
    const w = innerWidth, h = innerHeight, v = new THREE.Vector3();
    for (const p of POIS) { const el = poiLabel(p); let show = S.phase === 'site' || S.phase === 'play';
      const wp = W(p.x, p.y); v.set(wp.X, groundY(wp.X, wp.Z) + (S.phase === 'site' ? 2 : 3.2), wp.Z);
      const isS = PL.start && PL.start.id === p.id, isD = PL.dest && PL.dest.id === p.id;
      let sub = p.kind === 'station' ? p.id + ' · sample site' : p.kind === 'perseverance' ? `NASA rover · sol ${p.sol} position` : p.kind === 'lander' ? 'Crew lander · safe haven' : 'Sample depot';
      if (S.phase === 'play') { const d = Math.hypot(wp.X - P.X, wp.Z - P.Z); const tgt = isD && S.leg === 'out' || isS && S.leg === 'back'; show = tgt || d < 260; sub = km(d); if (d < 6) show = false; }
      if (show) { v.project(camera); show = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2; }
      el.style.display = show ? '' : 'none'; if (!show) continue;
      el.style.left = `${(v.x * 0.5 + 0.5) * w}px`; el.style.top = `${(-v.y * 0.5 + 0.5) * h}px`;
      el.className = `gsite${isD ? ' active' : ''}${isS ? ' sel' : ''}`; el.querySelector('b').textContent = p.name; el.querySelector('small').textContent = sub;
      el.style.pointerEvents = S.phase === 'site' ? 'auto' : 'none';
    }
  }
  function hideLabels() { for (const el of labelEls.values()) el.style.display = 'none'; }

  // ============================================================================================ SITE PLANNER
  const SC = { tx: -1400, tz: 0, dist: 3600, yaw: 0.35, pitch: 0.95, anim: null };
  function siteCamUpdate(dt) {
    if (SC.anim) { const a = SC.anim; a.t = Math.min(1, a.t + dt / a.dur); const e = 1 - Math.pow(1 - a.t, 3);
      for (const k of ['tx', 'tz', 'dist', 'yaw', 'pitch']) SC[k] = lerp(a.from[k], a.to[k], e); if (a.t >= 1) SC.anim = null; }
    const ty = groundY(SC.tx, SC.tz);
    camera.position.set(SC.tx + Math.sin(SC.yaw) * Math.cos(SC.pitch) * SC.dist, ty + Math.sin(SC.pitch) * SC.dist, SC.tz + Math.cos(SC.yaw) * Math.cos(SC.pitch) * SC.dist);
    camera.lookAt(SC.tx, ty, SC.tz); setAltitudeEnv(camera.position.y - ty);
  }
  function setAltitudeEnv(hAbove) {
    const k = sstep(250, 5000, hAbove);
    scene.fog.density = lerp(0.00022, 0.000009, k);
    const nr = hAbove > 400 ? clamp(hAbove / 800, 0.5, 20) : 0.08, fr = hAbove > 400 ? 400000 : 15000;
    if (camera.near !== nr || camera.far !== fr) { camera.near = nr; camera.far = fr; camera.updateProjectionMatrix(); }
    sky.scale.setScalar(hAbove > 400 ? 40 : 1);
  }
  // ground pick by marching the camera ray against the terrain height
  function pickGround(cx, cy) {
    const ndc = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1), rc = new THREE.Raycaster(); rc.setFromCamera(ndc, camera);
    const o = rc.ray.origin, d = rc.ray.direction; let t = 0, prev = null; const stepL = Math.max(2, SC.dist / 600);
    for (let i = 0; i < 4000; i++) { const p = o.clone().addScaledVector(d, t); const gy = groundY(p.x, p.z);
      if (p.y <= gy) { if (!prev) return null; let a = t - stepL, b = t; for (let k = 0; k < 20; k++) { const m = (a + b) / 2, q = o.clone().addScaledVector(d, m); if (q.y <= groundY(q.x, q.z)) b = m; else a = m; }
        const q = o.clone().addScaledVector(d, b); const l = Lc(q.x, q.z); if (l.x < AOI.xmin + CLAMP_IN || l.x > AOI.xmax - CLAMP_IN || l.y < AOI.ymin + CLAMP_IN || l.y > AOI.ymax - CLAMP_IN) return null; return l; }
      prev = p; t += stepL; }
    return null;
  }
  function pickPOI(p) { setSlot({ id: p.id, kind: p.kind, x: p.x, y: p.y, name: p.name }); }
  function setSlot(pt) {
    AU.click(); PL[PL.active] = pt;
    if (PL.active === 'start' && !PL.dest) PL.active = 'dest'; else if (PL.active === 'dest' && !PL.start) PL.active = 'start';
    computePlan(); renderPlanner();
  }
  function geologyAt(x, y) {
    for (const f of D.geology?.features || []) { const g = f.geometry; const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const poly of polys) { const ring = poly[0]; let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } if (inside) return f; } }
    return null;
  }
  function legStats(cells) { let h = 0, len = 0;
    for (let i = 1; i < cells.length; i++) { const a = cells[i - 1], b = cells[i], diag = ((a / NC) | 0) !== ((b / NC) | 0) && a % NC !== b % NC, d = CELL * (diag ? Math.SQRT2 : 1);
      const gr = Math.atan2(elev[b] - elev[a], d) / D2R; h += d / 1000 / paceKmh(Math.max(0, gr)); len += d; }
    return { h, len }; }
  const taskH = (pt) => pt.kind === 'depot' ? 0.5 : pt.kind === 'station' ? 25 / 60 : pt.kind === 'perseverance' ? 15 / 60 : 10 / 60;
  function computePlan() {
    PL.plan = null; flagS.visible = !!PL.start; flagD.visible = !!PL.dest;
    if (PL.start) place(flagS, PL.start.x, PL.start.y); if (PL.dest) place(flagD, PL.dest.x, PL.dest.y);
    if (!PL.start || !PL.dest) { buildRibbon(null); return; }
    if (hazard.theta !== S.theta) hazard.setTheta(S.theta);
    const [r0, c0] = rcOf(PL.start.x, PL.start.y), [r1, c1] = rcOf(PL.dest.x, PL.dest.y);
    const a = RT.snap(routeGrid, r0, c0, S.theta, 40), b = RT.snap(routeGrid, r1, c1, S.theta, 40);
    if (!a || !b) { PL.plan = { error: !a ? 'Start is on ground steeper than the suit limit' : 'Destination is on ground steeper than the suit limit' }; buildRibbon(null); return; }
    const t0 = performance.now(); const res = RT.astar(routeGrid, a.r, a.c, b.r, b.c, S.theta);
    if (res.error) { PL.plan = { error: 'No walkable route at this slope limit' }; buildRibbon(null); return; }
    const cells = Array.from(res.cells), out = legStats(cells), back = legStats(cells.slice().reverse()), tH = taskH(PL.dest);
    const total = out.h + tH + back.h, o2g = o2Lph(PHYS.W_design) * total * O2_G_PER_L;
    const st = M24.at(new Date(departUtc())), sun = M24.sunTimes(new Date(departUtc())), arrive = PL.dep + total;
    const margin = SIZE_H - total - PHYS.reserveH, dark = sun.sunsetLtst !== null && arrive > sun.sunsetLtst;
    const issues = []; let level = 'go';
    if (total > PHYS.evaH) { level = 'nogo'; issues.push(`Round trip ${hm(total)} exceeds the 8 h NASA suit requirement`); }
    else if (margin < 0.75) { level = 'cond'; issues.push(`Only ${hm(margin)} of life support to spare`); }
    if (dark) { level = 'nogo'; issues.push(`You would return after sunset (${M24.fmtH(sun.sunsetLtst)})`); }
    if (cmeNear(departUtc()).length) { if (level === 'go') level = 'cond'; issues.push('NASA DONKI: a CME reaches Mars within 24 h'); }
    if (res.maxSlope > S.theta - 2) { if (level === 'go') level = 'cond'; issues.push(`Route reaches ${fmt(res.maxSlope, 1)}°, close to the ${S.theta}° suit limit`); }
    const pts = cells.map(xyOfIdx); hazard.setRoute(cells); const hzr = hazard.scanRoute(pts);
    PL.plan = { hzr, cells, pts, out, back, total, o2g, margin, arrive, sun, st, level, issues, maxSlope: res.maxSlope, ms: performance.now() - t0, snapS: a.dispM, snapD: b.dispM };
    buildRibbon(RT.simplify(pts, 1.5));
  }
  function departUtc() { const sol = M24.at(new Date()).sol; return M24.utcForLtst(sol, PL.dep).getTime(); }
  function renderPlanner() {
    const p = PL.plan, slot = (k, n, label) => { const v = PL[k];
      return `<div class="slot ${k === 'start' ? 's' : 'd'}${PL.active === k ? ' active' : ''}" data-slot="${k}"><span class="n">${n}</span><div><small>${label}</small><b>${v ? esc(v.name) : 'Click the map or pick below'}</b></div></div>`; };
    const st = M24.at(new Date(departUtc()));
    let body = '';
    if (p && !p.error) {
      const v = { go: 'Go', cond: 'Go with caution', nogo: 'No-go' }[p.level];
      body = `<dl class="stats"><dt>Walk out</dt><dd>${km(p.out.len)} · ${hm(p.out.h)}</dd><dt>Round trip</dt><dd>${hm(p.total)}</dd>
        <dt>Oxygen needed</dt><dd>${fmt(p.o2g)} of ${fmt(CAP.o2kg * 1000)} g</dd><dt>Steepest slope</dt><dd>${fmt(p.maxSlope, 1)}°</dd>
        <dt>Back at</dt><dd>${M24.fmtH(p.arrive)} · sunset ${M24.fmtH(p.sun.sunsetLtst)}</dd></dl>
        ${hzRouteHtml(p.hzr)}
        <div class="verdict ${p.level}">${v}${p.issues.length ? `<small>${p.issues.map(esc).join('<br>')}</small>` : '<small>Within suit, daylight and slope limits</small>'}</div>`;
    } else if (p?.error) body = `<div class="verdict nogo">No route<small>${esc(p.error)}</small></div>`;
    $('#planner').innerHTML = `<button class="back" id="pl-back">‹ Globe</button>
      <div><h2>Jezero Crater</h2><div class="coords">Sol ${st.sol} · EVA planner</div></div>
      ${slot('start', 1, 'Start')}${slot('dest', 2, 'Destination')}
      <div class="chips">${POIS.map((q) => `<button data-poi="${q.id}">${esc(q.kind === 'station' ? q.id + ' ' + q.name.split(' ')[0] : q.name)}</button>`).join('')}</div>
      <div class="row"><span>Suit slope limit</span><div class="seg" id="pl-theta">${[15, 20, 25].map((t) => `<button data-t="${t}" class="${S.theta === t ? 'on' : ''}">${t}°</button>`).join('')}</div></div>
      <div class="row"><span>Depart (local solar time)</span><select id="pl-dep">${[7, 8, 9, 10, 11, 12, 13, 14].map((h) => `<option value="${h}" ${PL.dep === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></div>
      ${body}<div class="spacer"></div>
      <button class="btn go" id="pl-go" ${p && !p.error ? '' : 'disabled'}>Begin EVA</button>
      <div class="note">Routes: A* on NASA HiRISE 5 m slopes, ${S.theta}° suit limit. Times: Apollo walking pace. Oxygen: NASA 1,000 Btu/h work rate.</div>`;
    $('#planner').querySelectorAll('[data-slot]').forEach((el) => el.onclick = () => { PL.active = el.dataset.slot; renderPlanner(); hintPlan(); });
    $('#planner').querySelectorAll('[data-poi]').forEach((el) => el.onclick = () => pickPOI(poiById(el.dataset.poi)));
    $('#pl-theta').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.theta = +b.dataset.t; computePlan(); renderPlanner(); };
    $('#pl-dep').onchange = (e) => { PL.dep = +e.target.value; computePlan(); renderPlanner(); };
    $('#pl-back').onclick = () => toGlobe();
    $('#pl-go').onclick = () => beginEVA();
    hintPlan();
  }
  function hzRouteHtml(h) {
    if (!h) return ''; const row = (k, name) => { const r = h[k]; if (!r) return `<dt>${name}</dt><dd>none nearby</dd>`;
      return `<dt>${name}</dt><dd>closest ${fmt(r.closest)} m${r.withinWarnM > 0 ? ` · ${km(r.withinWarnM)} within ${hazard.cfg.levels.warning} m` : ''}</dd>`; };
    return `<dl class="stats"><dt style="grid-column:1/-1;color:var(--ink)">Hazards along this route</dt>${row('steep', `Slope > ${S.theta}° (DEM)`)}${row('relief', 'Sharp steps ≥ 4 m (DEM)')}${row('nodata', 'No terrain data')}</dl>`;
  }
  function hintPlan() { $('#plan-hint').textContent = PL.active === 'start' ? 'Click the ground or a marker to set your start' : 'Click the ground or a marker to set your destination'; }
  // site input
  { const pts = new Map(); let moved = 0, pinch = null, btn = 0;
    canvas.addEventListener('pointerdown', (e) => { if (S.phase !== 'site') return; pts.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; btn = e.button; SC.anim = null;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), dist: SC.dist }; } });
    addEventListener('pointermove', (e) => { if (S.phase !== 'site' || !pts.has(e.pointerId)) return; const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1]; moved += Math.abs(dx) + Math.abs(dy);
      if (pts.size === 2 && pinch) { const [a, b] = [...pts.values()]; SC.dist = clamp(pinch.dist * pinch.d / Math.hypot(a[0] - b[0], a[1] - b[1]), 150, 9000); return; }
      if (btn === 2 || e.shiftKey) { SC.yaw -= dx * 0.005; SC.pitch = clamp(SC.pitch + dy * 0.004, 0.35, 1.45); return; }
      const k = SC.dist / innerHeight * 1.1, cy = Math.cos(SC.yaw), sy = Math.sin(SC.yaw);
      SC.tx = clamp(SC.tx - (dx * cy + dy * sy) * k, AOI.xmin - CX, AOI.xmax - CX); SC.tz = clamp(SC.tz - (-dx * sy + dy * cy) * k, -(AOI.ymax - CY), -(AOI.ymin - CY)); });
    addEventListener('pointerup', (e) => { if (S.phase !== 'site' || !pts.has(e.pointerId)) return; pts.delete(e.pointerId); if (pts.size < 2) pinch = null;
      if (moved < 6 && e.target === canvas) { const l = pickGround(e.clientX, e.clientY); if (l) setSlot({ id: null, kind: 'point', x: l.x, y: l.y, name: `Point ${fmt(l.x)} E, ${fmt(l.y)} N` }); } });
    canvas.addEventListener('wheel', (e) => { if (S.phase !== 'site') return; SC.anim = null; SC.dist = clamp(SC.dist * (e.deltaY > 0 ? 1.12 : 0.89), 150, 9000); }, { passive: true });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ============================================================================================ PHASES & TRANSITIONS
  function setPhase(ph) {
    S.phase = ph; document.body.className = document.body.className.replace(/phase-\w+/g, '').trim() + ` phase-${ph}` + (TOUCH ? ' touch' : '') + (S.view === 'fp' ? ' fp' : '');
    $('#globe-ui').classList.toggle('hidden', ph !== 'globe'); $('#plan-ui').classList.toggle('hidden', ph !== 'site'); $('#hud').classList.toggle('hidden', ph !== 'play');
    showGlobeMarks(ph === 'globe'); if (ph !== 'site' && ph !== 'play') hideLabels(); if (ph !== 'play') hazardOff();
  }
  function flashFx(peak = 0.5, ms = 380) { const fx = $('#fx'); fx.style.transition = 'none'; fx.style.opacity = peak; requestAnimationFrame(() => { fx.style.transition = `opacity ${ms}ms ease-out`; fx.style.opacity = 0; }); }
  const seqs = []; // simple timeline runner
  function runSeq(steps, done) { seqs.push({ steps, i: 0, t: 0, done }); }
  function tickSeqs(dt) { for (let k = seqs.length - 1; k >= 0; k--) { const q = seqs[k], s = q.steps[q.i]; if (!s) { seqs.splice(k, 1); q.done && q.done(); continue; }
    if (q.t === 0 && s.start) s.start(); q.t += dt; const e = clamp(q.t / s.dur, 0, 1); s.tick && s.tick(s.ease ? s.ease(e) : e); if (e >= 1) { s.end && s.end(); q.i++; q.t = 0; } } }
  const easeIO = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, easeIn = (t) => t * t * t, easeOut = (t) => 1 - Math.pow(1 - t, 3);
  function toGlobe() { GL.entering = false; $('#fx').style.opacity = 0; setPhase('globe'); GL.tDist = 2.4; $('#site-card').classList.add('hidden'); flagS.visible = flagD.visible = false; buildRibbon(null); }
  function enterSite() {
    AU.whoosh(); $('#site-card').classList.add('hidden'); showGlobeMarks(false); GL.entering = true; $('#globe-ui').classList.add('hidden');
    const f = GL.fly = { lon: 77.45, lat: 18.44, dist: 1.04, t: 0 }; void f;
    runSeq([{ dur: 1.1, ease: easeIn, tick: (e) => { $('#fx').style.opacity = e * 0.9; } }], () => {
      setPhase('site'); PL.start = PL.start || { ...poiById('L0') }; PL.active = PL.dest ? 'start' : 'dest';
      Object.assign(SC, { tx: -1350, tz: 80, dist: 42000, yaw: 0.3, pitch: 1.35 }); SC.anim = { t: 0, dur: 2.2, from: { ...SC }, to: { tx: -1350, tz: 80, dist: 3400, yaw: 0.35, pitch: 0.95 } };
      computePlan(); renderPlanner(); flashFx(0.9, 900);
    });
  }
  function beginEVA(opts = {}) {
    if (!PL.plan || PL.plan.error) return; AU.start();
    S.sim = departUtc(); S.evaStart = S.sim; S.leg = 'out'; S.done = new Set(); S.trail = []; S.walked = 0; S.over = false; S.auto = false;
    S.res = { o2: CAP.o2kg, co2: 0, h2o: CAP.h2okg, wh: CAP.wh, integ: 1, dose: 0 };
    setLeg(PL.plan.pts);
    const p0 = W(PL.plan.pts[0][0], PL.plan.pts[0][1]); P.X = p0.X; P.Z = p0.Z; P.Y = groundY(P.X, P.Z); P.vy = 0; P.vx = P.vz = 0;
    const p1 = W(...PL.plan.pts[Math.min(6, PL.plan.pts.length - 1)]); P.yaw = P.camYaw = Math.atan2(-(p1.X - P.X), -(p1.Z - P.Z)); P.camPitch = -0.12;
    const park = D.rover?.scenarios?.[Number(S.theta).toFixed(1)]; if (S.rover && park) { const w = W(park.park_xy[0] + 8, park.park_xy[1] + 6); P.rover.X = w.X; P.rover.Z = w.Z; P.rover.yaw = 0.6; roverObj.visible = true; }
    S.mode = 'walk'; astro.visible = true; scatterRocks(P.X, P.Z); scatterPebbles(P.X, P.Z);
    if (opts.instant) { setPhase('play'); setAltitudeEnv(2); camera.position.set(P.X + Math.sin(P.camYaw) * 6.5, P.Y + 2.4, P.Z + Math.cos(P.camYaw) * 6.5); onPlayStart(); return; }
    startSwitch();
  }
  // character-switch style descent: pull up over the start, drop in three steps, settle behind the astronaut
  function startSwitch() {
    setPhase('switch'); hideLabels();
    const from = camera.position.clone(), look0 = new THREE.Vector3(SC.tx, groundY(SC.tx, SC.tz), SC.tz), gy = P.Y;
    const at = (h) => new THREE.Vector3(P.X, gy + h, P.Z + h * 0.06);
    const target = new THREE.Vector3(P.X, gy, P.Z); let a = from.clone(), lookA = look0.clone();
    const move = (to, lookTo, dur, ease, sfx) => ({ dur, ease, start() { a = camera.position.clone(); lookA = curLook.clone(); if (sfx) AU.whoosh(); canvas.style.filter = 'blur(4px) saturate(0.6)'; },
      tick(e) { camera.position.lerpVectors(a, to, e); curLook.lerpVectors(lookA, lookTo, e); camera.lookAt(curLook); setAltitudeEnv(camera.position.y - gy); },
      end() { canvas.style.filter = ''; if (sfx) { AU.thud(); flashFx(0.28, 300); } } });
    const hold = (dur) => ({ dur, tick() { camera.lookAt(curLook); } });
    const curLook = look0.clone();
    const head = new THREE.Vector3(P.X, P.Y + 1.68, P.Z);
    const fin = head.clone().add(new THREE.Vector3(Math.sin(P.camYaw) * 6.5 + Math.cos(P.camYaw) * 0.55, 0.5 + Math.sin(0.12) * 6.5, Math.cos(P.camYaw) * 6.5 - Math.sin(P.camYaw) * 0.55));
    runSeq([move(at(2600), target, 1.0, easeIO, true), hold(0.25), move(at(650), target, 0.42, easeIn, true), hold(0.22), move(at(140), target, 0.42, easeIn, true), hold(0.2),
      { dur: 1.0, ease: easeOut, start() { a = camera.position.clone(); lookA = curLook.clone(); AU.whoosh(); canvas.style.filter = 'blur(3px) saturate(0.7)'; },
        tick(e) { camera.position.lerpVectors(a, fin, e); curLook.lerpVectors(lookA, head.clone().add(new THREE.Vector3(Math.cos(P.camYaw) * 0.55, 0, -Math.sin(P.camYaw) * 0.55)), e); camera.lookAt(curLook); setAltitudeEnv(camera.position.y - gy); if (e > 0.6) canvas.style.filter = ''; } }],
    () => { setPhase('play'); onPlayStart(); });
  }
  function onPlayStart() { canvas.style.filter = ''; flashFx(0.18, 400); clock.getDelta(); setAltitudeEnv(2);
    flash(TOUCH ? 'Stick to walk · Auto follows the route · map top right' : 'WASD walk · Shift run · F follow route · M map · Esc menu', 'info', 7); }
  function setLeg(pts) { S.legPath = pts.map(([x, y]) => W(x, y)); S.legIdx = 0; buildRibbon(RT.simplify(pts, 1.5)); }

  // ============================================================================================ PLAYER & INPUT
  const P = { X: 0, Z: 0, Y: 0, vy: 0, vx: 0, vz: 0, yaw: 0, camYaw: 0, camPitch: -0.12, camDist: 6.5, onGround: true, phase: 0, lastStep: 0, speed: 0, run: false,
    rover: { X: 0, Z: 0, yaw: 0, v: 0 }, upDeg: 0, blocked: false, edge: false, shake: 0 };
  const keys = new Set(); const joy = { x: 0, y: 0, active: false };
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase(); AU.start();
    if (S.phase !== 'play') return;
    if (!$('#mapview').classList.contains('hidden')) { if (k === 'm' || k === 'escape') toggleMap(false); return; }
    if (!$('#modal').classList.contains('hidden')) { if (k === 'escape' || k === 'enter' || k === 'e') { const b = $('#modal-actions .btn'); b ? b.click() : closeModal(); } return; }
    if (!$('#menu').classList.contains('hidden')) { if (k === 'escape' || k === 'p') toggleMenu(false); return; }
    keys.add(k);
    if (k === ' ') { e.preventDefault(); jump(); }
    if (k === 'e') interact(); if (k === 'v') toggleView(); if (k === 'm') toggleMap(true); if (k === 'escape' || k === 'p') toggleMenu(true);
    if (k === 'f') toggleAuto(); if (k === 't') cycleSpeed(); if (k === 'r') { SET.guide = !SET.guide; if (ribbon) ribbon.visible = SET.guide; flash(SET.guide ? 'Route guide on' : 'Route guide off', 'info'); }
    if (k === 'n') setAlarmMute(!SET.alarmMute);
    if (k === 'l') { S.headlamp = !S.headlamp; flash(S.headlamp ? 'Helmet lights on' : 'Helmet lights auto', 'info'); }
    if (k === 'shift') P.run = true;
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) S.lastManual = performance.now();
  });
  addEventListener('keyup', (e) => { const k = (e.key || '').toLowerCase(); keys.delete(k); if (k === 'shift') P.run = false; });
  addEventListener('blur', () => { keys.clear(); P.run = false; });
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { if (S.phase !== 'play' || S.paused) return; AU.start();
    if (S.view === 'fp' && !TOUCH && document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } });
  canvas.addEventListener('pointermove', (e) => { if (S.phase !== 'play') return; if (document.pointerLockElement === canvas) { look(e.movementX, e.movementY); return; }
    if (drag && e.pointerId === drag.id) { look(e.clientX - drag.x, e.clientY - drag.y, 2.2); drag.x = e.clientX; drag.y = e.clientY; } });
  canvas.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.id) drag = null; });
  canvas.addEventListener('wheel', (e) => { if (S.phase === 'play' && S.view === 'tp') P.camDist = clamp(P.camDist * (e.deltaY > 0 ? 1.12 : 0.89), 2.5, 40); }, { passive: true });
  function look(dx, dy, k = 1) { S.lastLook = performance.now(); P.camYaw -= dx * 0.0024 * k; P.camPitch = clamp(P.camPitch - dy * 0.0022 * k, S.view === 'fp' ? -1.35 : -1.2, S.view === 'fp' ? 1.2 : 0.4); }
  const stick = $('#stick'), knob = $('#knob');
  stick.addEventListener('pointerdown', (e) => { joy.active = true; joy.id = e.pointerId; try { stick.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } moveJoy(e); });
  stick.addEventListener('pointermove', (e) => { if (joy.active && e.pointerId === joy.id) moveJoy(e); });
  const endJoy = () => { joy.active = false; joy.x = joy.y = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', endJoy); stick.addEventListener('pointercancel', endJoy);
  function moveJoy(e) { const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
    let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } joy.x = dx; joy.y = -dy; S.lastManual = performance.now(); knob.style.transform = `translate(${dx * 36}px, ${dy * 36}px)`; }
  const hold = (id, on) => { $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); AU.start(); on(); }); };
  hold('#t-run', () => { P.run = !P.run; $('#t-run').classList.toggle('on', P.run); }); hold('#t-use', () => interact()); hold('#t-auto', () => toggleAuto());
  $('#b-map').onclick = () => toggleMap(true); $('#b-menu').onclick = () => toggleMenu(true); $('#b-alarm').onclick = () => { AU.start(); setAlarmMute(!SET.alarmMute); };
  function setAlarmMute(m) { SET.alarmMute = m; store.set('alarmMute', m); hzAudio.setMuted(m); $('#b-alarm').classList.toggle('muted', m); flash(m ? 'Hazard alarm muted (visual warnings stay on)' : 'Hazard alarm on', 'info', 2); }
  $('#b-alarm').classList.toggle('muted', SET.alarmMute);
  function toggleAuto() { S.auto = !S.auto; $('#t-auto').classList.toggle('on', S.auto); flash(S.auto ? 'Following the planned route' : 'Manual walking', 'info', 2); }
  function cycleSpeed() { const o = [10, 30, 60]; S.speed = o[(o.indexOf(S.speed) + 1) % o.length]; SET.speed = S.speed; store.set('speed', S.speed); flash(`Time and travel ×${S.speed}`, 'info'); }
  function toggleView() { S.view = S.view === 'tp' ? 'fp' : 'tp'; SET.view = S.view; store.set('view', S.view); document.body.classList.toggle('fp', S.view === 'fp'); if (S.view === 'tp' && document.pointerLockElement) document.exitPointerLock(); }
  function jump() { if (S.mode !== 'walk' || !P.onGround || S.paused) return; P.vy = 2.6; P.onGround = false; S.jumpW = 1; }

  // ============================================================================================ SIMULATION
  const clock = new THREE.Clock(); const flashes = [];
  function flash(text, kind = 'warn', secs = 3) { flashes.push({ text, kind, until: performance.now() + secs * 1000 }); }
  const state = () => M24.at(new Date(S.sim));
  const sunCache = {};
  function sunTimes() { const sol = M24.at(new Date(S.sim)).sol; return sunCache[sol] || (sunCache[sol] = M24.sunTimes(new Date(S.sim))); }
  function haven(X, Z) { const p = Lc(X, Z); const [r, c] = rcOf(p.x, p.y); const kp = S.rover && D.rover ? `haven_phys_${S.theta}` : `walkback_phys_${S.theta}`; let best = null;
    for (let d = 0; d <= 4 && !best; d++) for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) { const v = gv(kp, r + dr * 2, c + dc * 2); if (v !== null && (!best || v < best.phys)) best = { phys: v + d * 2 * CELL }; }
    return best; }
  const airTemp = (st) => medaAt('T', st.lmst) ?? 210;
  function heaterW(T, st) { return Math.max(0, 245 - T) * 0.9 + (S.headlamp || st.elev < 2 ? 8 : 0); }
  const angLerp = (a, b, t) => { let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
  function autoDir() {   // look-ahead point on the planned leg
    const L = S.legPath; if (!L || !L.length) return null; let best = S.legIdx, bd = Infinity;
    for (let i = Math.max(0, S.legIdx - 10); i < Math.min(L.length, S.legIdx + 60); i++) { const d = (L[i].X - P.X) ** 2 + (L[i].Z - P.Z) ** 2; if (d < bd) { bd = d; best = i; } }
    S.legIdx = best; const t = L[Math.min(L.length - 1, best + 3)]; const dx = t.X - P.X, dz = t.Z - P.Z, d = Math.hypot(dx, dz);
    if (best >= L.length - 2 && d < 4) return null; return d > 0.01 ? [dx / d, dz / d] : null;
  }
  function step(dt) {
    const k = S.speed, dts = dt * k, dh = dts / 3600; S.sim += dts * 1000; const st = state();
    let mx = 0, mz = 0;
    if (keys.has('w') || keys.has('arrowup')) mz += 1; if (keys.has('s') || keys.has('arrowdown')) mz -= 1;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1; if (keys.has('d') || keys.has('arrowright')) mx += 1;
    if (joy.active) { mx += joy.x; mz += joy.y; }
    let mag = Math.min(1, Math.hypot(mx, mz)), dir = null;
    if (mag > 0.05) { const ang = P.camYaw - Math.atan2(mx, mz); dir = [-Math.sin(ang), -Math.cos(ang)]; }
    else if (S.auto && S.mode === 'walk') { dir = autoDir(); mag = dir ? 1 : 0; if (!dir && S.auto) { S.auto = false; $('#t-auto').classList.remove('on'); } }
    let Wm = PHYS.W_rest, vPhys = 0;
    if (S.mode === 'walk') {
      P.blocked = false; let tvx = 0, tvz = 0;
      if (dir) { const [dx, dz] = dir; const ahead = groundY(P.X + dx * 2, P.Z + dz * 2) - groundY(P.X, P.Z); P.upDeg = Math.atan2(ahead, 2) / D2R;
        let f = paceKmh(Math.max(0, P.upDeg)) / 2.7;
        if (P.upDeg > S.theta + 2) { f = 0; P.blocked = true; } else if (P.upDeg < -(S.theta + 4)) f *= 0.55;
        if (S.res.h2o <= 0) f *= 0.5;
        vPhys = (P.run ? PHYS.vLope : PHYS.vWalk) * mag * f; tvx = dx * vPhys * k; tvz = dz * vPhys * k;
        if (vPhys > 0.01) P.yaw = S.view === 'fp' ? P.camYaw : angLerp(P.yaw, Math.atan2(-dx, -dz), 1 - Math.exp(-dt * 9));
      } else P.upDeg = 0;
      const acc = 1 - Math.exp(-dt * (dir ? 7 : 9)); P.vx = lerp(P.vx, tvx, acc); P.vz = lerp(P.vz, tvz, acc);   // smooth start/stop
      const lim = { x0: AOI.xmin - CX + CLAMP_IN, x1: AOI.xmax - CX - CLAMP_IN, z0: -(AOI.ymax - CY) + CLAMP_IN, z1: -(AOI.ymin - CY) - CLAMP_IN };
      const nx = clamp(P.X + P.vx * dt, lim.x0, lim.x1), nz = clamp(P.Z + P.vz * dt, lim.z0, lim.z1); P.edge = nx !== P.X + P.vx * dt || nz !== P.Z + P.vz * dt;
      const moved = Math.hypot(nx - P.X, nz - P.Z); S.walked += moved; P.X = nx; P.Z = nz; P.speed = moved / Math.max(dt, 1e-6);
      const vNow = P.speed / k; if (!dir) vPhys = vNow;
      const gy = groundY(P.X, P.Z); P.vy -= PHYS.g * dt; P.Y += P.vy * dt;
      if (P.Y <= gy) { if (!P.onGround) { puff(P.X, gy, P.Z, 14, 1.4, 0.8); P.shake = Math.min(1, -P.vy / 4); AU.step(true); if (P.vy < -3.4) { S.res.integ = Math.max(0, S.res.integ - 0.06); flash('Hard landing — suit seal damaged, small leak', 'bad'); } }
        P.Y = gy; P.vy = 0; P.onGround = true; }
      Wm = metabolic(vPhys, P.upDeg) + S.jumpW * 300; S.jumpW = Math.max(0, S.jumpW - dt * 2);
      P.phase += vNow * k * dt * (P.run ? 2.2 : 3.2) / Math.max(1, k * 0.3);
      if (P.onGround && vNow > 0.05 && Math.floor(P.phase / Math.PI) !== P.lastStep) { P.lastStep = Math.floor(P.phase / Math.PI); footprint(P.X, P.Z, P.yaw, P.lastStep % 2 ? 1 : -1); AU.step(false); if (Math.random() < 0.5) puff(P.X, gy, P.Z, 3, 0.5, 0.35); }
      // camera follows the walking direction when the player is not steering the view
      if (S.view === 'tp' && vNow > 0.2 && performance.now() - S.lastLook > 1800) P.camYaw = angLerp(P.camYaw, P.yaw, 1 - Math.exp(-dt * 1.1));
    } else {
      const R = P.rover; const thr = mz > 0 ? 1 : mz < 0 ? -0.6 : 0;
      R.v = lerp(R.v, thr * Math.max(mag, Math.abs(mz)) * PHYS.roverKmh / 3.6, 1 - Math.exp(-dt * 1.5)); R.yaw += -mx * dt * 0.9 * clamp(R.v / 2, -1, 1) * Math.sqrt(k) / 1.5;
      const dx = -Math.sin(R.yaw), dz = -Math.cos(R.yaw), sg = Math.sign(R.v || 1);
      const ahead = groundY(R.X + dx * 3 * sg, R.Z + dz * 3 * sg) - groundY(R.X, R.Z); P.upDeg = Math.atan2(ahead, 3) / D2R; P.blocked = P.upDeg > PHYS.roverSlope;
      if (!P.blocked) { const nx = clamp(R.X + dx * R.v * k * dt, AOI.xmin - CX + CLAMP_IN, AOI.xmax - CX - CLAMP_IN), nz = clamp(R.Z + dz * R.v * k * dt, -(AOI.ymax - CY) + CLAMP_IN, -(AOI.ymin - CY) - CLAMP_IN);
        S.walked += Math.hypot(nx - R.X, nz - R.Z); R.X = nx; R.Z = nz; } else R.v = 0;
      P.speed = Math.abs(R.v) * k; vPhys = Math.abs(R.v); P.X = R.X; P.Z = R.Z; P.Y = groundY(R.X, R.Z) + 0.85; P.yaw = R.yaw; Wm = 150;
      if (Math.abs(R.v) > 0.5 && Math.random() < 0.8) for (const s of [-1, 1]) puff(R.X - dx * 1.6 + Math.cos(R.yaw) * 1.1 * s, groundY(R.X, R.Z), R.Z - dz * 1.6 - Math.sin(R.yaw) * 1.1 * s, 2, 1.0, 0.7);
      const rf = dh / 0.67; S.res.o2 = Math.min(CAP.o2kg, S.res.o2 + CAP.o2kg * rf); S.res.co2 = Math.max(0, S.res.co2 - CAP.co2kg * rf); S.res.h2o = Math.min(CAP.h2okg, S.res.h2o + CAP.h2okg * rf); S.res.wh = Math.min(CAP.wh, S.res.wh + CAP.wh * rf);
    }
    // life support per simulated hour
    const T = airTemp(st), leak = (1 - S.res.integ) * 1.5, sunUp = st.elev > 0;
    S.wAvg = lerp(S.wAvg, Wm, 1 - Math.exp(-dts / 300)); S.wNow = Wm;
    const o2L = o2Lph(Wm) * dh;
    S.res.o2 -= (o2L * O2_G_PER_L / 1000) * (1 + leak); S.res.co2 += o2L * PHYS.RQ * CO2_G_PER_L / 1000;
    const heat = Math.max(30, Wm + (sunUp ? 60 * Math.sin(st.elev * D2R) : 0) - Math.max(0, 250 - T) * 0.8);
    S.res.h2o -= heat * 3600 * dh / PHYS.Lsub; S.res.wh -= (PHYS.powerW * 0.6 + 0.08 * Wm + heaterW(T, st)) * dh;
    S.res.dose += (PHYS.RAD / 24) * (cmeNear(S.sim).length ? 3 : 1) * dh;
    S.res.o2 = clamp(S.res.o2, 0, CAP.o2kg); S.res.co2 = clamp(S.res.co2, 0, CAP.co2kg); S.res.h2o = clamp(S.res.h2o, 0, CAP.h2okg); S.res.wh = clamp(S.res.wh, 0, CAP.wh);
    if (S.res.o2 <= 0) return endGame(false, 'Oxygen ran out before reaching a safe haven.');
    if (S.res.co2 >= CAP.co2kg) return endGame(false, 'The CO₂ scrubber saturated before reaching a safe haven.');
    if (S.res.wh <= 0) return endGame(false, 'Suit power ran out: no heating, fans or radio.');
    if (!S.trail.length || Math.hypot(S.trail.at(-1)[0] - P.X, S.trail.at(-1)[1] - P.Z) > 6) S.trail.push([P.X, P.Z]);
  }
  function lifeHours(Wr) { const leak = (1 - S.res.integ) * 1.5, o2h = S.res.o2 / ((o2Lph(Wr) * O2_G_PER_L / 1000) * (1 + leak)), co2h = (CAP.co2kg - S.res.co2) / (o2Lph(Wr) * PHYS.RQ * CO2_G_PER_L / 1000); return { o2h, co2h, h: Math.min(o2h, co2h) }; }
  function predict() {
    const st = state(), h = haven(P.X, P.Z); const etaH = h ? h.phys / 1000 / 2.4 + 0.25 : null; const life = lifeHours(PHYS.W_design);
    const margin = etaH === null ? null : life.h - etaH - PHYS.reserveH;
    const sun = sunTimes(); let toSunset = sun.sunsetLtst !== null ? sun.sunsetLtst - st.ltst : null; if (toSunset !== null && toSunset < -6) toSunset += 24;
    const evaH = S.evaStart ? (S.sim - S.evaStart) / 3600e3 : 0;
    let level = margin !== null && margin < 0 ? 'nogo' : margin !== null && margin < 0.75 ? 'cond' : 'go';
    if (toSunset !== null && etaH !== null && toSunset - etaH < 0) level = 'nogo';
    return { st, h, etaH, life, margin, sun, toSunset, evaH, level };
  }

  // ============================================================================================ objectives & interaction
  function nearest() {
    const p = Lc(P.X, P.Z), out = [];
    if (S.mode === 'drive') out.push({ d: 0, kind: 'exit', text: 'Get out of the rover' });
    const tgt = S.leg === 'out' ? PL.dest : PL.start;
    if (S.mode === 'walk' && tgt) { const d = Math.hypot(p.x - tgt.x, p.y - tgt.y);
      if (S.leg === 'out' && d < 18) out.push({ d, kind: 'dest', text: tgt.kind === 'station' ? `Document ${tgt.name}` : tgt.kind === 'depot' ? 'Inspect the sample tubes' : tgt.kind === 'perseverance' ? 'Inspect Perseverance' : 'Survey this point' });
      if (S.leg === 'back' && d < 14) out.push({ d, kind: 'end', text: tgt.kind === 'lander' ? 'Enter the airlock · end EVA' : 'End EVA here' }); }
    if (S.mode === 'walk' && (S.leg === 'back' || S.sim - S.evaStart > 20 * 60e3) && Math.hypot(p.x - lander.x, p.y - lander.y) < 12 && !(S.leg === 'back' && PL.start?.kind === 'lander')) out.push({ d: 9, kind: 'airlock', text: 'Enter the airlock · end EVA' });
    if (roverObj.visible && S.mode === 'walk') { const d = Math.hypot(P.X - P.rover.X, P.Z - P.rover.Z); if (d < 4.5) out.push({ d, kind: 'rover', text: 'Board the rover' }); }
    return out.sort((a, b) => a.d - b.d)[0] || null;
  }
  function interact() {
    if (S.phase !== 'play' || S.paused) return; const n = nearest(); if (!n) return;
    AU.click();
    if (n.kind === 'dest') return arrive();
    if (n.kind === 'end' || n.kind === 'airlock') return endGame(true, S.leg === 'back' ? 'Back at the start with life support to spare.' : 'You came back early. A safe call.');
    if (n.kind === 'rover') { S.mode = 'drive'; P.rover.v = 0; S.auto = false; flash(`Driving · W/S throttle · A/D steer · E to get out`, 'info', 4); return; }
    if (n.kind === 'exit') { S.mode = 'walk'; const R = P.rover; P.X = R.X + Math.cos(R.yaw) * 2.2; P.Z = R.Z - Math.sin(R.yaw) * 2.2; P.Y = groundY(P.X, P.Z); }
  }
  function consume(hours, Wr) { const o2L = o2Lph(Wr) * hours; S.sim += hours * 3600e3;
    S.res.o2 -= o2L * O2_G_PER_L / 1000 * (1 + (1 - S.res.integ) * 1.5); S.res.co2 += o2L * PHYS.RQ * CO2_G_PER_L / 1000; S.res.h2o -= Wr * 3600 * hours / PHYS.Lsub; S.res.wh -= (PHYS.powerW * 0.6 + 0.08 * Wr) * hours; }
  function arrive() {
    const t = PL.dest, mins = Math.round(taskH(t) * 60); consume(mins / 60, 0.75 * PHYS.W_design); S.done.add(t.id || 'point'); S.auto = false;
    let body; const pov = t.id ? D.pov?.[t.id] : null;
    if (t.kind === 'station') { const s = t.s || ST.find((x) => x.id === t.id); const nasem = (s.nasem || []).map((k) => `${k}. ${esc((D.manifest.nasem_objectives || {})[k] || '')}`).join('<br>');
      body = `<div class="kick">Outcrop documented · ${mins} min</div><h2>${esc(s.name.split(' —')[0])}</h2><p><b>${esc(s.rock)}</b> · ${esc(s.formation)}</p><p>${esc(s.rationale)}</p>
        ${pov ? `<img src="../data/${esc(pov.file)}" alt="Perseverance view"><div class="src">What Perseverance saw here · ${esc(pov.camera.replace('_LEFT', ''))}, sol ${pov.sol} · ${esc(pov.credit)}</div>` : ''}
        <p class="note">Perseverance sample: ${esc(s.sample)}<br>NASEM objectives: ${nasem}</p>`; }
    else if (t.kind === 'depot') body = `<div class="kick">Depot inspected · ${mins} min</div><h2>Three Forks sample depot</h2><p>${(D.depot_tubes?.tubes || []).length} sealed sample tubes Perseverance left on the surface for a future return mission. Positions from the NASA PDS depot bundle.</p>
        ${pov ? `<img src="../data/${esc(pov.file)}" alt="Perseverance at the depot"><div class="src">Perseverance ${esc(pov.camera.replace('_LEFT', ''))}, sol ${pov.sol} · ${esc(pov.credit)}</div>` : ''}`;
    else if (t.kind === 'perseverance') body = `<div class="kick">Inspection · ${mins} min</div><h2>Perseverance</h2><p>NASA's Mars 2020 rover stood here on sol ${PERS.sol}, its last localized position inside this map (NASA M20 waypoints). The model is an approximation: 3 m long, six 52.5 cm wheels, mast camera and nuclear power source at the back.</p>
        <p class="note">On the globe you can see its latest known position (sol ${GA.perseverance?.latest?.sol}), about 13 km west of here.</p>`;
    else { const [r, c] = rcOf(t.x, t.y), sl = gv('slope', r, c), pv = gv('provenance', r, c), gu = geologyAt(t.x, t.y), e = elev[r * NC + c];
      body = `<div class="kick">Point surveyed · ${mins} min</div><h2>Field survey</h2><dl class="kv"><dt>Elevation</dt><dd>${fmt(e)} m</dd><dt>Slope (5 m)</dt><dd>${fmt(sl, 1)}°</dd>
        <dt>Terrain data</dt><dd>${pv === 1 ? 'HiRISE 1 m' : pv === 2 ? 'CTX 20 m' : 'none'}</dd><dt>Geologic unit</dt><dd>${gu ? esc(gu.name) : '—'}</dd></dl><p class="note">Geology: USGS SIM 3464 (interpretive, 100–200 m positional uncertainty).</p>`; }
    S.leg = 'back'; setLeg(PL.plan.pts.slice().reverse());
    openModal(body, [['Head back', () => { closeModal(); flash(`Return to ${PL.start.name}`, 'info'); }]]);
  }
  function endGame(success, why) {
    if (S.over) return; S.over = true; if (document.pointerLockElement) document.exitPointerLock();
    const pr = predict();
    openModal(`<div class="kick">${success ? 'EVA complete' : 'EVA failed'}</div><h2>${success ? 'Welcome back' : 'Mission lost'}</h2><p>${esc(why)}</p>
      <dl class="kv"><dt>Route</dt><dd>${esc(PL.start.name)} → ${esc(PL.dest.name)}</dd><dt>Time outside</dt><dd>${hm(pr.evaH)}</dd><dt>Distance</dt><dd>${km(S.walked)}</dd>
      <dt>Oxygen left</dt><dd>${fmt(S.res.o2 * 1000)} g</dd><dt>Planned round trip</dt><dd>${hm(PL.plan.total)}</dd><dt>Radiation dose (model)</dt><dd>${fmt(S.res.dose, 3)} mSv</dd></dl>`,
    [['Plan another EVA', () => { closeModal(); backToPlanner(); }], ['Globe', () => { closeModal(); toGlobeFromPlay(); }]]);
  }
  function backToPlanner() { S.paused = false; setPhase('site'); astro.visible = false; roverObj.visible = false; SC.anim = { t: 0, dur: 1.4, from: { ...SC, tx: P.X, tz: P.Z, dist: 300, pitch: 0.5 }, to: { tx: P.X, tz: P.Z, dist: 2600, yaw: SC.yaw, pitch: 0.95 } };
    computePlan(); renderPlanner(); }
  function toGlobeFromPlay() { backToPlanner(); toGlobe(); }

  // ============================================================================================ per-frame visuals & camera (play)
  const tmpV = new THREE.Vector3(), sunWorld = new THREE.Vector3();
  function updateSky(st, center) {
    const el = st.elev * D2R, az = st.az * D2R, sd = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const day = clamp((st.elev + 6) / 16, 0, 1), night = 1 - day, warm = clamp(st.elev / 25, 0, 1);
    skyU.sunDir.value.copy(sd); skyU.day.value = 0.05 + 0.95 * day; skyU.dust.value = st.dustSeason ? 0.5 : 0.15; stars.material.opacity = clamp(1 - day * 1.6, 0, 0.95);
    post.expo = lerp(1.12, 0.76, clamp(st.elev / 40, 0, 1));
    sun.color.setRGB(1, 0.78 + 0.18 * warm, 0.6 + 0.3 * warm); sun.intensity = clamp(Math.sin(el) * 3.5, 0, 1) * (Q.post ? 2.7 : 2.2);
    hemi.intensity = (0.05 + 0.3 * day) * (Q.post ? 1.0 : 1.4); scene.fog.color.setRGB(0.86, 0.66, 0.48).multiplyScalar(0.05 + 0.95 * day);
    updateEnv(st.elev);
    sun.position.set(center.x + sd.x * 300, center.y + Math.max(sd.y, 0.04) * 300, center.z + sd.z * 300); sun.target.position.copy(center);
    sky.position.copy(camera.position); stars.position.copy(camera.position);
    sunWorld.copy(camera.position).add(sd.clone().multiplyScalar(5000)); return night;
  }
  function updatePlay(dt, camOn = true) {
    const st = state(); const night = updateSky(st, new THREE.Vector3(P.X, P.Y, P.Z));
    astro.visible = !(S.view === 'fp' && S.mode === 'walk');
    if (S.mode === 'walk') { astro.position.set(P.X, P.Y, P.Z); astro.rotation.set(0, P.yaw + Math.PI, 0); }
    else { const R = P.rover; tmpV.set(0.45, 0.95, 0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), R.yaw); astro.position.set(R.X + tmpV.x, groundY(R.X, R.Z) + 0.55, R.Z + tmpV.z); astro.rotation.set(0, R.yaw + Math.PI, 0); }
    const pa = astro.userData.parts, amp = S.mode === 'walk' ? clamp(P.speed / (S.speed * 1.0), 0, 1.3) : 0, sw = Math.sin(P.phase) * amp, lope = P.run && amp > 0.2;
    pa.hpL.rotation.x = sw * (lope ? 0.75 : 0.5); pa.hpR.rotation.x = -sw * (lope ? 0.75 : 0.5);
    pa.knL.rotation.x = Math.max(0, -Math.sin(P.phase + 0.6)) * amp * 0.9; pa.knR.rotation.x = Math.max(0, Math.sin(P.phase + 0.6)) * amp * 0.9;
    pa.shL.rotation.x = -sw * 0.45; pa.shR.rotation.x = sw * 0.45; pa.elL.rotation.x = -0.35 - Math.max(0, sw) * 0.4; pa.elR.rotation.x = -0.35 - Math.max(0, -sw) * 0.4;
    if (S.mode === 'drive') { pa.hpL.rotation.x = pa.hpR.rotation.x = -1.45; pa.knL.rotation.x = pa.knR.rotation.x = 1.5; pa.shL.rotation.x = pa.shR.rotation.x = -0.9; pa.elL.rotation.x = pa.elR.rotation.x = -0.6; }
    if (!P.onGround) { pa.hpL.rotation.x = -0.6; pa.knL.rotation.x = 0.9; pa.hpR.rotation.x = -0.2; pa.knR.rotation.x = 0.5; }
    if (S.mode === 'walk' && P.onGround && amp > 0.1) astro.position.y += Math.abs(Math.sin(P.phase)) * (lope ? 0.1 : 0.035);
    const lights = S.headlamp || st.elev < 2; M.glowW.emissiveIntensity = lights ? 3 : 0.2;
    if (roverObj.visible) { const R = P.rover, f = new THREE.Vector3(-Math.sin(R.yaw), 0, -Math.cos(R.yaw)), r = new THREE.Vector3(Math.cos(R.yaw), 0, -Math.sin(R.yaw));
      const hF = groundY(R.X + f.x * 1.4, R.Z + f.z * 1.4), hB = groundY(R.X - f.x * 1.4, R.Z - f.z * 1.4), hR = groundY(R.X + r.x, R.Z + r.z), hL = groundY(R.X - r.x, R.Z - r.z);
      f.y = (hF - hB) / 2.8; f.normalize(); r.y = (hR - hL) / 2; r.normalize(); const up = new THREE.Vector3().crossVectors(r, f).normalize();
      roverObj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, up, f.clone().negate())); roverObj.position.set(R.X, (hF + hB + hR + hL) / 4, R.Z); roverObj.rotateY(Math.PI);
      for (const w of roverObj.userData.wheels) w.rotation.x += R.v * S.speed * dt / 0.45; }
    // destination beam fades as you get close
    const tgt = S.leg === 'out' ? PL.dest : PL.start, fl = S.leg === 'out' ? flagD : flagS;
    for (const f of [flagS, flagD]) f.userData.beam.visible = false;
    if (tgt) { const tw = W(tgt.x, tgt.y), dd = Math.hypot(tw.X - P.X, tw.Z - P.Z); fl.userData.beam.visible = dd > 25; fl.userData.beam.material.opacity = 0.1 * clamp((dd - 25) / 80, 0, 1); }
    ribbonMat.depthTest = camOn; ribbonMat.uniforms.uW.value = camOn ? 0.45 : clamp((camera.position.y - P.Y) * 0.004, 0.45, 12); ribbonMat.uniforms.uO.value = camOn ? 0.38 : 0.9; ribbonMat.uniforms.uT.value = performance.now() / 1000 * 6;
    // camera
    P.shake = Math.max(0, P.shake - dt * 3);
    const head = new THREE.Vector3(P.X, P.Y + (S.mode === 'drive' ? 1.1 : 1.68), P.Z);
    if (!camOn) { updateFX(dt, st); return night; }
    const fovT = S.mode === 'drive' ? 66 : P.run && amp > 0.3 ? 68 : 60; camera.fov = lerp(camera.fov, fovT, 1 - Math.exp(-dt * 4)); camera.updateProjectionMatrix();
    if (S.view === 'fp') { const yaw = S.mode === 'drive' ? P.rover.yaw + P.camYaw - P.yaw : P.camYaw;
      camera.position.copy(head).add(new THREE.Vector3(-Math.sin(yaw) * 0.18, 0, -Math.cos(yaw) * 0.18)); camera.position.y += S.mode === 'walk' ? Math.abs(Math.sin(P.phase)) * amp * (lope ? 0.07 : 0.03) : 0;
      camera.lookAt(camera.position.clone().add(new THREE.Vector3(-Math.sin(yaw) * Math.cos(P.camPitch), Math.sin(P.camPitch), -Math.cos(yaw) * Math.cos(P.camPitch))));
    } else {
      const yaw = P.camYaw, pitch = P.camPitch, d = (S.mode === 'drive' ? Math.max(P.camDist, 9) : P.camDist) * (camera.aspect < 0.8 ? 1.4 : 1);
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(S.mode === 'drive' ? 0 : 0.55);
      const want = head.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch) * d, -Math.sin(pitch) * d + 0.5, Math.cos(yaw) * Math.cos(pitch) * d).add(right));
      let gmin = groundY(want.x, want.z) + 0.5;
      for (let f = 0.25; f < 1.01; f += 0.25) { const gx = head.x + (want.x - head.x) * f, gz = head.z + (want.z - head.z) * f; gmin = Math.max(gmin, head.y + (groundY(gx, gz) + 0.45 - head.y) / f); }
      if (want.y < gmin) want.y = gmin;
      if (camera.position.distanceTo(want) > 25) camera.position.copy(want); else camera.position.lerp(want, 1 - Math.exp(-dt * 12)); camera.lookAt(head.clone().add(right)); }
    if (P.shake > 0) { camera.position.x += (Math.random() - 0.5) * P.shake * 0.06; camera.position.y += (Math.random() - 0.5) * P.shake * 0.06; }
    lampL.intensity = lampR.intensity = lights ? 2.0 : 0; const ld = new THREE.Vector3(); camera.getWorldDirection(ld);
    for (const [lp, s] of [[lampL, -1], [lampR, 1]]) { lp.position.copy(head).add(new THREE.Vector3(Math.cos(P.camYaw) * 0.18 * s, 0.15, -Math.sin(P.camYaw) * 0.18 * s)); lp.target.position.copy(head).add(ld.clone().multiplyScalar(12)); }
    updateFX(dt, st);
    return night;
  }

  // ============================================================================================ HUD
  const ICON = { o2: '<svg viewBox="0 0 24 24"><circle cx="9" cy="12" r="5"/><path d="M17 14h3l-3 4h3"/></svg>', pwr: '<svg viewBox="0 0 24 24"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg>',
    h2o: '<svg viewBox="0 0 24 24"><path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/></svg>', home: '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7M6 9v11h12V9"/></svg>' };
  function updateHUD() {
    const pr = predict(), st = pr.st, T = airTemp(st), now = lifeHours(S.wAvg);
    $('#clock').innerHTML = `<b>${M24.fmtH(st.ltst)}</b>Sol ${st.sol} · EVA ${hm(pr.evaH)}<span class="x">×${S.speed}</span>`;
    const pwrH = S.res.wh / (PHYS.powerW * 0.6 + 0.08 * S.wAvg + heaterW(T, st));
    const h2oH = S.res.h2o / (Math.max(30, S.wAvg + (st.elev > 0 ? 60 * Math.sin(st.elev * D2R) : 0) - Math.max(0, 250 - T) * 0.8) * 3600 / PHYS.Lsub);
    const col = (f) => f <= 0.15 ? 'var(--bad)' : f <= 0.35 ? 'var(--warn)' : 'var(--ok)';
    const fO2 = Math.min(S.res.o2 / CAP.o2kg, 1 - S.res.co2 / CAP.co2kg), fW = S.res.wh / CAP.wh, fH = S.res.h2o / CAP.h2okg;
    const m = pr.margin, fm = m === null ? 0 : clamp(m / 6, 0, 1);
    const row = (ic, name, f, val, c, cls = '') => `<div class="vit ${cls}"><div class="ic">${ic}</div><div class="bar"><i style="width:${clamp(f * 100, 0, 100)}%;--c:${c}"></i><span><b>${name}</b><b>${val}</b></span></div></div>`;
    $('#vitals').innerHTML = row(ICON.home, m !== null && m < 0 ? 'Return now' : 'Turn back', fm, m === null ? 'no path' : m < 0 ? hm(m) : hm(m), m === null || m < 0 ? 'var(--bad)' : m < 0.75 ? 'var(--warn)' : 'var(--cool)', 'ret')
      + row(ICON.o2, 'Oxygen', fO2, hm(now.h), col(fO2)) + row(ICON.pwr, 'Power', fW, hm(pwrH), col(fW)) + row(ICON.h2o, 'Cooling', fH, hm(h2oH), col(fH));
    const tgt = S.leg === 'out' ? PL.dest : PL.start, p = Lc(P.X, P.Z);
    let heading = (((-(S.view === 'fp' ? P.camYaw : (S.mode === 'drive' ? P.rover.yaw : P.camYaw))) / D2R) % 360 + 360) % 360;
    if (tgt) { const brg = ((Math.atan2(tgt.x - p.x, tgt.y - p.y) / D2R) + 360) % 360, dist = Math.hypot(tgt.x - p.x, tgt.y - p.y);
      drawTape(heading, brg); $('#target').innerHTML = `${S.leg === 'out' ? 'Destination' : 'Return'} · <b>${esc(tgt.name)}</b> · ${km(dist)}`; }
    const n = nearest(); $('#prompt').classList.toggle('hidden', !n); if (n) $('#prompt').innerHTML = `<kbd>${TOUCH ? 'Use' : 'E'}</kbd>${esc(n.text)}`;
    const al = [];
    if (P.blocked && S.mode === 'drive') al.push(['bad', `Too steep for the rover (>${PHYS.roverSlope}°)`]);
    if (P.edge) al.push(['warn', 'Edge of the mapped area']);
    if (m !== null && m < 0) al.push(['bad', 'Past the point of no return — head for the nearest safe haven']); else if (m !== null && m < 0.75) al.push(['warn', `Turn back within ${hm(m)}`]);
    if (fO2 < 0.15) al.push(['bad', 'Oxygen critical']); if (S.res.integ < 0.999) al.push(['bad', 'Suit leak']);
    if (st.elev < 0) al.push(['warn', `Night · ${fmt(T - 273.15)} °C (MEDA historical reference)`]); if (cmeNear(S.sim).length) al.push(['warn', 'CME forecast to reach Mars within 24 h (NASA DONKI model)']);
    if (S.updateReady) al.push(['info', 'Update ready — reload when convenient']);
    const tn = performance.now(); for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].until < tn) flashes.splice(i, 1);
    for (const f of flashes.slice(-1)) al.push([f.kind, f.text]);
    const key = al.filter((a) => a[0] === 'bad').map((a) => a[1]).join('|'); if (key && key !== S.alertKey) AU.beep(); S.alertKey = key;
    $('#alerts').innerHTML = al.slice(0, 2).map(([k, t]) => `<div class="alert ${k === 'warn' ? '' : k}">${esc(t)}</div>`).join('');
    drawMinimap(heading);
  }
  function drawTape(heading, brg) {
    const tape = $('#tape'), w = $('#compass').clientWidth, ppd = w / 120;
    if (!tape.dataset.w || +tape.dataset.w !== w) { let h = ''; for (let d = -360; d <= 720; d += 15) { const v = ((d % 360) + 360) % 360, l = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[v];
      h += l ? `<span class="c" style="left:${d * ppd}px">${l}</span>` : d % 45 === 0 ? `<span style="left:${d * ppd}px">${v}</span>` : `<i style="left:${d * ppd}px"></i>`; }
      tape.innerHTML = h + '<b id="tape-obj"></b>'; tape.dataset.w = w; }
    tape.style.transform = `translateX(${w / 2 - heading * ppd}px)`; let rel = brg; if (rel - heading > 180) rel -= 360; if (heading - rel > 180) rel += 360; $('#tape-obj').style.left = `${rel * ppd}px`;
  }
  // minimap: heading-up, HiRISE orthomosaic underneath (Rust-style square map, bottom right)
  const ortho = new Image(); ortho.src = '../data/hirise_ortho_1m.jpg';
  const mm = $('#minimap'), mmc = mm.getContext('2d');
  function drawMinimap(heading) {
    if (mm.offsetParent === null) return; const w = mm.width, c = w / 2, R = 520, s = (w / 2) / R, p = Lc(P.X, P.Z), hr = heading * D2R;
    mmc.save(); mmc.fillStyle = '#15110e'; mmc.fillRect(0, 0, w, w);
    mmc.translate(c, c); mmc.rotate(-hr); mmc.scale(s, s);
    if (ortho.complete && ortho.naturalWidth) { mmc.globalAlpha = 0.9; mmc.drawImage(ortho, AOI.xmin - p.x, -(AOI.ymax - p.y), AOI.xmax - AOI.xmin, AOI.ymax - AOI.ymin); mmc.globalAlpha = 1;
      mmc.globalCompositeOperation = 'multiply'; mmc.fillStyle = '#d99a6c'; mmc.fillRect(-R * 1.5, -R * 1.5, R * 3, R * 3); mmc.globalCompositeOperation = 'source-over'; }
    { const hc = hazardCanvas(); mmc.globalAlpha = 0.55; mmc.imageSmoothingEnabled = false; mmc.drawImage(hc, AOI.xmin - p.x, -(AOI.ymax - p.y), AOI.xmax - AOI.xmin, AOI.ymax - AOI.ymin); mmc.imageSmoothingEnabled = true; mmc.globalAlpha = 1; }
    const to = (x, y) => [x - p.x, -(y - p.y)];
    if (S.legPath && SET.guide) { mmc.strokeStyle = '#e0863a'; mmc.lineWidth = 3.2 / s; mmc.lineJoin = 'round'; mmc.beginPath(); S.legPath.forEach((q, i) => { const l = Lc(q.X, q.Z); const [u, v] = to(l.x, l.y); i ? mmc.lineTo(u, v) : mmc.moveTo(u, v); }); mmc.stroke(); }
    if (S.trail.length > 1) { mmc.strokeStyle = 'rgba(233,228,218,.75)'; mmc.lineWidth = 1.6 / s; mmc.setLineDash([4 / s, 4 / s]); mmc.beginPath(); S.trail.forEach(([X, Z], i) => { const l = Lc(X, Z); const [u, v] = to(l.x, l.y); i ? mmc.lineTo(u, v) : mmc.moveTo(u, v); }); mmc.stroke(); mmc.setLineDash([]); }
    const dot = (x, y, color, r = 7) => { const [u, v] = to(x, y); mmc.fillStyle = color; mmc.strokeStyle = '#000'; mmc.lineWidth = 2 / s; mmc.beginPath(); mmc.arc(u, v, r / s, 0, 7); mmc.fill(); mmc.stroke(); };
    for (const q of POIS) dot(q.x, q.y, q.kind === 'lander' ? '#e9e4da' : q.kind === 'perseverance' ? '#5aa4c8' : q.kind === 'depot' ? '#a885d6' : '#9c968b', 5.5);
    if (roverObj.visible && S.mode === 'walk') { const l = Lc(P.rover.X, P.rover.Z); dot(l.x, l.y, '#5aa4c8', 5); }
    if (PL.start) dot(PL.start.x, PL.start.y, '#86a94a', 8); if (PL.dest) dot(PL.dest.x, PL.dest.y, '#e0863a', 9);
    mmc.restore();
    // clamp target to edge if off-map
    const tgt = S.leg === 'out' ? PL.dest : PL.start; if (tgt) { const dx = tgt.x - p.x, dy = -(tgt.y - p.y), rx = dx * Math.cos(-hr) - dy * Math.sin(-hr), ry = dx * Math.sin(-hr) + dy * Math.cos(-hr);
      let u = c + rx * s, v = c + ry * s; if (Math.abs(u - c) > c - 12 || Math.abs(v - c) > c - 12) { const f = (c - 12) / Math.max(Math.abs(u - c), Math.abs(v - c)); u = c + (u - c) * f; v = c + (v - c) * f;
        mmc.fillStyle = '#e0863a'; mmc.beginPath(); mmc.arc(u, v, 9, 0, 7); mmc.fill(); } }
    mmc.fillStyle = '#e9e4da'; mmc.strokeStyle = '#000'; mmc.lineWidth = 2; mmc.beginPath(); mmc.moveTo(c, c - 13); mmc.lineTo(c + 9, c + 9); mmc.lineTo(c, c + 3); mmc.lineTo(c - 9, c + 9); mmc.closePath(); mmc.fill(); mmc.stroke();
    const nx = c - Math.sin(hr) * (c - 18), ny = c - Math.cos(hr) * (c - 18); mmc.fillStyle = '#e9e4da'; mmc.font = '700 22px RC, sans-serif'; mmc.textAlign = 'center'; mmc.textBaseline = 'middle'; mmc.fillText('N', nx, ny);
    mmc.font = '600 18px RC, sans-serif'; mmc.textAlign = 'left'; mmc.fillStyle = 'rgba(233,228,218,.6)'; mmc.fillText('500 m', 10, w - 14); mmc.fillRect(10, w - 32, 500 * s, 3);
  }

  // ============================================================================================ menu, map, modal
  function setPaused(v) { S.paused = v; if (!v) clock.getDelta(); }
  function toggleMenu(open) {
    $('#menu').classList.toggle('hidden', !open); setPaused(open); if (open) { if (document.pointerLockElement) document.exitPointerLock(); renderMenu(); }
  }
  function renderMenu() {
    const items = [['Resume', () => toggleMenu(false)], ['Map', () => { toggleMenu(false); toggleMap(true); }], ['sep'],
      ['Camera', () => { toggleView(); renderMenu(); }, S.view === 'tp' ? 'Third person' : 'First person'],
      ['Time & travel', () => { cycleSpeed(); renderMenu(); }, `×${S.speed}`],
      ['Graphics', () => { const o = ['auto', 'ultra', 'high', 'low']; SET.gfx = o[(o.indexOf(SET.gfx) + 1) % o.length]; store.set('gfx', SET.gfx); setQuality(qName(SET.gfx)); renderMenu(); }, SET.gfx === 'auto' ? `Auto (${qName('auto')})` : SET.gfx],
      ['Sound', () => { SET.sound = !SET.sound; store.set('sound', SET.sound); AU.setOn(SET.sound); renderMenu(); }, SET.sound ? 'On' : 'Off'],
      ['Hazard alarm', () => { setAlarmMute(!SET.alarmMute); renderMenu(); }, SET.alarmMute ? 'Muted' : 'On'],
      ['Alarm volume', () => { const o = [0.8, 0.5, 0.25]; SET.alarmVol = o[(o.indexOf(SET.alarmVol) + 1) % o.length]; store.set('alarmVol', SET.alarmVol); hzAudio.setVolume(SET.alarmVol); hzAudio.start(); hzAudio._play('warning'); renderMenu(); }, `${Math.round(SET.alarmVol * 100)} %`],
      ['Alert distances', () => { SET.hzPreset = (SET.hzPreset + 1) % HZ_PRESETS.length; store.set('hzPreset', SET.hzPreset); setHzLevels(hzLevels(SET.hzPreset)); renderMenu(); }, `${HZ_PRESETS[SET.hzPreset].slice(0, 3).join(' / ')} m · ${HZ_PRESETS[SET.hzPreset][3]}`],
      ['Reduced motion', () => { SET.reduced = !SET.reduced; store.set('reduced', SET.reduced); hzHud.reduced = SET.reduced; renderMenu(); }, SET.reduced ? 'On' : 'Off'],
      ['Model & sources', () => { toggleMenu(false); showModel(); }], ['sep'],
      ['Abandon EVA', () => { toggleMenu(false); backToPlanner(); }, '', 'danger']];
    $('#menu-items').innerHTML = items.map((it, i) => it[0] === 'sep' ? '<div class="sep"></div>' : `<button data-i="${i}" class="${it[3] || ''}">${esc(it[0])}${it[2] ? `<small>${esc(it[2])}</small>` : ''}</button>`).join('')
      + `<div class="controls">${TOUCH ? 'Stick: walk · drag: look · Auto: follow the route · Use: interact' : 'WASD walk · Shift run · Space jump · F follow route · E use · V camera · T time speed · R route guide · L lights · N hazard alarm · M map · Esc menu'}</div>`;
    $('#menu-items').querySelectorAll('button').forEach((b) => b.onclick = () => { AU.click(); items[+b.dataset.i][1](); });
  }
  function setQuality(name) {
    Q = QUAL[name]; renderer.setPixelRatio(Math.min(devicePixelRatio || 1, TOUCH ? 1.5 : Q.dpr)); sun.shadow.mapSize.set(Q.shadow, Q.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    applyRendererMode(); resize(); rockCenter = null; pebCenter = null;
  }
  function openModal(html, actions) { $('#modal-body').innerHTML = html; $('#modal-actions').innerHTML = ''; setPaused(true); if (document.pointerLockElement) document.exitPointerLock();
    actions.forEach(([t, fn], i) => { const b = document.createElement('button'); b.className = 'btn' + (i === 0 ? ' go' : ''); b.textContent = t; b.onclick = () => { AU.click(); fn(); }; $('#modal-actions').appendChild(b); });
    $('#modal').classList.remove('hidden'); }
  function closeModal() { $('#modal').classList.add('hidden'); if ($('#menu').classList.contains('hidden') && $('#mapview').classList.contains('hidden')) setPaused(false); }
  function showModel() {
    const eq = (t, f, src) => `<div class="kick" style="margin-top:12px">${t}</div><div class="eq">${f}</div><div class="src">${src}</div>`;
    openModal(`<h2>Model & sources</h2>`
      + eq('Route', 'cost = d · (1 + (s/15°)²) · p,  blocked if s > suit limit\np = 1.0 HiRISE · 1.5 CTX-only', 'A* on the NASA HiRISE 5 m slope grid (same as this project\'s Python engine; checked in tests)')
      + eq('Walking pace', 'v = 2.7 km/h (≤3°) → 1.7 (10°) → 1.2 (20°)', 'Apollo walk-back planning pace (ALSJ "Lunar Gaits"), Apollo 14 uphill average; 20° extrapolated')
      + eq('Work rate', `W = W_rest + (W_design − W_rest)·(v / v_pace)^1.5\nW_rest = ${fmt(PHYS.W_rest)} W · W_design = ${fmt(PHYS.W_design)} W (1,000 Btu/h) · W_peak = ${fmt(PHYS.W_peak)} W`, 'NASA EMU design and Apollo EVA averages; resting floor Waligora & Horrigan 1975 (NASA SP-368). Exponent is our assumption')
      + eq('Oxygen & CO₂', `O₂ [L/h] = W·3600 / ((3.941 + 1.106·RQ)·4184), RQ = ${PHYS.RQ}\nCO₂ = RQ × O₂ · capacity ${fmt(CAP.o2kg * 1000)} g O₂ (${SIZE_H} h at W_design)`, 'Weir (1949); 8 h EVA requirement (NASA xEVA ConOps) + 30 min reserve')
      + eq('Cooling water', `kg/h = heat·3600 / 2.83 MJ/kg · capacity ${fmt(CAP.h2okg, 2)} kg`, 'Sublimator: latent heat of sublimation of ice; heat terms are our assumptions')
      + eq('Gravity', `${PHYS.g} m/s²`, 'NASA NSSDC Mars Fact Sheet')
      + eq('Return margin', 'margin = life support at 1,000 Btu/h − walk home (2.4 km/h + 15 min airlock) − 30 min', 'Walk-home distance from this project\'s Dijkstra fields on the HiRISE slope grid')
      + eq('Environment', `Sun & time: Mars24 · air: MEDA (sols ${D.environment.meda?.sols?.[0]?.sol}–${D.environment.meda?.sols?.at(-1)?.sol}) · radiation ${PHYS.RAD} mSv/day (Curiosity RAD) · CMEs: NASA DONKI`, 'MEDA is historical (depot sols), RAD is from Gale crater; both are references, not forecasts')
      + eq('Rocks', 'F(D) = k·e^(−q·D), q = 1.79 + 0.152/k', 'Golombek & Rapp (1997). Rocks you see are illustrative: the DTM cannot resolve them')
      + `<p class="note">Time & travel ×${S.speed} speeds up the clock and your walking together, so oxygen per metre stays at NASA rates. ${esc(D.manifest.si_acknowledgement || '')}</p>`, [['Close', closeModal]]);
  }
  // full map with NASA data layers
  const mapCv = $('#map'), mctx = mapCv.getContext('2d');
  const IMGS = {}; const img = (f) => IMGS[f] || (IMGS[f] = Object.assign(new Image(), { src: '../data/' + f, onload: () => { if (!$('#mapview').classList.contains('hidden')) drawMap(); } }));
  const MV = { s: 1, ox: 0, oy: 0, lay: { optical: true, thermal: false, slope: false, hazards: true, safe: true, geology: false, track: true } };
  function toggleMap(open) { $('#mapview').classList.toggle('hidden', !open);
    if (open) { if (document.pointerLockElement) document.exitPointerLock(); setPaused(true); sizeMap(); centerMap(); renderMapSide(); drawMap(); } else if ($('#modal').classList.contains('hidden')) setPaused(false); }
  function sizeMap() { const r = mapCv.parentElement.getBoundingClientRect(); mapCv.width = r.width * devicePixelRatio; mapCv.height = r.height * devicePixelRatio; }
  addEventListener('resize', () => { if (!$('#mapview').classList.contains('hidden')) { sizeMap(); drawMap(); } });
  const W_AOI = AOI.xmax - AOI.xmin, H_AOI = AOI.ymax - AOI.ymin;
  function centerMap() { MV.s = Math.max(mapCv.width / W_AOI, mapCv.height / H_AOI) * 1.3; const p = Lc(P.X, P.Z); MV.ox = mapCv.width / 2 - (p.x - AOI.xmin) * MV.s; MV.oy = mapCv.height / 2 - (AOI.ymax - p.y) * MV.s; }
  const toScr = (x, y) => [MV.ox + (x - AOI.xmin) * MV.s, MV.oy + (AOI.ymax - y) * MV.s];
  let safeCv = null, safeKey = '';
  function safeZone() { const pr = predict(), reachKm = Math.max(0, (pr.life.h - PHYS.reserveH - 0.25) * 2.4), key = `${S.theta}|${Math.round(reachKm * 20)}`; if (key === safeKey && safeCv) return safeCv;
    const g = grids[S.rover && D.rover ? `haven_phys_${S.theta}` : `walkback_phys_${S.theta}`], gw = g.nc || NC, gh = g.nr || NR;
    const cv = document.createElement('canvas'); cv.width = gw; cv.height = gh; const ctx = cv.getContext('2d'), im = ctx.createImageData(gw, gh);
    for (let i = 0; i < gw * gh; i++) { const v = g.arr[i]; if (v === 65535 || v / 1000 > reachKm) { const o = i * 4; im.data[o] = 120; im.data[o + 1] = 20; im.data[o + 2] = 10; im.data[o + 3] = 120; } }   // shade where you could NOT get home
    ctx.putImageData(im, 0, 0); safeCv = cv; safeKey = key; return cv; }
  function drawMap() {
    const c = mctx, w = mapCv.width, h = mapCv.height, k = devicePixelRatio; c.fillStyle = '#0c0a09'; c.fillRect(0, 0, w, h);
    const [x0, y0] = toScr(AOI.xmin, AOI.ymax), ww = W_AOI * MV.s, hh = H_AOI * MV.s;
    const lay = (f, a = 1, smooth = true) => { const im = img(f); if (im.complete && im.naturalWidth) { c.globalAlpha = a; c.imageSmoothingEnabled = smooth; c.drawImage(im, x0, y0, ww, hh); c.globalAlpha = 1; c.imageSmoothingEnabled = true; } };
    if (MV.lay.optical) lay('hirise_ortho_1m.jpg'); else lay('ctx_ortho_6m.jpg');
    if (MV.lay.thermal) lay('themis_night_20m.jpg', 0.75);
    if (MV.lay.slope) lay('slope_classes_5m.png', 0.6, false);
    if (MV.lay.hazards) { c.globalAlpha = 0.75; c.imageSmoothingEnabled = false; c.drawImage(hazardCanvas(), x0, y0, ww, hh); c.imageSmoothingEnabled = true; c.globalAlpha = 1; }
    if (MV.lay.safe) { c.imageSmoothingEnabled = false; c.drawImage(safeZone(), x0, y0, ww, hh); c.imageSmoothingEnabled = true; }
    if (MV.lay.geology) { c.lineWidth = 1.5 * k; for (const f of D.geology?.features || []) { const col = D.geology.colors?.[f.unit] || '#c9b'; c.strokeStyle = col; c.fillStyle = col + '33';
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates; for (const poly of polys) { c.beginPath(); poly[0].forEach(([x, y], i) => { const [sx, sy] = toScr(x, y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.closePath(); c.fill(); c.stroke(); } } }
    if (MV.lay.track) { c.strokeStyle = 'rgba(90,164,200,.8)'; c.lineWidth = 1.4 * k; c.setLineDash([3 * k, 4 * k]); for (const sg of D.rover_track.traverse) { c.beginPath(); sg.xy.forEach(([x, y], i) => { const [sx, sy] = toScr(x, y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.stroke(); } c.setLineDash([]); }
    if (PL.plan?.pts) { c.strokeStyle = '#e0863a'; c.lineWidth = 3 * k; c.lineJoin = 'round'; c.beginPath(); PL.plan.pts.forEach(([x, y], i) => { const [sx, sy] = toScr(x, y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.stroke(); }
    if (S.trail.length > 1) { c.strokeStyle = '#e9e4da'; c.lineWidth = 2 * k; c.beginPath(); S.trail.forEach(([X, Z], i) => { const l = Lc(X, Z); const [sx, sy] = toScr(l.x, l.y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.stroke(); }
    c.font = `700 ${12 * k}px RC, sans-serif`;
    for (const q of POIS) { const [sx, sy] = toScr(q.x, q.y); c.fillStyle = q.kind === 'lander' ? '#e9e4da' : q.kind === 'perseverance' ? '#5aa4c8' : q.kind === 'depot' ? '#a885d6' : '#cfc9be';
      c.beginPath(); c.arc(sx, sy, 5 * k, 0, 7); c.fill(); c.strokeStyle = '#000'; c.lineWidth = 1.5 * k; c.stroke(); c.fillStyle = '#000'; c.fillText(q.name.toUpperCase(), sx + 8 * k + 1, sy - 6 * k + 1); c.fillStyle = '#fff'; c.fillText(q.name.toUpperCase(), sx + 8 * k, sy - 6 * k); }
    { const l = Lc(P.X, P.Z); const [sx, sy] = toScr(l.x, l.y); const yaw = S.mode === 'drive' ? P.rover.yaw : (S.view === 'fp' ? P.camYaw : P.yaw);
      c.save(); c.translate(sx, sy); c.rotate(-yaw); c.fillStyle = '#e0863a'; c.strokeStyle = '#000'; c.lineWidth = 1.5 * k; c.beginPath(); c.moveTo(0, -12 * k); c.lineTo(8 * k, 9 * k); c.lineTo(0, 4 * k); c.lineTo(-8 * k, 9 * k); c.closePath(); c.fill(); c.stroke(); c.restore(); }
    const L = MV.s * 500 > 200 * k ? 500 : 1000; c.fillStyle = '#e9e4da'; c.fillRect(16 * k, h - 30 * k, L * MV.s, 3 * k); $('#map-scale').textContent = `${L} m`;
  }
  function renderMapSide() {
    const pr = predict(), st = pr.st, T = airTemp(st), Pm = medaAt('P', st.lmst), near = cmeNear(S.sim);
    const v = { go: 'Go', cond: 'Caution', nogo: 'Return now' }[pr.level];
    const L = [['optical', 'Optical', 'HiRISE 25 cm→1 m · MRO', '#bbb'], ['thermal', 'Thermal', 'THEMIS night IR · Odyssey', '#ddd'], ['slope', 'Slope', 'HiRISE DTM 5 m', '#86a94a'], ['hazards', 'Terrain hazards', 'Steep · steps · no data', '#e12d1e'],
      ['safe', 'Beyond safe return', 'From your O₂ now', '#782014'], ['geology', 'Geology', 'USGS SIM 3464', '#a885d6'], ['track', 'Perseverance track', 'NASA M20 waypoints', '#5aa4c8']];
    $('#map-side').innerHTML = `<div class="verdict ${pr.level}">${v}<small>Turn back in ${pr.margin === null ? '—' : hm(pr.margin)} · walk home ${pr.h ? km(pr.h.phys) : '—'}</small></div>
      <h3>Suit</h3><dl class="stats"><dt>Oxygen</dt><dd>${fmt(S.res.o2 * 1000)} / ${fmt(CAP.o2kg * 1000)} g</dd><dt>CO₂ absorbed</dt><dd>${fmt(S.res.co2 * 1000)} g</dd><dt>Power</dt><dd>${fmt(S.res.wh)} Wh</dd>
        <dt>Cooling water</dt><dd>${fmt(S.res.h2o, 2)} kg</dd><dt>Pressure</dt><dd>${fmt(PHYS.psi * (0.5 + 0.5 * S.res.integ), 2)} psid</dd></dl>
      <h3>Conditions</h3><dl class="stats"><dt>Sun</dt><dd>${fmt(st.elev)}° · sunset ${M24.fmtH(pr.sun.sunsetLtst)}</dd><dt>Air (MEDA)</dt><dd>${fmt(T - 273.15)} °C · ${fmt(Pm)} Pa</dd>
        <dt>Radiation (RAD)</dt><dd>${fmt(S.res.dose, 3)} mSv</dd><dt>Space weather</dt><dd>${near.length ? 'CME < 24 h' : 'quiet'}</dd></dl>
      <h3>Data layers</h3><div class="lay">${L.map(([k2, t, src, col]) => `<label><input type="checkbox" data-l="${k2}" ${MV.lay[k2] ? 'checked' : ''}><span class="sw" style="background:${col}"></span>${t}<em>${src}</em></label>`).join('')}</div>
      <div class="spacer" style="flex:1"></div><button class="btn" id="m-model">Model & sources</button><button class="btn go" id="m-close">Back (M)</button>`;
    $('#map-side').querySelectorAll('input').forEach((i) => i.onchange = () => { MV.lay[i.dataset.l] = i.checked; drawMap(); });
    $('#m-close').onclick = () => toggleMap(false); $('#m-model').onclick = () => { toggleMap(false); showModel(); };
  }
  { const pts = new Map(); let pinch0 = null;
    mapCv.addEventListener('pointerdown', (e) => { try { mapCv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: MV.s }; } });
    mapCv.addEventListener('pointermove', (e) => { if (!pts.has(e.pointerId)) return; const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2 && pinch0) { const [a, b] = [...pts.values()]; zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (pinch0.s * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch0.d) / MV.s); return; }
      MV.ox += (e.clientX - prev[0]) * devicePixelRatio; MV.oy += (e.clientY - prev[1]) * devicePixelRatio; drawMap(); });
    mapCv.addEventListener('pointerup', (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = null; });
    mapCv.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 0.85 : 1.18); }, { passive: false }); }
  function zoomAt(cx, cy, f) { const r = mapCv.getBoundingClientRect(), sx = (cx - r.left) * devicePixelRatio, sy = (cy - r.top) * devicePixelRatio;
    const ns = clamp(MV.s * f, Math.min(mapCv.width / W_AOI, mapCv.height / H_AOI) * 0.8, 6 * devicePixelRatio); MV.ox = sx - (sx - MV.ox) * ns / MV.s; MV.oy = sy - (sy - MV.oy) * ns / MV.s; MV.s = ns; drawMap(); }

  // ============================================================================================ MAIN LOOP
  let hudT = 0, labelT = 0;
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1); tickSeqs(dt);
    const t = performance.now() / 1000; let night = 0;
    if (S.phase === 'globe' || S.phase === 'boot') { updateGlobe(dt); post.expo = 1.0; post.sat = 1; render(gScene, gCam, t, null, 0); return; }
    if (S.phase === 'site') { siteCamUpdate(dt); night = updateSky(M24.at(new Date(departUtc())), new THREE.Vector3(SC.tx, groundY(SC.tx, SC.tz), SC.tz));
      ribbonMat.depthTest = false; ribbonMat.uniforms.uW.value = clamp(SC.dist * 0.0065, 1.5, 60); ribbonMat.uniforms.uO.value = 0.95; ribbonMat.uniforms.uT.value = t * SC.dist * 0.02;
      for (const f of [flagS, flagD]) { f.userData.beam.visible = true; f.userData.beam.material.opacity = 0.2; f.scale.setScalar(clamp(SC.dist / 400, 1, 14)); }
      labelT += dt; if (labelT > 0.03) { labelT = 0; updateLabels(); } }
    else if (S.phase === 'switch') { for (const f of [flagS, flagD]) f.scale.setScalar(1); night = updatePlay(0, false); }
    else if (S.phase === 'play') { for (const f of [flagS, flagD]) f.scale.setScalar(1);
      if (!S.paused && !S.over) step(dt); night = updatePlay(S.paused ? 0 : dt); if (!S.over) hazardTick(S.paused ? 0 : dt, t);
      hudT += dt; if (hudT > 0.15) { hudT = 0; updateHUD(); } labelT += dt; if (labelT > 0.05) { labelT = 0; updateLabels(); }
      AU.update(dt, S.wNow || PHYS.W_rest, 0.5, S.paused || S.over); }
    render(scene, camera, t, sunWorld, night);
  }
  function render(sc, cam, t, sw, night) { if (Q.post) post.render(sc, cam, t, sw, night); else renderer.render(sc, cam); }
  function loop() { requestAnimationFrame(loop); frame(); }

  // ============================================================================================ BOOT
  function offline() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    if (location.hostname === 'localhost' && !/[#&]sw\b/.test(location.hash)) return;   // local development: no offline cache unless #sw
    const sw = (id) => '../service-worker.js?build=' + encodeURIComponent(id);
    const hadCtrl = !!navigator.serviceWorker.controller; let reloaded = false;
    // a new build's worker precaches everything, takes over, and we reload once (unless you are mid-EVA)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadCtrl || reloaded) return;
      if (S.phase === 'play' || S.phase === 'switch') { S.updateReady = true; return; }
      reloaded = true; location.reload();
    });
    navigator.serviceWorker.register(sw(D.manifest.build_id), { updateViaCache: 'none' }).catch(() => {});
    fetch('../data/manifest.json?version-check=' + Date.now(), { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((m) => {
      if (m && m.build_id !== D.manifest.build_id) { S.updateReady = true; navigator.serviceWorker.register(sw(m.build_id), { updateViaCache: 'none' }).catch(() => {});
        // safety net: if the new build has not taken over after 25 s (an old worker or cache is stuck), clear the offline cache and reload once
        setTimeout(async () => { let done = false; try { done = sessionStorage.getItem('mw.reset') === m.build_id; } catch (_) { /* private mode */ }
          if (done || reloaded || S.phase === 'play' || S.phase === 'switch') return;
          try { sessionStorage.setItem('mw.reset', m.build_id); } catch (_) { /* private mode */ }
          for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
          for (const k of await caches.keys()) await caches.delete(k);
          location.reload(); }, 25000); }
    }).catch(() => {});
  }
  const H = Object.fromEntries(location.hash.replace(/^#/, '').split('&').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [decodeURIComponent(k), v === undefined ? '' : decodeURIComponent(v)]; }));
  manager.onProgress = (_, n, total) => { $('#boot-fill').style.width = `${Math.round(n / total * 100)}%`; const b = $('#sc-enter'); if (b && !manager.done) b.textContent = `Loading terrain ${Math.round(n / total * 100)}%`; };
  manager.onLoad = () => { manager.done = true; const b = $('#sc-enter'); if (b) b.textContent = 'Enter site'; };
  try {
    resize(); applyRendererMode(); AU.setOn(SET.sound);
    if (H.gfx && QUAL[H.gfx]) { SET.gfx = H.gfx; setQuality(H.gfx); }
    if (H.speed && [10, 30, 60].includes(+H.speed)) S.speed = +H.speed;
    if (H.view === 'fp' || H.view === 'tp') S.view = H.view;
    if (H.theta && [15, 20, 25].includes(+H.theta)) S.theta = +H.theta;
    if (H.ltst && Number.isFinite(+H.ltst)) PL.dep = +H.ltst;
    if (H.hz) { const v = H.hz.split(',').map(Number); if (v.length === 3 && v.every((x) => x > 0) && v[0] > v[1] && v[1] > v[2]) setHzLevels({ caution: v[0], warning: v[1], critical: v[2] }); }
    if ('rm' in H) { SET.reduced = true; hzHud.reduced = true; } if ('mute' in H) setAlarmMute(true);
    buildGlobe(); $('#boot-msg').textContent = 'Building Jezero terrain';
    setTimeout(() => {
      buildWorld(); applyRendererMode();
      let started = false;
      const go = () => {
        if (started) return; started = true;
        $('#boot').style.opacity = 0; setTimeout(() => $('#boot').classList.add('hidden'), 500);
        if ('from' in H || 'to' in H || 'site' in H) {
          setPhase('site'); PL.start = H.from && poiById(H.from) ? { ...poiById(H.from), name: poiById(H.from).name } : { ...poiById('L0') };
          if (H.to && poiById(H.to)) { const q = poiById(H.to); PL.dest = { id: q.id, kind: q.kind, x: q.x, y: q.y, name: q.name, s: q.s }; }
          Object.assign(SC, { tx: -1350, tz: 80, dist: 3400, yaw: 0.35, pitch: 0.95 }); computePlan(); renderPlanner();
          if ('play' in H && PL.plan && !PL.plan.error) { beginEVA({ instant: 'noswitch' in H }); if ('map' in H) setTimeout(() => toggleMap(true), 400); if ('auto' in H) S.auto = true; }
        } else { setPhase('globe'); if ('jezero' in H) selectSite((GA.globe_sites || [])[0]); }
      };
      if (manager.done) go(); else { const prev = manager.onLoad; manager.onLoad = () => { prev(); go(); }; setTimeout(() => { if (S.phase === 'boot') go(); }, 15000); }
      window.MEC_GAME = { S, P, PL, GL, SC, hazard, alertMgr, hzAudio, hzHud, HZRUN, setHzLevels, scene, sun, post, ribbonMat, get terrain() { return terrain; }, get ribbon() { return ribbon; }, PHYS, CAP, camera, get astro() { return astro; }, predict, lifeHours, metabolic, groundY, Lc, W, toggleMap, interact, endGame, setQuality, beginEVA, computePlan, pickPOI, selectSite, enterSite, toggleAuto };
    }, 30);
    offline(); loop();
  } catch (e) { $('#boot-msg').textContent = 'Could not start 3D: ' + e.message; console.error(e); }
})();
