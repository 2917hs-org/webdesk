/*
    Translation backend: the free, unofficial endpoint behind
    translate.google.com's own web UI (translate.googleapis.com), the
    same one most no-signup "translate this page" tools use. No API
    key, no account — but also no SLA, so failures are treated as
    routine rather than exceptional throughout this file.

    Tried and rejected: passing several strings as repeated `q`
    parameters in one request, hoping for a real batch call. The
    endpoint silently ignores every `q` but one instead of translating
    them all, so each string here gets its own request. What keeps that
    affordable for a whole page's worth of text is dedupeAndTranslate
    below (repeated strings — nav labels, buttons — cost one request
    instead of one each) plus bounded concurrency (translateMany).
*/

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

const CONCURRENCY = 6;

async function translateOne(text, sourceLang, targetLang) {
    const params = new URLSearchParams({
        client: 'gtx',

        sl: sourceLang || 'auto',

        tl: targetLang,

        dt: 't',

        q: text
    });

    const response = await fetch(ENDPOINT + '?' + params.toString());

    if (!response.ok) {
        throw new Error('Translate request failed with status ' + response.status);
    }

    const data = await response.json();

    const segments = Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [];

    /*
        A single input string can still come back split across several
        segments (Google splits on sentence boundaries even within one
        q) — rejoined in order rather than keeping only the first
    */

    const translated = segments
        .map((segment) => (Array.isArray(segment) ? segment[0] || '' : ''))
        .join('');

    const detectedLang = typeof data[2] === 'string' ? data[2] : '';

    return { translated: translated || text, detectedLang };
}

/*
    Runs at most CONCURRENCY requests at once rather than firing
    hundreds simultaneously, which is both kinder to an endpoint with no
    published rate limit and less likely to get this app's IP throttled
    mid-page
*/

async function runPool(items, worker) {
    const results = new Array(items.length);

    let cursor = 0;

    async function next() {
        while (cursor < items.length) {
            const index = cursor;

            cursor += 1;

            results[index] = await worker(items[index], index);
        }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => next());

    await Promise.all(workers);

    return results;
}

/*
    One request for every distinct string rather than one per input —
    a page's nav bar and footer alone can repeat "Home" or "Sign in"
    dozens of times
*/

async function dedupeAndTranslate(texts, sourceLang, targetLang) {
    const unique = [...new Set(texts)];

    const translations = new Map();

    let resolvedSourceLang = sourceLang && sourceLang !== 'auto' ? sourceLang : '';

    await runPool(unique, async (text) => {
        try {
            const result = await translateOne(text, sourceLang, targetLang);

            translations.set(text, result.translated);

            if (!resolvedSourceLang && result.detectedLang) {
                resolvedSourceLang = result.detectedLang;
            }
        } catch {
            /*
                One string failing (a stray network hiccup, an
                over-length fragment) leaves the rest of the page
                translated rather than aborting the whole batch — the
                untranslated original stands in for it
            */

            translations.set(text, text);
        }
    });

    return {
        translated: texts.map((text) => translations.get(text) ?? text),

        detectedLang: resolvedSourceLang
    };
}

async function detectLanguage(text) {
    try {
        const result = await translateOne(text, 'auto', 'en');

        return result.detectedLang;
    } catch {
        return '';
    }
}

module.exports = {
    translateOne,
    dedupeAndTranslate,
    detectLanguage
};
