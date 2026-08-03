'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ConfinedFileSystem } = require('../security/confined-filesystem');

class ProjectService {
    constructor({ grants, fileSystem = fs.promises, confinedFileSystem, maxTextBytes = 16 * 1024 * 1024 }) {
        this.grants = grants;
        this.fs = fileSystem;
        this.confined = confinedFileSystem || new ConfinedFileSystem({ fileSystem });
        this.maxTextBytes = maxTextBytes;
    }

    resolve(ownerId, resource, options) {
        return this.grants.resolve(ownerId, resource.grantId, resource.path, options);
    }

    assertActive(ownerId, resource) {
        this.grants.assertActive(ownerId, resource.grantId);
    }

    async readText(ownerId, resource) {
        const target = this.resolve(ownerId, resource, { mustExist: true });
        const stat = await this.fs.stat(target);
        this.assertActive(ownerId, resource);
        if (stat.size > this.maxTextBytes) {
            throw Object.assign(new Error('Text file exceeds limit'), { code: 'RESOURCE_TOO_LARGE' });
        }
        const content = await this.fs.readFile(target, 'utf8');
        this.assertActive(ownerId, resource);
        return content;
    }

    async writeText(ownerId, resource, content) {
        const target = this.grants.resolveMutation(ownerId, resource.grantId, resource.path);
        await this.atomicWrite(target, content, 'utf8', () => this.assertActive(ownerId, resource));
        return true;
    }

    async listDirectory(ownerId, resource) {
        const target = this.resolve(ownerId, resource, { mustExist: true });
        const entries = await this.fs.readdir(target, { withFileTypes: true });
        this.assertActive(ownerId, resource);
        return entries
            .map((entry) => ({
                name: entry.name,
                isDirectory: entry.isDirectory(),
                isFile: entry.isFile(),
                isSymbolicLink: entry.isSymbolicLink()
            }))
            .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    }

    async move(ownerId, source, destination) {
        this.confined.fs = this.fs;
        const sourcePath = this.grants.resolveMutation(ownerId, source.grantId, source.path, { mustExist: true });
        const destinationPath = this.grants.resolveMutation(ownerId, destination.grantId, destination.path);
        this.assertActive(ownerId, source);
        try {
            await this.confined.rename(sourcePath, destinationPath);
            this.assertActive(ownerId, source);
        } catch (error) {
            if (error?.code === 'GRANT_NOT_FOUND' || error?.code === 'STALE_CAPABILITY') {
                await this.confined.rename(destinationPath, sourcePath).catch(() => {});
            }
            throw error;
        }
        return true;
    }

    async atomicWrite(target, content, encoding, assertActive = () => {}) {
        this.confined.fs = this.fs;
        await this.confined.atomicWrite(target, content, encoding, assertActive);
    }
}

module.exports = Object.freeze({ ProjectService });
