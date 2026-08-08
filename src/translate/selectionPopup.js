const { BrowserWindow, screen } = require('electron');

const path = require('path');

const translateService = require('./translateService');

const languages = require('./languages');

/*
    The page context menu's "Translate" item opens this instead of the
    toolbar's popover — a small, single-purpose card anchored right at
    the selection rather than a panel of controls, closer to how
    Chrome's own quick-lookup popover behaves than to a settings panel.
    It carries no dropdowns of its own: the target language is whatever
    the toolbar popover last used (see translatePrefs.js), on the
    assumption that a translate-on-the-fly action wants a fast answer
    in the language already established for this session, not a second
    round of choices.
*/

const WIDTH = 300;

const HEIGHT = 172;

let popup = null;

function clampToDisplay(x, y, anchorPoint) {
    const display = screen.getDisplayNearestPoint(anchorPoint);

    const area = display.workArea;

    return {
        x: Math.round(Math.max(area.x + 4, Math.min(x, area.x + area.width - WIDTH - 4))),

        y: Math.round(Math.max(area.y + 4, Math.min(y, area.y + area.height - HEIGHT - 4)))
    };
}

function closeSelectionPopup() {
    if (popup && !popup.isDestroyed()) popup.close();
}

function isSelectionPopupOpen() {
    return Boolean(popup && !popup.isDestroyed());
}

async function showSelectionTranslation(text, screenPoint, parentWindow, targetLang) {
    closeSelectionPopup();

    const position = clampToDisplay(screenPoint.x, screenPoint.y, screenPoint);

    const hasParent = parentWindow && !parentWindow.isDestroyed();

    const thisPopup = new BrowserWindow({
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
            preload: path.join(__dirname, 'selectionPreload.js'),

            contextIsolation: true,

            nodeIntegration: false,

            sandbox: true
        }
    });

    popup = thisPopup;

    thisPopup.loadFile(path.join(__dirname, 'selectionPopup.html'));

    thisPopup.focus();

    /*
        Any subsequent input — a click anywhere, a keypress, whether or
        not it lands on this window — is what dismisses this popup (see
        selectionPopup.html for the in-window half of that, and
        browserManager.js's handleShortcut for the half that closes it
        when a key reaches the page or toolbar instead, since focus is
        not guaranteed to still be here by then). Blur is the fallback
        for a click that lands on the page or toolbar rather than the
        popup itself.
    */

    let hasFocused = false;

    thisPopup.on('focus', () => {
        hasFocused = true;
    });

    thisPopup.on('blur', () => {
        if (!hasFocused) return;

        setTimeout(() => {
            if (!thisPopup.isDestroyed() && !thisPopup.isFocused()) {
                thisPopup.close();
            }
        }, 80);
    });

    thisPopup.on('closed', () => {
        if (popup === thisPopup) popup = null;
    });

    thisPopup.webContents.once('did-finish-load', () => {
        if (!thisPopup.isDestroyed()) {
            thisPopup.webContents.send('selection-init', { text });
        }
    });

    try {
        const result = await translateService.translateOne(text, 'auto', targetLang);

        if (thisPopup.isDestroyed()) return;

        thisPopup.webContents.send('selection-result', {
            ok: true,

            translated: result.translated,

            detectedLangName: languages.nameForCode(result.detectedLang)
        });
    } catch (error) {
        if (thisPopup.isDestroyed()) return;

        thisPopup.webContents.send('selection-result', {
            ok: false,

            error: error.message || 'Translation failed'
        });
    }
}

module.exports = {
    showSelectionTranslation,
    closeSelectionPopup,
    isSelectionPopupOpen
};
