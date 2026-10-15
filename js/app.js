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
    return { today: S.today, text: S.text, tasks, ignored, settings: JSON.parse(JSON.stringify({ ...S.settings, prior: 1 })), log: null, nextId: tasks.length + 1 };
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
    renderPressure();
    renderProof();
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
    $('extractInfo').innerHTML = n ? `Found <b>${n}</b> tasks · ${state.ignored.length} line(s) skipped (see Tasks tab)` : '';
  }

  function renderKpis() {
    const { live, plan, metrics, settings, ratio } = current;
    const hoursLeft = live.reduce((a, t) => a + C.remaining(t), 0);
    const today = C.toDay(state.today);
    const atRisk = live.filter((t) => plan.unfinished[t.id] || plan.finish[t.id] == null || plan.finish[t.id] > C.toDay(t.due));
    const next = [...live].sort((a, b) => a.due.localeCompare(b.due))[0];
    const days = next ? C.toDay(next.due) - today : null;
    const onTrack = live.length ? (live.length - atRisk.length) / live.length : 1;
    const R = 42, L = 2 * Math.PI * R;
    $('healthRing').innerHTML = `<svg width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="${R}" fill="none" stroke="#fdecea" stroke-width="7"/>
      <circle cx="48" cy="48" r="${R}" fill="none" stroke="#ee6352" stroke-width="7" stroke-linecap="round" stroke-dasharray="${L * onTrack} ${L}" transform="rotate(-90 48 48)"/></svg>
      <div class="face">${ic('cap')}</div>`;
    $('healthLabel').innerHTML = `<div class="level">${Math.round(onTrack * 100)}% on track · ${atRisk.length ? `${atRisk.length} deadline(s) at risk` : 'every deadline fits'}</div>`;
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
      html += `<div class="slot" data-id="${t.id}"><button class="more" aria-hidden="true" tabindex="-1">${ic('more')}</button><div class="time"><span style="color:${color === '#f2b8b5' ? '#e5484d' : color};display:inline-flex">${ic('clock')}</span>${clock(h)} - ${clock(h + s.hours)}</div>
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
    const { prio } = current;
    $('prioList').innerHTML = prio.map((r) => {
      const t = taskById(r.id);
      const p = r.parts;
      return `<div class="prio" data-id="${r.id}">
        <div class="rank">#${r.rank}</div>
        <div><h4>${esc(t.title)}</h4><div class="hint" style="margin:0">${esc(t.course)} · due ${C.fmtDay(C.toDay(t.due))} · ${C.round(C.remaining({ ...t, scale: current.ratio }), 1)}h left</div>
          <ul>${r.why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>
        <div class="bars"><div class="score">${r.score}</div>
          <div class="stack"><i class="k-u" style="width:${p.urgency}%"></i><i class="k-i" style="width:${p.importance}%"></i><i class="k-e" style="width:${p.effort}%"></i><i class="k-b" style="width:${p.unblocks}%"></i></div>
          <div class="keys"><span><i class="dot k-u"></i>urgency ${p.urgency}</span><span><i class="dot k-i"></i>weight ${p.importance}</span><span><i class="dot k-e"></i>effort ${p.effort}</span><span><i class="dot k-b"></i>unblocks ${p.unblocks}</span></div></div>
      </div>`;
    }).join('') || '<div class="empty">No open tasks. Paste some deadlines.</div>';
    $('prioList').querySelectorAll('.prio').forEach((el) => el.addEventListener('click', () => openTask(el.dataset.id)));
  }

  function renderTasks() {
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
      <td class="src" title="${esc(t.source ? t.source.text : '')}">${t.source ? `L${t.source.line}: ${esc(t.source.text)}` : 'added manually'}</td>
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
      ? `<b>Skipped lines</b> (no deadline found, so nothing was guessed):<br>${state.ignored.map((i) => `L${i.line}: <code>${esc(i.text)}</code> (${esc(i.why)})`).join('<br>')}` : '';
  }

  function renderPressure() {
    const { plan, base, metrics, baseMetrics, settings, live } = current;
    const today = C.toDay(state.today);
    const last = Math.max(today + 6, ...plan.days.map((d) => d.day), ...base.days.map((d) => d.day));
    const n = last - today + 1;
    const W = Math.max(700, n * 30), H = 230, pad = 28;
    const maxY = Math.max(4, ...plan.days.map((d) => d.cap), ...base.days.map((d) => d.load));
    const bw = (W - pad * 2) / n;
    const y = (v) => H - pad - (v / maxY) * (H - pad * 2);
    const get = (p, d) => (p.days.find((x) => x.day === d) || { load: 0 }).load;
    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily load chart">`;
    for (let g = 0; g <= maxY; g += 2) svg += `<line x1="${pad}" x2="${W - pad}" y1="${y(g)}" y2="${y(g)}" stroke="#e4e4e7" stroke-width="1"/><text x="4" y="${y(g) + 4}" fill="#74747a" font-size="10">${g}h</text>`;
    for (let i = 0; i < n; i++) {
      const d = today + i, x = pad + i * bw;
      const cap = C.capacityOn(d, settings);
      svg += `<rect x="${x + 1}" y="${y(cap)}" width="${bw - 2}" height="${H - pad - y(cap)}" fill="#f4f4f5" rx="3"/>`;
      const a = get(plan, d), b = get(base, d);
      svg += `<rect x="${x + 3}" y="${y(a)}" width="${(bw - 6) / 2}" height="${H - pad - y(a)}" fill="#ee6352" rx="2"><title>${C.fmtDay(d)}: Dueline ${a}h</title></rect>`;
      svg += `<rect x="${x + 3 + (bw - 6) / 2}" y="${y(b)}" width="${(bw - 6) / 2}" height="${H - pad - y(b)}" fill="#3a3a40" rx="2"><title>${C.fmtDay(d)}: last-minute ${b}h</title></rect>`;
      if (live.some((t) => C.toDay(t.due) === d)) svg += `<circle cx="${x + bw / 2}" cy="${pad - 10}" r="4" fill="#f5a524"><title>${esc(live.filter((t) => C.toDay(t.due) === d).map((t) => t.title).join(', '))}</title></circle>`;
      if (i % Math.ceil(n / 20) === 0) svg += `<text x="${x + bw / 2}" y="${H - 8}" fill="#74747a" font-size="10" text-anchor="middle">${C.fmtDay(d).slice(4)}</text>`;
    }
    $('pressureChart').innerHTML = svg + '</svg>';
    const cell = (label, a, b, unit, better) => `<div><div class="label">${label}</div><div class="vals"><span class="ours">${a}${unit}</span><span class="base">vs ${b}${unit}</span></div><div class="hint" style="margin:2px 0 0">${better}</div></div>`;
    $('pressureCmp').innerHTML =
      cell('Deadlines at risk', metrics.missed, baseMetrics.missed, '', 'Dueline vs last-minute') +
      cell('Crunch days (≥6h or ≥90% of free time)', metrics.crunchDays, baseMetrics.crunchDays, '', 'fewer means less burnout') +
      cell('Avg. days finished early', metrics.avgBufferDays, baseMetrics.avgBufferDays, '', 'slack for surprises') +
      cell('Order violations', metrics.depViolations, baseMetrics.depViolations, '', 'starting Part 2 before Part 1');
    // Weeks where planned load is high relative to free time
    const weeks = {};
    plan.days.forEach((d) => { const wk = d.day - ((C.weekday(d.day) + 6) % 7); weeks[wk] = weeks[wk] || { load: 0, cap: 0 }; weeks[wk].load += d.load; weeks[wk].cap += d.cap; });
    const hot = Object.entries(weeks).filter(([, w]) => w.cap && w.load / w.cap >= 0.75);
    $('hotspots').innerHTML = hot.length ? hot.map(([wk, w]) => {
      const dues = live.filter((t) => { const d = C.toDay(t.due); return d >= +wk && d < +wk + 7; });
      return `<div class="hot">${ic('flame')}<div><b>Pressure point: week of ${C.fmtDay(+wk)}</b>: ${C.round(w.load, 1)}h planned of ${C.round(w.cap, 1)}h free (${Math.round((w.load / w.cap) * 100)}%). Due that week: ${esc(dues.map((t) => t.title).join(', ') || 'none, but earlier work spills in')}.</div></div>`;
    }).join('') : '<div class="hint">No week above 75% of your free time. Nice.</div>';
  }

  function renderProof() {
    const E = window.CRUNCH_EVAL;
    if (!E) { $('proof').innerHTML = '<div class="empty">Run <code>node eval/run_eval.js</code> to generate results.</div>'; return; }
    const s = E.summary;
    const rows = [
      ['On-time tasks', 'onTimePct', '%', 'max'],
      ['Deadlines missed / semester', 'missed', '', 'min'],
      ['Work left undone at deadline (h)', 'unfinishedHours', '', 'min'],
      ['Crunch days (≥7h)', 'crunchDays', '', 'min'],
      ['Peak day (h)', 'peakDay', '', 'min'],
      ['Daily load std. dev. (h)', 'loadSd', '', 'min'],
      ['Avg. days finished early', 'avgBufferDays', '', 'max'],
      ['Started Part 2 before Part 1', 'depViolations', '', 'min'],
    ];
    const keys = ['crunch', 'lastminute', 'duedate'];
    const table = `<table class="proof-table"><thead><tr><th>Metric (mean of ${E.scenarios} unseen semesters)</th>${keys.map((k) => `<th>${esc(s[k].label)}</th>`).join('')}</tr></thead><tbody>${
      rows.map(([label, k, unit, dir]) => {
        const vals = keys.map((p) => s[p][k]);
        const best = dir === 'max' ? Math.max(...vals) : Math.min(...vals);
        return `<tr><td>${label}</td>${vals.map((v) => `<td class="${v === best ? 'best' : ''}">${v}${unit}</td>`).join('')}</tr>`;
      }).join('')}</tbody></table>`;
    const ours = s.crunch, lm = s.lastminute, gr = s.duedate;
    $('proof').innerHTML = `
      <div class="proof-hero">
        <div><div class="label hint">On-time vs. last-minute student</div><div class="big">${ours.onTimePct}% <span style="font-size:16px;color:var(--muted)">vs ${lm.onTimePct}%</span></div><div class="hint">same tasks, same free time, same surprises</div></div>
        <div><div class="label hint">Work left undone at deadlines</div><div class="big">${ours.unfinishedHours}h <span style="font-size:16px;color:var(--muted)">vs ${lm.unfinishedHours}h</span></div><div class="hint">per semester, vs last-minute</div></div>
        <div><div class="label hint">Crunch days vs. "grind every free hour"</div><div class="big">${ours.crunchDays} <span style="font-size:16px;color:var(--muted)">vs ${gr.crunchDays}</span></div><div class="hint">${Math.round((1 - ours.crunchDays / gr.crunchDays) * 100)}% fewer, at ${C.round(gr.onTimePct - ours.onTimePct, 1)} pts lower on-time rate</div></div>
      </div>
      ${table}
      <div class="method"><b>How this was measured.</b> ${esc(E.method)} Every policy replans each day using only what a student would know that day. Overruns only show up once the estimate runs out. Dueline also learns your overrun ratio from finished tasks. Settings were tuned on separate seeds 1-30 (<code>eval/tune.js</code>). The ${E.scenarios} test semesters (seeds ${E.seeds}) were never used for tuning. Reproduce with <code>node eval/run_eval.js</code>.<br><br><b>Honest trade-off:</b> grinding every free hour, earliest deadline first, finishes slightly more tasks on time. Dueline gives up ${C.round(gr.onTimePct - ours.onTimePct, 1)} points of on-time rate for ${Math.round((1 - ours.crunchDays / gr.crunchDays) * 100)}% fewer crunch days and a steadier daily load, and no real student grinds every free hour. Results come from simulated semesters, not real students.</div>`;
  }

  /* ---------- task drawer ---------- */
  function openTask(id) {
    const t = taskById(id);
    if (!t) return;
    const r = current.prio.find((x) => x.id === id);
    const sessions = current.plan.days.flatMap((d) => d.sessions.filter((s) => s.id === id).map((s) => `${C.fmtDay(d.day)}: ${fmtH(s.hours)}`));
    const fin = current.plan.finish[id];
    $('drawerBody').innerHTML = `
      <h3>${esc(t.title)}</h3>
      <div class="hint">${esc(t.course)} · ${esc(t.type)} · due ${C.fmtDay(C.toDay(t.due))} · ${t.weight == null ? 'weight unknown' : t.weight + '% of grade'}</div>
      ${t.completed ? '<p><b style="color:var(--ok)">Completed</b></p>' : `
      <p><b>${r ? `Priority #${r.rank} (score ${r.score})` : ''}</b></p>
      <ul>${(r ? r.why : []).map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
      <p><b>Plan:</b> ${C.round(C.remaining({ ...t, scale: t.doneH > 0 ? 1 : current.ratio }), 1)}h left → ${sessions.length ? sessions.join(' · ') : 'not scheduled'}${fin != null ? ` · finishes ${C.fmtDay(fin)} (${early(C.toDay(t.due) - fin)})` : ''}</p>`}
      ${t.notes && t.notes.length ? `<p><b>Dependencies:</b></p><ul>${t.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      <p><b>Evidence:</b> effort ${t.effortH}h (${esc(t.effortSource || 'entered')}), confidence ${esc(t.confidence)}</p>
      ${t.source ? `<blockquote>Line ${t.source.line}: ${esc(t.source.text)}</blockquote>` : ''}
      ${t.completed ? '' : `<div class="actions">
        <button class="btn primary" data-act="done">Mark complete</button>
        <button class="btn" data-act="log1">Did 1h</button>
        <button class="btn warn" data-act="more2">It's bigger: +2h</button>
      </div>`}`;
    $('drawer').hidden = false;
    $('drawerBody').querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const before = snapshot();
      if (b.dataset.act === 'done') { t.effortH = Math.max(t.doneH, 0.5); t.doneH = t.effortH; t.completed = true; replanLog(before, `"${t.title}" marked complete`); }
      if (b.dataset.act === 'log1') { t.doneH += 1; if (t.doneH >= t.effortH) t.completed = true; replanLog(before, `Logged 1h on "${t.title}"`); }
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
    tasks.forEach((t) => { t.origEst = t.effortH; });
    state.tasks = tasks; state.ignored = ignored; state.nextId = tasks.length + 1;
    state.log = { title: `Extracted ${tasks.length} tasks from your text`, items: [
      `${tasks.filter((t) => t.confidence === 'high').length} high-confidence, ${tasks.filter((t) => t.confidence !== 'high').length} worth double-checking (Tasks tab)`,
      `${tasks.filter((t) => t.deps.length).length} dependency link(s) detected`,
      `${ignored.length} line(s) skipped: no date, so nothing was guessed`] };
    $('pasteModal').hidden = true;
    toast(`Found ${tasks.length} tasks`);
    render();
  });
  $('btnDemo').addEventListener('click', () => { state = demoState(); $('pasteModal').hidden = true; render(); toast('Sample semester loaded'); });
  $('btnReset').addEventListener('click', () => { state = { ...demoState(), text: '', tasks: [], ignored: [], log: null }; $('pasteModal').hidden = true; render(); });
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
    $('courseFilters').innerHTML = courses.map((c) => `<label class="cfilter" style="--c:${coursePill(c)[1]}"><input type="checkbox" data-c="${esc(c)}" ${cal.hidden.has(c) ? '' : 'checked'}>${esc(courseName(c).name)}</label>`).join('') || '<div class="muted small">No courses yet</div>';
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
        : `<div class="slot" data-id="${e.t.id}"><div class="time"><span style="color:${coursePill(e.t.course)[1]};display:inline-flex">${ic('clock')}</span>${clock(e.from)} - ${clock(e.from + e.hours)}</div><div class="title">${esc(e.t.title)}</div><div class="sub">${esc(courseName(e.t.course).name)} · ${C.round(e.hours, 1)}h</div></div>`).join('')
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

  render();
})();
