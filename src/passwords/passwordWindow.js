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

    const pendingCapture = (options && options.pendingCapture) || null;

    if (passwordWindow) {
        passwordWindow.focus();

        return passwordWindow;
    }

    passwordWindow = new BrowserWindow({
        width: 480,

        height: 560,

        minWidth: 400,

        minHeight: 420,

        title: 'Passwords',

        center: true,

        show: true,

        webPreferences: {
            preload: path.join(__dirname, '../../preload.js'),

            contextIsolation: true,

            nodeIntegration: false,

            sandbox: true
        }
    });

    passwordWindow.loadFile(path.join(__dirname, 'passwords.html'));

    passwordWindow.webContents.on('did-finish-load', () => {
        if (!passwordWindow || passwordWindow.isDestroyed()) return;

        passwordWindow.webContents.send('password-config', {
            currentPageUrl,
            currentPageTitle,
            pendingCapture
        });
    });

    passwordWindow.on('closed', () => {
        passwordStore.lockVault();

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
