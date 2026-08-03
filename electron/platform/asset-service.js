'use strict';

const path = require('node:path');

function cancellationError() {
    return Object.assign(new Error('Asset scan was cancelled'), { code: 'REQUEST_CANCELLED' });
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
        );
    }
    return value;
}

class AssetService {
    constructor({ projectService, maxDepth = 64, maxEntries = 50_000, concurrency = 8 }) {
        this.projects = projectService;
        this.maxDepth = maxDepth;
        this.maxEntries = maxEntries;
        this.concurrency = concurrency;
    }

    async scan(ownerId, resource, { signal, onProgress } = {}) {
        const root = this.projects.resolve(ownerId, resource, { mustExist: true });
        const pending = [{ absolute: root, relative: resource.path, depth: 0 }];
        const assets = [];
        let visited = 0;

        while (pending.length > 0) {
            if (signal?.aborted) throw cancellationError();
            const batch = pending.splice(0, this.concurrency);
            const results = await Promise.all(batch.map(async (directory) => ({
                directory,
                entries: await this.projects.fs.readdir(directory.absolute, { withFileTypes: true })
            })));
            this.projects.assertActive(ownerId, resource);
            for (const { directory, entries } of results) {
                for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
                    if (signal?.aborted) throw cancellationError();
                    visited += 1;
                    if (visited > this.maxEntries) {
                        throw Object.assign(new Error('Asset scan entry limit exceeded'), { code: 'SCAN_LIMIT_EXCEEDED' });
                    }
                    const relative = path.posix.join(directory.relative.replace(/\\/g, '/'), entry.name);
                    if (entry.isSymbolicLink()) continue;
                    if (entry.isDirectory()) {
                        if (directory.depth >= this.maxDepth) {
                            throw Object.assign(new Error('Asset scan depth limit exceeded'), { code: 'SCAN_LIMIT_EXCEEDED' });
                        }
                        pending.push({
                            absolute: path.join(directory.absolute, entry.name),
                            relative,
                            depth: directory.depth + 1
                        });
                    } else if (entry.isFile()) {
                        assets.push(relative);
                    }
                }
            }
            onProgress?.({ visited, pending: pending.length });
        }
        return { assets: assets.sort((a, b) => a.localeCompare(b, 'en')), scannedCount: visited };
    }

    async move(ownerId, source, destination) {
        const sourceMeta = { ...source, path: `${source.path}.meta` };
        const destinationMeta = { ...destination, path: `${destination.path}.meta` };
        let metaMoved = false;
        try {
            await this.projects.move(ownerId, sourceMeta, destinationMeta);
            metaMoved = true;
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        try {
            await this.projects.move(ownerId, source, destination);
        } catch (error) {
            if (metaMoved) await this.projects.move(ownerId, destinationMeta, sourceMeta).catch(() => {});
            throw error;
        }
        return { moved: true, metadataMoved: metaMoved };
    }

    async writeMetadata(ownerId, resource, metadata) {
        const normalized = `${JSON.stringify(stableValue(metadata), null, 2)}\n`;
        return this.projects.writeText(ownerId, resource, normalized);
    }
}

module.exports = Object.freeze({ AssetService, cancellationError });
