const test = require('node:test');
const assert = require('node:assert/strict');

process.env.WEBDESK_PROJECT_NAME = `webdesk-tests-${process.pid}-${Date.now()}`;

const passwordStore = require('../src/passwords/passwordStore');
const store = require('../src/storage/settingsStore');

test('a fresh vault is usable with no master password at all', { concurrency: false }, () => {
    store.clear();

    assert.equal(passwordStore.isVaultProtected(), false);
    assert.equal(passwordStore.isUnlocked(), true);

    const added = passwordStore.addEntry({
        title: 'Example',
        url: 'https://example.com',
        username: 'demo@example.com',
        password: 'secret123'
    });

    assert.equal(added.ok, true);
    assert.equal(added.entry.password, 'secret123');

    const state = passwordStore.passwordState();

    assert.equal(state.protected, false);
    assert.equal(state.unlocked, true);
    assert.equal(state.entries.length, 1);
    assert.equal(state.entries[0].password, 'secret123');
});

test('locking an unprotected vault has no lasting effect', { concurrency: false }, () => {
    store.clear();

    passwordStore.addEntry({
        title: 'Example',
        url: 'https://example.com',
        username: 'demo@example.com',
        password: 'secret123'
    });

    passwordStore.lockVault();

    // No master password was ever chosen, so nothing should stay locked
    assert.equal(passwordStore.isUnlocked(), true);

    const state = passwordStore.passwordState();

    assert.equal(state.entries[0].password, 'secret123');
});

test('choosing a master password protects an existing vault and keeps entries readable', { concurrency: false }, () => {
    store.clear();

    passwordStore.addEntry({
        title: 'Example',
        url: 'https://example.com',
        username: 'demo@example.com',
        password: 'secret123'
    });

    const setup = passwordStore.setupVault('NewMasterPass1');

    assert.equal(setup.ok, true);
    assert.equal(passwordStore.isVaultProtected(), true);

    // Immediately usable with the just-chosen password, no re-entry needed
    assert.equal(passwordStore.isUnlocked(), true);

    const stateWhileUnlocked = passwordStore.passwordState();

    assert.equal(stateWhileUnlocked.entries.length, 1);
    assert.equal(stateWhileUnlocked.entries[0].password, 'secret123');

    passwordStore.lockVault();

    assert.equal(passwordStore.isUnlocked(), false);

    const unlockWrong = passwordStore.unlockVault('WrongPassword');

    assert.equal(unlockWrong.ok, false);

    const unlockRight = passwordStore.unlockVault('NewMasterPass1');

    assert.equal(unlockRight.ok, true);

    const stateAfterUnlock = passwordStore.passwordState();

    assert.equal(stateAfterUnlock.entries[0].password, 'secret123');
});

test('updating an already-set master password re-encrypts under the new one', { concurrency: false }, () => {
    store.clear();

    passwordStore.setupVault('FirstPassword1');

    passwordStore.addEntry({
        title: 'Example',
        url: 'https://example.com',
        username: 'demo@example.com',
        password: 'secret123'
    });

    const update = passwordStore.setupVault('SecondPassword2');

    assert.equal(update.ok, true);

    // Still unlocked immediately under the new password
    const state = passwordStore.passwordState();

    assert.equal(state.entries[0].password, 'secret123');

    passwordStore.lockVault();

    const oldPasswordFails = passwordStore.unlockVault('FirstPassword1');

    assert.equal(oldPasswordFails.ok, false);

    const newPasswordWorks = passwordStore.unlockVault('SecondPassword2');

    assert.equal(newPasswordWorks.ok, true);
});

test('changing the master password while locked is refused, not silently corrupting data', { concurrency: false }, () => {
    store.clear();

    passwordStore.setupVault('FirstPassword1');

    passwordStore.addEntry({
        title: 'Example',
        url: 'https://example.com',
        username: 'demo@example.com',
        password: 'secret123'
    });

    passwordStore.lockVault();

    const blocked = passwordStore.setupVault('AttemptedNewPassword');

    assert.equal(blocked.ok, false);

    // The original password must still work — nothing was re-encrypted
    const unlock = passwordStore.unlockVault('FirstPassword1');

    assert.equal(unlock.ok, true);

    const state = passwordStore.passwordState();

    assert.equal(state.entries[0].password, 'secret123');
});

test('a vault saved before this feature existed stays protected', { concurrency: false }, () => {
    store.clear();

    const crypto = require('crypto');

    const salt = crypto.randomBytes(32);

    const legacyKey = crypto.scryptSync('LegacyPassword1', salt, 32, {
        N: 16384,
        r: 8,
        p: 1,
        maxmem: 64 * 1024 * 1024
    });

    // Written directly, the way it would have been by the pre-feature
    // code — no "protected" field at all
    store.set('passwordVault', {
        salt: salt.toString('base64'),
        verifier: legacyKey.toString('base64'),
        entries: []
    });

    passwordStore.lockVault();

    assert.equal(passwordStore.isVaultProtected(), true);
    assert.equal(passwordStore.isUnlocked(), false);

    const unlock = passwordStore.unlockVault('LegacyPassword1');

    assert.equal(unlock.ok, true);
});
