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
const FB_LEGACY_LOCAL_TS_KEY = '_fb_local_sync_ts';
const FB_CLOUD_SYNC_TS_KEY = '_fb_cloud_sync_ts';
// Account whose cloud snapshot the local state is currently based on. Written
// after every successful pull/upload and kept across sign-out so the next
// sign-in can tell whether the local data belongs to a previous account.
const FB_BASELINE_UID_KEY = '_fb_sync_baseline_uid';

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
    this.code = code; // 'network' | 'auth' | 'quota' | 'firestore' | 'not-signed-in'
    this.status = status;
    this.original = original;
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
  // Any in-flight token refresh or queued upload was started for the session
  // being torn down; bumping the epoch makes their late responses no-ops.
  _authEpoch += 1;
  _idToken = null;
  _tokenExpiry = 0;
  _refreshToken = null;
  _uid = null;
  _emailVerified = false;
  _email = null;
  // The sync baseline is intentionally kept across sign-out: it belongs to the
  // account that just signed out, and keeping it is what tells the next
  // sign-in that the local state still contains that account's data (see
  // _needsSwitchPull). The rev keys are machine-local counters and also stay.
  _lastCloudTs = 0;
  _lastSyncDisplayTs = 0;
  clearTimeout(_syncTimer);
  _syncTimer = null;
  const s = _fbStore();
  if (s) await s.remove([
    '_fb_refresh', '_fb_uid', '_fb_email_verified', '_fb_email',
    FB_CLOUD_SYNC_TS_KEY,
  ]);
}

// ── Token management ─────────────────────────────────────────

async function _getToken() {
  if (_idToken && Date.now() < _tokenExpiry - 60000) return _idToken;
  if (!_refreshToken) return null;

  // Capture the identity this refresh belongs to. A response that lands after
  // a sign-out/sign-in must never touch the new session's state — otherwise a
  // late refresh would revive the signed-out account (and its uid).
  const epoch = _authEpoch;

  let res;
  try {
    res = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${FB_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: _refreshToken }),
        cache: 'no-store',
      }
    );
  } catch (err) {
    throw new CloudSyncError('network', 0, err);
  }

  let data = {};
  try { data = await res.json(); } catch {}

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
  // A new identity invalidates in-flight work from the previous session.
  _authEpoch += 1;
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
  // A new identity invalidates in-flight work from the previous session.
  _authEpoch += 1;
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

// Delete the user's cloud data and Firebase account permanently.
// Best-effort on the Firestore side: if the document doesn't exist or rules
// reject it (e.g. unverified email), proceed to delete the auth account anyway.
async function fbDeleteAccount() {
  const token = await _getToken();
  if (!token) throw new Error('NOT_SIGNED_IN');

  // 1. Delete Firestore data (best-effort)
  if (_uid) {
    try {
      await fetch(_docUrl(), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      console.warn('Firestore data deletion failed (continuing):', e);
    }
  }

  // 2. Delete the Auth account
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${FB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    }
  );
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error?.message || 'DELETE_ACCOUNT_FAILED');
  }

  // 3. Clear local auth state
  await _clearAuth();
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
// Callers must run _loadCloudSyncTs() first so _lastCloudTs is populated.
async function _loadRevState() {
  const s = _fbStore();
  if (!s) return { editRev: _editRev, syncedRev: _syncedRev };
  const d = await s.get([FB_EDIT_REV_KEY, FB_SYNCED_REV_KEY, FB_LEGACY_LOCAL_TS_KEY]);
  if (d[FB_EDIT_REV_KEY] === undefined) {
    const dirty = _normalizeTs(d[FB_LEGACY_LOCAL_TS_KEY]) > _lastCloudTs;
    _editRev = dirty ? 1 : 0;
    _syncedRev = 0;
    await s.remove([FB_LEGACY_LOCAL_TS_KEY]);
    await _saveRevState();
  } else {
    _editRev = _normalizeTs(d[FB_EDIT_REV_KEY]);
    _syncedRev = _normalizeTs(d[FB_SYNCED_REV_KEY]);
  }
  return { editRev: _editRev, syncedRev: _syncedRev };
}

async function _saveRevState() {
  const s = _fbStore();
  if (!s) return;
  await s.set({ [FB_EDIT_REV_KEY]: _editRev, [FB_SYNCED_REV_KEY]: _syncedRev });
}

async function _loadCloudSyncTs() {
  const s = _fbStore();
  if (!s) return 0;
  const d = await s.get([FB_CLOUD_SYNC_TS_KEY]);
  _lastCloudTs = _normalizeTs(d[FB_CLOUD_SYNC_TS_KEY]);
  return _lastCloudTs;
}

async function _saveCloudSyncTs(ts) {
  _lastCloudTs = _normalizeTs(ts);
  const s = _fbStore();
  if (!s) return;
  await s.set({ [FB_CLOUD_SYNC_TS_KEY]: _lastCloudTs });
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

const _docUrl = () =>
  `https://firestore.googleapis.com/v1/projects/${FB_PROJECT_ID}/databases/(default)/documents/users/${_uid}/data/settings`;

async function _fsGet() {
  const token = await _getToken();
  if (!token) throw new CloudSyncError('not-signed-in', 0);

  let res;
  try {
    res = await fetch(_docUrl(), {
      headers: {
        Authorization: `Bearer ${token}`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      cache: 'no-store',
    });
  } catch (err) {
    throw new CloudSyncError('network', 0, err);
  }

  if (res.status === 404) return null;

  if (!res.ok) {
    const { code, status } = await _parseFirestoreError(res);
    throw new CloudSyncError(code, status);
  }
  return await res.json();
}

async function _fsSet(data) {
  const token = await _getToken();
  if (!token) throw new CloudSyncError('not-signed-in', 0);

  const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, _toFV(v)]));
  let res;
  try {
    res = await fetch(_docUrl(), {
      method: 'PATCH',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      body: JSON.stringify({ fields }),
    });
  } catch (err) {
    throw new CloudSyncError('network', 0, err);
  }

  if (!res.ok) {
    const { code, status } = await _parseFirestoreError(res);
    throw new CloudSyncError(code, status);
  }

  let doc = null;
  try { doc = await res.json(); } catch { return null; }
  return doc?.updateTime || null;
}

async function _parseFirestoreError(res) {
  let data = {};
  try { data = await res.json(); } catch {}
  const msg = data.error?.message || '';
  const errStatus = data.error?.status || '';
  const status = res.status;

  if (status === 401 || status === 403 ||
      errStatus === 'UNAUTHENTICATED' ||
      errStatus === 'PERMISSION_DENIED' ||
      msg.includes('UNAUTHENTICATED') ||
      msg.includes('PERMISSION_DENIED')) {
    await _clearAuth();
    return { code: 'auth', status };
  }
  if (status === 429 ||
      errStatus === 'RESOURCE_EXHAUSTED' ||
      msg.includes('QUOTA_EXCEEDED') ||
      msg.includes('RESOURCE_EXHAUSTED')) {
    return { code: 'quota', status };
  }
  return { code: 'firestore', status };
}

// ── Sync ────────────────────────────────────────────────────

let _syncTimer = null;
let _syncInFlight = null; // Promise | null
let _lastCloudTs = 0;     // 来自 Firestore Document.updateTime（毫秒）
let _editRev = 0;         // local edit counter, persisted as _fb_edit_rev
let _syncedRev = 0;       // edit rev last uploaded to the cloud, persisted as _fb_synced_rev
// _syncState and _lastSyncError are consumed by _updateSyncUI in Task 3.
let _syncState = 'idle';  // 'idle' | 'uploading' | 'downloading' | 'error'
let _lastSyncError = null;

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

async function _doSyncToCloud(options = {}) {
  const { force = false } = options;
  const epoch = _authEpoch;
  if (!fbIsSignedIn() || !fbIsEmailVerified()) {
    throw new CloudSyncError('not-signed-in', 0);
  }

  // While an account switch is unresolved, automatic uploads must not run: the
  // local state still contains the previous account's data and would be
  // PATCHed into the signed-in account's document. The manual "upload" button
  // calls this with force: true and is an explicit user action, so it bypasses
  // this guard on purpose.
  if (!force && _needsSwitchPull()) return { ok: true, skipped: true };

  // Skip when the local state is clean and not forced.
  if (!force && !_isDirty()) return { ok: true, skipped: true };

  _syncState = 'uploading';
  _lastSyncError = null;
  _updateSyncUI();

  // Snapshot the edit rev at upload start so edits made while this request is
  // in flight stay dirty and get picked up by a follow-up upload.
  const revAtStart = _editRev;
  const now = Date.now();
  // Re-check right before the request: if the identity changed after this call
  // was accepted (e.g. the queued continuation raced with a sign-out), do not
  // PATCH the new account's document.
  if (epoch !== _authEpoch) {
    _syncState = 'idle';
    _updateSyncUI();
    return { ok: true, skipped: true };
  }
  const cloudUpdateTime = await _fsSet({
    items: JSON.stringify(items),
    engines: JSON.stringify(customEngines),
    selected_engine: selectedEngineId,
    clocks: JSON.stringify(clocks),
    grid_columns: mainGridColumns,
    updated_at: now, // 兼容旧客户端/UI 显示，不作为冲突判断依据
  });

  // The response landed after the identity changed (sign-out/sign-in while the
  // request was in flight). This upload belongs to the previous session: drop
  // it with zero bookkeeping writes — persisting its server time or syncing
  // the baseline against a null/other uid would destroy the persisted switch
  // signal and let the old account's local items be uploaded to the new one.
  if (epoch !== _authEpoch) return { ok: true, skipped: true };

  if (!cloudUpdateTime) throw new CloudSyncError('firestore', 0, new Error('No updateTime in response'));

  const serverMs = _rfc3339ToMs(cloudUpdateTime);
  if (serverMs === 0) {
    throw new CloudSyncError('firestore', 0, new Error('Invalid updateTime from server'));
  }
  await _saveCloudSyncTs(serverMs);
  _syncedRev = revAtStart;
  await _saveRevState();
  // The cloud now holds this local state, so it becomes the sync baseline.
  await _saveBaselineUid(_uid);

  _syncState = 'idle';
  _updateSyncUI(serverMs);
  if (_isDirty()) scheduleSyncToCloud();
  return { ok: true, skipped: false, ts: serverMs };
}

function syncToCloud(options = {}) {
  // A queued continuation belongs to the session that queued it: if the
  // account changed while the previous upload was in flight, it must be
  // dropped instead of uploading the old local state to the new account.
  const epoch = _authEpoch;
  if (_syncInFlight) {
    const continueIfSameSession = () =>
      epoch === _authEpoch ? syncToCloud(options) : Promise.resolve({ ok: true, skipped: true });
    return _syncInFlight.then(continueIfSameSession, continueIfSameSession);
  }

  _syncInFlight = _doSyncToCloud(options);
  _syncInFlight.catch((err) => {
    _syncState = 'error';
    _lastSyncError = err;
    _updateSyncUI();
  }).finally(() => {
    _syncInFlight = null;
  });

  return _syncInFlight;
}

// Returns true if cloud data was found and applied
async function syncFromCloud(options = {}) {
  const { force = false } = options;
  if (!fbIsSignedIn() || !fbIsEmailVerified()) return false;

  // Wait for any in-flight upload first: the GET result must not race with
  // (or be overwritten by) an upload that is still targeting the same doc.
  if (_syncInFlight) {
    try { await _syncInFlight; } catch { /* upload failure is handled by its own path */ }
  }

  _syncState = 'downloading';
  _lastSyncError = null;
  _updateSyncUI();

  try {
    const doc = await _fsGet();
    if (!doc?.fields) {
      _syncState = 'idle';
      _updateSyncUI();
      // Nothing to pull: the signed-in account's state is now considered the
      // baseline, so subsequent automatic uploads are allowed again.
      await _saveBaselineUid(_uid);
      return false;
    }

    const cloudUpdateTime = doc.updateTime || null;
    const cloudTsMs = _rfc3339ToMs(cloudUpdateTime);
    const hasCloudTimestamp = cloudTsMs > 0;

    // 非强制模式下，若云端没有变化则跳过
    if (!force && hasCloudTimestamp && cloudTsMs <= _lastCloudTs) {
      _syncState = 'idle';
      _updateSyncUI();
      await _saveBaselineUid(_uid);
      // A failed upload can leave local edits dirty with no timer pending, so
      // re-queue them here instead of waiting for the next user edit.
      if (_isDirty()) scheduleSyncToCloud();
      return true;
    }

    const f = doc.fields;
    // 兼容：旧数据仍用 updated_at 字段显示
    const legacyCloudTs = _fromFV(f.updated_at) || 0;

    // Last-writer-on-this-device-wins: arriving here already means the cloud
    // has changed; if the local state is dirty, prefer local edits and requeue
    // an upload. This is an intentional design choice. Deliberately no
    // baseline write here: treating the local state as "synced" could unblock
    // automatic uploads of a previous account's leftovers.
    if (!force && _isDirty() && hasCloudTimestamp) {
      _syncState = 'idle';
      _updateSyncUI();
      scheduleSyncToCloud();
      return false;
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
      const normalized = typeof globalThis.normalizeFolderChildItemSizes === 'function'
        ? globalThis.normalizeFolderChildItemSizes(cloudItems)
        : { items: cloudItems, changed: false };
      items = normalized.items;
      shouldResyncCloud = !!normalized.changed;
    }
    if (Array.isArray(cloudEngines)) customEngines = cloudEngines;
    if (typeof cloudEngine === 'string' && cloudEngine) selectedEngineId = cloudEngine;
    if (Array.isArray(cloudClocks) && cloudClocks.length > 0) clocks = cloudClocks;
    if (typeof cloudColumns === 'number') mainGridColumns = cloudColumns;

    const s = _fbStore();
    if (s) {
      await s.set({
        startpage_items: items,
        startpage_engines: customEngines,
        startpage_selected_engine: selectedEngineId,
        startpage_clocks: clocks,
        startpage_grid_columns: mainGridColumns,
      });
    }

    await _saveCloudSyncTs(cloudTsMs);
    // The applied cloud snapshot is now the synced baseline: local state is clean.
    _syncedRev = _editRev;
    await _saveRevState();
    // The local state now mirrors this account's cloud document.
    await _saveBaselineUid(_uid);

    applyWallpaper();
    applyMainGridColumns();
    render();
    document.getElementById('engine-name').textContent = getSelectedEngine().name;
    _syncState = 'idle';
    _updateSyncUI(cloudTsMs || legacyCloudTs);
    if (shouldResyncCloud) {
      // Cloud data was normalized on apply; bump the edit rev so the canonical
      // form is re-uploaded for other devices.
      _editRev += 1;
      await _saveRevState();
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
    return true;
  } catch (e) {
    _syncState = 'error';
    _lastSyncError = e;
    _updateSyncUI();
    throw e;
  }
}

function scheduleSyncToCloud() {
  if (!fbIsSignedIn() || !fbIsEmailVerified()) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    syncToCloud().catch((err) => {
      // 自动上传失败只记录并更新状态栏，不弹 toast 打扰用户
      console.error('[firebase] scheduled upload failed', err);
    });
  }, 2000);
}

async function markLocalCloudDataChanged(options = {}) {
  const { userEdit = true } = options;
  if (userEdit) {
    _editRev += 1;
    await _saveRevState();
  }
  scheduleSyncToCloud();
}

// Shared "pull after sign-in" entry point for interactive login, email
// verification and startup restore: pull the cloud snapshot and, when the
// cloud explicitly has no data, queue an upload of the local state instead.
// The pull is forced whenever the persisted sync baseline belongs to another
// account (see _needsSwitchPull), so the signed-in account's document always
// wins over whatever a previous account left on this device. `forcePull`
// remains as an explicit override for tests/tools.
async function _pullAfterSignIn(forcePull = false) {
  if (!fbIsSignedIn() || !_uid) return;
  const effectiveForce = forcePull || _needsSwitchPull();
  let hadCloudData = false;
  try {
    hadCloudData = await syncFromCloud(effectiveForce ? { force: true } : {});
  } catch (err) {
    // Fail-safe: a failed pull says nothing about the cloud state, so it must
    // not be treated as "no cloud data". Never queue an upload here — after an
    // account switch a dirty local state could be PATCHed into the new
    // account's document. Keep it dirty and let the next edit or startup pull
    // retry.
    console.error('[firebase] initial pull failed', err);
    return;
  }
  if (!hadCloudData) scheduleSyncToCloud();
}

// ── UI ──────────────────────────────────────────────────────

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
      await syncToCloud({ force: true });
      showToast(t('toast.syncUploaded'), 'default');
    } else {
      // 关键：手动拉取前取消尚未执行的自动上传，并等待正在执行的上传完成
      clearTimeout(_syncTimer);
      _syncTimer = null;
      if (_syncInFlight) await _syncInFlight;

      const pulled = await syncFromCloud({ force: true });
      showToast(pulled ? t('toast.syncDownloaded') : t('toast.syncNoCloudData'), 'default');
    }
  } catch (e) {
    const code = e?.code || 'firestore';
    if (code === 'auth') {
      showToast(t('toast.syncAuthFailed'), 'error');
    } else if (code === 'network') {
      showToast(t('toast.syncNetworkFailed'), 'error');
    } else if (code === 'quota') {
      showToast(t('toast.syncQuotaFailed'), 'error');
    } else {
      showToast(t('toast.syncFailed'), 'error');
    }
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

function _updateSyncUI(ts) {
  if (typeof ts === 'number') _lastSyncDisplayTs = ts;
  else if (ts === undefined) ts = _lastSyncDisplayTs || undefined;
  const statusEl = document.getElementById('sync-status-text');
  const loginSection = document.getElementById('sync-login-section');
  const loggedSection = document.getElementById('sync-logged-section');
  if (!statusEl) return;
  if (fbIsSignedIn()) {
    loginSection?.classList.add('hidden');
    loggedSection?.classList.remove('hidden');
    if (!fbIsEmailVerified()) {
      statusEl.textContent = t('sidebar.sync.status.notVerified');
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

function _friendlyAuthError(msg) {
  if (!msg) return t('error.unknown');
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
    await _pullAfterSignIn();
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
      showToast(t('auth.deleteAccountError', { detail: _friendlyAuthError(e.message) }), 'error');
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
      await _pullAfterSignIn();
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
  await _loadAuth();
  await _loadCloudSyncTs();
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
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _deleteAccountResolve) _closeDeleteAccountModal(false);
  });
  _bindSyncActionButtons();

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

  await _pullAfterSignIn();
}
