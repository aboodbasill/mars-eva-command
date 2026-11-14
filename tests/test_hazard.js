// SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
// Tests for app/game/hazard.js: the 10 scenarios of the hazard-warning spec, on a synthetic grid and on the real exported grids.
// Run: node tests/test_hazard.js
'use strict';
const fs = require('fs'), path = require('path');
const HZ = require(path.join(__dirname, '..', 'app', 'game', 'hazard.js'));
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('PASS', name, extra); } else { fail++; console.log('FAIL', name, extra); } };

// ---- synthetic 1 km × 1 km grid, 5 m cells, origin upper-left (x0=0, y0=1000)
const N = 200, CELL = 5, n = N * N;
const slope = new Uint8Array(n).fill(20), prov = new Uint8Array(n).fill(1), elev = new Float32Array(n);   // 5° everywhere
const set = (r0, r1, c0, c1, f) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) f(r * N + c); };
set(0, N - 1, 100, 110, (i) => { slope[i] = 120; });          // steep strip 30°, x 500–555
set(90, 100, 80, 90, (i) => { elev[i] = 10; });               // 10 m block → sharp steps around it (x 400–455, y 495–550)
set(150, 160, 150, 160, (i) => { slope[i] = 255; prov[i] = 0; });   // no data (x 750–805, y 195–250)
set(170, 180, 30, 40, (i) => { prov[i] = 2; });               // CTX-only (x 150–205, y 95–150)
const grid = { slopeU8: slope, slopeScale: 0.25, slopeNodata: 255, provU8: prov, elev, nc: N, nr: N, cell: CELL, x0: 0, y0: 1000 };
const det = new HZ.HazardDetector(grid, { theta: 20 });
const mgr = () => new HZ.HazardAlertManager();
const step = (m, x, y, secs = 0.2, heading = Math.PI / 2) => { let s; for (let t = 0; t < secs; t += 1 / 60) s = m.update(det.query(x, y), 1 / 60, { heading }); return s; };

// 1. approaching a known steep region (walking east along y = 300; strip edge at x = 500)
{ const m = mgr(); const lv = []; for (const x of [430, 455, 470, 485, 497]) { const s = step(m, x, 300, 0.5); lv.push(`${500 - x}m:${HZ.LEVEL_NAME[s.level]}`); }
  ok(lv.join(' ') === '70m:CLEAR 45m:CAUTION 30m:CAUTION 15m:WARNING 3m:CRITICAL', '1 approach steep region', lv.join(' '));
  const s = step(m, 497, 300); const msg = m.message(s, 20);
  ok(s.top.type === 'steep' && /exceeds the configured 20° limit/.test(msg.title) && msg.basis === 'DEM-DERIVED' && /30\.0°/.test(msg.detail), '1b critical message and basis', msg.title + ' | ' + msg.detail);
  ok(Math.abs(s.relDeg) < 1 && msg.where === 'ahead', '1c direction: hazard ahead when facing east', String(s.relDeg)); }

// 2. entering a warning zone: repeating, non-overlapping alarm
{ const m = mgr(), log = [], A = new HZ.HazardAudio({ log }); let now = 0; step(m, 470, 300, 1);
  for (let i = 0; i < 180; i++) { now += 1 / 60; A.update(m.update(det.query(485, 300), 1 / 60, { heading: Math.PI / 2 }), now); }
  const w = log.filter((k) => k === 'warning').length; ok(log[0] === 'warning' && w >= 2 && w <= 4, '2 warning zone: repeating alarm', log.join(',')); }

// 3. moving away: alarm stops, clear tone, HUD back to normal
{ const m = mgr(), log = [], A = new HZ.HazardAudio({ log }); let now = 0, s;
  for (let i = 0; i < 60; i++) { now += 1 / 60; s = m.update(det.query(497, 300), 1 / 60, {}); A.update(s, now); }
  for (let i = 0; i < 120; i++) { now += 1 / 60; s = m.update(det.query(400, 300), 1 / 60, {}); A.update(s, now); }
  ok(s.level === 0 && log.at(-1) === 'clear' && !log.slice(log.lastIndexOf('critical') + 1, -1).includes('critical'), '3 move away → clear', log.join(',')); }

// 4. walking parallel to the strip at 30 m (north of the step block): one caution, no flapping, one chime
{ const m = mgr(), log = [], A = new HZ.HazardAudio({ log }); let now = 0, changes = 0;
  for (let y = 600; y <= 980; y += 1) { now += 1 / 60; const s = m.update(det.query(470, y), 1 / 60, { heading: 0 }); A.update(s, now); if (s.changed) changes++; }
  ok(changes === 1 && m.level === 1 && log.filter((k) => k === 'caution').length === 1, '4 parallel walk: stable caution', `changes=${changes} log=${log.join(',')}`);
  const s = m.update(det.query(470, 800), 0.01, { heading: 0 }); ok(m.message(s, 20).where === 'to your right', '4b hazard reported to the side', m.message(s, 20).where); }

// 5. several hazards: most urgent first, others listed
{ const m = mgr(); const s = step(m, 470, 520, 0.5); const types = [s.top.type, ...s.others.map((o) => o.type)];
  ok(s.top.type === 'relief' && s.top.level === 2 && types.includes('steep'), '5 multiple hazards: warning (relief 10 m) above caution (steep 30 m)', types.join(','));
  const m2 = mgr(); const s2 = step(m2, 480, 548, 0.5);   // both within 20 m → same level, steep has priority
  ok(s2.top.type === 'steep' && s2.others.some((o) => o.type === 'relief' && o.level === 2), '5b same level → priority (steep over relief)', [s2.top.type, ...s2.others.map((o) => o.type + o.level)].join(',')); }

// 6. missing data: data-gap category, never presented as a measured hazard
{ const m = mgr(); const s = step(m, 740, 220, 0.5); const msg = m.message(s, 20);
  ok(s.top.type === 'nodata' && s.level === 2 && /UNVERIFIED/.test(msg.basis), '6 approaching a no-data area → WARNING, DATA GAP', `${msg.basis} ${msg.distText}`);
  const s2 = step(m, 780, 220, 0.3); ok(s2.level === 3 && /treats this as blocked/.test(m.message(s2, 20).title), '6b inside no-data → CRITICAL with reason', m.message(s2, 20).title);
  const m3 = mgr(); const s3 = step(m3, -20, 500, 0.3); ok(s3.level === 3 && s3.top.outside, '6c outside the mapped area → no data', String(s3.top.outside));
  const m4 = mgr(); const s4 = step(m4, 140, 120, 0.3); ok(s4.top.type === 'lowres' && s4.level === 2 && /LOW RESOLUTION/.test(m4.message(s4, 20).basis), '6d CTX-only terrain capped at WARNING', m4.message(s4, 20).basis); }

// 7. muted alarm: patterns tracked, no oscillators created; unmute resumes
{ let oscs = 0; const node = () => ({ connect: () => node(), gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} }, start() {}, stop() {} });
  class FakeAC { constructor() { this.currentTime = 0; this.destination = {}; this.state = 'running'; } createGain() { return node(); } createOscillator() { oscs++; return node(); } }
  const A = new HZ.HazardAudio({ AudioContext: FakeAC, muted: true }); A.start(); const m = mgr(); let now = 0;
  for (let i = 0; i < 120; i++) { now += 1 / 60; A.update(m.update(det.query(497, 300), 1 / 60, {}), now); }
  const mutedOscs = oscs; A.setMuted(false); for (let i = 0; i < 60; i++) { now += 1 / 60; A.update(m.update(det.query(497, 300), 1 / 60, {}), now); }
  ok(mutedOscs === 0 && oscs > 0 && A.out.gain.value === A.volume, '7 mute: silent while muted, sound after unmute', `muted=${mutedOscs} after=${oscs}`); }

// 8. quick crossing: immediate escalation, no chatter at a threshold
{ const m = mgr(); step(m, 430, 300, 0.3); const s1 = m.update(det.query(497, 300), 1 / 60, {});
  ok(s1.level === 3, '8 jump from 70 m to 3 m escalates in one update', HZ.LEVEL_NAME[s1.level]);
  const m2 = mgr(); step(m2, 485, 300, 1); let flips = 0, last = m2.level;
  for (let i = 0; i < 300; i++) { const x = i % 2 ? 480.5 : 479.5; const s = m2.update(det.query(x, 300), 1 / 60, {}); if (s.level !== last) flips++; last = s.level; }
  ok(flips === 0 && last === 2, '8b hovering at the 20 m threshold: no flapping (hysteresis)', `flips=${flips}`);
  const m3 = mgr(); step(m3, 430, 300, 0.3); step(m3, 497, 300, 0.1); const back = m3.update(det.query(430, 300), 1 / 60, {});
  ok(back.level === 3, '8c brief crossing: the critical alert stays up for its minimum dwell (0.8 s)', HZ.LEVEL_NAME[back.level]);
  const after = step(m3, 430, 300, 1); ok(after.level === 0, '8d then drops to clear', HZ.LEVEL_NAME[after.level]); }

// 9. reduced motion: no pulsing edge or LEDs
{ const el = () => { const e = { style: {}, dataset: {}, className: '', textContent: '', children: [], classList: { toggle() {} }, appendChild(c) { this.children.push(c); return c; } };
    e.querySelector = () => el(); e.querySelectorAll = () => [el(), el(), el()]; return e; };
  global.document = { createElement: el }; global.innerWidth = 1600; global.innerHeight = 900;
  const m = mgr(); const s = step(m, 497, 300, 0.3), msg = m.message(s, 20);
  const hud = new HZ.HazardHUD(el(), { reducedMotion: true }); const op = new Set(); for (let t = 0; t < 2; t += 0.05) { hud.render(s, msg, t); op.add(hud.edge.style.opacity); }
  const hud2 = new HZ.HazardHUD(el(), { reducedMotion: false }); const op2 = new Set(); for (let t = 0; t < 2; t += 0.05) { hud2.render(s, msg, t); op2.add(hud2.edge.style.opacity); }
  ok(op.size === 1 && op2.size > 5, '9 reduced motion: static warning edge (animated otherwise, ≤ 1.4 Hz)', `reduced=${op.size} values, normal=${op2.size} values`); }

// 10. real NASA grids: detector matches the slope grid, queries are cheap, route scan works
{ const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'data', 'grids.js'), 'utf8'); const G = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
  const dec = (g) => Buffer.from(g.b64, 'base64'); const g5 = G.grid_5m, nc = g5.ncols, nr = g5.nrows;
  const sl = Uint8Array.from(dec(G.grids.slope)), pv = Uint8Array.from(dec(G.grids.provenance)), eb = dec(G.grids.elevation), e16 = new Uint16Array(eb.buffer, eb.byteOffset, eb.length / 2);
  const E = new Float32Array(nc * nr); for (let i = 0; i < E.length; i++) E[i] = e16[i] === 65535 ? 0 : e16[i] * 0.1 - 3000;
  const t0 = Date.now(); const D = new HZ.HazardDetector({ slopeU8: sl, slopeScale: 0.25, slopeNodata: 255, provU8: pv, elev: E, nc, nr, cell: g5.cell_m, x0: g5.x0, y0: g5.y0 }, { theta: 20 }); const build = Date.now() - t0;
  let steep = 0; for (let i = 0; i < sl.length; i++) if (sl[i] !== 255 && sl[i] * 0.25 > 20) steep++;
  ok(D.steepCount === steep && D.static.nodata.length > 0, '10 real grids: steep cells match the 5 m slope grid', `steep=${D.steepCount} nodata=${D.static.nodata.length} relief=${D.static.relief.length} lowres=${D.static.lowres.length} build=${build} ms`);
  const iSteep = D.idx.steep.find((b) => b && b.length > 20)[10]; const [cx, cy] = D.cellCenter(iSteep);
  let q = 0; const t1 = process.hrtime.bigint(); for (let k = 0; k < 500; k++) q += D.query(cx - 30 + (k % 7), cy + (k % 5)).length; const us = Number(process.hrtime.bigint() - t1) / 500 / 1000;
  const hz = D.query(cx - 2.5, cy).find((h) => h.type === 'steep'); ok(hz && hz.dist < 0.01 && us < 2000, '10b real steep cell found at 0 m; query cost', `${us.toFixed(0)} µs per query`);
  const r = D.scanRoute([[cx - 200, cy], [cx - 100, cy], [cx - 40, cy]]); ok(r.steep && Number.isFinite(r.steep.closest), '10c route scan reports closest steep ground', `closest ${r.steep?.closest.toFixed(1)} m`); }

console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
