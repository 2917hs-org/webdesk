const crypto = require('crypto');

const store = require('../storage/settingsStore');

const VAULT_KEY = 'passwordVault';
const EXCLUDED_ORIGINS_KEY = 'passwordExcludedOrigins';

const ALGORITHM = 'aes-256-gcm';

const KEY_LENGTH = 32;

const IV_LENGTH = 12;

const SALT_LENGTH = 32;

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/*
    A master password is optional. Until the user chooses one, the
    vault is still a real vault — encrypted the same way, on disk in
    the same shape — just under a key derived from this fixed string
    instead of anything secret, so it never has to ask for anything to
    read what's in it. Choosing a master password later re-encrypts
    everything under a key nobody but the user has.
*/

const DEFAULT_KEY_MATERIAL = 'webdesk-unprotected-vault-v1';

/*
    The derived key lives only in memory. For a protected vault, once
    it is locked, nothing in the renderer can read stored passwords
    until it is unlocked again with the master password. For an
    unprotected one, ensureAccessible() below re-derives it on demand,
    so it is never meaningfully "locked" at all.
*/

let derivedKey = null;

function generateId() {
    return crypto.randomUUID();
}

function deriveKey(password, salt) {
    return crypto.scryptSync(String(password), salt, KEY_LENGTH, SCRYPT_OPTIONS);
}

function getVault() {
    const vault = store.get(VAULT_KEY);

    if (!vault || typeof vault !== 'object') return null;

    if (typeof vault.salt !== 'string' || typeof vault.verifier !== 'string') return null;

    if (!Array.isArray(vault.entries)) return null;

    return vault;
}

function saveVault(vault) {
    store.set(VAULT_KEY, vault);
}

/*
    Missing the field entirely means a vault saved before this feature
    existed — those were only ever created by choosing a real master
    password, so they stay protected rather than silently opening up
*/

function isProtected(vault) {
    return vault ? vault.protected !== false : false;
}

function createDefaultVault() {
    const salt = crypto.randomBytes(SALT_LENGTH);

    const key = deriveKey(DEFAULT_KEY_MATERIAL, salt);

    derivedKey = key;

    saveVault({
        salt: salt.toString('base64'),
        verifier: key.toString('base64'),
        protected: false,
        entries: []
    });
}

/*
    Called from every read/write path below, so the vault is always
    there and, unless the user has chosen to protect it, always
    readable — no setup step and no unlock prompt required for the
    common case of not caring about a master password at all
*/

function ensureAccessible() {
    const vault = getVault();

    if (!vault) {
        createDefaultVault();

        return;
    }

    if (!isProtected(vault) && !derivedKey) {
        const salt = Buffer.from(vault.salt, 'base64');

        derivedKey = deriveKey(DEFAULT_KEY_MATERIAL, salt);
    }
}

function getExcludedOrigins() {
    const excluded = store.get(EXCLUDED_ORIGINS_KEY);

    if (!Array.isArray(excluded)) return [];

    return excluded.filter((entry) => typeof entry === 'string' && entry.trim());
}

function saveExcludedOrigins(excluded) {
    store.set(EXCLUDED_ORIGINS_KEY, excluded);
}

function normalizeUrl(url) {
    try {
        const parsed = new URL(url);

        parsed.hash = '';

        parsed.hostname = parsed.hostname.toLowerCase();

        const normalized = parsed.toString();

        return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
    } catch {
        return String(url || '').trim();
    }
}

function hostnameOf(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return '';
    }
}

function encrypt(text, key) {
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);

    const authTag = cipher.getAuthTag();

    return {
        iv: iv.toString('base64'),
        ciphertext: encrypted.toString('base64'),
        authTag: authTag.toString('base64')
    };
}

function decrypt(payload, key) {
    const iv = Buffer.from(payload.iv, 'base64');

    const ciphertext = Buffer.from(payload.ciphertext, 'base64');

    const authTag = Buffer.from(payload.authTag, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function toPublicEntry(entry) {
    return {
        id: entry.id,
        title: entry.title,
        url: entry.url,
        username: entry.username,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt
    };
}

function toUnlockedEntry(entry) {
    const publicEntry = toPublicEntry(entry);

    if (!derivedKey || !entry.passwordEnc) return publicEntry;

    try {
        publicEntry.password = decrypt(entry.passwordEnc, derivedKey);
    } catch {
        publicEntry.password = '';
    }

    return publicEntry;
}

function isVaultSetup() {
    ensureAccessible();

    return getVault() !== null;
}

function isVaultProtected() {
    ensureAccessible();

    return isProtected(getVault());
}

function isUnlocked() {
    ensureAccessible();

    return derivedKey !== null;
}

function validateMasterPassword(masterPassword) {
    const password = String(masterPassword || '');

    /*
        No length or complexity requirement — whatever the user chooses
        is theirs to choose. Only guards against an accidentally blank
        submission, which isn't really a password at all.
    */

    if (!password) {
        return {
            ok: false,
            error: 'Enter a master password'
        };
    }

    return { ok: true };
}

function verifyMasterPassword(masterPassword) {
    const vault = getVault();

    if (!vault) return false;

    const salt = Buffer.from(vault.salt, 'base64');
    const key = deriveKey(masterPassword, salt);

    return key.toString('base64') === vault.verifier;
}

/*
    Doubles as both "protect this vault for the first time" and "change
    the existing master password" — either way the result is the same:
    every entry re-encrypted under a freshly derived key. The only
    difference is where the *old* key comes from: the fixed default
    material if nothing was chosen yet, or the currently unlocked
    custom key if something already was.
*/

function setupVault(masterPassword) {
    const validation = validateMasterPassword(masterPassword);

    if (!validation.ok) return validation;

    ensureAccessible();

    const vault = getVault();

    if (isProtected(vault) && !derivedKey) {
        return { ok: false, error: 'Unlock the vault before changing the master password' };
    }

    const oldKey = derivedKey;

    const newSalt = crypto.randomBytes(SALT_LENGTH);

    const newKey = deriveKey(masterPassword, newSalt);

    const entries = vault.entries.map((entry) => {
        if (!entry.passwordEnc || !oldKey) return entry;

        try {
            const plain = decrypt(entry.passwordEnc, oldKey);

            return { ...entry, passwordEnc: encrypt(plain, newKey) };
        } catch {
            /*
                Left as-is rather than dropped — an entry that fails to
                decrypt here is no worse off than it already was
            */

            return entry;
        }
    });

    derivedKey = newKey;

    saveVault({
        salt: newSalt.toString('base64'),
        verifier: newKey.toString('base64'),
        protected: true,
        entries
    });

    return { ok: true };
}

/*
    Re-encrypts every entry under the same fixed key an unprotected
    vault always uses, then drops the chosen password entirely — the
    reverse of setupVault. Re-derives from the given password rather
    than trusting the in-memory derivedKey, so this can't be done
    without proving the current password even from an already-unlocked
    window left open.
*/

function removeMasterPassword(currentPassword) {
    ensureAccessible();

    const vault = getVault();

    if (!isProtected(vault)) {
        return { ok: false, error: 'No master password is set' };
    }

    const oldSalt = Buffer.from(vault.salt, 'base64');

    const oldKey = deriveKey(currentPassword, oldSalt);

    if (oldKey.toString('base64') !== vault.verifier) {
        return { ok: false, error: 'Incorrect master password' };
    }

    const newSalt = crypto.randomBytes(SALT_LENGTH);

    const newKey = deriveKey(DEFAULT_KEY_MATERIAL, newSalt);

    const entries = vault.entries.map((entry) => {
        if (!entry.passwordEnc) return entry;

        try {
            const plain = decrypt(entry.passwordEnc, oldKey);

            return { ...entry, passwordEnc: encrypt(plain, newKey) };
        } catch {
            return entry;
        }
    });

    derivedKey = newKey;

    saveVault({
        salt: newSalt.toString('base64'),
        verifier: newKey.toString('base64'),
        protected: false,
        entries
    });

    return { ok: true };
}

function unlockVault(masterPassword) {
    const vault = getVault();

    if (!vault) {
        return { ok: false, error: 'No password vault has been set up yet' };
    }

    const salt = Buffer.from(vault.salt, 'base64');

    const key = deriveKey(masterPassword, salt);

    if (key.toString('base64') !== vault.verifier) {
        return { ok: false, error: 'Incorrect master password' };
    }

    derivedKey = key;

    return { ok: true };
}

function lockVault() {
    derivedKey = null;

    return { ok: true };
}

function requireUnlocked() {
    ensureAccessible();

    if (!derivedKey) {
        return { ok: false, error: 'Vault is locked' };
    }

    return { ok: true };
}

function getEntries(includePasswords = false) {
    ensureAccessible();

    const vault = getVault();

    if (!vault) return [];

    return vault.entries.map((entry) =>
        includePasswords && isUnlocked() ? toUnlockedEntry(entry) : toPublicEntry(entry)
    );
}

function findEntriesForUrl(url) {
    const host = hostnameOf(url);

    if (!host) return [];

    return getEntries(isUnlocked()).filter((entry) => hostnameOf(entry.url) === host);
}

function findEntryByUrlAndUsername(url, username) {
    const vault = getVault();

    if (!vault) return null;

    const targetUrl = normalizeUrl(url);

    const targetUsername = String(username || '').trim();

    return (
        vault.entries.find(
            (entry) =>
                normalizeUrl(entry.url) === targetUrl &&
                String(entry.username || '').trim() === targetUsername
        ) || null
    );
}

function hasMatchingEntry(url, username) {
    return findEntryByUrlAndUsername(url, username) !== null;
}

function shouldStoreCapturedLogin(capture) {
    const candidateUrl = String(capture && capture.url ? capture.url : '').trim();

    if (!candidateUrl) return false;

    const normalizedUrl = normalizeUrl(candidateUrl);

    const excluded = getExcludedOrigins();

    if (excluded.includes(normalizedUrl)) return false;

    const formFields = Array.isArray(capture && capture.formFields) ? capture.formFields : [];
    const pageHints = Array.isArray(capture && capture.pageHints) ? capture.pageHints : [];

    const combinedHint = [formFields.join(' '), pageHints.join(' '), normalizedUrl]
        .join(' ')
        .toLowerCase();

    if (/current password|new password|confirm password|old password/.test(combinedHint)) {
        return false;
    }

    const urlHint = normalizedUrl.toLowerCase();

    if (/password\/change|reset|forgot|recover/.test(urlHint)) return false;

    if (/invalid credentials|sign in failed|login failed|incorrect password/.test(combinedHint)) {
        return false;
    }

    return true;
}

function setExcludedOrigin(url) {
    const normalizedUrl = normalizeUrl(url);

    if (!normalizedUrl) return { ok: false, error: 'URL is required' };

    const excluded = getExcludedOrigins();

    if (!excluded.includes(normalizedUrl)) {
        excluded.push(normalizedUrl);
        saveExcludedOrigins(excluded);
    }

    return { ok: true };
}

function saveCapturedLogin(capture) {
    if (!shouldStoreCapturedLogin(capture)) {
        return { ok: false, error: 'Login capture skipped' };
    }

    const { title, url, username, password } = capture;

    const existing = findEntryByUrlAndUsername(url, username);

    if (existing) {
        return updateEntry(existing.id, { title, url, username, password });
    }

    return addEntry({ title, url, username, password });
}

function addEntry({ title, url, username, password }) {
    const unlocked = requireUnlocked();

    if (!unlocked.ok) return unlocked;

    const trimmedTitle = String(title || '').trim();

    const trimmedUrl = String(url || '').trim();

    const trimmedUsername = String(username || '').trim();

    const trimmedPassword = String(password || '');

    if (!trimmedTitle) {
        return { ok: false, error: 'Title is required' };
    }

    if (!trimmedUrl) {
        return { ok: false, error: 'URL is required' };
    }

    const vault = getVault();

    const now = new Date().toISOString();

    const entry = {
        id: generateId(),
        title: trimmedTitle,
        url: normalizeUrl(trimmedUrl),
        username: trimmedUsername,
        passwordEnc: encrypt(trimmedPassword, derivedKey),
        createdAt: now,
        updatedAt: now
    };

    vault.entries.push(entry);

    saveVault(vault);

    return { ok: true, entry: toUnlockedEntry(entry) };
}

function updateEntry(id, updates) {
    const unlocked = requireUnlocked();

    if (!unlocked.ok) return unlocked;

    const vault = getVault();

    const index = vault.entries.findIndex((entry) => entry.id === id);

    if (index === -1) {
        return { ok: false, error: 'Password entry not found' };
    }

    const entry = vault.entries[index];

    if (updates.title !== undefined) {
        const trimmedTitle = String(updates.title || '').trim();

        if (!trimmedTitle) {
            return { ok: false, error: 'Title is required' };
        }

        entry.title = trimmedTitle;
    }

    if (updates.url !== undefined) {
        const trimmedUrl = String(updates.url || '').trim();

        if (!trimmedUrl) {
            return { ok: false, error: 'URL is required' };
        }

        entry.url = normalizeUrl(trimmedUrl);
    }

    if (updates.username !== undefined) {
        entry.username = String(updates.username || '').trim();
    }

    if (updates.password !== undefined) {
        entry.passwordEnc = encrypt(String(updates.password || ''), derivedKey);
    }

    entry.updatedAt = new Date().toISOString();

    saveVault(vault);

    return { ok: true, entry: toUnlockedEntry(entry) };
}

function deleteEntry(id) {
    const unlocked = requireUnlocked();

    if (!unlocked.ok) return unlocked;

    const vault = getVault();

    const entry = vault.entries.find((item) => item.id === id);

    if (!entry) {
        return { ok: false, error: 'Password entry not found' };
    }

    vault.entries = vault.entries.filter((item) => item.id !== id);

    saveVault(vault);

    return { ok: true, url: entry.url, username: entry.username };
}

function getEntryPassword(id) {
    const unlocked = requireUnlocked();

    if (!unlocked.ok) return unlocked;

    const vault = getVault();

    const entry = vault.entries.find((item) => item.id === id);

    if (!entry) {
        return { ok: false, error: 'Password entry not found' };
    }

    try {
        return { ok: true, password: decrypt(entry.passwordEnc, derivedKey) };
    } catch {
        return { ok: false, error: 'Could not decrypt password' };
    }
}

function passwordState() {
    ensureAccessible();

    return {
        protected: isVaultProtected(),
        unlocked: isUnlocked(),
        entries: getEntries(true)
    };
}

module.exports = {
    isVaultSetup,
    isVaultProtected,
    isUnlocked,
    setupVault,
    removeMasterPassword,
    unlockVault,
    lockVault,
    getEntries,
    findEntriesForUrl,
    findEntryByUrlAndUsername,
    hasMatchingEntry,
    saveCapturedLogin,
    addEntry,
    updateEntry,
    deleteEntry,
    getEntryPassword,
    passwordState,
    shouldStoreCapturedLogin,
    setExcludedOrigin,
    verifyMasterPassword
};
