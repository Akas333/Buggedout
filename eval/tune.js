/* Tune planner settings on tuning seeds 1-30 only: node eval/tune.js
 * Objective: highest on-time %, then fewest crunch days. Writes eval/tuned.json. */
const fs = require('fs');
const path = require('path');
const C = require('../js/engine.js');
fs.existsSync(path.join(__dirname, 'tuned.json')) || fs.writeFileSync(path.join(__dirname, 'tuned.json'), '{}');
const { makeScenario } = require('./run_eval.js');

const seeds = Array.from({ length: 30 }, (_, i) => 1 + i);
const scns = seeds.map(makeScenario);
let best = null;
for (const headroom of [1.15, 1.3, 1.5, 2]) for (const bufferDays of [1, 2]) for (const prior of [1, 1.15, 1.3]) {
  const cfg = { headroom, bufferDays, prior };
  let onTime = 0, crunch = 0;
  scns.forEach((s) => { const m = C.simulate(s, (t, st) => C.planCrunch(t, { ...st, ...cfg }), { learn: true, prior }); onTime += m.onTimePct; crunch += m.crunchDays; });
  const score = [C.round(onTime / scns.length, 2), C.round(crunch / scns.length, 2)];
  console.log(JSON.stringify(cfg), 'onTime', score[0], 'crunchDays', score[1]);
  if (!best || score[0] > best.score[0] + 0.5 || (Math.abs(score[0] - best.score[0]) <= 0.5 && score[1] < best.score[1])) best = { cfg, score };
}
fs.writeFileSync(path.join(__dirname, 'tuned.json'), JSON.stringify(best.cfg, null, 1));
console.log('\nchosen', best);
