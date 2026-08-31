const MAX_PATH_LENGTH = 400;
const MAX_SEGMENT_LENGTH = 120;
const MAX_SEGMENTS = 24;

const FORBIDDEN_SEGMENT_CHARS = new Set(['<', '>', ':', '"', '|', '?', '*', '\\', '/']);
const WINDOWS_RESERVED = new Set([
    'con', 'prn', 'aux', 'nul',
    'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
]);

function hasControlChars(value) {
    for (let i = 0; i < value.length; i += 1) {
        const code = value.charCodeAt(i);
        if (code < 32 || code === 127) return true;
    }
    return false;
}

function validSegment(segment) {
    if (segment.length === 0 || segment.length > MAX_SEGMENT_LENGTH) return false;
    if (segment === '.' || segment === '..') return false;
    if (hasControlChars(segment)) return false;

    for (const char of segment) {
        if (FORBIDDEN_SEGMENT_CHARS.has(char)) return false;
    }

    if (segment.endsWith('.') || segment.endsWith(' ')) return false;

    const withoutExtension = segment.split('.')[0].toLowerCase();
    if (WINDOWS_RESERVED.has(withoutExtension)) return false;

    return true;
}

function validRelPath(value) {
    if (typeof value !== 'string') return false;
    if (value.length === 0 || value.length > MAX_PATH_LENGTH) return false;
    if (value.startsWith('/')) return false;
    if (value.includes('\\')) return false;
    if (hasControlChars(value)) return false;
    if (/^[a-zA-Z]:/.test(value)) return false;
    if (value.normalize('NFC') !== value) return false;

    const segments = value.split('/');
    if (segments.length > MAX_SEGMENTS) return false;

    return segments.every(validSegment);
}

module.exports = {
    MAX_PATH_LENGTH,
    MAX_SEGMENTS,
    MAX_SEGMENT_LENGTH,
    validRelPath,
    validSegment
};
