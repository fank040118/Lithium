// Firebase REST API integration — no SDK required.
//
// The FB_API_KEY below is a public Web API key. Per Google's design, Web
// apiKeys are project identifiers, NOT secrets — they ship in every Firebase
// Web app's JS bundle. Real security is enforced server-side via:
//   - Firestore Security Rules (per-uid isolation + email_verified check)
//   - Cloud Quotas (daily caps on Identity Toolkit & Firestore)
//   - Email verification (required before any read/write)
//
// Fork users wanting to self-host: replace both constants below with values
// from your own Firebase project (Console → Project settings → General).

const FB_API_KEY = 'AIzaSyBtwj6EF347eJQS6W1WBdnXOB3LellcT1A';
const FB_PROJECT_ID = 'mainpage-ext';
const FB_EDIT_REV_KEY = '_fb_edit_rev';
const FB_SYNCED_REV_KEY = '_fb_synced_rev';
const FB_LOCAL_EDIT_TS_KEY = '_fb_local_edit_ts';
const FB_LEGACY_LOCAL_TS_KEY = '_fb_local_sync_ts';
const FB_CLOUD_SYNC_TS_KEY = '_fb_cloud_sync_ts';
// Raw Firestore updateTime string of the cloud version the local state is
// based on (spec §3.1). Always written and cleared together with
// FB_CLOUD_SYNC_TS_KEY in one storage operation, via _setCloudBaseline only.
const FB_CLOUD_UPDATE_TIME_KEY = '_fb_cloud_update_time';
// Persisted value of FB_CLOUD_UPDATE_TIME_KEY meaning "the cloud document does
// not exist"; only written after a GET returned 404.
const FB_CLOUD_ABSENT = 'absent';
// Account whose cloud snapshot the local state is currently based on. Written
// after every successful pull/upload and kept across sign-out so the next
// sign-in can tell whether the local data belongs to a previous account.
const FB_BASELINE_UID_KEY = '_fb_sync_baseline_uid';
// Conservative pre-check against Firestore's 100KB per-document rule limit.
// Measured in UTF-16 code units (body.length) per plan ruling R3: CJK-heavy
// payloads may under-count bytes and then fall through to the server's 403,
// which keeps the session and shows the dedicated toast as a backstop.
const FB_PAYLOAD_MAX_BYTES = 90000;
// Upper bound for one cloud request, measured until the response body has
// been read. A hung request would otherwise block every later sync step.
const FB_FETCH_TIMEOUT_MS = 20000;

const _fbStore = () =>
  globalThis.browser?.storage?.local || globalThis.chrome?.storage?.local || null;

// ── Auth state ──────────────────────────────────────────────

let _idToken = null;
let _tokenExpiry = 0;
let _refreshToken = null;
let _uid = null;
let _emailVerified = false;
let _email = null;
let _baselineUid = null; // sync baseline, persisted as FB_BASELINE_UID_KEY
// Monotonic identity counter. Bumped on every sign-out and sign-in so late
// responses (token refresh, queued upload) from a previous session can be
// detected and dropped instead of touching the new session's state.
let _authEpoch = 0;

// Categorized sync error so callers can show different feedback per error type.
class CloudSyncError extends Error {
  constructor(code, status = 0, original = null) {
    super(original?.message || code);
    this.name = 'CloudSyncError';
    // 'network' | 'auth' | 'quota' | 'firestore' | 'not-signed-in' | 'payload-too-large'
    // | 'precondition-failed' | 'already-exists' | 'not-found' (see _isPreconditionError)
    this.code = code;
    this.status = status;
    this.original = original;
  }
}

// Runs one cloud request and reads its JSON body under a single deadline.
// Resolves to { res, data } with data = null when the body is not valid JSON.
// A timeout or a fetch failure rejects with a `network` CloudSyncError. The
// deadline is raced instead of relying on the abort alone, because a response
// body (or a test double) that ignores the signal must not hang the caller.
async function _timedFetch(url, options = {}) {
  const controller = new AbortController();
  let timer = null;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Request timed out after ${FB_FETCH_TIMEOUT_MS}ms`));
      controller.abort();
    }, FB_FETCH_TIMEOUT_MS);
  });
  const request = (async () => {
    const res = await fetch(url, { ...options, signal: controller.signal });
    let data = null;
    try { data = await res.json(); } catch {}
    return { res, data };
  })();

  try {
    return await Promise.race([request, deadline]);
  } catch (err) {
    throw new CloudSyncError('network', 0, err);
  } finally {
    clearTimeout(timer);
  }
}

async function _loadAuth() {
  const s = _fbStore();
  if (!s) return;
  const d = await s.get(['_fb_refresh', '_fb_uid', '_fb_email_verified', '_fb_email', FB_BASELINE_UID_KEY]);
  _refreshToken = d._fb_refresh || null;
  _uid = d._fb_uid || null;
  _emailVerified = !!d._fb_email_verified;
  _email = d._fb_email || null;
  _baselineUid = d[FB_BASELINE_UID_KEY] || null;
  // Upgrade seeding: installs from before the baseline key existed have a
  // persisted uid but no baseline. Without a baseline, an account switch made
  // before this version's first successful sync is invisible to
  // _needsSwitchPull(), so the previous account's leftovers would win the
  // conflict branch and be uploaded to the new account. Seed the persisted uid
  // as the baseline; an existing baseline is never overwritten because the
  // switch detection depends on it.
  if (_uid && !_baselineUid) await _saveBaselineUid(_uid);
}

async function _saveAuth() {
  const s = _fbStore();
  if (!s) return;
  await s.set({
    _fb_refresh: _refreshToken,
    _fb_uid: _uid,
    _fb_email_verified: _emailVerified,
    _fb_email: _email,
  });
}

async function _clearAuth() {
  // Any in-flight token refresh or sync task was started for the session being
  // torn down; the reset bumps the epoch (making their late responses no-ops),
  // drops queued tasks, the debounce timer and the pending conflict. Must stay
  // the first, synchronous step: _clearAuth also runs inside a sync task.
  _resetSession();
  _idToken = null;
  _tokenExpiry = 0;
  _refreshToken = null;
  _uid = null;
  _emailVerified = false;
  _email = null;
  // The pending verification address belongs to the session being torn down:
  // drop it and blank the pane so a later language re-render cannot revive it.
  _pendingVerifyEmail = '';
  const verifyTargetEl = document.getElementById('verify-email-target');
  if (verifyTargetEl) verifyTargetEl.textContent = '';
  // The sync baseline is intentionally kept across sign-out: it belongs to the
  // account that just signed out, and keeping it is what tells the next
  // sign-in that the local state still contains that account's data (see
  // _needsSwitchPull). The rev keys are machine-local counters and also stay.
  // The in-memory cloud baseline was reset to Unknown by _resetSession; the
  // persisted baseline keys go in the same remove (I1).
  _lastSyncDisplayTs = 0;
  const s = _fbStore();
  if (s) await s.remove([
    '_fb_refresh', '_fb_uid', '_fb_email_verified', '_fb_email',
    FB_CLOUD_SYNC_TS_KEY, FB_CLOUD_UPDATE_TIME_KEY,
  ]);
}

// ── Token management ─────────────────────────────────────────

// In-flight refresh request (Promise | null). Concurrent _getToken() callers
// share this promise instead of racing: two parallel refreshes would both
// write _idToken/_refreshToken, and the later response could overwrite the
// newer token with a stale one.
let _tokenInFlight = null;

// Runs the actual refresh request. Callers must go through _getToken(), which
// deduplicates concurrent calls.
async function _doRefreshToken() {
  // Capture the identity this refresh belongs to. A response that lands after
  // a sign-out/sign-in must never touch the new session's state — otherwise a
  // late refresh would revive the signed-out account (and its uid).
  const epoch = _authEpoch;

  // A timeout rejects with `network` before any auth state is touched, so a
  // hung refresh never signs the user out.
  const { res, data: body } = await _timedFetch(
    `https://securetoken.googleapis.com/v1/token?key=${FB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: _refreshToken }),
      cache: 'no-store',
    }
  );
  const data = body || {};

  if (!res.ok) {
    const msg = data.error?.message || '';
    const fatal = res.status === 400 && /INVALID_GRANT|USER_DISABLED|TOKEN_EXPIRED/.test(msg);
    if (fatal || res.status === 401 || res.status === 403) {
      // The identity already changed: this failure belongs to the previous
      // session, so leave the new session's auth state untouched.
      if (epoch !== _authEpoch) return null;
      await _clearAuth();
      throw new CloudSyncError('auth', res.status, new Error(msg));
    }
    if (res.status === 429) {
      throw new CloudSyncError('quota', res.status, new Error(msg));
    }
    if (res.status >= 500) {
      throw new CloudSyncError('network', res.status, new Error(msg));
    }
    throw new CloudSyncError('auth', res.status, new Error(msg));
  }

  if (epoch !== _authEpoch) return null;

  _idToken = data.id_token;
  _tokenExpiry = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  _refreshToken = data.refresh_token;
  _uid = data.user_id;
  await _saveAuth();
  return _idToken;
}

async function _getToken() {
  if (_idToken && Date.now() < _tokenExpiry - 60000) return _idToken;
  if (!_refreshToken) return null;
  if (_tokenInFlight) return _tokenInFlight;

  // Cleared once the shared request settles, success or failure: a rejected
  // refresh must not poison later attempts.
  _tokenInFlight = _doRefreshToken().finally(() => { _tokenInFlight = null; });
  return _tokenInFlight;
}

// ── Public auth ──────────────────────────────────────────────

function _parseEmailVerifiedFromToken(jwt) {
  try {
    const payload = jwt.split('.')[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return !!decoded.email_verified;
  } catch { return false; }
}

async function fbSignIn(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const d = await res.json();
  if (!res.ok) throw new Error(d.error?.message || 'LOGIN_FAILED');
  // A new identity invalidates in-flight and queued work from the previous
  // session.
  _resetSession();
  _idToken = d.idToken;
  _tokenExpiry = Date.now() + Number(d.expiresIn) * 1000;
  _refreshToken = d.refreshToken;
  _uid = d.localId;
  _email = email;
  _emailVerified = _parseEmailVerifiedFromToken(d.idToken);
  await _saveAuth();
}

async function fbSignUp(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const d = await res.json();
  if (!res.ok) throw new Error(d.error?.message || 'SIGNUP_FAILED');
  // A new identity invalidates in-flight and queued work from the previous
  // session.
  _resetSession();
  _idToken = d.idToken;
  _tokenExpiry = Date.now() + Number(d.expiresIn) * 1000;
  _refreshToken = d.refreshToken;
  _uid = d.localId;
  _email = email;
  _emailVerified = false;
  await _saveAuth();
  await fbSendEmailVerification();
}

// Firebase Auth ships a complete password-reset flow: we just trigger the
// email via sendOobCode (PASSWORD_RESET), and Firebase hosts the landing
// page where the user enters a new password + verifies the token. No
// custom backend or reset page needed on our side.
async function fbSendPasswordReset(email) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
    }
  );
  const d = await res.json();
  if (!res.ok) throw new Error(d.error?.message || 'SEND_PASSWORD_RESET_FAILED');
}

async function fbSendEmailVerification() {
  const token = await _getToken();
  if (!token) throw new Error('NOT_SIGNED_IN');
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${FB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'VERIFY_EMAIL', idToken: token }),
    }
  );
  const d = await res.json();
  if (!res.ok) throw new Error(d.error?.message || 'SEND_VERIFICATION_FAILED');
}

// Polls Firebase for the latest email_verified flag. Returns true if verified.
// Also forces a fresh idToken so subsequent Firestore requests carry the new claim.
async function fbRefreshEmailVerifiedStatus() {
  const token = await _getToken();
  if (!token) return false;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    }
  );
  if (!res.ok) return _emailVerified;
  const d = await res.json();
  const verified = !!d.users?.[0]?.emailVerified;
  if (verified !== _emailVerified) {
    _emailVerified = verified;
    await _saveAuth();
  }
  if (verified) {
    // Refresh token so the JWT carries email_verified=true for Firestore rules
    _idToken = null;
    _tokenExpiry = 0;
    await _getToken();
  }
  return verified;
}

async function fbSignOut() {
  await _clearAuth();
  _updateSyncUI();
}

// Delete the user's cloud data and Firebase account permanently, as an
// executor task (spec §5.1). Queueing it drops every not-started task
// (session-changed) and sets the deleting flag; while the flag is set no task
// may upload, above all no exists=false import that would recreate the
// document before it is deleted (the dequeue guard, step 2, and _pushCore's
// I4 block). Any task result other than a completed run rejects.
async function fbDeleteAccount() {
  // From the signed-in check to setting the flag is one synchronous block
  // (no await): a signed-out caller never sets the flag or queues anything.
  if (!fbIsSignedIn()) throw new Error('NOT_SIGNED_IN');
  _accountDeleting = true;
  _dropQueuedSyncTasks('session-changed');
  clearTimeout(_syncTimer);
  _syncTimer = null;
  try {
    const r = await _enqueueSync({ kind: 'delete-account', auto: false, run: _deleteAccountTask });
    if (r?.reason) throw new Error(r.reason === 'session-changed' ? 'DELETE_ACCOUNT_FAILED' : r.reason);
  } finally {
    // Cleared on success and on failure. The guaranteed property: while the
    // flag is set, no PATCH is sent and nothing is imported. Whether a task
    // queued during a failed deletion is still dequeued under the flag
    // depends on microtask order and is not relied on: once the flag is
    // cleared it runs through the normal guards, and any PATCH it sends
    // still carries a precondition. After a partial failure (document
    // deleted, account kept) that is the import along the normal Absent path
    // the spec allows (§5.1): the data comes back, the safe direction.
    _accountDeleting = false;
  }
}

// Deletion task body. Firestore side is best-effort: a missing document,
// rejecting rules (e.g. unverified email) or a timeout only warn, and the
// auth account is deleted anyway. Continuing after a DELETE timeout can at
// worst leave an orphaned document behind; it never overwrites any data.
// Resolves {} on success; errors reject (the UI shows the message).
async function _deleteAccountTask(ctx) {
  const token = await _getToken();
  if (!ctx.alive()) return { reason: 'session-changed' };
  if (!token) throw new Error('NOT_SIGNED_IN');

  // 1. Delete Firestore data (best-effort)
  if (_uid) {
    try {
      await _timedFetch(_docUrl(), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      console.warn('Firestore data deletion failed (continuing):', e);
    }
  }

  // 2. Delete the Auth account; the body is read inside the request's
  // timeout (a timeout rejects with `network`).
  const { res, data } = await _timedFetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${FB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    }
  );
  if (!res.ok) throw new Error(data?.error?.message || 'DELETE_ACCOUNT_FAILED');

  // 3. Clear local auth state, unless the session already ended meanwhile
  // (a sign-out, or a sign-in this must not tear down).
  if (ctx.alive()) await _clearAuth();
  return {};
}

function fbIsSignedIn() { return !!_refreshToken; }
function fbIsEmailVerified() { return !!_emailVerified; }
function fbGetEmail() { return _email; }

function _normalizeTs(value) {
  const ts = Number(value);
  return Number.isFinite(ts) && ts > 0 ? ts : 0;
}

function _rfc3339ToMs(value) {
  if (!value || typeof value !== 'string') return 0;
  const trimmed = value.replace(/\.(\d{3})\d*Z$/, '.$1Z');
  const d = new Date(trimmed);
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

// Local edit counter vs. the edit rev last known to be on the server.
// `dirty` is derived state: _editRev !== _syncedRev. Both values persist so
// pending edits survive page reloads and stay isolated from server clocks.
//
// One-time migration from the legacy local sync timestamp: a local ts newer
// than the last known cloud ts means there were unsynced local edits.
// Callers must run _loadCloudBaseline() first so _lastCloudTs is populated.
async function _loadRevState() {
  const s = _fbStore();
  if (!s) return { editRev: _editRev, syncedRev: _syncedRev };
  const d = await s.get([FB_EDIT_REV_KEY, FB_SYNCED_REV_KEY, FB_LEGACY_LOCAL_TS_KEY, FB_LOCAL_EDIT_TS_KEY]);
  if (d[FB_EDIT_REV_KEY] === undefined) {
    const dirty = _normalizeTs(d[FB_LEGACY_LOCAL_TS_KEY]) > _lastCloudTs;
    _editRev = dirty ? 1 : 0;
    _syncedRev = 0;
    _localEditTs = 0;
    await s.remove([FB_LEGACY_LOCAL_TS_KEY]);
    await _saveRevState();
  } else {
    _editRev = _normalizeTs(d[FB_EDIT_REV_KEY]);
    _syncedRev = _normalizeTs(d[FB_SYNCED_REV_KEY]);
    _localEditTs = _normalizeTs(d[FB_LOCAL_EDIT_TS_KEY]);
  }
  return { editRev: _editRev, syncedRev: _syncedRev };
}

async function _saveRevState() {
  const s = _fbStore();
  if (!s) return;
  await s.set({
    [FB_EDIT_REV_KEY]: _editRev,
    [FB_SYNCED_REV_KEY]: _syncedRev,
    [FB_LOCAL_EDIT_TS_KEY]: _localEditTs,
  });
}

// ── Cloud baseline (spec §3.1) ──────────────────────────────
//
// Baseline = { kind: 'unknown' } | { kind: 'absent' }
//          | { kind: 'known', raw: string, ns: bigint }
// The raw string is kept verbatim (it is what a precondition sends); all
// comparisons go through its nanosecond value as a BigInt.

const UPDATE_TIME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/;

// Nanoseconds since the epoch for a Firestore updateTime, or null when the
// value is not a Z-offset RFC 3339 timestamp with at most 9 fractional digits.
function _parseUpdateTimeNs(raw) {
  if (typeof raw !== 'string') return null;
  const m = UPDATE_TIME_RE.exec(raw);
  if (!m) return null;
  const secondsMs = Date.parse(`${m[1]}Z`);
  if (!Number.isFinite(secondsMs)) return null;
  const fraction = (m[2] || '').padEnd(9, '0');
  return BigInt(secondsMs) * 1000000n + BigInt(fraction);
}

// Milliseconds for a raw updateTime (display and the ms key); 0 if unparsable.
function _updateTimeToMs(raw) {
  const ns = _parseUpdateTimeNs(raw);
  return ns === null ? 0 : Number(ns / 1000000n);
}

// Same instant in nanoseconds; an unparsable side never compares equal.
function _sameUpdateTime(a, b) {
  const na = _parseUpdateTimeNs(a);
  const nb = _parseUpdateTimeNs(b);
  return na !== null && nb !== null && na === nb;
}

function _knownBaseline(raw) {
  const ns = _parseUpdateTimeNs(raw);
  return ns === null ? null : { kind: 'known', raw, ns };
}

// Pure mapping of the two persisted keys to the in-memory baseline, with the
// I1 load check: a raw string whose ms does not match the ms key (downgrade,
// or an old tab wrote the ms key alone) is Unknown and its ms is discarded.
// Only a missing raw string with a ms value is the migration state (§9).
function _baselineFromStorage(rawVal, msVal) {
  const unknown = { baseline: { kind: 'unknown' }, lastCloudTs: 0 };
  const ms = _normalizeTs(msVal);
  if (rawVal === FB_CLOUD_ABSENT) {
    return ms === 0 ? { baseline: { kind: 'absent' }, lastCloudTs: 0 } : unknown;
  }
  if (rawVal === undefined || rawVal === null) {
    return { baseline: { kind: 'unknown' }, lastCloudTs: ms };
  }
  const known = _knownBaseline(rawVal);
  if (!known || _updateTimeToMs(rawVal) !== ms) return unknown;
  return { baseline: known, lastCloudTs: ms };
}

// Pre-1.0.5 installs: no raw string yet, only the old ms value (spec §9).
function _isMigrationState() {
  return _cloudBaseline.kind === 'unknown' && _lastCloudTs > 0;
}

async function _loadCloudBaseline() {
  const s = _fbStore();
  if (!s) return _cloudBaseline;
  const d = await s.get([FB_CLOUD_UPDATE_TIME_KEY, FB_CLOUD_SYNC_TS_KEY]);
  const loaded = _baselineFromStorage(d[FB_CLOUD_UPDATE_TIME_KEY], d[FB_CLOUD_SYNC_TS_KEY]);
  _cloudBaseline = loaded.baseline;
  _lastCloudTs = loaded.lastCloudTs;
  return _cloudBaseline;
}

// The only writer of the two baseline keys: both go in one storage operation
// (I1). Storage first, memory after: a failed write leaves the old baseline in
// memory too and rethrows. A session reset during the write keeps the new
// session's Unknown baseline in memory instead of the previous account's.
async function _setCloudBaseline(baseline) {
  const epoch = _authEpoch;
  const ms = baseline.kind === 'known' ? _updateTimeToMs(baseline.raw) : 0;
  const s = _fbStore();
  if (s) {
    if (baseline.kind === 'known') {
      await s.set({ [FB_CLOUD_UPDATE_TIME_KEY]: baseline.raw, [FB_CLOUD_SYNC_TS_KEY]: ms });
    } else if (baseline.kind === 'absent') {
      await s.set({ [FB_CLOUD_UPDATE_TIME_KEY]: FB_CLOUD_ABSENT, [FB_CLOUD_SYNC_TS_KEY]: 0 });
    } else {
      await s.remove([FB_CLOUD_UPDATE_TIME_KEY, FB_CLOUD_SYNC_TS_KEY]);
    }
  }
  if (epoch !== _authEpoch) return;
  _cloudBaseline = baseline;
  _lastCloudTs = ms;
}

// Read-only view of the in-memory baseline (tests and diagnostics).
function _getCloudBaseline() {
  return { baseline: { ..._cloudBaseline }, lastCloudTs: _lastCloudTs };
}

// ── Storage re-read (spec §8) ──
// Another tab of this extension shares chrome.storage.local: it may have
// signed out (auth and baseline keys removed) or uploaded (new baseline
// written) since this page loaded its baseline into memory.

// StorageRead = { ok: false }
//             | { ok: true, authCleared, baselinePresent, stored, storedValid }
// stored is the I1-checked baseline of the two keys; storedValid is false when
// it is Unknown (missing raw string, invalid value, or failed I1 check).
async function _readSyncStorage() {
  const s = _fbStore();
  if (!s) return { ok: false };
  let d;
  try {
    d = (await s.get(['_fb_refresh', FB_CLOUD_UPDATE_TIME_KEY, FB_CLOUD_SYNC_TS_KEY])) || {};
  } catch {
    return { ok: false };
  }
  const stored = _baselineFromStorage(d[FB_CLOUD_UPDATE_TIME_KEY], d[FB_CLOUD_SYNC_TS_KEY]).baseline;
  return {
    ok: true,
    authCleared: !d._fb_refresh,
    baselinePresent: FB_CLOUD_UPDATE_TIME_KEY in d || FB_CLOUD_SYNC_TS_KEY in d,
    stored,
    storedValid: stored.kind !== 'unknown',
  };
}

// Absent and Absent, or Known and Known at the same nanosecond.
function _sameBaseline(a, b) {
  if (a.kind === 'absent' && b.kind === 'absent') return true;
  return a.kind === 'known' && b.kind === 'known' && a.ns === b.ns;
}

// The first two rows of the §8 table, which every task checks before it
// lands or writes keys back. Returns the skip reason, or null to go on.
function _checkStorageForWrite(read) {
  if (!read.ok) return 'storage-unavailable';
  if (read.authCleared) return 'baseline-cleared';
  return null;
}

// The §8 table for an upload body, top to bottom, first match wins. Pure.
// mem: the in-memory baseline. exemptValueDiff (choose-local and the import
// of choose-cloud): only the cleared rows apply; a differing or invalid
// stored value does not trigger a recovery pull.
// Deviation (plan, preflight D3): with exemptValueDiff an Unknown in-memory
// baseline returns 'proceed' instead of 'baseline-pull' — choose-local sends
// the raw string it captured at enqueue time, so the spec's "cannot happen"
// cell is left to its caller (which then runs the baseline pull itself when
// it has no captured precondition) rather than decided here.
function _decideUploadStorage(read, mem, { exemptValueDiff = false } = {}) {
  const cleared = _checkStorageForWrite(read);
  if (cleared) return cleared;
  if (mem.kind === 'unknown') return exemptValueDiff ? 'proceed' : 'baseline-pull';
  // Baseline keys gone while memory still holds one: another tab signed out.
  // Pulling would write the keys back, so stop without any request.
  if (!read.baselinePresent) return 'baseline-cleared';
  if (!read.storedValid || !_sameBaseline(read.stored, mem)) {
    return exemptValueDiff ? 'proceed' : 'recovery-pull';
  }
  return 'proceed';
}

// §4: the cloud is unchanged only when the GET time equals the Known baseline
// in nanoseconds, or, in the migration state, equals the old ms value.
function _isCloudUnchanged(raw) {
  if (_cloudBaseline.kind === 'known') return _sameUpdateTime(_cloudBaseline.raw, raw);
  return _isMigrationState() && _rfc3339ToMs(raw) === _lastCloudTs;
}

// ── Firestore helpers ────────────────────────────────────────

// Store everything as JSON strings to avoid Firestore's typed-value complexity
function _toFV(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'number' && Number.isInteger(val)) return { integerValue: String(val) };
  if (typeof val === 'string') return { stringValue: val };
  return { stringValue: JSON.stringify(val) };
}

function _fromFV(fv) {
  if (!fv) return null;
  if ('nullValue' in fv) return null;
  if ('integerValue' in fv) return parseInt(fv.integerValue, 10);
  if ('stringValue' in fv) {
    const s = fv.stringValue;
    try { return JSON.parse(s); } catch { return s; }
  }
  return null;
}

function _docUrl(uid = _uid) {
  return `https://firestore.googleapis.com/v1/projects/${FB_PROJECT_ID}/databases/(default)/documents/users/${uid}/data/settings`;
}

// ── Upload preconditions (spec §3.1 I3, §5.2) ──

// The Firestore precondition for a PATCH based on `baseline`. An Unknown
// baseline has no precondition: callers establish it first (§5.3), so reaching
// this with Unknown is a programming error.
function _preconditionFromBaseline(b) {
  if (b.kind === 'known') return { updateTime: b.raw };
  if (b.kind === 'absent') return { exists: false };
  throw new Error('precondition requested for unknown baseline');
}

// Query string carrying a precondition; the raw updateTime is sent verbatim.
// Only the two well-formed shapes are accepted: anything else (no updateTime,
// undefined, a non-string or empty value) is a programming error and must
// never silently become exists=false or the literal "undefined".
function _preconditionQuery(pre) {
  if (pre && 'updateTime' in pre) {
    if (typeof pre.updateTime !== 'string' || pre.updateTime === '') {
      throw new Error('invalid precondition updateTime');
    }
    return '?currentDocument.updateTime=' + encodeURIComponent(pre.updateTime);
  }
  if (pre && pre.exists === false) return '?currentDocument.exists=false';
  throw new Error('invalid precondition');
}

// Choose-local's precondition (spec §5.2, §7.3): the cloud version recorded in
// the pending conflict, captured when the choice was queued. A 404 sends
// exists=false; an existing document (with or without fields) its raw string.
function _preconditionFromPending({ cloudState, cloudRaw }) {
  return cloudState === 'not-found' ? { exists: false } : { updateTime: cloudRaw };
}

// PATCH body for a sync snapshot (whole-document replace, no updateMask).
function _buildUploadBody(snap, now) {
  const data = {
    items: JSON.stringify(snap.items),
    engines: JSON.stringify(snap.engines),
    selected_engine: snap.selected_engine,
    clocks: JSON.stringify(snap.clocks),
    grid_columns: snap.grid_columns,
    updated_at: now, // 兼容旧客户端/UI 显示，不作为冲突判断依据
  };
  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, _toFV(v)]));
  return JSON.stringify({ fields });
}

// Codes of a PATCH rejected by its precondition (spec §6.1).
function _isPreconditionError(code) {
  return code === 'precondition-failed' || code === 'already-exists' || code === 'not-found';
}

async function _fsGet() {
  const token = await _getToken();
  if (!token) throw new CloudSyncError('not-signed-in', 0);

  const { res, data } = await _timedFetch(_docUrl(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
    cache: 'no-store',
  });

  if (res.status === 404) return null;

  if (!res.ok) {
    const { code, status } = await _parseFirestoreError(res, data, { op: 'get' });
    throw new CloudSyncError(code, status);
  }
  // A 200 whose body cannot be parsed says nothing about the document; it
  // must never be mistaken for "document absent" (null).
  if (data === null) throw new CloudSyncError('firestore', res.status);
  return data;
}

// Sends one prepared PATCH. The caller supplies the url (document plus
// precondition query), the token and the body, all taken in its I4 block
// (spec §3.1), so nothing here awaits before the request goes out.
async function _fsSet({ url, token, body }) {
  if (!token) throw new CloudSyncError('not-signed-in', 0);

  const { res, data: doc } = await _timedFetch(url, {
    method: 'PATCH',
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
    body,
  });

  if (!res.ok) {
    const { code, status } = await _parseFirestoreError(res, doc, { op: 'patch' });
    throw new CloudSyncError(code, status);
  }

  return doc?.updateTime || null;
}

// `body` is the already-read error body (null when unparsable): reading it is
// part of the request's timed window, see _timedFetch. `op` is the failed
// request ('get' | 'patch'): only a PATCH's NOT_FOUND is a precondition error.
async function _parseFirestoreError(res, body, { op } = {}) {
  const data = body || {};
  const msg = data.error?.message || '';
  const errStatus = data.error?.status || '';
  const status = res.status;

  if (status === 401 || status === 403 ||
      errStatus === 'UNAUTHENTICATED' ||
      errStatus === 'PERMISSION_DENIED' ||
      msg.includes('UNAUTHENTICATED') ||
      msg.includes('PERMISSION_DENIED')) {
    // The request was rejected. Force a token refresh before deciding: a
    // refresh that still succeeds means the credentials are fine and the
    // write was refused by the rules (e.g. the 100KB document limit) — the
    // session must survive that. Only a refresh that itself fails (or that
    // has no refresh token left) proves the login is dead.
    _idToken = null;
    _tokenExpiry = 0;
    try {
      const token = await _getToken();
      if (!token) {
        // _getToken returns null both when there is no refresh token at all
        // and when the refresh lost its identity race; only clear auth in the
        // former case — the latter means a new session has already taken over.
        if (!_refreshToken) await _clearAuth();
        return { code: 'auth', status };
      }
      return { code: 'firestore', status };
    } catch (e) {
      // _getToken clears auth itself for fatal refresh failures. Keep the
      // failure kind (network is retryable, quota has its own toast) and fall
      // back to auth for everything else.
      return { code: e?.code || 'auth', status };
    }
  }
  if (status === 429 ||
      errStatus === 'RESOURCE_EXHAUSTED' ||
      msg.includes('QUOTA_EXCEEDED') ||
      msg.includes('RESOURCE_EXHAUSTED')) {
    return { code: 'quota', status };
  }
  // Precondition failures (spec §6.1) are told apart by error.status only:
  // HTTP 400 is also INVALID_ARGUMENT, and 409 is also ABORTED.
  if (errStatus === 'FAILED_PRECONDITION') return { code: 'precondition-failed', status };
  if (errStatus === 'ALREADY_EXISTS') return { code: 'already-exists', status };
  if (op === 'patch' && errStatus === 'NOT_FOUND') return { code: 'not-found', status };
  return { code: 'firestore', status };
}

// ── Sync ────────────────────────────────────────────────────

let _syncTimer = null;
let _syncQueue = [];      // not-started sync tasks, in run order
let _syncCurrent = null;  // the running sync task, or null
let _cloudBaseline = { kind: 'unknown' }; // see _setCloudBaseline
// Ms of the Known baseline; 0 for Absent/Unknown, except the migration state
// (Unknown with the pre-1.0.5 ms value, used only by _isCloudUnchanged).
let _lastCloudTs = 0;
let _editRev = 0;         // local edit counter, persisted as _fb_edit_rev
let _syncedRev = 0;       // edit rev last uploaded to the cloud, persisted as _fb_synced_rev
let _localEditTs = 0;     // wall-clock of last user edit on this machine (display only), persisted as _fb_local_edit_ts
// _syncState and _lastSyncError are consumed by _updateSyncUI in Task 3.
let _syncState = 'idle';  // 'idle' | 'uploading' | 'downloading' | 'error'
let _lastSyncError = null;
// Code of the last failed automatic upload, used to suppress a repeated
// payload-too-large toast while the user keeps editing. Reset on success.
let _lastAutoUploadErrorCode = null;
// Conflict state: set when a pull detects that the local (dirty) state differs
// from the signed-in account's cloud snapshot. While set, automatic uploads are
// paused so the stale local state is never PATCHed over the cloud until the
// user resolves the conflict (Tasks 4/5).
let _conflictPending = null;
// True while an account deletion runs: no upload may (re)create the document.
// Set and cleared by fbDeleteAccount; checked by the dequeue guard
// (_dequeueGuard, spec §7.3 step 2) and again in _pushCore's I4 block, since
// a deletion can start while an upload task is already running.
let _accountDeleting = false;
// In-flight snapshot (spec §3.2, §6.3): the payload of the latest PATCH whose
// outcome is unknown (network failure, timeout, malformed response), with the
// edit rev it started from: { snap, revAtStart } | null. A later pull that
// finds exactly this content in the cloud adopts it as our own write instead
// of treating it as a conflict. Only the latest one is kept: if two uploads
// fail in a row and the earlier one is what actually landed, that pull falls
// back to an ordinary comparison and may surface one extra conflict — the
// accepted safe direction (§6.3), never an overwrite. Lost on reload, too.
// Cleared by a successful PATCH, any landing and _resetSession.
let _inflightUpload = null;

function _isDirty() { return _editRev !== _syncedRev; }

// True while the local state is still based on a different account's cloud
// snapshot, i.e. an account switch has not been fully resolved yet.
//
// Product semantics (intentionally kept from before this mechanism existed):
// with no baseline at all — a fresh device, first ever sign-in — a dirty local
// state still wins over an existing cloud document in syncFromCloud's conflict
// branch. Only when a baseline exists AND points at another uid does the
// signed-in account's cloud snapshot become authoritative.
function _needsSwitchPull() {
  return !!_baselineUid && _baselineUid !== _uid;
}

// Persist the account whose cloud snapshot the local state is currently based
// on. Called after every successful pull and every successful upload; survives
// sign-out so the next sign-in can detect an account switch. Mirrors the value
// in memory even when storage is unavailable.
async function _saveBaselineUid(uid) {
  _baselineUid = uid || null;
  const s = _fbStore();
  if (!s) return;
  await s.set({ [FB_BASELINE_UID_KEY]: _baselineUid });
}

// Build a plain snapshot of the current in-memory sync state. Tasks 3–5 use
// this together with _compareSnapshots for conflict detection and resolution.
function _buildSyncSnapshot() {
  return {
    items,
    engines: customEngines,
    selected_engine: selectedEngineId,
    clocks,
    grid_columns: mainGridColumns,
  };
}

// True when the cloud snapshot is exactly the in-flight upload's payload: every
// field compared (none skipped) and equal.
function _matchesInflight(cloudSnap) {
  if (!_inflightUpload) return false;
  const { equal, skippedFields } = _compareSnapshots(_inflightUpload.snap, cloudSnap);
  return equal && skippedFields.length === 0;
}

// Recursively count shortcuts and folders in a sync snapshot's items for the
// conflict dialog. Folders count as folders (not shortcuts) and are descended
// into; weather widgets are ignored; any other object (link, missing or unknown
// type, matching sanitizeList's coercion to link) is one shortcut. Non-object
// entries and non-array input are ignored.
function _countSyncItems(items) {
  const counts = { shortcuts: 0, folders: 0 };
  const walk = (list) => {
    if (!Array.isArray(list)) return;
    for (const it of list) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
      if (it.type === 'folder') {
        counts.folders += 1;
        walk(it.children);
      } else if (it.type !== 'weather') {
        counts.shortcuts += 1;
      }
    }
  };
  walk(items);
  return counts;
}

// Convert a Firestore `fields` map into the same snapshot shape. A missing key
// maps to `undefined`; an explicitly present field (including a Firestore
// `nullValue`, which `_fromFV` decodes to `null`) maps to its decoded value.
// This lets callers distinguish "absent" (undefined) from "explicit null".
function _cloudSnapshotFromFields(fields) {
  const f = fields || {};
  return {
    items: f.items === undefined ? undefined : _fromFV(f.items),
    engines: f.engines === undefined ? undefined : _fromFV(f.engines),
    selected_engine: f.selected_engine === undefined ? undefined : _fromFV(f.selected_engine),
    clocks: f.clocks === undefined ? undefined : _fromFV(f.clocks),
    grid_columns: f.grid_columns === undefined ? undefined : _fromFV(f.grid_columns),
  };
}

// Deterministic JSON for structural comparison: sort keys of plain objects
// recursively, keep array order, then stringify.
function _canonicalJson(v) {
  const canon = (x) => {
    if (Array.isArray(x)) return x.map(canon);
    if (x !== null && typeof x === 'object') {
      const out = {};
      for (const key of Object.keys(x).sort()) out[key] = canon(x[key]);
      return out;
    }
    return x;
  };
  return JSON.stringify(canon(v));
}

// Compare a local snapshot against a cloud snapshot. A field the cloud side has
// "no opinion" on (missing, or of the wrong type) is skipped rather than
// counted as a difference. Returns { equal, skippedFields }.
function _compareSnapshots(local, cloud) {
  const skippedFields = [];
  const sameJson = (a, b) => _canonicalJson(a) === _canonicalJson(b);

  // items: must be an array; normalized through the same chain as the apply
  // path (sanitizeItemsShape ?? normalizeFolderChildItemSizes ?? identity).
  let itemsEqual = true;
  if (!Array.isArray(cloud.items)) {
    skippedFields.push('items');
  } else {
    const normalize = typeof globalThis.sanitizeItemsShape === 'function'
      ? globalThis.sanitizeItemsShape
      : (typeof globalThis.normalizeFolderChildItemSizes === 'function'
          ? globalThis.normalizeFolderChildItemSizes
          : null);
    const localItems = normalize ? normalize(local.items).items : local.items;
    const cloudItems = normalize ? normalize(cloud.items).items : cloud.items;
    // Note: sanitizeItemsShape assigns a fresh id to any item missing one, so
    // a cloud item without an id compares unequal — the safe direction.
    itemsEqual = sameJson(localItems, cloudItems);
  }

  // engines: compared raw, deliberately never sanitized.
  let enginesEqual = true;
  if (!Array.isArray(cloud.engines)) {
    skippedFields.push('engines');
  } else {
    enginesEqual = sameJson(local.engines, cloud.engines);
  }

  // selected_engine: must be a non-empty string.
  let engineEqual = true;
  if (typeof cloud.selected_engine !== 'string' || cloud.selected_engine === '') {
    skippedFields.push('selected_engine');
  } else {
    engineEqual = local.selected_engine === cloud.selected_engine;
  }

  // clocks: must be an array (an empty array is a real opinion).
  let clocksEqual = true;
  if (!Array.isArray(cloud.clocks)) {
    skippedFields.push('clocks');
  } else {
    clocksEqual = sameJson(local.clocks, cloud.clocks);
  }

  // grid_columns: must be a finite number; compared after clamping.
  let columnsEqual = true;
  if (typeof cloud.grid_columns !== 'number' || !Number.isFinite(cloud.grid_columns)) {
    skippedFields.push('grid_columns');
  } else {
    const clamp = typeof globalThis.clampMainGridColumns === 'function'
      ? globalThis.clampMainGridColumns
      : (v) => v;
    columnsEqual = clamp(local.grid_columns) === clamp(cloud.grid_columns);
  }

  return {
    equal: itemsEqual && enginesEqual && engineEqual && clocksEqual && columnsEqual,
    skippedFields,
  };
}

// Whole-object assignment, NOT a partial merge: callers always pass the full
// info shape { isAccountSwitch, localShortcutCount, localFolderCount,
// cloudShortcutCount, cloudFolderCount, localEditTime (ms, 0 = unknown),
// cloudUpdateTime (ms, 0 = none), cloudRaw, cloudState, trigger } (built only
// by _recordConflict), so any omitted field here would silently drop from the
// pending state.
//   cloudState: 'doc' (a document with fields; how a conflict first appears),
//     'empty' (a document without fields) or 'not-found' (GET 404) — the
//     latter two are the cloud-absent marks of spec §7.3.
//   cloudRaw: that GET's raw updateTime; null for 'not-found'.
function _setConflictPending(info) {
  _conflictPending = info;
}

// Records (or updates) the pending conflict from a pull that saw the cloud at
// `cloudRaw` / `cloudState` and did not land it. The local side is recounted
// from the current state; the hook fires from the executor (ctx.notifyConflict).
function _recordConflict(ctx, { cloudCounts, cloudUpdateTime, cloudRaw, cloudState, trigger }) {
  // Cancel any queued automatic upload: the local state must not be PATCHed
  // over the cloud before the conflict is resolved.
  clearTimeout(_syncTimer);
  _syncTimer = null;
  const localCounts = _countSyncItems(items);
  _setConflictPending({
    isAccountSwitch: _needsSwitchPull(),
    localShortcutCount: localCounts.shortcuts,
    localFolderCount: localCounts.folders,
    cloudShortcutCount: cloudCounts.shortcuts,
    cloudFolderCount: cloudCounts.folders,
    localEditTime: _localEditTs,
    cloudUpdateTime,
    cloudRaw,
    cloudState,
    trigger,
  });
  ctx.notifyConflict = true;
  _syncState = 'idle';
  _updateSyncUI();
}

function _clearConflictPending() {
  _conflictPending = null;
}

// Shallow copy so callers can read the pending conflict without mutating it.
// Returns null when no conflict is pending.
function fbGetSyncConflict() {
  return _conflictPending ? { ..._conflictPending } : null;
}

// Surface a detected conflict to the host page. The hook is optional; without
// it we log once and move on. A throwing hook must never interrupt the sync
// flow — the conflict is already recorded in _conflictPending regardless.
function _notifySyncConflict(info) {
  try {
    if (typeof globalThis.onSyncConflict === 'function') {
      globalThis.onSyncConflict({ ...info });
    } else {
      console.warn('[firebase] sync conflict detected', info);
    }
  } catch {
    // ignore hook errors; the pending conflict is already set
  }
}

// Resolve a pending sync conflict by explicit user choice:
//   'cloud' — apply the cloud snapshot unconditionally (drops local edits).
//   'local' — upload the local state over the cloud version the user saw.
// Both are executor tasks (spec §5.1); this entry point only validates and
// queues. Returns { ok: boolean, code?: string } so the host can react to each
// failure mode. Both branches are fail-safe: a failure never silently picks a
// winner.
async function fbResolveSyncConflict(choice) {
  // From here to _enqueueSync is one synchronous block (no await): the pending
  // conflict choose-local captures is the one these checks saw.
  if (!fbIsSignedIn() || !fbIsEmailVerified()) {
    return { ok: false, code: 'not-signed-in' };
  }
  if (!_conflictPending) {
    return { ok: false, code: 'no-conflict' };
  }
  if (choice !== 'cloud' && choice !== 'local') {
    return { ok: false, code: 'invalid-choice' };
  }

  let task;
  if (choice === 'local') {
    // The cloud version the user compared against; checked again at dequeue.
    const captured = { cloudState: _conflictPending.cloudState, cloudRaw: _conflictPending.cloudRaw };
    task = _enqueueSync({
      kind: 'resolve-local', auto: false, captured,
      run: (ctx) => _resolveLocalTask(ctx, captured).catch(_markSyncErrorAndThrow),
    });
  } else {
    task = _enqueueSync({
      kind: 'resolve-cloud', auto: false,
      run: (ctx) => _resolveCloudTask(ctx).catch(_markSyncErrorAndThrow),
    });
  }

  let r;
  try {
    r = await task;
  } catch (e) {
    // Errors keep the conflict pending (choose-local §6.4; a failed choose-cloud
    // GET), except a failed choose-cloud import, whose pull already resolved it.
    return { ok: false, code: e?.code || 'firestore' };
  }
  if (r.resolved) return r.code ? { ok: true, code: r.code } : { ok: true };
  // §5.4: a pull that ended in (or updated) the conflict is "cloud changed" to
  // the dialog; every other reason is its own code.
  return { ok: false, code: r.reason === 'conflict' ? 'cloud-changed' : r.reason };
}

// Choose-local task body (spec §5.1, §5.2, §6.2, §6.4, §7.3), after the
// dequeue guards (which already re-checked the pending conflict against
// `captured`). Exempt from switch-pending, the clean skip and the §8 "stored
// value differs" row; not from the firewall, deletion, epoch or a cleared
// storage. Every failure keeps the conflict pending; only a successful upload
// (an import included) clears it.
// Resolves { resolved: true } | { resolved: false, reason }; other errors reject.
async function _resolveLocalTask(ctx, captured) {
  const stop = (reason) => ({ resolved: false, reason });
  if (typeof globalThis.isStorageLoadFailed === 'function' && globalThis.isStorageLoadFailed()) {
    return stop('storage-read-only');
  }
  // §8 re-read right before the request; only the cleared rows apply.
  const read = await _readSyncStorage();
  if (!ctx.alive()) return stop('session-changed');
  ctx.storageRead = read;
  const decision = _decideUploadStorage(read, _cloudBaseline, { exemptValueDiff: true });
  if (decision !== 'proceed') return stop(decision);

  const r = await _pushWithRecovery(ctx, {
    precondition: _preconditionFromPending(captured),
    compareWhenClean: true,
    afterRecoveryPull: _resolveLocalAfterPull,
  });
  // up-to-date: the recovery pull found the same content and resolved it.
  if (r.uploaded || r.reason === 'up-to-date') return { resolved: true };
  return stop(r.reason);
}

// Choose-local's step after a recovery pull. A cloud-absent mark (404 or
// empty document, still pending) retries against the new mark: the import,
// which clears the pending only once it succeeds (§6.2). Everything else
// follows the upload rules: a still-different cloud stops with conflict, a
// landing that resolved the conflict stops with up-to-date.
function _resolveLocalAfterPull(pull) {
  if (pull.outcome === 'conflict' && pull.cloud && _conflictPending) {
    return { precondition: _preconditionFromPending(_conflictPending) };
  }
  return _uploadAfterPull(pull);
}

// Choose-cloud task body (spec §5.1, §7.3), after the dequeue guards (which
// already re-checked that a conflict is pending). Lands the cloud side
// unconditionally — the landing is not limited by the firewall (it lifts it).
// A cloud with no data resolves the conflict and imports the local state in
// this same hold.
// Resolves { resolved: true, code? } | { resolved: false, reason }; a failed
// GET or import rejects.
async function _resolveCloudTask(ctx) {
  _syncState = 'downloading';
  _lastSyncError = null;
  _updateSyncUI();
  const pull = await _pullCore(ctx, { mode: 'resolve-cloud', trigger: 'resolve-cloud' });
  if (pull.outcome === 'cloud-empty') return _resolveCloudImport(ctx);
  if (!pull.applied) return { resolved: false, reason: pull.outcome };
  return { resolved: true };
}

// The import of choose-cloud when the cloud has no data. The pull has cleared
// the pending conflict and set the baseline (I2). The import is guarded like
// choose-local (firewall, deletion, §8 cleared rows) and sent once with the
// precondition of that baseline; a failure is reported, not recovered.
async function _resolveCloudImport(ctx) {
  const stop = (reason) => ({ resolved: false, reason });
  // The firewall: memory may hold defaults that must never be imported.
  if (typeof globalThis.isStorageLoadFailed === 'function' && globalThis.isStorageLoadFailed()) {
    return stop('storage-read-only');
  }
  if (_accountDeleting) return stop('account-deleting');
  const read = await _readSyncStorage();
  if (!ctx.alive()) return stop('session-changed');
  ctx.storageRead = read;
  const decision = _decideUploadStorage(read, _cloudBaseline, { exemptValueDiff: true });
  if (decision !== 'proceed') return stop(decision);
  _syncState = 'uploading';
  _updateSyncUI();
  const r = await _pushCore(ctx);
  if (!r.uploaded) return stop(r.reason);
  return { resolved: true, code: 'no-cloud-data' };
}

// Sets the sync error state for a failing task body before it settles, so the
// next task's own state is never overwritten by this one's failure.
function _markSyncError(err) {
  _syncState = 'error';
  _lastSyncError = err;
  _updateSyncUI();
}

function _markSyncErrorAndThrow(err) {
  _markSyncError(err);
  throw err;
}

// ── Sync executor ──
// Every cloud operation (pull, upload, and later the conflict resolutions)
// runs as a task in this single serial queue, one at a time (spec §7.1).
//
// Self-wait rule: a task body (run(ctx) and everything it calls) must never
// call a public entry point (syncToCloud, syncFromCloud, fbResolveSyncConflict,
// _pullAfterSignIn) or _enqueueSync, and never await another queued task: it
// would wait for its own queue slot forever. Follow-up work inside a task
// calls the lock-free cores (_pullCore, _pushCore, _uploadTask) directly;
// scheduleSyncToCloud() only arms a timer and is allowed.

// Push a task and return its result promise. An auto task merges into a
// not-yet-started auto task of the same kind and epoch (spec §7.2); it never
// merges into the running task, whose guards have already been evaluated.
function _enqueueSync(spec) {
  if (spec.auto === true) {
    const queued = _syncQueue.find((t) =>
      t.auto === true && t.kind === spec.kind && t.epoch === _authEpoch);
    if (queued) return queued.promise;
  }
  const task = { ...spec, epoch: _authEpoch };
  task.promise = new Promise((resolve, reject) => {
    task.resolve = resolve;
    task.reject = reject;
  });
  _syncQueue.push(task);
  _drainSyncQueue();
  return task.promise;
}

// Run queued tasks strictly one at a time. A task whose session ended while it
// waited settles with { reason: 'session-changed' } (the public wrappers map
// that to their own shapes). A failing task only rejects its own promise.
async function _drainSyncQueue() {
  if (_syncCurrent) return;
  while (_syncQueue.length > 0) {
    const task = _syncQueue.shift();
    _syncCurrent = task;
    if (task.epoch !== _authEpoch) {
      task.resolve(_skipResult(task.kind, 'session-changed'));
      continue;
    }
    const ctx = {
      epoch: task.epoch,
      alive: () => task.epoch === _authEpoch,
      budget: { baselineGet: 1, recoveryGet: 1, patch: 2 },
      // Set by a task (or its guard) that recorded or re-surfaces the pending
      // conflict; notifyTrigger optionally relabels the hook call only.
      notifyConflict: false,
      notifyTrigger: null,
      storageRead: null,
    };
    let settle;
    try {
      const result = (await _dequeueGuard(task, ctx)) || (await task.run(ctx));
      settle = () => task.resolve(result);
    } catch (err) {
      settle = () => task.reject(err);
    }
    // The conflict hook is the task's last step, before it settles: fired,
    // never awaited, and nothing writes after it (spec §7.1). Task bodies
    // never call the hook themselves.
    if (ctx.notifyConflict && ctx.alive() && _conflictPending) {
      _notifySyncConflict({ ..._conflictPending, trigger: ctx.notifyTrigger || _conflictPending.trigger });
    }
    settle();
  }
  _syncCurrent = null;
}

// The skip result of a task that does not run, in its kind's result shape:
// a PullResult for pulls, a resolve result for the conflict choices, a
// PushResult otherwise (uploads, and the account deletion, which only reads
// `reason`).
function _skipResult(kind, reason) {
  if (kind === 'pull') return { applied: false, outcome: reason };
  if (kind === 'resolve-local' || kind === 'resolve-cloud') return { resolved: false, reason };
  return { uploaded: false, reason };
}

const _UPLOAD_TASK_KINDS = new Set(['upload', 'resolve-local']);

// Dequeue guards shared by every task, in the fixed order of spec §7.3 (the
// epoch check, step 1, runs before this in _drainSyncQueue). Returns the skip
// result to settle the task with, or null to run it; throws not-signed-in for
// upload-class tasks. Step 5 (switch, clean, firewall, Unknown baseline, §8
// comparison) belongs to the task bodies (_uploadTask, _resolveLocalTask,
// _resolveCloudImport).
async function _dequeueGuard(task, ctx) {
  const skip = (reason) => _skipResult(task.kind, reason);
  const isUpload = _UPLOAD_TASK_KINDS.has(task.kind);
  // 2. An account deletion in progress: nothing may (re)create the document.
  // Pulls and choose-cloud (which may import) are dropped as session-changed:
  // their session is ending, and they must neither write back nor import.
  if (_accountDeleting && task.kind !== 'delete-account') {
    return skip(isUpload ? 'account-deleting' : 'session-changed');
  }
  // 3. Storage and auth, for every task: each one ends up writing keys back.
  const read = await _readSyncStorage();
  if (!ctx.alive()) return skip('session-changed');
  const cleared = _checkStorageForWrite(read);
  if (cleared) return skip(cleared);
  ctx.storageRead = read;
  // Second line of defence: the public entry points already reject a
  // signed-out caller before queueing (preflight C3).
  // Deleting an account does not need a verified email (its Firestore DELETE
  // is best-effort for exactly that case).
  const verified = task.kind === 'delete-account' || fbIsEmailVerified();
  if (!fbIsSignedIn() || !verified) {
    if (isUpload) throw new CloudSyncError('not-signed-in', 0);
    return skip('not-signed-in');
  }
  // 4. Pending conflict. A pull is not intercepted (its landing is
  // constrained instead, see _pullCore).
  if (task.kind === 'upload' && _conflictPending) {
    // An auto upload must not run over it; a manual one re-surfaces the
    // dialog (fired by the executor, labelled manual-upload) without a request.
    if (!task.auto) {
      ctx.notifyConflict = true;
      ctx.notifyTrigger = 'manual-upload';
    }
    return skip('conflict-pending');
  }
  // The conflict choices need the conflict still pending; choose-local also
  // needs the cloud version it captured at enqueue (a pull queued ahead may
  // have updated it — the dialog was refreshed by that pull).
  if (task.kind === 'resolve-local' || task.kind === 'resolve-cloud') {
    if (!_conflictPending) return skip('no-conflict');
    if (task.kind === 'resolve-local'
        && (_conflictPending.cloudState !== task.captured.cloudState
          || _conflictPending.cloudRaw !== task.captured.cloudRaw)) {
      return skip('conflict');
    }
  }
  return null;
}

// Settle every not-yet-started task with its skip result and empty the queue.
function _dropQueuedSyncTasks(reason) {
  const dropped = _syncQueue;
  _syncQueue = [];
  for (const task of dropped) task.resolve(_skipResult(task.kind, reason));
}

// Unified session reset for sign-out, sign-in and sign-up (spec §7.4).
// Synchronous on purpose: it runs inside tasks (via _clearAuth) and must never
// wait for the queue or the running task — the running task notices the epoch
// change after its current await and exits with zero writes.
function _resetSession() {
  _authEpoch += 1;
  _dropQueuedSyncTasks('session-changed');
  clearTimeout(_syncTimer);
  _syncTimer = null;
  // An unresolved sync conflict belongs to the session being torn down: drop it
  // so the next session starts clean (the conflict is re-detected on the next
  // pull from its own persisted state, not from a stale pending record).
  _clearConflictPending();
  // So is an upload of unknown outcome: it was written for the old account.
  _inflightUpload = null;
  // The cloud baseline belongs to the previous session: the new one must
  // re-establish it with a pull. Persisted keys are only removed by _clearAuth.
  _cloudBaseline = { kind: 'unknown' };
  _lastCloudTs = 0;
}

// Records that the local state is now based on the cloud version `baseline`:
// the cloud baseline first, then (when given) the synced rev, then the
// baseline account. Shared by every landing, adoption and upload success so
// the write order stays identical (spec §7.4: baseline and _syncedRev last).
// syncedRev must have been captured by the caller in the same synchronous
// block as its in-memory apply / adopt decision (spec §6.5).
// Returns false when the session changed during any write (stop, no more
// writes); storage errors propagate.
async function _adoptCloudVersion(ctx, baseline, { syncedRev = null } = {}) {
  await _setCloudBaseline(baseline);
  if (!ctx.alive()) return false;
  if (syncedRev !== null) {
    _syncedRev = syncedRev;
    await _saveRevState();
    if (!ctx.alive()) return false;
  }
  await _saveBaselineUid(_uid);
  return ctx.alive();
}

// Upload task body, after the dequeue guards (_dequeueGuard, spec §7.3 steps
// 1–4): the step-5 guards, the §8 storage re-read, a baseline or recovery
// pull when it calls for one, then the PATCH with its recovery pull and retry
// (_pushWithRecovery).
// manual: explicit user upload (the manual button), which bypasses the
// switch-pending and clean guards on purpose; the firewall still applies.
// (Choose-local has its own body, _resolveLocalTask.)
async function _uploadTask(ctx, { manual }) {
  if (!ctx.alive()) return { uploaded: false, reason: 'session-changed' };

  // While an account switch is unresolved, automatic uploads must not run: the
  // local state still contains the previous account's data and would be
  // PATCHed into the signed-in account's document.
  if (!manual && _needsSwitchPull()) return { uploaded: false, reason: 'switch-pending' };

  if (!manual && !_isDirty()) return { uploaded: false, reason: 'clean' };

  // A failed storage load leaves default values in memory; uploading them
  // would overwrite the real cloud document — an unrecoverable direction.
  // Every upload path is blocked, including the forced manual one, until a
  // successful cloud pull repopulates the in-memory state.
  if (typeof globalThis.isStorageLoadFailed === 'function' && globalThis.isStorageLoadFailed()) {
    return { uploaded: false, reason: 'storage-read-only' };
  }

  // §8: re-read storage right before any request. The dequeue read cannot be
  // reused — other awaits may separate it from the PATCH. Internal pulls of
  // this task reuse this read (ctx.storageRead).
  const read = await _readSyncStorage();
  if (!ctx.alive()) return { uploaded: false, reason: 'session-changed' };
  ctx.storageRead = read;
  const decision = _decideUploadStorage(read, _cloudBaseline);

  if (decision === 'baseline-pull') {
    // An Unknown baseline has no precondition to send: establish it first with
    // a baseline pull in this same hold (spec §5.3). A failure rejects with the
    // baseline still Unknown and the local state dirty; no automatic retry.
    // This also covers a failed startup pull: the next upload pulls first.
    ctx.budget.baselineGet -= 1;
    const pull = await _pullCore(ctx, {
      mode: 'forced', trigger: 'baseline', compareWhenClean: manual, reuseStorageRead: true,
    });
    const stop = _uploadStopAfterPull(pull);
    if (stop) return stop;
  } else if (decision === 'recovery-pull') {
    // Storage disagrees with memory (another tab uploaded, or wrote an invalid
    // value): adopt neither, re-pull with the recovery budget (§8, §7.5).
    ctx.budget.recoveryGet -= 1;
    const pull = await _pullCore(ctx, {
      mode: 'forced', trigger: 'upload-precondition', compareWhenClean: manual, reuseStorageRead: true,
    });
    const stop = _uploadStopAfterPull(pull);
    if (stop) return stop;
  } else if (decision !== 'proceed') {
    return { uploaded: false, reason: decision };
  }

  return _pushWithRecovery(ctx, { compareWhenClean: manual });
}

// What an upload does after one of its internal pulls (baseline or recovery).
// Returns a PushResult skip to stop with, or null to go on and PATCH.
//   cloud-empty: the pull set the Absent / empty-document baseline; the PATCH
//     that follows is the import, whether or not the local state is dirty
//     (spec §5.3, §6.2).
//   conflict / any non-landing outcome: stop with that reason.
//   landed or adopted: only edits the pull did not cover are left to upload.
function _uploadStopAfterPull(pull) {
  if (pull.outcome === 'cloud-empty') return null;
  if (pull.outcome === 'conflict') return { uploaded: false, reason: 'conflict' };
  if (pull.outcome !== 'applied' && pull.outcome !== 'unchanged' && pull.outcome !== 'adopted') {
    return { uploaded: false, reason: pull.outcome };
  }
  if (_conflictPending) return { uploaded: false, reason: 'conflict' };
  if (!_isDirty()) return { uploaded: false, reason: 'up-to-date' };
  return null;
}

// _pushWithRecovery's default step after its recovery pull: stop as
// _uploadStopAfterPull says, or retry against the baseline that pull wrote.
function _uploadAfterPull(pull) {
  const stop = _uploadStopAfterPull(pull);
  return stop ? { stop } : { precondition: undefined };
}

// PATCH with recovery (spec §6.2, §7.5), shared by every task that uploads.
// A precondition-class rejection is handled here, never thrown and never
// toasted: one forced recovery pull in this same hold, then, when its outcome
// still calls for an upload, one retry PATCH against the baseline that pull
// wrote. Each step is bounded by ctx.budget; running out returns
// retry-exhausted with the local state left dirty. Other errors propagate.
// precondition: explicit precondition for the first PATCH (undefined: the
// in-memory baseline at send time).
// compareWhenClean: passed to the recovery pull (manual upload, choose-local).
// afterRecoveryPull(pull): what follows the recovery pull — { stop: PushResult }
// to stop, or { precondition } for the retry (undefined: the baseline that
// pull wrote). Choose-local retries a cloud-absent mark from its pending
// conflict instead, since a pull never moves the baseline while one is
// pending (spec §7.3).
async function _pushWithRecovery(ctx, {
  precondition, compareWhenClean = false, afterRecoveryPull = _uploadAfterPull,
} = {}) {
  const stopIdle = (reason) => {
    _syncState = 'idle';
    _updateSyncUI();
    return { uploaded: false, reason };
  };
  let pre = precondition;
  for (;;) {
    if (ctx.budget.patch <= 0) return stopIdle('retry-exhausted');
    _syncState = 'uploading';
    _lastSyncError = null;
    _updateSyncUI();
    try {
      return await _pushCore(ctx, { precondition: pre });
    } catch (err) {
      if (!_isPreconditionError(err?.code)) throw err;
    }
    // The rejected PATCH may have landed after a session change: the recovery
    // pull would then read (and write for) the new account.
    if (!ctx.alive()) return stopIdle('session-changed');
    if (ctx.budget.recoveryGet <= 0) return stopIdle('retry-exhausted');
    ctx.budget.recoveryGet -= 1;
    _syncState = 'downloading';
    _updateSyncUI();
    // A whole PATCH round trip separates this pull from the body's §8 re-read
    // (another tab may have signed out meanwhile), so it re-reads storage
    // itself before landing or writing keys back.
    const pull = await _pullCore(ctx, {
      mode: 'forced', trigger: 'upload-precondition', compareWhenClean,
    });
    const next = afterRecoveryPull(pull);
    if (next.stop) return next.stop;
    pre = next.precondition;
  }
}

// One PATCH of the current local state plus the success bookkeeping. No
// guards: callers (task bodies) decide whether an upload may run. It never
// reads storage: the §8 re-read and decision belong to the calling body
// (_uploadTask, _resolveLocalTask and _resolveCloudImport, whose
// exemptValueDiff a check here would override). Its I4 block only follows
// that re-read and the token await.
// precondition: explicit { updateTime } | { exists: false }; defaults to the
// in-memory baseline at send time.
async function _pushCore(ctx, { precondition } = {}) {
  const token = await _getToken();

  // I4 (spec §3.1): from here to the request is one synchronous block — no
  // await. The epoch, precondition, uid, token, revAtStart and the payload
  // snapshot all describe the same instant, so a sign-out/sign-in or an edit
  // during the token await cannot slip between them.
  if (!ctx.alive()) {
    _syncState = 'idle';
    _updateSyncUI();
    return { uploaded: false, reason: 'session-changed' };
  }
  if (_accountDeleting) {
    _syncState = 'idle';
    _updateSyncUI();
    return { uploaded: false, reason: 'account-deleting' };
  }
  if (!token) throw new CloudSyncError('not-signed-in', 0);
  const pre = precondition ?? _preconditionFromBaseline(_cloudBaseline);
  const uid = _uid;
  // Edits made after this point (while the request is in flight) stay dirty
  // and get picked up by a follow-up upload. The body (from snap) and revAtStart
  // are also the in-flight snapshot of spec §6.3.
  const revAtStart = _editRev;
  const snap = _buildSyncSnapshot();
  const body = _buildUploadBody(snap, Date.now());
  // Oversized uploads are rejected before any network request so the user
  // gets the actionable toast instead of the server's generic rule 403.
  if (body.length > FB_PAYLOAD_MAX_BYTES) {
    throw new CloudSyncError('payload-too-large', 413);
  }
  ctx.budget.patch -= 1;
  // The outcome of this PATCH is unknown (spec §6.3): the cloud may or may not
  // hold `snap` now. Remember it so a later pull can recognise our own write.
  // The baseline is left as it was and the local state stays dirty. Not for a
  // previous session's request (_resetSession has cleared the record).
  // The snapshot is decoded from the body actually sent, not kept as `snap`:
  // `snap` references the live arrays, which later edits mutate in place.
  const recordUnknownOutcome = () => {
    if (ctx.alive()) {
      _inflightUpload = { snap: _cloudSnapshotFromFields(JSON.parse(body).fields), revAtStart };
    }
  };
  let cloudUpdateTime;
  try {
    cloudUpdateTime = await _fsSet({ url: _docUrl(uid) + _preconditionQuery(pre), token, body });
  } catch (err) {
    // Network failure or timeout (_timedFetch: network, status 0). A definite
    // rejection did not write and is not recorded: precondition, rules, any
    // other HTTP error — including a 401/403 whose token refresh then failed
    // on the network (network with the HTTP status).
    if (err?.code === 'network' && !err.status) recordUnknownOutcome();
    throw err;
  }

  // The response landed after the identity changed (sign-out/sign-in while the
  // request was in flight). This upload belongs to the previous session: drop
  // it with zero bookkeeping writes — persisting its server time or syncing
  // the baseline against a null/other uid would destroy the persisted switch
  // signal and let the old account's local items be uploaded to the new one.
  if (!ctx.alive()) return { uploaded: false, reason: 'session-changed' };

  // A 2xx without a usable updateTime: the write probably happened, but there
  // is no version to base on.
  const cloudBaseline = cloudUpdateTime ? _knownBaseline(cloudUpdateTime) : null;
  if (!cloudBaseline) {
    recordUnknownOutcome();
    throw new CloudSyncError('firestore', 0, new Error(cloudUpdateTime
      ? 'Invalid updateTime from server' : 'No updateTime in response'));
  }
  // The outcome is known: this payload (not an earlier unknown one) is what
  // the cloud holds now.
  _inflightUpload = null;
  const serverMs = _updateTimeToMs(cloudUpdateTime);
  // The cloud now holds this local state, so it becomes the sync baseline. A
  // session change during the bookkeeping stops it with the local state still
  // dirty — the safe direction (spec §7.4).
  if (!(await _adoptCloudVersion(ctx, cloudBaseline, { syncedRev: revAtStart }))) {
    return { uploaded: false, reason: 'session-changed' };
  }
  // A successful upload resolves any prior conflict: the cloud now mirrors
  // the local state this upload carried.
  _clearConflictPending();

  _syncState = 'idle';
  _updateSyncUI(serverMs);
  if (_isDirty()) scheduleSyncToCloud();
  return { uploaded: true, ts: serverMs };
}

// options.force: manual upload (not mergeable, bypasses the switch-pending
// and clean guards; a pending conflict re-surfaces the dialog instead and
// skips with conflict-pending). Otherwise an auto upload that merges with a
// queued auto upload.
// Resolves { ok: true, skipped, reason?, ts? }; rejects with CloudSyncError.
function syncToCloud(options = {}) {
  const { force = false } = options;
  // Checked before queueing (not only at dequeue) so a signed-out caller gets
  // an immediate rejection instead of waiting behind other tasks.
  if (!fbIsSignedIn() || !fbIsEmailVerified()) {
    const err = new CloudSyncError('not-signed-in', 0);
    _markSyncError(err);
    return Promise.reject(err);
  }
  const manual = !!force;
  return _enqueueSync({
    kind: 'upload',
    auto: !manual,
    run: (ctx) => _uploadTask(ctx, { manual }).catch(_markSyncErrorAndThrow),
  }).then((r) => (r.uploaded
    ? { ok: true, skipped: false, ts: r.ts }
    : { ok: true, skipped: true, reason: r.reason }));
}

// Pull core: GET the cloud document and run the pull decision tree. No lock:
// callable from any task body. A session change after any await exits with
// zero further writes. A detected conflict sets the pending record and
// ctx.notifyConflict; the executor fires the hook after the task's last step.
// While a conflict is pending (any mode but resolve-cloud) the pending rules
// of spec §7.3 apply: see pendingRules below.
// Returns PullResult { applied, outcome, cloud? }; cloud ('not-found' |
// 'empty') comes with cloud-empty, and with a conflict that marked the
// pending cloud-absent.
// compareWhenClean: compare contents even when the local state is clean, so a
// difference becomes a pending conflict instead of a silent landing (manual
// upload's baseline pull, spec §5.1).
// reuseStorageRead: an internal pull of an upload task, which has just done
// the full §8 re-read (ctx.storageRead); a standalone pull re-reads storage
// after its GET instead.
async function _pullCore(ctx, { mode, trigger, compareWhenClean = false, reuseStorageRead = false }) {
  const sessionChanged = () => {
    _syncState = 'idle';
    _updateSyncUI();
    return { applied: false, outcome: 'session-changed' };
  };

  const doc = await _fsGet();

  // The GET response landed after the identity changed (sign-out/sign-in
  // while it was in flight). Drop it with zero bookkeeping writes.
  if (!ctx.alive()) return sessionChanged();

  // §8 / §7.3 step 3 before any landing or key write: storage must be
  // readable and the auth key still present (another tab may have signed out
  // during the GET). Only these two rows; the baseline value is not compared.
  const read = reuseStorageRead && ctx.storageRead ? ctx.storageRead : await _readSyncStorage();
  if (!ctx.alive()) return sessionChanged();
  const cleared = _checkStorageForWrite(read);
  if (cleared) {
    _syncState = 'idle';
    _updateSyncUI();
    return { applied: false, outcome: cleared };
  }

  // While a conflict is pending, every pull but choose-cloud's follows the
  // pending rules (spec §7.3): it never lands a different cloud, never moves
  // the baseline and never marks the local state clean; only the same content
  // resolves the conflict (through the ordinary landing below).
  const pendingRules = !!_conflictPending && mode !== 'resolve-cloud';

  // Pending + cloud without data: mark the pending cloud-absent (404 and an
  // empty document kept apart, choose-local needs either precondition) and
  // refresh the dialog. Choose-local's import resolves it later (§6.2).
  const markCloudAbsent = (cloudState, cloudRaw, cloudUpdateTime) => {
    _recordConflict(ctx, {
      cloudCounts: { shortcuts: 0, folders: 0 }, cloudUpdateTime, cloudRaw, cloudState, trigger,
    });
    return { applied: false, outcome: 'conflict', cloud: cloudState };
  };

  // Nothing to pull: the signed-in account's state is now considered the
  // baseline, so subsequent automatic uploads are allowed again. A 404
  // (Absent) and an existing document without fields (Known) are distinct
  // baselines (I2).
  const cloudEmpty = async (baseline, cloud) => {
    _syncState = 'idle';
    _updateSyncUI();
    if (!(await _adoptCloudVersion(ctx, baseline))) return sessionChanged();
    _clearConflictPending();
    return { applied: false, outcome: 'cloud-empty', cloud };
  };

  // An in-flight snapshot hit: adopt the GET's raw string as the baseline
  // without landing anything (the cloud content is our own payload). Clean
  // when no edit was made since that upload started, otherwise dirty with a
  // follow-up upload. A pending conflict is resolved silently (§7.3).
  const adoptInflight = async (baseline) => {
    // Decided in one synchronous block with the adoption's syncedRev capture
    // (spec §6.5): an edit during the awaits below stays dirty.
    const { revAtStart } = _inflightUpload;
    const clean = _editRev === revAtStart;
    _inflightUpload = null;
    _syncState = 'idle';
    _updateSyncUI();
    if (!(await _adoptCloudVersion(ctx, baseline, { syncedRev: clean ? revAtStart : null }))) {
      return sessionChanged();
    }
    _clearConflictPending();
    _updateSyncUI(_updateTimeToMs(baseline.raw));
    // After the pending is cleared: scheduleSyncToCloud is a no-op while one is.
    if (_isDirty()) scheduleSyncToCloud();
    return { applied: true, outcome: 'adopted' };
  };

  if (!doc) {
    return pendingRules ? markCloudAbsent('not-found', null, 0) : cloudEmpty({ kind: 'absent' }, 'not-found');
  }

  // An existing document always carries an updateTime; without a usable one
  // there is no version to base later uploads on, so treat it as a server
  // error rather than landing or adopting anything.
  const cloudUpdateTime = doc.updateTime;
  const cloudBaseline = _knownBaseline(cloudUpdateTime);
  if (!cloudBaseline) {
    throw new CloudSyncError('firestore', 0, new Error('Invalid updateTime from server'));
  }
  const cloudTsMs = _updateTimeToMs(cloudUpdateTime);

  if (!doc.fields) {
    return pendingRules
      ? markCloudAbsent('empty', cloudUpdateTime, cloudTsMs)
      : cloudEmpty(cloudBaseline, 'empty');
  }

  // The cloud holds exactly the payload of our upload of unknown outcome
  // (spec §6.3): that write succeeded. Checked before the fast path and, while
  // a conflict is pending, before the content comparison (a hit counts as
  // "same content", §7.3). Not for choose-cloud, which lands unconditionally.
  if (mode !== 'resolve-cloud' && _matchesInflight(_cloudSnapshotFromFields(doc.fields))) {
    return adoptInflight(cloudBaseline);
  }

  // Cloud unchanged since the baseline (spec §4): skip, adopting the GET's raw
  // string as the baseline (this completes the §9 migration). The local state
  // is not marked clean: dirty edits are re-queued for upload. Not taken while
  // a conflict is pending; the content comparison below decides instead.
  if (mode === 'auto' && !pendingRules && _isCloudUnchanged(cloudUpdateTime)) {
    _syncState = 'idle';
    _updateSyncUI();
    if (!(await _adoptCloudVersion(ctx, cloudBaseline))) return sessionChanged();
    // A failed upload can leave local edits dirty with no timer pending, so
    // re-queue them here instead of waiting for the next user edit.
    if (_isDirty()) scheduleSyncToCloud();
    return { applied: true, outcome: 'unchanged' };
  }

  const f = doc.fields;

  // Conflict detection: when the local state is dirty (or compareWhenClean is
  // set, or a conflict is pending) and differs from the cloud snapshot, do not
  // silently pick a winner — record (or update) the conflict and pause
  // automatic uploads until the user resolves it. A pending conflict is
  // compared even over a clean local state: only choose-cloud may land a
  // different cloud. resolve-cloud skips detection entirely (it applies the
  // cloud side by explicit user choice).
  let skippedFields = [];
  if (mode !== 'resolve-cloud' && (pendingRules || _isDirty() || compareWhenClean)) {
    const cloudSnap = _cloudSnapshotFromFields(f);
    const { equal, skippedFields: skipped } = _compareSnapshots(_buildSyncSnapshot(), cloudSnap);
    if (!equal) {
      _recordConflict(ctx, {
        cloudCounts: _countSyncItems(cloudSnap.items),
        cloudUpdateTime: cloudTsMs,
        cloudRaw: cloudUpdateTime,
        cloudState: 'doc',
        trigger,
      });
      return { applied: false, outcome: 'conflict' };
    }
    // Same content: land it as usual, which clears the pending conflict and
    // closes the dialog with the revAtApply rule below (spec §6.5).
    skippedFields = skipped;
  }

  // 真正要应用云端数据时，取消尚未执行的自动上传，防止本地过期状态覆盖刚拉取的数据
  clearTimeout(_syncTimer);
  _syncTimer = null;

  const cloudItems = _fromFV(f.items);
  const cloudEngines = _fromFV(f.engines);
  const cloudEngine = _fromFV(f.selected_engine);
  const cloudClocks = _fromFV(f.clocks);
  const cloudColumns = _fromFV(f.grid_columns);

  let shouldResyncCloud = false;
  if (Array.isArray(cloudItems)) {
    const normalize = typeof globalThis.sanitizeItemsShape === 'function'
      ? globalThis.sanitizeItemsShape
      : (typeof globalThis.normalizeFolderChildItemSizes === 'function'
          ? globalThis.normalizeFolderChildItemSizes
          : null);
    const normalized = normalize ? normalize(cloudItems) : { items: cloudItems, changed: false };
    items = normalized.items;
    shouldResyncCloud = !!normalized.changed;
  }
  if (Array.isArray(cloudEngines)) customEngines = cloudEngines;
  if (typeof cloudEngine === 'string' && cloudEngine) selectedEngineId = cloudEngine;
  // An empty array is a real cloud state (every clock was deleted on another
  // device), so it must land as-is. Only a missing or non-array field means
  // "this cloud document has no opinion" and keeps the local list.
  if (Array.isArray(cloudClocks)) clocks = cloudClocks;
  if (typeof cloudColumns === 'number' && Number.isFinite(cloudColumns)
      && typeof globalThis.clampMainGridColumns === 'function') {
    mainGridColumns = globalThis.clampMainGridColumns(cloudColumns);
    if (mainGridColumns !== cloudColumns) shouldResyncCloud = true; // corrected value must be re-uploaded
  }
  // Capture the edit rev in the same synchronous block as the in-memory
  // assignment above: an edit made during the awaits below is newer than the
  // applied snapshot and must stay dirty (spec §6.5).
  const revAtApply = _editRev;

  const s = _fbStore();
  if (s) {
    await s.set({
      startpage_items: items,
      startpage_engines: customEngines,
      startpage_selected_engine: selectedEngineId,
      startpage_clocks: clocks,
      startpage_grid_columns: mainGridColumns,
    });
    if (!ctx.alive()) return sessionChanged();
  }
  // The applied cloud snapshot is now the authoritative in-memory state, so
  // the host page may lift its storage read-failure firewall: later local
  // edits can safely be persisted and uploaded again.
  if (typeof globalThis.markStorageLoadRecovered === 'function') {
    globalThis.markStorageLoadRecovered();
  }

  // The applied cloud snapshot is now the synced baseline. Only edits up to
  // revAtApply are covered by it; later edits keep the local state dirty.
  if (!(await _adoptCloudVersion(ctx, cloudBaseline, { syncedRev: revAtApply }))) {
    return sessionChanged();
  }
  _clearConflictPending();
  // The local state is now the landed cloud content: an earlier upload of
  // unknown outcome no longer describes anything to recognise.
  _inflightUpload = null;

  applyWallpaper();
  applyMainGridColumns();
  render();
  document.getElementById('engine-name').textContent = getSelectedEngine().name;
  _syncState = 'idle';
  _updateSyncUI(cloudTsMs);
  // A cloud snapshot that skipped a field (the cloud has no opinion on it)
  // left the local value in place; re-upload it so other devices converge on
  // the local value (I8). Reuse the resync mechanism so a normalization
  // triggered resync is not double-counted.
  if (skippedFields.length > 0) shouldResyncCloud = true;
  if (shouldResyncCloud) {
    // Cloud data was normalized on apply; bump the edit rev (from revAtApply)
    // so the canonical form is re-uploaded for other devices. An edit made
    // during landing already makes the state dirty, so no extra bump.
    if (_editRev === revAtApply) _editRev = revAtApply + 1;
    await _saveRevState();
    if (!ctx.alive()) return sessionChanged();
    scheduleSyncToCloud();
  } else if (_editRev !== revAtApply) {
    // An edit landed during the awaits above. Its own schedule may have been
    // suppressed (e.g. a conflict was still pending), so re-queue the upload.
    scheduleSyncToCloud();
  }
  if (typeof globalThis.scheduleIconCacheRefresh === 'function') {
    globalThis.scheduleIconCacheRefresh();
  }
  if (typeof globalThis.pruneWeatherCache === 'function') {
    globalThis.pruneWeatherCache();
  }
  if (typeof globalThis.fetchWeatherForAllCities === 'function') {
    globalThis.fetchWeatherForAllCities();
  }
  return { applied: true, outcome: 'applied' };
}

// Returns true if cloud data was found and applied.
// mode: 'auto' (default) | 'forced' | 'resolve-cloud'
//   - 'auto': skip when the cloud has not changed; detect conflicts when dirty.
//     Merges with a queued auto pull.
//   - 'forced': bypass the "cloud unchanged" skip, but still detect conflicts.
//   - 'resolve-cloud': apply cloud data unconditionally (no conflict detection).
// trigger: provenance label carried into the conflict info object.
// A queued pull dropped by a session change resolves false.
async function syncFromCloud(options = {}) {
  const r = await _runPullTask(options);
  return !!r.applied;
}

// Queue one pull task and resolve its PullResult (same options as
// syncFromCloud). For callers that must tell the outcomes apart — "cloud is
// empty" is not the same as "dropped by a session change" or "blocked by the
// storage check". A signed-out caller resolves not-signed-in without queueing.
function _runPullTask(options = {}) {
  const { mode = 'auto', trigger = 'auto' } = options;
  if (!fbIsSignedIn() || !fbIsEmailVerified()) {
    return Promise.resolve({ applied: false, outcome: 'not-signed-in' });
  }

  return _enqueueSync({
    kind: 'pull',
    auto: mode === 'auto',
    run: async (ctx) => {
      _syncState = 'downloading';
      _lastSyncError = null;
      _updateSyncUI();
      return _pullCore(ctx, { mode, trigger }).catch(_markSyncErrorAndThrow);
    },
  });
}

function scheduleSyncToCloud() {
  if (!fbIsSignedIn() || !fbIsEmailVerified()) return;
  // While a conflict is pending, do not queue an automatic upload: the local
  // state is known to disagree with the cloud and must not overwrite it before
  // the user resolves the conflict (Tasks 4/5).
  if (_conflictPending) return;
  // The timer belongs to the session that armed it: if the session changed
  // before it fires, drop it instead of queueing an upload (spec §7.4).
  const epoch = _authEpoch;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    if (epoch !== _authEpoch) return;
    syncToCloud()
      .then(() => {
        _lastAutoUploadErrorCode = null;
      })
      .catch((err) => {
        // Automatic failures are logged and surfaced in the status bar only —
        // except an oversized payload: it cannot recover on its own and would
        // otherwise fail silently on every edit. Same consecutive code only
        // toasts once so repeated edits do not spam the user.
        console.error('[firebase] scheduled upload failed', err);
        const code = err?.code || null;
        if (code === 'payload-too-large' && _lastAutoUploadErrorCode !== code) {
          showToast(t('toast.syncPayloadTooLarge'), 'error');
        }
        _lastAutoUploadErrorCode = code;
      });
  }, 2000);
}

async function markLocalCloudDataChanged(options = {}) {
  const { userEdit = true } = options;
  if (userEdit) {
    _editRev += 1;
    _localEditTs = Date.now();
    await _saveRevState();
  }
  scheduleSyncToCloud();
}

// Shared "pull after sign-in" entry point for interactive login, email
// verification and startup restore: pull the cloud snapshot and, only when
// the pull reports that the cloud has no data (cloud-empty), queue an upload
// of the local state. Every other result — a session change, a storage-check
// skip, a conflict — queues nothing (spec §10.2).
// The pull is forced whenever the persisted sync baseline belongs to another
// account (see _needsSwitchPull), so the signed-in account's document always
// wins over whatever a previous account left on this device.
// options: { trigger = 'sign-in', force = false }
//   - trigger: provenance label carried into the conflict info object.
//   - force: explicit override for tests/tools.
async function _pullAfterSignIn({ trigger = 'sign-in', force = false } = {}) {
  if (!fbIsSignedIn() || !_uid) return;
  const forced = force || _needsSwitchPull();
  let pull;
  try {
    pull = await _runPullTask(forced ? { mode: 'forced', trigger } : { trigger });
  } catch (err) {
    // Fail-safe: a failed pull says nothing about the cloud state, so it must
    // not be treated as "no cloud data". Never queue an upload here — after an
    // account switch a dirty local state could be PATCHed into the new
    // account's document. Keep it dirty and let the next edit or startup pull
    // retry.
    console.error('[firebase] initial pull failed', err);
    return;
  }
  if (pull.outcome === 'cloud-empty') scheduleSyncToCloud();
}

// ── UI ──────────────────────────────────────────────────────

// Error code / skip reason -> toast i18n key, shared by the sidebar sync
// buttons and (through _conflictErrorKey) the conflict dialog. `cloud-changed`
// is dialog-only and has no toast.
function _syncErrorToastKey(code) {
  switch (code) {
    case 'auth': return 'toast.syncAuthFailed';
    case 'network': return 'toast.syncNetworkFailed';
    case 'quota': return 'toast.syncQuotaFailed';
    case 'payload-too-large': return 'toast.syncPayloadTooLarge';
    case 'storage-read-only': return 'toast.syncStorageReadOnly';
    case 'storage-unavailable': return 'toast.syncStorageUnavailable';
    case 'baseline-cleared': return 'toast.syncBaselineCleared';
    case 'retry-exhausted': return 'toast.syncRetryExhausted';
    default: return 'toast.syncFailed';
  }
}

// What a manual upload tells the user for a syncToCloud result (spec §5.4).
// Returns { key, kind } or null for "say nothing": a conflict, a re-surfaced
// conflict dialog, a session change, a deletion in progress and a sign-out all
// have their own UI (or are not the user's business). Only an upload that
// really PATCHed is reported as uploaded.
function _manualUploadToast(r) {
  if (r?.skipped === false) return { key: 'toast.syncUploaded', kind: 'default' };
  switch (r?.reason) {
    case 'up-to-date': return { key: 'toast.syncUpToDate', kind: 'default' };
    case 'conflict':
    case 'conflict-pending':
    case 'session-changed':
    case 'account-deleting':
    case 'not-signed-in':
      return null;
    default: return { key: _syncErrorToastKey(r?.reason), kind: 'error' };
  }
}

// What a manual pull tells the user for a PullResult. Same shape as
// _manualUploadToast. An unknown outcome is reported as a failure, never as
// success.
function _manualPullToast(pull) {
  if (pull?.applied) return { key: 'toast.syncDownloaded', kind: 'default' };
  switch (pull?.outcome) {
    case 'cloud-empty': return { key: 'toast.syncNoCloudData', kind: 'default' };
    case 'conflict':
    case 'session-changed':
    case 'not-signed-in':
      return null;
    default: return { key: _syncErrorToastKey(pull?.outcome), kind: 'error' };
  }
}

async function _handleSyncBtn(direction) {
  if (!fbIsEmailVerified()) {
    showToast(t('toast.syncMustVerifyEmail'), 'error');
    return;
  }
  const uploadBtn = document.getElementById('sync-upload-btn');
  const downloadBtn = document.getElementById('sync-download-btn');
  if (uploadBtn) uploadBtn.disabled = true;
  if (downloadBtn) downloadBtn.disabled = true;

  try {
    if (direction === 'upload') {
      // Every outcome, the storage firewall and a pending conflict (which
      // re-surfaces the dialog) included, comes back as a skip reason.
      const outcome = _manualUploadToast(await syncToCloud({ force: true }));
      if (outcome) showToast(t(outcome.key), outcome.kind);
    } else {
      // 关键：手动拉取前取消尚未执行的自动上传；正在执行的任务由同步队列串行等待
      clearTimeout(_syncTimer);
      _syncTimer = null;

      // A detected conflict (outcome 'conflict') is left to the dialog.
      const outcome = _manualPullToast(await _runPullTask({ mode: 'forced', trigger: 'manual-pull' }));
      if (outcome) showToast(t(outcome.key), outcome.kind);
    }
  } catch (e) {
    showToast(t(_syncErrorToastKey(e?.code)), 'error');
  } finally {
    _syncState = 'idle';
    _updateSyncUI();
    if (uploadBtn) uploadBtn.disabled = false;
    if (downloadBtn) downloadBtn.disabled = false;
  }
}

function _bindSyncActionButtons() {
  const uploadBtn = document.getElementById('sync-upload-btn');
  const downloadBtn = document.getElementById('sync-download-btn');

  if (uploadBtn && uploadBtn.dataset.bound !== 'true') {
    uploadBtn.dataset.bound = 'true';
    uploadBtn.addEventListener('click', async () => {
      await _handleSyncBtn('upload');
    });
  }

  if (downloadBtn && downloadBtn.dataset.bound !== 'true') {
    downloadBtn.dataset.bound = 'true';
    downloadBtn.addEventListener('click', async () => {
      await _handleSyncBtn('download');
    });
  }
}

let _lastSyncDisplayTs = 0;

// Read-only snapshot of internal sync flags that tests cannot reach otherwise
// (top-level `let` bindings are not visible through the test loader).
function _getSyncDebugState() {
  return {
    lastSyncDisplayTs: _lastSyncDisplayTs,
    accountDeleting: _accountDeleting,
    inflightUpload: _inflightUpload,
  };
}

function _updateSyncUI(ts) {
  if (typeof ts === 'number') _lastSyncDisplayTs = ts;
  else if (ts === undefined) ts = _lastSyncDisplayTs || undefined;
  const statusEl = document.getElementById('sync-status-text');
  const loginSection = document.getElementById('sync-login-section');
  const loggedSection = document.getElementById('sync-logged-section');
  // A pending conflict cleared elsewhere (sign-out, pull convergence) must not
  // leave the choice dialog stranded. Runs before the statusEl guard so it
  // works regardless of sidebar DOM.
  if (!fbGetSyncConflict()
    && !document.getElementById('sync-conflict-overlay')?.classList.contains('hidden')) {
    _closeSyncConflictDialog();
  }
  if (!statusEl) return;
  const signedIn = fbIsSignedIn();
  const conflict = signedIn && fbIsEmailVerified() && !!fbGetSyncConflict();
  statusEl.classList.toggle('is-conflict', conflict);
  document.getElementById('sync-conflict-hint')?.classList.toggle('hidden', !conflict);
  if (signedIn) {
    loginSection?.classList.add('hidden');
    loggedSection?.classList.remove('hidden');
    if (!fbIsEmailVerified()) {
      statusEl.textContent = t('sidebar.sync.status.notVerified');
    } else if (conflict) {
      statusEl.textContent = t('sidebar.sync.status.conflict');
    } else if (_syncState === 'uploading') {
      statusEl.textContent = t('sidebar.sync.status.uploading');
    } else if (_syncState === 'downloading') {
      statusEl.textContent = t('sidebar.sync.status.downloading');
    } else if (_syncState === 'error') {
      statusEl.textContent = t('sidebar.sync.status.error');
    } else if (ts) {
      const d = new Date(ts);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      statusEl.textContent = t('sidebar.sync.status.syncedAt', { time: `${hh}:${mm}` });
    } else {
      statusEl.textContent = t('sidebar.sync.status.syncing');
    }
  } else {
    loginSection?.classList.remove('hidden');
    loggedSection?.classList.add('hidden');
    statusEl.textContent = '';
  }
}

function _showLoginOverlay() {
  document.getElementById('login-overlay')?.classList.remove('hidden');
}

function _hideLoginOverlay() {
  document.getElementById('login-overlay')?.classList.add('hidden');
}

// Per-browser one-time consent gate for the login/sync flow — Figma node 191:447.
// First time the user clicks the sidebar "登录" button on a given browser we
// show what gets collected and require explicit agreement before the auth UI
// opens. Cancel = no flag persisted = re-shown next time. After agreement
// future clicks skip straight to the login overlay.
const _LOGIN_CONSENT_STORAGE_KEY = 'lithium.cloud.consent';

function _hasLoginConsent() {
  try { return localStorage.getItem(_LOGIN_CONSENT_STORAGE_KEY) === '1'; }
  catch { return false; }
}

function _persistLoginConsent() {
  try { localStorage.setItem(_LOGIN_CONSENT_STORAGE_KEY, '1'); }
  catch { /* localStorage may be disabled — consent treated as ephemeral */ }
}

function _showLoginConsentOverlay() {
  document.getElementById('login-consent-overlay')?.classList.remove('hidden');
}

function _hideLoginConsentOverlay() {
  document.getElementById('login-consent-overlay')?.classList.add('hidden');
}

function _handleSyncLoginClick() {
  if (_hasLoginConsent()) {
    _showAuthMode('login');
    _showLoginOverlay();
    return;
  }
  _showLoginConsentOverlay();
}

// msg: the error message; code: the CloudSyncError code when there is one. A
// network failure's message is the browser's own text, so it is told apart by
// code. The two storage reasons are what a failed account deletion throws
// (its task result's reason becomes the message).
function _friendlyAuthError(msg, code) {
  if (code === 'network') return t('toast.syncNetworkFailed');
  if (!msg) return t('error.unknown');
  if (msg === 'baseline-cleared') return t('toast.syncBaselineCleared');
  if (msg === 'storage-unavailable') return t('toast.syncStorageUnavailable');
  if (msg.includes('EMAIL_NOT_FOUND')) return t('error.emailNotFound');
  if (msg.includes('INVALID_LOGIN_CREDENTIALS') || msg.includes('INVALID_PASSWORD')) return t('error.invalidLoginCredentials');
  if (msg.includes('EMAIL_EXISTS')) return t('error.emailExists');
  if (msg.includes('WEAK_PASSWORD')) return t('error.weakPassword');
  if (msg.includes('INVALID_EMAIL')) return t('error.invalidEmail');
  if (msg.includes('MISSING_PASSWORD')) return t('error.missingPassword');
  if (msg.includes('MISSING_EMAIL')) return t('error.missingEmail');
  if (msg.includes('TOO_MANY_ATTEMPTS')) return t('error.tooManyAttempts');
  if (msg.includes('USER_DISABLED')) return t('error.userDisabled');
  if (msg.includes('OPERATION_NOT_ALLOWED')) return t('error.operationNotAllowed');
  if (msg.includes('QUOTA_EXCEEDED') || msg.includes('PROJECT_QUOTA_EXCEEDED')) return t('error.quotaExceeded');
  if (msg.includes('NOT_SIGNED_IN')) return t('error.notSignedIn');
  return t('error.generic', { detail: msg });
}

function _showAuthMode(mode) {
  document.querySelectorAll('.auth-pane').forEach(el => el.classList.add('hidden'));
  document.getElementById(`auth-pane-${mode}`)?.classList.remove('hidden');
  document.querySelectorAll('.auth-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.mode === mode);
  });
}

let _pendingVerifyEmail = '';

function _updateVerifyEmailDisplay(email) {
  _pendingVerifyEmail = email || '';
  const el = document.getElementById('verify-email-target');
  if (el) el.textContent = _pendingVerifyEmail;
}

async function _handleLogin() {
  const emailEl = document.getElementById('login-email');
  const passwordEl = document.getElementById('login-password');
  const btn = document.getElementById('login-submit-btn');
  const errEl = document.getElementById('login-error');
  const email = emailEl?.value?.trim();
  const password = passwordEl?.value;
  if (!email || !password) return;

  btn.disabled = true;
  btn.textContent = t('auth.loginPending');
  errEl.textContent = '';

  try {
    await fbSignIn(email, password);
    if (!fbIsEmailVerified()) {
      _updateVerifyEmailDisplay(email);
      _showAuthMode('verify');
      _updateSyncUI();
      return;
    }
    _hideLoginOverlay();
    _updateSyncUI();
    // Whether this is an account switch is decided inside _pullAfterSignIn
    // from the persisted sync baseline, so no uid needs to be captured here.
    await _pullAfterSignIn({ trigger: 'sign-in' });
  } catch (e) {
    errEl.textContent = _friendlyAuthError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t('dialog.login.submitLogin');
  }
}

// Password policy — kept in sync with Firebase Console (Authentication →
// Settings → Password policy) so client validation matches what the backend
// enforces. The character whitelist is the one piece Firebase can't enforce,
// so it's only checked here on signup; users who go through password reset
// can theoretically set passwords outside this whitelist but Firebase's
// length + character-class rules still apply.
const PW_MIN_LEN = 8;
const PW_MAX_LEN = 128;
const PW_ALLOWED_CHARS = /^[a-zA-Z0-9 !@#$%&*+\-_=?]+$/;
const PW_HAS_UPPER = /[A-Z]/;
const PW_HAS_LOWER = /[a-z]/;
const PW_HAS_DIGIT = /[0-9]/;

async function _handleSignUp() {
  const emailEl = document.getElementById('signup-email');
  const passwordEl = document.getElementById('signup-password');
  const password2El = document.getElementById('signup-password-confirm');
  const btn = document.getElementById('signup-submit-btn');
  const errEl = document.getElementById('signup-error');
  const email = emailEl?.value?.trim();
  const password = passwordEl?.value;
  const password2 = password2El?.value;
  if (!email || !password) return;
  if (password !== password2) {
    errEl.textContent = t('auth.signupPasswordMismatch');
    return;
  }
  if (password.length < PW_MIN_LEN) {
    errEl.textContent = t('auth.signupPasswordTooShort');
    return;
  }
  if (password.length > PW_MAX_LEN) {
    errEl.textContent = t('auth.signupPasswordTooLong');
    return;
  }
  if (!PW_HAS_UPPER.test(password)) {
    errEl.textContent = t('auth.signupPasswordNeedsUpper');
    return;
  }
  if (!PW_HAS_LOWER.test(password)) {
    errEl.textContent = t('auth.signupPasswordNeedsLower');
    return;
  }
  if (!PW_HAS_DIGIT.test(password)) {
    errEl.textContent = t('auth.signupPasswordNeedsDigit');
    return;
  }
  if (!PW_ALLOWED_CHARS.test(password)) {
    errEl.textContent = t('auth.signupPasswordInvalidChar');
    return;
  }

  btn.disabled = true;
  btn.textContent = t('auth.signupPending');
  errEl.textContent = '';

  try {
    await fbSignUp(email, password);
    _updateVerifyEmailDisplay(email);
    _showAuthMode('verify');
    _updateSyncUI();
  } catch (e) {
    errEl.textContent = _friendlyAuthError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = t('dialog.login.submitSignup');
  }
}

async function _handleResendVerification() {
  const btn = document.getElementById('verify-resend-btn');
  const statusEl = document.getElementById('verify-status');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = t('auth.verifyResendPending');
  try {
    await fbSendEmailVerification();
    if (statusEl) statusEl.textContent = t('auth.verifyResendSuccess');
  } catch (e) {
    if (statusEl) statusEl.textContent = t('auth.verifyResendError', { detail: _friendlyAuthError(e.message) });
  } finally {
    if (btn) setTimeout(() => { btn.disabled = false; }, 30000);
  }
}

// Forgot-password click on the login pane.
// Reads the email already typed in the email input. Empty → red error toast
// "请先输入邮箱地址". Filled → fire-and-forget reset email via Firebase, show
// success toast "请检查邮箱", lock the link for 30s to avoid spam. Errors
// (e.g. malformed email) surface via an error toast and the lock is lifted
// immediately so the user can correct + retry.
async function _handleForgotPassword() {
  const btn = document.getElementById('forgot-password-btn');
  if (btn?.disabled) return;

  const email = (document.getElementById('login-email')?.value || '').trim();
  if (!email) {
    if (typeof showToast === 'function') showToast(t('auth.passwordResetEmptyEmail'), 'error');
    return;
  }

  if (btn) btn.disabled = true;
  try {
    await fbSendPasswordReset(email);
    if (typeof showToast === 'function') showToast(t('auth.passwordResetSent'), 'default');
    // 30s lock is UX-level only (it resets on page refresh / new tab).
    // Real abuse prevention is Firebase's server-side rate limiting on
    // sendOobCode + the recommended Email Enumeration Protection toggle in
    // the console. Don't lean on this for security.
    if (btn) setTimeout(() => { btn.disabled = false; }, 30000);
  } catch (e) {
    if (typeof showToast === 'function') {
      showToast(t('auth.passwordResetError', { detail: _friendlyAuthError(e.message) }), 'error');
    }
    if (btn) btn.disabled = false;
  }
}

// State for the delete-account confirmation modal — Figma node 160:392.
// `_deleteAccountResolve` is set while the modal is open; the cancel/confirm
// buttons (and Escape) resolve the pending promise. `_deleteAccountSeconds`
// drives the countdown so re-renders (e.g. on language change) can rebuild
// the button label without resetting the timer.
let _deleteAccountResolve = null;
let _deleteAccountSeconds = 0;
let _deleteAccountTimer = null;

function _renderDeleteAccountConfirmBtn() {
  const btn = document.getElementById('delete-account-confirm');
  if (!btn) return;
  if (_deleteAccountSeconds > 0) {
    btn.disabled = true;
    btn.textContent = t('dialog.deleteAccount.confirmCountdown', { seconds: _deleteAccountSeconds });
  } else {
    btn.disabled = false;
    btn.textContent = t('dialog.deleteAccount.confirm');
  }
}

function _closeDeleteAccountModal(result) {
  if (_deleteAccountTimer) {
    clearInterval(_deleteAccountTimer);
    _deleteAccountTimer = null;
  }
  const overlay = document.getElementById('delete-account-overlay');
  if (overlay) overlay.classList.add('hidden');
  const resolve = _deleteAccountResolve;
  _deleteAccountResolve = null;
  _deleteAccountSeconds = 0;
  if (resolve) resolve(result);
}

function _showDeleteAccountConfirm() {
  const overlay = document.getElementById('delete-account-overlay');
  if (!overlay) return Promise.resolve(false);
  // Cancel any prior pending dialog before opening a new one.
  if (_deleteAccountResolve) _closeDeleteAccountModal(false);

  overlay.classList.remove('hidden');
  _deleteAccountSeconds = 5;
  _renderDeleteAccountConfirmBtn();
  _deleteAccountTimer = setInterval(() => {
    _deleteAccountSeconds -= 1;
    _renderDeleteAccountConfirmBtn();
    if (_deleteAccountSeconds <= 0) {
      clearInterval(_deleteAccountTimer);
      _deleteAccountTimer = null;
    }
  }, 1000);

  return new Promise((resolve) => { _deleteAccountResolve = resolve; });
}

// ── Sync-conflict choice dialog ─────────────────────────────
// Opened through the `onSyncConflict` hook (installed by fbInit). The user
// picks a side, signs out (account switch only), or puts the choice off with
// "Decide later" / Escape: that only hides the dialog — the conflict stays
// pending, automatic uploads stay paused, and the next conflict notification
// (e.g. the sidebar Upload button) shows the dialog again. There is no
// "deferred" flag on purpose.
// `_conflictInfo` is remembered so language changes can re-render in place.
// `_conflictResolving` (a choice is being applied) and `_conflictSigningOut`
// (the dialog's sign-out link is running) are the only inputs of
// _applyConflictControls, so every render recomputes the controls from them.
let _conflictInfo = null;
let _conflictResolving = false;
let _conflictSigningOut = false;
let _conflictErrorCode = null;
// Element focused when the dialog went from hidden to visible (D7); null when
// it was not worth returning to (body, or a control disabled at that moment).
let _conflictReturnFocus = null;

function _formatConflictTime(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return t('dialog.syncConflict.unknownTime');
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return t('dialog.syncConflict.timeFormat', {
    month: pad(d.getMonth() + 1),
    day: pad(d.getDate()),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  });
}

function _renderSyncConflictSide(sideId, labelKey, timeLabelKey, ms, shortcuts, folders) {
  const side = document.getElementById(sideId);
  if (!side) return;
  const set = (name, text) => {
    const el = side.querySelector(`[data-field="${name}"]`);
    if (el) el.textContent = text;
  };
  set('label', t(labelKey));
  set('timeLabel', t(timeLabelKey));
  set('time', _formatConflictTime(ms));
  set('shortcuts', t('dialog.syncConflict.shortcuts', { count: shortcuts }));
  set('folders', t('dialog.syncConflict.folders', { count: folders }));
}

// The local side of the dialog, recounted from the current state on every
// render (the user may have edited while the dialog was put off). Display
// only: the pending record keeps what it was recorded with. Falls back to the
// recorded values when the local state cannot be read.
function _currentLocalConflictSide(info) {
  const recorded = {
    shortcuts: info.localShortcutCount,
    folders: info.localFolderCount,
    editTime: info.localEditTime,
  };
  try {
    if (typeof items === 'undefined') return recorded;
    const counts = _countSyncItems(items);
    return { shortcuts: counts.shortcuts, folders: counts.folders, editTime: _localEditTs };
  } catch {
    return recorded;
  }
}

function _renderSyncConflictDialog(info) {
  if (!info) return;
  const isSwitch = !!info.isAccountSwitch;
  const textEl = document.getElementById('sync-conflict-text');
  if (textEl) {
    // The pending conflict was re-marked cloud-absent (the cloud document was
    // deleted or emptied since the conflict first appeared, spec §7.3): the
    // usual "the other copy will be overwritten" text no longer holds, so this
    // text replaces it instead of being appended to it.
    const cloudAbsent = info.cloudState === 'not-found' || info.cloudState === 'empty';
    textEl.textContent = t(cloudAbsent
      ? 'dialog.syncConflict.cloudAbsent'
      : (isSwitch ? 'dialog.syncConflict.textSwitch' : 'dialog.syncConflict.text'));
  }

  const warnEl = document.getElementById('sync-conflict-account-warn');
  if (warnEl) {
    warnEl.classList.toggle('hidden', !isSwitch);
    if (isSwitch) {
      const email = fbGetEmail();
      warnEl.textContent = email
        ? t('dialog.syncConflict.accountWarn', { email })
        : t('dialog.syncConflict.accountWarnNoEmail');
    } else {
      warnEl.textContent = '';
    }
  }
  document.getElementById('sync-conflict-signout-row')?.classList.toggle('hidden', !isSwitch);

  const local = _currentLocalConflictSide(info);
  _renderSyncConflictSide('sync-conflict-local', 'dialog.syncConflict.localLabel',
    'dialog.syncConflict.localTimeLabel', local.editTime,
    local.shortcuts, local.folders);
  _renderSyncConflictSide('sync-conflict-cloud',
    isSwitch ? 'dialog.syncConflict.cloudLabelCurrent' : 'dialog.syncConflict.cloudLabel',
    'dialog.syncConflict.cloudTimeLabel', info.cloudUpdateTime,
    info.cloudShortcutCount, info.cloudFolderCount);

  _applyConflictControls();
}

// Recomputes which dialog controls are usable from module state only. Safe
// with no conflict info and with any control missing from the DOM.
function _applyConflictControls() {
  const busy = _conflictResolving || _conflictSigningOut;
  const set = (id, disabled) => {
    const el = document.getElementById(id);
    if (el) el.disabled = disabled;
  };
  set('sync-conflict-use-local', busy);
  set('sync-conflict-use-cloud', busy);
  set('sync-conflict-signout', busy);
  set('sync-conflict-defer', _conflictResolving);
}

// Focus the first usable choice; without one, the defer link; with neither
// (a choice is in flight), leave focus alone.
function _focusFirstConflictControl() {
  for (const id of ['sync-conflict-use-local', 'sync-conflict-use-cloud', 'sync-conflict-defer']) {
    const el = document.getElementById(id);
    if (el && !el.disabled) {
      el.focus();
      return;
    }
  }
}

// An element focus can go back to: still in the document, enabled and not
// inside a hidden subtree. Never the body.
function _isFocusReturnTarget(el) {
  if (!el || el === document.body || el === document.documentElement) return false;
  if (!el.isConnected || el.disabled) return false;
  return !el.closest('.hidden, [hidden]');
}

// Idempotent: a second notification while open only re-renders the content.
function _openSyncConflictDialog(info) {
  const overlay = document.getElementById('sync-conflict-overlay');
  if (!overlay || !info) return;
  if (overlay.classList.contains('hidden')) {
    // Remember where focus was before the dialog takes it. A control disabled
    // at this moment (the sidebar Upload button disables itself while it
    // runs) is not remembered: the browser has already dropped its focus.
    const active = document.activeElement;
    _conflictReturnFocus = _isFocusReturnTarget(active) ? active : null;
  }
  _conflictInfo = info;
  _renderSyncConflictDialog(info);
  overlay.classList.remove('hidden');
  // While a choice is in flight, keep its result line and the focus as they
  // are; the controls were already recomputed by the render.
  if (_conflictResolving) return;
  _setConflictError(null);
  _focusFirstConflictControl();
}

// "Decide later" / Escape: hide the dialog and nothing else. The conflict stays
// pending and auto-upload stays paused; no sync function is called. Refused
// while a choice is in flight (its result lands as the user's choice).
function _deferSyncConflictDialog() {
  if (_conflictResolving) return;
  const returnTo = _conflictReturnFocus;
  _conflictReturnFocus = null;
  _closeSyncConflictDialog();
  if (_isFocusReturnTarget(returnTo)) returnTo.focus();
  else document.getElementById('left-sidebar-handle')?.focus();
}

// Document-level Escape for the dialogs owned by this file, topmost first:
// the conflict dialog (deferred; the key goes no further), then the
// delete-account dialog. app.js's central handler steps aside for both.
function _handleConflictDialogEscape(e) {
  if (e.key !== 'Escape') return;
  const conflictOverlay = document.getElementById('sync-conflict-overlay');
  if (conflictOverlay && !conflictOverlay.classList.contains('hidden')) {
    _deferSyncConflictDialog();
    e.stopImmediatePropagation();
    return;
  }
  if (_deleteAccountResolve) _closeDeleteAccountModal(false);
}

// Error code -> i18n key of the dialog's inline error line. Two codes only
// make sense inside the dialog: the cloud changed again while choosing local,
// and a local state too large to upload (permanent for this choice, so it
// points at the way out). Everything else reads like the matching toast.
function _conflictErrorKey(code) {
  switch (code) {
    case 'cloud-changed': return 'dialog.syncConflict.cloudChanged';
    case 'payload-too-large': return 'dialog.syncConflict.payloadTooLarge';
    default: return _syncErrorToastKey(code);
  }
}

// Shows (or clears, with null) the inline error line. The code is remembered
// so a language change can re-render the line in the new language.
function _setConflictError(code) {
  _conflictErrorCode = code || null;
  const errEl = document.getElementById('sync-conflict-error');
  if (!errEl) return;
  errEl.textContent = code ? t(_conflictErrorKey(code)) : '';
  errEl.classList.toggle('hidden', !code);
}

// Applies the user's choice. Result rules (in order): success -> close + toast;
// cloud had no data (local imported) -> close + notice; no-conflict, session
// change or signed-out -> close silently; conflict already cleared (only a
// failed import after "cloud is empty" leaves that state) -> close + error
// toast; otherwise keep the dialog open with an inline error — a failed
// choose-local always lands here, since it keeps the conflict pending (§6.4).
async function _handleConflictChoice(choice) {
  if (_conflictResolving) return;
  // Second line of defence behind the disabled buttons: no choice while the
  // dialog's sign-out is running.
  if (_conflictSigningOut) return;
  try {
    _conflictResolving = true;
    _applyConflictControls();
    let r;
    try {
      r = await fbResolveSyncConflict(choice);
    } catch (e) {
      console.error('[firebase] resolve conflict failed', e);
      r = { ok: false, code: 'firestore' };
    }
    if (r?.ok && !r.code) {
      _closeSyncConflictDialog();
      showToast(t(choice === 'local' ? 'toast.syncUploaded' : 'toast.syncDownloaded'), 'default');
    } else if (r?.ok && r.code === 'no-cloud-data') {
      _closeSyncConflictDialog();
      showToast(t('toast.syncConflictCloudGone'), 'default');
    } else if (r?.code === 'no-conflict' || r?.code === 'session-changed' || !fbIsSignedIn()) {
      _closeSyncConflictDialog();
    } else if (!fbGetSyncConflict()) {
      _closeSyncConflictDialog();
      showToast(t(_syncErrorToastKey(r?.code)), 'error');
    } else {
      _setConflictError(r?.code);
    }
  } finally {
    // Controls are recomputed only after the flag is cleared (re-enabling them
    // in the branch above would still see it set).
    _conflictResolving = false;
    _updateSyncUI();
    _applyConflictControls();
  }
}

function _bindSyncConflictButtons() {
  const bind = (id, handler) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.bound === 'true') return;
    el.dataset.bound = 'true';
    el.addEventListener('click', handler);
  };
  bind('sync-conflict-use-local', () => _handleConflictChoice('local'));
  bind('sync-conflict-use-cloud', () => _handleConflictChoice('cloud'));
  bind('sync-conflict-signout', async () => {
    if (_conflictResolving || _conflictSigningOut) return;
    try {
      _conflictSigningOut = true;
      _applyConflictControls();
      await fbSignOut();
    } catch (e) {
      console.warn('[firebase] sign out from conflict dialog failed', e);
      showToast(t('toast.syncFailed'), 'error');
    } finally {
      _conflictSigningOut = false;
      _applyConflictControls();
    }
  });
  bind('sync-conflict-defer', () => _deferSyncConflictDialog());
}

function _closeSyncConflictDialog() {
  document.getElementById('sync-conflict-overlay')?.classList.add('hidden');
  _conflictInfo = null;
  _setConflictError(null);
}

function _refreshSyncConflictDialogOnLangChange() {
  const overlay = document.getElementById('sync-conflict-overlay');
  if (!overlay || overlay.classList.contains('hidden') || !_conflictInfo) return;
  _renderSyncConflictDialog(_conflictInfo);
  if (_conflictErrorCode) _setConflictError(_conflictErrorCode);
}

async function _handleDeleteAccount() {
  if (!fbIsSignedIn()) return;

  const confirmed = await _showDeleteAccountConfirm();
  if (!confirmed) return;

  const btn = document.getElementById('sync-delete-account-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = t('auth.deleteAccountPending');
  }

  try {
    await fbDeleteAccount();
    if (typeof showToast === 'function') showToast(t('toast.accountDeleted'), 'default');
    _updateSyncUI();
  } catch (e) {
    if (typeof showToast === 'function') {
      showToast(t('auth.deleteAccountError', { detail: _friendlyAuthError(e.message, e.code) }), 'error');
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = t('sidebar.sync.deleteAccount');
    }
  }
}

async function _handleCheckVerified() {
  const btn = document.getElementById('verify-check-btn');
  const statusEl = document.getElementById('verify-status');
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = t('auth.verifyChecking');
  try {
    const ok = await fbRefreshEmailVerifiedStatus();
    if (ok) {
      if (statusEl) statusEl.textContent = '';
      _hideLoginOverlay();
      _updateSyncUI();
      await _pullAfterSignIn({ trigger: 'sign-in' });
    } else {
      if (statusEl) statusEl.textContent = t('auth.verifyNotYet');
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = t('auth.verifyCheckError', { detail: _friendlyAuthError(e.message) });
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Init ────────────────────────────────────────────────────

async function fbInit() {
  // Must be in place before any startup sync detection can raise a conflict.
  // A preset hook (e.g. from a test) is left alone.
  if (typeof globalThis.onSyncConflict !== 'function') globalThis.onSyncConflict = _openSyncConflictDialog;
  await _loadAuth();
  await _loadCloudBaseline();
  await _loadRevState();
  // Seed the displayed sync time from the persisted cloud timestamp so a
  // fresh page load shows "synced at HH:MM" immediately instead of falling
  // through to the "syncing..." placeholder while nothing has actually
  // changed (syncFromCloud's no-op paths don't pass a ts to _updateSyncUI).
  _lastSyncDisplayTs = _lastCloudTs;
  _updateSyncUI();

  // Auth mode tabs (login / signup)
  document.querySelectorAll('.auth-tab').forEach(el => {
    el.addEventListener('click', () => _showAuthMode(el.dataset.mode));
  });

  // Login pane
  document.getElementById('login-submit-btn')?.addEventListener('click', _handleLogin);
  document.getElementById('login-email')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-password')?.focus();
  });
  document.getElementById('login-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _handleLogin();
  });

  // Sign-up pane
  document.getElementById('signup-submit-btn')?.addEventListener('click', _handleSignUp);
  document.getElementById('signup-email')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('signup-password')?.focus();
  });
  document.getElementById('signup-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('signup-password-confirm')?.focus();
  });
  document.getElementById('signup-password-confirm')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _handleSignUp();
  });

  // Verify pane
  document.getElementById('verify-resend-btn')?.addEventListener('click', _handleResendVerification);
  document.getElementById('verify-check-btn')?.addEventListener('click', _handleCheckVerified);

  // Common
  document.getElementById('login-skip-btn')?.addEventListener('click', _hideLoginOverlay);
  document.getElementById('sync-login-btn')?.addEventListener('click', _handleSyncLoginClick);
  document.getElementById('login-consent-cancel')?.addEventListener('click', _hideLoginConsentOverlay);
  document.getElementById('login-consent-agree')?.addEventListener('click', () => {
    _persistLoginConsent();
    _hideLoginConsentOverlay();
    _showAuthMode('login');
    _showLoginOverlay();
  });
  document.getElementById('sync-logout-btn')?.addEventListener('click', async () => {
    await fbSignOut();
  });
  document.getElementById('forgot-password-btn')?.addEventListener('click', _handleForgotPassword);
  document.getElementById('sync-delete-account-btn')?.addEventListener('click', _handleDeleteAccount);
  document.getElementById('delete-account-cancel')?.addEventListener('click', () => _closeDeleteAccountModal(false));
  document.getElementById('delete-account-confirm')?.addEventListener('click', () => {
    if (_deleteAccountSeconds > 0) return;
    _closeDeleteAccountModal(true);
  });
  document.addEventListener('keydown', (e) => _handleConflictDialogEscape(e));
  _bindSyncActionButtons();
  _bindSyncConflictButtons();

  // Re-render dynamic text on language change.
  // Note: error / verify status messages are intentionally NOT re-rendered,
  // because they're produced dynamically and re-rendering would show stale text.
  window.addEventListener('lithium:langchange', () => {
    // Verify-email target span (innerHTML reset by data-i18n-html wipes it)
    if (_pendingVerifyEmail) {
      const el = document.getElementById('verify-email-target');
      if (el) el.textContent = _pendingVerifyEmail;
    }
    // Buttons (only when not in a pending/disabled state)
    const loginBtn = document.getElementById('login-submit-btn');
    if (loginBtn && !loginBtn.disabled) loginBtn.textContent = t('dialog.login.submitLogin');
    const signupBtn = document.getElementById('signup-submit-btn');
    if (signupBtn && !signupBtn.disabled) signupBtn.textContent = t('dialog.login.submitSignup');
    const delBtn = document.getElementById('sync-delete-account-btn');
    if (delBtn && !delBtn.disabled) delBtn.textContent = t('sidebar.sync.deleteAccount');
    // If the delete-account modal is open, refresh its dynamic button label.
    if (_deleteAccountResolve) _renderDeleteAccountConfirmBtn();
    // Re-render sync status text in the new language
    _updateSyncUI();
    _refreshSyncConflictDialogOnLangChange();
  });

  if (!fbIsSignedIn()) {
    // Per UX: do not auto-open the login dialog on a fresh browser. The home
    // page just renders normally; users opt in via the sidebar "登录" button,
    // which goes through the consent gate (Figma 191:447) first.
    // Instead, a passive top-right notice (Figma 285:487) is shown once per
    // browser session as a soft reminder that data is local-only.
    if (typeof window.showSigninNotice === 'function') window.showSigninNotice();
    return;
  }

  if (!fbIsEmailVerified()) {
    // Try a silent server check — user may have verified meanwhile
    await fbRefreshEmailVerifiedStatus().catch((err) => {
      console.warn('[firebase] email verification refresh failed', err);
    });
    _updateSyncUI();
  }

  if (!fbIsEmailVerified()) {
    _updateVerifyEmailDisplay(fbGetEmail());
    _showAuthMode('verify');
    _showLoginOverlay();
    return;
  }

  await _pullAfterSignIn({ trigger: 'startup' });
}
