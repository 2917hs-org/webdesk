const test = require('node:test');
const assert = require('node:assert/strict');

process.env.WEBDESK_PROJECT_NAME = `webdesk-tests-${process.pid}-${Date.now()}`;

const passwordStore = require('../src/passwords/passwordStore');
const store = require('../src/storage/settingsStore');

test(
    'saveCapturedLogin stores a new credential and updates matching entries',
    { concurrency: false },
    () => {
        store.clear();
        passwordStore.lockVault();

        const setup = passwordStore.setupVault('StrongPass123');

        assert.equal(setup.ok, true);

        const unlock = passwordStore.unlockVault('StrongPass123');

        assert.equal(unlock.ok, true);

        const firstSave = passwordStore.saveCapturedLogin({
            title: 'Example',
            url: 'https://example.com/login',
            username: 'demo@example.com',
            password: 'secret123'
        });

        assert.equal(firstSave.ok, true);
        assert.equal(firstSave.entry.username, 'demo@example.com');

        const secondSave = passwordStore.saveCapturedLogin({
            title: 'Example',
            url: 'https://example.com/login',
            username: 'demo@example.com',
            password: 'new-secret-456'
        });

        assert.equal(secondSave.ok, true);
        assert.equal(secondSave.entry.password, 'new-secret-456');

        const state = passwordStore.passwordState();

        assert.equal(state.entries.length, 1);
    }
);

test(
    'password state remains available after relocking and unlocking the vault',
    { concurrency: false },
    () => {
        store.clear();
        passwordStore.lockVault();

        const setup = passwordStore.setupVault('StrongPass123');

        assert.equal(setup.ok, true);

        const unlock = passwordStore.unlockVault('StrongPass123');

        assert.equal(unlock.ok, true);

        const save = passwordStore.saveCapturedLogin({
            title: 'Example',
            url: 'https://example.com/login',
            username: 'demo@example.com',
            password: 'secret123'
        });

        assert.equal(save.ok, true);

        passwordStore.lockVault();

        const relockUnlock = passwordStore.unlockVault('StrongPass123');

        assert.equal(relockUnlock.ok, true);

        const state = passwordStore.passwordState();

        assert.equal(state.entries.length, 1);
        assert.equal(state.entries[0].username, 'demo@example.com');
    }
);
