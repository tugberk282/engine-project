'use strict';

const { randomUUID } = require('node:crypto');

const PLAY_EXECUTION_MODES = Object.freeze({
    DISABLED: 'disabled',
    SANDBOXED: 'sandboxed',
    FULL_TRUST: 'full-trust'
});

const FULL_TRUST_ACKNOWLEDGEMENT =
    'I understand this project code runs with my desktop user authority and is not sandboxed.';

function admissionError(code, message) {
    return Object.assign(new Error(message), { code });
}

function validAuthorityBinding(value) {
    return Number.isSafeInteger(value.ownerWebContentsId)
        && typeof value.grantId === 'string'
        && value.grantId.length > 0
        && typeof value.projectIdentity === 'string'
        && value.projectIdentity.length > 0
        && typeof value.trustEpoch === 'string'
        && value.trustEpoch.length > 0;
}

class FailClosedPlayExecutionAdmission {
    constructor({ createConsentId = randomUUID } = {}) {
        if (typeof createConsentId !== 'function') throw new TypeError('A consent ID factory is required');
        this.createConsentId = createConsentId;
        this.consents = new Map();
        this.closed = false;
    }

    issueFullTrustConsent(binding) {
        if (this.closed) throw admissionError('PLAY_ADMISSION_SHUTDOWN', 'Play execution admission is shut down');
        if (!validAuthorityBinding(binding)) throw new TypeError('Full-trust consent requires a complete authority binding');
        if (binding.acknowledgement !== FULL_TRUST_ACKNOWLEDGEMENT) {
            throw admissionError(
                'FULL_TRUST_CONSENT_REQUIRED',
                'Full-trust project code requires explicit informed consent'
            );
        }
        const consentId = this.createConsentId();
        const record = Object.freeze({
            consentId,
            ownerWebContentsId: binding.ownerWebContentsId,
            grantId: binding.grantId,
            projectIdentity: binding.projectIdentity,
            trustEpoch: binding.trustEpoch
        });
        this.consents.set(consentId, record);
        return Object.freeze({ consentId });
    }

    admit(binding, request = {}) {
        if (this.closed) throw admissionError('PLAY_ADMISSION_SHUTDOWN', 'Play execution admission is shut down');
        if (!validAuthorityBinding(binding)) throw new TypeError('Play admission requires a complete authority binding');
        const mode = request?.mode ?? PLAY_EXECUTION_MODES.DISABLED;
        if (mode === PLAY_EXECUTION_MODES.DISABLED) {
            throw admissionError('PLAY_CODE_DISABLED', 'Project-controlled code is disabled');
        }
        if (mode === PLAY_EXECUTION_MODES.SANDBOXED) {
            throw admissionError(
                'PLAY_SANDBOX_UNAVAILABLE',
                'Sandboxed project-code execution is unavailable; no OS-enforced launcher is configured'
            );
        }
        if (mode !== PLAY_EXECUTION_MODES.FULL_TRUST) {
            throw admissionError('INVALID_PLAY_EXECUTION_POLICY', 'The requested play execution policy is unsupported');
        }
        const consent = this.consents.get(request?.consentId);
        if (!consent || !this.matches(consent, binding)) {
            throw admissionError(
                'FULL_TRUST_CONSENT_REQUIRED',
                'Full-trust project code requires explicit consent bound to this renderer, grant, project, and trust epoch'
            );
        }
        return Object.freeze({
            mode: PLAY_EXECUTION_MODES.FULL_TRUST,
            sandboxed: false,
            securityBoundary: 'none',
            ambientAuthority: Object.freeze({
                filesystem: true,
                environment: true,
                network: true,
                childProcess: true,
                nativeModules: true
            }),
            consentId: consent.consentId
        });
    }

    assertCurrent(policy, binding) {
        if (policy?.mode !== PLAY_EXECUTION_MODES.FULL_TRUST) {
            throw admissionError('INVALID_PLAY_EXECUTION_POLICY', 'The active play policy is invalid');
        }
        const consent = this.consents.get(policy.consentId);
        if (!consent || !this.matches(consent, binding)) {
            throw admissionError('FULL_TRUST_CONSENT_REVOKED', 'Full-trust project-code consent was revoked or became stale');
        }
        return policy;
    }

    matches(consent, binding) {
        return consent.ownerWebContentsId === binding.ownerWebContentsId
            && consent.grantId === binding.grantId
            && consent.projectIdentity === binding.projectIdentity
            && consent.trustEpoch === binding.trustEpoch;
    }

    revokeGrant(ownerWebContentsId, grantId) {
        return this.revokeMatching((record) =>
            record.ownerWebContentsId === ownerWebContentsId && record.grantId === grantId);
    }

    revokeProject(projectIdentity) {
        return this.revokeMatching((record) => record.projectIdentity === projectIdentity);
    }

    revokeOwner(ownerWebContentsId) {
        return this.revokeMatching((record) => record.ownerWebContentsId === ownerWebContentsId);
    }

    revokeMatching(predicate) {
        let revoked = 0;
        for (const [consentId, record] of this.consents) {
            if (!predicate(record)) continue;
            this.consents.delete(consentId);
            revoked += 1;
        }
        return revoked;
    }

    shutdown() {
        if (this.closed) return;
        this.closed = true;
        this.consents.clear();
    }
}

module.exports = Object.freeze({
    PLAY_EXECUTION_MODES,
    FULL_TRUST_ACKNOWLEDGEMENT,
    FailClosedPlayExecutionAdmission,
    admissionError
});
