// Local-time date helpers. All timestamps in the app are epoch milliseconds.

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

const pad = (n) => String(n).padStart(2, '0');

export function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(t) {
  const d = new Date(t);
  d.setHours(23, 59, 0, 0);
  return d.getTime();
}

// DST-safe: moves the calendar date, keeps the wall-clock time.
export function addDays(t, n) {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function startOfWeek(t, weekStartsOn = 1) {
  const d = new Date(startOfDay(t));
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  return addDays(d.getTime(), -diff);
}

export function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function atMinutes(dayT, minutes) {
  const d = new Date(startOfDay(dayT));
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

export function parseHHMM(s) {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + (m || 0);
}

export function toHHMM(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function minutesOfDay(t) {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / DAY);
}

export function weekday(t) {
  return new Date(t).getDay();
}

// ---- formatting -------------------------------------------------------------

const fmtCache = new Map();
function fmt(opts) {
  const k = JSON.stringify(opts);
  if (!fmtCache.has(k)) fmtCache.set(k, new Intl.DateTimeFormat('en-US', opts));
  return fmtCache.get(k);
}

export const fmtDay = (t) => fmt({ month: 'short', day: 'numeric' }).format(t);
export const fmtDayLong = (t) => fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(t);
export const fmtWeekdayShort = (t) => fmt({ weekday: 'short' }).format(t).toLowerCase();
export const fmtMonthYear = (t) => fmt({ month: 'long', year: 'numeric' }).format(t);
export const fmtTime = (t) => toHHMM(minutesOfDay(t));
export const fmtDateTime = (t) => `${fmtDayLong(t)}, ${fmtTime(t)}`;

export function fmtRelative(t, now) {
  const d = daysBetween(now, t);
  if (d === 0) return t < now ? 'earlier today' : 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  if (d > 1 && d < 7) return `in ${d} days`;
  if (d >= 7) return d < 14 ? `in ${d} days` : `in ${Math.round(d / 7)} weeks`;
  return `${-d} days ago`;
}

export function fmtHours(h) {
  if (h == null || Number.isNaN(h)) return '–';
  const r = Math.round(h * 4) / 4;
  if (r === 0) return '0h';
  if (r < 1) return `${Math.round(r * 60)}m`;
  return `${Number.isInteger(r) ? r : r.toFixed(2).replace(/0$/, '')}h`;
}

// datetime-local input <-> epoch
export function toInputValue(t) {
  if (t == null) return '';
  const d = new Date(t);
  return `${dayKey(t)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromInputValue(v) {
  if (!v) return null;
  const [date, time = '23:59'] = v.split('T');
  return atMinutes(fromDayKey(date), parseHHMM(time));
}
