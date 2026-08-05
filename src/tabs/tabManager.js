const { BrowserView, session } = require('electron');

/*
    Holds one view per tab and decides which of them the window is
    showing. What a page then does — where it navigates, what it blocks,
    what the toolbar is told about it — stays in the browser manager, so
    this file is only the set of views, their order, and their titles.
*/

/*
    Every tab shares one partition, so a login in one tab is a login in
    all of them, and the blocker only has a single session to watch
*/

const PARTITION = 'persist:webdesk';

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

function init(window, options = {}) {
    hostWindow = window;

    tabs = [];

    activeId = null;

    onViewCreated = typeof options.onViewCreated === 'function' ? options.onViewCreated : () => {};

    onActivate = typeof options.onActivate === 'function' ? options.onActivate : () => {};

    onChange = typeof options.onChange === 'function' ? options.onChange : () => {};

    boundsFor = typeof options.bounds === 'function' ? options.bounds : () => null;

    window.on('closed', () => {
        tabs = [];

        activeId = null;

        hostWindow = null;
    });
}

function getSession() {
    return session.fromPartition(PARTITION);
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

    return tab && !tab.view.webContents.isDestroyed() ? tab.view : null;
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

        active: tab.id === activeId
    };
}

function getTabs() {
    return tabs.map(describe);
}

function createTab(url, options = {}) {
    if (!isUsable()) return null;

    const view = new BrowserView({
        webPreferences: {
            contextIsolation: true,

            nodeIntegration: false,

            sandbox: true,

            partition: PARTITION
        }
    });

    const tab = {
        id: nextId,

        view,

        title: '',

        url: typeof url === 'string' ? url : '',

        favicon: '',

        loading: false,

        /*
            What this tab's address bar last sent somewhere as a URL,
            kept per tab so a guess that turns out not to resolve is
            searched for in the tab that made it
        */

        pendingOmniboxGuess: null
    };

    nextId += 1;

    const at = Number.isInteger(options.atIndex)
        ? Math.max(0, Math.min(tabs.length, options.atIndex))
        : tabs.length;

    tabs.splice(at, 0, tab);

    /*
        Wired before the page starts loading, so nothing that happens on
        the way to the first paint is missed
    */

    onViewCreated(tab);

    /*
        A tab opened behind the current one is never attached, and so
        would lay itself out against a zero-sized window until the first
        time it is looked at
    */

    const bounds = boundsFor();

    if (bounds) {
        view.setBounds(bounds);
    }

    if (url) {
        view.webContents.loadURL(url);
    }

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

    hostWindow.setBrowserView(tab.view);

    applyBounds();

    if (!tab.view.webContents.isDestroyed()) {
        tab.view.webContents.focus();
    }

    onActivate(tab);

    onChange();

    return tab;
}

function destroyView(view) {
    if (isUsable()) {
        hostWindow.removeBrowserView(view);
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
    bounds can be wrong
*/

function applyBounds() {
    const bounds = boundsFor();

    const tab = activeTab();

    if (!bounds || !tab || tab.view.webContents.isDestroyed()) return;

    tab.view.setBounds(bounds);
}

module.exports = {
    init,
    getSession,
    createTab,
    closeTab,
    selectTab,
    moveTab,
    cycle,
    selectByPosition,
    applyBounds,
    activeTab,
    activeView,
    getActiveId,
    getTabs
};
