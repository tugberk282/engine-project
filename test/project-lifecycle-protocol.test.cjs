'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { COMMANDS, PROTOCOL_VERSION, validateRequest } = require('../electron/architecture/contract');
const { stableError } = require('../electron/architecture/ipc-router');

function request(command, payload) {
    return { protocolVersion: PROTOCOL_VERSION, requestId: 'project-lifecycle', command, payload };
}

test('project lifecycle commands have strict versioned payloads and stable errors', () => {
    for (const command of [
        COMMANDS.PROJECT_OPEN,
        COMMANDS.PROJECT_GET_TRUST,
        COMMANDS.PROJECT_REQUEST_TRUST,
        COMMANDS.PROJECT_REVOKE_TRUST
    ]) {
        assert.equal(validateRequest(request(command, { path: 'C:\\Projects\\Game' })).ok, true);
        assert.equal(validateRequest(request(command, { path: 'https://attacker.invalid/game' })).code, 'INVALID_PAYLOAD');
        assert.equal(validateRequest(request(command, { path: 'C:\\Game', extra: true })).code, 'INVALID_PAYLOAD');
    }
    assert.equal(validateRequest(request(COMMANDS.DIALOG_CREATE_PROJECT, {})).ok, true);
    assert.equal(stableError(Object.assign(new Error('bad project'), { code: 'PROJECT_INVALID' })).code, 'PROJECT_INVALID');
    assert.equal(stableError(Object.assign(new Error('cancelled'), { code: 'TRUST_CANCELLED' })).code, 'TRUST_CANCELLED');
});

test('launcher project lifecycle uses only the authenticated production protocol', () => {
    const root = path.join(__dirname, '..');
    const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
    const launcher = fs.readFileSync(path.join(root, 'src', 'editor', 'Launcher.ts'), 'utf8');
    const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');

    assert.doesNotMatch(preload, /getProjectTrust:|requestProjectTrust:|initializeProjectStructure:/);
    assert.match(launcher, /desktopBridge\.createProject\(\)/);
    assert.match(launcher, /desktopBridge\.requestProjectTrust\(projectPath\)/);
    assert.match(main, /case COMMANDS\.DIALOG_CREATE_PROJECT/);
    assert.match(main, /case COMMANDS\.PROJECT_REVOKE_TRUST/);
    assert.match(main, /PROJECT_INVALID/);
    assert.match(main, /protocolGrants\.revokeAllForOwner\(event\.sender\.id\)/);
});
