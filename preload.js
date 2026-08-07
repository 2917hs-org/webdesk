const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAPI', {
    navigate(url) {
        ipcRenderer.send('navigate', url);
    },

    submitOmnibox(text) {
        ipcRenderer.send('omnibox-submit', text);
    },

    showSearchMenu() {
        ipcRenderer.send('show-search-menu');
    },

    getSearchEngine() {
        return ipcRenderer.invoke('get-search-engine');
    },

    onSearchEngineChange(callback) {
        ipcRenderer.on('search-engine-changed', (_, engine) => {
            callback(engine);
        });
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

    getTabState() {
        return ipcRenderer.invoke('get-tab-state');
    },

    newTab(url) {
        ipcRenderer.send('new-tab', url);
    },

    selectTab(id) {
        ipcRenderer.send('select-tab', id);
    },

    closeTab(id) {
        ipcRenderer.send('close-tab', id);
    },

    moveTab(id, toIndex) {
        ipcRenderer.send('move-tab', id, toIndex);
    },

    onTabState(callback) {
        ipcRenderer.on('tab-state', (_, state) => {
            callback(state);
        });
    },

    toggleFocusMode() {
        return ipcRenderer.invoke('toggle-focus-mode');
    },

    toggleMaximise() {
        return ipcRenderer.invoke('toggle-maximise');
    },

    isMaximised() {
        return ipcRenderer.invoke('is-maximised');
    },

    onMaximiseChange(callback) {
        ipcRenderer.on('maximise-changed', (_, maximised) => {
            callback(maximised);
        });
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

    openBookmark(url, options) {
        ipcRenderer.send('open-bookmark', url, options);
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
    },

    openPasswordManager() {
        ipcRenderer.send('open-password-manager');
    },

    getPasswordState() {
        return ipcRenderer.invoke('get-password-state');
    },

    setupPasswordVault(masterPassword) {
        return ipcRenderer.invoke('setup-password-vault', masterPassword);
    },

    unlockPasswordVault(masterPassword) {
        return ipcRenderer.invoke('unlock-password-vault', masterPassword);
    },

    lockPasswordVault() {
        return ipcRenderer.invoke('lock-password-vault');
    },

    addPassword(entry) {
        return ipcRenderer.invoke('add-password', entry);
    },

    updatePassword(id, updates) {
        return ipcRenderer.invoke('update-password', id, updates);
    },

    deletePassword(id) {
        return ipcRenderer.invoke('delete-password', id);
    },

    copyPassword(id) {
        return ipcRenderer.invoke('copy-password', id);
    },

    onPasswordConfig(callback) {
        ipcRenderer.on('password-config', (_, config) => {
            callback(config);
        });
    },

    saveCapturedPassword() {
        return ipcRenderer.invoke('save-captured-password');
    },

    dismissSavePasswordPrompt() {
        ipcRenderer.send('dismiss-save-password-prompt');
    },

    onSavePasswordPrompt(callback) {
        ipcRenderer.on('save-password-prompt', (_, prompt) => {
            callback(prompt);
        });
    },

    getThemeSource() {
        return ipcRenderer.invoke('get-theme-source');
    },

    showThemeMenu() {
        ipcRenderer.send('show-theme-menu');
    },

    onThemeChange(callback) {
        ipcRenderer.on('theme-changed', (_, theme) => {
            callback(theme);
        });
    }
});
