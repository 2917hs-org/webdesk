const test = require('node:test');
const assert = require('node:assert/strict');

const { isWebUrl } = require('../src/shared/url');
const searchEngines = require('../src/search/searchEngines');

test('isWebUrl accepts only http and https', () => {
    assert.equal(isWebUrl('https://example.com'), true);
    assert.equal(isWebUrl('http://example.com'), true);
    assert.equal(isWebUrl('javascript:alert(1)'), false);
    assert.equal(isWebUrl('javascript://%0aalert(1)'), false);
    assert.equal(isWebUrl('file:///etc/passwd'), false);
    assert.equal(isWebUrl('data:text/html,hi'), false);
    assert.equal(isWebUrl('ftp://files.example.com'), false);
    assert.equal(isWebUrl('not a url'), false);
    assert.equal(isWebUrl(''), false);
});

test('resolveInput navigates plain domains, IPs, and localhost as https', () => {
    assert.equal(searchEngines.resolveInput('example.com').url, 'https://example.com');
    assert.equal(searchEngines.resolveInput('leetcode.com/problems').url, 'https://leetcode.com/problems');
    assert.equal(searchEngines.resolveInput('localhost:3000').url, 'https://localhost:3000');
    assert.equal(searchEngines.resolveInput('127.0.0.1:8080').url, 'https://127.0.0.1:8080');
});

test('resolveInput passes explicit http/https straight through', () => {
    assert.deepEqual(searchEngines.resolveInput('https://example.com'), {
        type: 'url',
        url: 'https://example.com',
        query: 'https://example.com'
    });

    assert.equal(searchEngines.resolveInput('http://example.com').url, 'http://example.com');
});

test('resolveInput searches for text with no URL shape', () => {
    const result = searchEngines.resolveInput('define recursion');

    assert.equal(result.type, 'search');
    assert.match(result.url, /define%20recursion/);
});

test('resolveInput never returns a non-http(s) URL to load, even when explicitly scheme-shaped', () => {
    const dangerous = [
        'javascript://%0aalert(document.domain)',
        'javascript:alert(1)',
        'file:///etc/passwd',
        'ftp://files.example.com',
        'data:text/html,hi'
    ];

    for (const input of dangerous) {
        const result = searchEngines.resolveInput(input);

        assert.equal(result.type, 'search', `expected "${input}" to resolve to a search`);
        assert.equal(isWebUrl(result.url), true, `expected "${input}"'s resolved url to be http(s)`);
    }
});
