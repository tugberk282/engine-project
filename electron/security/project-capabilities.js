const fs = require('node:fs');
const path = require('node:path');

const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const MAX_BINARY_BYTES = 64 * 1024 * 1024;

function canonicalExistingPath(targetPath) {
    return fs.realpathSync.native(path.resolve(targetPath));
}

function canonicalProspectivePath(targetPath) {
    const absolute = path.resolve(targetPath);
    let ancestor = absolute;
    const suffix = [];

    while (!fs.existsSync(ancestor)) {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw new Error('No existing ancestor for path');
        suffix.unshift(path.basename(ancestor));
        ancestor = parent;
    }

    return path.join(canonicalExistingPath(ancestor), ...suffix);
}

function isWithin(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

class ProjectCapabilities {
    constructor() {
        this.roots = new Map();
        this.files = new Map();
        this.session = 0;
    }

    clear() {
        this.roots.clear();
        this.files.clear();
        this.session += 1;
    }

    grantFile(filePath, { writable = false } = {}) {
        if (typeof filePath !== 'string' || filePath.length === 0) {
            throw new TypeError('File path must be a non-empty string');
        }
        const approvedFile = canonicalProspectivePath(filePath);
        this.files.set(approvedFile, { writable: writable === true });
        return approvedFile;
    }

    grant(projectPath, { writable = true } = {}) {
        if (typeof projectPath !== 'string' || projectPath.length === 0) {
            throw new TypeError('Project path must be a non-empty string');
        }
        const root = canonicalExistingPath(projectPath);
        if (!fs.statSync(root).isDirectory()) throw new Error('Project root must be a directory');
        if (!this.roots.has(root) || this.roots.size !== 1) this.clear();
        const identity = fs.statSync(root);
        this.roots.set(root, {
            writable: writable === true,
            device: identity.dev,
            inode: identity.ino
        });
        return root;
    }

    revoke(projectPath) {
        const root = canonicalExistingPath(projectPath);
        if (this.roots.delete(root)) {
            this.files.clear();
            this.session += 1;
            return true;
        }
        return false;
    }

    setWritable(projectPath, writable) {
        const root = canonicalExistingPath(projectPath);
        if (!this.roots.has(root)) throw new Error('Project root has not been granted');
        this.roots.set(root, { ...this.roots.get(root), writable: writable === true });
        return root;
    }

    requireRoot(projectPath) {
        if (typeof projectPath !== 'string' || projectPath.length === 0 || projectPath.includes('\0')) {
            throw new TypeError('Project path must be a non-empty string');
        }
        const root = canonicalExistingPath(projectPath);
        if (!this.roots.has(root)) {
            throw Object.assign(new Error('Project root has not been granted by the main process'), {
                code: 'PROJECT_NOT_GRANTED'
            });
        }
        return root;
    }

    lease() {
        return this.session;
    }

    assertLease(lease) {
        if (lease !== this.session) {
            throw Object.assign(new Error('Project capability session is stale or revoked'), {
                code: 'STALE_PROJECT_SESSION'
            });
        }
    }

    authorize(targetPath, { mustExist = false, allowRoot = true, write = false } = {}) {
        if (typeof targetPath !== 'string' || targetPath.length === 0 || targetPath.includes('\0')) {
            throw new TypeError('Filesystem path must be a non-empty string');
        }
        const candidate = mustExist
            ? canonicalExistingPath(targetPath)
            : canonicalProspectivePath(targetPath);
        const root = [...this.roots.keys()].find((approvedRoot) => isWithin(approvedRoot, candidate));
        const exactFileGrant = this.files.get(candidate);
        if (!root && !exactFileGrant) {
            throw Object.assign(new Error('Path is outside an approved project root or file grant'), {
                code: 'PROJECT_NOT_GRANTED'
            });
        }
        if (write) {
            const writableRoot = root && this.roots.get(root)?.writable === true;
            if (!writableRoot && exactFileGrant?.writable !== true) {
                throw Object.assign(new Error(root
                    ? 'Project is open in safe mode and is read-only'
                    : 'File grant is read-only'), { code: 'SAFE_MODE_DENIED' });
            }
        }
        if (!allowRoot && candidate === root) throw new Error('Operation cannot target the project root');
        return candidate;
    }

    authorizeMutation(targetPath, options = {}) {
        const candidate = this.authorize(targetPath, { ...options, write: options.write !== false });
        const root = [...this.roots.keys()].find((approvedRoot) => isWithin(approvedRoot, candidate));
        const exactFileGrant = this.files.has(candidate);
        const rootGrant = root && this.roots.get(root);
        return {
            path: candidate,
            root: root || (exactFileGrant ? path.dirname(candidate) : null),
            rootIdentity: rootGrant ? { device: rootGrant.device, inode: rootGrant.inode } : undefined
        };
    }

    authorizeMove(sourcePath, targetPath) {
        return {
            source: this.authorize(sourcePath, { mustExist: true, allowRoot: false }),
            target: this.authorize(targetPath, { allowRoot: false, write: true })
        };
    }

    authorizeRename(sourcePath, targetPath) {
        return {
            source: this.authorize(sourcePath, { mustExist: true, allowRoot: false, write: true }),
            target: this.authorize(targetPath, { allowRoot: false, write: true })
        };
    }
}

function normalizeWriteData(data) {
    if (typeof data === 'string') {
        if (Buffer.byteLength(data, 'utf8') > MAX_TEXT_BYTES) throw new Error('Text payload exceeds limit');
        return data;
    }
    if (data && data.__binary === true && Array.isArray(data.data)) {
        if (data.data.length > MAX_BINARY_BYTES || data.data.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
            throw new Error('Invalid binary payload');
        }
        return Buffer.from(data.data);
    }
    throw new TypeError('Write payload must be text or a byte array');
}

module.exports = {
    MAX_TEXT_BYTES,
    ProjectCapabilities,
    normalizeWriteData
};
