
function compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;

    const cleanV1 = String(v1).trim().startsWith('v') ? String(v1).trim().substring(1) : String(v1).trim();
    const cleanV2 = String(v2).trim().startsWith('v') ? String(v2).trim().substring(1) : String(v2).trim();

    const parts1 = cleanV1.split('.').map(p => parseInt(p, 10));
    const parts2 = cleanV2.split('.').map(p => parseInt(p, 10));

    const maxLength = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLength; i++) {
        const p1 = isNaN(parts1[i]) ? 0 : parts1[i];
        const p2 = isNaN(parts2[i]) ? 0 : parts2[i];

        if (p2 > p1) return 1;
        if (p1 > p2) return -1;
    }

    return 0;
}

module.exports = { compareVersions };
