const { powerSaveBlocker } = require('electron');

/*
    Focus mode fills the screen with the app and keeps it above every
    other window until it is turned off again.

    macOS reserves Cmd+Tab and gives no public API for Do Not Disturb,
    so this cannot stop the machine being used elsewhere. What it can
    do is make sure nothing else is visible while it is on, and that
    switching away reveals nothing.
*/

let focusWindow = null;

let powerBlockerId = null;

let active = false;

let onChange = () => {};

function isActive() {
    return active;
}

function releasePowerBlocker() {
    if (powerBlockerId !== null && powerSaveBlocker.isStarted(powerBlockerId)) {
        powerSaveBlocker.stop(powerBlockerId);
    }

    powerBlockerId = null;
}

function enterFocusMode() {
    if (!focusWindow || active) return active;

    active = true;

    focusWindow.setKiosk(true);

    /*
        'screen-saver' is the level that stays above other apps' full
        screen windows, not just above ordinary ones
    */

    focusWindow.setAlwaysOnTop(true, 'screen-saver');

    focusWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    focusWindow.focus();

    /*
        Someone reading rather than typing should not have the screen
        dim out from under them
    */

    powerBlockerId = powerSaveBlocker.start('prevent-display-sleep');

    onChange(active);

    return active;
}

function exitFocusMode() {
    if (!active) return active;

    active = false;

    if (focusWindow) {
        focusWindow.setVisibleOnAllWorkspaces(false);

        focusWindow.setAlwaysOnTop(false);

        focusWindow.setKiosk(false);
    }

    releasePowerBlocker();

    onChange(active);

    return active;
}

function attachFocusMode(window, changeCallback) {
    focusWindow = window;

    onChange = typeof changeCallback === 'function' ? changeCallback : () => {};

    /*
        Kiosk and the always-on-top flag belong to the window, but the
        power blocker is process-wide and would otherwise outlive it
    */

    window.on('closed', () => {
        releasePowerBlocker();

        focusWindow = null;

        active = false;
    });
}

module.exports = {
    attachFocusMode,
    enterFocusMode,
    exitFocusMode,
    isActive
};
