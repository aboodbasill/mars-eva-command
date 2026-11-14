/* SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md. */
/* Mars24 sun clock — Allison & McEwen (2000), Planet. Space Sci. 48, 215; NASA GISS Mars24 algorithm.
 * Gives Mars Sol Date, LMST/LTST at a longitude, Ls (season), solar declination, sun elevation/azimuth,
 * sunrise/sunset (sun centre, flat horizon), Mars 2020 mission sol, and Earth–Mars light time.
 * Works in browsers (window.Mars24) and Node (module.exports) so it can be unit-tested against rover data. */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const TT_UTC_S = 69.184;                  // 37 leap seconds + 32.184 s (valid 2017–2026)
  const M2020_SOL_OFFSET = 52304;           // calibrated in tests against MEDA labels (local MSD - sol)
  const mod = (a, n) => ((a % n) + n) % n;

  function base(dateUtc) {
    const jdUT = dateUtc.getTime() / 86400000 + 2440587.5;
    const jdTT = jdUT + TT_UTC_S / 86400;
    const d = jdTT - 2451545.0;
    const M = mod(19.3871 + 0.52402073 * d, 360);
    const aFMS = mod(270.3871 + 0.524038496 * d, 360);
    const A = [0.0071, 0.0057, 0.0039, 0.0037, 0.0021, 0.0020, 0.0018];
    const tau = [2.2353, 2.7543, 1.1177, 15.7866, 2.1354, 2.4694, 32.8493];
    const phi = [49.409, 168.173, 191.837, 21.736, 15.704, 95.528, 49.095];
    let pbs = 0;
    for (let i = 0; i < 7; i++) pbs += A[i] * Math.cos(D2R * ((0.985626 * d) / tau[i] + phi[i]));
    const Mr = M * D2R;
    const eoc = (10.691 + 3.0e-7 * d) * Math.sin(Mr) + 0.623 * Math.sin(2 * Mr) + 0.050 * Math.sin(3 * Mr)
      + 0.005 * Math.sin(4 * Mr) + 0.0005 * Math.sin(5 * Mr) + pbs;
    const Ls = mod(aFMS + eoc, 360);
    const eot = 2.861 * Math.sin(2 * Ls * D2R) - 0.071 * Math.sin(4 * Ls * D2R) + 0.002 * Math.sin(6 * Ls * D2R) - eoc;   // deg
    const msd = (jdTT - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626;
    const mst = mod(24 * msd, 24);
    const decl = Math.asin(0.42565 * Math.sin(Ls * D2R)) * R2D + 0.25 * Math.sin(Ls * D2R);
    return { jdUT, jdTT, d, M, Ls, eot, msd, mst, decl, eoc };
  }

  /** Full solar state at a site (lat °N, lon °E, planetocentric). */
  function at(dateUtc, lat = 18.4447, lonE = 77.4508) {
    const b = base(dateUtc);
    const lmst = mod(b.mst + lonE / 15, 24);
    const ltst = mod(lmst + b.eot / 15, 24);
    // hour angle (deg) from local true solar time; 0 at local noon
    const H = (ltst - 12) * 15;
    const la = lat * D2R, de = b.decl * D2R, h = H * D2R;
    const cosZ = Math.sin(la) * Math.sin(de) + Math.cos(la) * Math.cos(de) * Math.cos(h);
    const elev = 90 - Math.acos(Math.max(-1, Math.min(1, cosZ))) * R2D;
    // azimuth clockwise from north (standard spherical-astronomy form; tested: due south at noon, east in the morning)
    const az = mod(Math.atan2(-Math.cos(de) * Math.sin(h), Math.sin(de) * Math.cos(la) - Math.cos(de) * Math.cos(h) * Math.sin(la)) * R2D, 360);
    const localMsd = b.msd + lonE / 360;
    return {
      utc: dateUtc, msd: b.msd, Ls: b.Ls, decl: b.decl, eotDeg: b.eot, lmst, ltst, elev, az,
      sol: Math.floor(localMsd) - M2020_SOL_OFFSET, lightMin: lightTimeMin(dateUtc, b),
      season: season(b.Ls), dustSeason: b.Ls >= 180 && b.Ls < 360,
    };
  }

  function season(Ls) {
    return Ls < 90 ? 'northern spring' : Ls < 180 ? 'northern summer' : Ls < 270 ? 'northern autumn' : 'northern winter';
  }

  /** One-way Earth–Mars light time (minutes); heliocentric positions, latitudes neglected (<1 % error). */
  function lightTimeMin(dateUtc, b = base(dateUtc)) {
    const d = b.jdUT - 2451545.0;
    const rM = 1.52367934 * (1.00436 - 0.09309 * Math.cos(b.M * D2R) - 0.004336 * Math.cos(2 * b.M * D2R)
      - 0.00031 * Math.cos(3 * b.M * D2R) - 0.00003 * Math.cos(4 * b.M * D2R));
    const lM = b.Ls + 85.061 - 0.015 * Math.sin((71 + 2 * b.Ls) * D2R) - 5.5e-6 * b.d;      // heliocentric longitude of Mars
    const g = mod(357.529 + 0.98560028 * d, 360), q = mod(280.459 + 0.98564736 * d, 360);
    const sunLon = q + 1.915 * Math.sin(g * D2R) + 0.020 * Math.sin(2 * g * D2R);          // geocentric Sun
    const lE = sunLon + 180, rE = 1.00014 - 0.01671 * Math.cos(g * D2R) - 0.00014 * Math.cos(2 * g * D2R);
    const dist = Math.sqrt(rM * rM + rE * rE - 2 * rM * rE * Math.cos((lM - lE) * D2R));
    return (dist * 149597870.7) / 299792.458 / 60;
  }

  /** Earth UTC Date at which the given LTST occurs on the Mars 2020 sol `sol` (iterative). */
  function utcForLtst(sol, ltstH, lat = 18.4447, lonE = 77.4508) {
    // first guess from MSD: local MSD = sol + offset + ltst/24 (approx, eot small)
    const msd = sol + M2020_SOL_OFFSET + ltstH / 24 - lonE / 360;
    let jdTT = (msd - 44796.0 + 0.0009626) * 1.0274912517 + 2451549.5;
    let t = new Date((jdTT - TT_UTC_S / 86400 - 2440587.5) * 86400000);
    for (let i = 0; i < 4; i++) {
      const s = at(t, lat, lonE);
      let dh = ltstH - s.ltst;
      if (dh > 12) dh -= 24; if (dh < -12) dh += 24;
      t = new Date(t.getTime() + dh * 3600 * 1000 * 1.0274912517);
    }
    return t;
  }

  /** Sunrise / sunset LTST hours for the sol containing dateUtc (sun centre crosses flat horizon). */
  function sunTimes(dateUtc, lat = 18.4447, lonE = 77.4508) {
    const s0 = at(dateUtc, lat, lonE);
    const t0 = utcForLtst(s0.sol, 0, lat, lonE).getTime();
    const solMs = 88775244.147;
    let prev = at(new Date(t0), lat, lonE), rise = null, set = null;
    for (let k = 1; k <= 1440; k++) {
      const cur = at(new Date(t0 + (k / 1440) * solMs), lat, lonE);
      if (prev.elev < 0 && cur.elev >= 0 && rise === null) rise = interp(prev, cur);
      if (prev.elev >= 0 && cur.elev < 0) set = interp(prev, cur);
      prev = cur;
    }
    function interp(a, c) { const f = a.elev / (a.elev - c.elev); let h = a.ltst + f * mod(c.ltst - a.ltst, 24); return mod(h, 24); }
    return { sol: s0.sol, sunriseLtst: rise, sunsetLtst: set, daylightH: rise !== null && set !== null ? set - rise : null };
  }

  const fmtH = (h) => { if (h === null || h === undefined) return '—'; const m = Math.round(mod(h, 24) * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  const api = { at, base, sunTimes, utcForLtst, lightTimeMin, fmtH, M2020_SOL_OFFSET };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Mars24 = api;
})(typeof window !== 'undefined' ? window : globalThis);
