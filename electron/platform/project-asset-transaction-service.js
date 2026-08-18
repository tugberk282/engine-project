'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');

function codedError(code, message) {
    return Object.assign(new Error(message), { code });
}

function decodeBytes(value, field) {
    if (typeof value !== 'string') throw codedError('INVALID_PAYLOAD', `${field} must be base64 encoded`);
    return Buffer.from(value, 'base64');
}

class ProjectAssetTransactionService {
    constructor({ projectService, failureInjector = null, maxTransactions = 100 }) {
        this.projects = projectService;
        this.failureInjector = failureInjector;
        this.maxTransactions = maxTransactions;
        this.transactions = new Map();
        this.locks = new Map();
    }

    async transact(ownerId, request) {
        const key = `${ownerId}:${request.grantId}`;
        const previous = this.locks.get(key) || Promise.resolve();
        let release;
        const pending = new Promise((resolve) => { release = resolve; });
        const lock = previous.then(() => pending);
        this.locks.set(key, lock);
        await previous;
        try {
            if (request.action === 'undo' || request.action === 'redo') {
                return await this.restore(ownerId, request);
            }
            return await this.apply(ownerId, request);
        } finally {
            release();
            if (this.locks.get(key) === lock) this.locks.delete(key);
        }
    }

    async apply(ownerId, request) {
        const transactionId = request.transactionId || randomUUID();
        const existing = this.transactions.get(transactionId);
        if (existing) {
            if (existing.ownerId !== ownerId || existing.grantId !== request.grantId) {
                throw codedError('TRANSACTION_NOT_FOUND', 'Transaction does not belong to this project grant');
            }
            if (existing.state === 'applied') return existing.result;
            return await this.restore(ownerId, { ...request, action: 'redo', transactionId });
        }

        const affected = this.affectedPaths(request);
        const before = await this.capture(ownerId, request.grantId, affected);
        try {
            await this.mutate(ownerId, request);
            this.projects.assertActive(ownerId, request);
            const after = await this.capture(ownerId, request.grantId, affected);
            const result = Object.freeze({
                transactionId,
                operation: request.operation,
                state: 'applied',
                sourcePath: request.sourcePath || null,
                targetPath: request.targetPath || null
            });
            this.transactions.set(transactionId, {
                ownerId,
                grantId: request.grantId,
                affected,
                before,
                after,
                state: 'applied',
                result
            });
            this.trimTransactions();
            return result;
        } catch (error) {
            await this.restoreSnapshot(ownerId, request.grantId, affected, before).catch((rollbackError) => {
                const atomicityError = codedError('TRANSACTION_ROLLBACK_FAILED', 'Asset transaction failed and rollback was incomplete');
                atomicityError.cause = error;
                atomicityError.rollbackError = rollbackError;
                throw atomicityError;
            });
            throw error;
        }
    }

    async restore(ownerId, request) {
        const transaction = this.transactions.get(request.transactionId);
        if (!transaction || transaction.ownerId !== ownerId || transaction.grantId !== request.grantId) {
            throw codedError('TRANSACTION_NOT_FOUND', 'Asset transaction is not available');
        }
        const expected = request.action === 'undo' ? 'applied' : 'undone';
        const nextState = request.action === 'undo' ? 'undone' : 'applied';
        if (transaction.state === nextState) {
            return { ...transaction.result, state: nextState };
        }
        if (transaction.state !== expected) throw codedError('TRANSACTION_STATE_CONFLICT', 'Asset transaction state changed');

        const current = await this.capture(ownerId, request.grantId, transaction.affected);
        const target = request.action === 'undo' ? transaction.before : transaction.after;
        try {
            await this.restoreSnapshot(ownerId, request.grantId, transaction.affected, target);
            transaction.state = nextState;
            return { ...transaction.result, state: nextState };
        } catch (error) {
            await this.restoreSnapshot(ownerId, request.grantId, transaction.affected, current).catch(() => {});
            throw error;
        }
    }

    affectedPaths(request) {
        const paths = new Set((request.referencePatches || []).map((patch) => patch.path));
        if (request.sourcePath) {
            paths.add(request.sourcePath);
            paths.add(`${request.sourcePath}.meta`);
        }
        if (request.targetPath) {
            paths.add(request.targetPath);
            paths.add(`${request.targetPath}.meta`);
        }
        return [...paths].sort((left, right) => left.localeCompare(right, 'en'));
    }

    async mutate(ownerId, request) {
        const sourceContext = request.sourcePath
            ? this.projects.grants.resolveMutation(ownerId, request.grantId, request.sourcePath, { mustExist: true })
            : null;
        const targetContext = request.targetPath
            ? this.projects.grants.resolveMutation(ownerId, request.grantId, request.targetPath)
            : null;
        const source = sourceContext?.path || null;
        const target = targetContext?.path || null;
        const sourceMetaContext = request.sourcePath
            ? this.projects.grants.resolveMutation(ownerId, request.grantId, `${request.sourcePath}.meta`)
            : null;
        const targetMetaContext = request.targetPath
            ? this.projects.grants.resolveMutation(ownerId, request.grantId, `${request.targetPath}.meta`)
            : null;
        const sourceMeta = sourceMetaContext?.path || null;
        const targetMeta = targetMetaContext?.path || null;
        const fs = this.projects.fs;

        if ((request.operation === 'create' || request.operation === 'move' || request.operation === 'duplicate')
            && await this.exists(target)) {
            throw codedError('ASSET_COLLISION', 'The destination asset already exists');
        }

        if (request.operation === 'create') {
            await this.inject('file', request);
            if (request.assetKind === 'directory') await this.projects.confined.mkdir(targetContext);
            else await this.writeAtomic(targetContext, decodeBytes(request.contentBase64 || '', 'contentBase64'));
            await this.inject('meta', request);
            await this.writeAtomic(targetMetaContext, this.createMetadata(request.metadataBase64));
        } else if (request.operation === 'move') {
            await this.inject('file', request);
            await this.projects.confined.rename(sourceContext, targetContext);
            await this.inject('meta', request);
            if (await this.exists(sourceMeta)) await this.projects.confined.rename(sourceMetaContext, targetMetaContext);
        } else if (request.operation === 'duplicate') {
            await this.inject('file', request);
            await this.copyTree(source, target, targetContext.root);
            await this.inject('meta', request);
            await this.duplicateMetadataTree(source, target, targetContext.root);
        } else if (request.operation === 'delete') {
            await this.inject('file', request);
            await this.projects.confined.rm(sourceContext, { recursive: true, force: false });
            await this.inject('meta', request);
            if (await this.exists(sourceMeta)) await this.projects.confined.rm(sourceMetaContext, { force: false });
        } else {
            throw codedError('INVALID_OPERATION', 'Unsupported asset transaction operation');
        }

        for (const patch of request.referencePatches || []) {
            await this.inject('reference', { ...request, referencePath: patch.path });
            const context = this.projects.grants.resolveMutation(ownerId, request.grantId, patch.path, { mustExist: true });
            const current = await fs.readFile(context.path);
            const before = decodeBytes(patch.beforeBase64, 'referencePatches.beforeBase64');
            if (!current.equals(before)) throw codedError('REFERENCE_CONFLICT', `Referenced asset changed: ${patch.path}`);
            await this.writeAtomic(context, decodeBytes(patch.afterBase64, 'referencePatches.afterBase64'));
        }
    }

    createMetadata(encoded) {
        if (encoded) return decodeBytes(encoded, 'metadataBase64');
        return Buffer.from(`${JSON.stringify({ formatVersion: 1, guid: randomUUID() }, null, 2)}\n`, 'utf8');
    }

    async duplicateMetadataTree(source, target, root) {
        const fs = this.projects.fs;
        const sourceStat = await fs.stat(source);
        if (sourceStat.isDirectory()) {
            const entries = await fs.readdir(source, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.endsWith('.meta')) continue;
                await this.duplicateMetadataTree(path.join(source, entry.name), path.join(target, entry.name), root);
            }
        }
        const sourceMeta = `${source}.meta`;
        const targetMeta = `${target}.meta`;
        let metadata = {};
        if (await this.exists(sourceMeta)) {
            const bytes = await fs.readFile(sourceMeta);
            try { metadata = JSON.parse(bytes.toString('utf8')); } catch { metadata = {}; }
        }
        metadata.guid = randomUUID();
        if (!Number.isSafeInteger(metadata.formatVersion)) metadata.formatVersion = 1;
        await this.writeAtomic({ root, path: targetMeta }, Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8'));
    }

    async copyTree(source, target, root) {
        const fs = this.projects.fs;
        const stat = await fs.stat(source);
        if (!stat.isDirectory()) {
            await fs.copyFile(source, target);
            return;
        }
        await fs.mkdir(target);
        for (const entry of await fs.readdir(source, { withFileTypes: true })) {
            if (entry.name.endsWith('.meta')) continue;
            await this.copyTree(path.join(source, entry.name), path.join(target, entry.name), root);
        }
    }

    async capture(ownerId, grantId, relativePaths) {
        const snapshot = new Map();
        for (const relativePath of relativePaths) {
            const absolute = this.projects.grants.resolveMutation(ownerId, grantId, relativePath).path;
            const entries = new Map();
            await this.captureEntry(absolute, '', entries);
            snapshot.set(relativePath, entries);
        }
        return snapshot;
    }

    async captureEntry(absolute, suffix, snapshot) {
        if (!await this.exists(absolute)) return;
        const stat = await this.projects.fs.stat(absolute);
        snapshot.set(suffix, stat.isDirectory() ? null : Buffer.from(await this.projects.fs.readFile(absolute)));
        if (!stat.isDirectory()) return;
        const entries = await this.projects.fs.readdir(absolute, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
            await this.captureEntry(path.join(absolute, entry.name), path.join(suffix, entry.name), snapshot);
        }
    }

    async restoreSnapshot(ownerId, grantId, relativePaths, snapshot) {
        for (const relativePath of [...relativePaths].sort((a, b) => b.length - a.length)) {
            const context = this.projects.grants.resolveMutation(ownerId, grantId, relativePath);
            const absolute = context.path;
            if (await this.exists(absolute)) await this.projects.fs.rm(absolute, { recursive: true, force: true });
        }
        for (const relativePath of relativePaths) {
            const context = this.projects.grants.resolveMutation(ownerId, grantId, relativePath);
            const absolute = context.path;
            const entries = [...(snapshot.get(relativePath) || new Map()).entries()]
                .filter(([suffix]) => suffix === '' || !path.isAbsolute(suffix))
                .sort(([a], [b]) => a.split(path.sep).length - b.split(path.sep).length);
            for (const [suffix, bytes] of entries) {
                const destination = suffix ? path.join(absolute, suffix) : absolute;
                if (bytes === null) {
                    if (!await this.exists(destination)) await this.projects.fs.mkdir(destination, { recursive: true });
                } else {
                    await this.projects.fs.mkdir(path.dirname(destination), { recursive: true });
                    await this.writeAtomic({ ...context, path: destination }, bytes);
                }
            }
        }
        this.projects.assertActive(ownerId, { grantId });
    }

    async writeAtomic(target, bytes) {
        return this.projects.atomicWrite(target, bytes, undefined);
    }

    async exists(target) {
        if (!target) return false;
        try { await this.projects.fs.stat(target); return true; } catch (error) {
            if (error?.code === 'ENOENT') return false;
            throw error;
        }
    }

    async inject(stage, context) {
        if (this.failureInjector) await this.failureInjector(stage, context);
    }

    trimTransactions() {
        while (this.transactions.size > this.maxTransactions) {
            this.transactions.delete(this.transactions.keys().next().value);
        }
    }
}

module.exports = Object.freeze({ ProjectAssetTransactionService });
