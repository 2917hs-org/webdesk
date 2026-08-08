const Store = require('electron-store').default;

const packageJson = require('../../package.json');

const store = new Store({
    name: 'settings',
    projectName: process.env.WEBDESK_PROJECT_NAME || packageJson.name || 'webdesk',

    /*
        A settings.json that fails to parse (truncated by a crash
        mid-write, edited by hand and left invalid, etc.) is reset to
        defaults instead of throwing, so a corrupted file degrades to a
        fresh install rather than preventing the app from launching at all
    */

    clearInvalidConfig: true
});

module.exports = store;
