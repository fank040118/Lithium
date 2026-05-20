# Lithium

A lightweight new-tab page extension for Chrome (Manifest V3) and Firefox. Multi-timezone clocks, customizable search engines, a draggable shortcut grid with folders, custom wallpaper, and optional Firebase-backed cloud sync.

## Features

- 🕒 Multi-timezone clock display
- 🔍 Customizable search engines with quick switcher
- 🔗 Draggable shortcut grid with folder support (frosted-glass overlay + FLIP animation)
- 🖼️ Custom wallpaper with adjustable blur overlay
- ☁️ Optional cloud sync (Firebase Auth + Firestore)

## Install

### From a release (recommended)

Grab the latest build from the [Releases](https://github.com/fank040118/Lithium/releases) page:

- **Chrome** — download the `.zip`, unpack it, then go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and pick the unpacked folder.
- **Firefox** — download the signed `.xpi` and open it directly, or load it via `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**.

### From source

```powershell
git clone https://github.com/fank040118/Lithium.git
# Chrome:  chrome://extensions → Load unpacked → select the repo folder
# Firefox: copy manifest.firefox.json over manifest.json, then
#          about:debugging#/runtime/this-firefox → Load Temporary Add-on → pick that manifest.json
```

### Why two manifests?

Chrome and Firefox don't agree on every MV3 field, so each browser has its own. The repo's default `manifest.json` is the Chrome build; Firefox-specific overrides live in `manifest.firefox.json` and are swapped in at packaging time.

| Field | `manifest.json` (Chrome) | `manifest.firefox.json` |
|---|---|---|
| `permissions: ["favicon"]` | ✓ | — (Firefox has no favicon API) |
| `chrome_settings_overrides.homepage` | — | ✓ (Firefox can also use the extension as the homepage) |
| `web_accessible_resources` | ✓ (paired with the favicon API) | — |
| `browser_specific_settings.gecko.id` | included for source-loading convenience | same ID |

For publishing: Chrome Web Store accepts the package built from `manifest.json` as-is. Firefox AMO requires the file inside the package to be literally `manifest.json`, so the Firefox build is produced by renaming `manifest.firefox.json` → `manifest.json` before zipping.

## Cloud sync (optional)

The extension ships with a Firebase project deployed by the author — **register and use right away, no backend setup required**.

### How to use it

1. Click **Sign in** in the sidebar
2. Switch to the **Register** tab, enter email + password
3. Click the verification link in the email Firebase sends you
4. Sign in — sync is live

### Deleting your account

In the **Cloud sync** panel, click **Delete account**. This **permanently deletes** your Firebase account and every byte of cloud data (irreversible). Local data is preserved.

### Limits & caveats

- Cloud sync runs on the author's personal Firebase project. **Showcase quality with no SLA** — subject to Cloud Quotas, may be throttled or suspended.
- Per-account size cap: **100 KB** (plenty for config; don't use it as a file store).
- Email verification is mandatory — unverified accounts cannot read or write cloud data.

### Self-hosted backend

Prefer not to trust someone else's backend? Fork the repo and replace `FB_API_KEY` / `FB_PROJECT_ID` at the top of [firebase.js](firebase.js) with values from your own Firebase project. See the [Firebase setup docs](https://firebase.google.com/docs/web/setup) — create a project and enable Authentication + Firestore.

## Documentation

- [PRIVACY.md](PRIVACY.md) — privacy policy: what's collected, where it's stored, third-party services (including favicon providers)
- [SECURITY.md](SECURITY.md) — how to report security vulnerabilities
- [CHANGELOG.md](CHANGELOG.md) — release history

## Project status

Released as a **personal showcase project**. No commitment to ongoing maintenance, issue response, or feature work. Forks and learning are welcome.

## License

[MIT](LICENSE) © 2024-2026 fank040118
