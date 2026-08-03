'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isRecentProjectsPayload } = require('../architecture/contract');
const MAX_STORE_BYTES = 40 * 1024;

class RecentProjectService {
    constructor(storePath) {
        this.storePath = storePath;
    }

    async load() {
        try {
            const stat = await fs.promises.stat(this.storePath);
            if (stat.size > MAX_STORE_BYTES) return [];
            const text = await fs.promises.readFile(this.storePath, 'utf8');
            const projects = JSON.parse(text);
            return isRecentProjectsPayload({ projects }) ? projects : [];
        } catch {
            return [];
        }
    }

    async save(projects) {
        if (!isRecentProjectsPayload({ projects })) {
            throw Object.assign(new Error('Recent projects payload rejected'), { code: 'INVALID_PAYLOAD' });
        }
        const directory = path.dirname(this.storePath);
        const temporaryPath = `${this.storePath}.${randomUUID()}.tmp`;
        await fs.promises.mkdir(directory, { recursive: true });
        try {
            await fs.promises.writeFile(temporaryPath, `${JSON.stringify(projects, null, 2)}\n`, {
                encoding: 'utf8',
                flag: 'wx'
            });
            await fs.promises.rename(temporaryPath, this.storePath);
        } catch (error) {
            await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
            throw error;
        }
        return true;
    }
}

module.exports = { RecentProjectService };
