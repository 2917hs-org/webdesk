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
    Engines are identified in the toolbar by their own icon. It is taken
    from the site the query goes to, so an engine added in settings.json
    gets one without having to supply anything, and can still override
    it with an "icon" of its own.
*/

function iconFor(engine) {
    if (typeof engine.icon === 'string' && engine.icon) return engine.icon;

    try {
        return new URL(engine.url).origin + '/favicon.ico';
    } catch {
        return '';
    }
}

function describeActive() {
    const engine = getActiveEngine();

    return {
        key: getActiveKey(),

        name: engine.name,

        icon: iconFor(engine)
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
