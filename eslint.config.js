const js = require('@eslint/js');
const globals = require('globals');

/*
    Replaces .eslintrc.json — ESLint 9+ only reads flat config, so the
    legacy file was silently never being loaded at all. Same settings as
    before: eslint:recommended, browser + node globals on every file
    (main-process and renderer source sit side by side rather than in
    separate trees), no-unused-vars as a warning, no-console left on.
*/

module.exports = [
    js.configs.recommended,

    {
        languageOptions: {
            ecmaVersion: 2022,

            sourceType: 'commonjs',

            globals: {
                ...globals.browser,

                ...globals.node
            }
        },

        rules: {
            'no-unused-vars': 'warn',

            'no-console': 'off'
        }
    },

    {
        ignores: ['dist/**', 'release/**', 'out/**']
    }
];
