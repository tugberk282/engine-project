'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ProtocolGrants } = require('../electron/architecture/protocol-grants');
const { ProjectCapabilities } = require('../electron/security/project-capabilities');
const { ProjectTrustStore } = require('../electron/security/project-trust');
const { CodePlaySessions } = require('../electron/security/code-play-sessions');

function fixture(t, launch) {
    const base = fs.mkdtempSync(path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || os.tmpdir(), 'tugberk-code-play-'));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const project = path.join(base, 'project');
    fs.mkdirSync(project);
    const trustStore = new ProjectTrustStore(path.join(base, 'state', 'trust.json'));
    const grants = new ProtocolGrants(new ProjectCapabilities());
    const grant = grants.create(7, project, { writable: true });
    const sessions = new CodePlaySessions({ trustStore, grants, launch, createSessionId: () => 'opaque-session' });
    return { project, trustStore, grants, grant, sessions };
}

test('safe and revoked projects fail before process launch', async (t) => {
    let launches = 0;
    const f = fixture(t, async () => { launches += 1; });
    await assert.rejects(f.sessions.start({ ownerWebContentsId: 7, grantId: f.grant.grantId, projectPath: f.project, snapshot: '{}' }),
        (error) => error.code === 'PROJECT_TRUST_REQUIRED');
    f.trustStore.trust(f.project);
    f.trustStore.revoke(f.project);
    await assert.rejects(f.sessions.start({ ownerWebContentsId: 7, grantId: f.grant.grantId, projectPath: f.project, snapshot: '{}' }),
        (error) => error.code === 'PROJECT_TRUST_REQUIRED');
    assert.equal(launches, 0);
});

test('trusted start binds opaque session to grant, trust epoch, and renderer owner', async (t) => {
    let context;
    const runtime = { pause: async () => 'paused', stop: async () => {} };
    const f = fixture(t, async (value) => { context = value; return runtime; });
    const trusted = f.trustStore.trust(f.project);
    const result = await f.sessions.start({ ownerWebContentsId: 7, grantId: f.grant.grantId, projectPath: f.project, snapshot: '{}' });
    assert.deepEqual(result, { sessionId: 'opaque-session' });
    assert.equal(context.ownerWebContentsId, 7);
    assert.equal(context.grantId, f.grant.grantId);
    assert.equal(context.projectIdentity, trusted.identity);
    assert.equal(context.trustEpoch, trusted.trustEpoch);
    assert.equal(await f.sessions.control(7, result.sessionId, 'pause'), 'paused');
    await assert.rejects(f.sessions.control(8, result.sessionId, 'pause'), (error) => error.code === 'STALE_PLAY_SESSION');
});

test('grant revocation makes sessions stale and owner teardown awaits runtime cleanup', async (t) => {
    let stopped = false;
    const f = fixture(t, async () => ({ stop: async () => { await new Promise((resolve) => setImmediate(resolve)); stopped = true; } }));
    f.trustStore.trust(f.project);
    const { sessionId } = await f.sessions.start({ ownerWebContentsId: 7, grantId: f.grant.grantId, projectPath: f.project, snapshot: '{}' });
    f.grants.revoke(7, f.grant.grantId);
    await assert.rejects(f.sessions.control(7, sessionId, 'pause'), (error) => error.code === 'GRANT_NOT_FOUND');
    await f.sessions.stopForOwner(7);
    assert.equal(stopped, true);
    await assert.rejects(f.sessions.control(7, sessionId, 'pause'), (error) => error.code === 'STALE_PLAY_SESSION');
});

test('trust revoke/start race aborts and awaits launched runtime cleanup', async (t) => {
    let release;
    let stopped = false;
    const launched = new Promise((resolve) => { release = resolve; });
    const f = fixture(t, () => launched);
    f.trustStore.trust(f.project);
    const starting = f.sessions.start({ ownerWebContentsId: 7, grantId: f.grant.grantId, projectPath: f.project, snapshot: '{}' });
    await new Promise((resolve) => setImmediate(resolve));
    f.trustStore.revoke(f.project);
    const revoking = f.sessions.revokeProject(f.project);
    release({ stop: async () => { stopped = true; } });
    await revoking;
    await assert.rejects(starting, (error) => ['STALE_PLAY_SESSION', 'PROJECT_TRUST_REQUIRED'].includes(error.code));
    assert.equal(stopped, true);
});

test('revoking and re-trusting cannot revive a stale session epoch', async (t) => {
    const f = fixture(t, async () => ({ pause: async () => 'paused', stop: async () => {} }));
    const firstTrust = f.trustStore.trust(f.project);
    const { sessionId } = await f.sessions.start({ ownerWebContentsId: 7, grantId: f.grant.grantId, projectPath: f.project, snapshot: '{}' });
    f.trustStore.revoke(f.project);
    const secondTrust = f.trustStore.trust(f.project);
    assert.notEqual(firstTrust.trustEpoch, secondTrust.trustEpoch);
    await assert.rejects(f.sessions.control(7, sessionId, 'pause'), (error) => error.code === 'PROJECT_TRUST_REVOKED');
});
