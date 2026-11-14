// SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
// Node test for app/mars24.js against: Allison & McEwen worked example, MEDA PDS4 label times (sol + LMST),
// NASA's landing-day light time, and sun direction sanity. Run: node tests/test_mars24.js
const M = require('../app/mars24.js');
const fs = require('fs'), path = require('path');
let fail = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fail++; };
// 1. Worked example: TT 2000-01-06 00:00 -> Ls 277.18758
const ex = M.base(new Date(Date.UTC(2000, 0, 6) - 64184));
ok(Math.abs(ex.Ls - 277.18758) < 0.002, `Ls worked example ${ex.Ls.toFixed(5)}`);
// 2. MEDA labels: first record of sol N is LMST ~00:00 of sol N
const env = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'metadata', 'environment_meda.json')));
for (const s of env.sols) {
  // label start LMST is 00:00:00.0-0.4 s of sol N; compare LMST in seconds and the sol one minute later
  const a = M.at(new Date(s.utc_start), 18.4528, 77.4082);
  const sec = (a.lmst > 12 ? a.lmst - 24 : a.lmst) * 3600;
  const a1 = M.at(new Date(new Date(s.utc_start).getTime() + 60000), 18.4528, 77.4082);
  ok(a1.sol === s.sol && Math.abs(sec) < 20, `MEDA sol ${s.sol}: computed sol ${a1.sol}, LMST offset ${sec.toFixed(1)} s at label start`);
}
// 3. Landing 2021-02-18 20:55 UTC: NASA quoted ~11 min 22 s one-way light time
const lt = M.lightTimeMin(new Date(Date.UTC(2021, 1, 18, 20, 55)));
ok(Math.abs(lt - 11.37) < 0.2, `landing-day light time ${lt.toFixed(2)} min (NASA 11.37)`);
// 4. Sun direction: near noon LTST the sun is due south-ish (decl < lat), morning in the east
const noon = M.at(M.utcForLtst(670, 12)), morn = M.at(M.utcForLtst(670, 8));
ok(Math.abs(noon.ltst - 12) < 0.02, `utcForLtst round trip ${M.fmtH(noon.ltst)}`);
ok(noon.az > 150 && noon.az < 210 && noon.elev > 60, `noon sun az ${noon.az.toFixed(1)} el ${noon.elev.toFixed(1)}`);
ok(morn.az > 70 && morn.az < 110 && morn.elev > 0, `08:00 sun az ${morn.az.toFixed(1)} el ${morn.elev.toFixed(1)}`);
// 5. Sunrise/sunset plausible (~06:00/18:00 near equinox)
const st = M.sunTimes(M.utcForLtst(670, 12));
ok(st.sunriseLtst > 5.5 && st.sunriseLtst < 6.5 && st.sunsetLtst > 17.5 && st.sunsetLtst < 18.5, `sol 670 sunrise ${M.fmtH(st.sunriseLtst)} sunset ${M.fmtH(st.sunsetLtst)}`);
process.exit(fail ? 1 : 0);
