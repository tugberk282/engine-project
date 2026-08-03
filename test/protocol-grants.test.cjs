'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ProtocolGrants } = require('../electron/architecture/protocol-grants');
const { ProjectCapabilities } = require('../electron/security/project-capabilities');

test('protocol grants resolve only relative paths and fail after revocation', (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-protocol-grant-'));
    const project = path.join(base, 'project');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'scene.json'), '{}');
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));

    const grants = new ProtocolGrants(new ProjectCapabilities());
    const grant = grants.create(7, project, { writable: false });
    assert.equal(
        grants.resolve(7, grant.grantId, 'scene.json', { mustExist: true }),
        path.join(project, 'scene.json')
    );

    assert.throws(
        () => grants.resolve(8, grant.grantId, 'scene.json', { mustExist: true }),
        (error) => error.code === 'GRANT_NOT_FOUND'
    );
    assert.equal(grants.revoke(8, grant.grantId), false);
    assert.equal(grants.revoke(7, grant.grantId), true);
    assert.throws(
        () => grants.resolve(7, grant.grantId, 'scene.json', { mustExist: true }),
        (error) => error.code === 'GRANT_NOT_FOUND'
    );
});

test('protocol grants reject symlink escapes through project capabilities', (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-protocol-link-'));
    const project = path.join(base, 'project');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(project);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    fs.symlinkSync(outside, path.join(project, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));

    const grants = new ProtocolGrants(new ProjectCapabilities());
    const grant = grants.create(7, project, { writable: false });
    assert.throws(
        () => grants.resolve(7, grant.grantId, 'escape/secret.txt', { mustExist: true }),
        /outside an approved/
    );
});

test('renderer teardown revokes its project and exact-file capabilities', (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-protocol-owner-'));
    const first = path.join(base, 'first');
    fs.mkdirSync(first);
    fs.writeFileSync(path.join(first, 'scene.json'), '{}');
    const exportPath = path.join(base, 'export.json');
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));

    const capabilities = new ProjectCapabilities();
    const grants = new ProtocolGrants(capabilities);
    const firstGrant = grants.create(7, first, { writable: false });
    capabilities.grantFile(exportPath, { writable: true });
    assert.equal(grants.revokeAllForOwner(7), 1);
    assert.throws(
        () => grants.resolve(7, firstGrant.grantId, 'scene.json', { mustExist: true }),
        (error) => error.code === 'GRANT_NOT_FOUND'
    );
    assert.throws(
        () => capabilities.authorize(exportPath, { write: true }),
        (error) => error.code === 'PROJECT_NOT_GRANTED'
    );
});

test('switching projects makes prior opaque and absolute-path capabilities stale', (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-protocol-switch-'));
    const first = path.join(base, 'first');
    const second = path.join(base, 'second');
    fs.mkdirSync(first);
    fs.mkdirSync(second);
    fs.writeFileSync(path.join(first, 'scene.json'), '{}');
    fs.writeFileSync(path.join(second, 'scene.json'), '{}');
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));

    const capabilities = new ProjectCapabilities();
    const grants = new ProtocolGrants(capabilities);
    const firstGrant = grants.create(7, first, { writable: true });
    grants.create(7, second, { writable: false });

    assert.throws(
        () => grants.resolve(7, firstGrant.grantId, 'scene.json', { mustExist: true }),
        (error) => error.code === 'GRANT_NOT_FOUND' || error.code === 'STALE_PROJECT_SESSION'
    );
    assert.throws(
        () => capabilities.authorize(path.join(first, 'scene.json'), { mustExist: true }),
        (error) => error.code === 'PROJECT_NOT_GRANTED'
    );
});
