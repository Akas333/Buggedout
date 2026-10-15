/* Gemma 4 extraction: messy text and screenshots in, structured deadlines out.
 *
 * Calls Gemma 4 through /api/gemma, a serverless proxy (Vercel) that holds the provider keys as env variables,
 * so visitors need no key. On the Vercel site it's same-origin; GitHub Pages and local dev call REMOTE_PROXY.
 *
 * Every item Gemma returns is checked against the input: its quoted source must appear in the text,
 * otherwise it is marked "check this". Dates must parse and fall in a sane range.
 */
(function () {
  'use strict';
  // The Vercel deployment of this repo, e.g. 'https://your-project.vercel.app/api/gemma'. Used by GitHub Pages and local dev.
  const REMOTE_PROXY = '';
  const TYPES = ['exam', 'midterm', 'quiz', 'project', 'presentation', 'report', 'lab', 'assignment'];
  const MAX_IMAGES = 4;

  try { localStorage.removeItem('dueline-gemini-key'); } catch (e) { /* keys used to be stored here; no longer needed */ }

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

  async function callGemma(parts) {
    const body = JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, maxOutputTokens: 4096 } });
    const local = location.protocol === 'file:' || location.hostname.endsWith('github.io') || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    const urls = (local ? [REMOTE_PROXY] : ['/api/gemma', REMOTE_PROXY]).filter(Boolean);
    let lastErr = new Error('Gemma 4 is not reachable right now. The regular extractor still works');
    for (const url of urls) {
      let r;
      try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); }
      catch (e) { continue; } // offline, or this site has no proxy
      const json = await r.json().catch(() => ({}));
      if (r.ok) return { json, via: json.via || 'Gemma 4' };
      if (r.status === 404 || r.status === 405 || r.status === 501) continue; // no proxy (or no keys) at this URL
      lastErr = new Error((json.error && json.error.message) || `Gemma 4 error ${r.status}`);
      break;
    }
    throw lastErr;
  }

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

  /** Returns { tasks, ignored, meta } in the same shape as the rule-based extractor. */
  async function extract({ text, images = [], today, C }) {
    const imgs = images.slice(0, MAX_IMAGES);
    const parts = [{ text: buildPrompt(text, today, imgs.length) }];
    for (const f of imgs) parts.push({ inline_data: { mime_type: f.type || 'image/png', data: await fileToBase64(f) } });
    const { json, via } = await callGemma(parts);
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

  window.DuelineGemma = { extract };
})();
