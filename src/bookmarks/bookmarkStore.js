const store = require('../storage/settingsStore');

/*
    Bookmarks live in settings.json under "bookmarks", as
    { title, url, favicon } entries in the order they sit on the bar.

    Entries written before favicons existed are read back with an empty
    favicon rather than rewritten, so an older settings.json still loads.
*/

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

function isValidUrl(url) {
    try {
        const protocol = new URL(url).protocol;

        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

/*
    A favicon is handed straight to an <img> in the toolbar, so only the
    schemes that can actually carry an image are kept
*/

function isValidFavicon(favicon) {
    if (typeof favicon !== 'string' || !favicon) return false;

    try {
        const protocol = new URL(favicon).protocol;

        if (protocol === 'http:' || protocol === 'https:') return true;

        return protocol === 'data:' && /^data:image\//i.test(favicon);
    } catch {
        return false;
    }
}

function toEntry(bookmark) {
    const url = bookmark.url;

    return {
        title: String(bookmark.title || url).trim() || url,

        url,

        favicon: isValidFavicon(bookmark.favicon) ? bookmark.favicon : ''
    };
}

function getBookmarks() {
    const bookmarks = store.get('bookmarks', []);

    if (!Array.isArray(bookmarks)) {
        return [];
    }

    return bookmarks
        .filter((bookmark) => bookmark && typeof bookmark.url === 'string')
        .map(toEntry);
}

function indexOfBookmark(bookmarks, url) {
    const target = normalizeUrl(url);

    return bookmarks.findIndex((bookmark) => normalizeUrl(bookmark.url) === target);
}

function isBookmarked(url) {
    if (!isValidUrl(url)) return false;

    return indexOfBookmark(getBookmarks(), url) !== -1;
}

function addBookmark(url, title, favicon) {
    if (!isValidUrl(url)) return getBookmarks();

    if (isBookmarked(url)) return getBookmarks();

    const bookmarks = getBookmarks();

    bookmarks.push(toEntry({ title, url, favicon }));

    store.set('bookmarks', bookmarks);

    return bookmarks;
}

function removeBookmark(url) {
    const target = normalizeUrl(url);

    const bookmarks = getBookmarks().filter((bookmark) => normalizeUrl(bookmark.url) !== target);

    store.set('bookmarks', bookmarks);

    return bookmarks;
}

function toggleBookmark(url, title, favicon) {
    if (isBookmarked(url)) {
        return removeBookmark(url);
    }

    return addBookmark(url, title, favicon);
}

function renameBookmark(url, title) {
    const trimmed = String(title || '').trim();

    if (!trimmed) return getBookmarks();

    const bookmarks = getBookmarks();

    const index = indexOfBookmark(bookmarks, url);

    if (index === -1) return bookmarks;

    bookmarks[index].title = trimmed;

    store.set('bookmarks', bookmarks);

    return bookmarks;
}

/*
    toIndex is where the bookmark should sit once it has been lifted out
    of the bar, which is the position the drag in the toolbar reports
*/

function moveBookmark(url, toIndex) {
    const bookmarks = getBookmarks();

    const from = indexOfBookmark(bookmarks, url);

    if (from === -1) return bookmarks;

    const requested = Number(toIndex);

    if (!Number.isFinite(requested)) return bookmarks;

    const target = Math.max(0, Math.min(bookmarks.length - 1, Math.round(requested)));

    if (target === from) return bookmarks;

    const [moved] = bookmarks.splice(from, 1);

    bookmarks.splice(target, 0, moved);

    store.set('bookmarks', bookmarks);

    return bookmarks;
}

/*
    Lets a bookmark saved before its icon had loaded, or one carried over
    from an older settings.json, pick the icon up on a later visit.

    Returns whether anything changed, so a repeat visit does not rewrite
    settings.json on every navigation.
*/

function updateFavicon(url, favicon) {
    if (!isValidFavicon(favicon)) return false;

    const bookmarks = getBookmarks();

    const index = indexOfBookmark(bookmarks, url);

    if (index === -1) return false;

    if (bookmarks[index].favicon === favicon) return false;

    bookmarks[index].favicon = favicon;

    store.set('bookmarks', bookmarks);

    return true;
}

function isBarVisible() {
    return store.get('bookmarkBarVisible', true) !== false;
}

function setBarVisible(visible) {
    store.set('bookmarkBarVisible', Boolean(visible));

    return isBarVisible();
}

module.exports = {
    getBookmarks,
    isBookmarked,
    addBookmark,
    removeBookmark,
    toggleBookmark,
    renameBookmark,
    moveBookmark,
    updateFavicon,
    isBarVisible,
    setBarVisible,
    isValidUrl
};
