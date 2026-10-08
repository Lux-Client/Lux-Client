// Entfernt Minecraft-Zugangsdaten aus Log-Zeilen, bevor sie angezeigt,
// gespeichert oder hochgeladen werden.

const REDACTED = '[REDACTED]';

// --accessToken <token> / --session <token> in Startargumenten
const ARGUMENT_PATTERN = /(--(?:accessToken|session)\s+)("[^"]*"|\S+)/gi;
// Minecraft-/Xbox-Tokens sind JWTs ("eyJ..."): drei Base64url-Teile mit Punkten getrennt
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

function redactSecrets(text, secrets = []) {
    let result = String(text ?? '');

    for (const secret of secrets) {
        if (typeof secret === 'string' && secret.length >= 8) {
            result = result.split(secret).join(REDACTED);
        }
    }

    return result
        .replace(ARGUMENT_PATTERN, `$1${REDACTED}`)
        .replace(JWT_PATTERN, REDACTED);
}

module.exports = { redactSecrets, REDACTED };
