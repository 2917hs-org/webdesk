const store = require('../storage/settingsStore');

/*
    Everything the translate popover needs to remember between
    launches: the two dropdowns' last choice, and the set of "always
    translate X" rules the checkbox writes to. One shared settings key,
    the same way bookmarks and the download list are one shared list
    rather than per-window.
*/

const DEFAULTS = {
    sourceLang: 'auto',

    targetLang: 'en',

    /*
        Keyed by source language code, e.g. { fr: 'en' } means "always
        translate French pages to English". A page whose detected
        language has no key here is left alone until asked.
    */

    alwaysTranslate: {}
};

function getPrefs() {
    const stored = store.get('translate', DEFAULTS);

    return {
        sourceLang: typeof stored.sourceLang === 'string' ? stored.sourceLang : DEFAULTS.sourceLang,

        targetLang: typeof stored.targetLang === 'string' ? stored.targetLang : DEFAULTS.targetLang,

        alwaysTranslate:
            stored.alwaysTranslate && typeof stored.alwaysTranslate === 'object'
                ? stored.alwaysTranslate
                : {}
    };
}

function setLastChoice(sourceLang, targetLang) {
    const prefs = getPrefs();

    store.set('translate', {
        ...prefs,

        sourceLang: sourceLang || prefs.sourceLang,

        targetLang: targetLang || prefs.targetLang
    });
}

/*
    'auto' is not a real source language — there is nothing to match a
    future page's detected language against — so an always-translate
    rule can only ever be saved once detection has resolved to a real code
*/

function setAlwaysTranslate(sourceLang, targetLang, enabled) {
    if (!sourceLang || sourceLang === 'auto') return getPrefs();

    const prefs = getPrefs();

    const alwaysTranslate = { ...prefs.alwaysTranslate };

    if (enabled) {
        alwaysTranslate[sourceLang] = targetLang;
    } else {
        delete alwaysTranslate[sourceLang];
    }

    store.set('translate', { ...prefs, alwaysTranslate });

    return getPrefs();
}

function alwaysTargetFor(sourceLang) {
    if (!sourceLang) return null;

    const prefs = getPrefs();

    return prefs.alwaysTranslate[sourceLang] || null;
}

module.exports = {
    getPrefs,
    setLastChoice,
    setAlwaysTranslate,
    alwaysTargetFor
};
