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
