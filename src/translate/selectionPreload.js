const { contextBridge, ipcRenderer } = require('electron');

/*
    Everything this popup shows arrives pushed from the main process —
    the original selection as soon as the window is ready, the
    translation once it comes back — so there is nothing here to invoke
    the other way
*/

contextBridge.exposeInMainWorld('browserAPI', {
    onSelectionInit(callback) {
        ipcRenderer.on('selection-init', (_, payload) => {
            callback(payload);
        });
    },

    onSelectionResult(callback) {
        ipcRenderer.on('selection-result', (_, payload) => {
            callback(payload);
        });
    }
});
