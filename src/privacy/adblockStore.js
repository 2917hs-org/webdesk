const store = require('../storage/settingsStore');

/*
    Shield settings live in settings.json under "adblock", as a master
    switch plus the hostnames blocking has been turned off for.

    A single-site app has nowhere to fall back to when the pinned site
    breaks, so the per-site exception is the important half.
*/

function hostnameOf(url) {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return '';
    }
}

function getState() {
    const state = store.get('adblock', {});

    return {
        enabled: state && state.enabled !== false,

        allowlist: state && Array.isArray(state.allowlist) ? state.allowlist : []
    };
}

function isEnabled() {
    return getState().enabled;
}

function setEnabled(enabled) {
    const state = getState();

    store.set('adblock', {
        enabled: Boolean(enabled),

        allowlist: state.allowlist
    });

    return isEnabled();
}

function isAllowlisted(url) {
    const host = hostnameOf(url);

    if (!host) return false;

    return getState().allowlist.includes(host);
}

function toggleAllowlist(url) {
    const host = hostnameOf(url);

    const state = getState();

    if (!host) return state.allowlist;

    const allowlist = state.allowlist.includes(host)
        ? state.allowlist.filter((entry) => entry !== host)
        : state.allowlist.concat(host);

    store.set('adblock', {
        enabled: state.enabled,

        allowlist
    });

    return allowlist;
}

/*
    Whether this page should have its requests blocked: the master
    switch with the site's own exception applied on top
*/

function shouldBlock(url) {
    return isEnabled() && !isAllowlisted(url);
}

module.exports = {
    hostnameOf,
    getState,
    isEnabled,
    setEnabled,
    isAllowlisted,
    toggleAllowlist,
    shouldBlock
};
