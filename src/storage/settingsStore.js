const Store = require('electron-store').default;

const store = new Store({
    name: 'settings'
});

module.exports = store;
