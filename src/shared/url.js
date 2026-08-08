/*
    The one place "is this a website address WebDesk is willing to load"
    gets decided. Used by every navigation entry point — the toolbar,
    bookmarks, the setup window, autofill — so a scheme this rejects
    (javascript:, file:, data:, anything else besides http/https) is
    rejected everywhere at once rather than depending on each caller
    remembering to check.
*/

function isWebUrl(url) {
    try {
        const protocol = new URL(url).protocol;

        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

module.exports = {
    isWebUrl
};
