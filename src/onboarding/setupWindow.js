const { BrowserWindow, ipcMain } = require('electron');

const path = require('path');

const { setWebsiteUrl } = require('../config/appConfig');

const passwordStore = require('../passwords/passwordStore');

const { isWebUrl } = require('../shared/url');

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

    /*
        Offered here too, not just from the Password Manager's own
        link, so a first-time user can protect the vault with a master
        password in the same breath as picking a site — but only when
        there is a choice to make. A vault with no master password
        chosen yet needs no setup step at all, and one that is already
        protected has nothing to offer here without an unlock step
        this window doesn't have.
    */

    const vaultSetupNeeded = !passwordStore.isVaultProtected();

    setupWindow = new BrowserWindow({
        width: 420,

        /*
            Sized to the content, which is one row taller when there is
            an open page to offer, and taller again when the vault
            section is showing
        */

        height: (currentPageUrl ? 267 : 245) + (vaultSetupNeeded ? 210 : 0),

        minHeight: currentPageUrl ? 267 : 245,

        title: currentUrl ? 'Change Homepage' : 'WebDesk Setup',

        resizable: true,

        center: true,

        show: true,

        /*
            Translucent panel material, matching the Password Manager's
            dialog treatment rather than a flat opaque one
        */

        vibrancy: 'popover',

        webPreferences: {
            preload: path.join(__dirname, 'setupPreload.js'),

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

    ipcMain.handle('get-setup-config', () => ({
        currentUrl,
        currentPageUrl,
        vaultProtected: passwordStore.isVaultProtected()
    }));

    ipcMain.removeAllListeners('save-url');

    ipcMain.on('save-url', (_, url) => {
        /*
            setup.html already checks this before ever sending it — kept
            here too so the site WebDesk is pinned to can never end up
            being something other than a plain http/https address,
            regardless of what sends this message
        */

        if (!isWebUrl(url)) return;

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
