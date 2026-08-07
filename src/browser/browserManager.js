const { ipcMain, BrowserWindow, Menu, clipboard } = require('electron');

const { getWebsiteUrl, setWebsiteUrl } = require('../config/appConfig');

const bookmarkStore = require('../bookmarks/bookmarkStore');

const { createSetupWindow } = require('../onboarding/setupWindow');

const { createPasswordWindow } = require('../passwords/passwordWindow');

const passwordStore = require('../passwords/passwordStore');
const credentialStore = require('../passwords/credentialStore');

const searchEngines = require('../search/searchEngines');
const adblockStore = require('../privacy/adblockStore');

const adblocker = require('../privacy/adblocker');

const tabs = require('../tabs/tabManager');

/*
    Fallback floor only — the real height is measured live by
    syncToolbarHeight() in toolbar.html once it has laid out the merged
    title/tab row plus the address row
*/

const TOOLBAR_HEIGHT = 80;

/*
    Kept rather than looked up, so what the toolbar is told cannot end
    up going to the setup window when that one happens to be open
*/

let mainWindow = null;

/*
    Grows while the tab strip and the bookmarks bar are shown, so
    neither is hidden behind the view layered on top of the toolbar page
*/

let toolbarHeight = TOOLBAR_HEIGHT;

/*
    Holds the most recent login capture until the toolbar saves it,
    dismisses the prompt, or the ten-second offer expires
*/

let pendingLoginCapture = null;

let savePasswordPromptTimer = null;

let autoSavePasswordEnabled = false;

function createBrowserView(window) {
    mainWindow = window;

    tabs.init(window, {
        onViewCreated: (tab) => {
            registerNavigationEvents(tab);

            registerLinkHandling(tab);

            registerShortcuts(tab.view.webContents);
        },

        onActivate: (tab) => {
            /*
                Everything the toolbar shows is about one page, so the
                new one has to say all of it again on the way in
            */

            const url = tab.view.webContents.getURL();

            adblocker.applyForUrl(url);

            sendToToolbar('url-change', url);

            sendToToolbar('loading', tab.loading);

            sendToToolbar('shield-state', shieldState());

            sendToToolbar('bookmark-state', bookmarkState());
        },

        onChange: () => {
            sendToToolbar('tab-state', tabState());
        },

        bounds: () => viewBounds()
    });

    /*
        Registered before the early return below, so the toolbar always
        has someone to answer it even when no site is configured yet
    */

    registerToolbarEvents(window);

    registerBrowserEvents();

    registerShortcuts(window.webContents);

    /*
        Blocking is a property of the shared partition rather than of any
        one view, so it is set up whether or not a tab exists yet
    */

    adblocker.initAdblocker(tabs.getSession(), currentUrl, () => {
        sendToToolbar('shield-state', shieldState());
    });

    const websiteUrl = getWebsiteUrl();

    if (!websiteUrl) return;

    tabs.createTab(websiteUrl);
}

function registerNavigationEvents(tab) {
    const contents = tab.view.webContents;

    /*
        TEMPORARY: forwards this tab's own console.log calls (including
        the injected login-capture script's) into this terminal. Remove
        once the save-password investigation is done.
    */

    contents.on('console-message', (event, level, message) => {
        console.log('[tab-console]', message);
    });

    contents.on('did-start-loading', () => {
        tab.loading = true;

        if (isActive(tab)) {
            sendToToolbar('loading', true);
        }

        sendToToolbar('tab-state', tabState());
    });

    contents.on('did-stop-loading', () => {
        tab.loading = false;

        if (isActive(tab)) {
            sendToToolbar('loading', false);
        }

        sendToToolbar('tab-state', tabState());
    });

    contents.on('did-navigate', (_, url) => {
        /*
            The new page's icon arrives afterwards, so the old one is
            dropped here rather than being saved against this URL
        */

        tab.favicon = '';

        tab.url = url;

        /*
            It resolved, so there is nothing left to fall back on
        */

        tab.pendingOmniboxGuess = null;

        /*
            Blocking is per hostname but the session is shared, so it
            follows the tab being looked at. A page loading out of sight
            is blocked the way the tab in front of it is.
        */

        if (isActive(tab)) {
            adblocker.applyForUrl(url);

            adblocker.resetCount();

            sendToToolbar('url-change', url);

            sendToToolbar('shield-state', shieldState());
        }

        sendToToolbar('tab-state', tabState());
    });

    contents.on('did-navigate-in-page', (_, url) => {
        tab.url = url;

        if (isActive(tab)) {
            sendToToolbar('url-change', url);
        }

        sendToToolbar('tab-state', tabState());
    });

    /*
        "node.js" and a mistyped domain both look like hosts, and only
        DNS can say otherwise. When the guess does not resolve, the text
        is searched for instead, which is what a browser appears to do.
    */

    contents.on('did-fail-load', (_, errorCode, __, failedUrl, isMainFrame) => {
        if (!isMainFrame || !tab.pendingOmniboxGuess) return;

        /*
            Chromium reports the URL it normalised, so "https://node.js"
            comes back as "https://node.js/" and cannot be compared as
            plain text
        */

        if (!isSameUrl(failedUrl, tab.pendingOmniboxGuess.url)) return;

        const unresolved = errorCode === -105 || errorCode === -137;

        if (!unresolved) return;

        const query = tab.pendingOmniboxGuess.query;

        tab.pendingOmniboxGuess = null;

        contents.loadURL(searchEngines.buildSearchUrl(query));
    });

    contents.on('page-title-updated', (_, title) => {
        tab.title = title;

        sendToToolbar('tab-state', tabState());
    });

    contents.on('page-favicon-updated', (_, favicons) => {
        tab.favicon = Array.isArray(favicons) && favicons.length ? favicons[0] : '';

        if (bookmarkStore.updateFavicon(contents.getURL(), tab.favicon)) {
            sendToToolbar('bookmark-state', bookmarkState());
        }

        sendToToolbar('tab-state', tabState());
    });
}

/*
    A link that asks for a window of its own gets a tab instead, since a
    second bare window would have no toolbar to drive it
*/

function registerLinkHandling(tab) {
    tab.view.webContents.setWindowOpenHandler(({ url, disposition }) => {
        if (isWebUrl(url)) {
            openTab(url, {
                background: disposition === 'background-tab',

                /*
                    Opened next to the tab that asked for it rather than
                    at the end of the strip
                */

                atIndex: indexAfter(tab.id)
            });
        }

        return { action: 'deny' };
    });
}

function registerBrowserEvents() {
    ipcMain.removeAllListeners('navigate');

    ipcMain.on('navigate', (_, url) => {
        const view = tabs.activeView();

        if (view) {
            view.webContents.loadURL(url);
        }
    });

    /*
        Raw text from the address bar, which only becomes a URL or a
        search here, so the choice of engine stays out of the toolbar
    */

    ipcMain.removeAllListeners('omnibox-submit');

    ipcMain.on('omnibox-submit', (_, text) => {
        const tab = tabs.activeTab();

        if (!tab) return;

        const resolved = searchEngines.resolveInput(text);

        if (!resolved) return;

        tab.pendingOmniboxGuess = resolved.type === 'url' ? resolved : null;

        tab.view.webContents.loadURL(resolved.url);
    });

    /*
        Right-clicking the address bar picks the engine, so switching
        does not mean editing settings.json
    */

    ipcMain.removeAllListeners('show-search-menu');

    ipcMain.on('show-search-menu', (event) => {
        const engines = searchEngines.getEngines();

        const activeKey = searchEngines.getActiveKey();

        const menu = Menu.buildFromTemplate(
            Object.keys(engines).map((key) => ({
                label: 'Search with ' + engines[key].name,

                type: 'radio',

                checked: key === activeKey,

                click: () => {
                    searchEngines.setActiveKey(key);

                    sendToToolbar('search-engine-changed', searchEngines.describeActive());
                }
            }))
        );

        menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
    });

    ipcMain.removeAllListeners('go-back');

    ipcMain.on('go-back', () => {
        const view = tabs.activeView();

        if (!view) return;

        const history = view.webContents.navigationHistory;

        if (history.canGoBack()) {
            history.goBack();
        }
    });

    ipcMain.removeAllListeners('go-forward');

    ipcMain.on('go-forward', () => {
        const view = tabs.activeView();

        if (!view) return;

        const history = view.webContents.navigationHistory;

        if (history.canGoForward()) {
            history.goForward();
        }
    });

    ipcMain.removeAllListeners('reload');

    ipcMain.on('reload', () => {
        const view = tabs.activeView();

        if (view) {
            view.webContents.reload();
        }
    });

    /*
        Home is the site picked during setup, which the toolbar does
        not know about, so the URL is resolved here
    */

    ipcMain.removeAllListeners('go-home');

    ipcMain.on('go-home', () => {
        const view = tabs.activeView();

        const websiteUrl = getWebsiteUrl();

        if (view && websiteUrl) {
            view.webContents.loadURL(websiteUrl);
        }
    });

    /*
        The setup window is the only place the homepage can be edited,
        so changing it reopens that window over the running app
    */

    ipcMain.removeAllListeners('show-home-menu');

    ipcMain.on('show-home-menu', (event) => {
        const menu = Menu.buildFromTemplate([
            {
                label: 'Change Homepage…',

                click: () => {
                    createSetupWindow({
                        currentUrl: getWebsiteUrl(),

                        currentPageUrl: currentUrl(),

                        onSaved: (url) => {
                            const view = tabs.activeView();

                            if (view) {
                                view.webContents.loadURL(url);
                            } else {
                                openTab(url);
                            }
                        }
                    });
                }
            }
        ]);

        menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
    });
}

/*
    The vault itself — setup, unlock, lock, and CRUD on entries — has no
    dependency on a browser tab or the main window existing, unlike
    everything else in registerToolbarEvents below. Registered once at
    app startup instead, so it's already there for the setup window on
    a first launch, before the main window (and its BrowserView) has
    been created at all.
*/

function registerPasswordVaultEvents() {
    ipcMain.removeHandler('get-password-state');

    ipcMain.handle('get-password-state', () => passwordStore.passwordState());

    ipcMain.removeHandler('setup-password-vault');

    ipcMain.handle('setup-password-vault', async (_, masterPassword) => {
        const result = passwordStore.setupVault(masterPassword);

        if (result && result.ok && pendingLoginCapture) {
            await saveCapturedPassword();
        }

        return result;
    });

    ipcMain.removeHandler('remove-master-password');

    ipcMain.handle('remove-master-password', (_, currentPassword) =>
        passwordStore.removeMasterPassword(currentPassword)
    );

    ipcMain.removeHandler('unlock-password-vault');

    ipcMain.handle('unlock-password-vault', async (_, masterPassword) => {
        const result = passwordStore.unlockVault(masterPassword);

        if (result && result.ok && pendingLoginCapture) {
            await saveCapturedPassword();
        }

        return result;
    });

    ipcMain.removeHandler('lock-password-vault');

    ipcMain.handle('lock-password-vault', () => passwordStore.lockVault());

    ipcMain.removeHandler('add-password');

    ipcMain.handle('add-password', (_, entry) => passwordStore.addEntry(entry));

    ipcMain.removeHandler('update-password');

    ipcMain.handle('update-password', (_, id, updates) => passwordStore.updateEntry(id, updates));

    ipcMain.removeHandler('delete-password');

    ipcMain.handle('delete-password', async (_, id) => {
        const result = passwordStore.deleteEntry(id);

        if (result.ok && result.url && result.username) {
            await credentialStore.deleteCredential(result.url, result.username);
        }

        return result;
    });

    ipcMain.removeHandler('copy-password');

    ipcMain.handle('copy-password', (_, id) => {
        const result = passwordStore.getEntryPassword(id);

        if (!result.ok) return result;

        clipboard.writeText(result.password);

        return { ok: true };
    });
}

/*
    Registered up front, so the toolbar always has someone to answer
    it and does not depend on catching the first navigation event
*/

function registerToolbarEvents(window) {
    ipcMain.removeHandler('get-search-engine');

    ipcMain.handle('get-search-engine', () => searchEngines.describeActive());

    /*
        Pins the page in view as the homepage in one click, so the
        setup window is only needed for the initial choice
    */

    ipcMain.removeHandler('set-home-to-current');

    ipcMain.handle('set-home-to-current', () => {
        const url = currentUrl();

        if (!isWebUrl(url)) return null;

        setWebsiteUrl(url);

        return url;
    });

    /*
        Tabs
    */

    ipcMain.removeHandler('get-tab-state');

    ipcMain.handle('get-tab-state', () => tabState());

    ipcMain.removeAllListeners('new-tab');

    ipcMain.on('new-tab', (_, url) => {
        openTab(isWebUrl(url) ? url : getWebsiteUrl());
    });

    ipcMain.removeAllListeners('select-tab');

    ipcMain.on('select-tab', (_, id) => {
        tabs.selectTab(id);
    });

    ipcMain.removeAllListeners('close-tab');

    ipcMain.on('close-tab', (_, id) => {
        closeTab(id);
    });

    ipcMain.removeAllListeners('move-tab');

    ipcMain.on('move-tab', (_, id, toIndex) => {
        tabs.moveTab(id, toIndex);
    });

    /*
        The same thing the green button does: fill the screen, and give
        the previous size back on the way out
    */

    ipcMain.removeHandler('toggle-maximise');

    ipcMain.handle('toggle-maximise', () => {
        if (window.isMaximized()) {
            window.unmaximize();
        } else {
            window.maximize();
        }

        return window.isMaximized();
    });

    ipcMain.removeHandler('is-maximised');

    ipcMain.handle('is-maximised', () => window.isMaximized());

    /*
        The title bar can maximise the window too, so the toolbar is
        told rather than left to guess from its own clicks
    */

    window.removeAllListeners('maximize');

    window.removeAllListeners('unmaximize');

    window.on('maximize', () => sendToToolbar('maximise-changed', true));

    window.on('unmaximize', () => sendToToolbar('maximise-changed', false));

    ipcMain.removeHandler('get-shield-state');

    ipcMain.handle('get-shield-state', () => shieldState());

    /*
        Turns blocking off for the site in view, and back on again, so a
        page the blocker breaks is one click away from working
    */

    ipcMain.removeHandler('toggle-shield-for-site');

    ipcMain.handle('toggle-shield-for-site', () => {
        const view = tabs.activeView();

        if (!view) return shieldState();

        const url = view.webContents.getURL();

        adblockStore.toggleAllowlist(url);

        adblocker.applyForUrl(url);

        view.webContents.reload();

        return shieldState();
    });
    ipcMain.removeHandler('get-bookmark-state');

    ipcMain.handle('get-bookmark-state', () => bookmarkState());

    ipcMain.removeHandler('toggle-bookmark');

    ipcMain.handle('toggle-bookmark', () => {
        const tab = tabs.activeTab();

        if (tab) {
            bookmarkStore.toggleBookmark(
                tab.view.webContents.getURL(),
                tab.view.webContents.getTitle(),
                tab.favicon
            );
        }

        return bookmarkState();
    });

    ipcMain.removeHandler('remove-bookmark');

    ipcMain.handle('remove-bookmark', (_, url) => {
        bookmarkStore.removeBookmark(url);

        return bookmarkState();
    });

    ipcMain.removeHandler('rename-bookmark');

    ipcMain.handle('rename-bookmark', (_, url, title) => {
        bookmarkStore.renameBookmark(url, title);

        return bookmarkState();
    });

    ipcMain.removeHandler('move-bookmark');

    ipcMain.handle('move-bookmark', (_, url, toIndex) => {
        bookmarkStore.moveBookmark(url, toIndex);

        return bookmarkState();
    });

    ipcMain.removeHandler('set-bookmark-bar-visible');

    ipcMain.handle('set-bookmark-bar-visible', (_, visible) => {
        bookmarkStore.setBarVisible(visible);

        return bookmarkState();
    });

    ipcMain.removeAllListeners('open-bookmark');

    ipcMain.on('open-bookmark', (_, url, options) => {
        openBookmark(url, options);
    });

    /*
        A menu drawn inside the toolbar page would be covered by the
        view sitting on top of it, so the context menu is a native one
        owned by the main process
    */

    ipcMain.removeAllListeners('show-bookmark-menu');

    ipcMain.on('show-bookmark-menu', (event, url) => {
        const menu = Menu.buildFromTemplate([
            {
                label: 'Open',

                click: () => openBookmark(url)
            },

            {
                label: 'Open in New Tab',

                click: () => openBookmark(url, { newTab: true })
            },

            { type: 'separator' },

            {
                label: 'Rename…',

                /*
                    Renaming needs a text field, which a native menu
                    cannot host, so the toolbar edits the name in place
                */

                click: () => sendToToolbar('bookmark-rename', url)
            },

            {
                label: 'Delete',

                click: () => {
                    bookmarkStore.removeBookmark(url);

                    sendToToolbar('bookmark-state', bookmarkState());
                }
            }
        ]);

        menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
    });

    ipcMain.removeAllListeners('open-password-manager');

    ipcMain.on('open-password-manager', () => {
        const tab = tabs.activeTab();

        createPasswordWindow({
            currentPageUrl: tab ? tab.view.webContents.getURL() : '',

            currentPageTitle: tab ? tab.view.webContents.getTitle() : '',

            parentWindow: mainWindow
        });
    });

    ipcMain.removeAllListeners('login-detected');

    ipcMain.on('login-detected', (event, payload) => {
        const active = tabs.activeTab();

        console.log('[save-password-debug] login-detected IPC received', {
            isActiveTab: Boolean(active) && active.view.webContents === event.sender
        });

        if (!active || active.view.webContents !== event.sender) return;

        handleLoginDetected(payload);
    });

    ipcMain.removeHandler('save-captured-password');

    ipcMain.handle('save-captured-password', () => saveCapturedPassword());

    ipcMain.removeAllListeners('dismiss-save-password-prompt');

    ipcMain.on('dismiss-save-password-prompt', () => {
        clearSavePasswordPrompt();
    });

    /*
        In-page suggestion dropdown: each tab's own preload asks for
        matches and fills a selection directly, identified by its own
        webContents (event.sender) rather than by a claimed origin —
        the real origin always comes from that tab's own current URL
    */

    ipcMain.removeHandler('autofill-lookup');

    ipcMain.handle('autofill-lookup', async (event) => {
        const tab = tabs.findTabByWebContents(event.sender);

        if (!tab) return [];

        const url = tab.view.webContents.getURL();

        if (!isWebUrl(url)) return [];

        const credentials = await credentialStore.findCredentials(url);

        return credentials.map(({ username }) => ({ username }));
    });

    ipcMain.removeAllListeners('autofill-fill');

    ipcMain.on('autofill-fill', async (event, payload) => {
        const tab = tabs.findTabByWebContents(event.sender);

        if (!tab) return;

        const username = payload && typeof payload.username === 'string' ? payload.username : '';

        if (!username) return;

        const url = tab.view.webContents.getURL();

        if (!isWebUrl(url)) return;

        const credentials = await credentialStore.findCredentials(url);

        const match = credentials.find((item) => item.username === username);

        if (!match) return;

        await fillCredentialsIntoPage(event.sender, match.username, match.password || '');
    });

    /*
        Dismisses an account from the suggestion dropdown without
        touching the saved credential itself (not the keychain, not the
        Settings list) — scoped by event.sender exactly like the two
        handlers above
    */

    ipcMain.removeAllListeners('autofill-hide-suggestion');

    ipcMain.on('autofill-hide-suggestion', (event, payload) => {
        const tab = tabs.findTabByWebContents(event.sender);

        if (!tab) return;

        const username = payload && typeof payload.username === 'string' ? payload.username : '';

        if (!username) return;

        const url = tab.view.webContents.getURL();

        if (!isWebUrl(url)) return;

        credentialStore.hideSuggestion(url, username);
    });

    ipcMain.removeAllListeners('set-toolbar-height');

    ipcMain.on('set-toolbar-height', (_, height) => {
        const requested = Number(height);

        if (!Number.isFinite(requested)) return;

        toolbarHeight = Math.max(TOOLBAR_HEIGHT, Math.round(requested));

        resizeBrowserView();
    });
}

/*
    The application menu is removed, so these shortcuts are caught off
    the key events of both the toolbar and the pages inside the tabs
*/

function registerShortcuts(contents) {
    contents.on('before-input-event', handleShortcut);
}

function handleShortcut(event, input) {
    if (input.type !== 'keyDown') return;

    const key = String(input.key).toLowerCase();

    /*
        Ctrl+Tab cycles on every platform, including macOS, where the
        rest of the tab shortcuts are Cmd-based
    */

    if (input.control && key === 'tab') {
        event.preventDefault();

        tabs.cycle(input.shift ? -1 : 1);

        return;
    }

    const modifier = process.platform === 'darwin' ? input.meta : input.control;

    if (!modifier) return;

    if (input.shift) {
        if (key === 'b') {
            event.preventDefault();

            bookmarkStore.setBarVisible(!bookmarkStore.isBarVisible());

            sendToToolbar('bookmark-state', bookmarkState());
        }

        return;
    }

    if (key === 't') {
        event.preventDefault();

        openTab(getWebsiteUrl());

        return;
    }

    if (key === 'w') {
        event.preventDefault();

        closeTab(tabs.getActiveId());

        return;
    }

    if (/^[1-9]$/.test(key)) {
        event.preventDefault();

        tabs.selectByPosition(Number(key));
    }
}

function openTab(url, options = {}) {
    return tabs.createTab(isWebUrl(url) ? url : getWebsiteUrl() || 'about:blank', options);
}

/*
    Closing the last tab would leave a toolbar driving nothing, and this
    window is the app, so a fresh homepage tab takes its place rather
    than the window going away underneath the user
*/

function closeTab(id) {
    if (id === null || id === undefined) return;

    if (tabs.closeTab(id) === 0) {
        openTab(getWebsiteUrl());
    }
}

function indexAfter(id) {
    const list = tabs.getTabs();

    const index = list.findIndex((tab) => tab.id === id);

    return index === -1 ? list.length : index + 1;
}

function isActive(tab) {
    return tab.id === tabs.getActiveId();
}

function currentUrl() {
    const view = tabs.activeView();

    return view ? view.webContents.getURL() : '';
}

function isSameUrl(a, b) {
    try {
        return new URL(a).href === new URL(b).href;
    } catch {
        return a === b;
    }
}

function isWebUrl(url) {
    try {
        const protocol = new URL(url).protocol;

        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

function hostnameFromUrl(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return String(url || '').trim();
    }
}

function clearSavePasswordPrompt() {
    if (savePasswordPromptTimer) {
        clearTimeout(savePasswordPromptTimer);

        savePasswordPromptTimer = null;
    }

    pendingLoginCapture = null;

    sendToToolbar('save-password-prompt', null);
}

function hideSavePasswordPrompt() {
    if (savePasswordPromptTimer) {
        clearTimeout(savePasswordPromptTimer);

        savePasswordPromptTimer = null;
    }

    sendToToolbar('save-password-prompt', null);
}

/*
    Fills a selection made in the in-page suggestion dropdown. Runs in
    the tab's own page context, so the password only ever exists there
    as a live field value — the same as the user typing it themselves.
*/

async function fillCredentialsIntoPage(webContents, username, password) {
    if (!webContents || webContents.isDestroyed()) return;

    await webContents.executeJavaScript(`
        (() => {
            const username = ${JSON.stringify(username)};
            const password = ${JSON.stringify(password)};

            /*
                React (and similar) wrap the native value setter to track
                what it last saw, so a plain "field.value = x" is invisible
                to it even with an input event dispatched afterward. Calling
                the native setter directly, from the prototype rather than
                the instance, bypasses that wrapper so the framework's own
                change detection sees a real change.
            */
            function setFieldValue(field, value) {
                const nativeSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                ).set;
                nativeSetter.call(field, value);
                field.dispatchEvent(new Event('input', { bubbles: true }));
                field.dispatchEvent(new Event('change', { bubbles: true }));
            }

            const forms = Array.from(document.querySelectorAll('form'));
            const targetForm = forms.find((form) => {
                const fields = Array.from(form.querySelectorAll('input'));
                return fields.some((field) => field.type === 'password');
            });
            if (!targetForm) return false;
            const passwordField = targetForm.querySelector('input[type="password"]');
            if (!passwordField) return false;
            const usernameField = Array.from(targetForm.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="password"])'))
                .find((field) => /user|email|login|account|name/i.test((field.name || '') + (field.id || '') + (field.placeholder || '')));
            if (usernameField) setFieldValue(usernameField, username);
            setFieldValue(passwordField, password);

            /*
                Marks this submission as "used a saved credential
                unchanged" for the capture script's benefit. Added only
                after the fill's own dispatches above, so they can't
                immediately clear it — any later, real edit to either
                field does, since that means the fields no longer hold
                what was picked from the suggestion list.
            */

            targetForm.__webdeskAutofilled = true;

            const clearAutofillMark = () => {
                targetForm.__webdeskAutofilled = false;
            };

            passwordField.addEventListener('input', clearAutofillMark, { once: true });

            if (usernameField) {
                usernameField.addEventListener('input', clearAutofillMark, { once: true });
            }

            return true;
        })();
    `);
}

function autoSaveCapturedPassword() {
    if (!autoSavePasswordEnabled) return;

    if (!pendingLoginCapture) return;

    if (!passwordStore.isVaultSetup()) {
        pendingLoginCapture = null;

        return;
    }

    if (!passwordStore.isUnlocked()) {
        pendingLoginCapture = null;

        return;
    }

    const capture = pendingLoginCapture;

    const result = passwordStore.saveCapturedLogin(capture);

    if (result && result.ok) {
        pendingLoginCapture = null;

        sendToToolbar('save-password-prompt', null);
    }
}

function handleLoginDetected(payload) {
    console.log('[save-password-debug] handleLoginDetected called with:', {
        hasPassword: Boolean(payload && typeof payload.password === 'string' && payload.password),
        url: payload && payload.url,
        username: payload && payload.username,
        viaAutofill: payload && payload.viaAutofill
    });

    if (!payload || typeof payload.password !== 'string' || !payload.password) {
        console.log('[save-password-debug] REJECTED: no password in payload');

        return;
    }

    const url = String(payload.url || currentUrl()).trim();

    if (!isWebUrl(url)) {
        console.log('[save-password-debug] REJECTED: not a web url ->', url);

        return;
    }

    const username = String(payload.username || '').trim();

    const capture = {
        title: String(payload.title || hostnameFromUrl(url)).trim() || hostnameFromUrl(url),
        url,
        username,
        password: payload.password,
        formFields: Array.isArray(payload.formFields) ? payload.formFields : []
    };

    if (!passwordStore.shouldStoreCapturedLogin(capture)) {
        console.log('[save-password-debug] REJECTED: shouldStoreCapturedLogin returned false', {
            url,
            formFields: capture.formFields
        });

        return;
    }

    const hasExisting = Boolean(
        passwordStore.isVaultSetup() && username && passwordStore.hasMatchingEntry(url, username)
    );

    /*
        A credential picked from the suggestion list, submitted
        unchanged, is already what's saved — nothing to ask about. Typed
        in by hand, it always gets asked about, even when it matches an
        existing entry, since a saved password can only be updated by
        going through this prompt again with the new one.
    */

    if (payload.viaAutofill && hasExisting) {
        console.log('[save-password-debug] REJECTED: viaAutofill + already has matching entry');

        return;
    }

    pendingLoginCapture = capture;

    if (savePasswordPromptTimer) {
        clearTimeout(savePasswordPromptTimer);
    }

    console.log('[save-password-debug] SENDING prompt to toolbar for', hostnameFromUrl(url));

    sendToToolbar('save-password-prompt', {
        kind: 'save',
        hostname: hostnameFromUrl(url),
        username,
        updating: hasExisting,
        seconds: 10
    });

    savePasswordPromptTimer = setTimeout(() => {
        clearSavePasswordPrompt();
    }, 10000);
}

async function saveCapturedPassword() {
    if (!pendingLoginCapture) {
        return { ok: false, error: 'No login details to save' };
    }

    const capture = pendingLoginCapture;

    if (!passwordStore.isVaultSetup()) {
        return { ok: false, error: 'Set up your password vault first', needsSetup: true };
    }

    if (!passwordStore.isUnlocked()) {
        hideSavePasswordPrompt();

        return { ok: true, queued: true, needsUnlock: true };
    }

    const result = await credentialStore.saveCredential({
        origin: capture.url,
        username: capture.username,
        password: capture.password
    });

    if (!result || !result.ok) {
        clearSavePasswordPrompt();

        return result;
    }

    const vaultResult = passwordStore.saveCapturedLogin(capture);

    clearSavePasswordPrompt();

    return vaultResult.ok ? { ok: true, id: result.id } : vaultResult;
}

function openPasswordManagerWithPending() {
    const tab = tabs.activeTab();

    createPasswordWindow({
        currentPageUrl: pendingLoginCapture
            ? pendingLoginCapture.url
            : tab
              ? tab.view.webContents.getURL()
              : '',

        currentPageTitle: pendingLoginCapture
            ? pendingLoginCapture.title
            : tab
              ? tab.view.webContents.getTitle()
              : '',

        pendingCapture: pendingLoginCapture
            ? {
                  title: pendingLoginCapture.title,
                  url: pendingLoginCapture.url,
                  username: pendingLoginCapture.username,
                  password: pendingLoginCapture.password
              }
            : null,

        parentWindow: mainWindow
    });
}

function openBookmark(url, options = {}) {
    if (!bookmarkStore.isValidUrl(url)) return;

    const view = tabs.activeView();

    if (options.newTab || !view) {
        openTab(url, { background: Boolean(options.background) });

        return;
    }

    view.webContents.loadURL(url);
}

function shieldState() {
    const url = currentUrl();

    return {
        ready: adblocker.isReady(),

        status: adblocker.getStatus(),

        blocking: adblocker.isBlockingNow(),

        allowlisted: adblockStore.isAllowlisted(url),

        blocked: adblocker.getBlockedCount(),

        host: adblockStore.hostnameOf(url)
    };
}

function bookmarkState() {
    const url = currentUrl();

    return {
        bookmarks: bookmarkStore.getBookmarks(),

        bookmarked: bookmarkStore.isBookmarked(url),

        barVisible: bookmarkStore.isBarVisible()
    };
}

function tabState() {
    return {
        tabs: tabs.getTabs(),

        activeId: tabs.getActiveId()
    };
}

function sendToToolbar(channel, data) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.webContents.send(channel, data);
}

function viewBounds() {
    if (!mainWindow || mainWindow.isDestroyed()) return null;

    const bounds = mainWindow.getContentBounds();

    return {
        x: 0,

        y: toolbarHeight,

        width: bounds.width,

        height: Math.max(0, bounds.height - toolbarHeight)
    };
}

function resizeBrowserView() {
    tabs.applyBounds();
}

function attachResizeHandler(window) {
    window.on('resize', () => {
        resizeBrowserView();
    });

    /*
        Entering kiosk for focus mode resizes the window through a path
        that does not always report as an ordinary resize
    */

    window.on('enter-full-screen', () => {
        resizeBrowserView();
    });

    window.on('leave-full-screen', () => {
        resizeBrowserView();
    });
}

module.exports = {
    createBrowserView,
    attachResizeHandler,
    registerPasswordVaultEvents
};
