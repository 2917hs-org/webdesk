const store = require('../storage/settingsStore');

/*
    The site the app is pinned to, chosen during setup and editable
    from the home button afterwards.
*/

function getWebsiteUrl() {
    return store.get('websiteUrl');
}

function setWebsiteUrl(url) {
    store.set('websiteUrl', url);
}

module.exports = {
    getWebsiteUrl,
    setWebsiteUrl
};
