/* SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md. */
/* Marswalk 1 — Field Simulator (v2, cinematic).
 * First/third-person EVA on real Jezero terrain: HiRISE DTM (5 m mesh + 1 m micro-relief normal map), real stops,
 * PDS depot tubes, Mars24 sun, MEDA weather, DONKI space weather. Every physical constant is in PHYS with its source.
 * Coordinates: pipeline local metres x east / y north; Three.js X = x - x_lander, Z = -(y - y_lander), Y = up. */
(function () {
  'use strict';
  const D = window.MEC_DATA, G = window.MEC_GRIDS, M24 = window.Mars24;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const fmt = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v)) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const hmShort = (h) => { if (!Number.isFinite(h)) return '—'; const m = Math.round(Math.abs(h) * 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };
  const hm = (h) => { if (!Number.isFinite(h)) return '—'; const s = h < 0 ? '−' : ''; const m = Math.round(Math.abs(h) * 60); return `${s}${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
  const D2R = Math.PI / 180;
  const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (TOUCH) document.body.classList.add('touch');

  // ============================================================================================ PHYSICAL MODEL (sourced)
  const BTU = 0.29307107;                                    // W per Btu/h (exact unit conversion)
  const PHYS = {
    g: 3.73,            // m/s² — NASA NSSDC Mars Fact Sheet (mean surface gravity)
    W_rest: 100 * 1.16222,   // W — 100 kcal/h, low end of measured EVA metabolic rates (Waligora & Horrigan 1975, NASA SP-368)
    W_design: 1000 * BTU,    // W — 1,000 Btu/h: NASA EMU design average and Apollo lunar-EVA average (Gernhardt et al., NASA EVA ops)
    W_peak: 2200 * BTU,      // W — 2,200 Btu/h: Apollo lunar-EVA peaks (Gernhardt et al.)
    RQ: 0.9,            // respiratory quotient used in NASA EVA CO₂ analyses
    evaH: 8,            // h — NASA exploration EVA requirement (8 h), xEVA ConOps
    reserveH: 0.5,      // h — planning reserve (ASSUMPTION)
    psi: 4.3,           // psid — nominal suit pressure, NASA xEVA ConOps (2021)
    pace: [[0, 2.7], [3, 2.7], [10, 1.7], [20, 1.2]],   // km/h vs uphill grade °: Apollo walk-back planning pace (ALSJ "Lunar Gaits"); 1.7 at 10° Apollo 14; 1.2 at 20° extrapolated (Marswalk Planner v4.1)
    vWalk: 1.0, vLope: 2.2,  // m/s physical gait speeds (walk ~3.6 km/h; lope ~8 km/h, effort capped at Apollo peak)
    roverKmh: 15,       // km/h — Artemis LTV design figure (Leidos bid; Apollo LRV achieved 18 km/h)
    roverSlope: 25,     // ° rover slope limit (ASSUMPTION)
    Lsub: 2.83e6,       // J/kg latent heat of sublimation of water ice (physical constant; suit sublimator cooling)
    RAD: 0.64,          // mSv/day dose equivalent, Curiosity RAD at Gale (Hassler et al. 2014)
    powerW: 90,         // W nominal suit electrical load (ASSUMPTION; heaters added below 245 K)
  };
  // Weir (1949) calorimetry: kcal per litre O₂ = 3.941 + 1.106·RQ  → litres O₂ per hour at metabolic rate W
  const kcalPerLO2 = 3.941 + 1.106 * PHYS.RQ;
  const o2Lph = (W) => (W * 3600) / (kcalPerLO2 * 4184);
  const O2_G_PER_L = 1.429, CO2_G_PER_L = 1.977;            // gas densities at STP
  // consumables sized for (8 h + reserve) at the NASA design rate
  const SIZE_H = PHYS.evaH + PHYS.reserveH;
  const CAP = {
    o2kg: (o2Lph(PHYS.W_design) * SIZE_H * O2_G_PER_L) / 1000,
    co2kg: (o2Lph(PHYS.W_design) * PHYS.RQ * SIZE_H * CO2_G_PER_L) / 1000,
    h2okg: (PHYS.W_design * 3600 * SIZE_H) / PHYS.Lsub,
    wh: PHYS.powerW * SIZE_H,
  };
  const paceKmh = (deg) => { const p = PHYS.pace; if (deg <= p[0][0]) return p[0][1]; for (let i = 1; i < p.length; i++) if (deg <= p[i][0]) return lerp(p[i - 1][1], p[i][1], (deg - p[i - 1][0]) / (p[i][0] - p[i - 1][0])); return Math.max(0.6, p.at(-1)[1] - (deg - 20) * 0.05); };
  // metabolic rate: walking at the Apollo equal-effort pace for the local grade costs the NASA design rate;
  // faster than that pace scales as (v / pace)^1.5, capped at the Apollo peak (ASSUMPTION on the exponent)
  const metabolic = (v, upDeg) => v < 0.05 ? PHYS.W_rest : clamp(PHYS.W_rest + (PHYS.W_design - PHYS.W_rest) * Math.pow(v / (paceKmh(Math.max(0, upDeg)) / 3.6), 1.5), PHYS.W_rest, PHYS.W_peak);

  // ============================================================================================ data
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
  const ST = D.stations, lander = ST.find((s) => s.kind === 'lander');
  const AOI = D.manifest.aoi.local_bounds_m;
  const CX = lander.x, CY = lander.y;
  const W = (x, y) => ({ X: x - CX, Z: -(y - CY) });
  const Lc = (X, Z) => ({ x: X + CX, y: CY - Z });
  const elev = new Float32Array(NC * NR);
  { let s = 0, n = 0; for (let i = 0; i < NC * NR; i++) { const v = grids.elevation.arr[i]; if (v !== 65535) { s += v; n++; } }
    const mean = s / n; for (let i = 0; i < NC * NR; i++) { const v = grids.elevation.arr[i]; elev[i] = (v === 65535 ? mean : v) * 0.1 - 3000; } }

  // ============================================================================================ quality
  const QUAL = {
    ultra: { step: 1, post: true, bloom: true, shadow: 4096, normal: true, rocksR: 110, dust: 900, pixel: 1.0, aa: 4 },
    high: { step: 1, post: true, bloom: true, shadow: 2048, normal: true, rocksR: 80, dust: 500, pixel: 1.0, aa: 2 },
    low: { step: 2, post: false, bloom: false, shadow: 1024, normal: false, rocksR: 45, dust: 200, pixel: 1.0, aa: 0 },
  };
  let Q = QUAL[TOUCH ? 'low' : 'ultra'];
  const STEP = Q.step;   // mesh decimation is fixed at boot (phones: 10 m)
  const MR = Math.floor((NR - 1) / STEP) + 1, MC = Math.floor((NC - 1) / STEP) + 1;
  const node = (r, c) => elev[Math.min(NR - 1, r * STEP) * NC + Math.min(NC - 1, c * STEP)];
  function heightLocal(x, y) {
    const cf = ((x - g5.x0) / CELL - 0.5) / STEP, rf = ((g5.y0 - y) / CELL - 0.5) / STEP;
    const c0 = clamp(Math.floor(cf), 0, MC - 2), r0 = clamp(Math.floor(rf), 0, MR - 2);
    const tc = clamp(cf - c0, 0, 1), tr = clamp(rf - r0, 0, 1);
    return lerp(lerp(node(r0, c0), node(r0, c0 + 1), tc), lerp(node(r0 + 1, c0), node(r0 + 1, c0 + 1), tc), tr);
  }
  const E0 = heightLocal(CX, CY);
  const groundY = (X, Z) => { const p = Lc(X, Z); return heightLocal(p.x, p.y) - E0; };

  // MEDA climatology by LMST (mean of depot sols) — historical reference, not a forecast
  const medaRef = (() => {
    const m = D.environment.meda; if (!m) return null;
    const bins = {}; for (const r of m.records) { if (r.value === null) continue; const k = r.quantity + ':' + r.lmst_bin_start_h; (bins[k] = bins[k] || []).push(r.value); }
    const curve = (q) => Array.from({ length: 48 }, (_, i) => { const a = bins[q + ':' + i * 0.5]; return a ? a.reduce((s, v) => s + v, 0) / a.length : null; });
    return { T: curve('air_temperature'), P: curve('pressure'), sols: m.sols.map((s) => s.sol), ls: [m.sols[0].solar_longitude_deg, m.sols.at(-1).solar_longitude_deg] };
  })();
  function medaAt(q, lmst) { if (!medaRef) return null; const a = medaRef[q], i = Math.floor(lmst * 2) % 48; for (let k = 0; k < 6; k++) { const v = a[(i + k) % 48] ?? a[(i - k + 48) % 48]; if (v !== null && v !== undefined) return v; } return null; }
  const swx = D.environment.spaceweather;
  const cmeNear = (t) => (swx?.cme_mars || []).filter((c) => c.arrival_utc && Math.abs(new Date(c.arrival_utc).getTime() - t) <= 24 * 3600e3);
  const routeOf = (th) => D.routes.find((r) => r.theta_max_deg === th);
  const roverPark = (th) => D.rover?.scenarios?.[Number(th).toFixed(1)];
  function plannedWalkHours(th) {
    const r = routeOf(th), p = D.profiles.profiles[r.scenario_id]; let h = 0;
    for (let i = 10; i < p.distance_m.length; i += 10) { const dd = p.distance_m[i] - p.distance_m[i - 10], dz = p.elevation_smoothed_m[i] - p.elevation_smoothed_m[i - 10]; h += dd / 1000 / paceKmh(Math.atan2(dz, dd) / D2R); }
    return h;
  }

  // ============================================================================================ state
  const S = {
    theta: D.manifest.config.routing.default_deg, speed: 10, rover: true, view: 'tp', mode: 'walk', gfx: 'auto',
    sim: Date.now(), evaStart: null, playing: false, paused: false, over: false, routeLine: true, headlamp: false,
    score: 0, done: new Set(), waypoint: null, trail: [], walked: 0,
    res: { o2: CAP.o2kg, co2: 0, h2o: CAP.h2okg, wh: CAP.wh, integ: 1, dose: 0 }, wAvg: PHYS.W_design, hr: 70, jumpW: 0,
  };

  // ============================================================================================ renderer, sky, light
  const canvas = $('#view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !Q.post && !TOUCH, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, TOUCH ? 1.5 : 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.08, 12000);

  const skyU = { sunDir: { value: new THREE.Vector3(0, 1, 0) }, day: { value: 1 }, dust: { value: 0.0 } };
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: skyU,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 sunDir; uniform float day; uniform float dust; varying vec3 vD;
      void main(){
        vec3 d = normalize(vD); float h = clamp(d.y, -0.25, 1.0);
        vec3 zen = vec3(0.30,0.21,0.16), hor = vec3(0.92,0.70,0.50), low = vec3(0.70,0.48,0.32);
        vec3 col = mix(hor, zen, pow(max(h,0.0), 0.5));
        col = mix(col, low, smoothstep(0.0,-0.25,h));
        float sd = max(dot(d, normalize(sunDir)), 0.0);
        float sunLow = 1.0 - smoothstep(-0.05, 0.4, sunDir.y);
        col = mix(col, vec3(0.38,0.56,0.92), sunLow * pow(sd, 5.0) * 0.95);            // blue Martian sunset (forward scattering by dust)
        col += vec3(1.0,0.82,0.62) * pow(sd, 18.0) * 0.55 * (0.4 + sunLow);           // aureole
        col += vec3(1.0,0.95,0.85) * smoothstep(0.9993, 0.99975, sd) * 18.0;           // sun disc (HDR, blooms)
        col = mix(col, hor*0.8, dust*0.5);
        col *= day; col += vec3(0.010,0.008,0.014) * (1.0 - day);
        gl_FragColor = vec4(col, 1.0);
      }` });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), skyMat); scene.add(sky);
  const stars = (() => {
    const n = 2400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u = Math.random(), a = Math.random() * Math.PI * 2, r = 8500, s = Math.sqrt(1 - u * u); pos[i * 3] = r * s * Math.cos(a); pos[i * 3 + 1] = r * u; pos[i * 3 + 2] = r * s * Math.sin(a); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    scene.add(p); return p;
  })();
  scene.fog = new THREE.FogExp2(0xcfa27a, 0.00022);
  const sun = new THREE.DirectionalLight(0xffeedd, 2.4);
  sun.castShadow = true; sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 500 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xf0c9a5, 0x4a2a18, 0.25); scene.add(hemi);
  const lampL = new THREE.SpotLight(0xe6f3ff, 0, 70, 0.5, 0.45, 1.3), lampR = lampL.clone(); scene.add(lampL, lampL.target, lampR, lampR.target);

  // environment map (sky reflections on visor, metal, ground)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  let envRT = null, envSunEl = -99;
  function updateEnv(el) {
    if (Math.abs(el - envSunEl) < 2.5 && envRT) return;
    envSunEl = el; const old = envRT; envRT = pmrem.fromScene(envScene, 0.04); scene.environment = envRT.texture; if (old) old.dispose();
  }

  // ============================================================================================ post-processing (cinematic)
  const post = (() => {
    const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), fsGeo = new THREE.PlaneGeometry(2, 2);
    const mk = (frag, uniforms) => { const m = new THREE.ShaderMaterial({ uniforms, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }', fragmentShader: frag, depthTest: false, depthWrite: false });
      const sc = new THREE.Scene(); sc.add(new THREE.Mesh(fsGeo, m)); return { m, sc }; };
    const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    let rt = null, b1 = null, b2 = null;
    const bright = mk(`uniform sampler2D t; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb; float l = dot(c, vec3(.2126,.7152,.0722)); gl_FragColor = vec4(c * smoothstep(1.0, 2.6, l), 1.); }`, { t: { value: null } });
    const blur = mk(`uniform sampler2D t; uniform vec2 dir; varying vec2 vUv;
      void main(){ vec3 c = texture2D(t,vUv).rgb*0.227;
        c += texture2D(t,vUv+dir*1.384).rgb*0.316; c += texture2D(t,vUv-dir*1.384).rgb*0.316;
        c += texture2D(t,vUv+dir*3.230).rgb*0.070; c += texture2D(t,vUv-dir*3.230).rgb*0.070; gl_FragColor = vec4(c,1.); }`, { t: { value: null }, dir: { value: new THREE.Vector2() } });
    const comp = mk(`uniform sampler2D t; uniform sampler2D tb; uniform float time; uniform float bloomK; uniform vec2 sunUv; uniform float sunVis; uniform float exposure; uniform float night; varying vec2 vUv;
      vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.); }
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec2 d = vUv - 0.5;
        vec3 c;  // subtle chromatic aberration toward the edges
        c.r = texture2D(t, vUv + d*0.0016).r; c.g = texture2D(t, vUv).g; c.b = texture2D(t, vUv - d*0.0016).b;
        c += texture2D(tb, vUv).rgb * bloomK;
        // sun glare streak + halo in screen space
        vec2 sd = vUv - sunUv; sd.x *= 1.6; float r = length(sd);
        c += vec3(1.0,0.78,0.55) * sunVis * (0.10/(r*18.0+0.6)) ;
        c += vec3(1.0,0.85,0.7) * sunVis * exp(-abs(sd.y)*90.0) * exp(-abs(sd.x)*2.2) * 0.12;
        c *= exposure;
        c = aces(c);
        // grade: warm highlights, slightly teal shadows, gentle contrast
        float l = dot(c, vec3(.2126,.7152,.0722));
        c = mix(c * vec3(0.94,1.0,1.06), c * vec3(1.06,1.0,0.92), smoothstep(0.15,0.7,l));
        c = mix(vec3(l), c, 1.08);
        c = pow(c, vec3(0.98));
        c *= 1.0 - dot(d,d)*0.85;                                   // vignette
        c += (hash(vUv*vec2(1920.,1080.) + time) - 0.5) * (0.018 + night*0.02);   // film grain
        gl_FragColor = vec4(pow(max(c,0.), vec3(1.0/2.2)), 1.0);
      }`, { t: { value: null }, tb: { value: null }, time: { value: 0 }, bloomK: { value: 0.9 }, sunUv: { value: new THREE.Vector2(-9, -9) }, sunVis: { value: 0 }, exposure: { value: 1.0 }, night: { value: 0 } });
    function size() {
      const w = Math.floor(innerWidth * renderer.getPixelRatio()), h = Math.floor(innerHeight * renderer.getPixelRatio());
      for (const r of [rt, b1, b2]) r?.dispose();
      rt = new THREE.WebGLRenderTarget(w, h, opt); rt.samples = Q.aa;
      b1 = new THREE.WebGLRenderTarget(w >> 2, h >> 2, opt); b2 = new THREE.WebGLRenderTarget(w >> 2, h >> 2, opt);
    }
    function render(time, sunWorld, night) {
      renderer.setRenderTarget(rt); renderer.render(scene, camera);
      if (Q.bloom) {
        bright.m.uniforms.t.value = rt.texture; renderer.setRenderTarget(b1); renderer.render(bright.sc, fsCam);
        for (let i = 0; i < 2; i++) {
          blur.m.uniforms.t.value = b1.texture; blur.m.uniforms.dir.value.set(1 / b1.width, 0); renderer.setRenderTarget(b2); renderer.render(blur.sc, fsCam);
          blur.m.uniforms.t.value = b2.texture; blur.m.uniforms.dir.value.set(0, 1 / b1.height); renderer.setRenderTarget(b1); renderer.render(blur.sc, fsCam);
        }
      }
      // sun position on screen
      const p = sunWorld.clone().project(camera); const on = p.z < 1 && Math.abs(p.x) < 1.3 && Math.abs(p.y) < 1.3;
      comp.m.uniforms.sunUv.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5); comp.m.uniforms.sunVis.value = on ? clamp(1.3 - Math.max(Math.abs(p.x), Math.abs(p.y)), 0, 1) * (1 - night) : 0;
      comp.m.uniforms.t.value = rt.texture; comp.m.uniforms.tb.value = Q.bloom ? b1.texture : null; comp.m.uniforms.bloomK.value = Q.bloom ? 0.6 : 0; comp.m.uniforms.exposure.value = post.expo || 0.9;
      comp.m.uniforms.time.value = time % 100; comp.m.uniforms.night.value = night;
      renderer.setRenderTarget(null); renderer.render(comp.sc, fsCam);
    }
    return { size, render };
  })();
  function applyRendererMode() {
    // post pipeline does its own tone mapping + sRGB; direct path uses the renderer's
    renderer.toneMapping = Q.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    renderer.outputEncoding = Q.post ? THREE.LinearEncoding : THREE.sRGBEncoding;
    scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  }
  function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (Q.post) post.size(); }
  addEventListener('resize', resize);

  // ============================================================================================ terrain
  function detailTexture(n = 256) {
    const cv = document.createElement('canvas'); cv.width = cv.height = n; const ctx = cv.getContext('2d'); const img = ctx.createImageData(n, n);
    const rnd = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      let v = 0, a = 0.5, f = 1 / 32;
      for (let o = 0; o < 5; o++) { const X = x * f, Y = y * f, xi = Math.floor(X), yi = Math.floor(Y), tx = X - xi, ty = Y - yi, p = n * f;
        const r00 = rnd(xi % p, yi % p), r10 = rnd((xi + 1) % p, yi % p), r01 = rnd(xi % p, (yi + 1) % p), r11 = rnd((xi + 1) % p, (yi + 1) % p);
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty); v += a * lerp(lerp(r00, r10, sx), lerp(r01, r11, sx), sy); a *= 0.5; f *= 2; }
      const g = clamp(v * 255, 0, 255), i = (y * n + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = g; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  }
  let terrain;
  function buildTerrain() {
    const pos = new Float32Array(MR * MC * 3), uv = new Float32Array(MR * MC * 2);
    const w = AOI.xmax - AOI.xmin, h = AOI.ymax - AOI.ymin;
    for (let r = 0; r < MR; r++) for (let c = 0; c < MC; c++) {
      const x = g5.x0 + (Math.min(NC - 1, c * STEP) + 0.5) * CELL, y = g5.y0 - (Math.min(NR - 1, r * STEP) + 0.5) * CELL;
      const i = r * MC + c, p = W(x, y); pos[i * 3] = p.X; pos[i * 3 + 1] = node(r, c) - E0; pos[i * 3 + 2] = p.Z;
      uv[i * 2] = (x - AOI.xmin) / w; uv[i * 2 + 1] = (y - AOI.ymin) / h;
    }
    const idx = new Uint32Array((MR - 1) * (MC - 1) * 6); let k = 0;
    for (let r = 0; r < MR - 1; r++) for (let c = 0; c < MC - 1; c++) { const a = r * MC + c, b = a + 1, d = a + MC, e = d + 1; idx[k++] = a; idx[k++] = d; idx[k++] = b; idx[k++] = b; idx[k++] = d; idx[k++] = e; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeVertexNormals();
    const tl = new THREE.TextureLoader(); const maxA = renderer.capabilities.getMaxAnisotropy();
    const tex = tl.load('../data/game_terrain.jpg'); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = maxA;
    const det = detailTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.94, metalness: 0, envMapIntensity: 0.35 });
    if (Q.normal) { const nm = tl.load('../data/game_normal.jpg'); nm.anisotropy = maxA; mat.normalMap = nm; mat.normalScale = new THREE.Vector2(2.2, 2.2); }
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: det };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;').replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec3 vWPos;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float dd = distance(vWPos, cameraPosition);
          float d1 = texture2D(detailMap, vWPos.xz * 0.55).r, d2 = texture2D(detailMap, vWPos.xz * 0.09).r, d3 = texture2D(detailMap, vWPos.xz * 0.012).r;
          float near = 1.0 - smoothstep(20.0, 220.0, dd);
          diffuseColor.rgb *= mix(1.0, 0.70 + 0.62 * (d1 * 0.55 + d2 * 0.45), near);
          diffuseColor.rgb *= 0.9 + 0.2 * d3;                       // macro variation
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 0.97, 0.9), 0.5);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          { float e = 0.02; vec2 p = vWPos.xz * 0.55;
            float h0 = texture2D(detailMap, p).r, hx = texture2D(detailMap, p + vec2(e,0.)).r, hz = texture2D(detailMap, p + vec2(0.,e)).r;
            float nk = (1.0 - smoothstep(4.0, 60.0, distance(vWPos, cameraPosition))) * 0.9;
            normal = normalize(normal + nk * (mat3(viewMatrix) * (vec3(h0 - hx, 0.0, h0 - hz) * 6.0))); }`);
    };
    terrain = new THREE.Mesh(geo, mat); terrain.receiveShadow = true; scene.add(terrain);
  }

  // ============================================================================================ models
  const M = {
    suit: new THREE.MeshStandardMaterial({ color: 0xc9c4ba, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.45 }),
    suit2: new THREE.MeshStandardMaterial({ color: 0xa39d92, roughness: 0.9, envMapIntensity: 0.45 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xff6a2b, roughness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.55, metalness: 0.35 }),
    visor: new THREE.MeshStandardMaterial({ color: 0xc89b3c, roughness: 0.04, metalness: 1.0, envMapIntensity: 2.2 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xc4c8cf, roughness: 0.28, metalness: 0.9, envMapIntensity: 1.4 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4aa38, roughness: 0.32, metalness: 1.0, envMapIntensity: 1.6 }),
    glowW: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdff1ff, emissiveIntensity: 0 }),
    glowG: new THREE.MeshBasicMaterial({ color: 0x4fe3a4 }),
  };
  const shadowAll = (o) => o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  function seg(r, len, mat) { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat); m.position.y = -len / 2 - r * 0.5; g.add(m); return g; }
  function joint(r) { return new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.22, 8, 20), M.dark); }
  function makeAstronaut() {
    const g = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.4, 8, 18), M.suit); torso.position.y = 1.18; torso.scale.set(1.08, 1, 0.9); g.add(torso);
    const hip = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.23, 0.18, 20), M.suit2); hip.position.y = 0.92; g.add(hip);
    const hipRing = joint(0.24); hipRing.rotation.x = Math.PI / 2; hipRing.position.y = 1.0; g.add(hipRing);
    const dcm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.17, 0.1), M.dark); dcm.position.set(0, 1.25, 0.27); g.add(dcm);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.02), M.glowG); led.position.set(0.08, 1.29, 0.33); g.add(led);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.68, 0.3), M.suit); pack.position.set(0, 1.24, -0.32); g.add(pack);
    const packLid = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.26), M.dark); packLid.position.set(0, 1.6, -0.32); g.add(packLid);
    for (const s of [-1, 1]) { const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 12), M.metal); tank.position.set(0.2 * s, 1.22, -0.5); g.add(tank); }
    const ring = joint(0.2); ring.rotation.x = Math.PI / 2; ring.position.y = 1.5; g.add(ring);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.235, 32, 24), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transmission: 0, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.35, envMapIntensity: 1.5 }));
    helmet.position.y = 1.71; g.add(helmet);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.245, 32, 24, Math.PI * 0.62, Math.PI * 1.76, 0, Math.PI * 0.62), M.suit); shell.position.y = 1.71; g.add(shell);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.228, 32, 24, -Math.PI * 0.4, Math.PI * 0.8, Math.PI * 0.2, Math.PI * 0.48), M.visor); visor.position.set(0, 1.71, 0.01); g.add(visor);
    for (const s of [-1, 1]) { const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 12), M.glowW); lamp.rotation.x = Math.PI / 2; lamp.position.set(0.17 * s, 1.86, 0.12); g.add(lamp); }
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.05, 24, 1, true), M.accent); band.position.y = 1.36; g.add(band);
    const parts = {};
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(0.36 * s, 1.43, 0); g.add(sh);
      const sj = joint(0.085); sj.rotation.z = Math.PI / 2; sh.add(sj);
      const up = seg(0.08, 0.22, M.suit); sh.add(up);
      const el = new THREE.Group(); el.position.y = -0.36; sh.add(el); const ej = joint(0.075); ej.rotation.z = Math.PI / 2; el.add(ej);
      const lo = seg(0.072, 0.2, M.suit); el.add(lo);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 14), M.accent); cuff.position.y = -0.31; el.add(cuff);
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), M.dark); glove.position.y = -0.4; glove.scale.set(1, 1.2, 0.8); el.add(glove);
      const hp = new THREE.Group(); hp.position.set(0.14 * s, 0.88, 0); g.add(hp);
      const th = seg(0.105, 0.26, M.suit); hp.add(th);
      const kn = new THREE.Group(); kn.position.y = -0.43; hp.add(kn); const kj = joint(0.095); kj.rotation.z = Math.PI / 2; kn.add(kj);
      const sk = seg(0.09, 0.24, M.suit); kn.add(sk);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.32), M.dark); boot.position.set(0, -0.42, 0.05); kn.add(boot);
      Object.assign(parts, s < 0 ? { shL: sh, elL: el, hpL: hp, knL: kn } : { shR: sh, elR: el, hpR: hp, knR: kn });
    }
    g.userData.parts = parts; shadowAll(g); helmet.castShadow = false; return g;
  }
  function makeRover() {
    const g = new THREE.Group();
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.24, 3.4), M.metal); chassis.position.y = 0.8; g.add(chassis);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 3.3), M.dark); deck.position.y = 0.95; g.add(deck);
    const wheels = [];
    for (const s of [-1, 1]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.45, 0.55), M.suit); seat.position.set(0.45 * s, 1.22, 0.2); g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.1), M.suit); back.position.set(0.45 * s, 1.55, -0.07); g.add(back);
      for (const z of [-1.25, 0, 1.25]) {
        const wg = new THREE.Group(); wg.position.set(1.15 * s, 0.45, z); g.add(wg);
        const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.32, 24), M.dark); tire.rotation.z = Math.PI / 2; wg.add(tire);
        for (let k = 0; k < 8; k++) { const tread = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.1), M.metal); const a = k * Math.PI / 4; tread.position.set(0, Math.cos(a) * 0.45, Math.sin(a) * 0.45); tread.rotation.x = a; wg.add(tread); }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.34, 12), M.accent); hub.rotation.z = Math.PI / 2; wg.add(hub);
        wheels.push(wg);
      }
      const fender = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.04, 3.55), M.accent); fender.position.set(1.15 * s, 0.97, 0); g.add(fender);
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.05), M.glowW); hl.position.set(0.7 * s, 0.86, 1.72); g.add(hl);
    }
    const console_ = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.32, 0.25), M.dark); console_.position.set(0, 1.22, 0.85); g.add(console_);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.2), new THREE.MeshBasicMaterial({ color: 0x5fd0ff })); screen.position.set(0, 1.3, 0.72); screen.rotation.x = -0.4; screen.rotation.y = Math.PI; g.add(screen);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.4, 8), M.metal); mast.position.set(-0.8, 1.7, -1.3); g.add(mast);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 10, 0, Math.PI * 2, 0, Math.PI / 3), M.suit); dish.position.set(-0.8, 2.45, -1.3); dish.rotation.x = -0.6; g.add(dish);
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.42, 0.9), M.suit); cargo.position.set(0, 1.18, -1.15); g.add(cargo);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 0.85), new THREE.MeshStandardMaterial({ color: 0x1b2a4a, roughness: 0.25, metalness: 0.6, envMapIntensity: 1.5 })); panel.position.set(0, 1.42, -1.15); g.add(panel);
    g.userData.wheels = wheels; shadowAll(g); return g;
  }
  function makeLander() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 4.4, 40), M.suit); body.position.y = 4.4; g.add(body);
    for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.CylinderGeometry(2.42 + i * 0.13, 2.42 + i * 0.13, 0.06, 40, 1, true), M.dark); r.position.y = 3.2 + i * 1.2; g.add(r); }
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.85, 2.85, 0.35, 40), M.accent); ring.position.y = 2.4; g.add(ring);
    const top = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.2, 40), M.suit); top.position.y = 7.7; g.add(top);
    const foil = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.6, 1.2, 40), M.gold); foil.position.y = 1.7; g.add(foil);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4, leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.6, 10), M.metal);
      leg.position.set(Math.cos(a) * 3.0, 1.4, Math.sin(a) * 3.0); leg.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); g.add(leg);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.12, 18), M.metal); pad.position.set(Math.cos(a) * 3.8, 0.06, Math.sin(a) * 3.8); g.add(pad);
      const thr = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 14, 1, true), M.dark); thr.position.set(Math.cos(a + 0.4) * 2.3, 1.0, Math.sin(a + 0.4) * 2.3); thr.rotation.x = Math.PI; g.add(thr);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.9, 0.2), M.dark); door.position.set(0, 3.9, 2.55); g.add(door);
    const doorRim = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.1, 0.12), M.accent); doorRim.position.set(0, 3.9, 2.5); g.add(doorRim);
    const doorLight = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.05), M.glowG); doorLight.position.set(0, 5.0, 2.62); g.add(doorLight);
    for (let i = 0; i < 6; i++) { const rung = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), M.metal); rung.position.set(0, 0.4 + i * 0.5, 3.0 + i * 0.06); g.add(rung); }
    const ant = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 10, 0, Math.PI * 2, 0, Math.PI / 3), M.suit); ant.position.set(1.2, 9.0, 0); ant.rotation.z = 0.5; g.add(ant);
    shadowAll(g); return g;
  }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function label(text, color = '#ffd27a') {
    const cv = document.createElement('canvas'), ctx = cv.getContext('2d'); const f = 44;
    ctx.font = `700 ${f}px Inter, system-ui, sans-serif`; const w = Math.ceil(ctx.measureText(text).width) + 40; cv.width = w; cv.height = f + 28;
    ctx.font = `700 ${f}px Inter, system-ui, sans-serif`; ctx.fillStyle = 'rgba(12,14,20,.72)'; roundRect(ctx, 0, 0, w, cv.height, 18); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 3; roundRect(ctx, 1.5, 1.5, w - 3, cv.height - 3, 16); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(text, 20, cv.height / 2 + 2);
    const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false, toneMapped: false, fog: false }));
    sp.scale.set(0.00042 * w, 0.00042 * cv.height, 1); sp.renderOrder = 10; return sp;
  }
  function beacon(color) {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1.0, 90, 20, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.position.y = 45; g.add(beam);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 3.9, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; g.add(ring);
    g.userData = { beam, ring }; return g;
  }

  // ============================================================================================ world
  let astro, roverObj, landerObj, routeLine;
  const beacons = {};
  const place = (obj, x, y, dy = 0) => { const p = W(x, y); obj.position.set(p.X, groundY(p.X, p.Z) + dy, p.Z); };
  function buildWorld() {
    buildTerrain();
    landerObj = makeLander(); place(landerObj, lander.x, lander.y, -0.05); scene.add(landerObj);
    const lab = label('L0 · Lander (airlock)', '#ffffff'); lab.position.y = 12; landerObj.add(lab);
    for (const s of ST.filter((x) => x.kind !== 'lander')) {
      const b = beacon(s.kind === 'depot' ? 0xc77dff : 0xff8c42); place(b, s.x, s.y); scene.add(b); beacons[s.id] = b;
      const lb = label(`${s.id} · ${s.name.split(' —')[0].replace(' (inspection only)', '')}`, s.kind === 'depot' ? '#c77dff' : '#ffb070'); lb.position.y = 9; b.add(lb);
    }
    for (const t of D.depot_tubes?.tubes || []) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.21, 12), M.metal);
      tube.rotation.set(0, -t.tube_azimuth_deg * D2R + Math.PI / 2, Math.PI / 2, 'YXZ'); place(tube, t.x, t.y, 0.05); scene.add(tube); tube.castShadow = true;
      const mk = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.42, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      mk.rotation.x = -Math.PI / 2; place(mk, t.x, t.y, 0.04); scene.add(mk);
    }
    buildRouteLine();
    astro = makeAstronaut(); scene.add(astro);
    roverObj = makeRover(); scene.add(roverObj);
    const rl = label('Backup rover', '#6fd3ff'); rl.position.y = 4; roverObj.add(rl);
    buildFX();
  }
  function buildRouteLine() {
    if (routeLine) scene.remove(routeLine);
    const r = routeOf(S.theta); if (!r?.feasible) return;
    const pts = r.geometry_xy.map(([x, y]) => { const p = W(x, y); return new THREE.Vector3(p.X, groundY(p.X, p.Z) + 0.3, p.Z); });
    routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xffa04d, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.8, fog: false }));
    routeLine.computeLineDistances(); routeLine.visible = S.routeLine; scene.add(routeLine);
  }

  // ============================================================================================ FX: rocks (Golombek & Rapp), dust, footprints, puffs
  let rocks = null, rockCenter = null, motes = null, prints = null, printIdx = 0, puffs = null;
  const puffData = [];
  // Golombek & Rapp (1997, JGR, Mars Pathfinder/Viking rock model, used for Mars 2020 landing hazards):
  // cumulative fractional area F(D) = k·exp(−q·D), q = 1.79 + 0.152/k. Rock abundance k per cell is an ASSUMPTION
  // (3–12 %, higher on steeper 5 m cells); the DTM cannot resolve individual rocks.
  function buildRocks() {
    if (rocks) { scene.remove(rocks); rocks.geometry.dispose(); }
    const R = Q.rocksR, Dmin = 0.18, maxN = Math.round(Math.PI * R * R * 0.32);
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const pa = geo.attributes.position; for (let i = 0; i < pa.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(pa, i); const n = 1 + 0.22 * Math.sin(v.x * 5.1 + v.y * 3.7) * Math.cos(v.z * 4.3); v.multiplyScalar(n); pa.setXYZ(i, v.x, v.y * 0.7, v.z); }
    geo.computeVertexNormals();
    rocks = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x8a5539, roughness: 0.92, envMapIntensity: 0.4 }), maxN);
    rocks.castShadow = true; rocks.receiveShadow = true; scene.add(rocks); rockCenter = null;
  }
  function scatterRocks(X0, Z0) {
    const R = Q.rocksR, Dmin = 0.18; const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    let k = 0; const cell = 2.0;
    const hash = (a, b, c) => { const h = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return h - Math.floor(h); };
    for (let gx = Math.floor((X0 - R) / cell); gx <= Math.floor((X0 + R) / cell); gx++) for (let gz = Math.floor((Z0 - R) / cell); gz <= Math.floor((Z0 + R) / cell); gz++) {
      const cx = gx * cell, cz = gz * cell; if ((cx - X0) ** 2 + (cz - Z0) ** 2 > R * R) continue;
      const lp = Lc(cx, cz), [r, c] = rcOf(lp.x, lp.y), sl = gv('slope', r, c); if (sl === null) continue;
      const kAb = clamp(0.03 + sl / 200, 0.03, 0.12), qq = 1.79 + 0.152 / kAb;
      // expected count of rocks with D > Dmin in this cell from the cumulative-area law (mean area per rock ≈ π/4·(Dmin+1/q)²)
      const area = kAb * Math.exp(-qq * Dmin) * cell * cell, meanD = Dmin + 1 / qq, n = area / (Math.PI / 4 * meanD * meanD);
      const u = hash(gx, gz, 1); if (u > n) continue;
      if (Math.hypot(lp.x - lander.x, lp.y - lander.y) < 12 || ST.some((st) => Math.hypot(lp.x - st.x, lp.y - st.y) < 4)) continue;
      if (k >= rocks.count) break;
      const D = Dmin - Math.log(1 - hash(gx, gz, 2) * 0.999) / qq;   // exponential size distribution above Dmin
      const x = cx + (hash(gx, gz, 3) - 0.5) * cell, z = cz + (hash(gx, gz, 4) - 0.5) * cell;
      p.set(x, groundY(x, z) + D * 0.18, z); e.set(hash(gx, gz, 5) * 3, hash(gx, gz, 6) * 6, hash(gx, gz, 7) * 3); q.setFromEuler(e);
      s.set(D * 0.5 * (0.8 + hash(gx, gz, 8) * 0.5), D * 0.5 * (0.6 + hash(gx, gz, 9) * 0.4), D * 0.5 * (0.8 + hash(gx, gz, 10) * 0.5));
      m.compose(p, q, s); rocks.setMatrixAt(k, m); col.setHSL(0.05 + hash(gx, gz, 11) * 0.025, 0.42, 0.22 + hash(gx, gz, 12) * 0.14); rocks.setColorAt(k, col); k++;
    }
    rocks.count = k; rocks.instanceMatrix.needsUpdate = true; if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true; rockCenter = [X0, Z0];
  }
  function spriteTex(kind) {
    const n = 128, cv = document.createElement('canvas'); cv.width = cv.height = n; const c = cv.getContext('2d');
    if (kind === 'soft') { const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, n, n); }
    else { // boot print: rounded sole with tread bars
      c.fillStyle = 'rgba(0,0,0,0)'; c.fillRect(0, 0, n, n); c.fillStyle = 'rgba(40,20,10,0.75)';
      c.beginPath(); c.ellipse(n / 2, n * 0.3, n * 0.22, n * 0.24, 0, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(n / 2, n * 0.72, n * 0.18, n * 0.2, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,220,180,0.25)'; for (let i = 0; i < 9; i++) c.fillRect(n * 0.3, n * (0.1 + i * 0.09), n * 0.4, n * 0.025); }
    const t = new THREE.CanvasTexture(cv); return t;
  }
  function buildFX() {
    buildRocks();
    // dust motes floating around the camera (wind-borne)
    const n = Q.dust, pos = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) pos[i] = (Math.random() - 0.5) * 50;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    motes = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.06, map: spriteTex('soft'), color: 0xe9c29a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(motes);
    // footprints
    prints = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.17, 0.33), new THREE.MeshStandardMaterial({ map: spriteTex('print'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 1 }), 700);
    prints.count = 0; prints.receiveShadow = true; scene.add(prints);
    // dust puffs (feet and wheels)
    const pn = 400, pp = new Float32Array(pn * 3).fill(-1e5), pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    puffs = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.5, map: spriteTex('soft'), color: 0xc49064, transparent: true, opacity: 0.45, depthWrite: false }));
    puffs.frustumCulled = false; scene.add(puffs);
    for (let i = 0; i < pn; i++) puffData.push({ life: 0 });
  }
  let puffI = 0;
  function puff(x, y, z, n, spread, up) {
    for (let i = 0; i < n; i++) { const d = puffData[puffI]; puffI = (puffI + 1) % puffData.length;
      Object.assign(d, { x, y: y + 0.05, z, vx: (Math.random() - 0.5) * spread, vy: Math.random() * up, vz: (Math.random() - 0.5) * spread, life: 1.4 + Math.random() }); }
  }
  function footprint(X, Z, yaw, side) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, -yaw + Math.PI, 'YXZ'));
    const ox = Math.cos(yaw) * 0.12 * side, oz = -Math.sin(yaw) * 0.12 * side;
    const p = new THREE.Vector3(X + ox, groundY(X + ox, Z + oz) + 0.02, Z + oz);
    q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, yaw, 'YXZ'));
    m.compose(p, q, new THREE.Vector3(1, 1, 1)); prints.setMatrixAt(printIdx, m); printIdx = (printIdx + 1) % 700; prints.count = Math.max(prints.count, printIdx); prints.instanceMatrix.needsUpdate = true;
  }
  function updateFX(dt, st) {
    // motes follow the camera, drift with a gentle wind
    const a = motes.geometry.attributes.position; const cp = camera.position;
    for (let i = 0; i < a.count; i++) {
      let x = a.getX(i) + dt * 0.8, y = a.getY(i) + Math.sin(i + performance.now() / 1500) * dt * 0.05, z = a.getZ(i) + dt * 0.3;
      if (x - cp.x > 25) x -= 50; if (x - cp.x < -25) x += 50; if (z - cp.z > 25) z -= 50; if (z - cp.z < -25) z += 50; if (y - cp.y > 12) y -= 20; if (y - cp.y < -8) y += 20;
      a.setXYZ(i, x, y, z);
    }
    a.needsUpdate = true; motes.material.opacity = 0.15 + 0.4 * clamp((st.elev + 4) / 20, 0, 1);
    // puffs
    const pp = puffs.geometry.attributes.position;
    for (let i = 0; i < puffData.length; i++) { const d = puffData[i];
      if (d.life > 0) { d.life -= dt; d.vy -= PHYS.g * 0.15 * dt; d.vx *= 0.97; d.vz *= 0.97; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; pp.setXYZ(i, d.x, d.y, d.z); }
      else pp.setXYZ(i, 0, -1e5, 0); }
    pp.needsUpdate = true;
    // rocks re-scatter around the player
    if (!rockCenter || Math.hypot(P.X - rockCenter[0], P.Z - rockCenter[1]) > Q.rocksR * 0.4) scatterRocks(P.X, P.Z);
  }

  // ============================================================================================ player & input
  const P = { X: 0, Z: 0, Y: 0, vy: 0, yaw: 0, camYaw: 0, camPitch: -0.12, camDist: 6.5, onGround: true, phase: 0, lastStep: 0, speed: 0, run: false,
    rover: { X: 0, Z: 0, yaw: 0, v: 0, roll: 0 }, upDeg: 0, blocked: false, edge: false, shake: 0 };
  const keys = new Set(); const joy = { x: 0, y: 0, active: false };
  function resetPlayer() {
    P.X = 0; P.Z = 7.5; P.Y = groundY(P.X, P.Z); P.vy = 0;
    const first = ST.find((s) => s.id === nextObj()); const p0 = Lc(P.X, P.Z);
    const brg = Math.atan2(first.x - p0.x, first.y - p0.y); P.yaw = P.camYaw = -brg; P.camPitch = -0.12;
    const park = S.rover ? roverPark(S.theta) : null;
    if (park) { const w = W(park.park_xy[0] + 8, park.park_xy[1] + 6); P.rover.X = w.X; P.rover.Z = w.Z; P.rover.yaw = 0.6; roverObj.visible = true; } else roverObj.visible = false;
  }
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase(); if (!S.playing) return;
    if (!$('#mapview').classList.contains('hidden')) { if (k === 'm' || k === 'escape') toggleMap(false); return; }
    if (!$('#modal').classList.contains('hidden')) { if (k === 'escape' || k === 'enter') { closeModal(); if (S.paused) setPaused(false); } return; }
    keys.add(k);
    if (k === ' ') { e.preventDefault(); jump(); }
    if (k === 'e') interact(); if (k === 'v') toggleView(); if (k === 'm') toggleMap(true); if (k === 'h') showHelp();
    if (k === 'p' || k === 'escape') setPaused(!S.paused); if (k === 't') cycleSpeed();
    if (k === 'r') { S.routeLine = !S.routeLine; if (routeLine) routeLine.visible = S.routeLine; flash(S.routeLine ? 'Route guide on' : 'Route guide off', 'info'); }
    if (k === 'l') { S.headlamp = !S.headlamp; flash(S.headlamp ? 'Helmet lights on' : 'Helmet lights auto', 'info'); }
    if (k === 'shift') P.run = true;
  });
  addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); keys.delete(k); if (k === 'shift') P.run = false; });
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!S.playing || S.paused) return;
    if (S.view === 'fp' && !TOUCH && document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (document.pointerLockElement === canvas) { look(e.movementX, e.movementY); return; }
    if (drag && e.pointerId === drag.id) { look(e.clientX - drag.x, e.clientY - drag.y, 2.2); drag.x = e.clientX; drag.y = e.clientY; }
  });
  canvas.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.id) drag = null; });
  canvas.addEventListener('wheel', (e) => { if (S.view === 'tp') P.camDist = clamp(P.camDist * (e.deltaY > 0 ? 1.12 : 0.89), 2.5, 40); }, { passive: true });
  function look(dx, dy, k = 1) { P.camYaw -= dx * 0.0024 * k; P.camPitch = clamp(P.camPitch - dy * 0.0022 * k, S.view === 'fp' ? -1.35 : -1.2, S.view === 'fp' ? 1.2 : 0.4); }
  const stick = $('#stick'), knob = $('#knob');
  stick.addEventListener('pointerdown', (e) => { joy.active = true; joy.id = e.pointerId; try { stick.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } moveJoy(e); });
  stick.addEventListener('pointermove', (e) => { if (joy.active && e.pointerId === joy.id) moveJoy(e); });
  const endJoy = () => { joy.active = false; joy.x = joy.y = 0; knob.style.transform = ''; };
  stick.addEventListener('pointerup', endJoy); stick.addEventListener('pointercancel', endJoy);
  function moveJoy(e) { const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2;
    let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; } joy.x = dx; joy.y = -dy; knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`; }
  const hold = (id, on) => { $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); on(); }); };
  hold('#t-jump', () => jump()); hold('#t-run', () => { P.run = !P.run; $('#t-run').classList.toggle('on', P.run); }); hold('#t-act', () => interact());
  $('#b-map').onclick = () => toggleMap(true); $('#b-view').onclick = () => toggleView(); $('#b-help').onclick = () => showHelp(); $('#b-pause').onclick = () => setPaused(!S.paused); $('#h-speed').onclick = () => cycleSpeed();
  function cycleSpeed() { const o = [1, 5, 10, 20, 40]; S.speed = o[(o.indexOf(S.speed) + 1) % o.length]; $('#h-speed').textContent = `×${S.speed}`; flash(`Travel & time ×${S.speed}`, 'info'); }
  function toggleView() { S.view = S.view === 'tp' ? 'fp' : 'tp'; document.body.classList.toggle('fp', S.view === 'fp'); if (S.view === 'tp' && document.pointerLockElement) document.exitPointerLock();
    flash(S.view === 'fp' ? 'First person — click to look around (Esc releases the mouse)' : 'Third person — drag to orbit, scroll to zoom', 'info'); }
  function jump() { if (S.mode !== 'walk' || !P.onGround || S.paused) return; P.vy = 2.6; P.onGround = false; S.jumpW = 1; }

  // ============================================================================================ simulation
  const clock = new THREE.Clock(); const flashes = [];
  function flash(text, kind = 'warn', secs = 3) { flashes.push({ text, kind, until: performance.now() + secs * 1000 }); }
  const state = () => M24.at(new Date(S.sim));
  const sunCache = {};
  function sunTimes() { const sol = M24.at(new Date(S.sim)).sol; return sunCache[sol] || (sunCache[sol] = M24.sunTimes(new Date(S.sim))); }
  function haven(X, Z) {
    const p = Lc(X, Z); const [r, c] = rcOf(p.x, p.y); const kp = S.rover && D.rover ? `haven_phys_${S.theta}` : `walkback_phys_${S.theta}`; let best = null;
    for (let d = 0; d <= 4 && !best; d++) for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) { const v = gv(kp, r + dr * 2, c + dc * 2); if (v !== null && (!best || v < best.phys)) best = { phys: v + d * 2 * CELL }; }
    return best;
  }
  const airTemp = (st) => medaAt('T', st.lmst) ?? 210;
  function heaterW(T, st) { return Math.max(0, 245 - T) * 0.9 + (S.headlamp || st.elev < 2 ? 8 : 0); }
  function step(dt) {
    // one speed factor k scales BOTH the clock and the gait, so consumables per metre follow the NASA rates
    const k = S.speed, dts = dt * k, dh = dts / 3600;
    S.sim += dts * 1000;
    const st = state();
    let mx = 0, mz = 0;
    if (keys.has('w') || keys.has('arrowup')) mz += 1; if (keys.has('s') || keys.has('arrowdown')) mz -= 1;
    if (keys.has('a') || keys.has('arrowleft')) mx -= 1; if (keys.has('d') || keys.has('arrowright')) mx += 1;
    if (joy.active) { mx += joy.x; mz += joy.y; }
    const mag = Math.min(1, Math.hypot(mx, mz));
    let Wm = PHYS.W_rest, vPhys = 0;
    if (S.mode === 'walk') {
      let vx = 0, vz = 0; P.blocked = false;
      if (mag > 0.05) {
        const ang = P.camYaw - Math.atan2(mx, mz), dx = -Math.sin(ang), dz = -Math.cos(ang);
        const ahead = groundY(P.X + dx * 2, P.Z + dz * 2) - groundY(P.X, P.Z); P.upDeg = Math.atan2(ahead, 2) / D2R;
        let f = paceKmh(Math.max(0, P.upDeg)) / 2.7;                     // Apollo equal-effort slow-down on grades
        if (P.upDeg > S.theta + 2) { f = 0; P.blocked = true; } else if (P.upDeg < -(S.theta + 4)) f *= 0.55;
        if (S.res.h2o <= 0) f *= 0.5;
        vPhys = (P.run ? PHYS.vLope : PHYS.vWalk) * mag * f;
        vx = dx * vPhys * k; vz = dz * vPhys * k;
        P.yaw = S.view === 'fp' ? P.camYaw : angLerp(P.yaw, Math.atan2(-dx, -dz), 1 - Math.exp(-dt * 10));
      } else P.upDeg = 0;
      const nx = clamp(P.X + vx * dt, AOI.xmin - CX + 15, AOI.xmax - CX - 15), nz = clamp(P.Z + vz * dt, -(AOI.ymax - CY) + 15, -(AOI.ymin - CY) - 15);
      P.edge = nx !== P.X + vx * dt || nz !== P.Z + vz * dt;
      const moved = Math.hypot(nx - P.X, nz - P.Z); S.walked += moved; P.X = nx; P.Z = nz; P.speed = moved / Math.max(dt, 1e-6);
      const gy = groundY(P.X, P.Z);
      P.vy -= PHYS.g * dt; P.Y += P.vy * dt;                                   // Mars gravity (real time, not scaled)
      if (P.Y <= gy) {
        if (!P.onGround) { puff(P.X, gy, P.Z, 14, 1.4, 0.8); P.shake = Math.min(1, -P.vy / 4); if (P.vy < -3.4) { S.res.integ = Math.max(0, S.res.integ - 0.06); flash('Hard landing — suit seal damaged, small leak', 'bad'); } }
        P.Y = gy; P.vy = 0; P.onGround = true;
      }
      Wm = metabolic(vPhys, P.upDeg) + S.jumpW * 300; S.jumpW = Math.max(0, S.jumpW - dt * 2);
      P.phase += (vPhys * k) * dt * (P.run ? 2.2 : 3.2) / Math.max(1, k * 0.35);
      // footsteps: one print per half cycle
      if (P.onGround && vPhys > 0.05 && Math.floor(P.phase / Math.PI) !== P.lastStep) { P.lastStep = Math.floor(P.phase / Math.PI); footprint(P.X, P.Z, P.yaw, P.lastStep % 2 ? 1 : -1); if (Math.random() < 0.6) puff(P.X, gy, P.Z, 3, 0.5, 0.35); }
    } else {
      const R = P.rover; const thr = mz > 0 ? 1 : mz < 0 ? -0.6 : 0; const steerIn = -mx;
      R.v = lerp(R.v, thr * Math.max(mag, Math.abs(mz)) * PHYS.roverKmh / 3.6, 1 - Math.exp(-dt * 1.5));
      R.yaw += steerIn * dt * 0.9 * clamp(R.v / 2, -1, 1) * Math.sqrt(k) / 1.5;
      const dx = -Math.sin(R.yaw), dz = -Math.cos(R.yaw), sg = Math.sign(R.v || 1);
      const ahead = groundY(R.X + dx * 3 * sg, R.Z + dz * 3 * sg) - groundY(R.X, R.Z); P.upDeg = Math.atan2(ahead, 3) / D2R; P.blocked = P.upDeg > PHYS.roverSlope;
      if (!P.blocked) { const nx = clamp(R.X + dx * R.v * k * dt, AOI.xmin - CX + 15, AOI.xmax - CX - 15), nz = clamp(R.Z + dz * R.v * k * dt, -(AOI.ymax - CY) + 15, -(AOI.ymin - CY) - 15);
        S.walked += Math.hypot(nx - R.X, nz - R.Z); R.X = nx; R.Z = nz; } else R.v = 0;
      P.speed = Math.abs(R.v) * k; vPhys = Math.abs(R.v); P.X = R.X; P.Z = R.Z; P.Y = groundY(R.X, R.Z) + 0.85; P.yaw = R.yaw; Wm = 150;
      if (Math.abs(R.v) > 0.5 && Math.random() < 0.8) for (const s of [-1, 1]) puff(R.X - dx * 1.6 + Math.cos(R.yaw) * 1.1 * s, groundY(R.X, R.Z), R.Z - dz * 1.6 - Math.sin(R.yaw) * 1.1 * s, 2, 1.0, 0.7);
      // ASSUMPTION: rover carries spare consumables and recharges the suit while seated (≈ full in 40 min)
      const rf = dh / 0.67; S.res.o2 = Math.min(CAP.o2kg, S.res.o2 + CAP.o2kg * rf); S.res.co2 = Math.max(0, S.res.co2 - CAP.co2kg * rf); S.res.h2o = Math.min(CAP.h2okg, S.res.h2o + CAP.h2okg * rf); S.res.wh = Math.min(CAP.wh, S.res.wh + CAP.wh * rf);
    }
    // ---- life support (all per simulated hour)
    const T = airTemp(st), leak = (1 - S.res.integ) * 1.5, sunUp = st.elev > 0;
    S.wAvg = lerp(S.wAvg, Wm, 1 - Math.exp(-dts / 300)); S.hr = lerp(S.hr, 60 + Wm / 4.6, 1 - Math.exp(-dt * 0.8));
    const o2L = o2Lph(Wm) * dh;
    S.res.o2 -= (o2L * O2_G_PER_L / 1000) * (1 + leak);
    S.res.co2 += o2L * PHYS.RQ * CO2_G_PER_L / 1000;
    const heat = Math.max(30, Wm + (sunUp ? 60 * Math.sin(st.elev * D2R) : 0) - Math.max(0, 250 - T) * 0.8);   // W to reject
    S.res.h2o -= heat * 3600 * dh / PHYS.Lsub;
    S.res.wh -= (PHYS.powerW * 0.6 + 0.08 * Wm + heaterW(T, st)) * dh;
    S.res.dose += (PHYS.RAD / 24) * (cmeNear(S.sim).length ? 3 : 1) * dh;
    S.res.o2 = clamp(S.res.o2, 0, CAP.o2kg); S.res.co2 = clamp(S.res.co2, 0, CAP.co2kg); S.res.h2o = clamp(S.res.h2o, 0, CAP.h2okg); S.res.wh = clamp(S.res.wh, 0, CAP.wh);
    if (S.res.o2 <= 0) return endGame(false, 'Oxygen exhausted before reaching a safe haven.');
    if (S.res.co2 >= CAP.co2kg) return endGame(false, 'CO₂ scrubber saturated before reaching a safe haven.');
    if (S.res.wh <= 0) return endGame(false, 'Suit power depleted: no heating, fans or radio.');
    if (!S.trail.length || Math.hypot(S.trail.at(-1)[0] - P.X, S.trail.at(-1)[1] - P.Z) > 6) S.trail.push([P.X, P.Z]);
  }
  const angLerp = (a, b, t) => { let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
  // hours of life support left at a given work rate (min of O₂ and CO₂ capacity)
  function lifeHours(Wr) { const leak = (1 - S.res.integ) * 1.5, o2h = S.res.o2 / ((o2Lph(Wr) * O2_G_PER_L / 1000) * (1 + leak)), co2h = (CAP.co2kg - S.res.co2) / (o2Lph(Wr) * PHYS.RQ * CO2_G_PER_L / 1000); return { o2h, co2h, h: Math.min(o2h, co2h) }; }

  // ============================================================================================ predictions & verdict
  function predict() {
    const st = state(), h = haven(P.X, P.Z);
    const etaH = h ? h.phys / 1000 / 2.4 + 0.25 : null;                       // 2.4 km/h mean Apollo pace + 15 min airlock
    const life = lifeHours(PHYS.W_design);                                      // NASA design rate for the walk home
    const margin = etaH === null ? null : life.h - etaH - PHYS.reserveH;
    const sun = sunTimes(); let toSunset = sun.sunsetLtst !== null ? sun.sunsetLtst - st.ltst : null; if (toSunset !== null && toSunset < -6) toSunset += 24;
    const evaH = S.evaStart ? (S.sim - S.evaStart) / 3600e3 : 0;
    const issues = []; let level = 'go';
    const bump = (l, t) => { issues.push([l, t]); if (l === 'nogo') level = 'nogo'; else if (level === 'go') level = 'cond'; };
    if (margin !== null && margin < 0) bump('nogo', `Return margin ${hm(margin)}: life support may run out before you reach ${S.rover ? 'the lander or rover' : 'the lander'}.`);
    else if (margin !== null && margin < 0.75) bump('cond', `Return margin only ${hm(margin)}. Head home soon.`);
    if (toSunset !== null && etaH !== null && toSunset - etaH < 0) bump('nogo', `Arrival home would be after sunset (${M24.fmtH(sun.sunsetLtst)} LTST).`);
    else if (toSunset !== null && etaH !== null && toSunset - etaH < 1) bump('cond', 'Less than 1 h of daylight to spare on the way home.');
    if (evaH + (etaH || 0) > PHYS.evaH) bump('cond', `Total EVA would exceed the ${PHYS.evaH} h NASA suit requirement.`);
    if (cmeNear(S.sim).length) bump('cond', 'A CME is predicted to reach Mars within 24 h (NASA DONKI): limit time outside.');
    if (st.dustSeason) bump('cond', 'Dust-storm season (Ls 180–360°).');
    if (S.res.integ < 0.999) bump('cond', `Suit leak: pressure ${fmt(PHYS.psi * (0.5 + 0.5 * S.res.integ), 2)} psid, extra O₂ use.`);
    if (S.res.h2o < CAP.h2okg * 0.15) bump('cond', 'Cooling water low: slow down to avoid overheating.');
    if (S.res.wh < CAP.wh * 0.2) bump('cond', 'Suit power low.');
    if (!h) bump('cond', 'No mapped way home from this cell at your slope limit. Move to gentler terrain.');
    return { st, h, etaH, life, margin, sun, toSunset, evaH, issues, level };
  }

  // ============================================================================================ objectives & interaction
  const order = () => (routeOf(S.theta)?.station_order || ST.map((s) => s.id)).filter((id, i, a) => id !== lander.id || i === a.length - 1);
  const nextObj = () => order().find((id) => id !== lander.id && !S.done.has(id)) || lander.id;
  function nearest() {
    const p = Lc(P.X, P.Z); const out = [];
    for (const s of ST) { const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (s.kind === 'station' && d < 20 && !S.done.has(s.id)) out.push({ d, kind: 'station', s, text: `Document ${s.id} · ${s.name.split(' —')[0]}` });
      if (s.kind === 'depot' && d < 30 && !S.done.has(s.id)) out.push({ d, kind: 'depot', s, text: 'Inspect the sample tubes at the depot' });
      if (s.kind === 'lander' && d < 10) out.push({ d, kind: 'airlock', s, text: 'Enter the lander airlock (end EVA)' }); }
    if (roverObj.visible) { const d = Math.hypot(P.X - P.rover.X, P.Z - P.rover.Z);
      if (S.mode === 'drive') out.push({ d: 0, kind: 'exit', text: 'Get out of the rover' }); else if (d < 4.5) out.push({ d, kind: 'rover', text: 'Board the rover (recharge & drive)' }); }
    return out.sort((a, b) => a.d - b.d)[0] || null;
  }
  function interact() {
    if (!S.playing || S.paused) return;
    const n = nearest(); if (!n) { flash('Nothing to use here', 'info', 1.5); return; }
    if (n.kind === 'station' || n.kind === 'depot') return document_(n.s);
    if (n.kind === 'airlock') return confirmAirlock();
    if (n.kind === 'rover') { S.mode = 'drive'; P.rover.v = 0; flash(`Driving (max ${PHYS.roverKmh} km/h ×${S.speed}): W/S throttle · A/D steer · E to get out`, 'info', 5); return; }
    if (n.kind === 'exit') { S.mode = 'walk'; const R = P.rover; P.X = R.X + Math.cos(R.yaw) * 2.2; P.Z = R.Z - Math.sin(R.yaw) * 2.2; P.Y = groundY(P.X, P.Z); flash('On foot', 'info'); }
  }
  function consume(hours, Wr) {
    const dh = hours, o2L = o2Lph(Wr) * dh; S.sim += hours * 3600e3;
    S.res.o2 -= o2L * O2_G_PER_L / 1000 * (1 + (1 - S.res.integ) * 1.5); S.res.co2 += o2L * PHYS.RQ * CO2_G_PER_L / 1000; S.res.h2o -= Wr * 3600 * dh / PHYS.Lsub; S.res.wh -= (PHYS.powerW * 0.6 + 0.08 * Wr) * dh;
  }
  function document_(s) {
    const mins = s.kind === 'depot' ? 30 : 25; consume(mins / 60, 0.75 * PHYS.W_design);
    S.done.add(s.id); S.score += s.kind === 'depot' ? 150 : 100;
    beacons[s.id].userData.beam.material.color.set(0x4fe3a4); beacons[s.id].userData.ring.material.color.set(0x4fe3a4);
    const pov = D.pov?.[s.id]; let body;
    if (s.kind === 'depot') body = `<div class="kicker">Task complete · ${mins} min</div><h2>Three Forks sample depot</h2><p>${esc(s.note)}</p>
        <div class="grid2">${(D.depot_tubes?.tubes || []).map((t) => `<div class="sci-card done"><b>${esc(t.name)}</b><br><span class="note">${esc(t.designation)} · dropped sol ${t.drop_sol} · azimuth ${t.tube_azimuth_deg}°</span></div>`).join('')}</div>
        ${pov ? `<img src="../data/${esc(pov.file)}" alt="Perseverance view at the depot"><div class="note">Perseverance ${esc(pov.camera.replace('_LEFT', ''))}, sol ${pov.sol} · ${esc(pov.credit)}</div>` : ''}<p class="note">Tube positions: NASA PDS Three Forks depot bundle (rover position at each drop).</p>`;
    else { const nasem = (s.nasem || []).map((k) => `${k}. ${esc((D.manifest.nasem_objectives || {})[k] || '')}`).join('<br>');
      body = `<div class="kicker">Outcrop documented · ${mins} min</div><h2>${esc(s.name)}</h2><p><b>Rock:</b> ${esc(s.rock)}<br><b>Unit:</b> ${esc(s.formation)}<br><b>Perseverance sample:</b> ${esc(s.sample)}</p>
        <p>${esc(s.rationale)}</p><p><b>Your task:</b> ${esc(s.task)}</p>${pov ? `<img src="../data/${esc(pov.file)}" alt="Perseverance view of this outcrop"><div class="note">What Perseverance saw here: ${esc(pov.camera.replace('_LEFT', ''))}, sol ${pov.sol} · ${esc(pov.credit)}</div>` : ''}
        <p class="note"><b>NASEM objectives:</b><br>${nasem}</p>`; }
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
    const pr = predict(), bonus = success ? Math.round(clamp(pr.life.h, 0, 4) * 50) : 0;
    openModal(`<div class="kicker">${success ? 'EVA complete' : 'EVA failed'}</div><h2>${success ? 'Welcome back' : 'Mission lost'}</h2><p>${esc(why)}</p>
      <dl class="kv"><dt>Science documented</dt><dd>${S.done.size} of ${order().length - 1}</dd><dt>Time outside</dt><dd>${hm(pr.evaH)}</dd>
      <dt>Distance travelled</dt><dd>${fmt(S.walked / 1000, 2)} km</dd><dt>O₂ left</dt><dd>${fmt(S.res.o2 * 1000)} g</dd>
      <dt>Radiation dose (model)</dt><dd>${fmt(S.res.dose, 3)} mSv</dd><dt>Science points</dt><dd>${S.score}</dd><dt>Safety bonus</dt><dd>${bonus}</dd><dt><b>Total</b></dt><dd><b>${S.score + bonus}</b></dd></dl>
      <p class="note">Real crews plan with large reserves: the best score comes from documenting every stop <i>and</i> coming home with life support to spare.</p>`,
      [['Play again', () => location.reload(), true], ['Open planner', () => { location.href = '../'; }]]);
  }

  // ============================================================================================ per-frame visuals & camera
  const tmpV = new THREE.Vector3(), sunWorld = new THREE.Vector3();
  function updateVisuals(dt) {
    const st = state(), el = st.elev * D2R, az = st.az * D2R;
    const sd = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const day = clamp((st.elev + 6) / 16, 0, 1), night = 1 - day;
    skyU.sunDir.value.copy(sd); skyU.day.value = 0.05 + 0.95 * day; skyU.dust.value = st.dustSeason ? 0.6 : 0.15;
    stars.material.opacity = clamp(1 - day * 1.6, 0, 0.95);
    const warm = clamp(st.elev / 25, 0, 1);
    post.expo = lerp(1.12, 0.74, clamp(st.elev / 40, 0, 1));   // auto-exposure: open up at low sun, stop down at midday
    sun.color.setRGB(1, 0.78 + 0.18 * warm, 0.6 + 0.3 * warm); sun.intensity = clamp(Math.sin(el) * 3.5, 0, 1) * (Q.post ? 2.7 : 2.2);
    hemi.intensity = (0.05 + 0.3 * day) * (Q.post ? 1.0 : 1.4);
    scene.fog.color.setRGB(0.86, 0.66, 0.48).multiplyScalar(0.05 + 0.95 * day); scene.fog.density = st.dustSeason ? 0.0005 : 0.00022;
    updateEnv(st.elev);
    sun.position.set(P.X + sd.x * 250, P.Y + Math.max(sd.y, 0.04) * 250, P.Z + sd.z * 250); sun.target.position.set(P.X, P.Y, P.Z);
    sunWorld.copy(camera.position).add(sd.clone().multiplyScalar(5000));
    // astronaut pose
    astro.visible = !(S.view === 'fp' && S.mode === 'walk');
    if (S.mode === 'walk') { astro.position.set(P.X, P.Y, P.Z); astro.rotation.set(0, P.yaw + Math.PI, 0); }
    else { const R = P.rover; tmpV.set(0.45, 0.95, 0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), R.yaw); astro.position.set(R.X + tmpV.x, groundY(R.X, R.Z) + 0.55, R.Z + tmpV.z); astro.rotation.set(0, R.yaw + Math.PI, 0); }
    const pa = astro.userData.parts, amp = S.mode === 'walk' ? clamp(P.speed / (S.speed * 1.0), 0, 1.3) : 0, sw = Math.sin(P.phase) * amp;
    const lope = P.run && amp > 0.2;
    pa.hpL.rotation.x = sw * (lope ? 0.75 : 0.5); pa.hpR.rotation.x = -sw * (lope ? 0.75 : 0.5);
    pa.knL.rotation.x = Math.max(0, -Math.sin(P.phase + 0.6)) * amp * 0.9; pa.knR.rotation.x = Math.max(0, Math.sin(P.phase + 0.6)) * amp * 0.9;
    pa.shL.rotation.x = -sw * 0.45; pa.shR.rotation.x = sw * 0.45; pa.elL.rotation.x = -0.35 - Math.max(0, sw) * 0.4; pa.elR.rotation.x = -0.35 - Math.max(0, -sw) * 0.4;
    if (S.mode === 'drive') { pa.hpL.rotation.x = pa.hpR.rotation.x = -1.45; pa.knL.rotation.x = pa.knR.rotation.x = 1.5; pa.shL.rotation.x = pa.shR.rotation.x = -0.9; pa.elL.rotation.x = pa.elR.rotation.x = -0.6; }
    if (!P.onGround) { pa.hpL.rotation.x = -0.6; pa.knL.rotation.x = 0.9; pa.hpR.rotation.x = -0.2; pa.knR.rotation.x = 0.5; }
    if (S.mode === 'walk' && P.onGround && amp > 0.1) astro.position.y += Math.abs(Math.sin(P.phase)) * (lope ? 0.12 : 0.04);
    // helmet + rover lights at night
    const lights = S.headlamp || st.elev < 2; M.glowW.emissiveIntensity = lights ? 3 : 0.2;
    // rover pose
    if (roverObj.visible) {
      const R = P.rover, f = new THREE.Vector3(-Math.sin(R.yaw), 0, -Math.cos(R.yaw)), r = new THREE.Vector3(Math.cos(R.yaw), 0, -Math.sin(R.yaw));
      const hF = groundY(R.X + f.x * 1.4, R.Z + f.z * 1.4), hB = groundY(R.X - f.x * 1.4, R.Z - f.z * 1.4), hR = groundY(R.X + r.x, R.Z + r.z), hL = groundY(R.X - r.x, R.Z - r.z);
      f.y = (hF - hB) / 2.8; f.normalize(); r.y = (hR - hL) / 2; r.normalize(); const up = new THREE.Vector3().crossVectors(r, f).normalize();
      roverObj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, up, f.clone().negate())); roverObj.position.set(R.X, (hF + hB + hR + hL) / 4, R.Z); roverObj.rotateY(Math.PI);
      for (const w of roverObj.userData.wheels) w.rotation.x += R.v * S.speed * dt / 0.45;
    }
    const t = performance.now() / 1000;
    for (const [id, b] of Object.entries(beacons)) { const dd = Math.hypot(b.position.x - P.X, b.position.z - P.Z), near = clamp((dd - 8) / 40, 0, 1); b.userData.beam.material.opacity = ((S.done.has(id) ? 0.08 : 0.15) + 0.07 * Math.sin(t * 2 + id.length)) * near; b.userData.beam.visible = near > 0.01; b.userData.ring.rotation.z = t * 0.3; }
    // camera
    P.shake = Math.max(0, P.shake - dt * 3);
    const head = new THREE.Vector3(P.X, P.Y + (S.mode === 'drive' ? 1.1 : 1.68), P.Z);
    const fovT = S.mode === 'drive' ? 66 : P.run && amp > 0.3 ? 67 : 60; camera.fov = lerp(camera.fov, fovT, 1 - Math.exp(-dt * 4)); camera.updateProjectionMatrix();
    if (S.view === 'fp') {
      const yaw = S.mode === 'drive' ? P.rover.yaw + P.camYaw - P.yaw : P.camYaw;
      camera.position.copy(head).add(new THREE.Vector3(-Math.sin(yaw) * 0.18, 0, -Math.cos(yaw) * 0.18));
      camera.position.y += S.mode === 'walk' ? Math.abs(Math.sin(P.phase)) * amp * (lope ? 0.09 : 0.035) : 0;
      const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(P.camPitch), Math.sin(P.camPitch), -Math.cos(yaw) * Math.cos(P.camPitch));
      camera.lookAt(camera.position.clone().add(dir));
    } else {
      const yaw = P.camYaw, pitch = P.camPitch, d = (S.mode === 'drive' ? Math.max(P.camDist, 9) : P.camDist) * (camera.aspect < 0.8 ? 1.4 : 1);   // pull back on portrait phones
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(S.mode === 'drive' ? 0 : 0.55);    // over-the-shoulder offset
      const off = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch) * d, -Math.sin(pitch) * d + 0.5, Math.cos(yaw) * Math.cos(pitch) * d).add(right);
      const want = head.clone().add(off); let gmin = groundY(want.x, want.z) + 0.5;
      for (let f = 0.25; f < 1.01; f += 0.25) {   // keep line of sight to the astronaut above the terrain between us
        const gx = head.x + (want.x - head.x) * f, gz = head.z + (want.z - head.z) * f; gmin = Math.max(gmin, head.y + (groundY(gx, gz) + 0.45 - head.y) / f);
      }
      if (want.y < gmin) want.y = gmin;
      if (camera.position.distanceTo(want) > 25) camera.position.copy(want); else camera.position.lerp(want, 1 - Math.exp(-dt * 10)); camera.lookAt(head.clone().add(right));
    }
    if (P.shake > 0) { camera.position.x += (Math.random() - 0.5) * P.shake * 0.06; camera.position.y += (Math.random() - 0.5) * P.shake * 0.06; }
    lampL.intensity = lampR.intensity = lights ? 2.0 : 0;
    const ld = new THREE.Vector3(); camera.getWorldDirection(ld);
    for (const [lp, s] of [[lampL, -1], [lampR, 1]]) { lp.position.copy(head).add(new THREE.Vector3(Math.cos(P.camYaw) * 0.18 * s, 0.15, -Math.sin(P.camYaw) * 0.18 * s)); lp.target.position.copy(head).add(ld.clone().multiplyScalar(12)); }
    updateFX(dt, st);
    return night;
  }

  // ============================================================================================ HUD
  function updateHUD() {
    const pr = predict(), st = pr.st;
    $('#h-ltst').textContent = M24.fmtH(st.ltst); $('#h-sol').textContent = `Sol ${st.sol}`;
    $('#h-eva').textContent = `EVA ${hm(pr.evaH).replace(' h ', ':').replace(' min', '')}`;
    $('#h-sun').textContent = st.elev > 0 ? `☀ ${fmt(st.elev)}° · sunset ${M24.fmtH(pr.sun.sunsetLtst)}` : `☾ night · sunrise ${M24.fmtH(pr.sun.sunriseLtst)}`;
    const T = airTemp(st), now = lifeHours(S.wAvg);
    const pwrH = S.res.wh / (PHYS.powerW * 0.6 + 0.08 * S.wAvg + heaterW(T, st));
    const h2oH = S.res.h2o / (Math.max(30, S.wAvg + (st.elev > 0 ? 60 * Math.sin(st.elev * D2R) : 0) - Math.max(0, 250 - T) * 0.8) * 3600 / PHYS.Lsub);
    const lvl = (f, w = 0.35, b = 0.15) => f <= b ? 'bad' : f <= w ? 'warn' : '';
    const row = (name, frac, sub, cls, tip) => `<div class="res ${cls}" title="${esc(tip)}"><div class="res-h"><b>${name}</b><small>${sub}</small></div><div class="bar"><i style="width:${clamp(frac * 100, 0, 100)}%"></i></div></div>`;
    const fO2 = S.res.o2 / CAP.o2kg, fCO2 = 1 - S.res.co2 / CAP.co2kg, fW = S.res.wh / CAP.wh, fH = S.res.h2o / CAP.h2okg;
    $('#res').innerHTML = `<h4>Life support</h4>`
      + row('Oxygen', fO2, `${fmt(S.res.o2 * 1000)} g · ${hm(now.o2h)}`, lvl(fO2), `O₂ from Weir calorimetry at RQ ${PHYS.RQ}; capacity ${fmt(CAP.o2kg * 1000)} g = ${SIZE_H} h at 1,000 Btu/h`)
      + row('CO₂ scrubber', fCO2, `${fmt(S.res.co2 * 1000)} g · ${hm(now.co2h)}`, lvl(fCO2), `CO₂ produced = RQ × O₂; capacity ${fmt(CAP.co2kg * 1000)} g`)
      + row('Suit power', fW, `${fmt(S.res.wh)} Wh · ${hm(pwrH)}`, lvl(fW), 'Avionics, radio, fans; heaters below 245 K (assumption)')
      + row('Cooling water', fH, `${fmt(S.res.h2o, 2)} kg · ${hm(h2oH)}`, lvl(fH, 0.25, 0.1), 'Sublimator: water use = heat ÷ 2.83 MJ/kg')
      + row('Suit pressure', S.res.integ, `${fmt(PHYS.psi * (0.5 + 0.5 * S.res.integ), 2)} psid`, S.res.integ < 0.999 ? 'bad' : '', 'Nominal 4.3 psid (NASA xEVA ConOps)')
      + row('Radiation dose', clamp(S.res.dose / PHYS.RAD, 0, 1), `${fmt(S.res.dose, 3)} mSv`, cmeNear(S.sim).length ? 'warn' : 'info', 'Curiosity RAD reference rate (Gale); ×3 near a CME (assumption)')
      + `<div class="res-h extra" style="margin-top:6px"><b>Work rate</b><small>${fmt(S.wAvg)} W · ${fmt(S.wAvg / BTU)} Btu/h · ${fmt(S.hr)} bpm</small></div>
         <div class="res-h extra"><b>Outside</b><small>${fmt(T - 273.15)} °C · ${fmt(medaAt('P', st.lmst) ?? NaN)} Pa (MEDA)</small></div>`;
    const nx = nextObj();
    $('#objectives').innerHTML = order().map((id) => { const s = ST.find((x) => x.id === id); const done = S.done.has(id); const short = id === lander.id ? 'Return to the lander airlock' : `${id} · ${s.name.split(' —')[0].replace(' (inspection only)', '')}`;
      return `<li class="${done ? 'done' : id === nx ? 'next' : ''}">${esc(short)}</li>`; }).join('');
    $('#h-score').textContent = S.score;
    const m = pr.margin, mEl = $('#h-margin'); mEl.textContent = m === null ? '—' : (m >= 0 ? '+' : '') + hm(m); mEl.style.color = m === null ? '' : m < 0 ? 'var(--bad)' : m < 0.75 ? 'var(--warn)' : 'var(--ok)';
    $('#h-home').textContent = pr.h ? `${fmt(pr.h.phys / 1000, 2)} km · ${hmShort(pr.etaH)}` : 'no path';
    const p = Lc(P.X, P.Z), [r, c] = rcOf(p.x, p.y), sl = gv('slope', r, c), pv = gv('provenance', r, c);
    const sEl = $('#h-slope'); sEl.textContent = sl === null ? '—' : `${fmt(sl, 1)}°`; sEl.style.color = sl !== null && sl > S.theta ? 'var(--bad)' : sl !== null && sl > S.theta - 5 ? 'var(--warn)' : '';
    $('#h-speedv').textContent = `${fmt(P.speed / S.speed * 3.6, 1)} km/h ×${S.speed}`; $('#h-speedv').title = 'Suit pace (what NASA metabolic rates use) × travel & time speed';
    $('#h-src').textContent = pv === 1 ? 'HiRISE 1 m' : pv === 2 ? 'CTX 20 m' : 'none';
    let tx, ty, tname;
    if (S.waypoint) { tx = S.waypoint.x; ty = S.waypoint.y; tname = 'Waypoint'; }
    else if (m !== null && m < 0.5) {   // point at the nearer safe haven (rover if parked and closer)
      tx = lander.x; ty = lander.y; tname = 'Head home: lander';
      if (S.rover && roverObj.visible) { const rp = Lc(P.rover.X, P.rover.Z); if (Math.hypot(rp.x - p.x, rp.y - p.y) < Math.hypot(lander.x - p.x, lander.y - p.y)) { tx = rp.x; ty = rp.y; tname = 'Head to the rover'; } }
    } else { const s = ST.find((x) => x.id === nx); tx = s.x; ty = s.y; tname = s.id; }
    const brg = ((Math.atan2(tx - p.x, ty - p.y) / D2R) + 360) % 360, dist = Math.hypot(tx - p.x, ty - p.y);
    const heading = (((-(S.view === 'fp' ? P.camYaw : (S.mode === 'drive' ? P.rover.yaw : P.camYaw))) / D2R) % 360 + 360) % 360;
    drawTape(heading, brg); $('#h-target').textContent = `${tname} · ${fmt(dist)} m · ${fmt(brg)}°`;
    const n = nearest(); $('#prompt').classList.toggle('hidden', !n); if (n) $('#prompt').innerHTML = `<kbd>${TOUCH ? 'Use' : 'E'}</kbd>${esc(n.text)}`;
    const al = [];
    if (P.blocked) al.push(['bad', S.mode === 'drive' ? `Too steep for the rover (>${PHYS.roverSlope}°)` : `Too steep for the suit (>${S.theta}° limit)`]);
    if (P.edge) al.push(['warn', 'Edge of the mapped area']);
    if (m !== null && m < 0) al.push(['bad', 'PAST POINT OF NO RETURN — head for the nearest safe haven now']); else if (m !== null && m < 0.75) al.push(['warn', `Return margin ${hm(m)} — consider heading home`]);
    if (fO2 < 0.15) al.push(['bad', 'Oxygen critical']); if (S.res.integ < 0.999) al.push(['bad', 'Suit leak detected']);
    if (st.elev < 0) al.push(['warn', `Night: ${fmt(T - 273.15)} °C, heaters drawing extra power`]);
    if (cmeNear(S.sim).length) al.push(['warn', 'Space weather: CME arriving at Mars within 24 h']);
    if (S.updateReady) al.push(['info', 'A newer version is ready — reload the page when convenient']);
    const tn = performance.now(); for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].until < tn) flashes.splice(i, 1);
    for (const f of flashes.slice(-2)) al.push([f.kind, f.text]);
    $('#alerts').innerHTML = al.slice(0, 4).map(([k, t]) => `<div class="alert ${k === 'bad' ? '' : k}">${esc(t)}</div>`).join('');
    drawMinimap(heading);
  }
  function drawTape(heading, brg) {
    const tape = $('#tape'), w = $('.hud-compass').clientWidth, pxPerDeg = w / 120;
    if (!tape.dataset.built || +tape.dataset.w !== w) { let h = '';
      for (let d = -360; d <= 720; d += 15) { const v = ((d % 360) + 360) % 360; const lbl = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[v];
        h += lbl ? `<span class="card" style="left:${d * pxPerDeg}px">${lbl}</span>` : d % 45 === 0 ? `<span style="left:${d * pxPerDeg}px">${v}</span>` : `<i style="left:${d * pxPerDeg}px"></i>`; }
      h += '<b class="obj" id="tape-obj">▼</b>'; tape.innerHTML = h; tape.dataset.built = '1'; tape.dataset.w = w; }
    tape.style.transform = `translateX(${w / 2 - heading * pxPerDeg}px)`;
    let rel = brg; if (rel - heading > 180) rel -= 360; if (heading - rel > 180) rel += 360; $('#tape-obj').style.left = `${rel * pxPerDeg}px`;
  }
  // heading-up radar minimap (300 m radius)
  const mm = $('#minimap'), mmc = mm.getContext('2d');
  function drawMinimap(heading) {
    if (mm.offsetParent === null) return;
    const w = mm.width, c = w / 2, R = 300, s = (w / 2 - 8) / R, p = Lc(P.X, P.Z), hr = heading * D2R;
    mmc.clearRect(0, 0, w, w); mmc.save(); mmc.beginPath(); mmc.arc(c, c, c - 2, 0, 7); mmc.clip();
    mmc.fillStyle = 'rgba(30,18,10,.55)'; mmc.fillRect(0, 0, w, w);
    const toM = (x, y) => { const dx = x - p.x, dy = y - p.y; const rx = dx * Math.cos(hr) - dy * Math.sin(hr), ry = dx * Math.sin(hr) + dy * Math.cos(hr); return [c + rx * s, c - ry * s]; };
    mmc.strokeStyle = 'rgba(255,255,255,.12)'; for (const rr of [100, 200, 300]) { mmc.beginPath(); mmc.arc(c, c, rr * s, 0, 7); mmc.stroke(); }
    const rt = routeOf(S.theta); if (rt?.feasible && S.routeLine) { mmc.strokeStyle = '#ff9f43'; mmc.lineWidth = 2; mmc.beginPath(); let started = false;
      for (const [x, y] of rt.geometry_xy) { if (Math.abs(x - p.x) > 450 || Math.abs(y - p.y) > 450) { started = false; continue; } const [u, v] = toM(x, y); started ? mmc.lineTo(u, v) : mmc.moveTo(u, v); started = true; } mmc.stroke(); }
    if (S.trail.length > 1) { mmc.strokeStyle = '#6fd3ff'; mmc.lineWidth = 1.5; mmc.beginPath(); S.trail.slice(-200).forEach(([X, Z], i) => { const q = Lc(X, Z); const [u, v] = toM(q.x, q.y); i ? mmc.lineTo(u, v) : mmc.moveTo(u, v); }); mmc.stroke(); }
    for (const st of ST) { let [u, v] = toM(st.x, st.y); const dd = Math.hypot(u - c, v - c); if (dd > c - 10) { u = c + (u - c) / dd * (c - 10); v = c + (v - c) / dd * (c - 10); }
      mmc.fillStyle = st.kind === 'lander' ? '#fff' : S.done.has(st.id) ? '#4fe3a4' : st.kind === 'depot' ? '#c77dff' : '#ff8c42'; mmc.beginPath(); mmc.arc(u, v, 5, 0, 7); mmc.fill();
      mmc.fillStyle = '#fff'; mmc.font = '700 10px system-ui'; mmc.fillText(st.id, u + 6, v - 5); }
    if (roverObj.visible && S.mode === 'walk') { const q = Lc(P.rover.X, P.rover.Z); const [u, v] = toM(q.x, q.y); mmc.fillStyle = '#6fd3ff'; mmc.fillRect(u - 4, v - 3, 8, 6); }
    mmc.restore(); mmc.fillStyle = '#ffd27a'; mmc.beginPath(); mmc.moveTo(c, c - 9); mmc.lineTo(c + 6, c + 6); mmc.lineTo(c, c + 2); mmc.lineTo(c - 6, c + 6); mmc.closePath(); mmc.fill();
    mmc.fillStyle = 'rgba(255,255,255,.7)'; mmc.font = '700 10px system-ui'; const nx = c - Math.sin(-hr) * (c - 12), ny = c - Math.cos(-hr) * (c - 12); mmc.fillText('N', nx - 3, ny + 4);
  }

  // ============================================================================================ map & data overlay
  const mapCv = $('#map'), mctx = mapCv.getContext('2d');
  const ortho = new Image(); ortho.src = '../data/hirise_ortho_1m.jpg';
  const MV = { s: 1, ox: 0, oy: 0, tab: 'pred', layers: { safe: true, route: true, steep: false, track: true } };
  let safeCanvas = null, safeKey = '';
  function toggleMap(open) {
    $('#mapview').classList.toggle('hidden', !open);
    if (open) { if (document.pointerLockElement) document.exitPointerLock(); S.mapPaused = true; sizeMap(); centerMap(); renderTab(); drawMap(); } else { S.mapPaused = false; clock.getDelta(); }
  }
  $('#m-close').onclick = () => toggleMap(false); $('#m-center').onclick = () => { centerMap(); drawMap(); }; $('#m-clear').onclick = () => { S.waypoint = null; drawMap(); };
  document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => { MV.tab = b.dataset.tab; document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b))); renderTab(); });
  function sizeMap() { const r = mapCv.parentElement.getBoundingClientRect(); mapCv.width = r.width * devicePixelRatio; mapCv.height = r.height * devicePixelRatio; }
  addEventListener('resize', () => { if (!$('#mapview').classList.contains('hidden')) { sizeMap(); drawMap(); } });
  const W_AOI = AOI.xmax - AOI.xmin, H_AOI = AOI.ymax - AOI.ymin;
  function centerMap() { MV.s = Math.max(mapCv.width / W_AOI, mapCv.height / H_AOI) * 1.6; const p = Lc(P.X, P.Z); MV.ox = mapCv.width / 2 - (p.x - AOI.xmin) * MV.s; MV.oy = mapCv.height / 2 - (AOI.ymax - p.y) * MV.s; }
  const toScr = (x, y) => [MV.ox + (x - AOI.xmin) * MV.s, MV.oy + (AOI.ymax - y) * MV.s];
  const fromScr = (sx, sy) => [AOI.xmin + (sx - MV.ox) / MV.s, AOI.ymax - (sy - MV.oy) / MV.s];
  function safeZone() {
    const pr = predict(); const reachKm = Math.max(0, (pr.life.h - PHYS.reserveH - 0.25) * 2.4);
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
    if (ortho.complete) c.drawImage(ortho, x0, y0, W_AOI * MV.s, H_AOI * MV.s);
    c.imageSmoothingEnabled = false;
    if (MV.layers.steep) c.drawImage(steepZone(), x0, y0, W_AOI * MV.s, H_AOI * MV.s);
    if (MV.layers.safe) c.drawImage(safeZone(), x0, y0, W_AOI * MV.s, H_AOI * MV.s);
    c.imageSmoothingEnabled = true;
    if (MV.layers.track) { c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 1.2 * k; c.setLineDash([2 * k, 4 * k]); for (const sgm of D.rover_track.traverse) { c.beginPath(); sgm.xy.forEach(([x, y], i) => { const [sx, sy] = toScr(x, y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.stroke(); } c.setLineDash([]); }
    if (MV.layers.route) { const r = routeOf(S.theta); if (r?.feasible) { c.strokeStyle = '#ff9f43'; c.lineWidth = 3 * k; c.beginPath(); r.geometry_xy.forEach(([x, y], i) => { const [sx, sy] = toScr(x, y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.stroke(); } }
    if (S.trail.length > 1) { c.strokeStyle = '#6fd3ff'; c.lineWidth = 2.5 * k; c.beginPath(); S.trail.forEach(([X, Z], i) => { const p = Lc(X, Z); const [sx, sy] = toScr(p.x, p.y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.stroke(); }
    for (const t of D.depot_tubes?.tubes || []) { const [sx, sy] = toScr(t.x, t.y); c.fillStyle = '#fff'; c.beginPath(); c.arc(sx, sy, 2 * k, 0, 7); c.fill(); }
    c.font = `700 ${12 * k}px system-ui`;
    for (const s of ST) { const [sx, sy] = toScr(s.x, s.y); const done = S.done.has(s.id);
      c.fillStyle = s.kind === 'lander' ? '#ffffff' : done ? '#4fe3a4' : s.kind === 'depot' ? '#c77dff' : '#ff8c42'; c.beginPath(); c.arc(sx, sy, 7 * k, 0, 7); c.fill(); c.strokeStyle = '#000'; c.lineWidth = 1.5 * k; c.stroke();
      c.fillStyle = '#000'; c.fillText(s.id, sx + 9 * k + 1, sy - 6 * k + 1); c.fillStyle = '#fff'; c.fillText(s.id, sx + 9 * k, sy - 6 * k); }
    if (roverObj.visible) { const p = Lc(P.rover.X, P.rover.Z); const [sx, sy] = toScr(p.x, p.y); c.fillStyle = '#6fd3ff'; c.fillRect(sx - 6 * k, sy - 4 * k, 12 * k, 8 * k); c.fillStyle = '#fff'; c.fillText('Rover', sx + 9 * k, sy + 4 * k); }
    if (S.waypoint) { const [sx, sy] = toScr(S.waypoint.x, S.waypoint.y); c.strokeStyle = '#ffd27a'; c.lineWidth = 2.5 * k; c.beginPath(); c.arc(sx, sy, 9 * k, 0, 7); c.moveTo(sx - 13 * k, sy); c.lineTo(sx + 13 * k, sy); c.moveTo(sx, sy - 13 * k); c.lineTo(sx, sy + 13 * k); c.stroke(); }
    { const p = Lc(P.X, P.Z); const [sx, sy] = toScr(p.x, p.y); const yaw = S.mode === 'drive' ? P.rover.yaw : (S.view === 'fp' ? P.camYaw : P.yaw);
      c.save(); c.translate(sx, sy); c.rotate(-yaw); c.fillStyle = '#ffd27a'; c.strokeStyle = '#000'; c.lineWidth = 1.5 * k; c.beginPath(); c.moveTo(0, -12 * k); c.lineTo(8 * k, 9 * k); c.lineTo(0, 4 * k); c.lineTo(-8 * k, 9 * k); c.closePath(); c.fill(); c.stroke(); c.restore(); }
    const m100 = 100 * MV.s, len = m100 > 160 * k ? 100 : m100 > 40 * k ? 500 : 1000; const Lb = len * MV.s;
    c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(w - Lb - 30 * k, h - 50 * k, Lb + 20 * k, 30 * k); c.fillStyle = '#fff'; c.fillRect(w - Lb - 20 * k, h - 30 * k, Lb, 4 * k); c.fillText(`${len} m`, w - Lb - 20 * k, h - 36 * k);
    $('#map-legend').innerHTML = [['safe', 'Safe-return zone (remaining O₂/CO₂)', 'rgba(79,227,164,.6)'], ['route', `Planned route (${S.theta}°)`, '#ff9f43'], ['steep', `Too steep (> ${S.theta}°) / no data`, 'rgba(255,77,94,.7)'], ['track', 'Perseverance\'s real track', '#ccc']]
      .map(([k2, t, col]) => `<div><input type="checkbox" data-l="${k2}" ${MV.layers[k2] ? 'checked' : ''}><span class="sw" style="background:${col}"></span>${esc(t)}</div>`).join('') + `<div><span class="sw" style="background:#6fd3ff"></span>Your trail · <span style="color:#ffd27a">▲</span> you</div>`;
    $('#map-legend').querySelectorAll('input').forEach((i) => i.onchange = () => { MV.layers[i.dataset.l] = i.checked; drawMap(); });
  }
  const ptrs = new Map(); let moved = 0, pinch0 = null;
  mapCv.addEventListener('pointerdown', (e) => { try { mapCv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } ptrs.set(e.pointerId, [e.clientX, e.clientY]); moved = 0; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: MV.s }; } });
  mapCv.addEventListener('pointermove', (e) => { if (!ptrs.has(e.pointerId)) return; const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2 && pinch0) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (pinch0.s * d / pinch0.d) / MV.s); moved += 10; return; }
    const dx = (e.clientX - prev[0]) * devicePixelRatio, dy = (e.clientY - prev[1]) * devicePixelRatio; moved += Math.abs(dx) + Math.abs(dy); MV.ox += dx; MV.oy += dy; drawMap(); });
  mapCv.addEventListener('pointerup', (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null;
    if (moved < 6) { const r = mapCv.getBoundingClientRect(); const [x, y] = fromScr((e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio); if (x > AOI.xmin && x < AOI.xmax && y > AOI.ymin && y < AOI.ymax) { S.waypoint = { x, y }; drawMap(); renderTab(); } } });
  mapCv.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 0.85 : 1.18); }, { passive: false });
  function zoomAt(cx, cy, f) { const r = mapCv.getBoundingClientRect(); const sx = (cx - r.left) * devicePixelRatio, sy = (cy - r.top) * devicePixelRatio;
    const ns = clamp(MV.s * f, Math.min(mapCv.width / W_AOI, mapCv.height / H_AOI) * 0.8, 6 * devicePixelRatio); MV.ox = sx - (sx - MV.ox) * ns / MV.s; MV.oy = sy - (sy - MV.oy) * ns / MV.s; MV.s = ns; drawMap(); }

  function renderTab() {
    const pr = predict(), st = pr.st, b = $('#tab-body');
    const vText = { go: 'GO — continue', cond: 'CONDITIONAL — continue with care', nogo: 'NO-GO — return now' }[pr.level];
    if (MV.tab === 'pred') {
      const arrive = pr.etaH !== null ? st.ltst + pr.etaH : null; let wp = '';
      if (S.waypoint) { const p = Lc(P.X, P.Z); const d = Math.hypot(S.waypoint.x - p.x, S.waypoint.y - p.y); const [r, c] = rcOf(S.waypoint.x, S.waypoint.y);
        const hw = gv(S.rover && D.rover ? `haven_phys_${S.theta}` : `walkback_phys_${S.theta}`, r, c); const tGo = d * 1.25 / 1000 / 2.4; const after = pr.life.h - tGo - (hw !== null ? hw / 1000 / 2.4 + 0.25 : 0);
        wp = `<div class="sec">If you go to the waypoint, then home</div><dl class="kv"><dt>Distance (straight ×1.25)</dt><dd>${fmt(d * 1.25)} m</dd><dt>Walk home from there</dt><dd>${hw === null ? 'no path' : fmt(hw) + ' m'}</dd><dt>Life support left at home</dt><dd style="color:${after < PHYS.reserveH ? 'var(--bad)' : 'var(--ok)'}">${hm(after)}</dd></dl>`; }
      b.innerHTML = `<div class="verdict ${pr.level}">${vText}</div>
        ${pr.issues.length ? `<ul class="issues">${pr.issues.map(([l, t]) => `<li style="color:${l === 'nogo' ? 'var(--bad)' : 'var(--warn)'}">${esc(t)}</li>`).join('')}</ul>` : '<p class="note">No warnings (Go / No-go rules merged from Marswalk Planner v4.1).</p>'}
        <div class="sec">If you turn back now</div>
        <dl class="kv"><dt>Nearest safe haven</dt><dd>${S.rover && D.rover ? 'lander or rover' : 'lander'}</dd><dt>Walk home</dt><dd>${pr.h ? fmt(pr.h.phys) + ' m' : 'no path'}</dd>
        <dt>Time to get there</dt><dd>${hm(pr.etaH)}</dd><dt>Arrive (LTST)</dt><dd>${arrive === null ? '—' : M24.fmtH(arrive)}</dd>
        <dt>Life support left (at 1,000 Btu/h)</dt><dd>${hm(pr.life.h)}</dd><dt>Return margin (−${PHYS.reserveH * 60} min reserve)</dt><dd style="color:${pr.margin < 0 ? 'var(--bad)' : pr.margin < 0.75 ? 'var(--warn)' : 'var(--ok)'}">${pr.margin === null ? '—' : hm(pr.margin)}</dd>
        <dt>Daylight left</dt><dd>${pr.toSunset === null ? '—' : hm(pr.toSunset)}</dd><dt>EVA so far</dt><dd>${hm(pr.evaH)}</dd></dl>${wp}
        <div class="sec">Consumables</div>
        <dl class="kv"><dt>O₂</dt><dd>${fmt(S.res.o2 * 1000)} / ${fmt(CAP.o2kg * 1000)} g</dd><dt>CO₂ absorbed</dt><dd>${fmt(S.res.co2 * 1000)} / ${fmt(CAP.co2kg * 1000)} g</dd><dt>Power</dt><dd>${fmt(S.res.wh)} / ${fmt(CAP.wh)} Wh</dd><dt>Cooling water</dt><dd>${fmt(S.res.h2o, 2)} / ${fmt(CAP.h2okg, 2)} kg</dd><dt>Suit pressure</dt><dd>${fmt(PHYS.psi * (0.5 + 0.5 * S.res.integ), 2)} psid</dd><dt>Dose so far (model)</dt><dd>${fmt(S.res.dose, 3)} mSv</dd></dl>
        <p class="note">Green zone = everywhere you could still walk home from with current O₂/CO₂ at 2.4 km/h with a ${PHYS.reserveH * 60} min reserve, from the real cost-to-haven field for your ${S.theta}° limit.</p>`;
    } else if (MV.tab === 'cond') {
      const near = cmeNear(S.sim), list = (swx?.cme_mars || []).slice(-5).reverse();
      b.innerHTML = `<div class="sec">Time & sun (Mars24)</div>
        <dl class="kv"><dt>Local true solar time</dt><dd>${M24.fmtH(st.ltst)}</dd><dt>Local mean solar time</dt><dd>${M24.fmtH(st.lmst)}</dd><dt>Mars 2020 sol</dt><dd>${st.sol}</dd>
        <dt>Earth UTC</dt><dd>${new Date(S.sim).toISOString().slice(0, 16).replace('T', ' ')}</dd><dt>Season (Ls)</dt><dd>${fmt(st.Ls, 1)}° · ${st.season}</dd>
        <dt>Dust-storm season</dt><dd>${st.dustSeason ? 'yes (Ls 180–360°)' : 'no'}</dd><dt>Sun elevation / azimuth</dt><dd>${fmt(st.elev, 1)}° / ${fmt(st.az)}°</dd>
        <dt>Sunrise / sunset (LTST)</dt><dd>${M24.fmtH(pr.sun.sunriseLtst)} / ${M24.fmtH(pr.sun.sunsetLtst)}</dd><dt>Radio delay to Earth</dt><dd>${fmt(st.lightMin, 1)} min one way</dd><dt>Gravity</dt><dd>${PHYS.g} m/s²</dd></dl>
        <div class="sec">Weather reference (Perseverance MEDA)</div>
        <dl class="kv"><dt>Air temperature at this hour</dt><dd>${fmt(airTemp(st) - 273.15)} °C</dd><dt>Pressure at this hour</dt><dd>${fmt(medaAt('P', st.lmst) ?? NaN)} Pa</dd></dl>
        <p class="note">Historical means at the depot, sols ${medaRef?.sols.join(', ')} (Ls ${fmt(medaRef?.ls[0], 0)}–${fmt(medaRef?.ls[1], 0)}°). A reference, not a forecast.</p>
        <div class="sec">Space weather (NASA DONKI)</div>
        <p style="color:${near.length ? 'var(--warn)' : 'var(--ok)'};font-weight:700">${near.length ? `${near.length} CME arrival(s) at Mars within 24 h` : 'No CME predicted at Mars within 24 h of now'}</p>
        <ul class="issues">${list.map((c) => `<li>${esc(c.arrival_utc?.replace('T', ' ').replace('Z', ' UTC'))} · ${c.glancing_blow ? 'glancing blow' : c.minor_impact ? 'minor impact' : 'impact'} · ${fmt(c.speed_km_s)} km/s</li>`).join('') || '<li>none in snapshot</li>'}</ul>
        <p class="note">Snapshot ${esc(swx?.window?.join(' → '))}. WSA-ENLIL arrival errors are several hours.</p>`;
    } else if (MV.tab === 'sci') {
      b.innerHTML = `<p>Science points: <b style="color:var(--accent-2)">${S.score}</b></p>` + order().filter((id) => id !== lander.id).map((id) => { const s = ST.find((x) => x.id === id), done = S.done.has(id), pov = D.pov?.[id];
        return `<div class="sci-card ${done ? 'done' : ''}"><b>${esc(id)} · ${esc(s.name)}</b> ${done ? '<span class="tag" style="color:var(--ok)">documented</span>' : '<span class="tag">to do</span>'}<div class="note">${esc(s.sample || s.note || '')}</div>${done && pov ? `<img src="../data/${esc(pov.file)}" alt="">` : ''}</div>`; }).join('');
    } else if (MV.tab === 'model') {
      const eq = (t, f, src) => `<div class="sec">${t}</div><div class="model-eq">${f}</div><div class="src">${src}</div>`;
      b.innerHTML = eq('Gravity', `g = ${PHYS.g} m/s²  (jumps, falls, dust)`, 'NASA NSSDC Mars Fact Sheet')
        + eq('Metabolic rate', `W = W_rest + (W_design − W_rest)·(v / v_pace(grade))^1.5\nW_rest = ${fmt(PHYS.W_rest)} W (100 kcal/h)\nW_design = ${fmt(PHYS.W_design)} W (1,000 Btu/h)\nW ≤ W_peak = ${fmt(PHYS.W_peak)} W (2,200 Btu/h)`, 'NASA EMU design average and Apollo lunar-EVA average 1,000 Btu/h, peaks 2,200 Btu/h (Gernhardt et al., NASA); 100 kcal/h resting floor (Waligora & Horrigan 1975, NASA SP-368). Exponent 1.5 is our assumption.')
        + eq('Walking pace vs grade', 'v_pace = 2.7 km/h (≤3°) → 1.7 km/h (10°) → 1.2 km/h (20°)', 'Apollo walk-back planning pace (ALSJ "Lunar Gaits"); Apollo 14 uphill average; 20° extrapolated (Marswalk Planner v4.1)')
        + eq('Oxygen', `O₂ [L/h] = W·3600 / ((3.941 + 1.106·RQ)·4184),  RQ = ${PHYS.RQ}\nmass = L × 1.429 g/L\ncapacity = ${fmt(CAP.o2kg * 1000)} g  (${SIZE_H} h at W_design)`, 'Weir (1949) indirect calorimetry; RQ 0.9 as used in NASA EVA CO₂ analyses; 8 h EVA requirement (NASA xEVA ConOps) + 30 min reserve')
        + eq('CO₂', `CO₂ [L/h] = RQ × O₂ [L/h];  mass = L × 1.977 g/L\ncapacity = ${fmt(CAP.co2kg * 1000)} g`, 'Respiratory quotient definition')
        + eq('Cooling water', `water [kg/h] = Q·3600 / 2.83 MJ/kg\nQ = W + sunlight − radiative loss\ncapacity = ${fmt(CAP.h2okg, 2)} kg`, 'Sublimator cooling uses the latent heat of sublimation of ice (physical constant); sunlight/radiation terms are our assumptions')
        + eq('Suit pressure', `${PHYS.psi} psid nominal; leaks add (1 − integrity)·1.5 to O₂ use`, 'NASA xEVA ConOps (2021) nominal EVA pressure; leak model is our assumption')
        + eq('Return estimate', 'ETA = d_home / 2.4 km/h + 15 min airlock\nmargin = life(W_design) − ETA − 30 min', 'd_home from this project\'s Dijkstra cost-to-haven field on the HiRISE slope grid')
        + eq('Rover', `top speed ${PHYS.roverKmh} km/h; slope ≤ ${PHYS.roverSlope}°`, 'Artemis LTV design figure (15 km/h); Apollo LRV reached 18 km/h')
        + eq('Rocks near you', 'F(D) = k·e^(−q·D),  q = 1.79 + 0.152/k,  k = 3–12 %', 'Golombek & Rapp (1997) Mars rock model (used for Mars landing-site hazards); k per cell is our assumption — the DTM cannot see individual rocks')
        + eq('Sun & time', 'Mars24 (Allison & McEwen 2000)', 'NASA GISS Mars24 algorithm; validated to ±5 s against Perseverance MEDA timestamps')
        + eq('Radiation', `${PHYS.RAD} mSv/day; ×3 within 24 h of a predicted CME`, 'Curiosity RAD at Gale (Hassler et al. 2014); CME list from NASA DONKI; ×3 is our assumption')
        + `<p class="note">Speed ×${S.speed} multiplies both the clock and your gait, so the oxygen used per metre walked is unchanged.</p>`;
    } else {
      b.innerHTML = `<div class="sec">Real data in this simulator</div><ul class="issues">
        <li>Terrain: MRO HiRISE 1 m DTM (USGS doi:10.5066/P9REJ9JN): 5 m mesh${STEP > 1 ? ' (10 m on this device)' : ''} + 1 m micro-relief normal map; image: HiRISE orthomosaic (false-colour tint)</li>
        <li>Slopes, cost-to-haven fields and the planned route: this project's pipeline</li>
        <li>Stops: Perseverance sample sites (Herd et al. 2025); depot tubes: NASA PDS depot bundle; photos: Perseverance raw images</li>
        <li>Weather: MEDA (NASA PDS); sun & time: Mars24; space weather: NASA CCMC DONKI; radiation: Curiosity RAD</li></ul>
        <p>See the <b>Model</b> tab for every equation and its source.</p>
        <p><a href="../">Open the full planner</a> · <a href="../#mode=data">Data & Limits</a></p><p class="note">${esc(D.manifest.si_acknowledgement)}</p>`;
    }
  }

  // ============================================================================================ modals
  function openModal(html, actions) {
    $('#modal-body').innerHTML = html; const a = $('#modal-actions'); a.innerHTML = '';
    for (const [t, fn, primary] of actions) { const bt = document.createElement('button'); bt.className = 'btn' + (primary ? ' primary' : ''); bt.textContent = t; bt.onclick = fn; a.appendChild(bt); }
    $('#modal').classList.remove('hidden'); if (document.pointerLockElement) document.exitPointerLock(); S.modal = true; a.querySelector('button')?.focus();
  }
  function closeModal() { $('#modal').classList.add('hidden'); S.modal = false; clock.getDelta(); }
  function helpHtml() {
    return `<h2>How to play</h2><p>Document every orange beacon (Perseverance sample sites), inspect the purple depot, and walk back into the lander airlock before life support runs out. Watch the <b>return margin</b>: time to spare after walking home with a 30-minute reserve.</p>
      <div class="keys">${TOUCH ? '<kbd>Left stick</kbd><span>Walk / drive</span><kbd>Drag</kbd><span>Look around</span><kbd>Run</kbd><span>Toggle loping</span><kbd>Use</kbd><span>Document, board rover, airlock</span>' :
        '<kbd>W A S D</kbd><span>Walk (or drive the rover)</span><kbd>Mouse</kbd><span>Look (click to lock in first person; drag in third person)</span><kbd>Shift</kbd><span>Lope (faster, more O₂)</span><kbd>Space</kbd><span>Jump (Mars gravity 3.73 m/s²)</span><kbd>E</kbd><span>Document / inspect / board rover / airlock</span><kbd>V</kbd><span>First / third person</span><kbd>M</kbd><span>Map, predictions, conditions, model</span><kbd>T</kbd><span>Travel & time speed</span><kbd>R</kbd><span>Route guide</span><kbd>L</kbd><span>Helmet lights</span><kbd>P / Esc</kbd><span>Pause</span>'}</div>
      <p class="note">Speed ×N moves you and the clock N times faster together, so oxygen per metre follows NASA's measured rates.</p>`;
  }
  function showHelp() { openModal(helpHtml(), [['Got it', closeModal, true]]); }
  function setPaused(p) { S.paused = p; if (p && document.pointerLockElement) document.exitPointerLock();
    if (p) openModal('<h2>Paused</h2><p class="note">The simulation clock is stopped.</p>', [['Resume', () => { closeModal(); setPaused(false); }, true], ['Help', showHelp], ['Open planner', () => { location.href = '../'; }]]); else clock.getDelta(); }

  // ============================================================================================ start screen
  function setQuality(name) {
    S.gfx = name; const q = name === 'auto' ? (TOUCH ? 'low' : 'ultra') : name; const old = Q; Q = { ...QUAL[q], step: STEP };
    if (old.shadow !== Q.shadow) { sun.shadow.mapSize.set(Q.shadow, Q.shadow); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    applyRendererMode(); resize(); if (rocks && old.rocksR !== Q.rocksR) buildRocks();
  }
  function initStart() {
    $('#s-date').value = new Date().toISOString().slice(0, 10);
    const dep = $('#s-dep'); for (let h = 6; h <= 15.5; h += 0.5) { const o = document.createElement('option'); o.value = h; o.textContent = M24.fmtH(h) + ' LTST'; if (h === 8) o.selected = true; dep.appendChild(o); }
    const upd = () => {
      const d = new Date($('#s-date').value + 'T12:00:00Z'); const sol = M24.at(d).sol; const depH = +dep.value, th = +$('#s-theta').value;
      const t0 = M24.utcForLtst(sol, depH), st = M24.at(t0), sun = M24.sunTimes(t0);
      const walkH = plannedWalkHours(th), evaH = walkH + (order().length - 1) * 25 / 60 + 5 / 60 + 0.5, back = depH + evaH, cme = cmeNear(t0.getTime()).length, k = +$('#s-speed').value;
      const ok = sun.sunsetLtst === null || back < sun.sunsetLtst - 1;
      $('#s-forecast').innerHTML = `<b>Sol ${st.sol}</b> · Ls ${fmt(st.Ls, 1)}° (${st.season}${st.dustSeason ? ', dust season' : ''}) · sunrise ${M24.fmtH(sun.sunriseLtst)}, sunset ${M24.fmtH(sun.sunsetLtst)} · radio delay ${fmt(st.lightMin, 1)} min<br>
        Planned EVA ≈ <b>${hm(evaH)}</b> (walk ${hm(walkH)} at Apollo pace, ${order().length - 1} stops, airlock) → back at <b>${M24.fmtH(back)}</b> ${ok ? '✓ daylight' : '⚠ after sunset margin'}${cme ? ' · ⚠ CME within 24 h (DONKI)' : ''}<br>
        At ×${k}: about <b>${fmt(evaH * 60 / k)} real minutes</b> to play · suit O₂ ${fmt(CAP.o2kg * 1000)} g for ${SIZE_H} h at 1,000 Btu/h`;
    };
    ['#s-date', '#s-dep', '#s-theta', '#s-speed'].forEach((s) => $(s).addEventListener('change', upd)); upd();
    $('#s-gfx').addEventListener('change', (e) => setQuality(e.target.value));
    setInterval(() => { if (S.updateReady && !S.playing && !$('#s-update')) { const b = document.createElement('button'); b.id = 's-update'; b.className = 'btn'; b.textContent = '⟳ Update ready — reload'; b.onclick = () => location.reload(); $('#start .actions').appendChild(b); } }, 1000);
    $('#s-help').onclick = () => openModal(helpHtml(), [['Close', closeModal, true]]);
    $('#s-go').onclick = () => {
      S.theta = +$('#s-theta').value; S.speed = +$('#s-speed').value; S.rover = $('#s-rover').checked; $('#h-speed').textContent = `×${S.speed}`;
      const d = new Date($('#s-date').value + 'T12:00:00Z'); S.sim = M24.utcForLtst(M24.at(d).sol, +dep.value).getTime(); S.evaStart = S.sim;
      buildRouteLine(); resetPlayer(); scatterRocks(P.X, P.Z); $('#start').classList.add('hidden'); $('#hud').classList.remove('hidden'); S.playing = true; document.body.classList.add('playing');
      clock.getDelta(); flash(TOUCH ? 'Left stick to walk · drag to look · Map for data' : 'WASD to walk · Shift to lope · mouse to look · M for the map', 'info', 6);
    };
  }

  // ============================================================================================ main loop
  let orbit = 0, hudT = 0, mapT = 0;
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.1);
    let night = 0;
    if (S.playing && !S.paused && !S.mapPaused && !S.modal) step(dt);
    if (!S.playing && !S.over) {
      astro.visible = false; orbit += dt * 0.035; const r = 55; P.X = 0; P.Z = 7.5; P.Y = groundY(0, 7.5);
      camera.position.set(Math.sin(orbit) * r, groundY(Math.sin(orbit) * r, Math.cos(orbit) * r) + 14, Math.cos(orbit) * r); camera.lookAt(0, 4, 0);
      const st = state(), el = st.elev * D2R, az = st.az * D2R; skyU.sunDir.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      const day = clamp((st.elev + 6) / 16, 0, 1); night = 1 - day; skyU.day.value = 0.05 + 0.95 * day; sun.intensity = clamp(Math.sin(el) * 3.5, 0, 1) * (Q.post ? 2.7 : 2.2); hemi.intensity = 0.05 + 0.3 * day;
      stars.material.opacity = clamp(1 - day * 1.6, 0, 0.95); sun.position.set(skyU.sunDir.value.x * 250, Math.max(skyU.sunDir.value.y, 0.04) * 250, skyU.sunDir.value.z * 250); updateEnv(st.elev);
      sunWorld.copy(camera.position).add(skyU.sunDir.value.clone().multiplyScalar(5000)); if (!rockCenter) scatterRocks(0, 7.5);
    } else night = updateVisuals(dt);
    hudT += dt; if (S.playing && hudT > 0.2) { hudT = 0; updateHUD(); }
    mapT += dt; if (S.playing && !$('#mapview').classList.contains('hidden') && mapT > 1) { mapT = 0; renderTab(); }
    if (Q.post) post.render(performance.now() / 1000, sunWorld, night); else renderer.render(scene, camera);
  }

  // ============================================================================================ offline cache + update check
  function offline() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    const bid = D.manifest.build_id, swUrl = (id) => `../service-worker.js?build=${encodeURIComponent(id)}`, had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { const c = navigator.serviceWorker.controller; const b = c ? new URL(c.scriptURL).searchParams.get('build') : null; if (had && b !== bid) S.updateReady = true; });
    navigator.serviceWorker.register(swUrl(bid), { scope: '../', updateViaCache: 'none' }).then(() => {
      fetch(`../data/manifest.json?version-check=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()).then((m) => { if (m.build_id && m.build_id !== bid) navigator.serviceWorker.register(swUrl(m.build_id), { scope: '../', updateViaCache: 'none' }); }).catch(() => {});
    }).catch(() => {});
  }

  // ============================================================================================ boot
  try {
    $('#load-msg').textContent = 'Building Jezero terrain from the HiRISE DTM…';
    setTimeout(() => {
      const H = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
      if (H.gfx && QUAL[H.gfx]) { $('#s-gfx').value = H.gfx; Q = { ...QUAL[H.gfx], step: STEP }; }
      buildWorld(); applyRendererMode(); resize(); resetPlayer();
      S.sim = M24.utcForLtst(M24.at(new Date()).sol, 9).getTime();
      initStart(); $('#loading').classList.add('hidden'); frame(); offline();
      // deep links: #play starts; #view=fp; #map; #ltst=19.5 departure; #at=S2 start beside a stop; #speed=20; #gfx=ultra|high|low
      if (H.ltst && Number.isFinite(+H.ltst)) { const o = document.createElement('option'); o.value = +H.ltst; o.textContent = M24.fmtH(+H.ltst) + ' LTST'; $('#s-dep').appendChild(o); $('#s-dep').value = String(+H.ltst); }
      if (H.speed && [1, 5, 10, 20, 40].includes(+H.speed)) $('#s-speed').value = H.speed;
      if ('play' in H) {
        $('#s-go').click();
        const st = ST.find((x) => x.id === H.at);
        if (st) { const w = W(st.x + 14, st.y - 10); P.X = w.X; P.Z = w.Z; P.Y = groundY(w.X, w.Z); P.yaw = P.camYaw = -Math.atan2(-14, 10); S.trail = []; scatterRocks(P.X, P.Z); }
        if (H.view === 'fp') toggleView(); if ('map' in H) setTimeout(() => toggleMap(true), 300);
      }
      window.MEC_GAME = { S, P, PHYS, CAP, camera, get astro() { return astro; }, predict, toggleMap, interact, endGame, groundY, Lc, W, lifeHours, metabolic, setQuality };
    }, 0);
  } catch (e) { $('#load-msg').textContent = 'Could not start 3D: ' + e.message; }
})();
