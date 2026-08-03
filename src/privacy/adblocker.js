const path = require('path');

const fs = require('fs');

const { app } = require('electron');

const adblockStore = require('./adblockStore');

/*
    Wraps the Ghostery engine, which parses the same EasyList and
    EasyPrivacy rules Brave's shields use. It handles both halves of
    blocking: cancelling requests, and hiding the boxes they leave
    behind, the second of which it does through its own preload script
    registered on the session.
*/

let blocker = null;

let blockedSession = null;

let blockedCount = 0;

let notifyChange = () => {};

let notifyTimer = null;

/*
    A first run with no network cannot build the engine, and leaving it
    at that would quietly serve the rest of the session unprotected.
    The load is retried instead, backing off to five minutes.
*/

let loading = false;

let attempts = 0;

let lastError = '';

let getCurrentUrl = () => '';

const FIRST_RETRY_MS = 5000;

const MAX_RETRY_MS = 300000;

/*
    Several megabytes of parsed rules, so it is kept in userData and
    only fetched again when the published engine moves on
*/

function cachePath() {
    return path.join(app.getPath('userData'), 'adblock-engine.bin');
}

/*
    Block events arrive in bursts as a page loads, so the toolbar is
    told on a timer rather than once per request
*/

function scheduleNotify() {
    if (notifyTimer) return;

    notifyTimer = setTimeout(() => {
        notifyTimer = null;

        notifyChange();
    }, 250);
}

function isReady() {
    return blocker !== null;
}

function getBlockedCount() {
    return blockedCount;
}

/*
    Counted per page, the way a shield badge reads in a browser
*/

function resetCount() {
    blockedCount = 0;

    scheduleNotify();
}

function isBlockingNow() {
    if (!blocker || !blockedSession) return false;

    return blocker.isBlockingEnabled(blockedSession);
}

/*
    Turns blocking on or off to match the site being visited. Called on
    every navigation, since the exception is per hostname.
*/

function applyForUrl(url) {
    if (!blocker || !blockedSession) return;

    const wanted = adblockStore.shouldBlock(url);

    if (wanted === blocker.isBlockingEnabled(blockedSession)) return;

    if (wanted) {
        blocker.enableBlockingInSession(blockedSession);
    } else {
        blocker.disableBlockingInSession(blockedSession);
    }
}

async function buildEngine() {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');

    return ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
        path: cachePath(),

        read: fs.promises.readFile,

        write: fs.promises.writeFile
    });
}

/*
    Keeps trying until there is an engine, so blocking comes on by
    itself once the network is back rather than needing a restart
*/

function ensureEngine() {
    if (blocker || loading) return;

    loading = true;

    attempts += 1;

    buildEngine()
        .then((engine) => {
            blocker = engine;

            loading = false;

            lastError = '';

            blocker.on('request-blocked', () => {
                blockedCount += 1;

                scheduleNotify();
            });

            applyForUrl(getCurrentUrl());

            notifyChange();
        })
        .catch((error) => {
            loading = false;

            lastError = error.message;

            const delay = Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (attempts - 1));

            console.error(
                'Ad blocker could not load (attempt ' + attempts + '), retrying in ' +
                Math.round(delay / 1000) + 's:',
                lastError
            );

            notifyChange();

            setTimeout(ensureEngine, delay).unref?.();
        });
}

function initAdblocker(session, currentUrlGetter, onChange) {
    blockedSession = session;

    getCurrentUrl = typeof currentUrlGetter === 'function' ? currentUrlGetter : () => '';

    notifyChange = typeof onChange === 'function' ? onChange : () => {};

    ensureEngine();
}

function getStatus() {
    if (blocker) return 'ready';

    return loading ? 'loading' : 'unavailable';
}

function getLastError() {
    return lastError;
}

module.exports = {
    initAdblocker,
    ensureEngine,
    applyForUrl,
    resetCount,
    getBlockedCount,
    isBlockingNow,
    isReady,
    getStatus,
    getLastError
};
