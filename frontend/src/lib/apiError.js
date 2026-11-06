/** Turn Nest/HTTP error bodies into short user-facing text — never raw JSON. */
export class ApiError extends Error {
    status;
    code;
    constructor(message, status, code) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }
}
export class SessionExpiredError extends ApiError {
    constructor(message = 'Your session expired. Please sign in again.') {
        super(message, 401, 'session_expired');
        this.name = 'SessionExpiredError';
    }
}
export function parseApiErrorMessage(status, raw) {
    const trimmed = (raw || '').trim();
    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed.message) && parsed.message.length > 0) {
            return parsed.message.join(' ');
        }
        if (typeof parsed.message === 'string' && parsed.message.trim()) {
            const msg = parsed.message.trim();
            if (status === 429 || /too many requests|rate limit|too many (login )?attempts/i.test(msg)) {
                return '';
            }
            if (status === 409 || /already in use/i.test(msg)) {
                return 'Username is already taken. Choose another one.';
            }
            if (/invalid credentials/i.test(msg)) {
                return 'Invalid username or password.';
            }
            if (/unauthorized/i.test(msg) || status === 401) {
                return 'Your session expired. Please sign in again.';
            }
            if (status === 403) {
                if (/messag|block|not allowed|private profile|not authorized/i.test(msg)) {
                    return msg;
                }
                if (/forbidden/i.test(msg)) {
                    return 'You do not have permission to do that.';
                }
                return msg;
            }
            if (/forbidden/i.test(msg)) {
                return 'You do not have permission to do that.';
            }
            return msg;
        }
        if (typeof parsed.error === 'string' && parsed.error.trim() && parsed.error !== 'Unauthorized') {
            return parsed.error.trim();
        }
    }
    catch {
        // non-JSON body
    }
    if (status === 401)
        return 'Your session expired. Please sign in again.';
    if (status === 403)
        return 'You do not have permission to do that.';
    if (status === 404)
        return 'Not found.';
    if (status === 429)
        return '';
    if (status >= 500)
        return 'Server error. Please try again.';
    if (/^\s*\{[\s\S]*\}\s*$/.test(trimmed))
        return 'Request failed. Please try again.';
    return trimmed || 'Request failed';
}
