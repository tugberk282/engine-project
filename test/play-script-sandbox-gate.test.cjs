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
const {
    PLAY_EXECUTION_MODES,
    FULL_TRUST_ACKNOWLEDGEMENT,
    FailClosedPlayExecutionAdmission
} = require('../electron/security/play-execution-admission');

function fixture(t, { admission } = {}) {
    const base = fs.mkdtempSync(path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || os.tmpdir(), 'tugberk-play-gate-'));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const project = path.join(base, 'project');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(project);
    fs.mkdirSync(outside);
    const trustStore = new ProjectTrustStore(path.join(base, 'state', 'trust.json'));
    const grants = new ProtocolGrants(new ProjectCapabilities());
    const grant = grants.create(7, project, { writable: true });
    let launches = 0;
    let launchContext;
    const sessions = new CodePlaySessions({
        trustStore,
        grants,
        admission,
        createSessionId: () => 'session-id',
        launch: async (context) => {
            launches += 1;
            launchContext = context;
            return { stop: async () => {} };
        }
    });
    return {
        project,
        outside,
        trustStore,
        grants,
        grant,
        sessions,
        launchCount: () => launches,
        launchContext: () => launchContext
    };
}

test('project trust alone never enables project-controlled code', async (t) => {
    const f = fixture(t);
    f.trustStore.trust(f.project);

    await assert.rejects(f.sessions.start({
        ownerWebContentsId: 7,
        grantId: f.grant.grantId,
        projectPath: f.project,
        snapshot: '{}'
    }), (error) => error.code === 'PLAY_CODE_DISABLED');
    assert.equal(f.launchCount(), 0);
});

test('unsupported sandbox policy denies every adversarial capability probe before launch', async (t) => {
    const f = fixture(t);
    f.trustStore.trust(f.project);
    const marker = path.join(f.outside, 'sandbox-escape.txt');
    const probes = [
        'outside-root-read-write',
        'environment-and-credentials',
        'network',
        'child-process',
        'native-module',
        'survive-stop-or-revoke'
    ];

    for (const probe of probes) {
        await assert.rejects(f.sessions.start({
            ownerWebContentsId: 7,
            grantId: f.grant.grantId,
            projectPath: f.project,
            snapshot: JSON.stringify({ probe, marker }),
            execution: { mode: PLAY_EXECUTION_MODES.SANDBOXED }
        }), (error) => error.code === 'PLAY_SANDBOX_UNAVAILABLE');
    }

    assert.equal(f.launchCount(), 0);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(f.sessions.sessions.size, 0);
});

test('full-trust execution requires explicit consent bound to all active authorities', async (t) => {
    const admission = new FailClosedPlayExecutionAdmission({ createConsentId: () => 'consent-id' });
    const f = fixture(t, { admission });
    const trust = f.trustStore.trust(f.project);

    assert.throws(() => admission.issueFullTrustConsent({
        ownerWebContentsId: 7,
        grantId: f.grant.grantId,
        projectIdentity: trust.identity,
        trustEpoch: trust.trustEpoch,
        acknowledgement: 'trust this project'
    }), (error) => error.code === 'FULL_TRUST_CONSENT_REQUIRED');
    await assert.rejects(f.sessions.start({
        ownerWebContentsId: 7,
        grantId: f.grant.grantId,
        projectPath: f.project,
        snapshot: '{}',
        execution: { mode: PLAY_EXECUTION_MODES.FULL_TRUST, consentId: 'missing' }
    }), (error) => error.code === 'FULL_TRUST_CONSENT_REQUIRED');
    assert.equal(f.launchCount(), 0);

    const consent = admission.issueFullTrustConsent({
        ownerWebContentsId: 7,
        grantId: f.grant.grantId,
        projectIdentity: trust.identity,
        trustEpoch: trust.trustEpoch,
        acknowledgement: FULL_TRUST_ACKNOWLEDGEMENT
    });
    await f.sessions.start({
        ownerWebContentsId: 7,
        grantId: f.grant.grantId,
        projectPath: f.project,
        snapshot: '{}',
        execution: { mode: PLAY_EXECUTION_MODES.FULL_TRUST, consentId: consent.consentId }
    });

    assert.equal(f.launchCount(), 1);
    assert.deepEqual(f.launchContext().executionPolicy, {
        mode: PLAY_EXECUTION_MODES.FULL_TRUST,
        sandboxed: false,
        securityBoundary: 'none',
        ambientAuthority: {
            filesystem: true,
            environment: true,
            network: true,
            childProcess: true,
            nativeModules: true
        },
        consentId: 'consent-id'
    });
});

test('a denied policy cannot stop or replace an admitted session', async (t) => {
    const admission = new FailClosedPlayExecutionAdmission({ createConsentId: () => 'consent-id' });
    const f = fixture(t, { admission });
    const trust = f.trustStore.trust(f.project);
    const consent = admission.issueFullTrustConsent({
        ownerWebContentsId: 7,
        grantId: f.grant.grantId,
        projectIdentity: trust.identity,
        trustEpoch: trust.trustEpoch,
        acknowledgement: FULL_TRUST_ACKNOWLEDGEMENT
    });
    const active = await f.sessions.start({
        ownerWebContentsId: 7,
        grantId: f.grant.grantId,
        projectPath: f.project,
        snapshot: '{}',
        execution: { mode: PLAY_EXECUTION_MODES.FULL_TRUST, consentId: consent.consentId }
    });

    await assert.rejects(f.sessions.start({
        ownerWebContentsId: 7,
        grantId: f.grant.grantId,
        projectPath: f.project,
        snapshot: '{}',
        execution: { mode: PLAY_EXECUTION_MODES.SANDBOXED }
    }), (error) => error.code === 'PLAY_SANDBOX_UNAVAILABLE');

    assert.equal(f.launchCount(), 1);
    assert.equal(f.sessions.sessions.has(active.sessionId), true);
});

test('consent is invalidated by grant and project revocation and cannot survive re-trust', async (t) => {
    let consentSequence = 0;
    const admission = new FailClosedPlayExecutionAdmission({ createConsentId: () => `consent-${++consentSequence}` });
    const f = fixture(t, { admission });
    const firstTrust = f.trustStore.trust(f.project);
    const first = admission.issueFullTrustConsent({
        ownerWebContentsId: 7,
        grantId: f.grant.grantId,
        projectIdentity: firstTrust.identity,
        trustEpoch: firstTrust.trustEpoch,
        acknowledgement: FULL_TRUST_ACKNOWLEDGEMENT
    });
    f.trustStore.revoke(f.project);
    await f.sessions.revokeProject(f.project);
    const secondTrust = f.trustStore.trust(f.project);

    await assert.rejects(f.sessions.start({
        ownerWebContentsId: 7,
        grantId: f.grant.grantId,
        projectPath: f.project,
        snapshot: '{}',
        execution: { mode: PLAY_EXECUTION_MODES.FULL_TRUST, consentId: first.consentId }
    }), (error) => error.code === 'FULL_TRUST_CONSENT_REQUIRED');
    assert.notEqual(firstTrust.trustEpoch, secondTrust.trustEpoch);
    assert.equal(f.launchCount(), 0);

    const second = admission.issueFullTrustConsent({
        ownerWebContentsId: 7,
        grantId: f.grant.grantId,
        projectIdentity: secondTrust.identity,
        trustEpoch: secondTrust.trustEpoch,
        acknowledgement: FULL_TRUST_ACKNOWLEDGEMENT
    });
    f.grants.revoke(7, f.grant.grantId);
    await f.sessions.revokeGrant(7, f.grant.grantId);
    assert.throws(() => admission.admit({
        ownerWebContentsId: 7,
        grantId: f.grant.grantId,
        projectIdentity: secondTrust.identity,
        trustEpoch: secondTrust.trustEpoch
    }, { mode: PLAY_EXECUTION_MODES.FULL_TRUST, consentId: second.consentId }),
    (error) => error.code === 'FULL_TRUST_CONSENT_REQUIRED');
});

test('renderer-owner teardown revokes consent and awaits session cleanup', async (t) => {
    const admission = new FailClosedPlayExecutionAdmission({ createConsentId: () => 'consent-id' });
    const f = fixture(t, { admission });
    const trust = f.trustStore.trust(f.project);
    const consent = admission.issueFullTrustConsent({
        ownerWebContentsId: 7,
        grantId: f.grant.grantId,
        projectIdentity: trust.identity,
        trustEpoch: trust.trustEpoch,
        acknowledgement: FULL_TRUST_ACKNOWLEDGEMENT
    });
    await f.sessions.start({
        ownerWebContentsId: 7,
        grantId: f.grant.grantId,
        projectPath: f.project,
        snapshot: '{}',
        execution: { mode: PLAY_EXECUTION_MODES.FULL_TRUST, consentId: consent.consentId }
    });

    assert.equal(await f.sessions.revokeOwner(7), 1);
    assert.equal(f.sessions.sessions.size, 0);
    assert.throws(() => admission.admit({
        ownerWebContentsId: 7,
        grantId: f.grant.grantId,
        projectIdentity: trust.identity,
        trustEpoch: trust.trustEpoch
    }, { mode: PLAY_EXECUTION_MODES.FULL_TRUST, consentId: consent.consentId }),
    (error) => error.code === 'FULL_TRUST_CONSENT_REQUIRED');
});
