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

const downloadManager = require('../downloads/downloadManager');

const { toggleDownloadsWindow, notifyDownloadsWindow } = require('../downloads/downloadsWindow');

const tabManagerModule = require('../tabs/tabManager');

const themeManager = require('../theme/themeManager');

const menuIcons = require('./menuIcons');

const { isWebUrl } = require('../shared/url');

const pageTranslator = require('../translate/pageTranslator');

const translatePrefs = require('../translate/translatePrefs');

const languages = require('../translate/languages');

const {
    toggleTranslateWindow,
    getOwnerCtx: getTranslatePanelCtx
} = require('../translate/translateWindow');

const selectionPopup = require('../translate/selectionPopup');

/*
    Fallback floor only — the real height is measured live by
    syncToolbarHeight() in toolbar.html once it has laid out the merged
    title/tab row plus the address row
*/

const TOOLBAR_HEIGHT = 80;

/*
    One entry per open WebDesk window, keyed by that window's own
    webContents id (the id every IPC message from its toolbar arrives
    tagged with as event.sender). Everything that used to be a single
    module-level variable — the window itself, its tabs, its toolbar
    height, its pending "save this password?" prompt — lives here now
    instead, so a second window opened from the new "New Window" icon
    gets its own copy rather than clobbering the first window's.

    What stays outside this map (bookmarks, saved passwords, the ad
    blocker's rules, the download list) is deliberately shared across
    every entry — the same way separate windows of one Chrome profile
    still see the same bookmarks bar and download history.
*/

const windowContexts = new Map();

let adblockerInitialized = false;

let downloadsInitialized = false;

function createBrowserView(window) {
    const ctx = {
        window,

        tabs: tabManagerModule.createTabManager(),

        toolbarHeight: TOOLBAR_HEIGHT,

        /*
            Holds the most recent login capture until the toolbar saves it,
            dismisses the prompt, or the ten-second offer expires
        */

        pendingLoginCapture: null,

        savePasswordPromptTimer: null
    };

    /*
        Captured now rather than read back off window.webContents inside
        the 'closed' handler below — by the time 'closed' fires (let
        alone during the mass teardown of app quit) webContents is
        already destroyed, and even reading its .id throws
    */

    const windowContentsId = window.webContents.id;

    windowContexts.set(windowContentsId, ctx);

    /*
        'close' (not yet destroyed) rather than 'closed' — every tab's
        BrowserView is torn down explicitly here while the window is
        still alive, because Electron only auto-destroys the one
        BrowserView actually attached with setBrowserView. Left to quit
        on its own, the other background tabs' views would still be
        live when the window (and, on Cmd+Q, the whole app) is
        destroyed out from under them, which is what throws the
        "Object has been destroyed" exceptions from inside Electron's
        own BrowserView teardown.
    */

    window.on('close', () => {
        ctx.tabs.destroyAll();
    });

    window.on('closed', () => {
        windowContexts.delete(windowContentsId);
    });

    ctx.tabs.init(window, {
        onViewCreated: (tab) => {
            registerNavigationEvents(tab, ctx);

            registerLinkHandling(tab, ctx);

            registerPageContextMenu(tab, ctx);

            registerTranslateEvents(tab, ctx);

            registerShortcuts(tab.view.webContents, ctx);
        },

        onActivate: (tab) => {
            /*
                Everything the toolbar shows is about one page, so the
                new one has to say all of it again on the way in
            */

            const url = tab.view.webContents.getURL();

            adblocker.applyForUrl(url);

            sendToToolbar(ctx, 'url-change', url);

            sendToToolbar(ctx, 'loading', tab.loading);

            sendToToolbar(ctx, 'shield-state', shieldState(ctx));

            sendToToolbar(ctx, 'bookmark-state', bookmarkState(ctx));

            sendToToolbar(ctx, 'translate-badge-state', translateBadgeState(tab));
        },

        onChange: () => {
            sendToToolbar(ctx, 'tab-state', tabState(ctx));
        },

        bounds: () => viewBounds(ctx)
    });

    /*
        Registered before the early return below, so the toolbar always
        has someone to answer it even when no site is configured yet
    */

    registerToolbarEvents(window, ctx);

    registerBrowserEvents();

    registerDownloadEvents();

    registerTranslateIpcEvents();

    registerShortcuts(window.webContents, ctx);

    /*
        Blocking and downloads are properties of the shared partition
        rather than of any one window, so each is wired up only once —
        attaching a second 'will-download' or 'request-blocked' listener
        for every extra window would double-count and double-save
    */

    ensureAdblockerInitialized();

    ensureDownloadsInitialized();

    /*
        Warmed up now rather than on the first right-click, so that
        click doesn't have to wait on the rasterizer
    */

    menuIcons.rasterize();

    /*
        The tab created below focuses its own webContents while the
        window is still hidden (see selectTab() in tabManager.js), but
        Chromium resets focus once the window actually becomes key —
        landing, by DOM order, on the toolbar's first button (Back).
        Re-asserting focus on the active page once the window is
        actually shown is what keeps launch behaving like every other
        browser: focus on the page, not on a toolbar button.
    */

    window.once('show', () => {
        const view = ctx.tabs.activeView();

        if (view && !view.webContents.isDestroyed()) {
            view.webContents.focus();
        }
    });

    const websiteUrl = getWebsiteUrl();

    if (!websiteUrl) return;

    ctx.tabs.createTab(websiteUrl);
}

function ensureAdblockerInitialized() {
    if (adblockerInitialized) return;

    adblockerInitialized = true;

    adblocker.initAdblocker(
        tabManagerModule.getSession(),

        () => {
            const first = windowContexts.values().next().value;

            return first ? currentUrl(first) : '';
        },

        () => {
            /*
                One shared blocker, but every window has its own current
                page, so each is told its own shield state rather than
                whichever window happened to trigger this
            */

            for (const ctx of windowContexts.values()) {
                sendToToolbar(ctx, 'shield-state', shieldState(ctx));
            }
        }
    );
}

function ensureDownloadsInitialized() {
    if (downloadsInitialized) return;

    downloadsInitialized = true;

    downloadManager.initDownloads(tabManagerModule.getSession(), () => {
        const downloads = downloadManager.getDownloads();

        broadcastToAllWindows('download-state', downloads);

        notifyDownloadsWindow(downloads);
    });
}

function contextForSender(webContents) {
    return windowContexts.get(webContents.id) || null;
}

/*
    A tab's own webContents (its page, or its login-capture preload)
    never has an entry of its own in windowContexts — only the window
    that owns it does — so finding the right context means checking
    each window's tab list in turn
*/

function contextForTabContents(webContents) {
    for (const ctx of windowContexts.values()) {
        if (ctx.tabs.findTabByWebContents(webContents)) return ctx;
    }

    return null;
}

function broadcastToAllWindows(channel, data) {
    for (const ctx of windowContexts.values()) {
        sendToToolbar(ctx, channel, data);
    }
}

/*
    Bookmarks are one shared list, so a change made in one window's
    toolbar has to be redrawn in every other window's bookmarks bar too
*/

function broadcastBookmarkState() {
    for (const ctx of windowContexts.values()) {
        sendToToolbar(ctx, 'bookmark-state', bookmarkState(ctx));
    }
}

function registerNavigationEvents(tab, ctx) {
    const contents = tab.view.webContents;

    contents.on('did-start-loading', () => {
        tab.loading = true;

        if (isActive(tab, ctx)) {
            sendToToolbar(ctx, 'loading', true);
        }

        sendToToolbar(ctx, 'tab-state', tabState(ctx));
    });

    contents.on('did-stop-loading', () => {
        tab.loading = false;

        if (isActive(tab, ctx)) {
            sendToToolbar(ctx, 'loading', false);
        }

        sendToToolbar(ctx, 'tab-state', tabState(ctx));
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

        if (isActive(tab, ctx)) {
            adblocker.applyForUrl(url);

            adblocker.resetCount();

            sendToToolbar(ctx, 'url-change', url);

            sendToToolbar(ctx, 'shield-state', shieldState(ctx));
        }

        sendToToolbar(ctx, 'tab-state', tabState(ctx));
    });

    contents.on('did-navigate-in-page', (_, url) => {
        tab.url = url;

        if (isActive(tab, ctx)) {
            sendToToolbar(ctx, 'url-change', url);
        }

        sendToToolbar(ctx, 'tab-state', tabState(ctx));
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

        sendToToolbar(ctx, 'tab-state', tabState(ctx));
    });

    contents.on('page-favicon-updated', (_, favicons) => {
        tab.favicon = Array.isArray(favicons) && favicons.length ? favicons[0] : '';

        if (bookmarkStore.updateFavicon(contents.getURL(), tab.favicon)) {
            broadcastBookmarkState();
        }

        sendToToolbar(ctx, 'tab-state', tabState(ctx));
    });
}

/*
    A link that asks for a window of its own gets a tab instead, since a
    second bare window would have no toolbar to drive it
*/

function registerLinkHandling(tab, ctx) {
    tab.view.webContents.setWindowOpenHandler(({ url, disposition }) => {
        if (isWebUrl(url)) {
            openTab(ctx, url, {
                background: disposition === 'background-tab',

                /*
                    Opened next to the tab that asked for it rather than
                    at the end of the strip
                */

                atIndex: indexAfter(ctx, tab.id)
            });
        }

        return { action: 'deny' };
    });
}

/*
    The page's own right-click menu. Every action here already exists
    behind a toolbar button — this just gives the page a second, closer
    way to reach the same handful of them, the way Chrome's own page
    menu mixes page-specific items (Save Image As…) with a few that are
    really about the browser chrome (Back, Forward).
*/

function registerPageContextMenu(tab, ctx) {
    const contents = tab.view.webContents;

    contents.on('context-menu', async (event, params) => {
        const icons = await menuIcons.rasterize();

        const menu = Menu.buildFromTemplate(buildPageContextMenuTemplate(tab, ctx, params, icons));

        menu.popup({ window: ctx.window });
    });
}

function translateBadgeState(tab) {
    return { translated: pageTranslator.getState(tab.view.webContents).translated };
}

/*
    Two things a tab needs regardless of whether the translate popover
    has ever been opened for it: its translated-DOM state has to be
    thrown away on a real navigation (the text nodes it points at no
    longer exist), and every finished load has to be offered to the
    "always translate X" rules, since those fire on their own rather
    than waiting for a click
*/

function registerTranslateEvents(tab, ctx) {
    const contents = tab.view.webContents;

    contents.on('did-navigate', () => {
        pageTranslator.resetState(contents);

        if (isActive(tab, ctx)) {
            sendToToolbar(ctx, 'translate-badge-state', { translated: false });
        }
    });

    contents.on('did-finish-load', () => {
        pageTranslator.maybeAutoTranslate(contents).then((result) => {
            if (result && result.ok && isActive(tab, ctx)) {
                sendToToolbar(ctx, 'translate-badge-state', { translated: true });
            }
        });
    });
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmailAddress(text) {
    return EMAIL_PATTERN.test(text);
}

function extractMailtoEmail(mailtoUrl) {
    const address = mailtoUrl.replace(/^mailto:/i, '').split('?')[0];

    try {
        return decodeURIComponent(address);
    } catch {
        return address;
    }
}

function truncateForMenu(text, max = 24) {
    return text.length > max ? text.slice(0, max).trimEnd() + '…' : text;
}

/*
    params.x/y are page-relative (the same coordinate space the
    BrowserView itself is drawn in), so turning them into a screen
    point for the popup means adding the window's own screen position
    and — since the view sits below the toolbar, not at the window's
    top edge — the toolbar's live height on top of that
*/

function handleTranslateSelection(ctx, params) {
    if (!ctx || !ctx.window || ctx.window.isDestroyed()) return;

    const text = typeof params.selectionText === 'string' ? params.selectionText.trim() : '';

    if (!text) return;

    const bounds = ctx.window.getContentBounds();

    const screenPoint = {
        x: bounds.x + params.x,

        y: bounds.y + ctx.toolbarHeight + params.y
    };

    const targetLang = translatePrefs.getPrefs().targetLang;

    selectionPopup.showSelectionTranslation(text, screenPoint, ctx.window, targetLang);
}

function buildPageContextMenuTemplate(tab, ctx, params, icons) {
    const contents = tab.view.webContents;

    const pageUrl = params.pageURL || contents.getURL();

    const template = [];

    /*
        Only the single option that applies to whatever was actually
        right-clicked is offered — an image, a video, an audio element,
        a link, an email address, or (falling all the way back) the
        page itself. These are mutually exclusive: a linked image, for
        instance, offers only "Download Image", not both that and
        "Download Link"/"Download Page".
    */

    const isMailtoLink =
        typeof params.linkURL === 'string' && params.linkURL.toLowerCase().startsWith('mailto:');

    const selectionIsEmail =
        typeof params.selectionText === 'string' && isEmailAddress(params.selectionText.trim());

    if (params.mediaType === 'image' && params.srcURL) {
        template.push({
            label: 'Download Image',

            icon: icons.download,

            click: () => contents.session.downloadURL(params.srcURL)
        });
    } else if (params.mediaType === 'video' && params.srcURL) {
        template.push({
            label: 'Download Video',

            icon: icons.download,

            click: () => contents.session.downloadURL(params.srcURL)
        });
    } else if (params.mediaType === 'audio' && params.srcURL) {
        template.push({
            label: 'Download Audio',

            icon: icons.download,

            click: () => contents.session.downloadURL(params.srcURL)
        });
    } else if (isMailtoLink) {
        template.push({
            label: 'Copy Email',

            icon: icons.copy,

            click: () => clipboard.writeText(extractMailtoEmail(params.linkURL))
        });
    } else if (params.linkURL) {
        template.push({
            label: 'Download Link',

            icon: icons.download,

            click: () => contents.session.downloadURL(params.linkURL)
        });
    } else if (selectionIsEmail) {
        template.push({
            label: 'Copy Email',

            icon: icons.copy,

            click: () => clipboard.writeText(params.selectionText.trim())
        });
    } else {
        template.push({
            label: 'Download Page',

            icon: icons.download,

            click: () => contents.session.downloadURL(pageUrl)
        });
    }

    const selectionText =
        typeof params.selectionText === 'string' ? params.selectionText.trim() : '';

    if (selectionText) {
        template.push({
            label: 'Translate "' + truncateForMenu(selectionText) + '"',

            icon: icons.translate,

            click: () => handleTranslateSelection(ctx, params)
        });
    }

    template.push({ type: 'separator' });

    const bookmarked = bookmarkStore.isBookmarked(pageUrl);

    template.push({
        label: bookmarked ? 'Remove from Favourites' : 'Add to Favourites',

        icon: bookmarked ? icons.favouriteFilled : icons.favourite,

        click: () => {
            bookmarkStore.toggleBookmark(pageUrl, contents.getTitle(), tab.favicon);

            broadcastBookmarkState();
        }
    });

    template.push({
        label: 'Group Tabs by Site',

        icon: icons.groupTabs,

        /*
            Purely a display choice the tab strip itself makes — the
            toolbar's own button is asked to make it, rather than this
            menu trying to guess or duplicate that state
        */

        click: () => sendToToolbar(ctx, 'trigger-group-tabs-toggle', null)
    });

    template.push({ type: 'separator' });

    template.push({
        label: 'New Tab',

        icon: icons.newTab,

        click: () => openTab(ctx, getWebsiteUrl())
    });

    template.push({
        label: 'New Window',

        icon: icons.newWindow,

        /*
            Required lazily — see the same lazy require on the toolbar's
            own 'new-window' handler above for why
        */

        click: () => require('../window/windowManager').createMainWindow()
    });

    template.push({ type: 'separator' });

    template.push({
        label: 'Passwords…',

        icon: icons.passwords,

        click: () => openPasswordManager(ctx)
    });

    template.push({ type: 'separator' });

    template.push({
        label: 'Appearance',

        icon: icons.appearance,

        submenu: themeManager.buildThemeMenuTemplate()
    });

    template.push({ type: 'separator' });

    template.push({
        label: 'Home',

        icon: icons.home,

        click: () => goHome(ctx)
    });

    const history = contents.navigationHistory;

    template.push({
        label: 'Back',

        icon: icons.back,

        enabled: history.canGoBack(),

        click: () => history.goBack()
    });

    template.push({
        label: 'Forward',

        icon: icons.forward,

        enabled: history.canGoForward(),

        click: () => history.goForward()
    });

    return template;
}

function registerBrowserEvents() {
    /*
        Raw text from the address bar, which only becomes a URL or a
        search here, so the choice of engine stays out of the toolbar
    */

    ipcMain.removeAllListeners('omnibox-submit');

    ipcMain.on('omnibox-submit', (event, text) => {
        const ctx = contextForSender(event.sender);

        const tab = ctx && ctx.tabs.activeTab();

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

                    broadcastToAllWindows('search-engine-changed', searchEngines.describeActive());
                }
            }))
        );

        menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
    });

    ipcMain.removeAllListeners('go-back');

    ipcMain.on('go-back', (event) => {
        const ctx = contextForSender(event.sender);

        const view = ctx && ctx.tabs.activeView();

        if (!view) return;

        const history = view.webContents.navigationHistory;

        if (history.canGoBack()) {
            history.goBack();
        }
    });

    ipcMain.removeAllListeners('go-forward');

    ipcMain.on('go-forward', (event) => {
        const ctx = contextForSender(event.sender);

        const view = ctx && ctx.tabs.activeView();

        if (!view) return;

        const history = view.webContents.navigationHistory;

        if (history.canGoForward()) {
            history.goForward();
        }
    });

    ipcMain.removeAllListeners('reload');

    ipcMain.on('reload', (event) => {
        const ctx = contextForSender(event.sender);

        const view = ctx && ctx.tabs.activeView();

        if (view) {
            view.webContents.reload();
        }
    });

    /*
        Home is the site picked during setup, which the toolbar does
        not know about, so the URL is resolved here
    */

    ipcMain.removeAllListeners('go-home');

    ipcMain.on('go-home', (event) => {
        goHome(contextForSender(event.sender));
    });

    /*
        The setup window is the only place the homepage can be edited,
        so changing it reopens that window over the running app
    */

    ipcMain.removeAllListeners('show-home-menu');

    ipcMain.on('show-home-menu', (event) => {
        const ctx = contextForSender(event.sender);

        const menu = Menu.buildFromTemplate([
            {
                label: 'Change Homepage…',

                click: () => {
                    createSetupWindow({
                        currentUrl: getWebsiteUrl(),

                        currentPageUrl: currentUrl(ctx),

                        onSaved: (url) => {
                            if (!ctx) return;

                            const view = ctx.tabs.activeView();

                            if (view) {
                                view.webContents.loadURL(url);
                            } else {
                                openTab(ctx, url);
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
    Downloads are one shared list backed by the shared partition's
    session, so — like the ad blocker — these are registered once and
    every window's toolbar is told about changes together
*/

function registerDownloadEvents() {
    ipcMain.removeHandler('get-downloads');

    ipcMain.handle('get-downloads', () => downloadManager.getDownloads());

    ipcMain.removeHandler('open-download');

    ipcMain.handle('open-download', (_, id) => downloadManager.openDownload(id));

    ipcMain.removeAllListeners('show-download-in-folder');

    ipcMain.on('show-download-in-folder', (_, id) => downloadManager.showInFolder(id));

    ipcMain.removeAllListeners('cancel-download');

    ipcMain.on('cancel-download', (_, id) => downloadManager.cancelDownload(id));

    ipcMain.removeAllListeners('pause-download');

    ipcMain.on('pause-download', (_, id) => downloadManager.pauseDownload(id));

    ipcMain.removeAllListeners('resume-download');

    ipcMain.on('resume-download', (_, id) => downloadManager.resumeDownload(id));

    ipcMain.removeAllListeners('retry-download');

    ipcMain.on('retry-download', (_, id) => downloadManager.retryDownload(id));

    ipcMain.removeHandler('remove-download');

    ipcMain.handle('remove-download', (_, id) => {
        downloadManager.removeDownload(id);

        return downloadManager.getDownloads();
    });

    ipcMain.removeHandler('clear-downloads');

    ipcMain.handle('clear-downloads', () => {
        downloadManager.clearDownloads();

        return downloadManager.getDownloads();
    });

    /*
        anchorRect is the button's own on-screen position in its
        window's content coordinates (its getBoundingClientRect), which
        only means anything once it's added to that window's own screen
        position — the popover itself is a separate, borderless window
    */

    ipcMain.removeAllListeners('toggle-downloads-panel');

    ipcMain.on('toggle-downloads-panel', (event, anchorRect) => {
        const win = BrowserWindow.fromWebContents(event.sender);

        if (!win) return;

        const content = win.getContentBounds();

        const anchorBounds = anchorRect
            ? {
                  x: content.x + anchorRect.left,

                  y: content.y + anchorRect.top,

                  width: anchorRect.width,

                  height: anchorRect.height
              }
            : content;

        toggleDownloadsWindow(anchorBounds, win);
    });
}

/*
    The translate popover, unlike the downloads one, acts on a
    particular window's active tab rather than one shared list — so
    opening it has to remember which window asked (translateWindow.js
    holds that as ownerCtx) before any of the handlers below, which are
    reached from the popover's own IPC messages and have no sender to
    resolve a window from, can do anything with it
*/

function registerTranslateIpcEvents() {
    ipcMain.removeAllListeners('toggle-translate-panel');

    ipcMain.on('toggle-translate-panel', (event, anchorRect) => {
        const win = BrowserWindow.fromWebContents(event.sender);

        if (!win) return;

        const ctx = contextForSender(event.sender);

        const content = win.getContentBounds();

        const anchorBounds = anchorRect
            ? {
                  x: content.x + anchorRect.left,

                  y: content.y + anchorRect.top,

                  width: anchorRect.width,

                  height: anchorRect.height
              }
            : content;

        toggleTranslateWindow(anchorBounds, win, ctx);
    });

    ipcMain.removeHandler('get-translate-state');

    ipcMain.handle('get-translate-state', () => {
        const ctx = getTranslatePanelCtx();

        const prefs = translatePrefs.getPrefs();

        const view = ctx && ctx.tabs.activeView();

        const pageState = view
            ? pageTranslator.getState(view.webContents)
            : {
                  translated: false,
                  busy: false,
                  sourceLang: null,
                  targetLang: null,
                  detectedLang: null
              };

        return {
            sourceLanguages: languages.getSourceLanguages(),

            targetLanguages: languages.getTargetLanguages(),

            selectedSource: prefs.sourceLang,

            selectedTarget: prefs.targetLang,

            alwaysTranslate: prefs.alwaysTranslate,

            pageState
        };
    });

    ipcMain.removeHandler('translate-page');

    ipcMain.handle('translate-page', async (_, sourceLang, targetLang) => {
        const ctx = getTranslatePanelCtx();

        const view = ctx && ctx.tabs.activeView();

        if (!view) return { ok: false, error: 'No page to translate' };

        translatePrefs.setLastChoice(sourceLang, targetLang);

        const result = await pageTranslator.translatePage(view.webContents, sourceLang, targetLang);

        if (result.ok) {
            sendToToolbar(ctx, 'translate-badge-state', { translated: true });
        }

        return result;
    });

    ipcMain.removeHandler('restore-translated-page');

    ipcMain.handle('restore-translated-page', async () => {
        const ctx = getTranslatePanelCtx();

        const view = ctx && ctx.tabs.activeView();

        if (!view) return { ok: false, error: 'No page to restore' };

        const result = await pageTranslator.restorePage(view.webContents);

        if (result.ok) {
            sendToToolbar(ctx, 'translate-badge-state', { translated: false });
        }

        return result;
    });

    ipcMain.removeAllListeners('set-translate-choice');

    ipcMain.on('set-translate-choice', (_, sourceLang, targetLang) => {
        translatePrefs.setLastChoice(sourceLang, targetLang);
    });

    ipcMain.removeHandler('set-always-translate');

    ipcMain.handle('set-always-translate', (_, sourceLang, targetLang, enabled) => {
        const prefs = translatePrefs.setAlwaysTranslate(sourceLang, targetLang, enabled);

        return prefs.alwaysTranslate;
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

        if (result && result.ok) {
            await saveAllPendingCaptures();
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

        if (result && result.ok) {
            await saveAllPendingCaptures();
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
    Every window's own pending capture is checked, rather than just
    whichever window happens to be in front, since the vault can be set
    up or unlocked from the Password Manager window while more than one
    browser window has a login waiting on it
*/

async function saveAllPendingCaptures() {
    for (const ctx of windowContexts.values()) {
        if (ctx.pendingLoginCapture) {
            await saveCapturedPassword(ctx);
        }
    }
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

    ipcMain.handle('set-home-to-current', (event) => {
        const senderCtx = contextForSender(event.sender);

        const url = currentUrl(senderCtx);

        if (!isWebUrl(url)) return null;

        setWebsiteUrl(url);

        return url;
    });

    /*
        Tabs
    */

    ipcMain.removeHandler('get-tab-state');

    ipcMain.handle('get-tab-state', (event) => tabState(contextForSender(event.sender)));

    ipcMain.removeAllListeners('new-tab');

    ipcMain.on('new-tab', (event, url) => {
        openTab(contextForSender(event.sender), isWebUrl(url) ? url : getWebsiteUrl());
    });

    ipcMain.removeAllListeners('select-tab');

    ipcMain.on('select-tab', (event, id) => {
        const senderCtx = contextForSender(event.sender);

        if (senderCtx) senderCtx.tabs.selectTab(id);
    });

    ipcMain.removeAllListeners('close-tab');

    ipcMain.on('close-tab', (event, id) => {
        closeTab(contextForSender(event.sender), id);
    });

    ipcMain.removeAllListeners('move-tab');

    ipcMain.on('move-tab', (event, id, toIndex) => {
        const senderCtx = contextForSender(event.sender);

        if (senderCtx) senderCtx.tabs.moveTab(id, toIndex);
    });

    /*
        A brand new, independent WebDesk window — its own tab strip,
        its own navigation — sharing only what a browser's windows
        always share within one profile: bookmarks, saved passwords,
        the ad blocker's rules, and download history
    */

    ipcMain.removeAllListeners('new-window');

    ipcMain.on('new-window', () => {
        /*
            Required lazily: windowManager requires this file to build
            the main window, so requiring it back at the top of this
            file would hand each module the other's unfinished exports
        */

        require('../window/windowManager').createMainWindow();
    });

    /*
        The same thing the green button does: fill the screen, and give
        the previous size back on the way out
    */

    ipcMain.removeHandler('toggle-maximise');

    ipcMain.handle('toggle-maximise', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);

        if (!win) return false;

        if (win.isMaximized()) {
            win.unmaximize();
        } else {
            win.maximize();
        }

        return win.isMaximized();
    });

    ipcMain.removeHandler('is-maximised');

    ipcMain.handle('is-maximised', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);

        return win ? win.isMaximized() : false;
    });

    /*
        The title bar can maximise the window too, so the toolbar is
        told rather than left to guess from its own clicks
    */

    window.removeAllListeners('maximize');

    window.removeAllListeners('unmaximize');

    window.on('maximize', () => window.webContents.send('maximise-changed', true));

    window.on('unmaximize', () => window.webContents.send('maximise-changed', false));

    ipcMain.removeHandler('get-shield-state');

    ipcMain.handle('get-shield-state', (event) => shieldState(contextForSender(event.sender)));

    /*
        Turns blocking off for the site in view, and back on again, so a
        page the blocker breaks is one click away from working
    */

    ipcMain.removeHandler('toggle-shield-for-site');

    ipcMain.handle('toggle-shield-for-site', (event) => {
        const senderCtx = contextForSender(event.sender);

        const view = senderCtx && senderCtx.tabs.activeView();

        if (!view) return shieldState(senderCtx);

        const url = view.webContents.getURL();

        adblockStore.toggleAllowlist(url);

        adblocker.applyForUrl(url);

        view.webContents.reload();

        return shieldState(senderCtx);
    });
    ipcMain.removeHandler('get-bookmark-state');

    ipcMain.handle('get-bookmark-state', (event) => bookmarkState(contextForSender(event.sender)));

    ipcMain.removeHandler('toggle-bookmark');

    ipcMain.handle('toggle-bookmark', (event) => {
        const senderCtx = contextForSender(event.sender);

        const tab = senderCtx && senderCtx.tabs.activeTab();

        if (tab) {
            bookmarkStore.toggleBookmark(
                tab.view.webContents.getURL(),
                tab.view.webContents.getTitle(),
                tab.favicon
            );
        }

        broadcastBookmarkState();

        return bookmarkState(senderCtx);
    });

    ipcMain.removeHandler('rename-bookmark');

    ipcMain.handle('rename-bookmark', (event, url, title) => {
        bookmarkStore.renameBookmark(url, title);

        broadcastBookmarkState();

        return bookmarkState(contextForSender(event.sender));
    });

    ipcMain.removeHandler('move-bookmark');

    ipcMain.handle('move-bookmark', (event, url, toIndex) => {
        bookmarkStore.moveBookmark(url, toIndex);

        broadcastBookmarkState();

        return bookmarkState(contextForSender(event.sender));
    });

    ipcMain.removeHandler('set-bookmark-bar-visible');

    ipcMain.handle('set-bookmark-bar-visible', (event, visible) => {
        bookmarkStore.setBarVisible(visible);

        broadcastBookmarkState();

        return bookmarkState(contextForSender(event.sender));
    });

    ipcMain.removeAllListeners('open-bookmark');

    ipcMain.on('open-bookmark', (event, url, options) => {
        const senderCtx = contextForSender(event.sender);

        if (senderCtx) openBookmark(senderCtx, url, options);
    });

    /*
        A menu drawn inside the toolbar page would be covered by the
        view sitting on top of it, so the context menu is a native one
        owned by the main process
    */

    ipcMain.removeAllListeners('show-bookmark-menu');

    ipcMain.on('show-bookmark-menu', (event, url) => {
        const senderCtx = contextForSender(event.sender);

        const menu = Menu.buildFromTemplate([
            {
                label: 'Open',

                click: () => senderCtx && openBookmark(senderCtx, url)
            },

            {
                label: 'Open in New Tab',

                click: () => senderCtx && openBookmark(senderCtx, url, { newTab: true })
            },

            { type: 'separator' },

            {
                label: 'Rename…',

                /*
                    Renaming needs a text field, which a native menu
                    cannot host, so the toolbar edits the name in place
                */

                click: () => senderCtx && sendToToolbar(senderCtx, 'bookmark-rename', url)
            },

            {
                label: 'Delete',

                click: () => {
                    bookmarkStore.removeBookmark(url);

                    broadcastBookmarkState();
                }
            }
        ]);

        menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
    });

    ipcMain.removeAllListeners('open-password-manager');

    ipcMain.on('open-password-manager', (event) => {
        openPasswordManager(contextForSender(event.sender));
    });

    ipcMain.removeAllListeners('login-detected');

    ipcMain.on('login-detected', (event, payload) => {
        const tabCtx = contextForTabContents(event.sender);

        const active = tabCtx && tabCtx.tabs.activeTab();

        if (!active || active.view.webContents !== event.sender) return;

        handleLoginDetected(payload, tabCtx);
    });

    ipcMain.removeHandler('save-captured-password');

    ipcMain.handle('save-captured-password', (event) =>
        saveCapturedPassword(contextForSender(event.sender))
    );

    ipcMain.removeAllListeners('dismiss-save-password-prompt');

    ipcMain.on('dismiss-save-password-prompt', (event) => {
        clearSavePasswordPrompt(contextForSender(event.sender));
    });

    /*
        In-page suggestion dropdown: each tab's own preload asks for
        matches and fills a selection directly, identified by its own
        webContents (event.sender) rather than by a claimed origin —
        the real origin always comes from that tab's own current URL
    */

    ipcMain.removeHandler('autofill-lookup');

    ipcMain.handle('autofill-lookup', async (event) => {
        const tabCtx = contextForTabContents(event.sender);

        const tab = tabCtx && tabCtx.tabs.findTabByWebContents(event.sender);

        if (!tab) return [];

        const url = tab.view.webContents.getURL();

        if (!isWebUrl(url)) return [];

        const credentials = await credentialStore.findCredentials(url);

        return credentials.map(({ username }) => ({ username }));
    });

    ipcMain.removeAllListeners('autofill-fill');

    ipcMain.on('autofill-fill', async (event, payload) => {
        const tabCtx = contextForTabContents(event.sender);

        const tab = tabCtx && tabCtx.tabs.findTabByWebContents(event.sender);

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
        const tabCtx = contextForTabContents(event.sender);

        const tab = tabCtx && tabCtx.tabs.findTabByWebContents(event.sender);

        if (!tab) return;

        const username = payload && typeof payload.username === 'string' ? payload.username : '';

        if (!username) return;

        const url = tab.view.webContents.getURL();

        if (!isWebUrl(url)) return;

        credentialStore.hideSuggestion(url, username);
    });

    ipcMain.removeAllListeners('set-toolbar-height');

    ipcMain.on('set-toolbar-height', (event, height) => {
        const senderCtx = contextForSender(event.sender);

        if (!senderCtx) return;

        const requested = Number(height);

        if (!Number.isFinite(requested)) return;

        senderCtx.toolbarHeight = Math.max(TOOLBAR_HEIGHT, Math.round(requested));

        resizeBrowserView(senderCtx);
    });
}

/*
    The application menu is removed, so these shortcuts are caught off
    the key events of both the toolbar and the pages inside the tabs
*/

function registerShortcuts(contents, ctx) {
    contents.on('before-input-event', (event, input) => handleShortcut(event, input, ctx));
}

function handleShortcut(event, input, ctx) {
    if (input.type !== 'keyDown') return;

    /*
        The selection-translate popup does not always hold OS focus (a
        right-click menu selection does not necessarily hand focus to
        the popup it opens), so a keypress that lands on the toolbar or
        the page instead of the popup itself still has to close it —
        this is what makes that half of "any key closes it" true
        regardless of where focus actually is
    */

    if (selectionPopup.isSelectionPopupOpen()) {
        selectionPopup.closeSelectionPopup();
    }

    const key = String(input.key).toLowerCase();

    /*
        Ctrl+Tab cycles on every platform, including macOS, where the
        rest of the tab shortcuts are Cmd-based
    */

    if (input.control && key === 'tab') {
        event.preventDefault();

        ctx.tabs.cycle(input.shift ? -1 : 1);

        return;
    }

    const modifier = process.platform === 'darwin' ? input.meta : input.control;

    if (!modifier) return;

    if (input.shift) {
        if (key === 'b') {
            event.preventDefault();

            bookmarkStore.setBarVisible(!bookmarkStore.isBarVisible());

            broadcastBookmarkState();
        }

        return;
    }

    /*
        Cmd+N for a new window, the way Chrome reserves Cmd+T for a tab
    */

    if (key === 'n') {
        event.preventDefault();

        require('../window/windowManager').createMainWindow();

        return;
    }

    if (key === 't') {
        event.preventDefault();

        openTab(ctx, getWebsiteUrl());

        return;
    }

    if (key === 'w') {
        event.preventDefault();

        closeTab(ctx, ctx.tabs.getActiveId());

        return;
    }

    if (/^[1-9]$/.test(key)) {
        event.preventDefault();

        ctx.tabs.selectByPosition(Number(key));
    }
}

function openTab(ctx, url, options = {}) {
    if (!ctx) return null;

    return ctx.tabs.createTab(isWebUrl(url) ? url : getWebsiteUrl() || 'about:blank', options);
}

/*
    Closing the last tab would leave a toolbar driving nothing, and this
    window is the app, so a fresh homepage tab takes its place rather
    than the window going away underneath the user
*/

function closeTab(ctx, id) {
    if (!ctx || id === null || id === undefined) return;

    if (ctx.tabs.closeTab(id) !== 0) return;

    /*
        A second (or third…) window closing its last tab should close
        itself, the way a Chrome window does — there is still another
        window to land on. Only the one window left standing falls back
        to a fresh homepage tab instead, since closing it here would
        quit the whole app out from under whoever's using it.

        Deferred a tick rather than closed inline: this runs from
        inside the very keyboard/menu handler that belongs to the
        window being closed, and letting that call finish unwinding
        first is safer than tearing the window down out from under it.
    */

    if (windowContexts.size > 1 && ctx.window && !ctx.window.isDestroyed()) {
        const win = ctx.window;

        setImmediate(() => {
            if (!win.isDestroyed()) {
                win.close();
            }
        });

        return;
    }

    openTab(ctx, getWebsiteUrl());
}

/*
    Home is the site picked during setup, which the page's own context
    menu — like the toolbar's home button before it — does not know
    about, so the URL is resolved here rather than passed in
*/

function goHome(ctx) {
    const view = ctx && ctx.tabs.activeView();

    const websiteUrl = getWebsiteUrl();

    if (view && websiteUrl) {
        view.webContents.loadURL(websiteUrl);
    }
}

function openPasswordManager(ctx) {
    const tab = ctx && ctx.tabs.activeTab();

    createPasswordWindow({
        currentPageUrl: tab ? tab.view.webContents.getURL() : '',

        currentPageTitle: tab ? tab.view.webContents.getTitle() : '',

        parentWindow: ctx ? ctx.window : null
    });
}

function indexAfter(ctx, id) {
    const list = ctx.tabs.getTabs();

    const index = list.findIndex((tab) => tab.id === id);

    return index === -1 ? list.length : index + 1;
}

function isActive(tab, ctx) {
    return Boolean(ctx) && tab.id === ctx.tabs.getActiveId();
}

function currentUrl(ctx) {
    const view = ctx && ctx.tabs.activeView();

    return view ? view.webContents.getURL() : '';
}

function isSameUrl(a, b) {
    try {
        return new URL(a).href === new URL(b).href;
    } catch {
        return a === b;
    }
}

function hostnameFromUrl(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return String(url || '').trim();
    }
}

function clearSavePasswordPrompt(ctx) {
    if (!ctx) return;

    if (ctx.savePasswordPromptTimer) {
        clearTimeout(ctx.savePasswordPromptTimer);

        ctx.savePasswordPromptTimer = null;
    }

    ctx.pendingLoginCapture = null;

    sendToToolbar(ctx, 'save-password-prompt', null);
}

function hideSavePasswordPrompt(ctx) {
    if (!ctx) return;

    if (ctx.savePasswordPromptTimer) {
        clearTimeout(ctx.savePasswordPromptTimer);

        ctx.savePasswordPromptTimer = null;
    }

    sendToToolbar(ctx, 'save-password-prompt', null);
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

function handleLoginDetected(payload, ctx) {
    if (!ctx) return;

    if (!payload || typeof payload.password !== 'string' || !payload.password) {
        return;
    }

    const url = String(payload.url || currentUrl(ctx)).trim();

    if (!isWebUrl(url)) {
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
        return;
    }

    ctx.pendingLoginCapture = capture;

    if (ctx.savePasswordPromptTimer) {
        clearTimeout(ctx.savePasswordPromptTimer);
    }

    sendToToolbar(ctx, 'save-password-prompt', {
        kind: 'save',
        hostname: hostnameFromUrl(url),
        username,
        updating: hasExisting,
        seconds: 10
    });

    ctx.savePasswordPromptTimer = setTimeout(() => {
        clearSavePasswordPrompt(ctx);
    }, 10000);
}

async function saveCapturedPassword(ctx) {
    if (!ctx || !ctx.pendingLoginCapture) {
        return { ok: false, error: 'No login details to save' };
    }

    const capture = ctx.pendingLoginCapture;

    if (!passwordStore.isVaultSetup()) {
        return { ok: false, error: 'Set up your password vault first', needsSetup: true };
    }

    if (!passwordStore.isUnlocked()) {
        hideSavePasswordPrompt(ctx);

        return { ok: true, queued: true, needsUnlock: true };
    }

    const result = await credentialStore.saveCredential({
        origin: capture.url,
        username: capture.username,
        password: capture.password
    });

    if (!result || !result.ok) {
        clearSavePasswordPrompt(ctx);

        return result;
    }

    const vaultResult = passwordStore.saveCapturedLogin(capture);

    clearSavePasswordPrompt(ctx);

    return vaultResult.ok ? { ok: true, id: result.id } : vaultResult;
}

function openBookmark(ctx, url, options = {}) {
    if (!bookmarkStore.isValidUrl(url)) return;

    const view = ctx.tabs.activeView();

    if (options.newTab || !view) {
        openTab(ctx, url, { background: Boolean(options.background) });

        return;
    }

    view.webContents.loadURL(url);
}

function shieldState(ctx) {
    const url = currentUrl(ctx);

    return {
        ready: adblocker.isReady(),

        status: adblocker.getStatus(),

        blocking: adblocker.isBlockingNow(),

        allowlisted: adblockStore.isAllowlisted(url),

        blocked: adblocker.getBlockedCount(),

        host: adblockStore.hostnameOf(url)
    };
}

function bookmarkState(ctx) {
    const url = currentUrl(ctx);

    return {
        bookmarks: bookmarkStore.getBookmarks(),

        bookmarked: bookmarkStore.isBookmarked(url),

        barVisible: bookmarkStore.isBarVisible()
    };
}

function tabState(ctx) {
    if (!ctx) return { tabs: [], activeId: null };

    return {
        tabs: ctx.tabs.getTabs(),

        activeId: ctx.tabs.getActiveId()
    };
}

function sendToToolbar(ctx, channel, data) {
    if (!ctx || !ctx.window || ctx.window.isDestroyed()) return;

    ctx.window.webContents.send(channel, data);
}

function viewBounds(ctx) {
    if (!ctx || !ctx.window || ctx.window.isDestroyed()) return null;

    const bounds = ctx.window.getContentBounds();

    return {
        x: 0,

        y: ctx.toolbarHeight,

        width: bounds.width,

        height: Math.max(0, bounds.height - ctx.toolbarHeight)
    };
}

function resizeBrowserView(ctx) {
    if (!ctx) return;

    ctx.tabs.applyBounds();
}

function attachResizeHandler(window) {
    window.on('resize', () => {
        resizeBrowserView(windowContexts.get(window.webContents.id));
    });

    /*
        Entering kiosk for focus mode resizes the window through a path
        that does not always report as an ordinary resize
    */

    window.on('enter-full-screen', () => {
        resizeBrowserView(windowContexts.get(window.webContents.id));
    });

    window.on('leave-full-screen', () => {
        resizeBrowserView(windowContexts.get(window.webContents.id));
    });
}

module.exports = {
    createBrowserView,
    attachResizeHandler,
    registerPasswordVaultEvents
};
