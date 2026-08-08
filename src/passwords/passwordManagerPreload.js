const { contextBridge, ipcRenderer } = require('electron');

/*
    The Password Manager window's own preload — only what passwords.html
    actually calls, rather than the main toolbar's full browserAPI. Not
    to be confused with loginCapturePreload.js, which runs inside each
    tab's own page to detect logins; this one runs in the separate
    dialog window that lists, edits, and unlocks the vault.
*/

contextBridge.exposeInMainWorld('browserAPI', {
    getPasswordState() {
        return ipcRenderer.invoke('get-password-state');
    },

    setupPasswordVault(masterPassword) {
        return ipcRenderer.invoke('setup-password-vault', masterPassword);
    },

    unlockPasswordVault(masterPassword) {
        return ipcRenderer.invoke('unlock-password-vault', masterPassword);
    },

    removeMasterPassword(currentPassword) {
        return ipcRenderer.invoke('remove-master-password', currentPassword);
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
    }
});
