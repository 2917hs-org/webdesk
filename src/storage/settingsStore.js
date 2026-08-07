const Store = require('electron-store').default;

const packageJson = require('../../package.json');

const store = new Store({
    name: 'settings',
    projectName: process.env.WEBDESK_PROJECT_NAME || packageJson.name || 'webdesk'
});

module.exports = store;
