const keytar = require('keytar');

const store = require('../storage/settingsStore');

const SERVICE_NAME = 'WebDesk';

/*
    Accounts a user has dismissed from the in-page suggestion dropdown.
    Kept separate from the credential itself — hiding a suggestion never
    touches the saved password in the keychain or the Settings list.
*/

const HIDDEN_SUGGESTIONS_KEY = 'autofillHiddenSuggestions';

function normalizeOrigin(origin) {
    try {
        const parsed = new URL(origin);

        parsed.hash = '';

        const hostname = parsed.hostname.toLowerCase();

        let normalized = parsed.protocol + '//' + hostname;

        if (parsed.port) {
            normalized += ':' + parsed.port;
        }

        return normalized;
    } catch {
        return String(origin || '').trim();
    }
}

function accountKey(origin, username) {
    const normalizedOrigin = normalizeOrigin(origin);

    return `${normalizedOrigin}::${String(username || '').trim()}`;
}

function isOriginAllowed(requestedOrigin, currentOrigin) {
    const normalizedRequested = normalizeOrigin(requestedOrigin);
    const normalizedCurrent = normalizeOrigin(currentOrigin);

    if (!normalizedRequested || !normalizedCurrent) return false;

    return normalizedRequested === normalizedCurrent;
}

function getHiddenSuggestions() {
    const hidden = store.get(HIDDEN_SUGGESTIONS_KEY);

    if (!Array.isArray(hidden)) return [];

    return hidden.filter((entry) => typeof entry === 'string' && entry);
}

function hideSuggestion(origin, username) {
    if (!normalizeOrigin(origin) || !username) {
        return { ok: false, error: 'Origin and username are required' };
    }

    const key = accountKey(origin, username);

    const hidden = getHiddenSuggestions();

    if (!hidden.includes(key)) {
        hidden.push(key);

        store.set(HIDDEN_SUGGESTIONS_KEY, hidden);
    }

    return { ok: true };
}

function unhideSuggestion(origin, username) {
    const key = accountKey(origin, username);

    const hidden = getHiddenSuggestions().filter((entry) => entry !== key);

    store.set(HIDDEN_SUGGESTIONS_KEY, hidden);
}

async function saveCredential({ origin, username, password }) {
    const normalizedOrigin = normalizeOrigin(origin);

    if (!normalizedOrigin || !username || !password) {
        return { ok: false, error: 'Origin, username, and password are required' };
    }

    /*
        Saving (or re-saving after a password change) means the account
        is active again, so it shouldn't stay hidden from suggestions
        under an old dismissal
    */

    unhideSuggestion(normalizedOrigin, username);

    const existing = await listCredentials(normalizedOrigin);

    const match = existing.find((item) => item.username === username);

    if (match) {
        await keytar.setPassword(SERVICE_NAME, accountKey(normalizedOrigin, username), password);
        return { ok: true, id: match.id };
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await keytar.setPassword(SERVICE_NAME, accountKey(normalizedOrigin, username), password);

    return { ok: true, id };
}

/*
    Used for autofill suggestions/fill, so accounts hidden from the
    dropdown are left out here — listCredentials stays unfiltered, since
    saving still needs to find and update a hidden account rather than
    duplicate it
*/

async function findCredentials(origin) {
    const normalizedOrigin = normalizeOrigin(origin);

    if (!normalizedOrigin) return [];

    const hidden = getHiddenSuggestions();

    const credentials = await listCredentials(normalizedOrigin);

    return credentials.filter(
        (item) => !hidden.includes(accountKey(normalizedOrigin, item.username))
    );
}

async function listCredentials(origin) {
    const normalizedOrigin = normalizeOrigin(origin);

    if (!normalizedOrigin) return [];

    const credentials = [];

    const allAccounts = await keytar.findCredentials(SERVICE_NAME);

    for (const account of allAccounts) {
        if (!account.account) continue;

        if (!account.account.startsWith(`${normalizedOrigin}::`)) continue;

        const [storedOrigin, storedUsername] = account.account.split('::');

        if (storedOrigin !== normalizedOrigin) continue;

        credentials.push({
            id: account.account,
            origin: storedOrigin,
            username: storedUsername,
            password: account.password
        });
    }

    return credentials;
}

async function deleteCredential(origin, username) {
    const normalizedOrigin = normalizeOrigin(origin);

    if (!normalizedOrigin || !username)
        return { ok: false, error: 'Origin and username are required' };

    await keytar.deletePassword(SERVICE_NAME, accountKey(normalizedOrigin, username));

    return { ok: true };
}

module.exports = {
    saveCredential,
    findCredentials,
    listCredentials,
    deleteCredential,
    hideSuggestion,
    normalizeOrigin,
    isOriginAllowed
};
