/* Held-out evaluation: node eval/run_eval.js
 *
 * Generates random semesters from fixed seeds. The planner parameters (bufferDays=1,
 * sessionMax=2, headroom=1.15) were fixed before these seeds were run, and nothing
 * was tuned on them. Each scenario has:
 *  - 5 courses and 12-17 tasks over ~5 weeks, with exam weeks bunched together
 *  - true effort = estimate x overrun (lognormal, median 1.25: students underestimate)
 *  - surprises: a new task announced mid-way, a deadline pulled earlier, 2 sick days
 * Every policy replans each day from what a student would know on that day.
 */
const fs = require('fs');
const path = require('path');
const C = require('../js/engine.js');

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const normal = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

function makeScenario(seed) {
  const r = rng(seed);
  const start = C.toDay('2026-10-15');
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const types = ['assignment', 'assignment', 'lab', 'lab', 'quiz', 'report', 'presentation', 'project', 'midterm'];
  const tasks = [];
  const n = 11 + Math.floor(r() * 6);
  const examWeek = start + 14 + Math.floor(r() * 7);
  for (let i = 0; i < n; i++) {
    const type = i < 3 ? 'midterm' : pick(types);
    const info = C.TYPES.find((t) => t.type === type);
    const est = Math.max(1, Math.round(info.effort * (0.6 + r() * 0.8) * 2) / 2);
    // Earliest due date leaves room for the estimate at ~2.5 h/day, as real syllabi do.
    const due = type === 'midterm' ? examWeek + Math.floor(r() * 4) : start + Math.ceil(est / 2.5) + 1 + Math.floor(r() * 34);
    const overrun = Math.exp(Math.log(1.25) + 0.3 * normal(r));
    tasks.push({ id: `s${seed}_${i}`, title: `${info.label} ${i}`, course: `C${1 + (i % 5)}`, type, due: C.fromDay(due),
      effortH: est, doneH: 0, weight: 5 + Math.floor(r() * 15), deps: [], trueEffortH: C.round(est * overrun, 2) });
  }
  // Project pairs: review 2 depends on review 1.
  const projects = tasks.filter((t) => t.type === 'project').sort((a, b) => a.due.localeCompare(b.due));
  for (let k = 1; k < projects.length; k += 2) projects[k].deps.push(projects[k - 1].id);
  const availability = [4 + r() * 4, 2 + r() * 2, 2 + r() * 2, 2 + r() * 2, 2 + r() * 2, 1.5 + r() * 2, 4 + r() * 4].map((x) => C.round(x, 1));
  const surpriseDay = start + 5 + Math.floor(r() * 10);
  const surprise = { id: `s${seed}_new`, title: 'Surprise assignment', course: 'C1', type: 'assignment',
    due: C.fromDay(surpriseDay + 4 + Math.floor(r() * 3)), effortH: 5, doneH: 0, weight: 10, deps: [], trueEffortH: C.round(5 * Math.exp(Math.log(1.25) + 0.3 * normal(r)), 2) };
  tasks.push(surprise);
  const moved = pick(tasks.filter((t) => C.toDay(t.due) > start + 12 && t !== surprise));
  return {
    seed,
    settings: { today: C.fromDay(start), availability, commitments: [], bufferDays: 1, sessionMax: 2 },
    tasks,
    arrivals: [{ on: C.fromDay(surpriseDay), task: surprise }],
    events: [
      { on: C.fromDay(start + 8), kind: 'deadline', id: moved.id, due: C.fromDay(C.toDay(moved.due) - 3) },
      { on: C.fromDay(start + 10 + Math.floor(r() * 8)), kind: 'sick', days: 2 },
    ],
  };
}

// Chosen by eval/tune.js on tuning seeds 1-30, never on the held-out seeds.
const TUNED = JSON.parse(fs.readFileSync(path.join(__dirname, 'tuned.json'), 'utf8'));

const POLICIES = {
  crunch: { label: 'Crunch (ours)', fn: (t, s) => C.planCrunch(t, { ...s, ...TUNED }), learn: true, prior: TUNED.prior },
  duedate: { label: 'Grind: every free hour', fn: C.planDueDate, learn: false },
  lastminute: { label: 'Last-minute student', fn: C.planLastMinute, learn: false },
};

module.exports = { makeScenario };
if (require.main !== module) return;

const SEEDS = Array.from({ length: 50 }, (_, i) => 1001 + i); // held-out
const rows = [];
for (const seed of SEEDS) {
  const scn = makeScenario(seed);
  const row = { seed, tasks: scn.tasks.length };
  for (const [k, p] of Object.entries(POLICIES)) row[k] = C.simulate(scn, p.fn, { learn: p.learn, prior: p.prior });
  rows.push(row);
}

const keys = ['onTimePct', 'missed', 'unfinishedHours', 'crunchDays', 'peakDay', 'loadSd', 'avgBufferDays', 'depViolations'];
const summary = {};
for (const k of Object.keys(POLICIES)) {
  summary[k] = { label: POLICIES[k].label };
  keys.forEach((m) => { summary[k][m] = C.round(rows.reduce((a, r) => a + r[k][m], 0) / rows.length, 2); });
  summary[k].scenariosWithMiss = rows.filter((r) => r[k].missed > 0).length;
}
const out = {
  generated: new Date().toISOString(), scenarios: rows.length, seeds: `${SEEDS[0]}-${SEEDS[SEEDS.length - 1]}`,
  method: 'Daily replanning simulation. True effort = estimate x lognormal overrun (median 1.25x); one surprise task, one deadline pulled 3 days earlier, two sick days per scenario.',
  summary, rows,
};
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(__dirname, '..', 'js', 'eval_results.js'), `window.CRUNCH_EVAL = ${JSON.stringify(out)};\n`);

const pad = (s, n) => String(s).padEnd(n);
console.log(`Held-out evaluation: ${rows.length} scenarios (seeds ${out.seeds})\n`);
console.log(pad('metric (mean per scenario)', 28) + Object.values(POLICIES).map((p) => pad(p.label, 22)).join(''));
[...keys, 'scenariosWithMiss'].forEach((m) => console.log(pad(m, 28) + Object.keys(POLICIES).map((k) => pad(summary[k][m], 22)).join('')));
