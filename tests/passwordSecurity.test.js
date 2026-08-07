const test = require('node:test');
const assert = require('node:assert/strict');

process.env.WEBDESK_PROJECT_NAME = `webdesk-tests-${process.pid}-${Date.now()}`;

const passwordStore = require('../src/passwords/passwordStore');
const credentialStore = require('../src/passwords/credentialStore');
const store = require('../src/storage/settingsStore');

test('excluded origins suppress login captures', { concurrency: false }, () => {
    store.clear();
    passwordStore.lockVault();

    const setup = passwordStore.setupVault('StrongPass123');

    assert.equal(setup.ok, true);

    const unlock = passwordStore.unlockVault('StrongPass123');

    assert.equal(unlock.ok, true);

    const excluded = passwordStore.setExcludedOrigin('https://example.com/login');

    assert.equal(excluded.ok, true);

    const shouldStore = passwordStore.shouldStoreCapturedLogin({
        url: 'https://example.com/login',
        username: 'demo@example.com',
        password: 'secret123'
    });

    assert.equal(shouldStore, false);
});

test('change-password forms are not treated as login captures', { concurrency: false }, () => {
    store.clear();
    passwordStore.lockVault();

    const setup = passwordStore.setupVault('StrongPass123');

    assert.equal(setup.ok, true);

    const unlock = passwordStore.unlockVault('StrongPass123');

    assert.equal(unlock.ok, true);

    const shouldStore = passwordStore.shouldStoreCapturedLogin({
        url: 'https://example.com/password/change',
        username: 'demo@example.com',
        password: 'NewPassword!456',
        formFields: ['currentPassword', 'newPassword', 'confirmPassword']
    });

    assert.equal(shouldStore, false);
});

test('origin validation rejects cross-origin requests', { concurrency: false }, () => {
    assert.equal(
        credentialStore.isOriginAllowed('https://example.com', 'https://example.com'),
        true
    );
    assert.equal(
        credentialStore.isOriginAllowed('https://example.com', 'https://evil-example.com'),
        false
    );
});

test('master password verification rejects the wrong password', { concurrency: false }, () => {
    store.clear();
    passwordStore.lockVault();

    const setup = passwordStore.setupVault('StrongPass123');

    assert.equal(setup.ok, true);

    const correct = passwordStore.verifyMasterPassword('StrongPass123');
    const wrong = passwordStore.verifyMasterPassword('WrongPassword');

    assert.equal(correct, true);
    assert.equal(wrong, false);
});

test(
    'failed-login pages are not treated as successful login captures',
    { concurrency: false },
    () => {
        store.clear();
        passwordStore.lockVault();

        const setup = passwordStore.setupVault('StrongPass123');

        assert.equal(setup.ok, true);

        const unlock = passwordStore.unlockVault('StrongPass123');

        assert.equal(unlock.ok, true);

        const shouldStore = passwordStore.shouldStoreCapturedLogin({
            url: 'https://example.com/login',
            username: 'demo@example.com',
            password: 'wrong-password',
            formFields: ['username', 'password'],
            pageHints: ['invalid credentials', 'sign in failed']
        });

        assert.equal(shouldStore, false);
    }
);
