# Changelog

All notable changes to **Lithium (Custom Start Page)** will be documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## [Unreleased]

### Added
- Lithium logo and shortened extension name across both Chrome and Firefox manifests
- Manual cropping step on custom icon upload (with switch to WebP encoding for smaller payloads)
- Inline folder rename directly from the folder header

### Changed
- Aligned the engine-form-input control to the standard `.form-input` design tokens
- Unified `Escape` key to close all popups (folder, edit, clock, login, etc.)
- Set the Firefox add-on ID to `lithium-newtab@fank040118`

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

[Unreleased]: https://github.com/fank040118/Lithium/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/fank040118/Lithium/releases/tag/v1.0.0
