const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { atomicWriteJson } = require('../architecture/persistence');

const STORE_VERSION = 1;

function canonicalProjectIdentity(projectPath) {
    if (typeof projectPath !== 'string' || projectPath.length === 0 || projectPath.includes('\0')) {
        throw new TypeError('Project path must be a non-empty string');
    }
    const root = fs.realpathSync.native(path.resolve(projectPath));
    if (!fs.statSync(root).isDirectory()) throw new Error('Project root must be a directory');
    return {
        root,
        identity: process.platform === 'win32' ? root.toLocaleLowerCase('en-US') : root
    };
}

class ProjectTrustStore {
    constructor(storePath) {
        this.storePath = storePath;
        this.records = new Map();
        this.load();
    }

    load() {
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
        } catch {
            return;
        }
        const entries = Array.isArray(parsed) ? parsed : parsed?.projects;
        if (!Array.isArray(entries)) return;
        for (const entry of entries) {
            const candidate = typeof entry === 'string' ? entry : entry?.root;
            try {
                const canonical = canonicalProjectIdentity(candidate);
                this.records.set(canonical.identity, {
                    ...canonical,
                    trustedAt: typeof entry?.trustedAt === 'string' ? entry.trustedAt : null,
                    trustEpoch: typeof entry?.trustEpoch === 'string'
                        ? entry.trustEpoch
                        : `legacy:${typeof entry?.trustedAt === 'string' ? entry.trustedAt : canonical.identity}`
                });
            } catch {}
        }
    }

    persist() {
        fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
        atomicWriteJson(this.storePath, {
            version: STORE_VERSION,
            projects: [...this.records.values()]
        });
    }

    get(projectPath) {
        const canonical = canonicalProjectIdentity(projectPath);
        const record = this.records.get(canonical.identity);
        return {
            ...canonical,
            trusted: !!record,
            mode: record ? 'trusted' : 'safe',
            trustEpoch: record?.trustEpoch || null
        };
    }

    trust(projectPath) {
        const canonical = canonicalProjectIdentity(projectPath);
        const record = { ...canonical, trustedAt: new Date().toISOString(), trustEpoch: randomUUID() };
        this.records.set(canonical.identity, record);
        this.persist();
        return { ...record, trusted: true, mode: 'trusted' };
    }

    revoke(projectPath) {
        const canonical = canonicalProjectIdentity(projectPath);
        const revoked = this.records.delete(canonical.identity);
        if (revoked) this.persist();
        return { ...canonical, trusted: false, mode: 'safe', trustEpoch: null, revoked };
    }

    list() {
        return [...this.records.values()];
    }
}

module.exports = { ProjectTrustStore, canonicalProjectIdentity };
