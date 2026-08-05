# WebDesk

A lightweight macOS desktop application that turns any website into a standalone desktop experience.

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
* Links that ask for a new window open in a new tab instead

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

├── main.js
├── preload.js
├── package.json
├── package-lock.json
│
├── assets/
│   └── icon.icns
│
└── src/
    │
    ├── browser/
    │   ├── browserManager.js
    │   └── sessionManager.js
    │
    ├── window/
    │   ├── windowManager.js
    │   └── setupWindow.js
    │
    ├── onboarding/
    │   ├── setup.html
    │   └── setup.js
    │
    └── storage/
        └── settingsStore.js
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

WebDesk follows Electron security recommendations:

* `contextIsolation` enabled
* `nodeIntegration` disabled
* Sandboxed renderer processes
* Minimal preload API exposure

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

MIT License
