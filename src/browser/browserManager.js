const { BrowserView, ipcMain, BrowserWindow, Menu } = require('electron');

const { getWebsiteUrl, setWebsiteUrl } = require('../config/appConfig');

const bookmarkStore = require('../bookmarks/bookmarkStore');

const { createSetupWindow } = require('../onboarding/setupWindow');

const focusMode = require('../focus/focusMode');

const searchEngines = require('../search/searchEngines');
const adblockStore = require('../privacy/adblockStore');

const adblocker = require('../privacy/adblocker');

const TOOLBAR_HEIGHT = 50;

let browserView = null;

/*
    Grows while the bookmarks bar is shown, so the bar is not
    hidden behind the BrowserView layered on top of the toolbar page
*/

let toolbarHeight = TOOLBAR_HEIGHT;

/*
    Icon of the page currently in the view, kept so bookmarking it
    saves the icon the user can already see in the page
*/

let currentFavicon = '';

/*
    What the address bar last sent somewhere as a URL, kept so a guess
    that turns out not to resolve can be searched for instead
*/

let pendingOmniboxGuess = null;

function createBrowserView(window) {
    browserView = new BrowserView({
        webPreferences: {
            contextIsolation: true,

            nodeIntegration: false,

            sandbox: true,

            partition: 'persist:webdesk'
        }
    });

    window.setBrowserView(browserView);

    resizeBrowserView(window);

    /*
        Registered before the early return below, so the toolbar always
        has someone to answer it even when no site is configured yet
    */

    registerToolbarEvents(window);

    registerShortcuts(window);

    const websiteUrl = getWebsiteUrl();

    if (websiteUrl) {
        browserView.webContents.loadURL(websiteUrl);
    } else {
        // browserView.webContents.loadURL(
        //     ""
        // );
        return;
    }

    registerNavigationEvents();

    registerBrowserEvents();

    /*
        Building the engine needs the network on a first run, so the app
        carries on unblocked and the loader keeps retrying behind it
    */

    adblocker.initAdblocker(
        browserView.webContents.session,

        () => (browserView ? browserView.webContents.getURL() : ''),

        () => {
            sendToToolbar('shield-state', shieldState());
        }
    );
}

function registerNavigationEvents() {
    browserView.webContents.on('did-start-loading', () => {
        sendToToolbar('loading', true);
    });

    browserView.webContents.on('did-stop-loading', () => {
        sendToToolbar('loading', false);
    });

    browserView.webContents.on('did-navigate', (_, url) => {
        /*
            The new page's icon arrives afterwards, so the old one is
            dropped here rather than being saved against this URL
        */

        currentFavicon = '';

        /*
            It resolved, so there is nothing left to fall back on
        */

        pendingOmniboxGuess = null;

        /*
            The exception is per hostname, so blocking is matched to the
            new page before its subresources start arriving
        */

        adblocker.applyForUrl(url);

        adblocker.resetCount();

        sendToToolbar('url-change', url);

        sendToToolbar('shield-state', shieldState());
    });

    browserView.webContents.on('did-navigate-in-page', (_, url) => {
        sendToToolbar('url-change', url);
    });

    /*
        "node.js" and a mistyped domain both look like hosts, and only
        DNS can say otherwise. When the guess does not resolve, the text
        is searched for instead, which is what a browser appears to do.
    */

    browserView.webContents.on('did-fail-load', (_, errorCode, __, failedUrl, isMainFrame) => {
        if (!isMainFrame || !pendingOmniboxGuess) return;

        /*
            Chromium reports the URL it normalised, so "https://node.js"
            comes back as "https://node.js/" and cannot be compared as
            plain text
        */

        if (!isSameUrl(failedUrl, pendingOmniboxGuess.url)) return;

        const unresolved = errorCode === -105 || errorCode === -137;

        if (!unresolved) return;

        const query = pendingOmniboxGuess.query;

        pendingOmniboxGuess = null;

        browserView.webContents.loadURL(searchEngines.buildSearchUrl(query));
    });

    browserView.webContents.on('page-favicon-updated', (_, favicons) => {
        currentFavicon = Array.isArray(favicons) && favicons.length ? favicons[0] : '';

        if (bookmarkStore.updateFavicon(browserView.webContents.getURL(), currentFavicon)) {
            sendToToolbar('bookmark-state', bookmarkState());
        }
    });
}

function registerBrowserEvents() {
    ipcMain.on('navigate', (_, url) => {
        if (browserView) {
            browserView.webContents.loadURL(url);
        }
    });

    /*
        Raw text from the address bar, which only becomes a URL or a
        search here, so the choice of engine stays out of the toolbar
    */

    ipcMain.on('omnibox-submit', (_, text) => {
        if (!browserView) return;

        const resolved = searchEngines.resolveInput(text);

        if (!resolved) return;

        pendingOmniboxGuess = resolved.type === 'url' ? resolved : null;

        browserView.webContents.loadURL(resolved.url);
    });

    /*
        Right-clicking the address bar picks the engine, so switching
        does not mean editing settings.json
    */

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

    ipcMain.on('go-back', () => {
        const history = browserView.webContents.navigationHistory;

        if (history.canGoBack()) {
            history.goBack();
        }
    });

    ipcMain.on('go-forward', () => {
        const history = browserView.webContents.navigationHistory;

        if (history.canGoForward()) {
            history.goForward();
        }
    });

    ipcMain.on('reload', () => {
        browserView.webContents.reload();
    });

    /*
        Home is the site picked during setup, which the toolbar does
        not know about, so the URL is resolved here
    */

    ipcMain.on('go-home', () => {
        const websiteUrl = getWebsiteUrl();

        if (browserView && websiteUrl) {
            browserView.webContents.loadURL(websiteUrl);
        }
    });

    /*
        The setup window is the only place the homepage can be edited,
        so changing it reopens that window over the running app
    */

    ipcMain.on('show-home-menu', (event) => {
        const menu = Menu.buildFromTemplate([
            {
                label: 'Change Homepage…',

                click: () => {
                    createSetupWindow({
                        currentUrl: getWebsiteUrl(),

                        currentPageUrl: browserView ? browserView.webContents.getURL() : '',

                        onSaved: (url) => {
                            if (browserView) {
                                browserView.webContents.loadURL(url);
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
        if (!browserView) return null;

        const url = browserView.webContents.getURL();

        if (!isWebUrl(url)) return null;

        setWebsiteUrl(url);

        return url;
    });

    focusMode.attachFocusMode(window, (active) => {
        sendToToolbar('focus-mode-changed', active);

        resizeBrowserView(window);
    });

    ipcMain.removeHandler('toggle-focus-mode');

    ipcMain.handle('toggle-focus-mode', () =>
        (focusMode.isActive() ? focusMode.exitFocusMode() : focusMode.enterFocusMode()));

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
        if (!browserView) return shieldState();

        const url = browserView.webContents.getURL();

        adblockStore.toggleAllowlist(url);

        adblocker.applyForUrl(url);

        browserView.webContents.reload();

        return shieldState();
    });
    ipcMain.removeHandler('get-bookmark-state');

    ipcMain.handle('get-bookmark-state', () => bookmarkState());

    ipcMain.removeHandler('toggle-bookmark');

    ipcMain.handle('toggle-bookmark', () => {
        if (browserView) {
            bookmarkStore.toggleBookmark(
                browserView.webContents.getURL(),
                browserView.webContents.getTitle(),
                currentFavicon
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

    ipcMain.on('open-bookmark', (_, url) => {
        openBookmark(url);
    });

    /*
        A menu drawn inside the toolbar page would be covered by the
        BrowserView sitting on top of it, so the context menu is a
        native one owned by the main process
    */

    ipcMain.removeAllListeners('show-bookmark-menu');

    ipcMain.on('show-bookmark-menu', (event, url) => {
        const menu = Menu.buildFromTemplate([
            {
                label: 'Open',

                click: () => openBookmark(url)
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

    ipcMain.removeAllListeners('set-toolbar-height');

    ipcMain.on('set-toolbar-height', (_, height) => {
        const requested = Number(height);

        if (!Number.isFinite(requested)) return;

        toolbarHeight = Math.max(TOOLBAR_HEIGHT, Math.round(requested));

        resizeBrowserView(window);
    });
}

/*
    The application menu is removed, so these shortcuts are caught off
    the key events of both the toolbar and the page inside the view
*/

function registerShortcuts(window) {
    const handler = (event, input) => {
        if (input.type !== 'keyDown') return;

        const modifier = process.platform === 'darwin' ? input.meta : input.control;

        if (!modifier || !input.shift) return;

        const key = String(input.key).toLowerCase();

        if (key === 'b') {
            event.preventDefault();

            bookmarkStore.setBarVisible(!bookmarkStore.isBarVisible());

            sendToToolbar('bookmark-state', bookmarkState());
        }

        /*
            Way out of focus mode that does not depend on being able to
            reach the toolbar. Escape is left alone, since the editors
            on the timed sites use it.
        */

        if (key === 'f') {
            event.preventDefault();

            if (focusMode.isActive()) {
                focusMode.exitFocusMode();
            } else {
                focusMode.enterFocusMode();
            }
        }
    };

    window.webContents.on('before-input-event', handler);

    browserView.webContents.on('before-input-event', handler);
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

function openBookmark(url) {
    if (browserView && bookmarkStore.isValidUrl(url)) {
        browserView.webContents.loadURL(url);
    }
}

function shieldState() {
    const url = browserView ? browserView.webContents.getURL() : '';

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
    const url = browserView ? browserView.webContents.getURL() : '';

    return {
        bookmarks: bookmarkStore.getBookmarks(),

        bookmarked: bookmarkStore.isBookmarked(url),

        barVisible: bookmarkStore.isBarVisible()
    };
}

function sendToToolbar(channel, data) {
    const window = BrowserWindow.getAllWindows()[0];

    if (window) {
        window.webContents.send(channel, data);
    }
}

function resizeBrowserView(window) {
    if (!browserView) return;

    const bounds = window.getContentBounds();

    browserView.setBounds({
        x: 0,

        y: toolbarHeight,

        width: bounds.width,

        height: Math.max(0, bounds.height - toolbarHeight)
    });
}

function attachResizeHandler(window) {
    window.on('resize', () => {
        resizeBrowserView(window);
    });

    /*
        Entering kiosk for focus mode resizes the window through a path
        that does not always report as an ordinary resize
    */

    window.on('enter-full-screen', () => {
        resizeBrowserView(window);
    });

    window.on('leave-full-screen', () => {
        resizeBrowserView(window);
    });
}

module.exports = {
    createBrowserView,
    attachResizeHandler
};
