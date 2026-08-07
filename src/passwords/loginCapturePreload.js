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

    let pendingCaptureTimer = null;

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

    function buildCapturePayload(form) {
        const passwordInput = form.querySelector('input[type="password"]');

        if (!passwordInput || !passwordInput.value) return null;

        const usernameInput = findUsernameInput(form, passwordInput);

        const username = usernameInput ? String(usernameInput.value || '').trim() : '';

        const formFields = Array.from(form.querySelectorAll('input, select, textarea'))
            .filter((field) => field && field.name)
            .map((field) => field.name)
            .filter(Boolean);

        return {
            channel: 'webdesk-login-capture',
            username,
            password: passwordInput.value,
            url: location.href,
            title: document.title,
            formFields,
            viaAutofill: Boolean(form.__webdeskAutofilled)
        };
    }

    function reportCapture(form) {
        const payload = buildCapturePayload(form);

        if (!payload) return;

        const now = Date.now();

        if (now - lastCaptureAt < 2000) return;

        lastCaptureAt = now;

        window.postMessage(payload, '*');
    }

    function scheduleCapture(form) {
        if (pendingCaptureTimer) {
            clearTimeout(pendingCaptureTimer);
        }

        pendingCaptureTimer = setTimeout(() => {
            pendingCaptureTimer = null;
            reportCapture(form);
        }, 500);
    }

    function maybeCaptureFromForm(form) {
        if (!form || !(form instanceof HTMLFormElement)) return;

        if (!buildCapturePayload(form)) return;

        reportCapture(form);
    }

    document.addEventListener(
        'submit',
        function (event) {
            if (!(event.target instanceof HTMLFormElement)) return;

            maybeCaptureFromForm(event.target);
        },
        true
    );

    document.addEventListener(
        'keydown',
        function (event) {
            const target = event.target;

            if (!(target instanceof HTMLInputElement)) return;

            const key = event.key || '';
            const isEnter = key === 'Enter' || event.keyCode === 13 || event.which === 13;

            if (!isEnter) return;

            const form = target.closest('form');

            if (!form) return;

            if (!buildCapturePayload(form)) return;

            scheduleCapture(form);
        },
        true
    );

    document.addEventListener(
        'click',
        function (event) {
            const target = event.target;

            if (!(target instanceof HTMLElement)) return;

            const button = target.closest('button, input[type="submit"], input[type="button"]');

            if (!button) return;

            const form = button.closest('form');

            if (!form) return;

            maybeCaptureFromForm(form);
        },
        true
    );

    /*
        In-page suggestion dropdown, shown on focusing a username or
        password field that belongs to a form with a password field —
        the same shape a browser's own autofill uses, rather than a
        banner elsewhere in the window the field itself isn't near
    */

    let nextRequestId = 1;

    let pendingRequestId = null;

    let pendingField = null;

    let dropdownEl = null;

    function isCandidateField(field) {
        if (!(field instanceof HTMLInputElement)) return false;

        const form = field.closest('form');

        if (!form || !form.querySelector('input[type="password"]')) return false;

        if (field.type === 'password') return true;

        return (
            field.type === 'text' ||
            field.type === 'email' ||
            field.type === 'tel' ||
            !field.getAttribute('type')
        );
    }

    function removeDropdown() {
        if (dropdownEl) {
            dropdownEl.remove();

            dropdownEl = null;
        }

        pendingRequestId = null;

        pendingField = null;
    }

    function selectAccount(username) {
        window.postMessage({ channel: 'webdesk-autofill-select', username: username }, '*');

        removeDropdown();
    }

    function renderDropdown(field, accounts) {
        removeDropdown();

        if (!accounts.length) return;

        const rect = field.getBoundingClientRect();

        const box = document.createElement('div');

        box.style.cssText =
            'position:fixed;z-index:2147483647;background:#fff;color:#1d1d1f;' +
            'border:1px solid #d0d0d5;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.18);' +
            'font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden;' +
            'min-width:' +
            Math.max(220, rect.width) +
            'px;' +
            'top:' +
            (rect.bottom + 4) +
            'px;left:' +
            rect.left +
            'px;';

        accounts.forEach(function (account) {
            const row = document.createElement('div');

            row.style.cssText =
                'display:flex;align-items:center;justify-content:space-between;gap:10px;' +
                'padding:8px 8px 8px 12px;cursor:pointer;white-space:nowrap;';

            const label = document.createElement('span');

            label.textContent = account.username;

            label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';

            const removeButton = document.createElement('span');

            removeButton.textContent = '×';

            removeButton.title = 'Remove from suggestions';

            removeButton.style.cssText =
                'flex:none;width:16px;height:16px;line-height:16px;text-align:center;' +
                'border-radius:50%;color:#8a8a90;font-size:13px;cursor:pointer;';

            removeButton.addEventListener('mouseenter', function () {
                removeButton.style.background = '#e5e5ea';

                removeButton.style.color = '#1d1d1f';
            });

            removeButton.addEventListener('mouseleave', function () {
                removeButton.style.background = '';

                removeButton.style.color = '#8a8a90';
            });

            /*
                stopPropagation so the row underneath doesn't also treat
                this as a selection, preventDefault so the field doesn't
                blur and tear the whole dropdown down first
            */

            removeButton.addEventListener('mousedown', function (event) {
                event.preventDefault();

                event.stopPropagation();

                window.postMessage(
                    { channel: 'webdesk-autofill-hide', username: account.username },
                    '*'
                );

                row.remove();

                if (dropdownEl && !dropdownEl.children.length) removeDropdown();
            });

            row.appendChild(label);

            row.appendChild(removeButton);

            row.addEventListener('mouseenter', function () {
                row.style.background = '#f0f6ff';
            });

            row.addEventListener('mouseleave', function () {
                row.style.background = '';
            });

            /*
                mousedown with preventDefault, not click — this fires
                before the field would otherwise blur and tear the
                dropdown down out from under the click
            */

            row.addEventListener('mousedown', function (event) {
                event.preventDefault();

                selectAccount(account.username);
            });

            box.appendChild(row);
        });

        document.body.appendChild(box);

        dropdownEl = box;
    }

    function requestSuggestions(field) {
        const requestId = nextRequestId;

        nextRequestId += 1;

        pendingRequestId = requestId;

        pendingField = field;

        window.postMessage({ channel: 'webdesk-autofill-suggest-request', requestId: requestId }, '*');
    }

    document.addEventListener(
        'focus',
        function (event) {
            const target = event.target;

            if (!isCandidateField(target)) return;

            requestSuggestions(target);
        },
        true
    );

    document.addEventListener(
        'blur',
        function (event) {
            if (event.target === pendingField) removeDropdown();
        },
        true
    );

    document.addEventListener('scroll', removeDropdown, true);

    window.addEventListener('resize', removeDropdown);

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') removeDropdown();
    });

    window.addEventListener('message', function (event) {
        if (event.source !== window) return;

        const data = event.data;

        if (!data || data.channel !== 'webdesk-autofill-suggest-response') return;

        if (data.requestId !== pendingRequestId) return;

        if (!pendingField || document.activeElement !== pendingField) return;

        renderDropdown(pendingField, Array.isArray(data.accounts) ? data.accounts : []);
    });
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

    if (!data) return;

    if (data.channel === 'webdesk-login-capture') {
        ipcRenderer.send('login-detected', {
            username: data.username,
            password: data.password,
            url: data.url,
            title: data.title,
            formFields: data.formFields || [],
            viaAutofill: Boolean(data.viaAutofill)
        });

        return;
    }

    /*
        Suggestion dropdown bridge. The page world never learns anything
        beyond a list of usernames here — the origin is never taken from
        the page either, since the main process derives it itself from
        this tab's own webContents, not from anything postMessage carries
    */

    if (data.channel === 'webdesk-autofill-suggest-request') {
        ipcRenderer
            .invoke('autofill-lookup')
            .then((accounts) => {
                window.postMessage(
                    {
                        channel: 'webdesk-autofill-suggest-response',
                        requestId: data.requestId,
                        accounts: accounts || []
                    },
                    '*'
                );
            })
            .catch(() => {});

        return;
    }

    if (data.channel === 'webdesk-autofill-select') {
        ipcRenderer.send('autofill-fill', { username: data.username });

        return;
    }

    if (data.channel === 'webdesk-autofill-hide') {
        ipcRenderer.send('autofill-hide-suggestion', { username: data.username });
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectCaptureScript);
} else {
    injectCaptureScript();
}

document.addEventListener('DOMContentLoaded', injectCaptureScript);
