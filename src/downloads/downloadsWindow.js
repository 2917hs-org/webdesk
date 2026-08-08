const { BrowserWindow, screen } = require('electron');

const path = require('path');

/*
    A small popover, not a full window — the toolbar page it hangs off
    of only has as much vertical room as the visible toolbar strip
    itself (everything below that is the native page view sitting on
    top), so a real download list has nowhere to unfold inline the way
    it could in a normal web page. A tiny borderless window anchored to
    the button stands in for it, closing itself the moment it loses
    focus, the way a native popover does.
*/

const WIDTH = 320;

const HEIGHT = 400;

let downloadsWindow = null;

let closedAt = 0;

function clampToDisplay(x, y, anchorPoint) {
    const display = screen.getDisplayNearestPoint(anchorPoint);

    const area = display.workArea;

    return {
        x: Math.round(Math.max(area.x + 4, Math.min(x, area.x + area.width - WIDTH - 4))),

        y: Math.round(Math.max(area.y + 4, Math.min(y, area.y + area.height - HEIGHT - 4)))
    };
}

function createDownloadsWindow(anchorBounds, parentWindow) {
    const rawX = anchorBounds ? anchorBounds.x + anchorBounds.width - WIDTH : undefined;

    const rawY = anchorBounds ? anchorBounds.y + anchorBounds.height + 6 : undefined;

    const position = anchorBounds
        ? clampToDisplay(rawX, rawY, { x: anchorBounds.x, y: anchorBounds.y })
        : {};

    const hasParent = parentWindow && !parentWindow.isDestroyed();

    downloadsWindow = new BrowserWindow({
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
            preload: path.join(__dirname, 'downloadsPreload.js'),

            contextIsolation: true,

            nodeIntegration: false,

            sandbox: true
        }
    });

    downloadsWindow.loadFile(path.join(__dirname, 'downloads.html'));

    downloadsWindow.focus();

    /*
        A window created with show:true normally focuses itself right
        away, but that first focus is not guaranteed to have landed the
        instant this function returns — closing on a blur that arrives
        before the window was ever actually focused would drop it
        before it was ever seen
    */

    let hasFocused = false;

    downloadsWindow.on('focus', () => {
        hasFocused = true;
    });

    /*
        Closing happens a tick after the blur, so the same click that
        blurs this window (by pressing the toolbar button again) is
        still free to be read as "toggle it shut" rather than racing a
        half-closed window into reopening itself
    */

    downloadsWindow.on('blur', () => {
        if (!hasFocused) return;

        setTimeout(() => {
            if (downloadsWindow && !downloadsWindow.isDestroyed() && !downloadsWindow.isFocused()) {
                downloadsWindow.close();
            }
        }, 80);
    });

    downloadsWindow.on('closed', () => {
        downloadsWindow = null;

        closedAt = Date.now();
    });

    return downloadsWindow;
}

/*
    Pressing the toolbar button while the popover is open should close
    it, not refocus it — and pressing it again right after the blur
    above already closed it should not instantly reopen it
*/

function toggleDownloadsWindow(anchorBounds, parentWindow) {
    if (downloadsWindow && !downloadsWindow.isDestroyed()) {
        downloadsWindow.close();

        return;
    }

    if (Date.now() - closedAt < 250) return;

    createDownloadsWindow(anchorBounds, parentWindow);
}

/*
    The popover is its own top-level window, outside the toolbar
    windows browserManager already knows how to broadcast to — without
    this, pausing, cancelling, or removing a download from here would
    change the list on disk while the panel in front of you kept
    showing the old one until you closed and reopened it
*/

function notifyDownloadsWindow(downloads) {
    if (downloadsWindow && !downloadsWindow.isDestroyed()) {
        downloadsWindow.webContents.send('download-state', downloads);
    }
}

module.exports = {
    toggleDownloadsWindow,
    notifyDownloadsWindow
};
