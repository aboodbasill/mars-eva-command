/* SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md. */
/* Thermal layers (data side): decoding, sampling, route profiles, colour scale and units.
 * Data come from pipeline/environment/04_thermal.py (app/data/thermal.json + thermal_<id>.png):
 *   brightness_temperature  THEMIS IR band 9 projected brightness temperature, kelvin (calibrated, one image each)
 *   relative                THEMIS controlled IR mosaics, 8-bit display product: relative intensity only, never kelvin
 * PNG encoding: R = code 0..254, value = vmin + code / 254 · (vmax − vmin); alpha 0 = no data.
 * Works in browsers (window.MarsThermal) and in Node (module.exports) for tests. */
(function (root) {
  'use strict';
  // colour scale (cold → warm): dark blue, light blue, yellow, orange, red
  const STOPS = [[0.00, [20, 40, 140]], [0.25, [90, 170, 235]], [0.50, [245, 230, 90]], [0.75, [245, 140, 40]], [1.00, [205, 30, 30]]];
  function colour(t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < STOPS.length; i++) if (t <= STOPS[i][0]) {
      const [t0, a] = STOPS[i - 1], [t1, b] = STOPS[i], f = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * f));
    }
    return STOPS.at(-1)[1].slice();
  }
  const K2C = (k) => k - 273.15;
  function fmtValue(v, ds, unit = 'K') {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    if (ds.kind !== 'brightness_temperature') return `${Math.round(v * 100)} % relative`;
    return unit === 'C' ? `${K2C(v).toFixed(1)} °C` : `${v.toFixed(1)} K`;
  }

  /** layer: { meta (thermal.json dataset), grid (thermal.json grid), codes Uint8Array, alpha Uint8Array } */
  function makeLayer(meta, grid, rgba) {
    const n = grid.ncols * grid.nrows, codes = new Uint8Array(n), alpha = new Uint8Array(n);
    for (let i = 0; i < n; i++) { codes[i] = rgba[i * 4]; alpha[i] = rgba[i * 4 + 3]; }
    return { meta, grid, codes, alpha };
  }
  const decodeCode = (L, c) => L.meta.encoding_vmin + (c / 254) * (L.meta.encoding_vmax - L.meta.encoding_vmin);
  /** Value at local metres (x east, y north): bilinear between valid cell centres; null outside coverage or on no-data. */
  function sample(L, x, y) {
    const g = L.grid, cf = (x - g.x0) / g.cell_m - 0.5, rf = (g.y0 - y) / g.cell_m - 0.5;
    if (cf < -0.5 || rf < -0.5 || cf > g.ncols - 0.5 || rf > g.nrows - 0.5) return { value: null, status: 'outside' };
    const c0 = Math.max(0, Math.min(g.ncols - 2, Math.floor(cf))), r0 = Math.max(0, Math.min(g.nrows - 2, Math.floor(rf)));
    const tc = Math.max(0, Math.min(1, cf - c0)), tr = Math.max(0, Math.min(1, rf - r0));
    let s = 0, w = 0;
    for (const [dr, dc, ww] of [[0, 0, (1 - tc) * (1 - tr)], [0, 1, tc * (1 - tr)], [1, 0, (1 - tc) * tr], [1, 1, tc * tr]]) {
      const i = (r0 + dr) * g.ncols + (c0 + dc); if (L.alpha[i] > 127 && ww > 0) { s += decodeCode(L, L.codes[i]) * ww; w += ww; }
    }
    if (w < 0.5) return { value: null, status: 'nodata' };
    return { value: s / w, status: 'ok' };
  }
  /** Profile along a polyline of local points [[x,y],...]: samples every stepM metres. */
  function profile(L, pts, stepM = 20) {
    const d = [], v = []; let acc = 0, gaps = 0, n = 0;
    const push = (x, y, dist) => { const s = sample(L, x, y); d.push(dist); v.push(s.value); n++; if (s.value === null) gaps++; };
    if (!pts.length) return null;
    push(pts[0][0], pts[0][1], 0);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], L2 = Math.hypot(bx - ax, by - ay);
      for (let s = stepM; s <= L2 + 1e-6; s += stepM) push(ax + (bx - ax) * s / L2, ay + (by - ay) * s / L2, acc + s);
      acc += L2;
    }
    let iMin = -1, iMax = -1;
    v.forEach((x, i) => { if (x === null) return; if (iMin < 0 || x < v[iMin]) iMin = i; if (iMax < 0 || x > v[iMax]) iMax = i; });
    return { d, v, lengthM: acc, coverage: n ? (n - gaps) / n : 0, gaps, iMin, iMax, min: iMin >= 0 ? v[iMin] : null, max: iMax >= 0 ? v[iMax] : null };
  }
  /** display range: the dataset's real study-area min/max (legend shows exactly these values) */
  const range = (ds) => ds.kind === 'brightness_temperature' ? [ds.stats_study_area.min, ds.stats_study_area.max] : [ds.stats_study_area.min, ds.stats_study_area.max];

  const api = { STOPS, colour, K2C, fmtValue, makeLayer, sample, profile, range, decodeCode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MarsThermal = api;
})(typeof window !== 'undefined' ? window : globalThis);
