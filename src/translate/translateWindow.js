const { BrowserWindow, screen } = require('electron');

const path = require('path');

/*
    Same small-popover pattern as downloadsWindow.js — a borderless
    window anchored under the toolbar button rather than anything drawn
    inline, for the same reason: the toolbar page has no room below it
    to unfold a panel into, since the page view sits on top of
    everything past the visible toolbar strip.
*/

const WIDTH = 300;

const HEIGHT = 210;

let translateWindow = null;

/*
    Which window's active tab this popover is acting on. Every IPC
    message the popover sends (translate this page, restore it, read
    its current state) arrives tagged with the popover's own
    webContents as the sender — never the browser window the button
    lives in — so browserManager.js has no way to resolve a tab from
    the sender alone the way it does for the toolbar's own messages.
    This is that missing link, set once when the popover opens and
    handed back to whoever asks.
*/

let ownerCtx = null;

let closedAt = 0;

function clampToDisplay(x, y, anchorPoint) {
    const display = screen.getDisplayNearestPoint(anchorPoint);

    const area = display.workArea;

    return {
        x: Math.round(Math.max(area.x + 4, Math.min(x, area.x + area.width - WIDTH - 4))),

        y: Math.round(Math.max(area.y + 4, Math.min(y, area.y + area.height - HEIGHT - 4)))
    };
}

function createTranslateWindow(anchorBounds, parentWindow, ctx) {
    const rawX = anchorBounds ? anchorBounds.x + anchorBounds.width - WIDTH : undefined;

    const rawY = anchorBounds ? anchorBounds.y + anchorBounds.height + 6 : undefined;

    const position = anchorBounds
        ? clampToDisplay(rawX, rawY, { x: anchorBounds.x, y: anchorBounds.y })
        : {};

    const hasParent = parentWindow && !parentWindow.isDestroyed();

    ownerCtx = ctx;

    translateWindow = new BrowserWindow({
        width: WIDTH,

        height: HEIGHT,

        x: position.x,

        y: position.y,

        show: true,

        frame: false,

        resizable: false,

        movable: false,

        minimizable: false,

        maximizable: false,

        fullscreenable: false,

        skipTaskbar: true,

        alwaysOnTop: true,

        roundedCorners: true,

        parent: hasParent ? parentWindow : undefined,

        vibrancy: 'popover',

        webPreferences: {
            preload: path.join(__dirname, 'translatePreload.js'),

            contextIsolation: true,

            nodeIntegration: false,

            sandbox: true
        }
    });

    translateWindow.loadFile(path.join(__dirname, 'translate.html'));

    translateWindow.focus();

    let hasFocused = false;

    translateWindow.on('focus', () => {
        hasFocused = true;
    });

    translateWindow.on('blur', () => {
        if (!hasFocused) return;

        setTimeout(() => {
            if (translateWindow && !translateWindow.isDestroyed() && !translateWindow.isFocused()) {
                translateWindow.close();
            }
        }, 80);
    });

    translateWindow.on('closed', () => {
        translateWindow = null;

        ownerCtx = null;

        closedAt = Date.now();
    });

    return translateWindow;
}

function toggleTranslateWindow(anchorBounds, parentWindow, ctx) {
    if (translateWindow && !translateWindow.isDestroyed()) {
        translateWindow.close();

        return;
    }

    if (Date.now() - closedAt < 250) return;

    createTranslateWindow(anchorBounds, parentWindow, ctx);
}

/*
    null once the popover is closed (or was never opened) — every
    handler that calls this treats that as "nothing to act on" rather
    than falling back to guessing a window
*/

function getOwnerCtx() {
    return translateWindow && !translateWindow.isDestroyed() ? ownerCtx : null;
}

module.exports = {
    toggleTranslateWindow,
    getOwnerCtx
};
