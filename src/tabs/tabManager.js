const { WebContentsView, session } = require('electron');

const path = require('path');

const { isWebUrl } = require('../shared/url');

/*
    Holds one view per tab and decides which of them a window is
    showing. What a page then does — where it navigates, what it blocks,
    what the toolbar is told about it — stays in the browser manager, so
    this file is only the set of views, their order, and their titles.

    Each window gets its own instance (createTabManager()), so a second
    WebDesk window has its own tab strip rather than fighting the first
    one over which view is attached where.
*/

/*
    Every tab, in every window, shares one partition, so a login in one
    tab is a login in all of them and the blocker only has a single
    session to watch — the same way separate windows of one Chrome
    profile still share cookies and extensions
*/

const PARTITION = 'persist:webdesk';

function getSession() {
    return session.fromPartition(PARTITION);
}

function createTabManager() {
    let hostWindow = null;

    let tabs = [];

    let activeId = null;

    /*
        Tabs are addressed by id rather than by position, so a tab the
        toolbar knew about cannot be confused with whatever has since
        moved into its place
    */

    let nextId = 1;

    let onViewCreated = () => {};

    let onActivate = () => {};

    let onChange = () => {};

    let boundsFor = () => null;

    /*
        Whichever tab's view is currently a child of the window's
        contentView. Unlike the old BrowserView API's setBrowserView(),
        WebContentsView has no built-in "only one at a time" behaviour —
        the previous child has to be removed explicitly before the next
        one is added, so this has to be tracked here rather than asked
        of the window.
    */

    let attachedView = null;

    function init(window, options = {}) {
        hostWindow = window;

        tabs = [];

        activeId = null;

        attachedView = null;

        onViewCreated = typeof options.onViewCreated === 'function' ? options.onViewCreated : () => {};

        onActivate = typeof options.onActivate === 'function' ? options.onActivate : () => {};

        onChange = typeof options.onChange === 'function' ? options.onChange : () => {};

        boundsFor = typeof options.bounds === 'function' ? options.bounds : () => null;

        window.on('closed', () => {
            tabs = [];

            activeId = null;

            attachedView = null;

            hostWindow = null;
        });
    }

    function isUsable() {
        return hostWindow !== null && !hostWindow.isDestroyed();
    }

    function findTab(id) {
        return tabs.find((tab) => tab.id === id) || null;
    }

    function indexOfTab(id) {
        return tabs.findIndex((tab) => tab.id === id);
    }

    function activeTab() {
        return findTab(activeId);
    }

    function activeView() {
        const tab = activeTab();

        return tab && tab.view && !tab.view.webContents.isDestroyed() ? tab.view : null;
    }

    /*
        Looks a tab up by its own webContents rather than by id, for IPC
        senders (like a tab's preload) that only have that to identify
        themselves with — and that have no reason to know their own tab id.
        A suspended tab has no webContents to match against, so it is
        simply never found this way until it is restored.
    */

    function findTabByWebContents(webContents) {
        return tabs.find((tab) => tab.view && tab.view.webContents === webContents) || null;
    }

    function getActiveId() {
        return activeId;
    }

    /*
        What the toolbar is allowed to see: no views, only the parts of a
        tab that can cross the IPC boundary
    */

    function describe(tab) {
        return {
            id: tab.id,

            title: tab.title,

            url: tab.url,

            favicon: tab.favicon,

            loading: tab.loading,

            active: tab.id === activeId,

            suspended: tab.suspended
        };
    }

    function getTabs() {
        return tabs.map(describe);
    }

    /*
        Builds this tab's view and wires it up — used both the first time
        a tab is created and again whenever a suspended tab's view has to
        be rebuilt on reselect. Every per-tab listener browserManager.js
        attaches inside onViewCreated() is bound to one specific
        webContents with no way to reattach it elsewhere, so a fresh view
        always needs a fresh onViewCreated() call, not just new content.
    */

    function attachView(tab, url) {
        const view = new WebContentsView({
            webPreferences: {
                preload: path.join(__dirname, '../passwords/loginCapturePreload.js'),

                contextIsolation: true,

                nodeIntegration: false,

                sandbox: true,

                partition: PARTITION
            }
        });

        tab.view = view;

        tab.suspended = false;

        /*
            Wired before the page starts loading, so nothing that happens on
            the way to the first paint is missed
        */

        onViewCreated(tab);

        /*
            A tab that is not the one on screen is never attached, and so
            would lay itself out against a zero-sized window until the
            first time it is looked at
        */

        const bounds = boundsFor();

        if (bounds) {
            view.setBounds(bounds);
        }

        if (url && isWebUrl(url)) {
            view.webContents.loadURL(url);
        }
    }

    function createTab(url, options = {}) {
        if (!isUsable()) return null;

        const tab = {
            id: nextId,

            view: null,

            title: '',

            url: typeof url === 'string' ? url : '',

            favicon: '',

            loading: false,

            /*
                What this tab's address bar last sent somewhere as a URL,
                kept per tab so a guess that turns out not to resolve is
                searched for in the tab that made it
            */

            pendingOmniboxGuess: null,

            /*
                Drives suspension: how long a tab has sat without being the
                one selected, so a background tab idle past the threshold
                can have its renderer freed
            */

            lastActiveAt: Date.now(),

            suspended: false
        };

        nextId += 1;

        const at = Number.isInteger(options.atIndex)
            ? Math.max(0, Math.min(tabs.length, options.atIndex))
            : tabs.length;

        tabs.splice(at, 0, tab);

        attachView(tab, url);

        if (options.background && activeId !== null) {
            onChange();
        } else {
            selectTab(tab.id);
        }

        return tab;
    }

    function selectTab(id) {
        const tab = findTab(id);

        if (!tab || !isUsable()) return null;

        activeId = tab.id;

        tab.lastActiveAt = Date.now();

        /*
            A suspended tab has no view left to attach — rebuild it now,
            the same way a brand new tab would be built, loading whatever
            URL it was last known to be on
        */

        if (!tab.view) {
            attachView(tab, tab.url);
        }

        if (attachedView) {
            hostWindow.contentView.removeChildView(attachedView);
        }

        hostWindow.contentView.addChildView(tab.view);

        attachedView = tab.view;

        applyBounds();

        if (!tab.view.webContents.isDestroyed()) {
            tab.view.webContents.focus();
        }

        onActivate(tab);

        onChange();

        return tab;
    }

    function destroyView(view) {
        if (!view) return;

        if (isUsable() && attachedView === view) {
            hostWindow.contentView.removeChildView(view);

            attachedView = null;
        }

        if (!view.webContents.isDestroyed()) {
            view.webContents.close();
        }
    }

    /*
        Returns how many tabs are left, so closing the last one is the
        caller's decision rather than this file's
    */

    function closeTab(id) {
        const index = indexOfTab(id);

        if (index === -1) return tabs.length;

        const [tab] = tabs.splice(index, 1);

        const wasActive = tab.id === activeId;

        destroyView(tab.view);

        if (tabs.length === 0) {
            activeId = null;

            onChange();

            return 0;
        }

        if (wasActive) {
            /*
                The tab that took its place, or the new last one when the
                tab closed was at the end
            */

            selectTab(tabs[Math.min(index, tabs.length - 1)].id);
        } else {
            onChange();
        }

        return tabs.length;
    }

    /*
        Explicit teardown for every tab at once, used when the whole
        window is going away (see the 'close' handler in
        browserManager.js) rather than one tab being closed by the
        user. Only the active tab's view is ever attached to the
        window, so the others need this to be destroyed at all — left
        alone, they would still be alive when the window itself is
        destroyed. Suspended tabs have nothing left to destroy.
    */

    function destroyAll() {
        for (const tab of tabs) {
            destroyView(tab.view);
        }

        tabs = [];

        activeId = null;
    }

    function moveTab(id, toIndex) {
        const from = indexOfTab(id);

        if (from === -1) return;

        const requested = Number(toIndex);

        if (!Number.isFinite(requested)) return;

        const target = Math.max(0, Math.min(tabs.length - 1, Math.round(requested)));

        if (target === from) return;

        const [moved] = tabs.splice(from, 1);

        tabs.splice(target, 0, moved);

        onChange();
    }

    /*
        Steps through the strip and comes back around at either end, the
        way Ctrl+Tab does in a browser
    */

    function cycle(step) {
        if (tabs.length < 2) return;

        const from = indexOfTab(activeId);

        if (from === -1) return;

        const next = (from + step + tabs.length) % tabs.length;

        selectTab(tabs[next].id);
    }

    /*
        Cmd+9 is the last tab rather than the ninth, which is what browsers
        do and the only way to reach the end of a long strip by number
    */

    function selectByPosition(position) {
        if (tabs.length === 0) return;

        const index = position >= 9 ? tabs.length - 1 : position - 1;

        if (index < 0 || index >= tabs.length) return;

        selectTab(tabs[index].id);
    }

    /*
        Only the attached view is on screen, so it is the only one whose
        bounds can be wrong. A suspended tab has no view to size.
    */

    function applyBounds() {
        const bounds = boundsFor();

        const tab = activeTab();

        if (!bounds || !tab || !tab.view || tab.view.webContents.isDestroyed()) return;

        tab.view.setBounds(bounds);
    }

    /*
        Frees a background tab's renderer to reclaim its memory, keeping
        just enough (title/url/favicon) for the toolbar to keep showing
        it. The active tab is never a candidate — there's nothing to free
        that isn't on screen — and neither is one that's already asleep.
    */

    function suspendTab(id) {
        const tab = findTab(id);

        if (!tab || tab.id === activeId || !tab.view || tab.suspended) return;

        destroyView(tab.view);

        tab.view = null;

        tab.suspended = true;

        tab.loading = false;

        onChange();
    }

    /*
        Tabs eligible to be suspended right now: not the active tab,
        not already asleep, idle longer than idleMs, and not currently
        playing audio or video — silently killing a background podcast
        or call would be a worse outcome than the memory it saves.
    */

    function getSuspendCandidates(idleMs) {
        const now = Date.now();

        return tabs
            .filter((tab) => {
                if (tab.suspended || tab.id === activeId || !tab.view) return false;

                if (now - tab.lastActiveAt < idleMs) return false;

                const contents = tab.view.webContents;

                if (!contents.isDestroyed() && contents.isCurrentlyAudible()) return false;

                return true;
            })
            .map((tab) => tab.id);
    }

    return {
        init,
        getSession,
        createTab,
        closeTab,
        destroyAll,
        selectTab,
        moveTab,
        cycle,
        selectByPosition,
        applyBounds,
        activeTab,
        activeView,
        findTabByWebContents,
        getActiveId,
        getTabs,
        suspendTab,
        getSuspendCandidates
    };
}

module.exports = {
    createTabManager,
    getSession
};
