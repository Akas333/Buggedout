# Dueline: Academic Workload & Assignment Planner

**Live demo: https://akas333.github.io/Buggedout/**

**Bugged Out! 2026, Round 1, PS 04.** Paste your deadlines and get a plan you can actually follow.

Students get deadlines from syllabi, VTOP, classroom announcements and WhatsApp groups. Calendar apps record the dates. They don't account for effort, dependencies, free time, or the fact that things go wrong. Dueline turns a messy text dump into a prioritised, replanning study schedule and explains every decision it makes.

## Run it

No install needed. It's plain HTML and JavaScript. Pasting text works fully offline; uploading files, screenshots and links uses free libraries and APIs (see below).

```bash
open index.html            # or double-click it
# or serve it:
python3 -m http.server 8765   # then visit http://localhost:8765
```

A sample VIT-style semester loads on first open. Use **New deadline** to add one deadline or paste a whole syllabus. Reproduce the evaluation with Node 18+:

```bash
node eval/tune.js       # tunes settings on seeds 1-30 and writes eval/tuned.json
node eval/run_eval.js   # scores 50 held-out semesters (seeds 1001-1050)
```

## What it does (mapped to the brief)

| Requirement | How Dueline does it | Where |
|---|---|---|
| 1. Extract academic tasks | Parses pasted text line by line: dates (`20 Oct`, `Oct 22`, `18/10`, `Friday`, `tomorrow`), task type (DA, CAT, FAT, quiz, lab, project review…), grade weight `(10%)`, stated effort `~6h`, and course headers. **Dependencies** come from sequences (`Review 1 → Review 2`, `DA 1 → DA 2`) and wording (`builds on`, `after`, `requires`). Each task keeps its **source line** and a confidence level. Lines with no date are listed as skipped and never guessed. | `extractTasks` in `js/engine.js` |
| 2. Prioritise workload | Score out of 100 = urgency (hours needed ÷ free hours before the due date, 40) + grade weight (25) + effort left (15) + how much other work it unblocks (20). Each part is shown with a sentence explaining it. | `prioritize` |
| 3. Personalised schedule | Free hours per weekday plus busy days. Planner: earliest planning deadline first, finish N days early, prerequisites pulled earlier, ≤2 h sessions, mixes subjects when there's slack, clock-timed agenda. | `planCrunch`, Home tab, Schedule tab (month, week and day calendar with search and course filters) |
| 4. Adapt to changes | "Skip today", "Mark today complete", "It's bigger: +2h", the New deadline pop-up (add one or paste many), surprise tasks, deadline edits and busy days all trigger a replan and a **change log** of what moved and why. A *reality check* multiplier learns how much longer than estimated your tasks really take. | `replanLog`, `learnedRatio` in `js/app.js` |
| 5. Track progress | Per-course progress bars, a semester health ring, next-deadline countdown, at-risk alerts, a Workload view (a GitHub-style study activity graph of logged and planned hours, daily hours vs free time, hours left per course), and a task board (To do / In progress / At risk / Done) with drag-and-drop. The planner fills *At risk* automatically. | Home, Tasks board |
| 6. Explain recommendations | Every task opens to its priority reasons, its planned sessions, the evidence line it came from, and how far before the deadline it finishes. Every replan lists the tasks that moved. | Task drawer, change log |

## Evaluation: 50 unseen semesters

`eval/run_eval.js` generates random semesters: 5 courses, 12–17 tasks, bunched exam weeks, and project reviews that depend on each other. It then **simulates living through them day by day**. Every policy replans each morning using only what a student would know that day:

- **True effort ≠ estimate.** Overrun is lognormal with a median of 1.25× (the planning fallacy), and it only shows up once the estimate runs out.
- **Surprises:** a new assignment announced mid-way, a deadline pulled 3 days earlier, and 2 sick days.
- Settings were tuned on **seeds 1–30 only** (`eval/tune.js` → `eval/tuned.json`: buffer 2 days, headroom 2). The **50 test seeds 1001–1050 were never used for tuning.** The app ships with the same settings.

| Mean per semester | **Dueline** | Last-minute student | Grind: every free hour, earliest due first |
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
- Against how students actually work (last minute), Dueline raises on-time completion from about 22% to 78%.
- Against a perfect grinder who uses every free hour, Dueline gives up about 3 points of on-time rate. In return it has 28% fewer crunch days and the steadiest daily load. Nobody really grinds every free hour.
- All of this comes from simulated semesters with stated assumptions, not real students.

Light and dark themes are both supported: the app follows your system setting, and the sun/moon button switches manually.

## Gemma 4: messy text and screenshots → deadlines

**Extract with Gemma 4** (in the New deadline pop-up, *Paste or upload*) sends the pasted text, plus any screenshots you added *as images*, to **Gemma 4** (`gemma-4-26b-a4b-it`, falling back to `gemma-4-31b-it`) through the Gemini API. Gemma returns structured deadlines: title, course, type, due date, stated effort and weight, dependencies, and the exact words it read them from.

Nothing Gemma says is trusted blindly:
- **Quote check.** Each item's quoted source must appear word-for-word in your text. If it does, the task is *high* confidence. If not (for example it was read from an image), it's added as *low* confidence and flagged "check this" in the Tasks tab.
- **Date check.** Items without a valid date, or with a date outside a sane range, are skipped and listed.
- **Same pipeline.** Gemma's tasks go through the same planner, priorities and replanning as the rule-based extractor, which still works offline without a key.

**API key**, two options:
- **Vercel:** set `GEMINI_API_KEY` in Project → Settings → Environment Variables. `api/gemma.js` is a serverless proxy that keeps the key server-side, so visitors need no key.
- **Anywhere else** (GitHub Pages, a local file): paste a free key from [Google AI Studio](https://aistudio.google.com/apikey) into the key field. It's stored only in that browser.

On Google's free tier, inputs may be used to improve Google's products.

## Import from files, screenshots and links

The **Paste or upload** tab in the New deadline pop-up accepts the curriculum, schedule, course plan or announcement in almost any form except video and audio. Drop files, browse, paste a screenshot with ⌘V / Ctrl+V, or enter a link. Each source becomes text lines under a `--- from <file> ---` marker in the box, so you can check and fix them before **Extract deadlines**. The same rule-based extractor then runs, and every task remembers which file it came from.

| Source | How it's read | Network |
|---|---|---|
| Plain text, Markdown, CSV/TSV, calendar `.ics`, HTML, RTF, JSON, email `.eml` | Parsed in the browser | None |
| Screenshots and photos (PNG, JPG, WebP, GIF, BMP, TIFF) | Tesseract.js OCR **in your browser**: small screenshots are upscaled and dark-mode ones inverted first. If it can't load, the image goes to the free **OCR.space** API | CDN once, or OCR.space |
| PDF | pdf.js text, with table columns kept as `a \| b \| c`. Scanned pages are rendered and OCR'd | CDN once |
| Word `.docx`, PowerPoint `.pptx`, OpenDocument `.odt/.odp` | JSZip + XML, with table rows kept on one line | CDN once |
| Excel `.xlsx/.xls/.ods` | SheetJS, every sheet | CDN once |
| Links (course pages, PDFs, public Google Docs/Sheets/Slides/Drive files) | Fetched directly, then via **allorigins.win**, then **r.jina.ai** (free, no key). Google links are rewritten to their export URLs | Yes |

Re-extracting after an import keeps progress on tasks it finds again, and keeps deadlines you added by hand. Files stay in your browser unless local OCR fails (OCR.space) or you import a link (the public readers fetch it).

## Robustness and edge cases handled

- Lines with no date are skipped and shown to the user, never guessed. Weekday-only dates are marked medium confidence.
- Unknown grade weight is assumed to be 10% and labelled as an assumption.
- Overloaded weeks: tasks that can't fit are flagged *at risk* with the shortfall, and the plan suggests adding time, asking for an extension, or cutting scope.
- Tasks past their deadline are still scheduled, but marked LATE.
- State is saved in the browser. If storage is blocked, the app still works.

## Project structure

```
index.html          UI shell (Home, Schedule, Priorities, Tasks board/table, Workload, Results). Light and dark themes.
css/style.css       styles
js/engine.js        extraction, priority, planners, baselines, metrics, simulator (browser + Node)
js/app.js           UI, replanning, change log, learning
js/importer.js      files, screenshots (OCR) and links → text for the extractor
js/gemma.js         Gemma 4 extraction (Gemini API), with quote and date verification
api/gemma.js        Vercel serverless proxy that keeps the Gemini key server-side
js/sample.js        demo semester text
js/eval_results.js  generated by eval/run_eval.js and shown in the Proof tab
eval/run_eval.js    held-out evaluation
eval/tune.js        tuning on separate seeds
```

## License

MIT. See [LICENSE](LICENSE).

## Limitations and next steps

- Extraction is rule-based, so it works offline. A weekly class timetable becomes text, but its class hours are not yet turned into busy time automatically. An LLM extractor could handle free-form announcements, with the same "show the source line" rule.
- No real LMS or VTOP integration yet. Next steps are calendar export (.ics) and reminders.
- The evaluation uses simulated semesters. The next step is a pilot with real students' logged hours.

Built solo on 15 Oct 2026 at Bugged Out!, IEEE RAS VITC.
