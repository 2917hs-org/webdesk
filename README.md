# WebDesk

A lightweight macOS desktop application that turns any website into a standalone desktop experience.

By [Hasan Siddiqui](mailto:hasan190889@gmail.com).

WebDesk uses Electron's Chromium engine to provide a dedicated application window for a configured website. It behaves like a separate desktop application while maintaining its own browser session, cookies, and local storage.

---

## Features

### Current Features

* Standalone desktop application for websites
* Built with Electron and Chromium
* macOS support (Apple Silicon first)
* First-time website configuration
* Persistent website URL configuration
* Independent browser session from Chrome
* Persistent cookies and local storage
* Custom desktop window
* Native macOS application packaging
* URL toolbar navigation
* Back / forward navigation
* Page refresh support
* Tabs, with drag-to-reorder and `⌘T` / `⌘W` / `⌘1`–`⌘9` / `⌃Tab` shortcuts
* Optional tab grouping by site
* Links that ask for a new window open in a new tab instead
* File downloads, saved straight to the system Downloads folder with a toolbar panel for progress, pause/resume/cancel, retry, and history
* A "New Window" icon (`⌘N`) for opening a second, fully independent WebDesk window that shares bookmarks, saved passwords, and download history with the first
* Bookmarks bar (`⌘⇧B` to toggle), with drag-to-reorder, rename, and a right-click menu
* Built-in ad/tracker blocking (Ghostery's EasyList/EasyPrivacy engine), with a shield toggle to disable it per site
* A password manager with autofill suggestions on login forms — see [Password Manager](#password-manager) below for how it's protected
* Light / Dark / Follow System appearance, matching macOS's own setting
* Configurable search engine for anything typed into the address bar that isn't a URL

---

## Password Manager

WebDesk can save logins typed into pages it's pinned to and offer them back as autofill suggestions. Saved passwords are encrypted (AES-256-GCM) either way, but the *key* they're encrypted under depends on whether you've set a master password:

* **No master password set (the default):** entries are still encrypted on disk, but under a fixed key built into the app itself — not a secret only you know. This protects against casually opening `settings.json` and reading passwords in plain text, but not against someone who has both the file and the app's source.
* **Master password set:** entries are re-encrypted under a key derived from your password, which is never stored. Without it, the entries on disk cannot be decrypted.

Set a master password from the Password Manager (toolbar → Passwords…) whenever you want real protection rather than the unprotected default.

---

## Why WebDesk?

Sometimes you want a website to feel like a dedicated application instead of another browser tab.

Examples:

* Coding platforms
* Project management tools
* Documentation portals
* Learning platforms
* Internal company tools

Instead of:

```
Chrome
 ├── Many tabs
 ├── Distractions
 └── Mixed sessions
```

WebDesk provides:

```
WebDesk
 └── One focused website experience
```

---

# Technology Stack

## Desktop Framework

* Electron
* Chromium Engine
* Node.js

## Frontend

* HTML
* CSS
* JavaScript

## Storage

* electron-store
* Persistent application configuration

## Packaging

* electron-builder
* macOS DMG packaging

---

# Project Structure

```
webdesk/

├── main.js                     # App entry point — startup only
├── preload.js                  # contextBridge API for the main toolbar window
├── package.json
├── package-lock.json
│
├── assets/
│   └── icon.icns
│
├── tests/                      # node:test unit tests
│
└── src/
    │
    ├── window/
    │   └── windowManager.js    # Creates the main BrowserWindow
    │
    ├── browser/
    │   ├── browserManager.js   # Tabs, navigation, IPC — the core of the app
    │   └── menuIcons.js        # Icons for native context menus
    │
    ├── tabs/
    │   └── tabManager.js       # Per-window tab strip (one BrowserView per tab)
    │
    ├── onboarding/
    │   ├── setup.html
    │   └── setupWindow.js      # First-run / "change homepage" window
    │
    ├── bookmarks/
    │   └── bookmarkStore.js
    │
    ├── passwords/
    │   ├── passwordStore.js         # Encrypted vault (electron-store, AES-256-GCM)
    │   ├── credentialStore.js       # OS Keychain-backed autofill lookup (keytar)
    │   ├── loginCapturePreload.js   # Injected into each tab to detect logins
    │   ├── passwordWindow.js
    │   └── passwords.html
    │
    ├── downloads/
    │   ├── downloadManager.js
    │   ├── downloadStore.js
    │   ├── downloadsWindow.js
    │   └── downloads.html
    │
    ├── privacy/
    │   ├── adblocker.js         # Wraps @ghostery/adblocker-electron
    │   └── adblockStore.js      # Per-site allowlist
    │
    ├── search/
    │   └── searchEngines.js     # Address bar: URL vs. search resolution
    │
    ├── theme/
    │   └── themeManager.js
    │
    ├── shared/
    │   └── url.js                # Single source of truth for "is this a loadable URL"
    │
    ├── storage/
    │   └── settingsStore.js      # The one electron-store instance everything reads/writes
    │
    ├── config/
    │   └── appConfig.js          # The pinned website URL, read through settingsStore
    │
    └── toolbar/
        └── toolbar.html          # The main window's UI (tabs, address bar, bookmarks bar)
```

---

# Development Setup

## Requirements

* macOS
* Node.js
* npm

Check versions:

```bash
node --version
npm --version
```

---

## Install Dependencies

Clone the repository:

```bash
git clone <repository-url>

cd webdesk
```

Install packages:

```bash
npm install
```

---

## Run Development Mode

Start WebDesk:

```bash
npm start
```

On first launch:

1. Enter the website URL
2. Click "Create WebDesk"
3. The website opens in the application window

Example:

```
https://leetcode.com
```

---

## Tests, Linting, and Formatting

```bash
npm test           # runs tests/*.test.js with Node's built-in test runner
npm run lint        # ESLint (flat config, eslint.config.js)
npm run format:check # Prettier, check only — does not rewrite files
npm run format       # Prettier, writes changes
```

---

# Build macOS Application

Create a production build:

```bash
npm run build
```

Output:

```
dist/

├── WebDesk.app
└── WebDesk.dmg
```

The generated application can be installed like a normal macOS application.

**Code signing and notarization are not yet configured.** `hardenedRuntime` is on and electron-builder's default entitlements (which keytar's native module needs) are applied automatically, but without a Developer ID Application certificate the build above produces an **unsigned** app — `npm run build` will skip signing and print a warning rather than fail. Before distributing outside your own machine:

1. Get a Developer ID Application certificate from an Apple Developer account and have it available to `electron-builder` (see [electron.build/code-signing](https://electron.build/code-signing)).
2. Set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` (or an App Store Connect API key), and `APPLE_TEAM_ID` as environment variables — electron-builder notarizes automatically when these are present and a valid identity is found.
3. Re-run `npm run build`, then verify with `spctl -a -vv dist/mac-arm64/WebDesk.app` on a clean machine.

---

# Application Data

WebDesk stores user configuration and browser session data in:

```
~/Library/Application Support/WebDesk
```

This includes:

* Website configuration
* Cookies
* Local storage
* Browser session information

The data is isolated from Google Chrome.

---

# Security

Every website WebDesk loads is treated as untrusted content. Concretely:

* `contextIsolation` enabled, `nodeIntegration` disabled, `sandbox` enabled — on every window, with no exceptions
* Minimal, named preload API exposure — no generic `send`/`invoke` passthrough
* All navigation (address bar, bookmarks, links, the pinned homepage) is validated through [`src/shared/url.js`](src/shared/url.js) before it's loaded — only `http`/`https` ever reach `loadURL`
* `window.open()`/target=\_blank links are opened as a new tab rather than an unrestricted popup window
* Saved passwords: see [Password Manager](#password-manager) above for what "encrypted" means before vs. after you set a master password

---

# Future Roadmap

## Productivity Features

* Pomodoro timer
* Focus mode
* Break reminders
* Desktop notifications

## Usage Analytics

* Time spent on website
* Daily productivity statistics
* Usage history

## Customization

* Custom application names
* Custom icons
* Multiple website profiles
* Custom keyboard shortcuts

## Integrations

* GitHub solution links
* Developer productivity tools
* Website-specific extensions

---

# Development Principles

WebDesk aims to remain:

* Lightweight
* Fast startup
* Low CPU usage
* Minimal dependencies
* Easy to extend

The goal is not to build a full browser, but a focused desktop container for web applications.

---

# License

Apache License 2.0 — see [LICENSE](LICENSE) for the full text.

Copyright 2026 Hasan Siddiqui
