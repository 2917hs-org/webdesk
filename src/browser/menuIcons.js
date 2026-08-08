const { BrowserWindow, nativeImage } = require('electron');

/*
    The same glyphs the toolbar draws with CSS's currentColor, redrawn
    here as flat black shapes — a native Menu icon has no CSS to
    inherit color from, and macOS re-tints a "template" image itself
    (dark gray in light mode, light gray in dark, white on a
    highlighted row), the same way it tints every other menu icon in
    the system. Getting that for free is the reason every path below is
    plain black rather than any particular color.
*/

const ICON_MARKUP = {
    download:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.2v7.6M4.8 6.8 8 9.9l3.2-3.1"/><path d="M2.8 11v1.6c0 .7.5 1.2 1.2 1.2h8c.7 0 1.2-.5 1.2-1.2V11"/></svg>',

    favourite:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round"><path d="M8 2.1l1.7 3.5 3.8.6-2.8 2.7.7 3.8-3.4-1.8-3.4 1.8.7-3.8-2.8-2.7 3.8-.6L8 2.1Z"/></svg>',

    favouriteFilled:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="#000" stroke="none"><path d="M8 2.1l1.7 3.5 3.8.6-2.8 2.7.7 3.8-3.4-1.8-3.4 1.8.7-3.8-2.8-2.7 3.8-.6L8 2.1Z"/></svg>',

    groupTabs:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round"><rect x="2" y="2" width="7" height="7" rx="1.5"/><rect x="7" y="7" width="7" height="7" rx="1.5"/></svg>',

    passwords:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.1" cy="10.9" r="2.3"/><path d="M6.8 9.2 13.2 2.8"/><path d="M11.2 4.8l1.5 1.5"/><path d="M9.6 6.4l1.2 1.2"/></svg>',

    appearance:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 1 0 12Z" fill="#000" stroke="none"/></svg>',

    home: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8.5 8 4l5.5 4.5"/><path d="M4 7.3V13h8V7.3"/></svg>',

    back: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg>',

    forward:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5"/></svg>',

    newTab: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',

    newWindow:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round"><path d="M8 1.6v12.8M1.6 8h12.8"/></svg>',

    copy: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M3.5 10.5V3.7c0-.66.54-1.2 1.2-1.2h6.8"/></svg>',

    translate:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.7h6.4M5.2 2.3v1.4M6.7 3.7c-.5 2.6-2.1 4.6-4.3 5.9M3.1 6.2c1 1.4 2.4 2.4 4.1 2.9"/><path d="m9.6 13.4 2.9-6.6 2.9 6.6M10.4 11.4h4.2" stroke-linejoin="round"/></svg>'
};

/*
    Rasterized at 2x (32px) for a crisp Retina source, then resized
    back down to DISPLAY_SIZE — a NativeImage carries no notion of "this
    32px bitmap is really a 16px icon at 2x", so left at its native
    pixel size a menu would draw it twice as big as the toolbar's own
    14px icons. The resize is what actually fixes the display size;
    rasterizing at 2x first is only there to keep it from looking soft.
*/

const SIZE = 32;

const DISPLAY_SIZE = 14;

let iconsPromise = null;

/*
    There is no SVG rasterizer in node_modules, and adding one just for
    a handful of menu glyphs would be a lot of weight for a small
    payoff — but Chromium, which this app already ships, can parse an
    SVG perfectly well. A throwaway, invisible window stands in for a
    rasterizer: it draws each icon onto a <canvas> and hands back a PNG,
    which becomes a real NativeImage back on this side. Runs once; the
    resulting icons are cached and handed to every context menu after.
*/

function rasterize() {
    if (iconsPromise) return iconsPromise;

    iconsPromise = new Promise((resolve) => {
        const win = new BrowserWindow({
            show: false,

            width: 10,

            height: 10,

            webPreferences: {
                contextIsolation: true,

                nodeIntegration: false,

                sandbox: true
            }
        });

        const script =
            'window.__rasterize = async () => {' +
            'const icons = ' +
            JSON.stringify(ICON_MARKUP) +
            ';' +
            'const size = ' +
            SIZE +
            ';' +
            'const out = {};' +
            'for (const key of Object.keys(icons)) {' +
            'const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(icons[key]);' +
            'const img = new Image();' +
            'await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });' +
            'const canvas = document.createElement("canvas");' +
            'canvas.width = size; canvas.height = size;' +
            'canvas.getContext("2d").drawImage(img, 0, 0, size, size);' +
            'out[key] = canvas.toDataURL("image/png");' +
            '}' +
            'return out;' +
            '};';

        const html = '<!doctype html><html><body><script>' + script + '</script></body></html>';

        win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

        win.webContents.once('did-finish-load', async () => {
            let icons = {};

            try {
                const dataUrls = await win.webContents.executeJavaScript('window.__rasterize()');

                for (const key of Object.keys(dataUrls)) {
                    const image = nativeImage
                        .createFromDataURL(dataUrls[key])
                        .resize({ width: DISPLAY_SIZE, height: DISPLAY_SIZE });

                    image.setTemplateImage(true);

                    icons[key] = image;
                }
            } catch {
                /*
                    Menu items still work with no icon at all — this is
                    a cosmetic layer, not a load-bearing one
                */

                icons = {};
            }

            if (!win.isDestroyed()) win.destroy();

            resolve(icons);
        });
    });

    return iconsPromise;
}

module.exports = {
    rasterize
};
