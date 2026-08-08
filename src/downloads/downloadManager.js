const { app, shell } = require('electron');

const path = require('path');

const fs = require('fs');

const downloadStore = require('./downloadStore');

/*
    Chrome saves straight to the system Downloads folder without asking
    where, unless "Ask where to save each file" is turned on — there is
    no such setting here, so every download behaves as if that switch
    were off. What Chrome still does on every save is avoid overwriting
    a file with the same name, by appending " (1)", " (2)", and so on;
    uniqueDestination below is that same rule.
*/

let notifyChange = () => {};

let downloadSession = null;

let nextId = 1;

/*
    Only downloads still in flight — completed/cancelled/interrupted
    ones are dropped once their DownloadItem is done, since everything
    a finished download needs to show is already in downloadStore
*/

const activeItems = new Map();

function uniqueDestination(dir, filename) {
    const ext = path.extname(filename);

    const base = path.basename(filename, ext);

    let candidate = filename;

    let counter = 1;

    while (fs.existsSync(path.join(dir, candidate))) {
        candidate = `${base} (${counter})${ext}`;

        counter += 1;
    }

    return path.join(dir, candidate);
}

function toEntry(id, item, state, record) {
    const savePath = item.getSavePath();

    return {
        id,

        filename: savePath ? path.basename(savePath) : item.getFilename(),

        path: savePath,

        url: item.getURL(),

        totalBytes: item.getTotalBytes(),

        receivedBytes: item.getReceivedBytes(),

        /*
            "paused" is not one of Electron's own state values — it is
            layered on top of "progressing" here, the way Chrome's own
            downloads panel shows a pause icon rather than a fourth state
        */

        state: state === 'progressing' && item.isPaused() ? 'paused' : state,

        startTime: record.startTime,

        endTime: record.endTime || null
    };
}

function initDownloads(session, onChange) {
    notifyChange = typeof onChange === 'function' ? onChange : () => {};

    downloadSession = session;

    nextId = downloadStore.highestId() + 1;

    session.on('will-download', (event, item) => {
        const id = nextId;

        nextId += 1;

        const destination = uniqueDestination(app.getPath('downloads'), item.getFilename());

        item.setSavePath(destination);

        const record = { startTime: Date.now(), endTime: null };

        activeItems.set(id, item);

        downloadStore.addDownload(toEntry(id, item, 'progressing', record));

        notifyChange();

        item.on('updated', (_, state) => {
            downloadStore.updateDownload(id, toEntry(id, item, state, record));

            notifyChange();
        });

        item.once('done', (_, state) => {
            record.endTime = Date.now();

            downloadStore.updateDownload(id, toEntry(id, item, state, record));

            activeItems.delete(id);

            notifyChange();
        });
    });
}

function getDownloads() {
    return downloadStore.getDownloads();
}

function findEntry(id) {
    return downloadStore.getDownloads().find((download) => download.id === id) || null;
}

function clearDownloads() {
    downloadStore.clearFinished(new Set(activeItems.keys()));

    notifyChange();
}

function removeDownload(id) {
    if (activeItems.has(id)) return;

    downloadStore.removeDownload(id);

    notifyChange();
}

function cancelDownload(id) {
    const item = activeItems.get(id);

    if (item) item.cancel();
}

function pauseDownload(id) {
    const item = activeItems.get(id);

    if (item && !item.isPaused()) {
        item.pause();

        notifyChange();
    }
}

function resumeDownload(id) {
    const item = activeItems.get(id);

    if (item && item.isPaused() && item.canResume()) {
        item.resume();

        notifyChange();
    }
}

/*
    Chrome's failed-download "Retry" just starts the same URL over
    again as a fresh download, rather than resuming the broken one
*/

function retryDownload(id) {
    const entry = findEntry(id);

    if (!entry || !entry.url || !downloadSession) return;

    downloadSession.downloadURL(entry.url);
}

async function openDownload(id) {
    const entry = findEntry(id);

    if (!entry || !entry.path) return { ok: false, error: 'File not found' };

    const error = await shell.openPath(entry.path);

    return error ? { ok: false, error } : { ok: true };
}

function showInFolder(id) {
    const entry = findEntry(id);

    if (entry && entry.path) {
        shell.showItemInFolder(entry.path);
    }
}

module.exports = {
    initDownloads,
    getDownloads,
    clearDownloads,
    removeDownload,
    cancelDownload,
    pauseDownload,
    resumeDownload,
    retryDownload,
    openDownload,
    showInFolder
};
