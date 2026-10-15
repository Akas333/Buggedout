# Crunch: Academic Workload & Assignment Planner

**Bugged Out! 2026, Round 1, PS 04.** Paste your deadlines and get a plan you can actually follow.

Students get deadlines from syllabi, VTOP, classroom announcements and WhatsApp groups. Calendar apps record the dates. They don't account for effort, dependencies, free time, or the fact that things go wrong. Crunch turns a messy text dump into a prioritised, replanning study schedule and explains every decision it makes.

## Run it

No install and no network needed. It's plain HTML and JavaScript.

```bash
open index.html            # or double-click it
# or serve it:
python3 -m http.server 8765   # then visit http://localhost:8765
```

Click **Demo semester** to load a sample VIT-style semester. Reproduce the evaluation with Node 18+:

```bash
node eval/tune.js       # tunes settings on seeds 1-30 and writes eval/tuned.json
node eval/run_eval.js   # scores 50 held-out semesters (seeds 1001-1050)
```

## What it does (mapped to the brief)

| Requirement | How Crunch does it | Where |
|---|---|---|
| 1. Extract academic tasks | Parses pasted text line by line: dates (`20 Oct`, `Oct 22`, `18/10`, `Friday`, `tomorrow`), task type (DA, CAT, FAT, quiz, lab, project review…), grade weight `(10%)`, stated effort `~6h`, and course headers. **Dependencies** come from sequences (`Review 1 → Review 2`, `DA 1 → DA 2`) and wording (`builds on`, `after`, `requires`). Each task keeps its **source line** and a confidence level. Lines with no date are listed as skipped and never guessed. | `extractTasks` in `js/engine.js` |
| 2. Prioritise workload | Score out of 100 = urgency (hours needed ÷ free hours before the due date, 40) + grade weight (25) + effort left (15) + how much other work it unblocks (20). Each part is shown with a sentence explaining it. | `prioritize` |
| 3. Personalised schedule | Free hours per weekday plus busy days. Planner: earliest planning deadline first, finish N days early, prerequisites pulled earlier, ≤2 h sessions, mixes subjects when there's slack, clock-timed agenda. | `planCrunch`, Home tab, Schedule tab |
| 4. Adapt to changes | "I skipped today", "Finished today's plan", "It's bigger: +2h", surprise assignments, deadline edits and busy days all trigger a replan and a **change log** of what moved and why. A *reality check* multiplier learns how much longer than estimated your tasks really take. | `replanLog`, `learnedRatio` in `js/app.js` |
| 5. Track progress | Per-course progress bars, a semester health ring, next-deadline countdown, at-risk alerts, and a pressure map of daily load against free time with a warning for every week above 75%. | Home, Pressure map |
| 6. Explain recommendations | Every task opens to its priority reasons, its planned sessions, the evidence line it came from, and how far before the deadline it finishes. Every replan lists the tasks that moved. | Task drawer, change log |

## Evaluation: 50 unseen semesters

`eval/run_eval.js` generates random semesters: 5 courses, 12–17 tasks, bunched exam weeks, and project reviews that depend on each other. It then **simulates living through them day by day**. Every policy replans each morning using only what a student would know that day:

- **True effort ≠ estimate.** Overrun is lognormal with a median of 1.25× (the planning fallacy), and it only shows up once the estimate runs out.
- **Surprises:** a new assignment announced mid-way, a deadline pulled 3 days earlier, and 2 sick days.
- Settings were tuned on **seeds 1–30 only** (`eval/tune.js` → `eval/tuned.json`: buffer 2 days, headroom 2). The **50 test seeds 1001–1050 were never used for tuning.** The app ships with the same settings.

| Mean per semester | **Crunch** | Last-minute student | Grind: every free hour, earliest due first |
|---|---|---|---|
| Tasks finished on time | **78.0%** | 21.7% | 80.8% |
| Work left undone at deadlines | **1.2 h** | 36.7 h | 1.2 h |
| Crunch days (≥7 h) | 1.3 | 0.96* | 1.8 |
| Daily load std. dev. | **1.90 h** | 2.01 h | 2.11 h |
| Peak day | **6.8 h** | 6.9 h | 6.9 h |
| Avg. days finished early | 4.4 | 2.1 | 5.5 |
| Started Part 2 before Part 1 | 0.06 | 0.18 | 0.04 |

\*The last-minute student has few crunch days because the work never gets done (36.7 h left undone).

**Honest reading:**
- Against how students actually work (last minute), Crunch raises on-time completion from about 22% to 78%.
- Against a perfect grinder who uses every free hour, Crunch gives up about 3 points of on-time rate. In return it has 28% fewer crunch days and the steadiest daily load. Nobody really grinds every free hour.
- All of this comes from simulated semesters with stated assumptions, not real students.

## Robustness and edge cases handled

- Lines with no date are skipped and shown to the user, never guessed. Weekday-only dates are marked medium confidence.
- Unknown grade weight is assumed to be 10% and labelled as an assumption.
- Overloaded weeks: tasks that can't fit are flagged *at risk* with the shortfall, and the plan suggests adding time, asking for an extension, or cutting scope.
- Tasks past their deadline are still scheduled, but marked LATE.
- State is saved in the browser. If storage is blocked, the app still works.

## Project structure

```
index.html          UI shell (Home, Schedule, Priorities, Tasks, Pressure map, Proof)
css/style.css       styles
js/engine.js        extraction, priority, planners, baselines, metrics, simulator (browser + Node)
js/app.js           UI, replanning, change log, learning
js/sample.js        demo semester text
js/eval_results.js  generated by eval/run_eval.js and shown in the Proof tab
eval/run_eval.js    held-out evaluation
eval/tune.js        tuning on separate seeds
```

## Limitations and next steps

- Extraction is rule-based, so it works offline. An LLM extractor could handle free-form announcements, with the same "show the source line" rule.
- No real LMS or VTOP integration yet. Next steps are calendar export (.ics) and reminders.
- The evaluation uses simulated semesters. The next step is a pilot with real students' logged hours.

Built solo on 15 Oct 2026 at Bugged Out!, IEEE RAS VITC.
