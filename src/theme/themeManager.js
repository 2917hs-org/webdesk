const { nativeTheme, ipcMain, Menu, BrowserWindow } = require('electron');

const store = require('../storage/settingsStore');

/*
    Mirrors macOS's own Appearance setting: follow the system, or pin to
    one. Persisted so the choice survives a restart the same way the
    window size and search engine do.
*/

const THEME_LABELS = {
    system: 'Follow System',

    light: 'Light',

    dark: 'Dark'
};

function currentTheme() {
    return nativeTheme.themeSource;
}

function setTheme(theme) {
    if (!THEME_LABELS[theme]) return;

    nativeTheme.themeSource = theme;

    store.set('themeSource', theme);
}

function broadcastTheme() {
    const theme = currentTheme();

    BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
            window.webContents.send('theme-changed', theme);
        }
    });
}

/*
    Called once at startup, before any window is created, so the first
    paint already uses the stored choice rather than flashing the
    system default first
*/

function initTheme() {
    const stored = store.get('themeSource', 'system');

    nativeTheme.themeSource = THEME_LABELS[stored] ? stored : 'system';

    /*
        Fires both when the source above changes and when the OS
        appearance itself changes while the source is "system" — one
        listener covers a manual pick and a system-level switch alike
    */

    nativeTheme.on('updated', broadcastTheme);
}

function registerThemeEvents() {
    ipcMain.removeHandler('get-theme-source');

    ipcMain.handle('get-theme-source', () => currentTheme());

    ipcMain.removeAllListeners('show-theme-menu');

    ipcMain.on('show-theme-menu', (event) => {
        const active = currentTheme();

        const menu = Menu.buildFromTemplate(
            Object.keys(THEME_LABELS).map((key) => ({
                label: THEME_LABELS[key],

                type: 'radio',

                checked: key === active,

                click: () => setTheme(key)
            }))
        );

        menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
    });
}

module.exports = {
    initTheme,
    registerThemeEvents,
    currentTheme
};
