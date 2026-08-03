const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
    navigate(url) {
        ipcRenderer.send('navigate', url);
    },

    back() {
        ipcRenderer.send('go-back');
    },

    forward() {
        ipcRenderer.send('go-forward');
    },

    reload() {
        ipcRenderer.send('reload');
    },

    goHome() {
        ipcRenderer.send('go-home');
    },

    showHomeMenu() {
        ipcRenderer.send('show-home-menu');
    },

    setHomeToCurrentPage() {
        return ipcRenderer.invoke('set-home-to-current');
    },

    startFocusMode() {
        return ipcRenderer.invoke('start-focus-mode');
    },

    stopFocusMode() {
        return ipcRenderer.invoke('stop-focus-mode');
    },

    onFocusModeChange(callback) {
        ipcRenderer.on('focus-mode-changed', (_, active) => {
            callback(active);
        });
    },

    getShieldState() {
        return ipcRenderer.invoke('get-shield-state');
    },

    toggleShieldForSite() {
        return ipcRenderer.invoke('toggle-shield-for-site');
    },

    onShieldState(callback) {
        ipcRenderer.on('shield-state', (_, state) => {
            callback(state);
        });
    },
        });
    },

    getSetupConfig() {
        return ipcRenderer.invoke('get-setup-config');
    },

    onURLChange(callback) {
        ipcRenderer.on('url-change', (_, url) => {
            callback(url);
        });
    },

    onLoading(callback) {
        ipcRenderer.on('loading', (_, state) => {
            callback(state);
        });
    },

    saveUrl(url) {
        ipcRenderer.send('save-url', url);
    },

    onTimerAvailability(callback) {
        ipcRenderer.on('timer-availability', (_, enabled) => {
            callback(enabled);
        });
    },

    getTimerAvailability() {
        return ipcRenderer.invoke('get-timer-availability');
    },

    getBookmarkState() {
        return ipcRenderer.invoke('get-bookmark-state');
    },

    toggleBookmark() {
        return ipcRenderer.invoke('toggle-bookmark');
    },

    removeBookmark(url) {
        return ipcRenderer.invoke('remove-bookmark', url);
    },

    renameBookmark(url, title) {
        return ipcRenderer.invoke('rename-bookmark', url, title);
    },

    moveBookmark(url, toIndex) {
        return ipcRenderer.invoke('move-bookmark', url, toIndex);
    },

    setBookmarkBarVisible(visible) {
        return ipcRenderer.invoke('set-bookmark-bar-visible', visible);
    },

    openBookmark(url) {
        ipcRenderer.send('open-bookmark', url);
    },

    showBookmarkMenu(url) {
        ipcRenderer.send('show-bookmark-menu', url);
    },

    onBookmarkState(callback) {
        ipcRenderer.on('bookmark-state', (_, state) => {
            callback(state);
        });
    },

    onBookmarkRename(callback) {
        ipcRenderer.on('bookmark-rename', (_, url) => {
            callback(url);
        });
    },

    setToolbarHeight(height) {
        ipcRenderer.send('set-toolbar-height', height);
    }
});
