/* Dueline cloud sync: Google sign-in through Supabase, one saved plan per account.
 * Optional. Signed out, offline, opened as a file, or if the library can't load, Dueline works from
 * localStorage exactly as before.
 * Every update bumps a version number on the server, and a write only lands if the server is still at the
 * version this browser last saw. So two devices never silently overwrite each other: the student chooses. */
(function (root) {
  'use strict';

  // A publishable key is meant to ship in the page. Row-level security limits every account to its own row.
  const SB_URL = 'https://cvqzcpehxiapkkamhsbm.supabase.co';
  const SB_KEY = 'sb_publishable_-G85aV2xCMokdd2SsuW-rw_LnDDhO_O';
  const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
  const TABLE = 'dueline_plans';
  const META = 'dueline-sync-v1';
  const PUSH_DELAY = 1500;

  let sb = null, session = null, app = null;
  let phase = 'loading', lastAt = null, lastError = '';
  let meta = { uid: null, version: 0, dirty: false };
  let timer = null, edits = 0, paused = false;
  let queue = Promise.resolve();

  function readMeta() { try { return JSON.parse(localStorage.getItem(META)); } catch (e) { return null; } }
  function writeMeta() { try { localStorage.setItem(META, JSON.stringify(meta)); } catch (e) { /* storage blocked: sync still works this session */ } }

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url; s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the sync library (offline?).'));
      document.head.appendChild(s);
    });
  }

  function user() {
    if (!session) return null;
    const u = session.user, m = u.user_metadata || {};
    return { id: u.id, email: u.email || m.email || '', name: m.full_name || m.name || u.email || 'Signed in', avatar: m.avatar_url || m.picture || '' };
  }

  function set(p, extra = {}) {
    phase = p;
    if (extra.at) lastAt = extra.at;
    lastError = extra.error || '';
    app.onStatus(status());
  }
  function status() { return { phase, user: user(), at: lastAt, error: lastError, pending: meta.dirty }; }

  function fail(e) {
    const raw = (e && e.message) || String(e);
    const msg = e && e.code === '23514' ? 'This plan is over 2 MB, too big to sync. Clear some pasted text and try again.'
      : /JWT|PGRST30/i.test(raw + (e && e.code)) ? 'Your sign-in has expired. Sign out and sign in again.'
      : raw;
    set(!navigator.onLine || /fetch|network/i.test(msg) ? 'offline' : 'error', { error: msg });
  }

  // All network work runs one job at a time, so a save never races a download.
  function run(job) { const p = queue.then(job).catch(fail); queue = p; return p; }

  async function q(req) { const { data, error } = await req; if (error) throw error; return data; }

  const count = (s) => (s && Array.isArray(s.tasks) ? s.tasks.length : 0);

  /* ---------- setup ---------- */
  function init(opts) {
    app = opts;
    meta = readMeta() || { uid: null, version: 0, dirty: !!opts.hadLocalPlan };
    writeMeta();
    set('loading');
    start().catch((e) => set('unavailable', { error: e.message }));
    root.addEventListener('online', () => { if (session && meta.dirty) schedule(0); });
    document.addEventListener('visibilitychange', () => {
      if (!session) return;
      if (document.visibilityState === 'hidden') { if (timer) schedule(0); } // phone switching apps: save now
      else if (!paused) run(reconcile); // back on this tab: pick up changes from other devices
    });
  }

  async function start() {
    if (location.protocol === 'file:') throw new Error('Sign-in needs Dueline opened from a web address, not a file.');
    const back = new URLSearchParams(location.search.slice(1) + '&' + location.hash.slice(1));
    const oauthError = back.get('error_description') || back.get('error');
    await loadScript(LIB);
    sb = root.supabase.createClient(SB_URL, SB_KEY, {
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
      db: { retry: false }, // a 409 means another device saved first; handle it instead of retrying
    });
    sb.auth.onAuthStateChange((event, s) => {
      const before = session && session.user.id;
      session = s;
      cleanUrl();
      if (!s) { set('signed-out', { error: oauthError ? `Google sign-in didn't finish: ${oauthError}` : '' }); return; }
      if (s.user.id !== before) setTimeout(() => run(reconcile), 0); // supabase-js: no awaited calls inside this callback
    });
  }

  // Drop ?code= or ?error= that the Google round trip leaves in the address bar.
  function cleanUrl() {
    const u = new URL(location.href);
    const keys = ['code', 'error', 'error_code', 'error_description', 'state'];
    if (!keys.some((k) => u.searchParams.has(k)) && !/error|access_token/.test(u.hash)) return;
    keys.forEach((k) => u.searchParams.delete(k));
    if (/error|access_token/.test(u.hash)) u.hash = '';
    history.replaceState(history.state, '', u.pathname + u.search + u.hash);
  }

  /* ---------- sync ---------- */
  // Bring this browser and the account into agreement.
  async function reconcile() {
    if (!session) return;
    const uid = session.user.id;
    set('syncing');
    const head = await q(sb.from(TABLE).select('version, updated_at').eq('user_id', uid).maybeSingle());
    if (!head) { meta.uid = uid; meta.version = 0; writeMeta(); return push(); } // first save: this browser's plan becomes the account's
    if (meta.uid === uid && head.version === meta.version) return meta.dirty ? push() : set('synced', { at: head.updated_at });

    const row = await q(sb.from(TABLE).select('state, version, updated_at').eq('user_id', uid).single());
    if (!meta.dirty) return take(uid, row); // nothing here that isn't in the account already

    // Both sides changed (or this browser has a plan the account has never seen): ask.
    const kind = meta.uid === uid ? 'conflict' : 'first';
    const useAccount = await app.ask(kind, { at: row.updated_at, tasks: count(row.state), localTasks: count(app.getState()) });
    if (useAccount == null) { paused = true; return set('paused'); }
    paused = false;
    if (useAccount) return take(uid, row);
    meta.uid = uid; meta.version = row.version; writeMeta();
    return push();
  }

  function take(uid, row) {
    meta = { uid, version: row.version, dirty: false };
    writeMeta();
    app.apply(row.state);
    set('synced', { at: row.updated_at });
  }

  async function push() {
    if (!session) return;
    const uid = session.user.id, n = edits, state = app.getState();
    set('syncing');
    const rows = meta.uid === uid && meta.version
      ? await q(sb.from(TABLE).update({ state }).eq('user_id', uid).eq('version', meta.version).select('version, updated_at'))
      : await q(sb.from(TABLE).insert({ user_id: uid, state }).select('version, updated_at'))
        .catch((e) => { if (e.code === '23505') return []; throw e; });
    if (!rows.length) return reconcile(); // another device saved first
    meta = { uid, version: rows[0].version, dirty: edits !== n };
    writeMeta();
    set('synced', { at: rows[0].updated_at });
    if (meta.dirty) schedule(PUSH_DELAY);
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; if (!paused) run(() => (session && meta.dirty ? push() : null)); }, ms);
  }

  // The app calls this whenever the saved plan changes.
  function changed() {
    edits++;
    if (!meta.dirty) { meta.dirty = true; writeMeta(); }
    if (session) { schedule(PUSH_DELAY); if (phase === 'synced') app.onStatus(status()); }
  }

  /* ---------- account ---------- */
  async function signIn() {
    if (!sb) throw new Error(lastError || 'Sync is still loading. Try again in a moment.');
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    if (error) throw error;
  }

  // Returns false if the student chose to stay signed in.
  async function signOut() {
    if (!sb || !session) return true;
    clearTimeout(timer); timer = null;
    if (meta.dirty && !paused) await run(push);
    if (meta.dirty && !(await app.ask('unsynced', {}))) return false;
    try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* the local session is cleared either way */ }
    session = null; paused = false;
    meta = { uid: null, version: 0, dirty: false };
    writeMeta();
    app.reset();
    set('signed-out');
    return true;
  }

  function retry() { paused = false; return run(reconcile); }

  root.DuelineSync = { init, changed, signIn, signOut, retry, status };
})(typeof window !== 'undefined' ? window : globalThis);
