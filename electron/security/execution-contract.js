'use strict';

const EXECUTION_KINDS = Object.freeze(['script', 'plugin', 'importer', 'build']);
const EXECUTION_KIND_SET = new Set(EXECUTION_KINDS);
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_BYTES = 16 * 1024;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length
        && actual.every((key, index) => key === expected[index]);
}

function isSafeRelativePath(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false;
    if (value.includes('\0') || /^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(value)) return false;
    return value.replace(/\\/g, '/').split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..');
}

function validateExecutionRequest(value) {
    if (!isRecord(value)
        || !hasExactKeys(value, ['projectPath', 'kind', 'entrypoint', 'arguments'])
        || typeof value.projectPath !== 'string'
        || value.projectPath.length === 0
        || value.projectPath.length > 4096
        || value.projectPath.includes('\0')
        || !EXECUTION_KIND_SET.has(value.kind)
        || !isSafeRelativePath(value.entrypoint)
        || !Array.isArray(value.arguments)
        || value.arguments.length > MAX_ARGUMENTS
        || !value.arguments.every((argument) => typeof argument === 'string' && !argument.includes('\0'))) {
        return { ok: false, code: 'INVALID_EXECUTION_REQUEST' };
    }
    if (Buffer.byteLength(JSON.stringify(value.arguments), 'utf8') > MAX_ARGUMENT_BYTES) {
        return { ok: false, code: 'EXECUTION_ARGUMENTS_TOO_LARGE' };
    }
    return {
        ok: true,
        value: Object.freeze({
            projectPath: value.projectPath,
            kind: value.kind,
            entrypoint: value.entrypoint.replace(/\\/g, '/'),
            arguments: Object.freeze([...value.arguments])
        })
    };
}

function validateCancelRequest(value) {
    return isRecord(value)
        && hasExactKeys(value, ['operationId'])
        && OPERATION_ID_PATTERN.test(value.operationId || '');
}

module.exports = Object.freeze({
    EXECUTION_KINDS,
    OPERATION_ID_PATTERN,
    validateExecutionRequest,
    validateCancelRequest
});
