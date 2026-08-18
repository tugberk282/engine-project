'use strict';

const { randomUUID } = require('node:crypto');
const { FailClosedPlayExecutionAdmission } = require('./play-execution-admission');

function playError(code, message) {
    return Object.assign(new Error(message), { code });
}

class CodePlaySessions {
    constructor({
        trustStore,
        grants,
        launch,
        admission = new FailClosedPlayExecutionAdmission(),
        createSessionId = randomUUID
    } = {}) {
        if (!trustStore || typeof trustStore.get !== 'function') throw new TypeError('A project trust store is required');
        if (!grants || typeof grants.assertActive !== 'function') throw new TypeError('Project grants are required');
        if (typeof launch !== 'function') throw new TypeError('A code-play launcher is required');
        if (!admission || typeof admission.admit !== 'function' || typeof admission.assertCurrent !== 'function') {
            throw new TypeError('A play execution admission authority is required');
        }
        this.trustStore = trustStore;
        this.grants = grants;
        this.launch = launch;
        this.admission = admission;
        this.createSessionId = createSessionId;
        this.sessions = new Map();
        this.closed = false;
    }

    authorize(ownerWebContentsId, grantId, projectPath) {
        const grant = this.grants.assertActive(ownerWebContentsId, grantId);
        const trust = this.trustStore.get(projectPath);
        if (grant.root !== trust.root) throw playError('PROJECT_GRANT_MISMATCH', 'Project grant does not match the requested project');
        if (!trust.trusted || !trust.trustEpoch) throw playError('PROJECT_TRUST_REQUIRED', 'Code-enabled play requires project trust');
        return { grant, trust };
    }

    async start({ ownerWebContentsId, grantId, projectPath, snapshot, execution }) {
        if (this.closed) throw playError('PLAY_AUTHORITY_SHUTDOWN', 'Code-play authority is shut down');
        const admitted = this.authorize(ownerWebContentsId, grantId, projectPath);
        const executionPolicy = this.admission.admit(Object.freeze({
            ownerWebContentsId,
            grantId,
            projectIdentity: admitted.trust.identity,
            trustEpoch: admitted.trust.trustEpoch
        }), execution);
        await this.stopForOwner(ownerWebContentsId);

        // No await is permitted between this final authorization and launch. A
        // revocation racing with an asynchronous launcher is handled below by
        // aborting and awaiting the newly-created runtime.
        const dispatch = this.authorize(ownerWebContentsId, grantId, admitted.trust.root);
        if (dispatch.trust.identity !== admitted.trust.identity
            || dispatch.trust.trustEpoch !== admitted.trust.trustEpoch) {
            throw playError('PROJECT_TRUST_REVOKED', 'Project trust changed before code-play launch');
        }
        const authorityBinding = Object.freeze({
            ownerWebContentsId,
            grantId,
            projectIdentity: dispatch.trust.identity,
            trustEpoch: dispatch.trust.trustEpoch
        });
        this.admission.assertCurrent(executionPolicy, authorityBinding);

        const sessionId = this.createSessionId();
        const controller = new AbortController();
        const record = {
            sessionId,
            ownerWebContentsId,
            grantId,
            projectIdentity: dispatch.trust.identity,
            projectRoot: dispatch.trust.root,
            trustEpoch: dispatch.trust.trustEpoch,
            executionPolicy,
            controller,
            runtime: null,
            launchPromise: null
        };
        this.sessions.set(sessionId, record);
        try {
            record.launchPromise = Promise.resolve(this.launch(Object.freeze({
                sessionId,
                ownerWebContentsId,
                grantId,
                projectRoot: record.projectRoot,
                projectIdentity: record.projectIdentity,
                trustEpoch: record.trustEpoch,
                executionPolicy: record.executionPolicy,
                snapshot,
                signal: controller.signal
            })));
            record.runtime = await record.launchPromise;
            this.assertCurrent(record);
            return Object.freeze({ sessionId });
        } catch (error) {
            await this.dispose(record);
            throw error;
        }
    }

    assertCurrent(record) {
        if (record.controller.signal.aborted || this.sessions.get(record.sessionId) !== record) {
            throw playError('STALE_PLAY_SESSION', 'Code-play session is stale');
        }
        const current = this.authorize(record.ownerWebContentsId, record.grantId, record.projectRoot);
        if (current.trust.identity !== record.projectIdentity || current.trust.trustEpoch !== record.trustEpoch) {
            throw playError('PROJECT_TRUST_REVOKED', 'Project trust changed during code-play launch');
        }
        this.admission.assertCurrent(record.executionPolicy, {
            ownerWebContentsId: record.ownerWebContentsId,
            grantId: record.grantId,
            projectIdentity: record.projectIdentity,
            trustEpoch: record.trustEpoch
        });
        return record;
    }

    async control(ownerWebContentsId, sessionId, operation, ...args) {
        const record = this.sessions.get(sessionId);
        if (!record || record.ownerWebContentsId !== ownerWebContentsId) {
            throw playError('STALE_PLAY_SESSION', 'Code-play session is missing, stale, or owned by another renderer');
        }
        this.assertCurrent(record);
        if (!record.runtime || typeof record.runtime[operation] !== 'function') {
            throw playError('INVALID_PLAY_OPERATION', 'Code-play operation is unavailable');
        }
        return record.runtime[operation](...args);
    }

    async dispose(record) {
        if (this.sessions.get(record.sessionId) === record) this.sessions.delete(record.sessionId);
        record.controller.abort(playError('PLAY_SESSION_REVOKED', 'Code-play session authority was revoked'));
        if (record.launchPromise) await record.launchPromise.catch(() => {});
        if (record.runtime?.stop) await record.runtime.stop().catch(() => {});
    }

    async revokeGrant(ownerWebContentsId, grantId) {
        this.admission.revokeGrant?.(ownerWebContentsId, grantId);
        return this.disposeMatching((record) => record.ownerWebContentsId === ownerWebContentsId && record.grantId === grantId);
    }

    async revokeProject(projectPath) {
        const identity = this.trustStore.get(projectPath).identity;
        this.admission.revokeProject?.(identity);
        return this.disposeMatching((record) => record.projectIdentity === identity);
    }

    async stopForOwner(ownerWebContentsId) {
        return this.disposeMatching((record) => record.ownerWebContentsId === ownerWebContentsId);
    }

    async revokeOwner(ownerWebContentsId) {
        this.admission.revokeOwner?.(ownerWebContentsId);
        return this.stopForOwner(ownerWebContentsId);
    }

    async disposeMatching(predicate) {
        const matches = [...this.sessions.values()].filter(predicate);
        await Promise.all(matches.map((record) => this.dispose(record)));
        return matches.length;
    }

    async shutdown() {
        if (this.closed) return;
        this.closed = true;
        await this.disposeMatching(() => true);
        this.admission.shutdown?.();
    }
}

module.exports = Object.freeze({ CodePlaySessions, playError });
