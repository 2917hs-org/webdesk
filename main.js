const { app } = require('electron');

const { createMainWindow } = require('./src/window/windowManager');

const { initTheme, registerThemeEvents } = require('./src/theme/themeManager');

const { registerPasswordVaultEvents } = require('./src/browser/browserManager');

app.whenReady().then(() => {
    initTheme();

    registerThemeEvents();

    /*
        Ahead of either window path below, since the setup window (shown
        on a first launch, before the main window and its BrowserView
        exist) also needs the vault handlers
    */

    registerPasswordVaultEvents();

    createMainWindow();
});

app.on('window-all-closed', () => {
    app.quit();
});
