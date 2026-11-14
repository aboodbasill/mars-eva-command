// SI disclosure: generated with the help of an AI coding assistant (Claude, Anthropic) from the team's plan; reviewed by the team. See SI_DISCLOSURE.md.
// Helper for tests/test_route_js.py: runs the browser planner (app/game/route.js) on the exported grids.
// Usage: node tests/route_cli.js '[[r0,c0,r1,c1,theta], ...]'  -> JSON [{cost, lengthM, maxSlope} | {error}]
const fs = require('fs'), path = require('path');
const R = require(path.join(__dirname, '..', 'app', 'game', 'route.js'));
const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'data', 'grids.js'), 'utf8');
const G = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
const dec = (g) => Uint8Array.from(Buffer.from(g.b64, 'base64'));
const g5 = G.grid_5m, grid = R.makeGrid(dec(G.grids.slope), dec(G.grids.provenance), g5.ncols, g5.nrows, g5.cell_m);
const out = JSON.parse(process.argv[2]).map(([r0, c0, r1, c1, th]) => { const p = R.astar(grid, r0, c0, r1, c1, th); return p.error ? p : { cost: p.cost, lengthM: p.lengthM, maxSlope: p.maxSlope }; });
process.stdout.write(JSON.stringify(out));
