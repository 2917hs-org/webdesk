const { BrowserWindow } = require('electron');

const path = require('path');

const passwordStore = require('./passwordStore');

/*
    Opened from the toolbar to manage saved passwords. Only one may be
    open at a time, matching how the setup window is handled.
*/

let passwordWindow = null;

function createPasswordWindow(options) {
    const currentPageUrl = (options && options.currentPageUrl) || '';

    const currentPageTitle = (options && options.currentPageTitle) || '';

    const parentWindow = options && options.parentWindow;

    if (passwordWindow) {
        passwordWindow.focus();

        return passwordWindow;
    }

    const hasParent = parentWindow && !parentWindow.isDestroyed();

    passwordWindow = new BrowserWindow({
        width: 600,

        height: 560,

        minWidth: 520,

        minHeight: 420,

        title: 'Passwords',

        center: true,

        show: true,

        /*
            Blocks the main window while passwords are open, the way a
            dialog does, rather than leaving it clickable underneath
        */

        parent: hasParent ? parentWindow : undefined,

        modal: hasParent,

        /*
            Translucent panel material, matching a native macOS dialog
            rather than a flat opaque one
        */

        vibrancy: 'popover',

        webPreferences: {
            preload: path.join(__dirname, '../../preload.js'),

            contextIsolation: true,

            nodeIntegration: false,

            sandbox: true
        }
    });

    passwordWindow.loadFile(path.join(__dirname, 'passwords.html'));

    /*
        Being modal, this window has no other window to fall back to
        closing it from — Escape has to do that job itself
    */

    passwordWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || input.key !== 'Escape') return;

        if (!passwordWindow || passwordWindow.isDestroyed()) return;

        passwordWindow.close();
    });

    passwordWindow.webContents.on('did-finish-load', () => {
        if (!passwordWindow || passwordWindow.isDestroyed()) return;

        passwordWindow.webContents.send('password-config', {
            currentPageUrl,
            currentPageTitle
        });
    });

    passwordWindow.on('closed', () => {
        passwordWindow = null;
    });

    return passwordWindow;
}

function getPasswordWindow() {
    return passwordWindow;
}

module.exports = {
    createPasswordWindow,
    getPasswordWindow
};
