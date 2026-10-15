/* Gemma 4 extraction: messy text and screenshots in, structured deadlines out.
 *
 * Calls Gemma 4 through the Gemini API. Two ways to reach it:
 *  1. /api/gemma, a serverless proxy (Vercel) that holds the key as an env variable, so visitors need no key.
 *  2. Directly from the browser with the student's own key, kept only in this browser (localStorage).
 *
 * Every item Gemma returns is checked against the input: its quoted source must appear in the text,
 * otherwise it is marked "check this". Dates must parse and fall in a sane range.
 */
(function () {
  'use strict';
  const MODELS = ['gemma-4-26b-a4b-it', 'gemma-4-31b-it'];
  const KEY_STORE = 'dueline-gemini-key';
  const TYPES = ['exam', 'midterm', 'quiz', 'project', 'presentation', 'report', 'lab', 'assignment'];
  const MAX_IMAGES = 4;

  const getKey = () => { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; } };
  const setKey = (k) => { try { if (k) localStorage.setItem(KEY_STORE, k.trim()); else localStorage.removeItem(KEY_STORE); } catch (e) { /* storage blocked */ } };

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(new Error(`Could not read ${file.name}`));
      r.readAsDataURL(file);
    });
  }

  function buildPrompt(text, today, nImages) {
    return `You extract academic deadlines for a student planner. Today is ${today}.

Read the ${nImages ? `${nImages} attached image(s) and the ` : ''}text below (syllabi, announcements, class group messages, timetables).
Return ONLY a JSON array, no prose, no code fences. One object per assignment, exam, quiz, lab, project review, presentation or report that has a date:
{"title": short task name as written, "course": course code and name if known (e.g. "BCSE302L - Database Systems"), "type": one of ${TYPES.join('|')},
 "due": "YYYY-MM-DD" (resolve weekdays and "tomorrow" relative to today; if no year, use the next occurrence), "effort_hours": number or null (only if stated),
 "weight_percent": number or null (only if stated), "depends_on": title of another item it builds on, or null,
 "source": the exact words from the input that state this deadline (copy them verbatim, max 120 characters)}
Rules: never invent items or dates; skip anything without a date; one object per deadline; keep titles short.

TEXT:
${text || '(no text, see images)'}`;
  }

  function parseJsonArray(raw) {
    let s = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = s.indexOf('['), b = s.lastIndexOf(']');
    if (a === -1 || b <= a) throw new Error('Gemma did not return a list of deadlines');
    s = s.slice(a, b + 1);
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) throw new Error('Gemma did not return a list of deadlines');
    return arr;
  }

  async function callGemma(parts, apiKey) {
    const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, maxOutputTokens: 4096 } });
    // 1) Server-side proxy (Vercel), if this deployment has one.
    if (!location.hostname.endsWith('github.io') && location.protocol !== 'file:') {
      try {
        const r = await fetch('/api/gemma', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        if (r.ok) return { json: await r.json(), via: 'Dueline server' };
      } catch (e) { /* no proxy here, fall back to the student's key */ }
    }
    // 2) Directly from the browser with the student's key.
    if (!apiKey) { const e = new Error('Add your free Gemini API key to use Gemma 4'); e.code = 'NO_KEY'; throw e; }
    let lastErr;
    for (const model of MODELS) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body,
      });
      const json = await r.json().catch(() => ({}));
      if (r.ok) return { json, via: model };
      lastErr = new Error((json.error && json.error.message) || `Gemini API error ${r.status}`);
      lastErr.status = r.status;
      if (r.status !== 404) break; // only try the next model if this one isn't available
    }
    throw lastErr;
  }

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

  /** Returns { tasks, ignored, meta } in the same shape as the rule-based extractor. */
  async function extract({ text, images = [], today, C }) {
    const imgs = images.slice(0, MAX_IMAGES);
    const parts = [{ text: buildPrompt(text, today, imgs.length) }];
    for (const f of imgs) parts.push({ inline_data: { mime_type: f.type || 'image/png', data: await fileToBase64(f) } });
    const { json, via } = await callGemma(parts, getKey());
    const out = ((json.candidates || [])[0] || {}).content || {};
    const raw = (out.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('\n');
    const items = parseJsonArray(raw);

    const lines = String(text || '').split(/\r?\n/);
    const nText = norm(text);
    const todayDay = C.toDay(today);
    const tasks = [];
    const skipped = [];
    items.forEach((it, i) => {
      const due = String(it.due || '').slice(0, 10);
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(due) && !isNaN(Date.parse(due));
      if (!it.title || !ok || C.toDay(due) < todayDay - 60 || C.toDay(due) > todayDay + 400) {
        skipped.push({ line: 0, text: String(it.title || it.source || 'item'), why: 'Gemma gave no valid date, skipped' });
        return;
      }
      const type = TYPES.includes(String(it.type).toLowerCase()) ? String(it.type).toLowerCase() : 'assignment';
      const info = C.TYPES.find((x) => x.type === type);
      const quote = String(it.source || '').trim();
      // Verified = the quoted evidence really is in the student's text.
      const verified = quote && nText && nText.includes(norm(quote));
      const lineIdx = verified ? lines.findIndex((l) => norm(l).includes(norm(quote).slice(0, 40))) : -1;
      const effort = +it.effort_hours > 0 ? +it.effort_hours : info.effort;
      tasks.push({
        id: `g${i + 1}`,
        title: String(it.title).slice(0, 70),
        course: String(it.course || 'General').slice(0, 48),
        type, due,
        effortH: effort, doneH: 0,
        weight: it.weight_percent == null || isNaN(+it.weight_percent) ? null : Math.min(100, +it.weight_percent),
        deps: [], dependsOn: it.depends_on || null,
        source: { line: lineIdx + 1, text: quote || '(read from image)', file: 'Gemma 4' },
        confidence: verified ? 'high' : 'low',
        effortSource: +it.effort_hours > 0 ? 'stated, read by Gemma 4' : `default for ${info.label.toLowerCase()}`,
        notes: verified ? [] : [imgs.length ? 'Read from an image by Gemma 4: check the date' : 'Gemma 4 quote not found in your text: check this one'],
      });
    });
    // Resolve "depends_on" titles to ids.
    tasks.forEach((t) => {
      if (!t.dependsOn) return;
      const target = tasks.find((o) => o !== t && norm(o.title) === norm(t.dependsOn)) || tasks.find((o) => o !== t && norm(o.title).includes(norm(t.dependsOn)));
      if (target) { t.deps.push(target.id); t.notes.push(`Depends on "${target.title}" (Gemma 4)`); }
      delete t.dependsOn;
    });
    return { tasks, ignored: skipped, meta: { via, images: imgs.length, verified: tasks.filter((t) => t.confidence === 'high').length } };
  }

  window.DuelineGemma = { extract, getKey, setKey, MODELS };
})();
