// SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
// Tests for app/game/thermal.js (sampling, no-data, coverage, units, route profile). Run: node tests/test_thermal.js
'use strict';
const T = require('../app/game/thermal.js');
let pass = 0, fail = 0; const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n, x); } else { fail++; console.log('FAIL', n, x); } };
const grid = { x0: 0, y0: 100, cell_m: 10, ncols: 10, nrows: 10 };
const meta = { kind: 'brightness_temperature', encoding_vmin: 200, encoding_vmax: 254, stats_study_area: { min: 200, max: 254 } };
const rgba = new Uint8Array(400 * 4);
for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) { const i = (r * 10 + c) * 4; rgba[i] = c * 20; rgba[i + 3] = (r === 9 && c === 9) ? 0 : 255; }   // value rises eastward; one no-data cell
const L = T.makeLayer(meta, grid, rgba);
const s = T.sample(L, 25, 55); ok(Math.abs(s.value - (200 + 40 / 254 * 54)) < 1e-6 && s.status === 'ok', 'sample at a cell centre returns the decoded value', s.value.toFixed(3));
const m = T.sample(L, 30, 55); ok(Math.abs(m.value - (200 + 50 / 254 * 54)) < 1e-6, 'bilinear halfway between two cells', m.value.toFixed(3));
ok(T.sample(L, -20, 50).status === 'outside' && T.sample(L, 50, 120).status === 'outside', 'outside the raster → outside coverage');
ok(T.sample(L, 95, 5).status === 'nodata', 'no-data cell → no data (never a value)');
ok(T.fmtValue(273.15, meta, 'C') === '0.0 °C' && T.fmtValue(250, meta, 'K') === '250.0 K', 'Kelvin / Celsius conversion', T.fmtValue(273.15, meta, 'C'));
ok(/relative/.test(T.fmtValue(0.4, { kind: 'relative' }, 'C')), 'relative dataset never shows degrees', T.fmtValue(0.4, { kind: 'relative' }, 'C'));
const p = T.profile(L, [[5, 55], [95, 55]], 10); ok(p.d.length === 10 && p.coverage === 1 && p.v[p.iMax] > p.v[p.iMin] && p.iMax > p.iMin, 'route profile along a line: samples, coverage, extremes', `${p.d.length} samples`);
const p2 = T.profile(L, [[5, 55], [150, 55]], 10); ok(p2.gaps > 0 && p2.coverage < 1, 'route leaving coverage reports gaps', `coverage ${(p2.coverage * 100).toFixed(0)}%`);
ok(JSON.stringify(T.colour(0)) === '[20,40,140]' && JSON.stringify(T.colour(1)) === '[205,30,30]', 'colour scale ends: dark blue → red');
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
