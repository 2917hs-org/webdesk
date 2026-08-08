const { contextBridge, ipcRenderer } = require('electron');

/*
    The downloads popover's own preload — only what downloads.html
    actually calls, rather than the main toolbar's full browserAPI.
*/

contextBridge.exposeInMainWorld('browserAPI', {
    getDownloads() {
        return ipcRenderer.invoke('get-downloads');
    },

    onDownloadState(callback) {
        ipcRenderer.on('download-state', (_, downloads) => {
            callback(downloads);
        });
    },

    openDownload(id) {
        return ipcRenderer.invoke('open-download', id);
    },

    showDownloadInFolder(id) {
        ipcRenderer.send('show-download-in-folder', id);
    },

    cancelDownload(id) {
        ipcRenderer.send('cancel-download', id);
    },

    pauseDownload(id) {
        ipcRenderer.send('pause-download', id);
    },

    resumeDownload(id) {
        ipcRenderer.send('resume-download', id);
    },

    retryDownload(id) {
        ipcRenderer.send('retry-download', id);
    },

    removeDownload(id) {
        return ipcRenderer.invoke('remove-download', id);
    },

    clearDownloads() {
        return ipcRenderer.invoke('clear-downloads');
    }
});
