'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function securityError(message, code = 'UNSAFE_FILESYSTEM_PATH') {
    return Object.assign(new Error(message), { code });
}

function isWithin(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '' || (
        relative !== '..'
        && !relative.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relative)
    );
}

class ConfinedFileSystem {
    constructor({ fileSystem = fs.promises, beforeCommit = async () => {} } = {}) {
        this.fs = fileSystem;
        this.beforeCommit = beforeCommit;
    }

    async exists(targetPath) {
        try {
            await this.fs.lstat(targetPath);
            return true;
        } catch (error) {
            if (error?.code === 'ENOENT') return false;
            throw error;
        }
    }

    async inspect(rootPath, targetPath, {
        allowRoot = false,
        rejectTargetLink = true,
        rootIdentity
    } = {}) {
        const root = path.resolve(rootPath);
        const target = path.resolve(targetPath);
        if (!isWithin(root, target)) throw securityError('Mutation path is outside the capability root');
        if (!allowRoot && target === root) {
            throw securityError('Destructive operation cannot target the capability root', 'CAPABILITY_ROOT_DENIED');
        }

        const rootLink = await this.fs.lstat(root);
        if (rootLink.isSymbolicLink()) throw securityError('Capability root cannot be a reparse point');
        const rootStat = await this.fs.stat(root);
        if (!rootStat.isDirectory()) throw securityError('Capability root must remain a directory');
        if (rootIdentity && (
            rootStat.dev !== rootIdentity.device
            || rootStat.ino !== rootIdentity.inode
        )) {
            throw securityError('Capability root identity changed', 'CAPABILITY_ROOT_CHANGED');
        }

        const relative = path.relative(root, target);
        const segments = relative === '' ? [] : relative.split(path.sep);
        let current = root;
        for (let index = 0; index < segments.length; index += 1) {
            current = path.join(current, segments[index]);
            let linkStat;
            try {
                linkStat = await this.fs.lstat(current);
            } catch (error) {
                if (error?.code === 'ENOENT') break;
                throw error;
            }
            const isTarget = index === segments.length - 1;
            if (linkStat.isSymbolicLink() && (!isTarget || rejectTargetLink)) {
                throw securityError('Mutation path contains a symbolic link or junction');
            }
            const followed = await this.fs.stat(current);
            if (followed.dev !== rootStat.dev) {
                throw securityError('Mutation cannot cross a filesystem device boundary', 'DEVICE_BOUNDARY_DENIED');
            }
            if (!isTarget && !followed.isDirectory()) {
                throw securityError('Mutation ancestor is not a directory');
            }
        }
        return { root, target };
    }

    async commit(operation, contexts, callback, guard = () => {}) {
        const checked = [];
        for (const context of contexts) checked.push(await this.inspect(context.root, context.path, {
            ...context.options,
            rootIdentity: context.rootIdentity
        }));
        await this.beforeCommit(operation, checked);
        guard();
        const rechecked = [];
        for (const context of contexts) rechecked.push(await this.inspect(context.root, context.path, {
            ...context.options,
            rootIdentity: context.rootIdentity
        }));
        return callback(rechecked);
    }

    async mkdir(context, options = {}) {
        return this.commit('mkdir', [context], ([target]) => this.fs.mkdir(target.target, {
            recursive: options.recursive === true
        }));
    }

    async atomicWrite(context, data, encoding, guard = () => {}) {
        const temporary = `${context.path}.tugberk-${randomUUID()}.tmp`;
        const backup = `${context.path}.tugberk-${randomUUID()}.bak`;
        let handle;
        try {
            await this.inspect(context.root, temporary, { rootIdentity: context.rootIdentity });
            await this.inspect(context.root, backup, { rootIdentity: context.rootIdentity });
            handle = await this.fs.open(temporary, 'wx');
            await handle.writeFile(data, encoding);
            await handle.sync();
            await handle.close();
            handle = null;
            return await this.commit('atomicWrite', [context, {
                root: context.root,
                path: temporary,
                options: { rejectTargetLink: true }
            }, {
                root: context.root,
                path: backup,
                options: { rejectTargetLink: true }
            }], async ([target, temp, recovery]) => {
                const targetExists = await this.exists(target.target);
                if (!targetExists) return this.fs.rename(temp.target, target.target);

                await this.fs.rename(target.target, recovery.target);
                try {
                    await this.fs.rename(temp.target, target.target);
                    await this.fs.rm(recovery.target, { force: true });
                } catch (error) {
                    if (await this.exists(recovery.target) && !await this.exists(target.target)) {
                        await this.fs.rename(recovery.target, target.target);
                    }
                    throw error;
                }
            }, guard);
        } catch (error) {
            await handle?.close().catch(() => {});
            // Only clean up while the lexical temp path is still demonstrably confined.
            try {
                const safeTemp = await this.inspect(context.root, temporary, { rootIdentity: context.rootIdentity });
                await this.fs.rm(safeTemp.target, { force: true });
            } catch {}
            try {
                const safeBackup = await this.inspect(context.root, backup, { rootIdentity: context.rootIdentity });
                if (await this.exists(safeBackup.target)) {
                    if (!await this.exists(context.path)) await this.fs.rename(safeBackup.target, context.path);
                    else await this.fs.rm(safeBackup.target, { force: true });
                }
            } catch {}
            throw error;
        }
    }

    async copy(sourceContext, targetContext) {
        const data = await this.commit('copyRead', [sourceContext], ([source]) =>
            this.fs.readFile(source.target));
        return this.atomicWrite(targetContext, data);
    }

    async rename(sourceContext, targetContext) {
        return this.commit('rename', [sourceContext, targetContext], ([source, target]) =>
            this.fs.rename(source.target, target.target));
    }

    async rm(context, options = {}) {
        return this.commit('rm', [context], ([target]) => this.fs.rm(target.target, {
            recursive: options.recursive === true,
            force: options.force === true
        }));
    }

    async unlink(context) {
        return this.commit('unlink', [context], ([target]) => this.fs.unlink(target.target));
    }
}

module.exports = Object.freeze({ ConfinedFileSystem });
