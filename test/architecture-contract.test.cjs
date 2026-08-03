'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    PROTOCOL_VERSION,
    COMMANDS,
    isSafeRelativePath,
    validateRequest,
    validateResponse,
    createResponse
} = require('../electron/architecture/contract');

function request(overrides = {}) {
    return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: 'req-1',
        command: COMMANDS.PROJECT_READ_TEXT,
        payload: { grantId: 'project-1', path: 'Assets/Scenes/Main.json' },
        ...overrides
    };
}

test('accepts an allowlisted, grant-scoped request', () => {
    assert.equal(validateRequest(request()).ok, true);
});

test('rejects protocol mismatch and unknown commands', () => {
    assert.equal(validateRequest(request({ protocolVersion: 2 })).code, 'VERSION_MISMATCH');
    assert.equal(validateRequest(request({ command: 'fs.rm' })).code, 'UNKNOWN_COMMAND');
});

test('rejects absolute, traversal, empty, and ambiguous paths', () => {
    for (const path of ['C:\\secret.txt', '/etc/passwd', '\\\\server\\share', '../secret', 'Assets/../secret', '', 'Assets//x']) {
        assert.equal(isSafeRelativePath(path), false, path);
        assert.equal(validateRequest(request({ payload: { grantId: 'project-1', path } })).code, 'INVALID_PAYLOAD');
    }
});

test('bounds write content and validates command-specific payloads', () => {
    assert.equal(validateRequest(request({
        command: COMMANDS.PROJECT_WRITE_TEXT,
        payload: { grantId: 'project-1', path: 'Assets/a.txt', content: 'ok' }
    })).ok, true);
    assert.equal(validateRequest(request({
        command: COMMANDS.PROJECT_WRITE_TEXT,
        payload: { grantId: 'project-1', path: 'Assets/a.txt', content: 42 }
    })).code, 'INVALID_PAYLOAD');
});

test('scan cancellation targets only a validated request ID', () => {
    assert.equal(validateRequest(request({
        command: 'asset.cancelScan',
        payload: { scanRequestId: 'renderer-scan-1' }
    })).ok, true);
    assert.equal(validateRequest(request({
        command: 'asset.cancelScan',
        payload: { scanRequestId: '../scan' }
    })).code, 'INVALID_PAYLOAD');
});

test('response exposes stable errors without native stack data', () => {
    const response = createResponse('req-1', {
        ok: false,
        error: { code: 'PATH_OUTSIDE_GRANT', message: 'Path rejected', stack: 'secret' }
    });
    assert.deepEqual(response, {
        protocolVersion: 1,
        requestId: 'req-1',
        ok: false,
        error: { code: 'PATH_OUTSIDE_GRANT', message: 'Path rejected' }
    });
    assert.equal(Object.isFrozen(response), true);
    assert.equal(Object.isFrozen(response.error), true);
});

test('response validation rejects mismatched IDs and excess fields', () => {
    assert.equal(validateResponse({
        protocolVersion: 1,
        requestId: 'req-1',
        ok: true,
        value: true
    }, 'req-1').ok, true);
    assert.equal(validateResponse({
        protocolVersion: 1,
        requestId: 'req-2',
        ok: true,
        value: true
    }, 'req-1').code, 'INVALID_RESPONSE');
    assert.equal(validateResponse({
        protocolVersion: 1,
        requestId: 'req-1',
        ok: false,
        error: { code: 'REQUEST_FAILED', message: 'Request failed', stack: 'native' }
    }, 'req-1').code, 'INVALID_RESPONSE');
});
