const { BrowserWindow, ipcMain } = require('electron');

const path = require('path');

const { setWebsiteUrl } = require('../config/appConfig');

/*
    Opened empty on first launch, and again later to change the site the
    app is pinned to. Only one may be open at a time, so the handlers
    below always belong to the window currently on screen.
*/

let setupWindow = null;

function createSetupWindow(options) {
    const currentUrl = (options && options.currentUrl) || '';

    /*
        Page the app is sitting on, offered as a one-click alternative
        to typing a URL out. Absent on first launch, when nothing is
        open yet.
    */

    const currentPageUrl = (options && options.currentPageUrl) || '';

    const onSaved = (options && options.onSaved) || (() => {});

    if (setupWindow) {
        setupWindow.focus();

        return setupWindow;
    }

    setupWindow = new BrowserWindow({
        width: 420,

        /*
            Sized to the content, which is one row taller when there is
            an open page to offer
        */

        height: currentPageUrl ? 267 : 245,

        title: currentUrl ? 'Change Homepage' : 'WebDesk Setup',

        resizable: false,

        center: true,

        show: true,

        webPreferences: {
            preload: path.join(__dirname, '../../preload.js'),

            contextIsolation: true,

            nodeIntegration: false,

            sandbox: true
        }
    });

    setupWindow.loadFile(path.join(__dirname, 'setup.html'));

    /*
        Tells the page whether it is introducing the app or editing a
        site that is already configured
    */

    ipcMain.removeHandler('get-setup-config');

    ipcMain.handle('get-setup-config', () => ({ currentUrl, currentPageUrl }));

    ipcMain.removeAllListeners('save-url');

    ipcMain.on('save-url', (_, url) => {
        setWebsiteUrl(url);

        setupWindow.close();

        onSaved(url);
    });

    /*
        Cleared on close rather than after a save, so abandoning the
        window does not leave its handlers behind
    */

    setupWindow.on('closed', () => {
        ipcMain.removeAllListeners('save-url');

        ipcMain.removeHandler('get-setup-config');

        setupWindow = null;
    });

    return setupWindow;
}

module.exports = {
    createSetupWindow
};
