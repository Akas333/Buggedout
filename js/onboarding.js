/* Dueline onboarding: a first-run setup that ends on a full dashboard, never an empty one.
 * Three short steps (courses, deadlines, study time) beside a live preview of the dashboard
 * that fills in as the student goes. It uses the same extractor, importer and Gemma 4 reader
 * as the New deadline pop-up and hands app.js a finished { tasks, availability } bundle.
 * Students with nothing to paste can start from a typical semester with estimated dates. */
(function () {
  'use strict';
  const C = window.Crunch;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const LOGO = '<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="58 100" stroke-linecap="round" transform="rotate(-210 16 16)"/><circle cx="16" cy="16" r="4" fill="currentColor"/></svg>';
  const STEPS = [['courses', 'Courses'], ['deadlines', 'Deadlines'], ['hours', 'Study time']];
  const PRESETS = {
    light: { label: 'Light', sub: '2h on weekdays, 4h at weekends', wk: 2, we: 4 },
    steady: { label: 'Steady', sub: '3h on weekdays, 6h at weekends', wk: 3, we: 6 },
    intense: { label: 'All in', sub: '4h on weekdays, 8h at weekends', wk: 4, we: 8 },
  };
  const presetHours = (p) => [p.we, p.wk, p.wk, p.wk, p.wk, p.wk, p.we]; // Sun..Sat, like the engine
  const SHOWN_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun on screen
  // Short names students use in messages ("DBMS DA due Friday") and the course words they stand for.
  const ALIASES = { dbms: 'database', os: 'operating system', cn: 'network', daa: 'algorithm', dsa: 'data structure', oop: 'object oriented', oops: 'object oriented',
    toc: 'theory of computation', se: 'software engineering', coa: 'computer organi', ai: 'artificial intelligence', ml: 'machine learning', dm: 'discrete math', iot: 'internet of things', cd: 'compiler' };
  const GENERIC = new Set(['introduction', 'engineering', 'systems', 'system', 'laboratory', 'principles', 'fundamentals', 'applied', 'advanced', 'theory', 'design',
    'analysis', 'management', 'programming', 'technology', 'studies', 'skills', 'practice', 'methods']);
  const isPhone = () => window.matchMedia('(max-width: 760px)').matches;
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Only rows that just appeared animate in, so re-rendering on every keystroke doesn't flicker.
  const fresh = (key) => { if (ob.seen.has(key)) return ''; ob.seen.add(key); return ' new'; };

  let opts = null, root = null, ob = null, rulesTimer = null, buildTimer = null, lastFocus = null;

  /* ---------- courses ---------- */
  const CODE_RE = /^([A-Z]{2,5}\s?\d{3,4}[A-Z]?)\b\s*[-–:]?\s*(.*)$/i;
  function tidyCourse(raw) {
    const s = raw.replace(/\s+/g, ' ').trim().replace(/^[-•*·\d.)\s]+(?=[A-Za-z])/, '');
    const m = s.match(CODE_RE);
    return (m && m[2] ? `${m[1].toUpperCase().replace(/\s/g, '')} - ${m[2]}` : s).slice(0, 48);
  }
  function parts(c) {
    const m = c.split(/\s[-–:]\s/);
    return m.length > 1 ? { code: m[0], name: m.slice(1).join(' - ') } : { code: (c.match(/^[A-Z]{2,5}\s?\d{3,4}[A-Z]?$/) || [''])[0], name: c };
  }
  const words = (name) => name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(and|of|the|&|for|in|to|with)$/i.test(w));
  const acronym = (name) => words(name).map((w) => w[0]).join('').toUpperCase();
  function shortLabel(c) {
    const { code, name } = parts(c);
    if (code) return code;
    const a = acronym(name);
    return a.length >= 2 ? a : name.split(/\s+/)[0].slice(0, 12);
  }
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Which of the student's courses does this deadline belong to? Code, then name, then short forms.
  function matchCourse(t) {
    if (!ob.courses.length) return null;
    const hay = ` ${[t.course, t.title, t.source && t.source.text].filter(Boolean).join(' ')} `.toLowerCase();
    const has = (w) => new RegExp(`(^|[^a-z0-9])${reEsc(w.toLowerCase())}([^a-z0-9]|$)`).test(hay);
    const P = ob.courses.map((c) => ({ c, ...parts(c), lname: parts(c).name.toLowerCase() }));
    const hit = P.find((p) => p.code && has(p.code))
      || P.find((p) => p.lname.length > 3 && hay.includes(p.lname))
      || P.find((p) => { const a = acronym(p.name); return a.length >= 2 && has(a); })
      || P.find((p) => Object.entries(ALIASES).some(([k, v]) => has(k) && p.lname.includes(v)))
      || P.find((p) => p.lname.split(/[^a-z]+/).some((w) => w.length >= 5 && !GENERIC.has(w) && has(w)));
    return hit ? hit.c : null;
  }
  function addCourses(text) {
    const before = ob.courses.length;
    text.split(/\r?\n|;/).map(tidyCourse).filter((c) => c.length > 1).forEach((c) => {
      if (!ob.courses.some((x) => x.toLowerCase() === c.toLowerCase())) ob.courses.push(c);
    });
    return ob.courses.length - before;
  }

  /* ---------- deadlines: found in text, estimated, picked ---------- */
  const keyOf = (t) => `${t.title}|${t.due}`.toLowerCase();
  const courseOf = (t) => ob.assign.get(keyOf(t)) || (t.estimated ? t.course : matchCourse(t) || t.course);
  const todayN = () => C.toDay(ob.today);
  function flags(list) {
    // Later copies of the same deadline (a reminder repeated in the group) start unticked.
    const seen = new Set(), dup = new Set();
    list.forEach((t) => { const k = `${courseOf(t)}|${t.type}|${t.due}`; if (seen.has(k)) dup.add(t.id); seen.add(k); });
    return (t) => ({ past: C.toDay(t.due) < todayN(), dup: dup.has(t.id) });
  }
  function allItems() { return ob.found.concat(ob.estimates); }
  function isOn(t, f) { const k = keyOf(t); if (ob.forced.has(k)) return ob.forced.get(k); const x = f(t); return !x.past && !x.dup; }
  function picked() {
    const list = allItems(), f = flags(list);
    const sel = list.filter((t) => isOn(t, f));
    const ids = new Set(sel.map((t) => t.id));
    return sel.map((t) => ({ ...t, c: courseOf(t), deps: (t.deps || []).filter((d) => ids.has(d)) }));
  }
  function allCourses(sel) {
    const extra = [];
    sel.forEach((t) => { if (!ob.courses.includes(t.c) && !extra.includes(t.c)) extra.push(t.c); });
    const general = extra.indexOf('General');
    if (general > -1) extra.push(extra.splice(general, 1)[0]);
    return ob.courses.concat(extra);
  }
  function runRules() {
    const r = C.extractTasks(ob.text, ob.today);
    ob.found = r.tasks.map((t) => ({ ...t, id: `r${t.id}`, deps: t.deps.map((d) => `r${d}`) }));
    ob.ignored = r.ignored;
    ob.via = 'rules';
  }
  // A typical semester for courses with nothing found yet: two assignments, a quiz and a final.
  function buildEstimates() {
    const today = todayN(), F = C.toDay(ob.finals), span = Math.max(10, F - today);
    const notSun = (d) => (C.weekday(d) === 0 ? d + 1 : d);
    ob.estimates = [];
    const sel = picked();
    const missing = ob.courses.filter((c) => !sel.some((t) => t.c === c));
    let n = 0;
    const est = (course, label, type, day, weight) => {
      const info = C.TYPES.find((x) => x.type === type);
      return { id: `e${++n}`, title: `${shortLabel(course)} ${label} (est.)`, course, type, due: C.fromDay(day), effortH: info.effort, doneH: 0, weight, deps: [],
        source: null, confidence: 'low', effortSource: `default for ${info.label.toLowerCase()}`, estimated: true,
        notes: ['Estimated date from a typical semester. Change it when the real date is announced.'] };
    };
    missing.forEach((c) => {
      const i = ob.courses.indexOf(c);
      [['Assignment 1', 'assignment', 0.25, 10], ['Quiz', 'quiz', 0.5, 5], ['Assignment 2', 'assignment', 0.75, 10]].forEach(([label, type, f, w]) => {
        const d = notSun(today + Math.max(3, Math.round(span * f)) + (i % 3));
        if (d < F) ob.estimates.push(est(c, label, type, d, w));
      });
      ob.estimates.push(est(c, 'Final exam', 'exam', notSun(F + i * 2), 40));
    });
  }

  /* ---------- does it fit? (same planner and settings as the app) ---------- */
  function evaluate(sel) {
    const settings = { ...opts.defaults, availability: ob.avail, commitments: [], today: ob.today };
    const live = sel.map((t) => ({ ...t, scale: 1 }));
    const plan = C.planCrunch(live, settings);
    const risk = live.filter((t) => plan.unfinished[t.id] || plan.finish[t.id] == null || plan.finish[t.id] > C.toDay(t.due));
    const metrics = live.length ? C.planMetrics(live, plan) : null;
    const today = todayN();
    const week = plan.days.filter((d) => d.day <= today + 6).reduce((a, d) => a + d.load, 0);
    const first = (plan.days.find((d) => d.day === today) || { sessions: [] }).sessions[0];
    return { plan, live, risk, metrics, week, first, hours: live.reduce((a, t) => a + C.remaining(t), 0) };
  }
  function ring(sel, v, size) {
    const S = size, cx = S / 2, sw = Math.max(7, S / 11), rr = cx - sw / 2 - 1, n = sel.length;
    const riskIds = new Set(v.risk.map((t) => t.id));
    const segs = [...sel].sort((a, b) => a.due.localeCompare(b.due));
    const gap = n > 1 ? Math.min(6, 120 / n) : 0;
    const pt = (deg) => { const r = ((deg - 90) * Math.PI) / 180; return `${(cx + rr * Math.cos(r)).toFixed(2)},${(cx + rr * Math.sin(r)).toFixed(2)}`; };
    let s = `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" aria-hidden="true"><circle cx="${cx}" cy="${cx}" r="${rr}" fill="none" style="stroke:var(--panel)" stroke-width="${sw}"/>`;
    segs.forEach((t, i) => {
      const a0 = (i * 360) / n + gap / 2, a1 = ((i + 1) * 360) / n - gap / 2;
      const d = n === 1 ? `M${pt(0)}A${rr},${rr} 0 1 1 ${pt(359.99)}` : `M${pt(a0)}A${rr},${rr} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${pt(a1)}`;
      s += `<path d="${d}" fill="none" stroke-width="${sw}" style="stroke:${riskIds.has(t.id) ? 'var(--warn)' : 'var(--viz-accent)'};--i:${i}"/>`;
    });
    return s + '</svg>';
  }

  /* ---------- shell ---------- */
  function mount() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'onb';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'onbTitle');
    root.innerHTML = `
      <header class="onb-top">
        <div class="brand">${LOGO}<span class="brand-name">Dueline</span></div>
        <ol class="onb-steps" id="onbSteps"></ol>
        <div class="onb-top-r"><button class="linkish onb-skip" id="onbSkip" type="button"></button></div>
      </header>
      <div class="onb-body">
        <div class="onb-col">
          <div class="onb-scroll" id="onbScroll"><section class="onb-main" id="onbMain"></section></div>
          <footer class="onb-foot" id="onbFoot">
            <button class="btn ghost" id="onbBack" type="button">${ic('left')}Back</button>
            <span class="onb-sum" id="onbSum"></span>
            <button class="btn primary" id="onbNext" type="button"></button>
          </footer>
        </div>
        <aside class="onb-side" id="onbSide" aria-label="Preview of your dashboard"></aside>
      </div>
      <input type="file" id="onbFile" multiple hidden accept="image/*,.pdf,.doc,.docx,.pptx,.odt,.odp,.xlsx,.xls,.ods,.csv,.tsv,.ics,.txt,.md,.html,.htm,.rtf,.json,.eml,.zip">`;
    document.body.appendChild(root);
    $('onbBack').addEventListener('click', back);
    $('onbNext').addEventListener('click', next);
    $('onbSkip').addEventListener('click', skip);
    $('onbFile').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
    root.addEventListener('keydown', onKey);
    // Files and screenshots: dropped anywhere or pasted (⌘V) while on the deadlines step.
    root.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); if (ob.step === 'deadlines') root.classList.add('drag'); } });
    root.addEventListener('dragleave', (e) => { if (e.target === root || !root.contains(e.relatedTarget)) root.classList.remove('drag'); });
    root.addEventListener('drop', (e) => {
      root.classList.remove('drag');
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      e.stopPropagation();
      if (ob.step !== 'deadlines') go('deadlines');
      importFiles(e.dataTransfer.files);
    });
    document.addEventListener('paste', (e) => {
      if (root.hidden || ob.step !== 'deadlines') return;
      const files = [...(e.clipboardData ? e.clipboardData.files : [])];
      if (!files.length) return;
      e.preventDefault();
      importFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `Pasted screenshot${files.length > 1 ? ` ${i + 1}` : ''}.${f.type.split('/')[1] || 'png'}`, { type: f.type }))));
    });
  }

  function onKey(e) {
    if (e.key === 'Escape' && !opts.firstRun) { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    // Keep keyboard focus inside the setup while it is open.
    const f = [...root.querySelectorAll('button, input, textarea, select, a[href], [tabindex="0"]')].filter((el) => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }

  function go(step) {
    ob.step = step;
    clearTimeout(buildTimer);
    root.classList.toggle('is-welcome', step === 'welcome');
    root.classList.toggle('is-build', step === 'build');
    const at = STEPS.findIndex(([k]) => k === step);
    $('onbSteps').innerHTML = STEPS.map(([k, label], i) => `<li class="${i < at ? 'done' : i === at ? 'cur' : ''}" ${i === at ? 'aria-current="step"' : ''}><span class="n">${i < at ? ic('check') : i + 1}</span><span class="lb">${label}</span></li>`).join('');
    $('onbSkip').textContent = opts.firstRun ? 'Skip setup' : 'Cancel';
    $('onbSkip').hidden = step === 'build';
    ({ welcome: viewWelcome, courses: viewCourses, deadlines: viewDeadlines, hours: viewHours, build: viewBuild })[step]();
    $('onbScroll').scrollTop = 0;
    refresh();
    const first = step === 'courses' ? $('onbCourseIn') : step === 'deadlines' ? $('onbText') : root.querySelector('.onb-main .btn.primary, .onb-main button, #onbNext');
    if (first && (!isPhone() || first.tagName === 'BUTTON')) first.focus({ preventScroll: true });
  }
  function back() { const i = STEPS.findIndex(([k]) => k === ob.step); go(i > 0 ? STEPS[i - 1][0] : opts.firstRun ? 'welcome' : ob.step); }
  function next() {
    if (ob.step === 'courses') { const v = $('onbCourseIn').value.trim(); if (v) addCourses(v); go('deadlines'); }
    else if (ob.step === 'deadlines') go('hours');
    else if (ob.step === 'hours') go('build');
  }
  function skip() { const cb = opts.onSkip; close(); if (cb) cb(); }

  // Parts of the screen that change as the student types or ticks.
  function refresh() {
    const sel = picked(), v = evaluate(sel), courses = allCourses(sel);
    renderSide(sel, v, courses);
    if (ob.step === 'courses') renderChips();
    if (ob.step === 'deadlines') { renderPreview(); renderGemma(); renderEst(sel); }
    if (ob.step === 'hours') { renderDays(); renderVerdict(sel, v); }
    const foot = ob.step !== 'welcome' && ob.step !== 'build';
    $('onbBack').hidden = !foot || (ob.step === 'courses' && !opts.firstRun);
    $('onbSum').textContent = ob.step === 'courses' ? `${courses.length} course${courses.length === 1 ? '' : 's'}` : `${sel.length} deadline${sel.length === 1 ? '' : 's'}`;
    const nextLabel = {
      courses: ob.courses.length ? 'Continue' : 'Skip this step',
      deadlines: sel.length ? 'Continue' : 'Skip for now',
      hours: 'Build my plan',
    }[ob.step];
    if (nextLabel) $('onbNext').innerHTML = `${esc(nextLabel)}${ic('right')}`;
  }

  /* ---------- welcome ---------- */
  function viewWelcome() {
    $('onbMain').innerHTML = `<div class="onb-hero">
      <div class="onb-tiles" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map((i) => `<span class="onb-tw" style="--i:${i}">${opts.tile(i, 44)}</span>`).join('')}</div>
      <h1 id="onbTitle">Your whole semester, planned in a minute</h1>
      <p class="onb-lead">Tell Dueline your courses and what's due. It builds a day-by-day study plan around your free time and replans when things change.</p>
      <ul class="onb-points">
        <li>${ic('clipboard')}<span><b>Paste straight from WhatsApp, Teams or VTOP.</b> Dueline finds the dates; you just tick.</span></li>
        <li>${ic('calendar')}<span><b>A plan that fits your free hours,</b> so big tasks start early instead of the night before.</span></li>
        <li>${ic('bell')}<span><b>A heads-up before a deadline slips,</b> while there's still time to fix it.</span></li>
      </ul>
      <div class="onb-cta">
        <button class="btn primary big" type="button" id="onbStart">Set up my semester${ic('right')}</button>
        <span class="muted small">About a minute. No account needed.</span>
      </div>
      <button class="linkish onb-sample" type="button" id="onbSample">Or look around a sample semester first</button>
    </div>`;
    $('onbStart').addEventListener('click', () => go('courses'));
    $('onbSample').addEventListener('click', skip);
  }

  /* ---------- step 1: courses ---------- */
  function viewCourses() {
    $('onbMain').innerHTML = `
      <div class="onb-k">Step 1 of 3</div>
      <h2 id="onbTitle">What are you taking this semester?</h2>
      <p class="onb-sub">Add each course. Codes like BCSE302L help Dueline match messages to the right course.</p>
      <form class="onb-add" id="onbCourseForm" autocomplete="off">
        <input id="onbCourseIn" type="text" placeholder="e.g. BCSE302L Database Systems" aria-label="Course name or code" enterkeyhint="done">
        <button class="btn" type="submit">${ic('plus')}Add</button>
      </form>
      <div class="onb-chips" id="onbChips" aria-live="polite"></div>
      <p class="onb-hint">${ic('clipboard')}<span>Got a list? Paste all your courses at once, one per line.</span></p>`;
    $('onbCourseForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = $('onbCourseIn');
      if (inp.value.trim() && addCourses(inp.value)) { inp.value = ''; refresh(); }
    });
    $('onbCourseIn').addEventListener('paste', (e) => {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (!/[\n;]/.test(text.trim())) return;
      e.preventDefault();
      addCourses(text);
      refresh();
    });
  }
  function renderChips() {
    $('onbChips').innerHTML = ob.courses.map((c, i) => {
      const { code, name } = parts(c);
      return `<span class="onb-chip${fresh(`c:${c}`)}">${opts.tile(i, 30)}<span class="t"><b>${esc(name)}</b>${code ? `<small>${esc(code)}</small>` : ''}</span><button type="button" data-i="${i}" aria-label="Remove ${esc(name)}">${ic('x')}</button></span>`;
    }).join('');
    $('onbChips').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      ob.courses.splice(+b.dataset.i, 1);
      refresh();
      $('onbCourseIn').focus();
    }));
  }

  /* ---------- step 2: deadlines ---------- */
  function viewDeadlines() {
    const mod = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘V' : 'Ctrl+V';
    $('onbMain').innerHTML = `
      <div class="onb-k">Step 2 of 3</div>
      <h2 id="onbTitle">What's due?</h2>
      <p class="onb-sub">Paste messages from WhatsApp, Teams or VTOP, or add your syllabus or a screenshot. Dueline picks out the deadlines; you just tick.</p>
      <div class="onb-src">
        <textarea id="onbText" spellcheck="false" aria-label="Paste messages or deadlines" placeholder="[12/10/26, 9:41 am] Prof. Kumar: DA 2 due Friday (10%)&#10;CAT 2 on 3 Nov&#10;Lab record by 25/10"></textarea>
        <div class="onb-src-bar">
          <button class="btn small" type="button" id="onbBrowse">${ic('upload')}Add a file or screenshot</button>
          <span class="onb-src-hint">PDF, Word, Excel, .ics or images<span class="desk"> · drop here or ${mod} a screenshot</span></span>
        </div>
      </div>
      <ul class="import-list" id="onbImports"></ul>
      <div class="preview onb-preview" id="onbPreview"></div>
      <div id="onbGemma"></div>
      <div id="onbEst"></div>`;
    $('onbText').value = ob.text;
    $('onbText').addEventListener('input', () => {
      ob.text = $('onbText').value;
      clearTimeout(rulesTimer);
      rulesTimer = setTimeout(() => { runRules(); refresh(); }, 200);
    });
    $('onbBrowse').addEventListener('click', () => $('onbFile').click());
    renderImports();
  }
  function renderPreview() {
    const list = allItems(), f = flags(list), box = $('onbPreview');
    if (!list.length) {
      box.innerHTML = `<div class="pv-empty">${ic('file')}<span>${ob.text.trim()
        ? 'No dated deadlines found yet. Each one needs a date, like "due Friday" or "on 28 Oct".'
        : 'Deadlines you paste or add show up here to tick.'}</span></div>`;
      return;
    }
    const on = list.filter((t) => isOn(t, f)).length;
    const est = ob.estimates.length;
    box.innerHTML = `<div class="pv-head"><b>${on} of ${list.length} ticked</b><span>${ob.found.length ? (ob.via === 'gemma' ? 'read by Gemma 4' : 'read instantly, offline') : ''}${est ? `${ob.found.length ? ' · ' : ''}${est} estimated` : ''}${ob.ignored.length ? ` · ${ob.ignored.length} line${ob.ignored.length > 1 ? 's' : ''} without a deadline skipped` : ''}</span></div>
      <ul class="pv-list">${list.map((t) => {
        const x = f(t), c = courseOf(t), checked = isOn(t, f);
        const unassigned = (c === 'General' || !c) && ob.courses.length;
        const label = (C.TYPES.find((y) => y.type === t.type) || {}).label || t.type;
        const tags = [x.past ? '<em>already passed</em>' : '', x.dup ? '<em>looks like a repeat</em>' : '', t.estimated ? '<em class="est">estimate</em>' : '',
          !t.estimated && t.confidence === 'low' ? '<em>check this</em>' : ''].filter(Boolean).join(' · ');
        return `<li class="${checked ? '' : 'off'}" data-k="${esc(keyOf(t))}" tabindex="0" role="checkbox" aria-checked="${checked}">
          <span class="pv-box">${ic('check')}</span>
          <span class="pv-t"><b>${esc(t.title)}</b><span>${unassigned
            ? `<select data-k="${esc(keyOf(t))}" aria-label="Course for ${esc(t.title)}"><option value="">Which course?</option>${ob.courses.map((cc) => `<option value="${esc(cc)}">${esc(parts(cc).name)}</option>`).join('')}</select>`
            : esc(parts(c).name)} · ${esc(label)}${t.weight != null ? ` · ${t.weight}%` : ''}${tags ? ` · ${tags}` : ''}</span></span>
          <span class="pv-d">${C.fmtDay(C.toDay(t.due))}</span></li>`;
      }).join('')}</ul>`;
    box.querySelectorAll('li').forEach((li) => {
      const toggle = () => {
        const t = list.find((y) => keyOf(y) === li.dataset.k);
        ob.forced.set(li.dataset.k, !isOn(t, f));
        refresh();
        const again = $('onbPreview').querySelector(`li[data-k="${CSS.escape(li.dataset.k)}"]`);
        if (again) again.focus({ preventScroll: true });
      };
      li.addEventListener('click', (e) => { if (!e.target.closest('select')) toggle(); });
      li.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && e.target === li) { e.preventDefault(); toggle(); } });
    });
    box.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => { if (s.value) { ob.assign.set(s.dataset.k, s.value); refresh(); } }));
  }

  // Files and screenshots become text in the box, under a "--- from <file> ---" marker, like the pop-up.
  function renderImports() {
    const box = $('onbImports');
    if (!box) return;
    box.innerHTML = ob.imports.map((it) => `<li class="${it.status}">${ic(it.status === 'done' ? 'check-circle' : it.status === 'error' ? 'alert' : 'clock')}<span class="nm">${esc(it.name)}</span><span class="msg">${esc(it.msg || '')}${it.pct != null && it.status === 'busy' ? ` ${Math.round(it.pct * 100)}%` : ''}</span></li>`).join('');
  }
  function importFiles(files) {
    if (!window.DuelineImport) return;
    ob.images.push(...[...files].filter((f) => /^image\//.test(f.type)));
    [...files].forEach((file) => {
      const it = { name: file.name || 'Pasted screenshot', status: 'busy', msg: 'Reading…' };
      ob.imports.push(it);
      renderImports();
      window.DuelineImport.fileToText(file, (pct, msg) => { if (pct != null) it.pct = pct; if (msg) it.msg = msg; renderImports(); }).then((r) => {
        const body = String(r.text || '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
        if (body) ob.text = `${ob.text.replace(/\s+$/, '')}${ob.text.trim() ? '\n\n' : ''}--- from ${(r.name || it.name).replace(/-{3}/g, '')} (${r.method}) ---\n${body}\n`;
        const before = ob.found.length;
        runRules();
        Object.assign(it, { status: body ? 'done' : 'error', pct: null, msg: body ? `${r.method} · ${Math.max(0, ob.found.length - before)} deadline(s) found` : `${r.method} · no text found` });
      }).catch((e) => {
        Object.assign(it, { status: 'error', pct: null, msg: e.message || String(e) });
      }).finally(() => {
        if (ob.step === 'deadlines') { $('onbText').value = ob.text; renderImports(); refresh(); }
      });
    });
  }

  function renderGemma() {
    const box = $('onbGemma');
    const G = window.DuelineGemma;
    const want = G && (ob.images.length || (ob.text.trim() && !ob.found.length));
    if (!want) { box.innerHTML = ''; return; }
    if (ob.gemma === 'busy') { box.innerHTML = `<div class="onb-gemma">${ic('clock')}<span>Gemma 4 is reading…</span></div>`; return; }
    box.innerHTML = `<div class="onb-gemma"><span>${ic('zap')}${ob.images.length ? 'Screenshot or messy text? Gemma 4 reads it directly.' : 'Messy text? Gemma 4 can read it.'}</span><button class="btn gemma small" type="button" id="onbGemmaBtn">Read with Gemma 4</button>
      ${ob.gemma === 'key' ? `<div class="onb-gkey"><input type="password" id="onbKey" placeholder="Paste your free Gemini API key" autocomplete="off" aria-label="Gemini API key"><button class="btn small" type="button" id="onbKeySave">Save and read</button><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Get a free key ↗</a></div>` : ''}
      ${ob.gemmaMsg ? `<div class="onb-gmsg">${esc(ob.gemmaMsg)}</div>` : ''}</div>`;
    $('onbGemmaBtn').addEventListener('click', readWithGemma);
    if ($('onbKeySave')) $('onbKeySave').addEventListener('click', () => { const k = $('onbKey').value.trim(); if (k) { G.setKey(k); readWithGemma(); } });
  }
  async function readWithGemma() {
    ob.gemma = 'busy'; ob.gemmaMsg = '';
    renderGemma();
    try {
      const r = await window.DuelineGemma.extract({ text: ob.text, images: ob.images, today: ob.today, C });
      ob.gemma = null;
      if (!r.tasks.length) ob.gemmaMsg = 'Gemma 4 found no dated deadlines.';
      else { ob.found = r.tasks; ob.ignored = r.ignored; ob.via = 'gemma'; }
    } catch (e) {
      ob.gemma = e.code === 'NO_KEY' ? 'key' : null;
      ob.gemmaMsg = e.code === 'NO_KEY' ? 'Gemma 4 needs a free Gemini API key. It stays in this browser.' : (e.message || 'Gemma 4 failed. The regular reader still works.');
    }
    if (ob.step === 'deadlines') refresh();
  }

  const listNames = (cs) => { const n = cs.map((c) => parts(c).name); return n.length > 3 ? `${n.slice(0, 2).join(', ')} and ${n.length - 2} more` : n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0]; };
  function renderEst(sel) {
    const box = $('onbEst');
    if (ob.estimates.length) {
      const nC = new Set(ob.estimates.map((t) => t.course)).size;
      box.innerHTML = `<div class="onb-est-done">${ic('check-circle')}<span>Estimated ${ob.estimates.length} dates for ${nC} course${nC > 1 ? 's' : ''}. They're marked <b>(est.)</b> so you can change them when they're announced.</span><button class="linkish" type="button" id="onbEstUndo">Remove estimates</button></div>`;
      $('onbEstUndo').addEventListener('click', () => { ob.estimates = []; refresh(); });
      return;
    }
    const missing = ob.courses.filter((c) => !sel.some((t) => t.c === c));
    const emph = !sel.length;
    if (!ob.courses.length) {
      box.innerHTML = `<div class="onb-est-card ${emph ? 'emph' : ''}"><div class="oe-t"><b>Nothing to paste right now?</b><span>Add your courses and Dueline can sketch a typical semester for them, with dates you change later.</span></div><div class="oe-row"><button class="btn small" type="button" id="onbToCourses">${ic('left')}Add courses</button></div></div>`;
      $('onbToCourses').addEventListener('click', () => go('courses'));
      return;
    }
    if (!missing.length) { box.innerHTML = ''; return; }
    const all = missing.length === ob.courses.length;
    box.innerHTML = `<div class="onb-est-card ${emph ? 'emph' : ''}">
      <div class="oe-t"><b>${all ? 'Nothing to paste right now?' : `Nothing found for ${missing.length} course${missing.length > 1 ? 's' : ''} yet`}</b>
        <span>Start ${all ? 'your courses' : esc(listNames(missing))} from a typical semester: two assignments, a quiz and a final exam each, with estimated dates you can change later.</span></div>
      <div class="oe-row"><label>Final exams start <input type="date" id="onbFinals" value="${ob.finals}" min="${C.fromDay(todayN() + 7)}"></label>
        <button class="btn ${emph ? 'primary' : ''} small" type="button" id="onbEstBtn">${ic('zap')}Fill in estimates</button></div></div>`;
    $('onbFinals').addEventListener('change', (e) => { if (e.target.value) ob.finals = e.target.value; });
    $('onbEstBtn').addEventListener('click', () => { buildEstimates(); refresh(); });
  }

  /* ---------- step 3: study time ---------- */
  function viewHours() {
    $('onbMain').innerHTML = `
      <div class="onb-k">Step 3 of 3</div>
      <h2 id="onbTitle">When can you study?</h2>
      <p class="onb-sub">A rough guess is fine. Dueline learns how long your work really takes and replans as you go.</p>
      <div class="onb-presets" role="radiogroup" aria-label="Study hours">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" role="radio" class="onb-preset" data-p="${k}"><b>${p.label}</b><span>${p.sub}</span></button>`).join('')}</div>
      <div class="onb-days" id="onbDays"></div>
      <div class="onb-verdict" id="onbVerdict" aria-live="polite"></div>`;
    $('onbMain').querySelectorAll('.onb-preset').forEach((b) => b.addEventListener('click', () => { ob.preset = b.dataset.p; ob.avail = presetHours(PRESETS[ob.preset]); refresh(); }));
  }
  function renderDays() {
    $('onbMain').querySelectorAll('.onb-preset').forEach((b) => { const on = b.dataset.p === ob.preset; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    $('onbDays').innerHTML = SHOWN_DAYS.map((wd) => `<div class="onb-day ${wd === 0 || wd === 6 ? 'we' : ''}">
      <span class="od-n">${C.WD[wd]}</span>
      <button type="button" data-wd="${wd}" data-d="0.5" aria-label="More time on ${C.WD[wd]}">+</button>
      <b>${C.round(ob.avail[wd], 1)}h</b>
      <button type="button" data-wd="${wd}" data-d="-0.5" aria-label="Less time on ${C.WD[wd]}">−</button></div>`).join('');
    $('onbDays').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const wd = +b.dataset.wd;
      ob.avail[wd] = Math.min(14, Math.max(0, ob.avail[wd] + +b.dataset.d));
      const match = Object.entries(PRESETS).find(([, p]) => presetHours(p).every((h, i) => h === ob.avail[i]));
      ob.preset = match ? match[0] : 'custom';
      refresh();
      const again = $('onbDays').querySelector(`button[data-wd="${wd}"][data-d="${b.dataset.d}"]`);
      if (again) again.focus({ preventScroll: true });
    }));
  }
  function renderVerdict(sel, v) {
    const box = $('onbVerdict');
    const weekly = ob.avail.reduce((a, h) => a + h, 0);
    if (!sel.length) {
      box.className = 'onb-verdict';
      box.innerHTML = `${ic('calendar')}<span><b>${C.round(weekly, 1)}h a week.</b> No deadlines yet, so there's nothing to fit. Add them any time from the dashboard.</span>`;
    } else if (!v.risk.length) {
      box.className = 'onb-verdict ok';
      box.innerHTML = `${ic('check-circle')}<span><b>All ${sel.length} deadlines fit.</b> You'd finish ${v.metrics && v.metrics.avgBufferDays >= 1 ? `about ${Math.round(v.metrics.avgBufferDays)} day${Math.round(v.metrics.avgBufferDays) === 1 ? '' : 's'} early on average` : 'each one before it is due'}, with about ${Math.round(v.week)}h of study in the next 7 days.</span>`;
    } else {
      const names = v.risk.slice(0, 2).map((t) => `"${t.title}"`).join(' and ');
      box.className = 'onb-verdict risk';
      box.innerHTML = `${ic('alert')}<span><b>${v.risk.length} of ${sel.length} won't fit yet:</b> ${esc(names)}${v.risk.length > 2 ? ` and ${v.risk.length - 2} more` : ''}. Add some hours, or carry on and Dueline will flag ${v.risk.length > 1 ? 'them' : 'it'} early so you can ask for help or an extension.</span>`;
    }
  }

  /* ---------- building the plan ---------- */
  function viewBuild() {
    const sel = picked(), v = evaluate(sel), courses = allCourses(sel).filter((c) => sel.some((t) => t.c === c));
    const weekly = ob.avail.reduce((a, h) => a + h, 0);
    const first = v.first && sel.find((t) => t.id === v.first.id);
    const steps = sel.length ? [
      `Read <b>${sel.length} deadline${sel.length > 1 ? 's' : ''}</b> across ${courses.length} course${courses.length === 1 ? '' : 's'}`,
      'Ranked them by urgency, grade weight and what unblocks what',
      `Fit <b>${Math.round(v.hours)}h of work</b> into your ${C.round(weekly, 1)}h a week${v.risk.length ? `, with ${v.risk.length} flagged at risk` : ''}`,
      first ? `First up today: <b>${esc(first.title)}</b> · ${C.round(v.first.hours, 1)}h` : 'Nothing needed today. Your first session is on the calendar',
    ] : ['Saved your study hours', 'Set up your calendar and task board', 'Add deadlines any time with New deadline'];
    $('onbMain').innerHTML = `<div class="onb-build">
      <div class="onb-bring">${ring(sel, v, 120)}<div class="pct"><b>${sel.length}</b><span>deadline${sel.length === 1 ? '' : 's'}</span></div></div>
      <h2 id="onbTitle">${reduceMotion() ? 'Your plan is ready' : 'Building your plan…'}</h2>
      <ul class="onb-checks">${steps.map((s, i) => `<li style="--i:${i}">${ic('check')}<span>${s}</span></li>`).join('')}</ul>
      <button class="btn primary big" type="button" id="onbOpen" style="--i:${steps.length}">Open my dashboard${ic('right')}</button>
    </div>`;
    $('onbOpen').addEventListener('click', finish);
    if (!reduceMotion()) buildTimer = setTimeout(() => { if (ob.step === 'build') $('onbTitle').textContent = 'Your plan is ready'; }, steps.length * 420 + 200);
  }

  function finish() {
    const sel = picked();
    const order = allCourses(sel).filter((c) => sel.some((t) => t.c === c));
    // Course order decides each course's colour and shape in the app, so keep the student's order.
    sel.sort((a, b) => order.indexOf(a.c) - order.indexOf(b.c) || a.due.localeCompare(b.due));
    const ids = {};
    sel.forEach((t, i) => { ids[t.id] = `t${i + 1}`; });
    const tasks = sel.map((t) => {
      const { c, ...rest } = t;
      return { ...rest, id: ids[t.id], course: c, deps: (t.deps || []).filter((d) => ids[d]).map((d) => ids[d]), doneH: 0, origEst: t.effortH };
    });
    const result = { today: ob.today, text: ob.text, tasks, ignored: ob.ignored, availability: ob.avail.slice(), estimated: tasks.filter((t) => t.estimated).length };
    const cb = opts.onDone;
    close();
    cb(result);
  }

  /* ---------- live preview of the dashboard ---------- */
  function renderSide(sel, v, courses) {
    const today = todayN();
    const soon = sel.filter((t) => C.toDay(t.due) >= today).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 4);
    const count = (c) => sel.filter((t) => t.c === c).length;
    const skel = (n) => Array.from({ length: n }, (_, i) => `<div class="os-skel" style="--w:${[72, 54, 64, 46][i % 4]}%"><i></i><span></span></div>`).join('');
    const rel = (d) => (d === today ? 'today' : d === today + 1 ? 'tomorrow' : C.fmtDay(d).slice(4));
    $('onbSide').innerHTML = `
      <div class="os-k"><span>Your dashboard</span><span class="os-live"><i></i>Live preview</span></div>
      <div class="os-card os-hero">
        <div class="os-ring">${ring(sel, v, 84)}<div class="pct"><b>${sel.length ? sel.length - v.risk.length : '–'}<small>${sel.length ? `/${sel.length}` : ''}</small></b><span>on track</span></div></div>
        <div><h4>Your semester</h4><p>${!sel.length ? 'Fills in as you add deadlines' : v.risk.length ? `<span class="warn">${v.risk.length} at risk</span> · ${Math.round(v.week)}h planned this week` : `Every deadline fits · ${Math.round(v.week)}h planned this week`}</p></div>
      </div>
      <div class="os-stats">
        <div><b>${courses.length}</b><span>courses</span></div>
        <div><b>${sel.length}</b><span>deadlines</span></div>
        <div><b>${Math.round(v.hours)}h</b><span>of work</span></div>
      </div>
      <div class="os-card"><div class="os-h">Courses</div>${courses.length ? courses.map((c, i) => `<div class="os-row${fresh(`s:${c}`)}">${opts.tile(i, 28)}<span class="nm">${esc(parts(c).name)}</span><span class="mt">${count(c) ? `${count(c)} deadline${count(c) > 1 ? 's' : ''}` : 'nothing yet'}</span></div>`).join('') : skel(3)}</div>
      <div class="os-card"><div class="os-h">Coming up</div>${soon.length ? soon.map((t) => `<div class="os-row${fresh(`u:${keyOf(t)}`)}"><span class="os-dot ${v.risk.some((r) => r.id === t.id) ? 'risk' : ''}"></span><span class="nm">${esc(t.title)}</span><span class="mt">${rel(C.toDay(t.due))}</span></div>`).join('') : skel(3)}</div>`;
  }

  /* ---------- open / close ---------- */
  function open(o) {
    opts = o;
    mount();
    const today = o.today;
    ob = {
      step: null, today, courses: (o.courses || []).filter((c) => c && c !== 'General'), text: '', found: [], ignored: [], estimates: [], via: 'rules',
      forced: new Map(), assign: new Map(), imports: [], images: [], gemma: null, gemmaMsg: '', seen: new Set(),
      preset: 'steady', avail: presetHours(PRESETS.steady), finals: C.fromDay(C.toDay(today) + 35),
    };
    lastFocus = document.activeElement;
    root.hidden = false;
    document.documentElement.classList.add('onb-open');
    go(o.firstRun ? 'welcome' : 'courses');
  }
  function close() {
    if (!root || root.hidden) return;
    clearTimeout(buildTimer); clearTimeout(rulesTimer);
    root.hidden = true;
    root.classList.remove('drag');
    document.documentElement.classList.remove('onb-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  window.DuelineOnboarding = { open, close, isOpen: () => !!root && !root.hidden };
})();
