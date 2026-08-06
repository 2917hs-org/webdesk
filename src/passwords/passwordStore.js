const crypto = require('crypto');

const store = require('../storage/settingsStore');

const VAULT_KEY = 'passwordVault';

const ALGORITHM = 'aes-256-gcm';

const KEY_LENGTH = 32;

const IV_LENGTH = 12;

const SALT_LENGTH = 32;

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const MIN_MASTER_LENGTH = 8;

/*
    The derived key lives only in memory. Once the vault is locked,
    nothing in the renderer can read stored passwords until it is
    unlocked again with the master password.
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
    return getVault() !== null;
}

function isUnlocked() {
    return derivedKey !== null;
}

function validateMasterPassword(masterPassword) {
    const password = String(masterPassword || '');

    if (password.length < MIN_MASTER_LENGTH) {
        return { ok: false, error: `Master password must be at least ${MIN_MASTER_LENGTH} characters` };
    }

    return { ok: true };
}

function setupVault(masterPassword) {
    const validation = validateMasterPassword(masterPassword);

    if (!validation.ok) return validation;

    if (isVaultSetup()) {
        return { ok: false, error: 'A password vault already exists' };
    }

    const salt = crypto.randomBytes(SALT_LENGTH);

    const key = deriveKey(masterPassword, salt);

    derivedKey = key;

    saveVault({
        salt: salt.toString('base64'),
        verifier: key.toString('base64'),
        entries: []
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
    if (!derivedKey) {
        return { ok: false, error: 'Vault is locked' };
    }

    return { ok: true };
}

function getEntries(includePasswords = false) {
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

function saveCapturedLogin({ title, url, username, password }) {
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

    const before = vault.entries.length;

    vault.entries = vault.entries.filter((entry) => entry.id !== id);

    if (vault.entries.length === before) {
        return { ok: false, error: 'Password entry not found' };
    }

    saveVault(vault);

    return { ok: true };
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
    return {
        setup: isVaultSetup(),
        unlocked: isUnlocked(),
        entries: getEntries(isUnlocked())
    };
}

module.exports = {
    isVaultSetup,
    isUnlocked,
    setupVault,
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
    MIN_MASTER_LENGTH
};
