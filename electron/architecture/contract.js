'use strict';

const PROTOCOL_VERSION = 1;
const COMMANDS = Object.freeze({
    PROJECT_READ_TEXT: 'project.readText',
    PROJECT_WRITE_TEXT: 'project.writeText',
    PROJECT_LIST_DIRECTORY: 'project.listDirectory',
    PROJECT_REVOKE_GRANT: 'project.revokeGrant',
    ASSET_SCAN: 'asset.scan',
    ASSET_CANCEL_SCAN: 'asset.cancelScan',
    ASSET_MOVE: 'asset.move',
    ASSET_WRITE_METADATA: 'asset.writeMetadata',
    DIALOG_OPEN_PROJECT: 'dialog.openProject',
    DIALOG_CREATE_PROJECT: 'dialog.createProject',
    PROJECT_OPEN: 'project.open',
    PROJECT_GET_TRUST: 'project.getTrust',
    PROJECT_REQUEST_TRUST: 'project.requestTrust',
    PROJECT_REVOKE_TRUST: 'project.revokeTrust',
    RECENT_PROJECTS_LOAD: 'recentProjects.load',
    RECENT_PROJECTS_SAVE: 'recentProjects.save',
    TELEMETRY_RECORD: 'telemetry.record',
    RUNTIME_START: 'runtime.start',
    RUNTIME_PAUSE: 'runtime.pause',
    RUNTIME_RESUME: 'runtime.resume',
    RUNTIME_TICK: 'runtime.tick',
    RUNTIME_STOP: 'runtime.stop'
});
const COMMAND_SET = new Set(Object.values(COMMANDS));
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_RECENT_PROJECTS = 10;
const MAX_RECENT_NAME_BYTES = 256;
const MAX_RECENT_PATH_BYTES = 4096;
const MAX_RECENT_PAYLOAD_BYTES = 32 * 1024;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeRelativePath(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false;
    if (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(value) || value.includes('\0')) return false;
    const parts = value.replace(/\\/g, '/').split('/');
    return parts.every((part) => part !== '' && part !== '.' && part !== '..');
}

function hasExactKeys(value, keys) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function utf8Length(value) {
    return typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : Number.POSITIVE_INFINITY;
}

function isSafeProjectLocation(value) {
    if (utf8Length(value) === 0 || utf8Length(value) > MAX_RECENT_PATH_BYTES || value.includes('\0')) return false;
    const scheme = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):\/\//);
    return !scheme || scheme[1].toLowerCase() === 'file';
}

function isRecentProject(value) {
    return isRecord(value)
        && hasExactKeys(value, ['name', 'path', 'lastOpened'])
        && utf8Length(value.name) > 0
        && utf8Length(value.name) <= MAX_RECENT_NAME_BYTES
        && isSafeProjectLocation(value.path)
        && Number.isSafeInteger(value.lastOpened)
        && value.lastOpened >= 0;
}

function isRecentProjectsPayload(payload) {
    if (!hasExactKeys(payload, ['projects'])
        || !Array.isArray(payload.projects)
        || payload.projects.length > MAX_RECENT_PROJECTS
        || !payload.projects.every(isRecentProject)) return false;
    try {
        return Buffer.byteLength(JSON.stringify(payload), 'utf8') <= MAX_RECENT_PAYLOAD_BYTES;
    } catch {
        return false;
    }
}

function validatePayload(command, payload) {
    if (!isRecord(payload)) return false;
    if (command === COMMANDS.RUNTIME_START) {
        return hasExactKeys(payload, ['snapshot'])
            && typeof payload.snapshot === 'string'
            && utf8Length(payload.snapshot) <= 16 * 1024 * 1024;
    }
    if (command === COMMANDS.RUNTIME_TICK) {
        return hasExactKeys(payload, ['deltaTime'])
            && Number.isFinite(payload.deltaTime)
            && payload.deltaTime >= 0
            && payload.deltaTime <= 0.1;
    }
    if (command === COMMANDS.RUNTIME_PAUSE
        || command === COMMANDS.RUNTIME_RESUME
        || command === COMMANDS.RUNTIME_STOP) {
        return Object.keys(payload).length === 0;
    }
    if (command === COMMANDS.DIALOG_OPEN_PROJECT || command === COMMANDS.DIALOG_CREATE_PROJECT) {
        return Object.keys(payload).length === 0;
    }
    if (command === COMMANDS.PROJECT_OPEN || command === COMMANDS.PROJECT_GET_TRUST
        || command === COMMANDS.PROJECT_REQUEST_TRUST || command === COMMANDS.PROJECT_REVOKE_TRUST) {
        return hasExactKeys(payload, ['path']) && isSafeProjectLocation(payload.path);
    }
    if (command === COMMANDS.RECENT_PROJECTS_LOAD) return Object.keys(payload).length === 0;
    if (command === COMMANDS.RECENT_PROJECTS_SAVE) return isRecentProjectsPayload(payload);
    if (command === COMMANDS.PROJECT_REVOKE_GRANT) {
        return hasExactKeys(payload, ['grantId']) && ID_PATTERN.test(payload.grantId || '');
    }
    if (command === COMMANDS.ASSET_CANCEL_SCAN) {
        return hasExactKeys(payload, ['scanRequestId']) && ID_PATTERN.test(payload.scanRequestId || '');
    }
    if (command === COMMANDS.TELEMETRY_RECORD) {
        return hasExactKeys(payload, ['name', 'fields'])
            && ID_PATTERN.test(payload.name || '')
            && isRecord(payload.fields || {});
    }
    if (command === COMMANDS.ASSET_MOVE) {
        return hasExactKeys(payload, ['grantId', 'path', 'destinationPath'])
            && ID_PATTERN.test(payload.grantId || '')
            && isSafeRelativePath(payload.path)
            && isSafeRelativePath(payload.destinationPath);
    }
    if (command === COMMANDS.ASSET_WRITE_METADATA) {
        return hasExactKeys(payload, ['grantId', 'path', 'metadata'])
            && ID_PATTERN.test(payload.grantId || '')
            && isSafeRelativePath(payload.path)
            && payload.path.endsWith('.meta')
            && isRecord(payload.metadata);
    }
    if (!ID_PATTERN.test(payload.grantId || '') || !isSafeRelativePath(payload.path)) return false;
    if (command === COMMANDS.PROJECT_WRITE_TEXT) {
        return hasExactKeys(payload, ['grantId', 'path', 'content'])
            && typeof payload.content === 'string'
            && Buffer.byteLength(payload.content, 'utf8') <= 16 * 1024 * 1024;
    }
    return hasExactKeys(payload, ['grantId', 'path']);
}

function validateRequest(message) {
    if (!isRecord(message)) return { ok: false, code: 'INVALID_ENVELOPE' };
    if (message.protocolVersion !== PROTOCOL_VERSION) return { ok: false, code: 'VERSION_MISMATCH' };
    if (!ID_PATTERN.test(message.requestId || '')) return { ok: false, code: 'INVALID_REQUEST_ID' };
    if (!COMMAND_SET.has(message.command)) return { ok: false, code: 'UNKNOWN_COMMAND' };
    if (!validatePayload(message.command, message.payload)) return { ok: false, code: 'INVALID_PAYLOAD' };
    return { ok: true, value: message };
}

function validateResponse(message, expectedRequestId) {
    if (!isRecord(message)) return { ok: false, code: 'INVALID_RESPONSE' };
    if (message.protocolVersion !== PROTOCOL_VERSION) return { ok: false, code: 'VERSION_MISMATCH' };
    if (!ID_PATTERN.test(message.requestId || '') || message.requestId !== expectedRequestId) {
        return { ok: false, code: 'INVALID_RESPONSE' };
    }
    if (message.ok === true) {
        return hasExactKeys(message, ['protocolVersion', 'requestId', 'ok', 'value'])
            ? { ok: true, value: message }
            : { ok: false, code: 'INVALID_RESPONSE' };
    }
    if (message.ok !== false
        || !hasExactKeys(message, ['protocolVersion', 'requestId', 'ok', 'error'])
        || !isRecord(message.error)
        || !hasExactKeys(message.error, ['code', 'message'])
        || !ID_PATTERN.test(message.error.code || '')
        || typeof message.error.message !== 'string') {
        return { ok: false, code: 'INVALID_RESPONSE' };
    }
    return { ok: true, value: message };
}

function createResponse(requestId, result) {
    if (!ID_PATTERN.test(requestId || '')) throw new TypeError('Invalid requestId');
    if (!isRecord(result) || typeof result.ok !== 'boolean') throw new TypeError('Invalid result');
    if (result.ok) {
        return Object.freeze({ protocolVersion: PROTOCOL_VERSION, requestId, ok: true, value: result.value });
    }
    if (!isRecord(result.error) || !ID_PATTERN.test(result.error.code || '')) {
        throw new TypeError('Invalid error');
    }
    return Object.freeze({
        protocolVersion: PROTOCOL_VERSION,
        requestId,
        ok: false,
        error: Object.freeze({
            code: result.error.code,
            message: typeof result.error.message === 'string' ? result.error.message : 'Request failed'
        })
    });
}

module.exports = Object.freeze({
    PROTOCOL_VERSION,
    COMMANDS,
    isSafeRelativePath,
    isRecentProjectsPayload,
    validateRequest,
    validateResponse,
    createResponse
});
