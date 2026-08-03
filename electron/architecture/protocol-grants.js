'use strict';

const { randomUUID } = require('node:crypto');
const path = require('node:path');

class ProtocolGrants {
    constructor(projectCapabilities) {
        this.projectCapabilities = projectCapabilities;
        this.grants = new Map();
    }

    create(ownerId, projectPath, options) {
        if (!Number.isSafeInteger(ownerId) || ownerId < 0) {
            throw new TypeError('A valid renderer owner is required');
        }
        const root = this.projectCapabilities.grant(projectPath, options);
        for (const [existingId, existing] of this.grants) {
            if (existing.root !== root) this.grants.delete(existingId);
        }
        const grantId = `project-${randomUUID()}`;
        this.grants.set(grantId, { ownerId, root, session: this.projectCapabilities.lease() });
        return { grantId, root };
    }

    revoke(ownerId, grantId) {
        const grant = this.grants.get(grantId);
        if (!grant || grant.ownerId !== ownerId) return false;
        this.grants.delete(grantId);
        if (![...this.grants.values()].some((candidate) => candidate.root === grant.root)) {
            this.projectCapabilities.revoke(grant.root);
        }
        return true;
    }

    revokeAllForOwner(ownerId) {
        let revoked = 0;
        for (const [grantId, grant] of this.grants) {
            if (grant.ownerId === ownerId) {
                this.grants.delete(grantId);
                revoked += 1;
            }
        }
        if (revoked > 0) this.projectCapabilities.clear();
        return revoked;
    }

    revokeAll() {
        this.grants.clear();
        this.projectCapabilities.clear();
    }

    resolve(ownerId, grantId, relativePath, options) {
        const grant = this.assertActive(ownerId, grantId);
        const target = path.join(grant.root, ...relativePath.replace(/\\/g, '/').split('/'));
        return this.projectCapabilities.authorize(target, options);
    }

    resolveMutation(ownerId, grantId, relativePath, options) {
        const grant = this.assertActive(ownerId, grantId);
        const target = path.join(grant.root, ...relativePath.replace(/\\/g, '/').split('/'));
        return this.projectCapabilities.authorizeMutation(target, options);
    }

    assertActive(ownerId, grantId) {
        const grant = this.grants.get(grantId);
        if (!grant || grant.ownerId !== ownerId) {
            const error = new Error('Project grant is missing or revoked');
            error.code = 'GRANT_NOT_FOUND';
            throw error;
        }
        this.projectCapabilities.assertLease(grant.session);
        return grant;
    }
}

module.exports = Object.freeze({ ProtocolGrants });
