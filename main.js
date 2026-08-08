const { app, dialog } = require('electron');

const { createMainWindow } = require('./src/window/windowManager');

const { initTheme, registerThemeEvents } = require('./src/theme/themeManager');

const { registerPasswordVaultEvents } = require('./src/browser/browserManager');

app.whenReady()
    .then(() => {
        initTheme();

        registerThemeEvents();

        /*
            Ahead of either window path below, since the setup window (shown
            on a first launch, before the main window and its BrowserView
            exist) also needs the vault handlers
        */

        registerPasswordVaultEvents();

        createMainWindow();
    })
    .catch((error) => {
        /*
            Startup only ever gets here for something neither
            clearInvalidConfig nor any other recovery already handled —
            a real bug, not a corrupted file. Shown rather than left to
            fail silently with no window and no explanation.
        */

        dialog.showErrorBox(
            'WebDesk failed to start',
            'WebDesk ran into an unexpected error on launch:\n\n' + error.message
        );

        app.quit();
    });

/*
    Deliberately not the usual "quit only off Windows/Linux, stay alive
    for 'activate' on macOS" pattern most Electron apps use. WebDesk is
    a dedicated container for one site rather than a general browser —
    closing its one window is closing the app, the same as any other
    single-purpose app, not something that should leave it idling in
    the Dock with nothing open. There is accordingly no 'activate'
    handler either, since the app has already quit by the time macOS
    would fire one.
*/

app.on('window-all-closed', () => {
    app.quit();
});
