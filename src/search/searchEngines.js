const store = require('../storage/settingsStore');

/*
    What the address bar does with text that is not a URL.

    The built-ins below can be added to from settings.json without a
    code change, under "searchEngines":

        "searchEngines": {
            "brave": { "name": "Brave", "url": "https://search.brave.com/search?q={query}" }
        }

    The engine in use is "searchEngine", holding one of the keys.
*/

const DEFAULT_ENGINES = {
    google: {
        name: 'Google',

        url: 'https://www.google.com/search?q={query}'
    },

    duckduckgo: {
        name: 'DuckDuckGo',

        url: 'https://duckduckgo.com/?q={query}'
    }
};

const FALLBACK_KEY = 'google';

function isUsableEngine(engine) {
    return Boolean(
        engine &&
        typeof engine.name === 'string' &&
        typeof engine.url === 'string' &&
        engine.url.includes('{query}')
    );
}

function getEngines() {
    const custom = store.get('searchEngines', {});

    const engines = { ...DEFAULT_ENGINES };

    if (custom && typeof custom === 'object') {
        Object.keys(custom).forEach((key) => {
            /*
                A malformed entry is skipped rather than allowed to
                break the address bar
            */

            if (isUsableEngine(custom[key])) {
                engines[key] = custom[key];
            }
        });
    }

    return engines;
}

function getActiveKey() {
    const key = store.get('searchEngine', FALLBACK_KEY);

    return getEngines()[key] ? key : FALLBACK_KEY;
}

function getActiveEngine() {
    return getEngines()[getActiveKey()];
}

function setActiveKey(key) {
    if (getEngines()[key]) {
        store.set('searchEngine', key);
    }

    return getActiveKey();
}

/*
    Drawn in rather than fetched, so the two built-in engines always show
    a crisp, recognisable mark next to the address bar instead of
    whatever a remote favicon.ico happens to be that day (blurry,
    missing, or just slow to arrive over the network)
*/

const GOOGLE_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z"/>' +
    '<path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.5 7.4 24 12 24z"/>' +
    '<path fill="#FBBC05" d="M5.4 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.6.4-2.4V6.5H1.4C.5 8.2 0 10.1 0 12s.5 3.8 1.4 5.5l4-3.1z"/>' +
    '<path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.5 1.4 6.5l4 3.1c.9-2.8 3.5-4.8 6.6-4.8z"/>' +
    '</svg>';

const DUCKDUCKGO_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<circle cx="12" cy="12" r="12" fill="#DE5833"/>' +
    '<path fill="#FFF" d="M8 10.6c0-2.5 1.9-4.6 4.3-4.6 1.9 0 3.4 1.2 4 2.8.7-.1 1.4.1 1.8.8.5.8.2 1.8-.6 2.3-.3.2-.6.3-1 .3.1.4.2.8.2 1.3 0 2.8-2.3 5-5.2 5s-5.2-2.2-5.2-5c0-1 .3-1.9.8-2.7-.1-.1-.1-.1-.1-.2z"/>' +
    '<circle cx="14.4" cy="9.7" r="0.75" fill="#2F2F2F"/>' +
    '</svg>';

const BUILT_IN_ICONS = {
    google: 'data:image/svg+xml,' + encodeURIComponent(GOOGLE_ICON),

    duckduckgo: 'data:image/svg+xml,' + encodeURIComponent(DUCKDUCKGO_ICON)
};

/*
    Engines are identified in the toolbar by their own icon. The two
    built-ins get a drawn-in icon by key; anything added in settings.json
    falls back to the site's own favicon.ico, and can override either
    with an "icon" of its own.
*/

function iconFor(engine, key) {
    if (typeof engine.icon === 'string' && engine.icon) return engine.icon;

    if (key && BUILT_IN_ICONS[key]) return BUILT_IN_ICONS[key];

    try {
        return new URL(engine.url).origin + '/favicon.ico';
    } catch {
        return '';
    }
}

function describeActive() {
    const key = getActiveKey();

    const engine = getEngines()[key];

    return {
        key,

        name: engine.name,

        icon: iconFor(engine, key)
    };
}

function buildSearchUrl(query) {
    return getActiveEngine().url.replace('{query}', encodeURIComponent(query));
}

/*
    Whether to treat what was typed as somewhere to go rather than
    something to look up, roughly the way a browser decides:

      - anything with a space is a query
      - an explicit scheme is a URL
      - localhost and bare IP addresses are URLs
      - otherwise it needs a host ending in a letters-only suffix, so
        "example.com" navigates while "3.14" and "define:recursion" do not
*/

function looksLikeUrl(text) {
    if (/\s/.test(text)) return false;

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return true;

    const host = text.split(/[/?#]/)[0];

    if (/^localhost(:\d+)?$/i.test(host)) return true;

    if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host)) return true;

    return /^[^\s.:]+(\.[^\s.:]+)*\.[a-z]{2,}(:\d+)?$/i.test(host);
}

function resolveInput(text) {
    const trimmed = String(text || '').trim();

    if (!trimmed) return null;

    if (!looksLikeUrl(trimmed)) {
        return { type: 'search', url: buildSearchUrl(trimmed), query: trimmed };
    }

    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;

    return { type: 'url', url, query: trimmed };
}

module.exports = {
    getEngines,
    getActiveKey,
    getActiveEngine,
    setActiveKey,
    iconFor,
    describeActive,
    buildSearchUrl,
    looksLikeUrl,
    resolveInput
};
