/* Dueline UI. All planning logic lives in engine.js. */
(function () {
  'use strict';
  const C = window.Crunch;
  const S = window.CRUNCH_SAMPLE;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PALETTE = ['#c6f432', '#6aa7ff', '#ff8fd1', '#ffb547', '#3ddc97', '#b28dff', '#5fe3ea', '#ff7a59'];
  const KEY = 'dueline-state-v1';
  const ic = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

  let state = loadState() || demoState();
  let current = null; // last computed plan bundle

  function demoState() {
    const { tasks, ignored } = C.extractTasks(S.text, S.today);
    tasks.forEach((t) => { t.origEst = t.effortH; });
    // A semester already under way: one task started, one lab already submitted.
    const started = tasks.find((t) => /^DA 1/.test(t.title));
    if (started) { started.doneH = 2; started.started = true; }
    const finished = tasks.find((t) => /Lab experiment 5/.test(t.title));
    if (finished) { finished.completed = true; finished.doneH = finished.effortH; }
    const activity = { '2026-10-13': finished ? finished.effortH : 0, '2026-10-14': started ? 2 : 0 };
    return { activity, today: S.today, text: S.text, tasks, ignored, settings: JSON.parse(JSON.stringify({ ...S.settings, prior: 1 })), log: null, nextId: tasks.length + 1 };
  }
  function loadState() { try { const s = JSON.parse(localStorage.getItem(KEY)); return s && s.tasks ? s : null; } catch (e) { return null; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable: still works in-memory */ } }

  const courseColor = (course) => {
    const courses = [...new Set(state.tasks.map((t) => t.course))];
    return PALETTE[Math.max(0, courses.indexOf(course)) % PALETTE.length];
  };
  const taskById = (id) => state.tasks.find((t) => t.id === id);

  /* ---------- learning: how much longer than estimated do tasks really take? ---------- */
  function learnedRatio() {
    const fin = state.tasks.filter((t) => t.completed && t.origEst);
    const prior = +state.settings.prior || 1;
    if (!fin.length) return { ratio: prior, n: 0, prior };
    const seen = fin.reduce((a, t) => a + t.effortH, 0) / fin.reduce((a, t) => a + t.origEst, 0);
    const w = Math.min(1, fin.length / 4);
    return { ratio: C.round((1 - w) * prior + w * seen, 2), n: fin.length, prior, seen: C.round(seen, 2) };
  }

  function computePlan() {
    const settings = { ...state.settings, today: state.today };
    const { ratio } = learnedRatio();
    const tasks = state.tasks.map((t) => ({ ...t, scale: t.completed || t.doneH > 0 ? 1 : ratio }));
    const live = tasks.filter((t) => !t.completed);
    const plan = C.planCrunch(live, settings);
    const base = C.planLastMinute(live, settings);
    return { settings, tasks, live, plan, base, prio: C.prioritize(live, settings),
      metrics: C.planMetrics(live, plan), baseMetrics: C.planMetrics(live, base), ratio };
  }

  /* ---------- rendering ---------- */
  function render() {
    current = computePlan();
    $('todayLabel').textContent = `Today: ${C.fmtDay(C.toDay(state.today))}`;
    renderSide();
    renderKpis();
    renderPlan();
    renderPrio();
    renderTasks();
    renderProof();
    renderWorkload();
    save();
  }

  function renderSide() {
    if (document.activeElement !== $('inputText')) $('inputText').value = state.text;
    const grid = $('availGrid');
    if (!grid.children.length) {
      grid.innerHTML = C.WD.map((d, i) => `<label>${d}<input type="number" min="0" max="16" step="0.5" data-wd="${i}"></label>`).join('');
      grid.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => { state.settings.availability[+inp.dataset.wd] = +inp.value || 0; render(); }));
    }
    grid.querySelectorAll('input').forEach((inp) => { inp.value = state.settings.availability[+inp.dataset.wd]; });
    $('bufferDays').value = state.settings.bufferDays;
    $('prior').value = state.settings.prior;
    $('commitList').innerHTML = (state.settings.commitments || []).map((c, i) =>
      `<div class="commit"><span>${esc(C.fmtDay(C.toDay(c.date)))} · ${c.hours}h · ${esc(c.label || 'busy')}</span><button data-i="${i}" aria-label="Remove">×</button></div>`).join('') || '<div class="hint">None yet</div>';
    $('commitList').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { state.settings.commitments.splice(+b.dataset.i, 1); render(); }));
    const n = state.tasks.length;
    const lines = (state.text || '').split(/\r?\n/).filter((l) => l.trim()).length;
    $('extractInfo').innerHTML = !n ? '' : lines
      ? `<span class="st"><b>${lines}</b> lines</span><span class="arrow">→</span><span class="st"><b>${n}</b> deadlines</span><span class="st"><b>${state.ignored.length}</b> skipped</span>`
      : `<span class="st"><b>${n}</b> deadlines added</span>`;
  }

  function renderKpis() {
    const { live, plan, metrics, settings, ratio } = current;
    const hoursLeft = live.reduce((a, t) => a + C.remaining(t), 0);
    const today = C.toDay(state.today);
    const atRisk = live.filter((t) => plan.unfinished[t.id] || plan.finish[t.id] == null || plan.finish[t.id] > C.toDay(t.due));
    const next = [...live].sort((a, b) => a.due.localeCompare(b.due))[0];
    const days = next ? C.toDay(next.due) - today : null;
    // One ring segment per open deadline: accent when it fits the plan, amber when it is at risk.
    const riskIds = new Set(atRisk.map((t) => t.id));
    const segs = [...live].sort((a, b) => a.due.localeCompare(b.due));
    const S = 120, cx = S / 2, rr = 50, sw = 10, n = segs.length;
    const gapDeg = n > 1 ? Math.min(6, 120 / n) : 0;
    const pt = (deg) => { const r = ((deg - 90) * Math.PI) / 180; return `${(cx + rr * Math.cos(r)).toFixed(2)},${(cx + rr * Math.sin(r)).toFixed(2)}`; };
    let ring = `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="${live.length - atRisk.length} of ${live.length} deadlines on track">`;
    ring += `<circle cx="${cx}" cy="${cx}" r="${rr}" fill="none" style="stroke:var(--panel)" stroke-width="${sw}"/>`;
    const ringTips = [];
    segs.forEach((t, i) => {
      const a0 = (i * 360) / n + gapDeg / 2, a1 = ((i + 1) * 360) / n - gapDeg / 2;
      const d = n === 1 ? `M${pt(0)}A${rr},${rr} 0 1 1 ${pt(359.99)}` : `M${pt(a0)}A${rr},${rr} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${pt(a1)}`;
      const risk = riskIds.has(t.id);
      ringTips.push({ value: risk ? 'At risk' : 'On track', label: `${t.title} · due ${C.fmtDay(C.toDay(t.due))}` });
      ring += `<path d="${d}" fill="none" stroke-width="${sw}" style="stroke:${risk ? 'var(--warn)' : 'var(--viz-accent)'}" tabindex="0" data-ti="${i}" class="seg-arc"/>`;
    });
    ring += `</svg><div class="pct"><b>${live.length - atRisk.length}<small>/${live.length}</small></b><span>on track</span></div>`;
    $('healthRing').innerHTML = ring;
    bindTips($('healthRing'), ringTips);
    renderRadar();
    $('healthLabel').innerHTML = `<div class="level">${atRisk.length ? `<i class="risk-dot"></i>${atRisk.length} deadline${atRisk.length > 1 ? 's' : ''} at risk` : 'Every deadline fits your free time'}</div>`;
    $('bellDot').hidden = !atRisk.length;
    $('bellBtn').title = atRisk.length ? `At risk: ${atRisk.map((t) => t.title).join(', ')}` : 'No deadlines at risk';
    $('bellBtn').onclick = () => (atRisk.length ? openTask(atRisk[0].id) : toast('No deadlines at risk'));
    const weekEnd = today + 6;
    const weekH = plan.days.filter((d) => d.day <= weekEnd).reduce((a, d) => a + d.load, 0);
    $('healthNudge').innerHTML = `${ic('calendar')}${C.round(weekH, 1)}h of study planned this week`;
    $('kpis').innerHTML = `
      <div class="stat"><div class="value">${live.length}</div><div class="label">Open<br>tasks</div></div>
      <div class="stat"><div class="value">${Math.round(hoursLeft)}h</div><div class="label">Work left<br>(×${ratio} reality)</div></div>
      <div class="stat ${days != null && days <= 2 ? 'alert' : ''}"><div class="value">${next ? (days <= 0 ? 'Today' : days + 'd') : '—'}</div><div class="label">Next<br>deadline</div></div>`;
    $('planMeta').textContent = ` · ${metrics.missed ? metrics.missed + ' deadline(s) at risk' : 'all deadlines met'} · finishes ${metrics.avgBufferDays} day(s) early on average · peak day ${metrics.peakDay}h`;
    renderCourses();
    renderCalendar();
  }

  const TILE_BG = ['#f2b8b5', '#9ee5c4', '#f4d77a', '#e9a7d9', '#f3b98d', '#b9c8ff', '#a8e4ec', '#d6c7ff'];
  function courseName(c) { const m = c.split(/\s[-–:]\s/); return { code: m.length > 1 ? m[0] : '', name: m.length > 1 ? m.slice(1).join(' - ') : c }; }
  function initials(c) { const { name } = courseName(c); const w = name.split(/\s+/).filter((x) => /^[A-Za-z]/.test(x) && !/^(and|of|the|&)$/i.test(x)); return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase(); }

  function renderCourses() {
    const { plan } = current;
    const today = C.toDay(state.today);
    const courses = [...new Set(state.tasks.map((t) => t.course))];
    $('courseList').innerHTML = courses.map((c, i) => {
      const ts = state.tasks.filter((t) => t.course === c);
      const done = ts.filter((t) => t.completed).length;
      const total = ts.reduce((a, t) => a + t.effortH, 0);
      const did = ts.reduce((a, t) => a + (t.completed ? t.effortH : Math.min(t.doneH, t.effortH)), 0);
      const pct = total ? Math.round((did / total) * 100) : 0;
      const open = ts.filter((t) => !t.completed).sort((a, b) => a.due.localeCompare(b.due));
      const risk = open.find((t) => plan.unfinished[t.id] || plan.finish[t.id] == null || plan.finish[t.id] > C.toDay(t.due));
      const nxt = open[0];
      const dd = nxt ? C.toDay(nxt.due) - today : 0;
      const chip = risk ? `<div class="chip">${ic('alert')}${esc(risk.title)} won't fit before ${C.fmtDay(C.toDay(risk.due))}. Open it for options</div>`
        : nxt && dd <= 3 ? `<div class="chip">${ic('clock')}${esc(nxt.title)} due ${dd <= 0 ? 'today' : dd === 1 ? 'tomorrow' : 'in ' + dd + ' days'}</div>` : '';
      const { code, name } = courseName(c);
      return `<div class="course" data-course="${esc(c)}" data-id="${nxt ? nxt.id : ''}">
        <div class="tile" style="background:${TILE_BG[i % TILE_BG.length]}" title="${esc(initials(c))}">${SHAPES[i % SHAPES.length]}</div>
        <div><h3>${esc(name)}</h3>
          <div class="meta"><b>${done}</b><span>/${ts.length} tasks</span> &nbsp; <b>${pct}%</b>${code ? ` <span>· ${esc(code)}</span>` : ''}</div>
          <div class="bar"><i style="width:${pct}%"></i></div>
        </div><button class="more" aria-label="Course tasks" data-course="${esc(c)}">${ic('more')}</button>${chip}</div>`;
    }).join('') || '<div class="empty">No tasks yet. Paste your deadlines on the left.</div>';
    $('courseList').querySelectorAll('.more').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); openCourse(el.dataset.course); }));
    $('courseList').querySelectorAll('.course').forEach((el) => el.addEventListener('click', () => el.dataset.id && openTask(el.dataset.id)));
  }

  const SHAPES = [
    '<svg width="44" height="44" viewBox="0 0 44 44"><path d="M4 26a18 18 0 0 1 36 0z" fill="#111"/><path d="M8 30h28l-4 10H12z" fill="#111"/></svg>',
    '<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="#111" stroke-width="5"><circle cx="13" cy="13" r="7"/><circle cx="31" cy="13" r="7"/><circle cx="13" cy="31" r="7"/><circle cx="31" cy="31" r="7"/></svg>',
    '<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="#111" stroke-width="4"><circle cx="22" cy="22" r="19"/><circle cx="22" cy="22" r="12"/><circle cx="22" cy="22" r="5"/></svg>',
    '<svg width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="#111" stroke-width="5" stroke-linejoin="round"><path d="M22 3v38M5 12l34 20M5 32l34-20"/></svg>',
    '<svg width="44" height="44" viewBox="0 0 44 44" fill="#111"><circle cx="22" cy="10" r="9"/><circle cx="22" cy="34" r="9"/><circle cx="10" cy="22" r="9"/><circle cx="34" cy="22" r="9"/><circle cx="22" cy="22" r="8"/></svg>',
    '<svg width="44" height="44" viewBox="0 0 44 44" fill="#111"><path d="M22 2l20 20-20 20L2 22z"/></svg>',
  ];
  // A course's identity everywhere: the same pastel tile and black shape as its card on Home.
  const courseIndex = (course) => Math.max(0, [...new Set(state.tasks.map((t) => t.course))].indexOf(course));
  const courseTile = (course, size = 28) => { const i = courseIndex(course); return `<span class="ctile" style="--s:${size}px;background:${TILE_BG[i % TILE_BG.length]}" title="${esc(courseName(course).name)}" aria-hidden="true">${SHAPES[i % SHAPES.length]}</span>`; };
  const decoTile = (i, size = 34) => `<span class="ctile deco" style="--s:${size}px;background:${TILE_BG[i % TILE_BG.length]}" aria-hidden="true">${SHAPES[i % SHAPES.length]}</span>`;
  const clockIcon = (c) => `<svg width="13" height="13" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="${c}"/><path d="M12 6v6l4 2" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/></svg>`;
  function openCourse(c) {
    const ts = state.tasks.filter((t) => t.course === c).sort((a, b) => a.due.localeCompare(b.due));
    $('drawerBody').innerHTML = `<h3>${esc(courseName(c).name)}</h3><div class="muted small">${esc(c)}</div>
      ${ts.map((t) => `<div class="slot" data-id="${t.id}" style="margin-top:10px"><div class="time">${t.completed ? ic('check-circle') + 'Done' : ic('flag') + 'Due ' + C.fmtDay(C.toDay(t.due))}</div><div class="title">${esc(t.title)}</div><div class="sub">${t.effortH}h · ${t.weight == null ? 'weight unknown' : t.weight + '%'}</div></div>`).join('')}`;
    $('drawer').hidden = false;
    $('drawerBody').querySelectorAll('[data-id]').forEach((el) => el.addEventListener('click', () => openTask(el.dataset.id)));
  }

  // Sessions get clock times: weekday evenings, weekend mornings, 15 min breaks.
  const startHour = (d) => ([0, 6].includes(C.weekday(d)) ? 10 : 17.5);
  const clock = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  let viewDay = null, selDay = null;
  function renderCalendar() {
    const { plan } = current;
    const today = C.toDay(state.today);
    if (selDay == null || selDay < today) selDay = today;
    if (viewDay == null) viewDay = today;
    const mon = viewDay - ((C.weekday(viewDay) + 6) % 7);
    const d0 = new Date(mon * 86400000);
    $('monthLabel').textContent = d0.toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const byDay = Object.fromEntries(plan.days.map((d) => [d.day, d]));
    let strip = '';
    for (let d = mon; d < mon + 7; d++) {
      const dues = state.tasks.filter((t) => C.toDay(t.due) === d && !t.completed).length;
      const has = byDay[d] && byDay[d].sessions.length;
      strip += `<button class="dchip ${d === selDay ? 'sel' : ''} ${d < today ? 'past' : ''} ${d === today ? 'istoday' : ''}" data-d="${d}">
        <span class="n">${new Date(d * 86400000).getUTCDate()}</span><span class="w">${C.WD[C.weekday(d)].toLowerCase()}</span>
        <span class="dots">${dues ? '<i></i>'.repeat(Math.min(3, dues)) : has ? '<i style="opacity:.35"></i>' : ''}</span></button>`;
    }
    $('dayStrip').innerHTML = strip;
    $('dayStrip').querySelectorAll('.dchip').forEach((b) => b.addEventListener('click', () => { selDay = +b.dataset.d; renderCalendar(); }));
    const entry = byDay[selDay];
    let h = startHour(selDay), html = `<div class="agenda-head"><span>${selDay === today ? 'Today' : C.fmtDay(selDay)}</span><span>${entry ? C.round(entry.load, 1) : 0}h of ${C.round(C.capacityOn(selDay, current.settings), 1)}h free</span></div>`;
    state.tasks.filter((t) => C.toDay(t.due) === selDay).forEach((t) => {
      const ok = t.completed || (plan.finish[t.id] != null && plan.finish[t.id] <= selDay && !plan.unfinished[t.id]);
      html += `<div class="slot due ${ok ? 'ok' : ''}" data-id="${t.id}"><div class="badge">${ic(ok ? 'check' : 'flag')}${ok ? 'Ready' : 'Due'}</div><div><div class="title">${esc(t.title)}</div><div class="sub">${esc(courseName(t.course).name)} · ${ok ? 'finished in plan' : 'at risk'}</div></div></div>`;
    });
    (entry ? entry.sessions : []).forEach((s) => {
      const t = taskById(s.id);
      const color = TILE_BG[[...new Set(state.tasks.map((x) => x.course))].indexOf(t.course) % TILE_BG.length];
      html += `<div class="slot" data-id="${t.id}"><button class="more" aria-hidden="true" tabindex="-1">${ic('more')}</button><div class="time">${courseTile(t.course, 20)}${clock(h)} - ${clock(h + s.hours)}</div>
        <div class="title">${esc(t.title)}</div><div class="sub">${esc(courseName(t.course).name)} · ${C.round(s.hours, 1)}h</div></div>`;
      h += s.hours + 0.25;
    });
    if (!entry || !entry.sessions.length) html += `<div class="empty-day">${ic(selDay < today ? 'calendar' : 'coffee')}${selDay < today ? 'Past day' : 'Nothing planned. Rest day'}</div>`;
    $('agenda').innerHTML = html;
    $('agenda').querySelectorAll('[data-id]').forEach((el) => el.addEventListener('click', () => openTask(el.dataset.id)));
  }
  $('weekPrev').addEventListener('click', () => { viewDay = (viewDay || C.toDay(state.today)) - 7; renderCalendar(); });
  $('weekNext').addEventListener('click', () => { viewDay = (viewDay || C.toDay(state.today)) + 7; renderCalendar(); });

  const fmtH = (h) => `${C.round(h, 1)}h`;
  const shortCourse = (c) => (c.match(/^[A-Z]{2,5}\s?\d{3,4}[A-Z]?/) || [c])[0];

  function renderPrio() {
    const { prio, plan } = current;
    const today = C.toDay(state.today);
    const rel = (d) => (d - today < 0 ? `${today - d}d overdue` : d === today ? 'today' : d - today === 1 ? 'tomorrow' : `in ${d - today} days`);
    const isRisk = (t) => plan.unfinished[t.id] || plan.finish[t.id] == null || plan.finish[t.id] > C.toDay(t.due);
    const left = (t) => C.remaining({ ...t, scale: t.doneH > 0 ? 1 : current.ratio });
    if (!prio.length) {
      $('upNext').innerHTML = '<div class="empty">No open tasks. Add a deadline to get a plan.</div>';
      $('prioList').innerHTML = '';
      return;
    }

    // Up next: the #1 task, numbers first
    const top = prio[0], tt = taskById(top.id), due0 = C.toDay(tt.due);
    $('upNext').innerHTML = `
      <div class="un-tile">${courseTile(tt.course, 64)}</div>
      <div class="un-k">Up next</div>
      <h3>${esc(tt.title)}</h3>
      <div class="muted small">${esc(courseName(tt.course).name)} · due ${C.fmtDay(due0)} · ${rel(due0)}</div>
      <div class="un-stats">
        <div><b>${f1(left(tt))}h</b><span>of work left</span></div>
        <div><b>${Math.min(999, Math.round(top.pressure * 100))}%</b><span>of free time before it's due</span></div>
        <div><b>${tt.weight == null ? '–' : tt.weight + '%'}</b><span>of the grade</span></div>
        <div><b>${Math.round(top.score)}</b><span>priority score</span></div>
      </div>
      <div class="un-why">${ic('trend')}<span>${esc(top.why[0])}</span></div>
      <div class="actions"><button class="btn primary small" id="unOpen">Open task</button><button class="btn small" id="unPlan">See schedule</button></div>`;
    $('unOpen').addEventListener('click', () => openTask(top.id));
    $('unPlan').addEventListener('click', () => document.querySelector('#tabs [data-tab=plan]').click());

    // Ranking rows
    const rtips = [];
    $('prioList').innerHTML = prio.map((r) => {
      const t = taskById(r.id), d = C.toDay(t.due), p = r.parts;
      rtips.push({ value: `${Math.round(r.score)} / 100`, label: t.title, rows: [
        { color: 'var(--p-urg)', text: `Urgency ${f1(p.urgency)} / 40` }, { color: 'var(--p-wt)', text: `Grade weight ${f1(p.importance)} / 25` },
        { color: 'var(--p-eff)', text: `Effort left ${f1(p.effort)} / 15` }, { color: 'var(--p-unb)', text: `Unblocks ${f1(p.unblocks)} / 20` }] });
      const seg = (v, c) => (v > 0 ? `<i style="width:${v}%;background:var(${c})"></i>` : '');
      return `<div class="rr ${r.rank <= 3 ? 'top' : ''}" data-id="${t.id}" tabindex="0" data-ti="${rtips.length - 1}">
        <div class="rk">${r.rank}</div>${courseTile(t.course, 32)}
        <div class="rt"><b>${esc(t.title)}</b><span>${esc(shortCourse(t.course))} · <span class="when ${d - today <= 2 ? 'soon' : ''}">${rel(d)}</span> · ${f1(left(t))}h left${isRisk(t) ? ' · <span class="when soon">at risk</span>' : ''}</span></div>
        <div class="rs"><div class="sbar">${seg(p.urgency, '--p-urg')}${seg(p.importance, '--p-wt')}${seg(p.effort, '--p-eff')}${seg(p.unblocks, '--p-unb')}</div></div>
        <div class="rv">${Math.round(r.score)}</div></div>`;
    }).join('');
    bindTips($('prioList'), rtips);
    $('prioList').querySelectorAll('.rr').forEach((el) => {
      el.addEventListener('click', () => openTask(el.dataset.id));
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openTask(el.dataset.id); });
    });
  }

  function renderTasks() {
    renderBoard();
    const types = C.TYPES.map((t) => t.type);
    const rows = state.tasks.map((t) => `<tr data-id="${t.id}">
      <td><input data-f="title" value="${esc(t.title)}"></td>
      <td><input data-f="course" value="${esc(t.course)}"></td>
      <td><select data-f="type">${types.map((x) => `<option ${x === t.type ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
      <td><input type="date" data-f="due" value="${t.due}"></td>
      <td><input type="number" step="0.5" min="0.5" data-f="effortH" value="${t.effortH}" title="${esc(t.effortSource || '')}"></td>
      <td><input type="number" step="0.5" min="0" data-f="doneH" value="${t.doneH}"></td>
      <td><input type="number" step="1" min="0" max="100" data-f="weight" value="${t.weight == null ? '' : t.weight}" placeholder="?"></td>
      <td>${t.deps.map((d) => esc((taskById(d) || {}).title || d)).join(', ') || '—'}</td>
      <td>${t.completed ? '<span class="conf high">done</span>' : `<span class="conf ${t.confidence}">${t.confidence}</span>`}</td>
      <td class="src" title="${esc(t.source ? t.source.text : '')}">${t.source ? `${t.source.file ? `${esc(t.source.file)} · ` : ''}L${t.source.line}: ${esc(t.source.text)}` : 'added manually'}</td>
      <td><button class="del" title="Delete">×</button></td></tr>`).join('');
    $('taskTable').innerHTML = `<thead><tr><th>Task</th><th>Course</th><th>Type</th><th>Due</th><th>Est. h</th><th>Done h</th><th>Weight %</th><th>Depends on</th><th>Confidence</th><th>Evidence (source line)</th><th></th></tr></thead><tbody>${rows}</tbody>`;
    $('taskTable').querySelectorAll('tr[data-id]').forEach((tr) => {
      const t = taskById(tr.dataset.id);
      tr.querySelectorAll('[data-f]').forEach((inp) => inp.addEventListener('change', () => {
        const f = inp.dataset.f;
        const before = snapshot();
        if (['effortH', 'doneH'].includes(f)) t[f] = Math.max(0, +inp.value || 0);
        else if (f === 'weight') t.weight = inp.value === '' ? null : +inp.value;
        else t[f] = inp.value;
        if (f === 'effortH' && !t.doneH) t.origEst = t.effortH;
        if (f === 'due') replanLog(before, `Deadline for "${t.title}" changed`);
        render();
      }));
      tr.querySelector('.del').addEventListener('click', () => {
        state.tasks = state.tasks.filter((x) => x.id !== t.id);
        state.tasks.forEach((x) => { x.deps = x.deps.filter((d) => d !== t.id); });
        render();
      });
    });
    $('ignoredBox').innerHTML = state.ignored.length
      ? `<b>Skipped lines</b> (no deadline found, so nothing was guessed):<br>${state.ignored.map((i) => `${i.file ? `${esc(i.file)} · ` : ''}L${i.line}: <code>${esc(i.text)}</code> (${esc(i.why)})`).join('<br>')}` : '';
  }

  /* ---------- task drawer ---------- */
  function openTask(id) {
    const t = taskById(id);
    if (!t) return;
    const r = current.prio.find((x) => x.id === id);
    const sessions = current.plan.days.flatMap((d) => d.sessions.filter((s) => s.id === id).map((s) => `${C.fmtDay(d.day)}: ${fmtH(s.hours)}`));
    const fin = current.plan.finish[id];
    $('drawerBody').innerHTML = `
      <div class="dr-head">${courseTile(t.course, 44)}<h3>${esc(t.title)}</h3></div>
      <div class="hint">${esc(t.course)} · ${esc(t.type)} · due ${C.fmtDay(C.toDay(t.due))} · ${t.weight == null ? 'weight unknown' : t.weight + '% of grade'}</div>
      ${t.completed ? '<p><b style="color:var(--ok)">Completed</b></p>' : `
      <p><b>${r ? `Priority #${r.rank} (score ${r.score})` : ''}</b></p>
      <ul>${(r ? r.why : []).map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      <p><b>Plan:</b> ${C.round(C.remaining({ ...t, scale: t.doneH > 0 ? 1 : current.ratio }), 1)}h left → ${sessions.length ? sessions.join(' · ') : 'not scheduled'}${fin != null ? ` · finishes ${C.fmtDay(fin)} (${early(C.toDay(t.due) - fin)})` : ''}</p>`}
      ${t.notes && t.notes.length ? `<p><b>Dependencies:</b></p><ul>${t.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <p><b>Evidence:</b> effort ${t.effortH}h (${esc(t.effortSource || 'entered')}), confidence ${esc(t.confidence)}</p>
      ${t.source ? `<blockquote>${t.source.file ? `From ${esc(t.source.file)}, line` : 'Line'} ${t.source.line}: ${esc(t.source.text)}</blockquote>` : ''}
      ${t.completed ? '' : `<div class="actions">
        <button class="btn primary" data-act="done">Mark complete</button>
        <button class="btn" data-act="log1">Did 1h</button>
        <button class="btn warn" data-act="more2">It's bigger: +2h</button>
      </div>`}`;
    $('drawer').hidden = false;
    $('drawerBody').querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const before = snapshot();
      if (b.dataset.act === 'done') { t.effortH = Math.max(t.doneH, 0.5); t.doneH = t.effortH; t.completed = true; replanLog(before, `"${t.title}" marked complete`); }
      if (b.dataset.act === 'log1') { state.activity = state.activity || {}; state.activity[state.today] = (state.activity[state.today] || 0) + 1; t.doneH += 1; if (t.doneH >= t.effortH) t.completed = true; replanLog(before, `Logged 1h on "${t.title}"`); }
      if (b.dataset.act === 'more2') { t.effortH += 2; replanLog(before, `"${t.title}" needs 2h more than estimated`); }
      $('drawer').hidden = true;
      render();
    }));
  }

  /* ---------- replanning with change log ---------- */
  const early = (n) => (n < 0 ? `LATE by ${-n} day(s)` : n === 0 ? 'on the due date, no buffer' : `${n} day(s) before the deadline`);
  function snapshot() { const c = current || computePlan(); return { finish: { ...c.plan.finish }, unfinished: { ...c.plan.unfinished } }; }
  function replanLog(before, title) {
    const after = computePlan();
    const items = [];
    state.tasks.filter((t) => !t.completed).forEach((t) => {
      const a = before.finish[t.id], b = after.plan.finish[t.id];
      const due = C.toDay(t.due);
      if (after.plan.unfinished[t.id] && !before.unfinished[t.id]) items.push(`"${t.title}" can no longer be finished on time. Add free time, ask for an extension or cut scope.`);
      else if (a != null && b != null && a !== b) items.push(`"${t.title}" now finishes ${C.fmtDay(b)} (was ${C.fmtDay(a)}). ${b > due ? 'LATE by ' + (b - due) + ' day(s)' : early(due - b)}`);
      else if (a == null && b != null) items.push(`"${t.title}" scheduled to finish ${C.fmtDay(b)}`);
    });
    const r = learnedRatio();
    if (r.n) items.push(`Reality check: your finished tasks took ${r.seen}× their estimates, so future estimates are scaled by ${r.ratio}×.`);
    state.log = { title, items: items.length ? items.slice(0, 8) : ['No other task had to move. The buffer absorbed it.'] };
  }

  function advanceDay(didWork) {
    const before = snapshot();
    const today = C.toDay(state.today);
    const entry = current.plan.days.find((d) => d.day === today);
    let hours = 0;
    if (didWork && entry) entry.sessions.forEach((s) => {
      const t = taskById(s.id);
      t.doneH = C.round(t.doneH + s.hours, 2);
      hours += s.hours;
      if (t.doneH >= t.effortH * (current.tasks.find((x) => x.id === t.id).scale || 1) - 0.01) { t.effortH = t.doneH; t.completed = true; }
    });
    if (hours > 0) { state.activity = state.activity || {}; state.activity[state.today] = C.round((state.activity[state.today] || 0) + hours, 2); }
    state.today = C.fromDay(today + 1);
    selDay = viewDay = today + 1;
    replanLog(before, didWork ? `Logged ${C.round(hours, 1)}h from today. Moving to ${C.fmtDay(today + 1)}` : `Skipped ${C.fmtDay(today)}. Redistributing the work`);
    toast(didWork ? 'Nice. Progress logged and plan updated' : 'Plan rebalanced around the missed day');
    render();
  }

  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2400); }

  /* ---------- wiring ---------- */
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('main.tab').forEach((x) => x.classList.toggle('active', x.id === 'tab-' + b.dataset.tab));
  });
  $('btnExtract').addEventListener('click', () => {
    state.text = $('inputText').value;
    const { tasks, ignored } = C.extractTasks(state.text, state.today);
    // Re-extracting (e.g. after importing another file) keeps progress on tasks it finds again,
    // and keeps deadlines added by hand.
    const key = (t) => `${t.course}|${t.title}|${t.due}`.toLowerCase();
    const old = new Map(state.tasks.filter((t) => t.source).map((t) => [key(t), t]));
    const manual = state.tasks.filter((t) => !t.source);
    const idMap = {};
    let kept = 0;
    tasks.forEach((t) => {
      const o = old.get(key(t));
      idMap[t.id] = o ? o.id : `t${state.nextId++}`;
      t.origEst = t.effortH;
      if (o) { kept++; ['doneH', 'completed', 'started', 'origEst', 'effortH', 'effortSource'].forEach((f) => { if (o[f] !== undefined) t[f] = o[f]; }); }
    });
    tasks.forEach((t) => { t.id = idMap[t.id]; t.deps = t.deps.map((d) => idMap[d]); });
    const ids = new Set(tasks.map((t) => t.id).concat(manual.map((t) => t.id)));
    manual.forEach((t) => { t.deps = t.deps.filter((d) => ids.has(d)); });
    state.tasks = tasks.concat(manual); state.ignored = ignored;
    const files = [...new Set(tasks.map((t) => t.source.file).filter(Boolean))];
    state.log = { title: `Extracted ${tasks.length} tasks from your text`, items: [
      `${tasks.filter((t) => t.confidence === 'high').length} high-confidence, ${tasks.filter((t) => t.confidence !== 'high').length} worth double-checking (Tasks tab)`,
      ...(files.length ? [`${tasks.filter((t) => t.source.file).length} from imported files: ${files.join(', ')}`] : []),
      ...(kept ? [`Progress kept on ${kept} task(s) you already had`] : []),
      ...(manual.length ? [`${manual.length} deadline(s) you added by hand kept`] : []),
      `${tasks.filter((t) => t.deps.length).length} dependency link(s) detected`,
      `${ignored.length} line(s) skipped: no date, so nothing was guessed`] };
    importList.length = 0; renderImports();
    $('pasteModal').hidden = true;
    toast(`Found ${tasks.length} tasks`);
    render();
  });

  /* ---------- import: files, screenshots and links become text in the box above ---------- */
  const importList = []; // { name, status: 'busy' | 'done' | 'error', msg, pct }
  function renderImports() {
    $('importList').innerHTML = importList.map((it) => `<li class="${it.status}">
      ${ic(it.status === 'done' ? 'check-circle' : it.status === 'error' ? 'alert' : 'clock')}
      <span class="nm">${esc(it.name)}</span>
      <span class="msg">${esc(it.msg || '')}${it.pct != null && it.status === 'busy' ? ` ${Math.round(it.pct * 100)}%` : ''}</span></li>`).join('');
  }
  function appendImported(name, method, text) {
    const box = $('inputText');
    const body = text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    box.value = `${box.value.replace(/\s+$/, '')}${box.value.trim() ? '\n\n' : ''}--- from ${name.replace(/-{3}/g, '')} (${method}) ---\n${body}\n`;
    box.scrollTop = box.scrollHeight;
    return body ? body.split('\n').length : 0;
  }
  async function runImport(name, job) {
    const it = { name, status: 'busy', msg: 'Reading…' };
    importList.push(it); renderImports();
    const progress = (pct, msg) => { if (pct != null) it.pct = pct; if (msg) it.msg = msg; renderImports(); };
    try {
      const r = await job(progress);
      const lines = appendImported(r.name || name, r.method, r.text);
      const dated = C.extractTasks(r.text, state.today).tasks.length;
      Object.assign(it, { status: lines ? 'done' : 'error', pct: null,
        msg: lines ? `${r.method} · ${lines} line(s), ${dated} look like deadlines` : `${r.method} · no text found` });
    } catch (e) {
      Object.assign(it, { status: 'error', pct: null, msg: e.message || String(e) });
    }
    renderImports();
  }
  function importFiles(files) {
    if (!window.DuelineImport) { toast('Importer failed to load. You can still paste text'); return; }
    if ($('pasteModal').hidden || $('manyPane').hidden) openNew('many');
    [...files].forEach((f) => runImport(f.name || 'Pasted screenshot', (p) => window.DuelineImport.fileToText(f, p)));
  }
  $('fileInput').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
  $('dropZone').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } });
  ['dragenter', 'dragover'].forEach((ev) => $('dropZone').addEventListener(ev, (e) => { e.preventDefault(); $('dropZone').classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => $('dropZone').addEventListener(ev, () => $('dropZone').classList.remove('over')));
  // Files dropped anywhere (not on the task board) are imported instead of opening in the tab.
  document.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    importFiles(e.dataTransfer.files);
  });
  // A screenshot on the clipboard (⌘V / Ctrl+V) is read like an uploaded image. Plain text pastes as usual.
  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData ? e.clipboardData.files : [])];
    if (!files.length) return;
    e.preventDefault();
    importFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `Pasted screenshot${files.length > 1 ? ` ${i + 1}` : ''}.${(f.type.split('/')[1] || 'png')}`, { type: f.type }))));
  });
  $('urlForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('urlInput').value.trim();
    if (!url) return;
    if (!window.DuelineImport) { toast('Importer failed to load. You can still paste text'); return; }
    $('urlInput').value = '';
    runImport(url.replace(/^https?:\/\//, '').slice(0, 60), (p) => window.DuelineImport.urlToText(url, p));
  });

  $('btnDemo').addEventListener('click', () => { state = demoState(); $('pasteModal').hidden = true; render(); toast('Sample semester loaded'); });
  $('btnReset').addEventListener('click', () => { const now = new Date(); const realToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; state = { ...demoState(), today: realToday, activity: {}, text: '', tasks: [], ignored: [], log: null }; $('pasteModal').hidden = true; render(); });
  $('bufferDays').addEventListener('change', (e) => { state.settings.bufferDays = Math.max(0, +e.target.value || 0); render(); });
  $('prior').addEventListener('change', (e) => { state.settings.prior = Math.min(2, Math.max(1, +e.target.value || 1)); render(); });
  $('commitForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const before = snapshot();
    state.settings.commitments.push({ date: $('cDate').value, hours: +$('cHours').value, label: $('cLabel').value || 'busy' });
    replanLog(before, `Added busy time on ${C.fmtDay(C.toDay($('cDate').value))}`);
    e.target.reset(); render();
  });
  $('btnDayDone').addEventListener('click', () => advanceDay(true));
  $('btnDayMissed').addEventListener('click', () => advanceDay(false));
  $('btnSurprise').addEventListener('click', () => {
    const before = snapshot();
    const id = `t${state.nextId++}`;
    state.tasks.push({ id, title: 'Surprise assignment', course: state.tasks[0] ? state.tasks[0].course : 'General', type: 'assignment',
      due: C.fromDay(C.toDay(state.today) + 4), effortH: 5, origEst: 5, doneH: 0, weight: 10, deps: [], confidence: 'high',
      effortSource: 'default for assignment', notes: [], source: null });
    replanLog(before, 'A surprise assignment (5h, due in 4 days) was added');
    render(); toast('Surprise assignment added and plan rebalanced');
  });
  function setMode(mode) {
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('oneForm').hidden = mode !== 'one';
    $('manyPane').hidden = mode !== 'many';
  }
  function openNew(mode) {
    $('fType').innerHTML = C.TYPES.map((t) => `<option value="${t.type}">${t.label}</option>`).join('');
    $('fType').value = 'assignment';
    $('courseOptions').innerHTML = [...new Set(state.tasks.map((t) => t.course))].map((c) => `<option value="${esc(c)}">`).join('');
    $('fDep').innerHTML = '<option value="">Nothing</option>' + state.tasks.filter((t) => !t.completed).map((t) => `<option value="${t.id}">${esc(t.title)}</option>`).join('');
    $('fDue').min = state.today;
    if (!$('fDue').value || $('fDue').value < state.today) $('fDue').value = C.fromDay(C.toDay(state.today) + 7);
    setMode(mode);
    $('pasteModal').hidden = false;
    (mode === 'one' ? $('fTitle') : $('inputText')).focus();
  }
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  ['btnOpenPaste', 'btnNewTop', 'btnNewMid', 'btnAddTask'].forEach((id) => $(id).addEventListener('click', () => openNew('one')));
  $('menuBtn').addEventListener('click', () => openNew('many'));
  $('pasteClose').addEventListener('click', () => { $('pasteModal').hidden = true; });
  document.querySelectorAll('.pasteCancel').forEach((b) => b.addEventListener('click', () => { $('pasteModal').hidden = true; }));
  $('pasteModal').addEventListener('click', (e) => { if (e.target.id === 'pasteModal') $('pasteModal').hidden = true; });
  $('oneForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const before = snapshot();
    const type = $('fType').value;
    const effort = +$('fEffort').value || C.TYPES.find((t) => t.type === type).effort;
    const id = `t${state.nextId++}`;
    const dep = $('fDep').value;
    const title = $('fTitle').value.trim();
    state.tasks.push({ id, title, course: $('fCourse').value.trim() || 'General', type, due: $('fDue').value,
      effortH: effort, origEst: effort, doneH: 0, weight: $('fWeight').value === '' ? null : +$('fWeight').value,
      deps: dep ? [dep] : [], confidence: 'high', effortSource: $('fEffort').value ? 'entered' : `default for ${type}`,
      notes: dep ? [`Depends on "${taskById(dep).title}" (set by you)`] : [], source: null });
    replanLog(before, `Added "${title}" due ${C.fmtDay(C.toDay($('fDue').value))}`);
    e.target.reset();
    $('pasteModal').hidden = true;
    render();
    toast('Deadline added and plan updated');
  });
  $('drawerClose').addEventListener('click', () => { $('drawer').hidden = true; });
  $('drawer').addEventListener('click', (e) => { if (e.target.id === 'drawer') $('drawer').hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('drawer').hidden = true; $('pasteModal').hidden = true; } });

  /* ---------- Schedule tab: month / week / day calendar ---------- */
  const PILL = [['#e0ecff', '#1d4ed8'], ['#fce7f3', '#be185d'], ['#e3f5e1', '#2f7d32'], ['#efe4ff', '#6d28d9'], ['#fff1d6', '#b45309'], ['#dff6f4', '#0f766e'], ['#ffe8e0', '#c2410c'], ['#eceef3', '#3f4756']];
  const cal = { cursor: null, view: 'month', hidden: new Set(), q: '' };
  const coursePill = (course) => PILL[Math.max(0, [...new Set(state.tasks.map((t) => t.course))].indexOf(course)) % PILL.length];
  const DAYMS = 86400000;
  const monthStart = (d) => { const x = new Date(d * DAYMS); return Math.round(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1) / DAYMS); };
  const monthTitle = (d, withYear = true) => new Date(d * DAYMS).toLocaleString('en', { month: 'long', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' });
  const addMonths = (d, n) => { const x = new Date(d * DAYMS); return Math.round(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, 1) / DAYMS); };

  function eventsByDay() {
    const { plan } = current;
    const ev = {};
    const visible = (t) => !cal.hidden.has(t.course) && (!cal.q || `${t.title} ${t.course}`.toLowerCase().includes(cal.q));
    const push = (d, e) => { (ev[d] = ev[d] || []).push(e); };
    state.tasks.forEach((t) => {
      if (!visible(t)) return;
      const d = C.toDay(t.due);
      const ok = t.completed || (plan.finish[t.id] != null && plan.finish[t.id] <= d && !plan.unfinished[t.id]);
      push(d, { kind: 'due', t, ok });
    });
    plan.days.forEach((day) => {
      let h = startHour(day.day);
      day.sessions.forEach((s) => {
        const t = taskById(s.id);
        if (t && visible(t)) push(day.day, { kind: 'study', t, hours: s.hours, from: h });
        h += s.hours + 0.25;
      });
    });
    return ev;
  }

  function pillHtml(e, withTime) {
    if (e.kind === 'due') return `<div class="pill due ${e.ok ? 'ok' : ''}" data-id="${e.t.id}" title="Due: ${esc(e.t.title)}"><span>Due · ${esc(e.t.title)}</span></div>`;
    const [bg, fg] = coursePill(e.t.course);
    return `<div class="pill" style="--bg-c:${bg};--fg-c:${fg}" data-id="${e.t.id}" title="${esc(e.t.title)} · ${C.round(e.hours, 1)}h"><span>${withTime ? `<span class="t">${clock(e.from)} – ${clock(e.from + e.hours)}</span>` : ''}${esc(e.t.title)}${withTime ? '' : ` · ${C.round(e.hours, 1)}h`}</span></div>`;
  }

  function renderPlan() {
    const today = C.toDay(state.today);
    if (cal.cursor == null) cal.cursor = today;
    const ev = eventsByDay();
    // Change log on Home
    const log = state.log;
    $('changeLog').innerHTML = log ? `<div class="log"><button class="log-x" aria-label="Dismiss">${ic('x')}</button><strong>Plan updated</strong> · ${esc(log.title)}<ul>${log.items.slice(0, 3).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>${log.items.length > 3 ? `<div class="muted small">+${log.items.length - 3} more change(s)</div>` : ''}</div>` : '';
    const lx = $('changeLog').querySelector('.log-x');
    if (lx) lx.addEventListener('click', () => { state.log = null; save(); $('changeLog').innerHTML = ''; });

    // Sidebar: mini month
    const ms = monthStart(cal.cursor);
    $('miniTitle').textContent = monthTitle(ms, false);
    const gridStart = ms - C.weekday(ms);
    let mini = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<div class="wd">${d}</div>`).join('');
    for (let d = gridStart; d < gridStart + 42; d++) {
      const out = monthStart(d) !== ms;
      mini += `<button type="button" data-d="${d}" class="${out ? 'out' : ''} ${d === today ? 'today' : ''} ${d === cal.cursor ? 'sel' : ''} ${ev[d] && !out ? 'has' : ''}">${new Date(d * DAYMS).getUTCDate()}</button>`;
    }
    $('miniCal').innerHTML = mini;
    $('miniCal').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { cal.cursor = +b.dataset.d; renderPlan(); }));

    // Sidebar: course filters
    const courses = [...new Set(state.tasks.map((t) => t.course))];
    $('courseFilters').innerHTML = courses.map((c) => `<label class="cfilter" style="--c:${coursePill(c)[1]}"><input type="checkbox" data-c="${esc(c)}" ${cal.hidden.has(c) ? '' : 'checked'}>${courseTile(c, 22)}${esc(courseName(c).name)}</label>`).join('') || '<div class="muted small">No courses yet</div>';
    $('courseFilters').querySelectorAll('input').forEach((i) => i.addEventListener('change', () => { if (i.checked) cal.hidden.delete(i.dataset.c); else cal.hidden.add(i.dataset.c); renderPlan(); }));

    // Main view
    document.querySelectorAll('#calView button').forEach((b) => b.classList.toggle('active', b.dataset.v === cal.view));
    let html = '';
    const cell = (d, opts) => {
      const list = (ev[d] || []).sort((a, b) => (a.kind === 'due' ? -1 : 0) - (b.kind === 'due' ? -1 : 0) || (a.from || 0) - (b.from || 0));
      const max = opts.max || 3;
      const shown = list.slice(0, max).map((e) => pillHtml(e, opts.time)).join('');
      const more = list.length > max ? `<div class="more-n">+${list.length - max} more</div>` : '';
      return `<div class="mcell ${opts.out ? 'out' : ''} ${d < today ? 'past' : ''} ${d === today ? 'today' : ''} ${d === cal.cursor ? 'sel' : ''}" data-d="${d}"><div class="num">${new Date(d * DAYMS).getUTCDate()}</div>${shown}${more}</div>`;
    };
    const heads = C.WD.map((w) => `<div class="head">${w}</div>`).join('');
    if (cal.view === 'month') {
      $('calTitle').textContent = monthTitle(ms);
      const rows = Math.ceil((C.weekday(ms) + new Date(Date.UTC(new Date(ms * DAYMS).getUTCFullYear(), new Date(ms * DAYMS).getUTCMonth() + 1, 0)).getUTCDate()) / 7);
      html = `<div class="mgrid">${heads}`;
      for (let d = gridStart; d < gridStart + rows * 7; d++) html += cell(d, { out: monthStart(d) !== ms });
      html += '</div>';
    } else if (cal.view === 'week') {
      const ws = cal.cursor - C.weekday(cal.cursor);
      $('calTitle').textContent = `${C.fmtDay(ws).slice(4)} – ${C.fmtDay(ws + 6).slice(4)}`;
      html = `<div class="mgrid wgrid">${heads}`;
      for (let d = ws; d < ws + 7; d++) html += cell(d, { time: true, max: 12 });
      html += '</div>';
    } else {
      $('calTitle').textContent = C.fmtDay(cal.cursor);
      const list = ev[cal.cursor] || [];
      html = `<div class="dayview">${list.length ? list.map((e) => e.kind === 'due'
        ? `<div class="slot due ${e.ok ? 'ok' : ''}" data-id="${e.t.id}"><div class="badge">${ic(e.ok ? 'check' : 'flag')}${e.ok ? 'Ready' : 'Due'}</div><div><div class="title">${esc(e.t.title)}</div><div class="sub">${esc(courseName(e.t.course).name)}</div></div></div>`
        : `<div class="slot" data-id="${e.t.id}"><div class="time">${courseTile(e.t.course, 20)}${clock(e.from)} - ${clock(e.from + e.hours)}</div><div class="title">${esc(e.t.title)}</div><div class="sub">${esc(courseName(e.t.course).name)} · ${C.round(e.hours, 1)}h</div></div>`).join('')
        : `<div class="empty-day">${ic('coffee')}Nothing planned for this day</div>`}</div>`;
    }
    $('calGrid').innerHTML = html;
    $('calGrid').querySelectorAll('[data-id]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); openTask(el.dataset.id); }));
    $('calGrid').querySelectorAll('.mcell').forEach((el) => el.addEventListener('click', () => {
      const d = +el.dataset.d;
      if (d >= today) { $('fDue').value = C.fromDay(d); openNew('one'); } else { cal.cursor = d; renderPlan(); }
    }));
  }
  $('calView').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { cal.view = b.dataset.v; renderPlan(); } });
  $('calToday').addEventListener('click', () => { cal.cursor = C.toDay(state.today); renderPlan(); });
  const step = (n) => { cal.cursor = cal.view === 'month' ? addMonths(cal.cursor, n) : cal.cursor + n * (cal.view === 'week' ? 7 : 1); renderPlan(); };
  $('calPrev').addEventListener('click', () => step(-1));
  $('calNext').addEventListener('click', () => step(1));
  $('miniPrev').addEventListener('click', () => { cal.cursor = addMonths(cal.cursor, -1); renderPlan(); });
  $('miniNext').addEventListener('click', () => { cal.cursor = addMonths(cal.cursor, 1); renderPlan(); });
  $('calSearch').addEventListener('input', (e) => { cal.q = e.target.value.trim().toLowerCase(); renderPlan(); });
  $('btnNewCal').addEventListener('click', () => openNew('one'));

  /* ---------- Tasks: board ---------- */
  const TYPE_TAG = { exam: ['#fde2e4', '#9f1239'], midterm: ['#fde2e4', '#9f1239'], quiz: ['#dbeafe', '#1e40af'], project: ['#ede9fe', '#5b21b6'],
    presentation: ['#fce7f3', '#9d174d'], report: ['#ecfccb', '#3f6212'], lab: ['#ccfbf1', '#115e59'], assignment: ['#fef3c7', '#854d0e'] };
  const PRIO_TAG = { High: ['#fbd5d1', '#b42318'], Medium: ['#fde7c3', '#9a4b00'], Low: ['#d3f0ec', '#0f766e'] };
  let taskView = 'board';
  const COLS = [
    { key: 'todo', title: 'To do', dot: 'var(--muted)' },
    { key: 'doing', title: 'In progress', dot: 'var(--info)' },
    { key: 'risk', title: 'At risk', dot: 'var(--danger)' },
    { key: 'done', title: 'Done', dot: 'var(--ok)' },
  ];
  function columnOf(t) {
    const { plan } = current;
    if (t.completed) return 'done';
    if (plan.unfinished[t.id] || plan.finish[t.id] == null || plan.finish[t.id] > C.toDay(t.due)) return 'risk';
    if (t.started || t.doneH > 0) return 'doing';
    return 'todo';
  }
  function renderBoard() {
    const scores = Object.fromEntries(current.prio.map((r) => [r.id, r.score]));
    const courses = [...new Set(state.tasks.map((t) => t.course))];
    const today = C.toDay(state.today);
    const tag = (label, [b, f]) => `<span class="tag" style="--tb:${b};--tf:${f}">${esc(label)}</span>`;
    $('board').innerHTML = COLS.map((col) => {
      const items = state.tasks.filter((t) => columnOf(t) === col.key).sort((a, b) => a.due.localeCompare(b.due));
      const cards = items.map((t) => {
        const sc = scores[t.id];
        const prio = t.completed ? null : sc >= 38 ? 'High' : sc >= 28 ? 'Medium' : 'Low';
        const info = C.TYPES.find((x) => x.type === t.type) || C.TYPES[C.TYPES.length - 1];
        const due = C.toDay(t.due);
        const left = C.round(C.remaining({ ...t, scale: t.doneH > 0 ? 1 : current.ratio }), 1);
        const pct = t.effortH ? Math.min(100, Math.round((t.doneH / t.effortH) * 100)) : 0;
        const ci = Math.max(0, courses.indexOf(t.course));
        const dueTxt = due === today ? 'Today' : due === today + 1 ? 'Tomorrow' : C.fmtDay(due).slice(4);
        return `<div class="card ${t.completed ? 'done' : ''}" draggable="true" data-id="${t.id}">
          <h4>${esc(t.title)}</h4>
          ${col.key === 'doing' ? `<div class="progress-mini"><i style="width:${pct}%"></i></div>` : ''}
          <div class="tags">${prio ? tag(prio, PRIO_TAG[prio]) : tag('Completed', ['#d3f0ec', '#0f766e'])}${tag(info.label, TYPE_TAG[t.type] || TYPE_TAG.assignment)}${t.weight != null ? tag(`${t.weight}%`, ['#e5e7eb', '#374151']) : ''}</div>
          <div class="card-foot">
            <span class="f ${col.key === 'risk' ? 'late' : ''}">${ic('calendar')}${dueTxt}</span>
            ${t.completed ? '' : `<span class="f">${ic('hours')}${left}h left</span>`}
            <span class="spacer"></span>
            ${courseTile(t.course, 26)}
          </div></div>`;
      }).join('');
      return `<section class="bcol" data-col="${col.key}">
        <div class="bcol-head"><i class="dot" style="background:${col.dot}"></i><h3>${col.title}</h3><span class="count">${items.length}</span><span class="spacer"></span>
          ${col.key === 'todo' ? `<button class="icon-btn add-col" aria-label="New deadline">${ic('plus')}</button>` : ''}</div>
        ${cards || `<div class="empty-col">${col.key === 'risk' ? 'Nothing at risk' : col.key === 'done' ? 'Drag finished work here' : 'No tasks'}</div>`}
        ${col.key === 'todo' ? `<button class="add-new">${ic('plus')}Add new</button>` : ''}
      </section>`;
    }).join('');
    $('taskCount').textContent = `${state.tasks.length} tasks · ${state.tasks.filter((t) => t.completed).length} done`;
    $('board').querySelectorAll('.add-new, .add-col').forEach((b) => b.addEventListener('click', () => openNew('one')));
    $('board').querySelectorAll('.card').forEach((card) => {
      card.addEventListener('click', () => openTask(card.dataset.id));
      card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', card.dataset.id); card.classList.add('dragging'); });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
    $('board').querySelectorAll('.bcol').forEach((col) => {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('drop'); moveTask(e.dataTransfer.getData('text/plain'), col.dataset.col); });
    });
  }
  function moveTask(id, to) {
    const t = taskById(id);
    if (!t || columnOf(t) === to) return;
    if (to === 'risk') { toast('"At risk" is set by the planner from your free time'); return; }
    const before = snapshot();
    if (to === 'done') { t.completed = true; t.effortH = Math.max(t.doneH, t.effortH); t.doneH = t.effortH; }
    if (to === 'doing') { t.completed = false; t.started = true; }
    if (to === 'todo') { t.completed = false; t.started = false; t.doneH = 0; }
    replanLog(before, `"${t.title}" moved to ${COLS.find((c) => c.key === to).title}`);
    render();
    toast(`Moved to ${COLS.find((c) => c.key === to).title}`);
  }
  $('taskView').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    taskView = b.dataset.v;
    document.querySelectorAll('#taskView button').forEach((x) => x.classList.toggle('active', x === b));
    $('board').hidden = taskView !== 'board';
    $('tableView').hidden = taskView !== 'table';
  });

  /* ---------- theme ---------- */
  function applyThemeIcon() {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    $('themeBtn').innerHTML = ic(dark ? 'sun' : 'moon');
    $('themeBtn').title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    return dark;
  }
  $('themeBtn').addEventListener('click', () => {
    const next = applyThemeIcon() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('dueline-theme', next); } catch (e) { /* storage blocked */ }
    applyThemeIcon();
  });
  applyThemeIcon();

  /* ---------- shared chart helpers ---------- */
  const f1 = (x) => String(Math.round(x * 10) / 10);
  const NS = 'http://www.w3.org/2000/svg';
  // Rounded data-end, square at the baseline.
  function colPath(x, yTop, w, yBase) {
    const h = yBase - yTop;
    if (h <= 0.5) return '';
    const r = Math.min(4, h / 2, w / 2);
    return `M${x},${yBase}L${x},${yTop + r}Q${x},${yTop} ${x + r},${yTop}L${x + w - r},${yTop}Q${x + w},${yTop} ${x + w},${yTop + r}L${x + w},${yBase}Z`;
  }
  // One tooltip for every chart. Content is built with textContent (labels come from user text).
  function bindTips(root, items) {
    const tip = $('tip');
    const show = (el, x, y) => {
      const it = items[+el.dataset.ti];
      if (!it) return;
      tip.replaceChildren();
      const v = document.createElement('div'); v.className = 'tv'; v.textContent = it.value; tip.appendChild(v);
      const l = document.createElement('div'); l.className = 'tl'; l.textContent = it.label; tip.appendChild(l);
      (it.rows || []).forEach((r) => {
        const row = document.createElement('div'); row.className = 'row';
        const key = document.createElement('i'); key.style.background = r.color || 'var(--muted)';
        const tx = document.createElement('span'); tx.textContent = r.text;
        row.append(key, tx); tip.appendChild(row);
      });
      tip.hidden = false;
      const b = tip.getBoundingClientRect();
      tip.style.left = `${Math.min(window.innerWidth - b.width - 8, Math.max(8, x + 14))}px`;
      tip.style.top = `${Math.min(window.innerHeight - b.height - 8, Math.max(8, y + 14))}px`;
    };
    root.querySelectorAll('[data-ti]').forEach((el) => {
      el.addEventListener('pointermove', (e) => show(el, e.clientX, e.clientY));
      el.addEventListener('pointerleave', () => { tip.hidden = true; });
      el.addEventListener('focus', () => { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); });
      el.addEventListener('blur', () => { tip.hidden = true; });
    });
  }
  const isActive = (id) => $(id).classList.contains('active');

  /* ---------- Workload ---------- */
  function renderWorkload() {
    if (!current) return;
    const { plan, settings, live } = current;
    const today = C.toDay(state.today);
    const byDay = Object.fromEntries(plan.days.map((d) => [d.day, d]));
    const lastDue = live.length ? Math.max(...live.map((t) => C.toDay(t.due))) : today;
    const last = Math.max(today + 13, lastDue, ...plan.days.filter((d) => d.load > 0).map((d) => d.day));
    const days = [];
    for (let d = today; d <= last; d++) {
      const e = byDay[d] || { load: 0, sessions: [] };
      days.push({ d, cap: C.capacityOn(d, settings), load: e.load, sessions: e.sessions, dues: state.tasks.filter((t) => C.toDay(t.due) === d && !t.completed) });
    }
    $('wlRange').textContent = `${C.fmtDay(today)} to ${C.fmtDay(last)}`;

    // KPI tiles
    const wk = days.slice(0, 7);
    const wkLoad = wk.reduce((a, x) => a + x.load, 0), wkCap = wk.reduce((a, x) => a + x.cap, 0);
    const toDue = days.filter((x) => x.d <= lastDue);
    const allLoad = toDue.reduce((a, x) => a + x.load, 0), allCap = toDue.reduce((a, x) => a + x.cap, 0);
    const peak = days.reduce((m, x) => (x.load > m.load ? x : m), days[0]);
    const soon = live.filter((t) => C.toDay(t.due) - today <= 7).sort((a, b) => a.due.localeCompare(b.due));
    const util = allCap ? allLoad / allCap : 0;
    $('wlKpis').innerHTML = `
      <div class="kt">${decoTile(4)}<div class="kl">Next 7 days</div><div class="kv">${f1(wkLoad)}<small>h</small></div><div class="ks">of ${f1(wkCap)}h free</div><div class="meter2"><i style="width:${wkCap ? Math.min(100, (wkLoad / wkCap) * 100) : 0}%"></i></div></div>
      <div class="kt">${decoTile(2)}<div class="kl">Free time used</div><div class="kv">${Math.round(util * 100)}<small>%</small></div><div class="ks">until ${C.fmtDay(lastDue)}</div><div class="meter2"><i style="width:${Math.min(100, util * 100)}%"></i></div></div>
      <div class="kt">${decoTile(5)}<div class="kl">Busiest day</div><div class="kv">${f1(peak.load)}<small>h</small></div><div class="ks">${C.fmtDay(peak.d)}</div></div>
      <div class="kt">${decoTile(1)}<div class="kl">Due in 7 days</div><div class="kv">${soon.length}</div><div class="ks">${soon[0] ? esc(soon[0].title) : 'nothing due'}</div></div>`;

    // Daily columns: free-time track behind, planned hours in front
    const box = $('wlDaily');
    const W = Math.max(340, box.clientWidth || 1000), H = 250, L = 34, R = 6, T = 10, B = 46;
    const n = days.length, band = (W - L - R) / n, bw = Math.min(24, band * 0.64);
    const maxY = Math.max(4, Math.ceil(Math.max(...days.map((x) => Math.max(x.cap, x.load))) / 2) * 2);
    const y = (v) => T + (1 - v / maxY) * (H - T - B);
    const base = y(0);
    let svg = `<svg class="viz-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Planned study hours per day compared with free time">`;
    for (let g = 0; g <= maxY; g += 2) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}"/><text class="tick" x="${L - 8}" y="${y(g) + 4}" text-anchor="end">${g}h</text>`;
    const tips = [];
    days.forEach((x, i) => {
      const cx = L + i * band, bx = cx + (band - bw) / 2;
      const names = x.sessions.map((s) => ({ color: 'var(--viz-accent)', text: `${(taskById(s.id) || {}).title} · ${f1(s.hours)}h` }));
      x.dues.forEach((t) => names.push({ color: 'var(--text)', text: `Due: ${t.title}` }));
      tips.push({ value: `${f1(x.load)}h of ${f1(x.cap)}h`, label: C.fmtDay(x.d), rows: names });
      svg += `<g class="col" ><path class="track" d="${colPath(bx, y(x.cap), bw, base)}"/><path class="fill" d="${colPath(bx, y(Math.min(x.load, maxY)), bw, base)}"/>`;
      svg += `<rect class="hit" x="${cx}" y="${T}" width="${band}" height="${H - T}" tabindex="0" data-ti="${i}" aria-label="${C.fmtDay(x.d)}: ${f1(x.load)} of ${f1(x.cap)} hours"/></g>`;
      if (x.dues.length) { const mx = cx + band / 2, my = base + 8; svg += `<path class="due-mark" d="M${mx},${my}l4.5,8h-9z"/>`; }
      if (i === 0) svg += `<text class="tick today-tick" x="${cx + band / 2}" y="${H - 6}" text-anchor="middle">Today</text>`;
      else if (C.weekday(x.d) === 1) svg += `<line class="grid" x1="${cx}" x2="${cx}" y1="${T}" y2="${base}" opacity=".6"/><text class="tick" x="${cx + band / 2}" y="${H - 6}" text-anchor="middle">${C.fmtDay(x.d).slice(4)}</text>`;
    });
    svg += `<line x1="${L}" x2="${W - R}" y1="${base}" y2="${base}" stroke="var(--faint)" stroke-width="1"/></svg>`;
    box.innerHTML = svg;
    bindTips(box, tips);
    $('wlDailyTable').innerHTML = `<table><thead><tr><th>Day</th><th>Planned (h)</th><th>Free (h)</th><th>Deadlines</th></tr></thead><tbody>${days.map((x) => `<tr><td>${C.fmtDay(x.d)}</td><td>${f1(x.load)}</td><td>${f1(x.cap)}</td><td>${x.dues.length || ''}</td></tr>`).join('')}</tbody></table>`;

    // Study activity map: weeks as columns, Mon..Sun as rows. Logged hours before today, planned from today.
    const act = state.activity || {};
    const hoursOn = (d) => (d < today ? +(act[C.fromDay(d)] || 0) : (byDay[d] ? byDay[d].load : 0));
    const lastActive = Math.max(last, today + 27);
    const start = (today - 56) - ((C.weekday(today - 56) + 6) % 7); // Monday, 8 weeks back
    const end = lastActive + (6 - ((C.weekday(lastActive) + 6) % 7)); // through Sunday
    const weeks = Math.round((end - start + 1) / 7);
    const mapBox = $('wlMap');
    const availW = Math.max(300, mapBox.clientWidth || 700);
    const LBL = 34, TOP = 20, gap = 4;
    const cell = Math.max(11, Math.min(22, Math.floor((availW - LBL) / weeks) - gap));
    const MW = LBL + weeks * (cell + gap), MH = TOP + 7 * (cell + gap);
    const level = (h) => (h <= 0 ? 0 : h < 1.5 ? 1 : h < 3 ? 2 : h < 4.5 ? 3 : 4);
    const FILL = ['var(--panel)', 'color-mix(in srgb, var(--viz-accent) 30%, var(--panel))', 'color-mix(in srgb, var(--viz-accent) 55%, var(--panel))', 'color-mix(in srgb, var(--viz-accent) 78%, var(--panel))', 'var(--viz-accent)'];
    let msvg = `<svg width="${MW}" height="${MH}" viewBox="0 0 ${MW} ${MH}" role="img" aria-label="Study hours per day, logged and planned">`;
    [['Mon', 0], ['Wed', 2], ['Fri', 4]].forEach(([t, r]) => { msvg += `<text class="lbl" x="0" y="${TOP + r * (cell + gap) + cell * 0.75}">${t}</text>`; });
    const mtips = [];
    let lastMonth = -1, total = 0, activeDays = 0, run = 0, best = 0, bestWeek = { h: 0, d: start };
    for (let w = 0; w < weeks; w++) {
      const x = LBL + w * (cell + gap);
      const wkStart = start + w * 7;
      const m = new Date(wkStart * 86400000).getUTCMonth();
      if (m !== lastMonth && (w === 0 || new Date((wkStart) * 86400000).getUTCDate() <= 7)) {
        msvg += `<text class="lbl" x="${x}" y="12">${new Date(wkStart * 86400000).toLocaleString('en', { month: 'short', timeZone: 'UTC' })}</text>`;
        lastMonth = m;
      }
      let wh = 0;
      for (let r = 0; r < 7; r++) {
        const d = wkStart + r;
        const h = d <= lastActive ? hoursOn(d) : 0;
        wh += h;
        if (h > 0) { total += h; activeDays += 1; run += 1; best = Math.max(best, run); } else { run = 0; }
        const dues = state.tasks.filter((t) => C.toDay(t.due) === d);
        mtips.push({ value: h > 0 ? `${f1(h)}h ${d < today ? 'logged' : 'planned'}` : d < today ? 'Nothing logged' : 'Nothing planned', label: C.fmtDay(d) + (d === today ? ' · today' : ''), rows: dues.map((t) => ({ color: 'var(--text)', text: `Due: ${t.title}` })) });
        msvg += `<rect class="c ${d === today ? 'today' : ''}" x="${x}" y="${TOP + r * (cell + gap)}" width="${cell}" height="${cell}" rx="3" style="fill:${FILL[level(h)]}" tabindex="0" data-ti="${mtips.length - 1}"/>`;
      }
      if (wh > bestWeek.h) bestWeek = { h: wh, d: wkStart };
    }
    mapBox.innerHTML = msvg + '</svg>';
    bindTips(mapBox, mtips);
    const loggedH = Object.entries(act).filter(([k]) => C.toDay(k) < today).reduce((a, [, v]) => a + +v, 0);
    $('mapTitle').textContent = `${f1(total)}h of study across ${activeDays} days`;
    $('wlMapSide').innerHTML = `
      <div class="ms"><b>${f1(loggedH)}h</b><span>logged so far</span></div>
      <div class="ms"><b>${best} days</b><span>longest study streak</span></div>
      <div class="ms"><b>${f1(bestWeek.h)}h</b><span>busiest week · ${C.fmtDay(bestWeek.d).slice(4)}</span></div>`;
    const actRows = [];
    for (let d = start; d <= lastActive; d++) { const h = hoursOn(d); if (h > 0) actRows.push(`<tr><td>${C.fmtDay(d)}</td><td>${f1(h)}</td><td>${d < today ? 'logged' : 'planned'}</td></tr>`); }
    $('wlMapTable').innerHTML = `<table><thead><tr><th>Day</th><th>Hours</th><th>Type</th></tr></thead><tbody>${actRows.join('')}</tbody></table>`;

    // Hours left by course (single series)
    const per = {};
    live.forEach((t) => { per[t.course] = per[t.course] || { h: 0, n: 0 }; per[t.course].h += C.remaining(t); per[t.course].n += 1; });
    const rows = Object.entries(per).sort((a, b) => b[1].h - a[1].h);
    const mx = Math.max(1, ...rows.map((r) => r[1].h));
    $('wlCourseSub').textContent = `${f1(rows.reduce((a, r) => a + r[1].h, 0))}h in total`;
    $('wlCourses').innerHTML = rows.map(([c, v]) => `<div class="hb"><div class="hn">${courseTile(c, 22)}<span class="nm">${esc(courseName(c).name)}</span><span>${v.n} task${v.n > 1 ? 's' : ''}</span></div><div class="hv">${f1(v.h)}h</div><div class="ht"><i style="width:${(v.h / mx) * 100}%"></i></div></div>`).join('') || '<div class="muted small">No open tasks</div>';
  }

  /* ---------- Results (minimal) ---------- */
  function renderProof() {
    const E = window.CRUNCH_EVAL;
    if (!E) { $('proof').innerHTML = '<div class="empty">Run <code>node eval/run_eval.js</code> to generate results.</div>'; return; }
    const s = E.summary, ours = s.crunch, lm = s.lastminute, gr = s.duedate;
    const fewer = Math.round((1 - ours.crunchDays / gr.crunchDays) * 100);
    const bar = (name, v, color, strong) => `<div class="cb ${strong ? 'ours' : ''}"><span class="cn">${name}</span><span class="ct"><i style="width:${v}%;background:${color}"></i></span><span class="cv">${Math.round(v)}%</span></div>`;
    const P = [['Dueline', 'crunch'], ['Last-minute', 'lastminute'], ['Grind', 'duedate']];
    const rows = [['On time (%)', 'onTimePct'], ['Deadlines missed', 'missed'], ['Work left undone (h)', 'unfinishedHours'], ['Crunch days (7h+)', 'crunchDays'], ['Busiest day (h)', 'peakDay'], ['Days finished early', 'avgBufferDays'], ['Part 2 before Part 1', 'depViolations']];
    $('proof').innerHTML = `
      <section class="rhero">
        <div class="rh-num">
          <div class="big">${Math.round(ours.onTimePct)}<span>%</span></div>
          <div class="cap">of deadlines met on time</div>
        </div>
        <div class="rh-bars">
          ${bar('Dueline', ours.onTimePct, 'var(--viz-accent)', true)}
          ${bar('Last-minute', lm.onTimePct, 'var(--viz-gray-1)', false)}
          <div class="rh-delta">+${Math.round(ours.onTimePct - lm.onTimePct)} points over studying last-minute</div>
        </div>
      </section>
      <section class="rtiles">
        <div class="rt2">${decoTile(0)}<b>${f1(ours.unfinishedHours)}<small>h</small></b><span>work left undone at deadlines</span><em>vs ${f1(lm.unfinishedHours)}h last-minute</em></div>
        <div class="rt2">${decoTile(2)}<b>${f1(ours.avgBufferDays)}<small> days</small></b><span>finished before the deadline</span><em>vs ${f1(lm.avgBufferDays)} days last-minute</em></div>
        <div class="rt2">${decoTile(3)}<b>−${fewer}<small>%</small></b><span>fewer crunch days</span><em>vs grinding every free hour (${Math.round(gr.onTimePct)}% on time)</em></div>
      </section>
      <details class="rmethod">
        <summary>How we tested</summary>
        <p>${E.scenarios} simulated semesters that were never used for tuning. Each one has effort overruns (1.25× typical), a surprise task, a deadline moved 3 days earlier and 2 sick days. Every approach replans daily with only what a student would know that day. Reproduce with <code>node eval/run_eval.js</code>.</p>
        <table><thead><tr><th>Mean per semester</th>${P.map(([n]) => `<th>${n}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(([t, k]) => `<tr><td>${t}</td>${P.map(([, key]) => `<td>${f1(s[key][k])}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </details>`;
  }

  // Charts size to their container, so redraw on resize and when a tab opens.
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (isActive('tab-home')) renderRadar(); if (isActive('tab-priorities')) renderPrio(); if (isActive('tab-workload')) renderWorkload(); }, 150); });
  $('tabs').addEventListener('click', () => { requestAnimationFrame(() => { if (isActive('tab-priorities')) renderPrio(); if (isActive('tab-workload')) renderWorkload(); }); });

  /* ---------- Home: deadlines-ahead card ---------- */
  function renderRadar() {
    if (!current) return;
    const { plan, live } = current;
    const today = C.toDay(state.today);
    const DAYS = 14;
    const isRisk = (t) => plan.unfinished[t.id] || plan.finish[t.id] == null || plan.finish[t.id] > C.toDay(t.due);
    const box = $('radarViz');
    const W = Math.max(240, box.clientWidth || 300), H = 104, L = 8, R = 8, base = 78;
    const x = (d) => L + ((d - today) / (DAYS - 1)) * (W - L - R);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Deadlines in the next 14 days">`;
    svg += `<line x1="${x(today)}" x2="${x(today + DAYS - 1)}" y1="${base}" y2="${base}" stroke="var(--line)" stroke-width="2" stroke-linecap="round"/>`;
    for (let d = today; d < today + DAYS; d++) {
      const wkend = [0, 6].includes(C.weekday(d));
      svg += `<line x1="${x(d)}" x2="${x(d)}" y1="${base - 3}" y2="${base + 3}" stroke="${wkend ? 'var(--faint)' : 'var(--muted)'}" stroke-width="1"/>`;
    }
    svg += `<circle cx="${x(today)}" cy="${base}" r="4" fill="var(--text)"/>`;
    svg += `<text x="${x(today)}" y="${H - 4}" font-size="10.5" fill="var(--text)" font-weight="600">Today</text>`;
    svg += `<text x="${x(today + 7)}" y="${H - 4}" font-size="10.5" fill="var(--muted)" text-anchor="middle">${C.fmtDay(today + 7).slice(4)}</text>`;
    svg += `<text x="${x(today + DAYS - 1)}" y="${H - 4}" font-size="10.5" fill="var(--muted)" text-anchor="end">${C.fmtDay(today + DAYS - 1).slice(4)}</text>`;
    const soon = live.filter((t) => { const d = C.toDay(t.due); return d >= today && d < today + DAYS; }).sort((a, b) => a.due.localeCompare(b.due));
    const perDay = {};
    const tips = [];
    soon.forEach((t) => {
      const d = C.toDay(t.due);
      const k = perDay[d] = (perDay[d] || 0) + 1;
      const cy = base - 18 - (k - 1) * 16;
      const r = 4 + Math.min(3.5, (t.weight == null ? 10 : t.weight) / 5);
      const risk = isRisk(t);
      tips.push({ value: t.title, label: `${C.fmtDay(d)} · ${f1(C.remaining({ ...t, scale: t.doneH > 0 ? 1 : current.ratio }))}h left${t.weight != null ? ` · ${t.weight}% of grade` : ''}`, rows: [{ color: risk ? 'var(--warn)' : 'var(--viz-accent)', text: risk ? 'At risk' : 'On track' }] });
      svg += `<g class="pin" tabindex="0" data-ti="${tips.length - 1}"><line x1="${x(d)}" x2="${x(d)}" y1="${base}" y2="${cy}" stroke="var(--faint)" stroke-width="1.5"/>`;
      svg += `<circle class="dotm" cx="${x(d)}" cy="${cy}" r="${r}" style="fill:${risk ? 'var(--warn)' : 'var(--viz-accent)'}" stroke="var(--surface)" stroke-width="2"/>`;
      svg += `<circle cx="${x(d)}" cy="${cy}" r="11" fill="transparent"/></g>`;
    });
    if (soon[0]) {
      const d0 = C.toDay(soon[0].due);
      const lx = x(d0), anchor = lx > W * 0.6 ? 'end' : 'start';
      const ty = base - 18 - ((perDay[d0] || 1) - 1) * 16 - 14;
      const label = soon[0].title.length > 24 ? soon[0].title.slice(0, 23) + '…' : soon[0].title;
      svg += `<text x="${anchor === 'start' ? lx - 4 : lx + 4}" y="${Math.max(10, ty)}" font-size="11" fill="var(--text)" font-weight="600" text-anchor="${anchor}">Next: ${esc(label)}</text>`;
    }
    box.innerHTML = svg + '</svg>';
    bindTips(box, tips);
    $('radarSub').textContent = soon.length ? `${soon.length} in the next 14 days` : 'nothing due in the next 14 days';

    // Three buckets: count and hours of work
    const bucket = (lo, hi) => live.filter((t) => { const d = C.toDay(t.due) - today; return d >= lo && d <= hi; });
    const B = [['This week', bucket(-999, 6)], ['Next week', bucket(7, 13)], ['Later', bucket(14, 9999)]]
      .map(([label, ts]) => ({ label, n: ts.length, h: ts.reduce((a, t) => a + C.remaining({ ...t, scale: t.doneH > 0 ? 1 : current.ratio }), 0) }));
    const mh = Math.max(1, ...B.map((b) => b.h));
    $('radarBuckets').innerHTML = B.map((b) => `<div class="rb"><b>${b.n}</b><div class="rl">${b.label}</div><div class="rh"><i style="--w:${Math.round((b.h / mh) * 100)}%"></i>${f1(b.h)}h</div></div>`).join('');
  }
  $('btnPasteMany').addEventListener('click', () => openNew('many'));

  render();
})();
