const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const Store = require('electron-store').default;

/*
    Exercises the exact construction settingsStore.js uses
    (clearInvalidConfig: true) against a real corrupted file on disk,
    with an explicit absolute cwd standing in for the userData
    directory electron-store would otherwise resolve via Electron
*/

function makeCorruptedStoreDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webdesk-settings-test-'));

    fs.writeFileSync(path.join(dir, 'settings.json'), '{ this is not valid json');

    return dir;
}

test('a corrupted settings.json does not throw when read', () => {
    const dir = makeCorruptedStoreDir();

    const store = new Store({ cwd: dir, name: 'settings', clearInvalidConfig: true });

    assert.doesNotThrow(() => store.get('websiteUrl'));

    assert.equal(store.get('websiteUrl'), undefined);
});

test('a store recovered from corruption is still writable', () => {
    const dir = makeCorruptedStoreDir();

    const store = new Store({ cwd: dir, name: 'settings', clearInvalidConfig: true });

    store.set('websiteUrl', 'https://example.com');

    assert.equal(store.get('websiteUrl'), 'https://example.com');
});

test('without clearInvalidConfig, the same corrupted file throws (documents why the option is needed)', () => {
    const dir = makeCorruptedStoreDir();

    assert.throws(() => new Store({ cwd: dir, name: 'settings' }), /SyntaxError|JSON/);
});

test('a missing settings.json (fresh install) is not treated as corrupted', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webdesk-settings-test-'));

    const store = new Store({ cwd: dir, name: 'settings', clearInvalidConfig: true });

    assert.equal(store.get('websiteUrl'), undefined);
});
