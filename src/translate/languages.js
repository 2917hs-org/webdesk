/*
    The language codes Google's translate endpoint accepts, paired with
    the names shown in the two dropdowns. Not exhaustive — this is the
    same practical subset every translate UI (Chrome's included) leads
    with — but 'auto' is added at the front for the "original language"
    dropdown only, since detection has no meaning as a translate target.
*/

const LANGUAGES = [
    { code: 'ar', name: 'Arabic' },
    { code: 'bn', name: 'Bengali' },
    { code: 'bg', name: 'Bulgarian' },
    { code: 'zh-CN', name: 'Chinese (Simplified)' },
    { code: 'zh-TW', name: 'Chinese (Traditional)' },
    { code: 'hr', name: 'Croatian' },
    { code: 'cs', name: 'Czech' },
    { code: 'da', name: 'Danish' },
    { code: 'nl', name: 'Dutch' },
    { code: 'en', name: 'English' },
    { code: 'et', name: 'Estonian' },
    { code: 'fi', name: 'Finnish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'el', name: 'Greek' },
    { code: 'he', name: 'Hebrew' },
    { code: 'hi', name: 'Hindi' },
    { code: 'hu', name: 'Hungarian' },
    { code: 'id', name: 'Indonesian' },
    { code: 'it', name: 'Italian' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'lv', name: 'Latvian' },
    { code: 'lt', name: 'Lithuanian' },
    { code: 'ms', name: 'Malay' },
    { code: 'no', name: 'Norwegian' },
    { code: 'fa', name: 'Persian' },
    { code: 'pl', name: 'Polish' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'ro', name: 'Romanian' },
    { code: 'ru', name: 'Russian' },
    { code: 'sr', name: 'Serbian' },
    { code: 'sk', name: 'Slovak' },
    { code: 'sl', name: 'Slovenian' },
    { code: 'es', name: 'Spanish' },
    { code: 'sw', name: 'Swahili' },
    { code: 'sv', name: 'Swedish' },
    { code: 'th', name: 'Thai' },
    { code: 'tr', name: 'Turkish' },
    { code: 'uk', name: 'Ukrainian' },
    { code: 'ur', name: 'Urdu' },
    { code: 'vi', name: 'Vietnamese' }
];

function getTargetLanguages() {
    return LANGUAGES;
}

/*
    'auto' has no entry in LANGUAGES (detection, not a language of its
    own), so the source list is built separately rather than filtered
    out of the target list
*/

function getSourceLanguages() {
    return [{ code: 'auto', name: 'Detect language' }, ...LANGUAGES];
}

function nameForCode(code) {
    if (code === 'auto') return 'Detect language';

    const match = LANGUAGES.find((lang) => lang.code === code);

    return match ? match.name : code;
}

module.exports = {
    getSourceLanguages,
    getTargetLanguages,
    nameForCode
};
