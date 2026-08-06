const { ipcRenderer } = require('electron');

/*
    Runs inside each tab. Injects a small script into the page so login
    forms can be watched from the page's own JavaScript context, then
    forwards captured credentials to the main process.
*/

const CAPTURE_SCRIPT = `
(function () {
    if (window.__webdeskLoginCaptureInstalled) return;

    window.__webdeskLoginCaptureInstalled = true;

    let lastCaptureAt = 0;

    function findUsernameInput(form, passwordInput) {
        const byAutocomplete = form.querySelector(
            'input[autocomplete="username"], input[autocomplete="email"]'
        );

        if (byAutocomplete && byAutocomplete !== passwordInput) {
            return byAutocomplete;
        }

        const emailInput = form.querySelector('input[type="email"]');

        if (emailInput && emailInput !== passwordInput) {
            return emailInput;
        }

        const candidates = Array.from(
            form.querySelectorAll('input[type="text"], input[type="tel"], input:not([type])')
        ).filter(function (input) {
            return (
                input !== passwordInput &&
                input.type !== 'hidden' &&
                input.type !== 'password' &&
                input.type !== 'submit' &&
                input.type !== 'button'
            );
        });

        for (let index = 0; index < candidates.length; index += 1) {
            const hint = (
                (candidates[index].name || '') +
                (candidates[index].id || '') +
                (candidates[index].placeholder || '')
            ).toLowerCase();

            if (/user|email|login|account|name/.test(hint)) {
                return candidates[index];
            }
        }

        return candidates[0] || null;
    }

    function reportCapture(form) {
        const passwordInput = form.querySelector('input[type="password"]');

        if (!passwordInput || !passwordInput.value) return;

        const usernameInput = findUsernameInput(form, passwordInput);

        const username = usernameInput ? String(usernameInput.value || '').trim() : '';

        const now = Date.now();

        if (now - lastCaptureAt < 2000) return;

        lastCaptureAt = now;

        window.postMessage(
            {
                channel: 'webdesk-login-capture',
                username: username,
                password: passwordInput.value,
                url: location.href,
                title: document.title
            },
            '*'
        );
    }

    document.addEventListener(
        'submit',
        function (event) {
            if (!(event.target instanceof HTMLFormElement)) return;

            reportCapture(event.target);
        },
        true
    );
})();
`;

function injectCaptureScript() {
    if (window.__webdeskLoginCaptureInjected) return;

    window.__webdeskLoginCaptureInjected = true;

    const script = document.createElement('script');

    script.textContent = CAPTURE_SCRIPT;

    (document.head || document.documentElement).appendChild(script);

    script.remove();
}

window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const data = event.data;

    if (!data || data.channel !== 'webdesk-login-capture') return;

    ipcRenderer.send('login-detected', {
        username: data.username,
        password: data.password,
        url: data.url,
        title: data.title
    });
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCaptureScript);
} else {
    injectCaptureScript();
}

document.addEventListener('DOMContentLoaded', injectCaptureScript);
