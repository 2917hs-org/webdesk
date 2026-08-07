const { BrowserWindow, Menu } = require('electron');

const path = require('path');

const { createBrowserView, attachResizeHandler } = require('../browser/browserManager');

const { getWebsiteUrl } = require('../config/appConfig');

const { createSetupWindow } = require('../onboarding/setupWindow');

const store = require('../storage/settingsStore');

function createMainWindow() {
    const websiteUrl = getWebsiteUrl();

    /*
        First launch:
        No URL configured
        Open setup window
    */

    if (!websiteUrl) {
        createSetupWindow({
            onSaved: () => {
                createMainWindow();
            }
        });

        return;
    }

    const windowState = store.get('window', {
        width: 1400,
        height: 900
    });

    const mainWindow = new BrowserWindow({
        width: windowState.width,

        height: windowState.height,

        title: 'WebDesk',

        show: false,

        /*
            The native title bar is dropped in favour of merging the
            traffic lights into our own tab row, the way Safari and Arc
            do, rather than stacking a second row of chrome underneath
            a full OS title bar
        */

        titleBarStyle: 'hiddenInset',

        trafficLightPosition: { x: 12, y: 12 },

        /*
            Translucent header material so the merged title/tab row
            reads as native macOS chrome instead of a flat panel
        */

        vibrancy: 'header',

        webPreferences: {
            preload: path.join(__dirname, '../../preload.js'),

            contextIsolation: true,

            nodeIntegration: false,

            sandbox: true
        }
    });

    Menu.setApplicationMenu(null);

    /*
        Load toolbar shell
    */

    mainWindow.loadFile(path.join(__dirname, '../toolbar/toolbar.html'));

    /*
        TEMPORARY: forwards the toolbar page's own console.log calls into
        this terminal, so renderer-side debug output shows up alongside
        the main process's without needing DevTools open. Remove once
        the save-password investigation is done.
    */

    mainWindow.webContents.on('console-message', (event, level, message) => {
        console.log('[toolbar-console]', message);
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    /*
        Attach Chromium BrowserView
    */

    createBrowserView(mainWindow);

    attachResizeHandler(mainWindow);

    /*
        Save window size
    */

    mainWindow.on('resize', () => {
        const bounds = mainWindow.getBounds();

        store.set('window', {
            width: bounds.width,

            height: bounds.height
        });
    });

    return mainWindow;
}

module.exports = {
    createMainWindow
};
