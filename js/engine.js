/* Crunch engine: task extraction, prioritisation, scheduling, baselines, simulation.
 * Pure JS with no dependencies. Runs in the browser (window.Crunch) and in Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Crunch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAY = 86400000;
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Whole month words only, so "Octave" or "Marks" are not read as months.
  const MONTH_RE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

  const toDay = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
  const fromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const weekday = (n) => new Date(n * DAY).getUTCDay();
  const fmtDay = (n) => { const d = new Date(n * DAY); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
  const round = (x, k = 2) => Math.round(x * 10 ** k) / 10 ** k;

  // Default effort (hours) by task type. Students can override any estimate.
  const TYPES = [
    { type: 'exam', label: 'Final exam', effort: 14, re: /\b(fat|final exam|end ?sem(ester)?( exam)?|final assessment)\b/i },
    { type: 'midterm', label: 'Mid-term / CAT', effort: 8, re: /\b(cat[- ]?(1|2|i{1,2})?|mid[- ]?term|mid[- ]?sem|internal test|unit test)\b/i },
    { type: 'quiz', label: 'Quiz', effort: 3, re: /\bquiz(zes)?\b/i },
    { type: 'project', label: 'Project', effort: 10, re: /\b(project|prototype|review [0-9]|capstone|demo)\b/i },
    { type: 'presentation', label: 'Presentation', effort: 4, re: /\b(presentation|ppt|seminar|viva)\b/i },
    { type: 'report', label: 'Report', effort: 4, re: /\b(report|essay|paper|write-?up|case study)\b/i },
    { type: 'lab', label: 'Lab', effort: 3, re: /\b(lab|experiment|record)\b/i },
    { type: 'assignment', label: 'Assignment', effort: 5, re: /\b(assignment|da[- ]?[0-9]?|digital assignment|homework|problem set|worksheet|tutorial)\b/i },
  ];
  const typeInfo = (t) => TYPES.find((x) => x.type === t) || TYPES[TYPES.length - 1];

  /* ---------------- extraction ---------------- */

  function parseDate(line, startDay) {
    const s = line.toLowerCase();
    const start = new Date(startDay * DAY);
    const pickYear = (m, d) => {
      let y = start.getUTCFullYear();
      if (Math.round(Date.UTC(y, m, d) / DAY) < startDay - 60) y += 1;
      return y;
    };
    const mk = (y, m, d, conf, text) => {
      if (m < 0 || m > 11 || d < 1 || d > 31) return null;
      return { day: Math.round(Date.UTC(y, m, d) / DAY), confidence: conf, text };
    };
    let m;
    const fullYear = (y) => (y < 100 ? y + 2000 : y);
    if ((m = s.match(/\b(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/))) return mk(+m[1], +m[2] - 1, +m[3], 'high', m[0]);
    // "20 Oct", "20th October 2026", "20-Oct-2026" (VTOP), "20-Oct-26"
    if ((m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+|\\s*-\\s*)(?:of\\s+)?(${MONTH_RE})\\b\\.?(?:,?\\s+(\\d{4})\\b|-(\\d{2}|\\d{4})\\b)?`)))) {
      const mo = MON.findIndex((x) => m[2].startsWith(x.toLowerCase()));
      const y = m[3] || m[4];
      return mk(y ? fullYear(+y) : pickYear(mo, +m[1]), mo, +m[1], 'high', m[0]);
    }
    if ((m = s.match(new RegExp(`\\b(${MONTH_RE})\\b\\.?[\\s-]+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`)))) {
      const mo = MON.findIndex((x) => m[1].startsWith(x.toLowerCase()));
      return mk(m[3] ? +m[3] : pickYear(mo, +m[2]), mo, +m[2], 'high', m[0]);
    }
    // dd-mm-yyyy needs the year, so ranges like "Modules 1-3" are not read as dates.
    if ((m = s.match(/\b(\d{1,2})-(\d{1,2})-(\d{4}|\d{2})\b/))) return mk(fullYear(+m[3]), +m[2] - 1, +m[1], 'high', m[0]);
    if ((m = s.match(/\b(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?\b/))) {
      // Indian format: dd/mm(/yyyy)
      let y = m[3] ? +m[3] : pickYear(+m[2] - 1, +m[1]);
      if (y < 100) y += 2000;
      return mk(y, +m[2] - 1, +m[1], 'high', m[0]);
    }
    if ((m = s.match(/\btomorrow\b/))) return { day: startDay + 1, confidence: 'medium', text: m[0] };
    if ((m = s.match(/\btoday|tonight\b/))) return { day: startDay, confidence: 'medium', text: m[0] };
    if ((m = s.match(/\bin (\d{1,2}) days?\b/))) return { day: startDay + +m[1], confidence: 'medium', text: m[0] };
    if ((m = s.match(/\b(next\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/))) {
      const target = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[2]);
      let delta = (target - weekday(startDay) + 7) % 7 || 7;
      if (m[1] && delta < 7) delta += 7;
      return { day: startDay + delta, confidence: 'medium', text: m[0] };
    }
    return null;
  }

  const COURSE_RE = /\b([A-Z]{2,5}\s?\d{3,4}[A-Z]?)\b/;
  const SOURCE_RE = /^-{3}\s*from\s+(.+?)\s*-{3}$/i;
  // Copied or exported chat messages: "[10/10/26, 9:41 am] Prof. Kumar: DA 2 due Friday" (WhatsApp iOS/desktop)
  // or "10/10/26, 9:41 pm - Prof. Kumar: ..." (WhatsApp Android). The timestamp is when the message was sent,
  // not the deadline, so it is removed and "Friday" or "tomorrow" is counted from the day it was sent.
  const CHAT_RE = /^\[?(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4}),?\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*(?:[ap]\.?\s?m\.?)?\]?\s*(?:[-–]\s*)?([^:]{1,60}?):(?:\s+(.*))?$/i;
  function chatDay(m) {
    let d = +m[1], mo = +m[2], y = +m[3];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d]; // US-style export
    return Math.round(Date.UTC(y < 100 ? y + 2000 : y, mo - 1, d) / DAY);
  }
  const TASK_WORDS = /\b(due|deadline|submit|submission|exam(ination)?s?|tests?|assessments?)\b/i;

  function extractTasks(text, startIso) {
    const startDay = toDay(startIso);
    const tasks = [], ignored = [];
    let course = 'General', file = null, sentDay = null;
    const lines = text.split(/\r?\n/);
    lines.forEach((raw, idx) => {
      const rawLine = raw.replace(/^[‎‏﻿]+/, '').trim();
      let line = rawLine;
      if (!line) return;
      // "--- from timetable.png (OCR) ---" starts a new imported document.
      const marker = line.match(SOURCE_RE);
      if (marker) { file = marker[1]; course = 'General'; sentDay = null; return; }
      // A sender name never holds a task word, so "20/10/26, 11:59 pm - Lab record: submit" stays a deadline line.
      const chat = line.match(CHAT_RE);
      const isChat = chat && !TYPES.some((t) => t.re.test(chat[4])) && !TASK_WORDS.test(chat[4]);
      if (isChat) {
        sentDay = chatDay(chat);
        line = (chat[5] || '').trim();
        if (!line || /^<?(media|image|video|audio|document|sticker|gif) omitted>?$|^this message was deleted$/i.test(line)) return;
        if (/\?\s*$/.test(line)) { ignored.push({ line: idx + 1, text: rawLine, why: 'a question in the chat, not an announcement', file }); return; }
      }
      // Lines after a chat message (multi-line messages) keep counting from the day it was sent.
      const anchor = sentDay == null ? startDay : sentDay;
      const date = parseDate(line, anchor);
      const typeHit = TYPES.find((t) => t.re.test(line));
      const code = line.match(COURSE_RE);
      // A header line names a course and has no date, e.g. "BCSE302L - Database Systems".
      if (!date && sentDay == null && (code || /^(course|subject)\s*[:\-]/i.test(line) || /:$/.test(line))) {
        course = line.replace(/^(course|subject)\s*[:\-]\s*/i, '').replace(/[:\-–]+\s*$/, '').trim().slice(0, 48);
        return;
      }
      if (!date) { ignored.push({ line: idx + 1, text: rawLine, why: 'no date found', file }); return; }
      if (!typeHit && !TASK_WORDS.test(line)) {
        ignored.push({ line: idx + 1, text: rawLine, why: 'date found but no task keyword', file }); return;
      }
      if (sentDay != null && date.day < startDay) {
        ignored.push({ line: idx + 1, text: rawLine, why: `old message: that deadline (${fmtDay(date.day)}) has passed`, file }); return;
      }
      const type = typeHit ? typeHit.type : 'assignment';
      const effM = line.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b(?!\s*(?:am|pm))/i);
      const wM = line.match(/(\d{1,2}(?:\.\d+)?)\s*%/) || line.match(/(\d{1,3})\s*marks\b/i);
      let title = line
        .replace(/\s*[|\t]+\s*/g, ' ')
        .replace(/,?\s*\b(builds on|based on|after|requires?|using|depends on)\s+[^,(]+/i, '')
        .replace(date.text ? new RegExp(date.text.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'), 'i') : /$^/, '')
        .replace(/\(?\s*\d+(?:\.\d+)?\s*%\s*\)?/g, '')
        .replace(/\(?\s*~?\s*\d+(?:\.\d+)?\s*(?:h|hr|hrs|hours?)\b\s*\)?/gi, '')
        .replace(/\b\d{1,2}[:.]\d{2}\s*(am|pm)?\b/gi, '')
        .replace(/^[\s\-*•·>\d.)]+/, '')
        .replace(/\b(due|deadline|on|by|before|submit(ted)?|submission)\b\s*[:\-]?/gi, ' ')
        .replace(/[\s,;:\-–]+$/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      if (!title) title = typeInfo(type).label;
      const lineCourse = code ? code[1] : course;
      // Short generic titles ("CAT 2", "Quiz 2") get the course code so they stay distinguishable.
      const short = (lineCourse.match(/^[A-Z]{2,5}\s?\d{3,4}[A-Z]?/) || [''])[0];
      if (short && title.split(/\s+/).length <= 2 && !title.includes(short)) title = `${short} ${title}`;
      const effort = effM ? +effM[1] : typeInfo(type).effort;
      tasks.push({
        id: `t${tasks.length + 1}`,
        title: title.slice(0, 70),
        course: lineCourse,
        type,
        due: fromDay(date.day),
        effortH: effort,
        doneH: 0,
        weight: wM ? Math.min(100, +wM[1]) : null,
        deps: [],
        source: file ? { line: idx + 1, text: rawLine, file } : { line: idx + 1, text: rawLine },
        confidence: typeHit ? date.confidence : 'low',
        effortSource: effM ? 'stated in text' : `default for ${typeInfo(type).label.toLowerCase()}`,
        notes: sentDay != null && date.text && !/\d/.test(date.text) ? [`"${date.text}" counted from ${fmtDay(sentDay)}, when the message was sent`] : [],
      });
    });
    inferDependencies(tasks);
    return { tasks, ignored };
  }

  const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
  function inferDependencies(tasks) {
    const seq = /\b(part|phase|review|stage|milestone|checkpoint|da)\s*[-#]?\s*(\d+|i{1,3}|iv|v)\b/i;
    const groups = {};
    tasks.forEach((t) => {
      const m = t.title.match(seq);
      if (!m) return;
      const n = ROMAN[m[2].toLowerCase()] || +m[2];
      const base = `${t.course}|${t.type}|${m[1].toLowerCase()}`;
      (groups[base] = groups[base] || []).push({ t, n });
    });
    Object.values(groups).forEach((g) => {
      g.sort((a, b) => a.n - b.n);
      for (let k = 1; k < g.length; k++) {
        if (g[k].n === g[k - 1].n + 1 && !g[k].t.deps.includes(g[k - 1].t.id)) {
          g[k].t.deps.push(g[k - 1].t.id);
          g[k].t.notes.push(`Depends on "${g[k - 1].t.title}" (sequence ${g[k - 1].n} → ${g[k].n})`);
        }
      }
    });
    // Explicit wording: "after X", "based on X", "requires X", "using X".
    tasks.forEach((t) => {
      const m = t.source.text.match(/\b(after|based on|requires?|using|builds on|depends on)\s+(?:the\s+)?(.+)$/i);
      if (!m) return;
      const phrase = m[2].split(/,|\(|\bdue\b|\bby\b|\bon\b/i)[0].trim().toLowerCase();
      const words = phrase.split(/\W+/).filter((w) => w.length > 2 || /\d/.test(w));
      let best = null, bestScore = 0;
      tasks.forEach((o) => {
        if (o === t || toDay(o.due) > toDay(t.due)) return;
        const ow = o.title.toLowerCase();
        const score = (phrase && ow.includes(phrase) ? 3 : 0) + words.filter((w) => ow.includes(w)).length + (o.course === t.course ? 0.5 : 0);
        if (score > bestScore) { best = o; bestScore = score; }
      });
      if (best && bestScore >= 1 && !t.deps.includes(best.id)) {
        t.deps.push(best.id);
        t.notes.push(`Depends on "${best.title}" (text says "${m[1]} ${m[2].slice(0, 30)}")`);
      }
    });
  }

  /* ---------------- capacity and priority ---------------- */

  function capacityOn(day, settings) {
    const base = +(settings.availability[weekday(day)] || 0);
    const busy = (settings.commitments || []).filter((c) => toDay(c.date) === day).reduce((s, c) => s + +c.hours, 0);
    return Math.max(0, base - busy);
  }
  function capacityBetween(a, b, settings) { let s = 0; for (let d = a; d <= b; d++) s += capacityOn(d, settings); return s; }
  const remaining = (t) => Math.max(0, t.effortH * (t.scale || 1) - t.doneH);

  function prioritize(tasks, settings) {
    const today = toDay(settings.today);
    const active = tasks.filter((t) => remaining(t) > 0.01);
    const dependents = {};
    tasks.forEach((t) => t.deps.forEach((d) => { (dependents[d] = dependents[d] || []).push(t); }));
    const ranked = active.map((t) => {
      const due = toDay(t.due);
      const rem = remaining(t);
      const free = capacityBetween(today, due - 1, settings) + capacityOn(due, settings) * 0.5;
      const pressure = free > 0 ? rem / free : 9;
      const w = t.weight == null ? 10 : t.weight;
      const blocks = (dependents[t.id] || []).filter((x) => remaining(x) > 0.01);
      const cx = rem <= 3 ? 1 : rem <= 8 ? 2 : 3;
      const parts = {
        urgency: round(40 * Math.min(1, pressure), 1),
        importance: round(25 * Math.min(1, w / 30), 1),
        effort: round(15 * cx / 3, 1),
        unblocks: round(20 * Math.min(1, blocks.length / 2), 1),
      };
      const score = round(parts.urgency + parts.importance + parts.effort + parts.unblocks, 1);
      const why = [];
      why.push(pressure >= 1
        ? `Over capacity: needs ${round(rem, 1)}h but only ${round(free, 1)}h free before it's due`
        : `Needs ${round(rem, 1)}h of the ${round(free, 1)}h free before ${fmtDay(due)} (${Math.round(pressure * 100)}% of free time)`);
      why.push(t.weight == null ? 'Grade weight unknown (assumed 10%)' : `Worth ${t.weight}% of the grade`);
      if (blocks.length) why.push(`Blocks ${blocks.map((b) => `"${b.title}"`).join(', ')}`);
      if (t.deps.length) why.push(`Waits for ${t.deps.map((id) => `"${(tasks.find((x) => x.id === id) || {}).title}"`).join(', ')}`);
      return { id: t.id, score, parts, pressure: round(pressure, 2), free: round(free, 1), why, daysLeft: due - today };
    });
    ranked.sort((a, b) => b.score - a.score);
    ranked.forEach((r, i) => { r.rank = i + 1; });
    return ranked;
  }

  /* ---------------- schedulers ---------------- */
  // Each returns { days: [{day, cap, load, sessions:[{id, hours}]}], finish: {id: day}, unfinished: {id: hours} }.

  function prep(tasks, settings) {
    const today = toDay(settings.today);
    const open = tasks.filter((t) => remaining(t) > 0.01);
    const rem = {}, due = {};
    open.forEach((t) => { rem[t.id] = remaining(t); due[t.id] = toDay(t.due); });
    const ids = new Set(open.map((t) => t.id));
    const maxDue = open.length ? Math.max(...open.map((t) => due[t.id])) : today;
    return { today, open, rem, due, ids, maxDue };
  }

  /** Crunch planner: dependency-aware, buffered, load-levelled earliest-deadline-first. */
  function planCrunch(tasks, settings) {
    const { today, open, rem, due, ids, maxDue } = prep(tasks, settings);
    const buffer = settings.bufferDays == null ? 1 : settings.bufferDays;
    const sessionMax = settings.sessionMax || 2;
    const total = Object.values(rem).reduce((a, b) => a + b, 0);
    const totalCap = capacityBetween(today, maxDue, settings);
    const u = Math.min(1, totalCap > 0 ? (total / totalCap) * (settings.headroom || 1.15) : 1);
    const avgCap = totalCap / Math.max(1, maxDue - today + 1) || 1;

    // Planning deadline: due minus buffer, pulled earlier for prerequisites so dependents have time.
    const dl = {};
    open.forEach((t) => { dl[t.id] = Math.max(today, due[t.id] - buffer); });
    for (let pass = 0; pass < open.length; pass++) {
      let changed = false;
      open.forEach((t) => t.deps.forEach((d) => {
        if (!ids.has(d)) return;
        const need = Math.max(today, dl[t.id] - Math.ceil(rem[t.id] / Math.max(0.5, avgCap * u)));
        if (need < dl[d]) { dl[d] = need; changed = true; }
      }));
      if (!changed) break;
    }
    const doneSet = new Set(tasks.filter((t) => remaining(t) <= 0.01).map((t) => t.id));
    const ready = (t) => t.deps.every((d) => doneSet.has(d) || !tasks.some((x) => x.id === d));
    const days = [], finish = {};
    const order = [...open].sort((a, b) => dl[a.id] - dl[b.id] || due[a.id] - due[b.id]);
    for (let day = today; day <= maxDue + 14; day++) {
      const cap = capacityOn(day, settings);
      const entry = { day, cap, load: 0, sessions: [] };
      days.push(entry);
      if (cap <= 0) continue;
      if (order.every((t) => rem[t.id] <= 0.01)) break;
      // Least work needed today so every planning deadline stays reachable at the levelled pace.
      let need = 0, cum = 0;
      order.forEach((t) => {
        if (rem[t.id] <= 0.01) return;
        cum += rem[t.id];
        const future = dl[t.id] > day ? capacityBetween(day + 1, dl[t.id], settings) * u : 0;
        need = Math.max(need, cum - future);
      });
      const target = Math.min(cap, Math.max(cap * u, need));
      let guard = 0, lastId = null;
      while (entry.load < target - 0.01 && guard++ < 50) {
        const cands = order.filter((x) => rem[x.id] > 0.01 && ready(x));
        if (!cands.length) break;
        // Mix subjects on heavy days: switch tasks after a session when another is almost as urgent.
        let t = cands[0];
        if (t.id === lastId && dl[t.id] - day >= 3 && cands[1] && dl[cands[1].id] <= dl[t.id] + 2) t = cands[1];
        lastId = t.id;
        let h = Math.min(sessionMax, rem[t.id], target - entry.load);
        if (rem[t.id] - h < 0.25) h = rem[t.id];
        h = Math.min(h, cap - entry.load);
        if (h <= 0.01) break;
        addSession(entry, t.id, h);
        rem[t.id] = round(rem[t.id] - h, 3);
        if (rem[t.id] <= 0.01) { finish[t.id] = day; doneSet.add(t.id); }
      }
    }
    return finalize(days, finish, rem, { dl, u: round(u, 2) });
  }

  /** Baseline A: to-do list sorted by due date, work every free hour (ignores dependencies). */
  function planDueDate(tasks, settings) {
    const { today, open, rem, due, maxDue } = prep(tasks, settings);
    const order = [...open].sort((a, b) => due[a.id] - due[b.id]);
    const days = [], finish = {};
    for (let day = today; day <= maxDue + 14; day++) {
      const cap = capacityOn(day, settings);
      const entry = { day, cap, load: 0, sessions: [] };
      days.push(entry);
      for (const t of order) {
        if (entry.load >= cap - 0.01) break;
        if (rem[t.id] <= 0.01) continue;
        const h = Math.min(rem[t.id], cap - entry.load);
        addSession(entry, t.id, h);
        rem[t.id] -= h;
        if (rem[t.id] <= 0.01) finish[t.id] = day;
      }
      if (order.every((t) => rem[t.id] <= 0.01)) break;
    }
    return finalize(days, finish, rem, {});
  }

  /** Baseline B: the classic student, who works on each task in the days just before it is due. */
  function planLastMinute(tasks, settings) {
    const { today, open, rem, due, maxDue } = prep(tasks, settings);
    const byDay = {};
    // Fill backwards from each deadline (latest due first), as late as capacity allows.
    for (let day = maxDue; day >= today; day--) {
      const cap = capacityOn(day, settings);
      let load = 0;
      const cands = open.filter((t) => due[t.id] >= day && rem[t.id] > 0.01).sort((a, b) => due[b.id] - due[a.id]);
      for (const t of cands) {
        if (load >= cap - 0.01) break;
        const h = Math.min(rem[t.id], cap - load);
        (byDay[day] = byDay[day] || []).push({ id: t.id, hours: h });
        rem[t.id] -= h; load += h;
      }
    }
    const days = [], finish = {};
    for (let day = today; day <= maxDue; day++) {
      const entry = { day, cap: capacityOn(day, settings), load: 0, sessions: [] };
      (byDay[day] || []).reverse().forEach((s) => { addSession(entry, s.id, s.hours); finish[s.id] = day; });
      days.push(entry);
    }
    return finalize(days, finish, rem, {});
  }

  function addSession(entry, id, h) {
    const last = entry.sessions[entry.sessions.length - 1];
    if (last && last.id === id) last.hours = round(last.hours + h, 2);
    else entry.sessions.push({ id, hours: round(h, 2) });
    entry.load = round(entry.load + h, 2);
  }
  function finalize(days, finish, rem, extra) {
    const unfinished = {};
    Object.entries(rem).forEach(([id, h]) => { if (h > 0.01) unfinished[id] = round(h, 2); });
    while (days.length && days[days.length - 1].load === 0 && days.length > 1) days.pop();
    return { days, finish, unfinished, ...extra };
  }

  const PLANNERS = { crunch: planCrunch, duedate: planDueDate, lastminute: planLastMinute };

  /* ---------------- metrics ---------------- */

  function planMetrics(tasks, plan) {
    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    let missed = 0, late = 0, depViol = 0, bufferSum = 0, bufferN = 0;
    const firstWork = {};
    plan.days.forEach((d) => d.sessions.forEach((s) => { if (firstWork[s.id] == null) firstWork[s.id] = d.day; }));
    Object.keys(byId).forEach((id) => {
      const t = byId[id];
      if (remaining(t) <= 0.01 && plan.finish[id] == null && !(id in plan.unfinished)) return;
      const due = toDay(t.due);
      const f = plan.finish[id];
      if (plan.unfinished[id] || f == null || f > due) missed++;
      else { bufferSum += due - f; bufferN++; }
      t.deps.forEach((d) => { if (firstWork[id] != null && plan.finish[d] != null && firstWork[id] < plan.finish[d]) depViol++; });
    });
    plan.days.forEach((d) => d.sessions.forEach((s) => { if (d.day > toDay(byId[s.id].due)) late += s.hours; }));
    late += Object.values(plan.unfinished).reduce((a, b) => a + b, 0);
    const loads = plan.days.filter((d) => d.cap > 0).map((d) => d.load);
    const mean = loads.reduce((a, b) => a + b, 0) / Math.max(1, loads.length);
    const sd = Math.sqrt(loads.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, loads.length));
    const crunch = plan.days.filter((d) => d.cap > 0 && d.load >= Math.max(6, 0.9 * d.cap)).length;
    return {
      missed, lateHours: round(late, 1), depViolations: depViol,
      peakDay: round(Math.max(0, ...loads), 1), loadSd: round(sd, 2), crunchDays: crunch,
      avgBufferDays: bufferN ? round(bufferSum / bufferN, 1) : 0,
    };
  }

  /* ---------------- simulation (planning fallacy + surprises) ---------------- */
  // Each day the policy replans from what it knows. True effort differs from the
  // estimate and only shows up once the estimate runs out. Crunch also learns the
  // student's overrun ratio from finished tasks and scales the remaining estimates.

  function simulate(scn, policy, opts = {}) {
    const tasks = scn.tasks.map((t) => ({ ...t, deps: [...t.deps], doneH: 0, scale: 1, known: false }));
    const truth = Object.fromEntries(scn.tasks.map((t) => [t.id, t.trueEffortH]));
    const arrivals = scn.arrivals || [];
    const start = toDay(scn.settings.today);
    const end = Math.max(...scn.tasks.concat(arrivals.map((a) => a.task)).map((t) => toDay(t.due))) + 3;
    const settings = { ...scn.settings, commitments: [...(scn.settings.commitments || [])] };
    let visible = tasks.filter((t) => !arrivals.some((a) => a.task.id === t.id));
    const completedOn = {}, worked = {}, loads = [];
    const firstWork = {};
    let depViol = 0;
    for (let day = start; day <= end; day++) {
      arrivals.filter((a) => toDay(a.on) === day).forEach((a) => {
        visible.push(tasks.find((t) => t.id === a.task.id));
      });
      (scn.events || []).filter((e) => toDay(e.on) === day).forEach((e) => {
        if (e.kind === 'deadline') { const t = tasks.find((x) => x.id === e.id); if (t) t.due = e.due; }
        if (e.kind === 'sick') for (let k = 0; k < e.days; k++) settings.commitments.push({ date: fromDay(day + k), hours: 24, label: 'sick' });
      });
      if (opts.learn) {
        const fin = visible.filter((t) => completedOn[t.id] != null);
        const prior = opts.prior || 1;
        // Blend the prior with what finished tasks show, trusting the data more as it grows.
        const w = Math.min(1, fin.length / 4);
        const seen = fin.length ? fin.reduce((a, t) => a + truth[t.id], 0) / fin.reduce((a, t) => a + t.effortH, 0) : prior;
        const ratio = (1 - w) * prior + w * seen;
        visible.forEach((t) => { if (completedOn[t.id] == null && !t.known) t.scale = Math.max(1, Math.min(2, ratio)); });
      }
      const live = visible.filter((t) => completedOn[t.id] == null);
      if (!live.length && day > Math.max(...arrivals.map((a) => toDay(a.on)), start)) { loads.push(0); continue; }
      const plan = policy(live, { ...settings, today: fromDay(day) });
      const today = plan.days.find((d) => d.day === day);
      let load = 0;
      (today ? today.sessions : []).forEach((s) => {
        const t = tasks.find((x) => x.id === s.id);
        if (completedOn[t.id] != null) return;
        if (firstWork[t.id] == null) {
          firstWork[t.id] = day;
          t.deps.forEach((d) => { if (completedOn[d] == null || completedOn[d] >= day) depViol++; });
        }
        const h = Math.min(s.hours, truth[t.id] - (worked[t.id] || 0));
        worked[t.id] = (worked[t.id] || 0) + h; load += h;
        t.doneH = worked[t.id];
        if (worked[t.id] >= truth[t.id] - 0.01) completedOn[t.id] = day;
        else if (t.doneH >= t.effortH * t.scale - 0.01) { t.effortH = truth[t.id]; t.scale = 1; t.known = true; } // overrun revealed
      });
      loads.push(round(load, 2));
    }
    let missed = 0, late = 0, bufferSum = 0, n = 0;
    tasks.forEach((t) => {
      const due = toDay(t.due);
      if (completedOn[t.id] == null || completedOn[t.id] > due) { missed++; late += truth[t.id] - Math.min(truth[t.id], worked[t.id] || 0); }
      else { bufferSum += due - completedOn[t.id]; n++; }
    });
    const active = loads.slice(0, Math.max(1, loads.length));
    const mean = active.reduce((a, b) => a + b, 0) / active.length;
    return {
      missed, total: tasks.length, onTimePct: round(100 * (tasks.length - missed) / tasks.length, 1),
      unfinishedHours: round(late, 1), depViolations: depViol,
      peakDay: round(Math.max(...loads), 1),
      crunchDays: loads.filter((l) => l >= 7).length,
      loadSd: round(Math.sqrt(active.reduce((a, b) => a + (b - mean) ** 2, 0) / active.length), 2),
      avgBufferDays: n ? round(bufferSum / n, 2) : 0,
    };
  }

  return {
    TYPES, toDay, fromDay, fmtDay, weekday, WD, round,
    extractTasks, parseDate, inferDependencies, prioritize, capacityOn, capacityBetween, remaining,
    planCrunch, planDueDate, planLastMinute, PLANNERS, planMetrics, simulate,
  };
});
