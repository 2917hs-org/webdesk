const { contextBridge, ipcRenderer } = require('electron');

/*
    The setup window's own preload — only what setup.html actually
    calls, rather than the main toolbar's full browserAPI. It loads no
    remote content either way, so this is a least-privilege measure
    rather than a response to a concrete threat from this window.
*/

contextBridge.exposeInMainWorld('browserAPI', {
    getSetupConfig() {
        return ipcRenderer.invoke('get-setup-config');
    },

    saveUrl(url) {
        ipcRenderer.send('save-url', url);
    },

    setupPasswordVault(masterPassword) {
        return ipcRenderer.invoke('setup-password-vault', masterPassword);
    }
});
