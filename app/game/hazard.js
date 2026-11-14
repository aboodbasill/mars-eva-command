/* SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md. */
/* Real-time terrain hazard detection and astronaut warnings for Marswalk.
 *
 *   HazardDetector      finds the nearest hazard of each type around a position, from the exported NASA grids
 *   HazardAlertManager  turns distances into CAUTION / WARNING / CRITICAL with hysteresis, dwell time and priority
 *   HazardAudio         original Web Audio alarm tones (no files), one pattern per level, no overlap, volume + mute
 *   HazardHUD           screen-edge glow, LED indicators, warning panel and a direction arrow
 *
 * Hazards come only from data we actually have, and every alert says which kind it is:
 *   DEM-DERIVED      steep cells (5 m HiRISE slope > suit limit) and sharp steps (≥ reliefM in a 3×3 window)
 *   ROUTE ANALYSIS   planned-route cells within nearLimitDeg of the suit limit
 *   DATA GAP         cells with no elevation data, or only 20 m CTX elevation: hazards cannot be ruled out
 * Weather (MEDA) and radiation (RAD, DONKI) are references or forecasts; they are never turned into proximity hazards.
 * Distances below are GAMEPLAY settings, not NASA-certified safety distances. */
(function (root) {
  'use strict';

  const CONFIG = {
    levels: { caution: 50, warning: 20, critical: 5 },   // metres to the nearest hazardous cell edge
    hysteresis: { factor: 1.2, extraM: 3 },               // leave a level only beyond T·factor + extraM ...
    minDwellS: 0.8,                                        // ... and after at least this long in it
    reliefM: 4.0,                                          // sharp step: ≥ 4 m height range within 3×3 cells (≈10 m)
    nearLimitDeg: 2,                                       // route cells within 2° of the suit limit
    bucketM: 50,                                           // spatial index bucket size
    queryHz: 5,                                            // detector queries per second (not every frame)
    cautionChimeCooldownS: 6,
  };
  const TYPES = {
    steep: { priority: 5, maxLevel: 3, basis: 'DEM-DERIVED', label: ['Steep terrain ahead', 'High-slope terrain', 'Slope over the suit limit'] },
    relief: { priority: 4, maxLevel: 3, basis: 'DEM-DERIVED', label: ['Sharp elevation change', 'Abrupt terrain step', 'Terrain step / scarp'] },
    nodata: { priority: 3, maxLevel: 3, basis: 'DATA GAP · UNVERIFIED', label: ['Unmapped terrain', 'No terrain data ahead', 'No terrain data'] },
    lowres: { priority: 2, maxLevel: 2, basis: 'DATA GAP · LOW RESOLUTION', label: ['Low-resolution terrain', 'Low-resolution terrain', 'Low-resolution terrain'] },
    route: { priority: 1, maxLevel: 1, basis: 'ROUTE ANALYSIS · DEM', label: ['Route section near suit limit', 'Route section near suit limit', 'Route section near suit limit'] },
  };
  const LEVEL_NAME = ['CLEAR', 'CAUTION', 'WARNING', 'CRITICAL'];

  // ------------------------------------------------------------------------------------------- detector
  /** grid: { slopeU8, slopeScale, slopeNodata, provU8, elev (Float32, metres), nc, nr, cell, x0, y0 (upper-left, y north) } */
  function HazardDetector(grid, opts = {}) {
    this.g = grid; this.cfg = Object.assign({}, CONFIG, opts); this.theta = opts.theta ?? 20;
    const { nc, nr, cell } = grid; this.bc = Math.max(1, Math.round(this.cfg.bucketM / cell));
    this.nbx = Math.ceil(nc / this.bc); this.nby = Math.ceil(nr / this.bc);
    this.relief = new Float32Array(nc * nr); this.static = { nodata: [], lowres: [], relief: [] };
    const sl = grid.slopeU8, nd = grid.slopeNodata ?? 255, E = grid.elev;
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
      const i = r * nc + c;
      if (sl[i] === nd) { this.static.nodata.push(i); continue; }
      if (grid.provU8 && grid.provU8[i] === 2) this.static.lowres.push(i);
      let mn = Infinity, mx = -Infinity;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= nr || cc >= nc) continue;
        const j = rr * nc + cc; if (sl[j] === nd) continue; const e = E[j]; if (e < mn) mn = e; if (e > mx) mx = e; }
      this.relief[i] = mx - mn; if (mx - mn >= this.cfg.reliefM) this.static.relief.push(i);
    }
    this.idx = {}; for (const k of Object.keys(this.static)) this.idx[k] = this._bucket(this.static[k]);
    this.setTheta(this.theta); this.setRoute(null);
  }
  HazardDetector.prototype._bucket = function (cells) {
    const B = new Array(this.nbx * this.nby); const { nc } = this.g;
    for (const i of cells) { const r = (i / nc) | 0, c = i - r * nc, b = ((r / this.bc) | 0) * this.nbx + ((c / this.bc) | 0); (B[b] || (B[b] = [])).push(i); }
    return B;
  };
  HazardDetector.prototype.slopeAt = function (i) { const v = this.g.slopeU8[i]; return v === (this.g.slopeNodata ?? 255) ? null : v * (this.g.slopeScale ?? 0.25); };
  HazardDetector.prototype.setTheta = function (theta) {
    this.theta = theta; const cells = [], n = this.g.nc * this.g.nr;
    for (let i = 0; i < n; i++) { const s = this.slopeAt(i); if (s !== null && s > theta) cells.push(i); }
    this.steepCount = cells.length; this.idx.steep = this._bucket(cells); if (this.routeCells) this.setRoute(this.routeCells);
  };
  /** cells: planned-route cell indices; marks those within nearLimitDeg of the suit limit */
  HazardDetector.prototype.setRoute = function (cells) {
    this.routeCells = cells || null; const near = [];
    if (cells) for (const i of cells) { const s = this.slopeAt(i); if (s !== null && s > this.theta - this.cfg.nearLimitDeg) near.push(i); }
    this.idx.route = this._bucket(near);
  };
  HazardDetector.prototype.cellCenter = function (i) { const { nc, cell, x0, y0 } = this.g, r = (i / nc) | 0, c = i - r * nc; return [x0 + (c + 0.5) * cell, y0 - (r + 0.5) * cell]; };
  /** Nearest hazard of every type within radius of (x, y) local metres. Distance is to the cell's edge (0 inside). */
  HazardDetector.prototype.query = function (x, y, radius = this.cfg.levels.caution * this.cfg.hysteresis.factor + this.cfg.hysteresis.extraM + 5) {   // covers the caution exit band
    const { nc, nr, cell, x0, y0 } = this.g, h = cell / 2, out = [];
    const c = (x - x0) / cell, r = (y0 - y) / cell, rad = radius / cell;
    const bx0 = Math.max(0, ((c - rad) / this.bc) | 0), bx1 = Math.min(this.nbx - 1, ((c + rad) / this.bc) | 0);
    const by0 = Math.max(0, ((r - rad) / this.bc) | 0), by1 = Math.min(this.nby - 1, ((r + rad) / this.bc) | 0);
    const outside = c < 0 || r < 0 || c >= nc || r >= nr;
    for (const type of Object.keys(TYPES)) {
      const B = this.idx[type]; if (!B) continue; let best = null;
      for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) { const L = B[by * this.nbx + bx]; if (!L) continue;
        for (const i of L) { const [cx, cy] = this.cellCenter(i), px = Math.min(Math.max(x, cx - h), cx + h), py = Math.min(Math.max(y, cy - h), cy + h), d = Math.hypot(px - x, py - y);
          if (d <= radius && (!best || d < best.dist)) best = { type, dist: d, cell: i, px, py }; } }
      if (best) { best.slope = this.slopeAt(best.cell); best.relief = this.relief[best.cell]; best.dx = best.px - x; best.dy = best.py - y; out.push(best); }
    }
    if (outside) out.push({ type: 'nodata', dist: 0, cell: -1, px: x, py: y, dx: 0, dy: 0, slope: null, outside: true });
    return out;
  };
  /** Planner summary: per type, the closest approach of the route and the route length within the warning distance. */
  HazardDetector.prototype.scanRoute = function (pts /* [[x,y]] */, warnM = this.cfg.levels.warning) {
    const res = {}; let prev = null;
    for (const [x, y] of pts) { const step = prev ? Math.hypot(x - prev[0], y - prev[1]) : 0; prev = [x, y];
      for (const hz of this.query(x, y, warnM + 30)) { if (hz.type === 'route') continue; const r = res[hz.type] || (res[hz.type] = { closest: Infinity, withinWarnM: 0, at: null });
        if (hz.dist < r.closest) { r.closest = hz.dist; r.at = [x, y]; } if (hz.dist <= warnM) r.withinWarnM += step; } }
    return res;
  };

  // ------------------------------------------------------------------------------------------- alert manager
  function HazardAlertManager(opts = {}) { this.cfg = Object.assign({}, CONFIG, opts); this.state = {}; this.level = 0; this.top = null; this.others = []; this.t = 0; }
  HazardAlertManager.prototype.thresholds = function () { const L = this.cfg.levels; return [Infinity, L.caution, L.warning, L.critical]; };
  /** hazards: detector.query() output; heading: radians clockwise from north of travel or view; dt seconds. Returns the alert state. */
  HazardAlertManager.prototype.update = function (hazards, dt, ctx = {}) {
    this.t += dt; const T = this.thresholds(), H = this.cfg.hysteresis, seen = new Set();
    for (const hz of hazards) {
      const def = TYPES[hz.type]; if (!def) continue; seen.add(hz.type);
      let cand = 0; for (let L = 3; L >= 1; L--) if (hz.dist <= T[L]) { cand = L; break; }
      cand = Math.min(cand, def.maxLevel);
      const st = this.state[hz.type] || (this.state[hz.type] = { level: 0, since: this.t });
      if (cand > st.level) { st.level = cand; st.since = this.t; }                       // escalate immediately
      else if (cand < st.level && this.t - st.since >= this.cfg.minDwellS) {             // de-escalate one step past the exit band
        while (st.level > cand && hz.dist > T[st.level] * H.factor + H.extraM) st.level--;
        st.since = this.t;
      }
      st.hz = hz;
    }
    for (const k of Object.keys(this.state)) if (!seen.has(k)) { const st = this.state[k]; if (this.t - st.since >= this.cfg.minDwellS) { st.level = 0; st.hz = null; } }
    const active = Object.entries(this.state).filter(([, s]) => s.level > 0 && s.hz).map(([type, s]) => ({ ...s.hz, level: s.level, priority: TYPES[type].priority }));
    active.sort((a, b) => b.level - a.level || b.priority - a.priority || a.dist - b.dist);
    const prev = this.level; this.top = active[0] || null; this.others = active.slice(1); this.level = this.top ? this.top.level : 0;
    const Tl = this.top ? T[this.level] : 1, Tn = this.top && this.level < 3 ? T[this.level + 1] : 0;
    const intensity = this.top ? Math.min(1, Math.max(0, (Tl - this.top.dist) / Math.max(1, Tl - Tn))) : 0;
    let rel = null; if (this.top && this.top.dist > 0.01 && ctx.heading !== undefined) { const brg = Math.atan2(this.top.dx, this.top.dy); rel = ((brg - ctx.heading) * 180 / Math.PI + 540) % 360 - 180; }
    return { level: this.level, prev, changed: prev !== this.level, top: this.top, others: this.others, intensity, relDeg: rel };
  };
  HazardAlertManager.prototype.message = function (s, theta) {
    if (!s.top) return null; const hz = s.top, def = TYPES[hz.type], L = s.level, d = Math.round(hz.dist);
    const where = s.relDeg === null ? 'here' : Math.abs(s.relDeg) < 45 ? 'ahead' : Math.abs(s.relDeg) > 135 ? 'behind you' : s.relDeg > 0 ? 'to your right' : 'to your left';
    let title = def.label[L - 1], detail = '';
    if (hz.type === 'steep') { detail = `Slope ${hz.slope?.toFixed(1)}° on the 5 m HiRISE DEM · suit limit ${theta}°`; if (L === 3) title = `Terrain slope exceeds the configured ${theta}° limit`; }
    else if (hz.type === 'relief') detail = `${hz.relief.toFixed(1)} m height change within 10 m (HiRISE DEM)`;
    else if (hz.type === 'nodata') { detail = hz.outside ? 'Outside the mapped area — no NASA terrain data' : 'No elevation data here: hazards cannot be ruled out'; if (L === 3) title = 'No terrain data — the route planner treats this as blocked'; }
    else if (hz.type === 'lowres') detail = 'Only 20 m CTX elevation: rocks and steps smaller than ~40 m are invisible';
    else if (hz.type === 'route') detail = `Planned route reaches ${hz.slope?.toFixed(1)}° here (limit ${theta}°)`;
    return { level: L, levelName: LEVEL_NAME[L], title, dist: d, where, distText: hz.dist < 0.5 ? 'inside zone' : `${d} m ${where}`, detail, basis: def.basis };
  };

  // ------------------------------------------------------------------------------------------- audio (original synthesised tones)
  function HazardAudio(opts = {}) { this.ctx = null; this.out = null; this.volume = opts.volume ?? 0.8; this.muted = !!opts.muted; this.level = 0; this.nextAt = 0; this.lastChime = -1e9; this.busyUntil = 0; this.AC = opts.AudioContext; this.log = opts.log || null; }
  HazardAudio.prototype.start = function () {
    if (this.ctx) { if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume(); return; }
    const AC = this.AC || (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)); if (!AC) return;
    this.ctx = new AC(); this.out = this.ctx.createGain(); this.out.gain.value = this.muted ? 0 : this.volume; this.out.connect(this.ctx.destination);
  };
  HazardAudio.prototype.setVolume = function (v) { this.volume = v; if (this.out) this.out.gain.value = this.muted ? 0 : v; };
  HazardAudio.prototype.setMuted = function (m) { this.muted = m; if (this.out) this.out.gain.value = m ? 0 : this.volume; };
  HazardAudio.prototype._tone = function (t0, f, dur, type, peak, f2) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.linearRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + 0.012); g.gain.setValueAtTime(peak, t0 + dur - 0.03); g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.out); o.start(t0); o.stop(t0 + dur + 0.02);
  };
  /** play one pattern; returns its length (s). Patterns never overlap: the caller waits for busyUntil. */
  HazardAudio.prototype._play = function (kind) {
    if (this.log) this.log.push(kind);
    if (!this.ctx || this.muted) return 0.2; const t = this.ctx.currentTime + 0.01;
    if (kind === 'caution') { this._tone(t, 660, 0.11, 'sine', 0.22); this._tone(t + 0.14, 880, 0.13, 'sine', 0.22); return 0.3; }
    if (kind === 'warning') { this._tone(t, 920, 0.16, 'square', 0.12); return 0.2; }
    if (kind === 'critical') { this._tone(t, 1040, 0.12, 'triangle', 0.3); this._tone(t + 0.14, 760, 0.12, 'triangle', 0.3); return 0.3; }
    if (kind === 'clear') { this._tone(t, 880, 0.2, 'sine', 0.15, 520); return 0.25; }
    return 0;
  };
  /** call every frame with the alert state and the time in seconds */
  HazardAudio.prototype.update = function (s, now) {
    const L = s.level, prev = this.level;
    if (now < this.busyUntil) return;                                // never overlap; a level change waits for the current tone
    this.level = L;
    if (L > prev) {                                                  // entering a more serious level: sound now
      if (L === 1 && now - this.lastChime < CONFIG.cautionChimeCooldownS) return;
      const kind = ['', 'caution', 'warning', 'critical'][L]; if (L === 1) this.lastChime = now;
      this.busyUntil = now + this._play(kind); this.nextAt = now + (L === 3 ? 0.55 : 1.3); return;
    }
    if (L === 0 && prev >= 2) { this.busyUntil = now + this._play('clear'); return; }   // all clear
    if (L >= 2 && now >= this.nextAt) {                              // repeating pattern, faster when closer
      this.busyUntil = now + this._play(L === 3 ? 'critical' : 'warning');
      this.nextAt = now + (L === 3 ? 0.55 : 1.3 - 0.55 * (s.intensity || 0));
    }
  };

  // ------------------------------------------------------------------------------------------- HUD
  function HazardHUD(rootEl, opts = {}) {
    this.root = rootEl; this.reduced = !!opts.reducedMotion; this.shown = 0;
    const mk = (tag, cls, parent = rootEl) => { const e = document.createElement(tag); e.className = cls; parent.appendChild(e); return e; };
    this.edge = mk('div', 'hz-edge'); this.arrow = mk('div', 'hz-arrow'); this.panel = mk('div', 'hz-panel');
    this.panel.innerHTML = `<div class="hz-row"><span class="hz-leds"><i></i><i></i><i></i></span><svg class="hz-tri" viewBox="0 0 24 24"><path d="M12 3L2 21h20z"/><path d="M12 10v5M12 18v.5"/></svg>
      <b class="hz-level"></b><span class="hz-title"></span><span class="hz-dist"></span></div><div class="hz-detail"></div><div class="hz-meta"><span class="hz-basis"></span><span class="hz-others"></span></div>`;
    this.q = (s) => this.panel.querySelector(s);
  }
  HazardHUD.prototype.render = function (s, msg, t) {
    const L = msg ? msg.level : 0; this.root.classList.toggle('hz-on', L > 0); this.root.dataset.hz = L;
    // visibility fades in/out smoothly; red pulse ≤ 1.4 Hz (no strobing), static when reduced motion is on
    const f = L === 3 ? 1.4 : L === 2 ? 0.8 : 0, pulse = this.reduced || !f ? 0.5 : 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * f);
    const k = msg ? s.intensity : 0, base = L === 1 ? 0.35 + 0.25 * k : L === 2 ? 0.45 + 0.25 * k : L === 3 ? 0.65 : 0;
    this.edge.style.opacity = (L ? base * (0.65 + 0.35 * pulse * 2) : 0).toFixed(3);
    if (!msg) { this.arrow.style.opacity = 0; return; }
    this.q('.hz-level').textContent = msg.levelName; this.q('.hz-title').textContent = msg.title; this.q('.hz-dist').textContent = msg.distText;
    this.q('.hz-detail').textContent = msg.detail; this.q('.hz-basis').textContent = msg.basis;
    this.q('.hz-others').textContent = s.others.length ? `+ ${s.others.slice(0, 2).map((o) => `${TYPES[o.type].label[0].toLowerCase()} ${Math.round(o.dist)} m`).join(' · ')}` : '';
    [...this.panel.querySelectorAll('.hz-leds i')].forEach((e, i) => { e.className = i < L ? 'on' : ''; e.style.opacity = i < L ? (i === L - 1 && !this.reduced && L >= 2 ? 0.55 + 0.45 * pulse : 1) : ''; });
    if (s.relDeg === null) { this.arrow.style.opacity = 0; return; }
    const a = s.relDeg * Math.PI / 180, w = innerWidth, h = innerHeight, rx = w * 0.42, ry = h * 0.36;
    this.arrow.style.opacity = L >= 1 ? 1 : 0;
    this.arrow.style.transform = `translate(${w / 2 + Math.sin(a) * rx}px, ${h / 2 - Math.cos(a) * ry}px) rotate(${s.relDeg}deg)`;
  };

  const api = { CONFIG, TYPES, LEVEL_NAME, HazardDetector, HazardAlertManager, HazardAudio, HazardHUD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MarsHazard = api;
})(typeof window !== 'undefined' ? window : globalThis);
