import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIREBASE_SRC = readFileSync(path.join(__dirname, '../../firebase.js'), 'utf8');

const EXPORTED_NAMES = [
  '_normalizeTs',
  '_rfc3339ToMs',
  '_loadLocalSyncTs',
  '_saveLocalSyncTs',
  '_loadCloudSyncTs',
  '_saveCloudSyncTs',
  '_loadAuth',
  '_saveAuth',
  '_clearAuth',
  'fbIsSignedIn',
  'fbIsEmailVerified',
  '_doSyncToCloud',
  'syncToCloud',
  'syncFromCloud',
  'scheduleSyncToCloud',
  '_toFV',
  '_fromFV',
];

// firebase.js is a classic (non-module) script: its top-level `function`
// declarations attach to the global object, same as multiple <script> tags
// sharing one global lexical environment in a browser. Indirect eval runs
// in global scope for the same reason, so re-running it here re-defines
// every function fresh (own closure over reset module state) — giving each
// test full isolation without touching the production file.
export function loadFirebaseModule() {
  (0, eval)(FIREBASE_SRC);
  const mod = {};
  for (const name of EXPORTED_NAMES) {
    mod[name] = globalThis[name];
  }
  return mod;
}
