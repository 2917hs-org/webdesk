const translateService = require('./translateService');

const translatePrefs = require('./translatePrefs');

const { isWebUrl } = require('../shared/url');

/*
    Translates a page in place by walking its text nodes rather than
    swapping in translated HTML — every link, button, and bit of inline
    formatting stays exactly where it was, only the words inside change.
    The alternative (translating whole blocks via innerHTML/textContent)
    is fewer requests but throws away any element nested inside the
    block being replaced, which for a real page means broken links
    every time a sentence happens to contain one.

    State (the text-node references, their original values, whether the
    page is currently translated) lives on the page itself, in
    window.__webdeskTranslateState — set once per navigation by
    EXTRACT_SCRIPT and read back by APPLY_SCRIPT/RESTORE_SCRIPT. That is
    what lets "translate" and "show original" be two cheap follow-up
    calls instead of re-walking the DOM each time.
*/

const EXTRACT_SCRIPT = `
(function() {
    if (window.__webdeskTranslateState) {
        return { texts: null };
    }

    var SKIP_TAGS = {
        SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1,
        SELECT: 1, OPTION: 1, IFRAME: 1, CODE: 1, PRE: 1, SVG: 1,
        CANVAS: 1, VIDEO: 1, AUDIO: 1
    };

    function isSkippableAncestor(node) {
        var el = node.parentElement;
        while (el) {
            if (SKIP_TAGS[el.tagName] || el.isContentEditable) return true;
            el = el.parentElement;
        }
        return false;
    }

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var texts = [];
    var node;

    while ((node = walker.nextNode())) {
        var raw = node.nodeValue;
        if (!raw || !raw.trim()) continue;
        if (isSkippableAncestor(node)) continue;
        nodes.push(node);
        texts.push(raw);
    }

    window.__webdeskTranslateState = {
        nodes: nodes,
        originals: texts.slice(),
        titleOriginal: document.title,
        translated: false
    };

    return { title: document.title, texts: texts };
})();
`;

function applyScript(payload) {
    return `
(function(payload) {
    var state = window.__webdeskTranslateState;
    if (!state) return false;

    for (var i = 0; i < state.nodes.length; i++) {
        if (state.nodes[i] && payload.texts[i] !== undefined) {
            state.nodes[i].nodeValue = payload.texts[i];
        }
    }

    if (payload.title) document.title = payload.title;

    state.translated = true;
    document.documentElement.setAttribute('data-webdesk-translated', 'true');

    return true;
})(${JSON.stringify(payload)});
`;
}

const RESTORE_SCRIPT = `
(function() {
    var state = window.__webdeskTranslateState;
    if (!state) return false;

    for (var i = 0; i < state.nodes.length; i++) {
        if (state.nodes[i] && state.originals[i] !== undefined) {
            state.nodes[i].nodeValue = state.originals[i];
        }
    }

    if (state.titleOriginal !== undefined) document.title = state.titleOriginal;

    state.translated = false;
    document.documentElement.removeAttribute('data-webdesk-translated');

    return true;
})();
`;

/*
    Keyed by webContents.id rather than holding the webContents object
    itself, matching the convention windowContexts already uses in
    browserManager.js — and cleaned up the same way, off a 'destroyed'
    listener attached once per tab
*/

const tabStates = new Map();

const listenedContents = new WeakSet();

function ensureCleanup(webContents) {
    if (listenedContents.has(webContents)) return;

    listenedContents.add(webContents);

    webContents.once('destroyed', () => {
        tabStates.delete(webContents.id);
    });
}

function getState(webContents) {
    return (
        tabStates.get(webContents.id) || {
            translated: false,
            busy: false,
            sourceLang: null,
            targetLang: null,
            detectedLang: null
        }
    );
}

function setState(webContents, patch) {
    const next = { ...getState(webContents), ...patch };

    tabStates.set(webContents.id, next);

    return next;
}

/*
    Called on every navigation — the extracted node references above
    would otherwise point at a page that no longer exists, and a page
    freshly loaded has nothing translated on it yet regardless of what
    the last one looked like
*/

function resetState(webContents) {
    tabStates.delete(webContents.id);
}

function splitWhitespace(raw) {
    const trimmed = raw.trim();

    const leadIndex = raw.indexOf(trimmed);

    return {
        lead: raw.slice(0, leadIndex),

        core: trimmed,

        trail: raw.slice(leadIndex + trimmed.length)
    };
}

async function translatePage(webContents, sourceLang, targetLang) {
    if (webContents.isDestroyed()) return { ok: false, error: 'Page is gone' };

    ensureCleanup(webContents);

    if (getState(webContents).busy) return { ok: false, error: 'Already translating' };

    setState(webContents, { busy: true });

    try {
        const extracted = await webContents.executeJavaScript(EXTRACT_SCRIPT);

        /*
            null texts means EXTRACT_SCRIPT found translate state
            already on the page (a previous translate call this same
            navigation) — the node registry is still good, so this
            re-translate is free to skip straight to a fresh apply
            without walking the DOM a second time. Reading it back out
            requires the original texts, which only the page has.
        */

        const texts =
            extracted.texts ||
            (await webContents.executeJavaScript('window.__webdeskTranslateState.originals'));

        const title =
            extracted.title ||
            (await webContents.executeJavaScript('window.__webdeskTranslateState.titleOriginal'));

        const parts = texts.map(splitWhitespace);

        const inputs = [title, ...parts.map((part) => part.core)];

        const result = await translateService.dedupeAndTranslate(inputs, sourceLang, targetLang);

        const [translatedTitle, ...translatedCores] = result.translated;

        const translatedTexts = translatedCores.map(
            (core, index) => parts[index].lead + core + parts[index].trail
        );

        if (webContents.isDestroyed()) return { ok: false, error: 'Page is gone' };

        await webContents.executeJavaScript(
            applyScript({ title: translatedTitle, texts: translatedTexts })
        );

        const resolvedSource =
            sourceLang !== 'auto' ? sourceLang : result.detectedLang || sourceLang;

        setState(webContents, {
            busy: false,

            translated: true,

            sourceLang: resolvedSource,

            targetLang,

            detectedLang: result.detectedLang || resolvedSource
        });

        return {
            ok: true,
            sourceLang: resolvedSource,
            targetLang,
            detectedLang: result.detectedLang
        };
    } catch (error) {
        setState(webContents, { busy: false });

        return { ok: false, error: error.message || 'Translation failed' };
    }
}

async function restorePage(webContents) {
    if (webContents.isDestroyed()) return { ok: false, error: 'Page is gone' };

    try {
        await webContents.executeJavaScript(RESTORE_SCRIPT);

        setState(webContents, { translated: false });

        return { ok: true };
    } catch (error) {
        return { ok: false, error: error.message || 'Restore failed' };
    }
}

/*
    The checkbox in the toolbar popover ("Always translate French to
    English") has to act without anyone opening that popover again —
    this is what actually fires it, once per finished page load. A
    page's language is not known up front, so a small detection request
    (the page title plus a short sample of body text, not the whole
    page) runs first; only a page whose detected language has a saved
    rule pays for the real, full-page translation after it.
*/

async function maybeAutoTranslate(webContents) {
    if (webContents.isDestroyed()) return null;

    if (!isWebUrl(webContents.getURL())) return null;

    const prefs = translatePrefs.getPrefs();

    if (Object.keys(prefs.alwaysTranslate).length === 0) return null;

    if (getState(webContents).translated) return null;

    let sample;

    try {
        sample = await webContents.executeJavaScript(
            '(document.title || "") + " " + (document.body ? document.body.innerText.slice(0, 400) : "")'
        );
    } catch {
        return null;
    }

    if (!sample || !sample.trim()) return null;

    const detected = await translateService.detectLanguage(sample.trim());

    if (!detected) return null;

    const target = prefs.alwaysTranslate[detected];

    if (!target) return null;

    if (webContents.isDestroyed()) return null;

    return translatePage(webContents, detected, target);
}

module.exports = {
    getState,
    resetState,
    translatePage,
    restorePage,
    maybeAutoTranslate
};
