/*
    Frees the renderer for any background tab that has sat idle for
    IDLE_MS, so a window left open for hours with a dozen tabs in it
    doesn't keep a dozen live Chromium renderers around for tabs no one
    is looking at. tabManager.getSuspendCandidates() already excludes
    the active tab, already-suspended tabs, and anything currently
    playing audio or video — this just drives that check on a timer and
    acts on the result.
*/

const IDLE_MS = 10 * 60 * 1000;

const CHECK_INTERVAL_MS = 60 * 1000;

function startSuspendWatcher(ctx) {
    const timer = setInterval(() => {
        for (const id of ctx.tabs.getSuspendCandidates(IDLE_MS)) {
            ctx.tabs.suspendTab(id);
        }
    }, CHECK_INTERVAL_MS);

    ctx.window.on('closed', () => {
        clearInterval(timer);
    });
}

module.exports = {
    startSuspendWatcher,
    IDLE_MS
};
