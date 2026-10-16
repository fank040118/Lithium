# Changelog

All notable changes to **Lithium (Custom Start Page)** will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [1.0.3] - 2026-10-16

### Fixed
- Cross-account data leak: a queued upload or a pull after sign-in could write the previous account's local data into the newly signed-in account's cloud document
- A token refresh that landed after sign-out could revive the signed-out session and mis-record the account switch

### Changed
- Local edits are now tracked with a persisted revision counter (`_fb_edit_rev` / `_fb_synced_rev`) instead of comparing client and server timestamps; existing installations are migrated once automatically
- Signing in to a different account now treats that account's cloud snapshot as authoritative, and automatic uploads stay blocked until it has been pulled (or explicitly re-uploaded)
- Sign-out now resets the cloud sync state, and the device keeps a persisted sync baseline (`_fb_sync_baseline_uid`) to detect the next account switch

### Notes
- If you had unsynced edits before upgrading, click the manual "上传" (Upload) button once after signing in

## [1.0.2] - 2026-07-12

### Fixed
- Cloud sync race condition where an in-flight upload and a pull could interleave and clobber each other's data
- Startup data normalization/migration was incorrectly marked as a user edit, triggering spurious re-syncs
- Sync status display could get stuck on "syncing..." after a no-op sync on fresh page load

### Changed
- Sync now uses the server-provided `updateTime` instead of the client clock, and persists the cloud sync timestamp across service-worker restarts
- Hardened token refresh handling and disabled HTTP caching on sync requests to avoid stale reads
- Added localized sync status and error toast messages (`CloudSyncError`)

## [1.0.1] - 2026-06-26

### Added
- Lithium logo and shortened extension name across both Chrome and Firefox manifests
- Manual cropping step on custom icon upload (with switch to WebP encoding for smaller payloads)
- Inline folder rename directly from the folder header
- Weather data layer via Open-Meteo API (`weather.js`): current conditions, hourly/daily forecast, multi-city management

### Changed
- Aligned the engine-form-input control to the standard `.form-input` design tokens
- Unified `Escape` key to close all popups (folder, edit, clock, login, etc.)
- Set the Firefox add-on ID to `lithium-newtab@fank040118`
- Grid resize (via context menu) now animates displaced neighbours with the same FLIP transition used by drag-and-drop
- Corrected `2x4`/`4x2` size naming to consistently follow rows×cols convention

### Fixed
- Large-size folder with only one remaining icon after the normal slots now renders it full-size instead of as a mini thumbnail
- Letters with descenders (p, g, y, q) were clipped in grid item labels due to `line-height: 1`; increased to `1.2`
- Weather forecast cache is now persisted to `chrome.storage.local` so it survives service-worker restarts

### Security / Privacy
- `PRIVACY.md` now explicitly lists the favicon services (`google.com/s2/favicons`, `icon.horse`) that may receive shortcut hostnames when the browser-native favicon API isn't available

## [1.0.0] - 2026-05-17

Initial public release.

### Added

- Customizable new tab / homepage for Chrome (Manifest V3) and Firefox
- Multi-timezone clock display with custom labels
- Customizable search engines with quick switcher
- Draggable shortcut grid with folder support (FLIP animation)
- Custom wallpaper with adjustable blur overlay
- Optional cloud sync via Firebase Auth + Firestore
- Account registration with mandatory email verification flow
- Self-service account deletion (removes Firebase account + all cloud data)
- Per-user data isolation enforced by Firestore Security Rules
- Friendly Chinese error messages for auth failures

### Security

- Firebase Web API key is intentionally public (per Google's design); security is enforced server-side via:
  - Firestore Security Rules (uid isolation + email_verified check + 100KB per-document size limit)
  - Cloud Quotas (Identity Toolkit + Firestore rate limits)
  - Restricted API key (only Identity Toolkit, Token Service, Firestore)
  - Email Enumeration Protection enabled
- Email verification required before any cloud read/write
- Client-side guards in `syncToCloud` / `syncFromCloud` block sync attempts for unverified accounts (defense in depth on top of Firestore Rules)

[Unreleased]: https://github.com/fank040118/Lithium/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/fank040118/Lithium/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/fank040118/Lithium/releases/tag/v1.0.0
