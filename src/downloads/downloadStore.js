const store = require('../storage/settingsStore');

/*
    Downloads live in settings.json under "downloads", newest first —
    the same list chrome://downloads shows, capped so a long-running
    profile does not grow the file without bound.
*/

const MAX_HISTORY = 100;

function getDownloads() {
    const downloads = store.get('downloads', []);

    return Array.isArray(downloads) ? downloads : [];
}

function saveDownloads(downloads) {
    store.set('downloads', downloads.slice(0, MAX_HISTORY));
}

function addDownload(entry) {
    const downloads = getDownloads();

    downloads.unshift(entry);

    saveDownloads(downloads);
}

function updateDownload(id, entry) {
    const downloads = getDownloads();

    const index = downloads.findIndex((download) => download.id === id);

    if (index === -1) return;

    downloads[index] = entry;

    saveDownloads(downloads);
}

function removeDownload(id) {
    saveDownloads(getDownloads().filter((download) => download.id !== id));
}

/*
    Chrome's "Clear all" on the downloads page drops history but leaves
    anything still in flight alone — activeIds is what's still running
*/

function clearFinished(activeIds) {
    saveDownloads(getDownloads().filter((download) => activeIds.has(download.id)));
}

function highestId() {
    return getDownloads().reduce((max, download) => Math.max(max, download.id || 0), 0);
}

module.exports = {
    getDownloads,
    addDownload,
    updateDownload,
    removeDownload,
    clearFinished,
    highestId
};
