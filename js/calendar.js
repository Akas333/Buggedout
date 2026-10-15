/* Calendar export: deadlines into Google Calendar and Apple Calendar.
 *
 * Apple Calendar (and Outlook) open a standard .ics file directly: on a Mac it imports, on iPhone/iPad Safari
 * shows "Add All". Google Calendar has no way to add many events from a link, so "all deadlines" downloads the
 * same .ics and opens Google's import page; a single deadline uses Google's one-click event link instead.
 *
 * Each deadline is an all-day event with a reminder at 9:00 the day before. UIDs come from course + title,
 * so importing again after a due date moves updates the event instead of adding a copy.
 */
(function () {
  'use strict';
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (iso) => iso.slice(0, 10).replace(/-/g, '');
  const nextDay = (iso) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  const stamp = () => { const d = new Date(); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

  const courseCode = (c) => { const m = String(c || '').split(/\s[-–:]\s/); return m.length > 1 ? m[0] : ''; };
  const summary = (t) => { const code = courseCode(t.course); return code && !t.title.includes(code) ? `${t.title} (${code})` : t.title; };
  function details(t) {
    const lines = [t.course && t.course !== 'General' ? t.course : null, t.type ? t.type[0].toUpperCase() + t.type.slice(1) : null];
    if (t.weight != null) lines.push(`${t.weight}% of grade`);
    if (t.effortH) lines.push(`About ${Math.round(t.effortH * 10) / 10}h of work`);
    lines.push('Added from Dueline');
    return lines.filter(Boolean).join('\n');
  }

  // RFC 5545 text escaping and 75-octet line folding.
  const escText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  function fold(line) {
    const enc = new TextEncoder();
    const out = [];
    let cur = '', bytes = 0;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
      cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join('\r\n ');
  }

  function ics(tasks) {
    const now = stamp();
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dueline//Semester Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Dueline deadlines'];
    tasks.forEach((t) => {
      lines.push('BEGIN:VEVENT',
        `UID:dueline-${hash(`${t.course}|${t.title}`.toLowerCase())}@dueline`,
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${ymd(t.due)}`,
        `DTEND;VALUE=DATE:${ymd(nextDay(t.due))}`,
        `SUMMARY:${escText(summary(t))}`,
        `DESCRIPTION:${escText(details(t))}`,
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escText(`Due tomorrow: ${summary(t)}`)}`, 'TRIGGER:-PT15H', 'END:VALARM',
        'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'deadline';

  /** One deadline → Google Calendar's "new event" page, prefilled. */
  function googleUrl(t) {
    const q = new URLSearchParams({ action: 'TEMPLATE', text: summary(t), dates: `${ymd(t.due)}/${ymd(nextDay(t.due))}`, details: details(t) });
    return `https://calendar.google.com/calendar/render?${q}`;
  }

  /** Several deadlines → Google: download the .ics, then open Google's import page. Call from a click handler. */
  function toGoogle(tasks) {
    window.open('https://calendar.google.com/calendar/r/settings/export', '_blank', 'noopener');
    download('dueline-deadlines.ics', ics(tasks));
  }

  /** Deadlines → Apple Calendar (also Outlook and anything else that opens .ics). */
  function toApple(tasks) {
    download(tasks.length === 1 ? `${slug(tasks[0].title)}.ics` : 'dueline-deadlines.ics', ics(tasks));
  }

  window.DuelineCalendar = { ics, googleUrl, toGoogle, toApple };
})();
