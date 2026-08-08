const { contextBridge, ipcRenderer } = require('electron');

/*
    The translate popover's own preload — only what translate.html
    actually calls, the same scoping as downloadsPreload.js
*/

contextBridge.exposeInMainWorld('browserAPI', {
    getTranslateState() {
        return ipcRenderer.invoke('get-translate-state');
    },

    translatePage(sourceLang, targetLang) {
        return ipcRenderer.invoke('translate-page', sourceLang, targetLang);
    },

    restorePage() {
        return ipcRenderer.invoke('restore-translated-page');
    },

    setTranslateChoice(sourceLang, targetLang) {
        ipcRenderer.send('set-translate-choice', sourceLang, targetLang);
    },

    setAlwaysTranslate(sourceLang, targetLang, enabled) {
        return ipcRenderer.invoke('set-always-translate', sourceLang, targetLang, enabled);
    }
});
