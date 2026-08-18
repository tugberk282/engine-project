'use strict';

const LIMITS = Object.freeze({
    maxBytes: 16 * 1024 * 1024,
    maxDepth: 64,
    maxValues: 250_000,
    maxGameObjects: 10_000,
    maxComponents: 50_000,
    maxChildrenPerObject: 10_000,
    maxComponentsPerObject: 1_000,
    maxStringBytes: 64 * 1024,
    maxKeyBytes: 256
});

const COMPONENT_TYPE_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/;
const ASSET_FIELD_PATTERN = /^(?:assetPath|sourceAssetPath|prefabSource|skyboxPath|materialPath|texturePath|audioClipPath|animationClipPath|fontPath|scriptPath)$/i;

function snapshotError(code, message) {
    return Object.assign(new Error(message), { code });
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isConfinedAssetPath(value) {
    if (value === null || value === '') return true;
    if (typeof value !== 'string' || value.includes('\0')) return false;
    const normalized = value.replace(/\\/g, '/');
    if (!normalized.startsWith('Assets/') || /^(?:[A-Za-z]:|\/|[A-Za-z][A-Za-z0-9+.-]*:)/.test(normalized)) return false;
    return normalized.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function validateRuntimeSnapshot(snapshotText) {
    if (typeof snapshotText !== 'string') {
        throw snapshotError('INVALID_SNAPSHOT', 'The runtime snapshot must be JSON text.');
    }
    if (Buffer.byteLength(snapshotText, 'utf8') > LIMITS.maxBytes) {
        throw snapshotError('SNAPSHOT_RESOURCE_LIMIT', 'The runtime snapshot exceeds its byte limit.');
    }

    let root;
    try {
        root = JSON.parse(snapshotText);
    } catch {
        throw snapshotError('INVALID_SNAPSHOT', 'The persisted scene snapshot could not be loaded.');
    }
    if (!isRecord(root)) {
        throw snapshotError('INVALID_SNAPSHOT_STRUCTURE', 'The runtime snapshot root must be an object.');
    }
    if (root.formatVersion !== 1) {
        throw snapshotError('RUNTIME_SNAPSHOT_VERSION_MISMATCH', 'The runtime snapshot version is not supported.');
    }
    if (root.gameObjects !== undefined && !Array.isArray(root.gameObjects)) {
        throw snapshotError('INVALID_SNAPSHOT_STRUCTURE', 'The runtime gameObjects field must be an array.');
    }

    let values = 0;
    let gameObjects = 0;
    let components = 0;
    const stack = [{ value: root, depth: 0, key: '', role: 'root' }];
    while (stack.length > 0) {
        const entry = stack.pop();
        values += 1;
        if (values > LIMITS.maxValues || entry.depth > LIMITS.maxDepth) {
            throw snapshotError('SNAPSHOT_RESOURCE_LIMIT', 'The runtime snapshot exceeds structural limits.');
        }

        const value = entry.value;
        if (typeof value === 'number' && !Number.isFinite(value)) {
            throw snapshotError('INVALID_SNAPSHOT_STRUCTURE', 'The runtime snapshot contains a non-finite number.');
        }
        if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > LIMITS.maxStringBytes) {
            throw snapshotError('SNAPSHOT_RESOURCE_LIMIT', 'The runtime snapshot contains an oversized string.');
        }
        if (ASSET_FIELD_PATTERN.test(entry.key) && !isConfinedAssetPath(value)) {
            throw snapshotError('INVALID_ASSET_REFERENCE', 'Runtime asset references must remain under Assets.');
        }
        if (value === null || typeof value !== 'object') continue;

        if (entry.role === 'gameObject') {
            gameObjects += 1;
            if (gameObjects > LIMITS.maxGameObjects || !isRecord(value)) {
                throw snapshotError(gameObjects > LIMITS.maxGameObjects ? 'SNAPSHOT_RESOURCE_LIMIT' : 'INVALID_SNAPSHOT_STRUCTURE',
                    'The runtime snapshot contains invalid or excessive game objects.');
            }
            if (value.id !== undefined && (typeof value.id !== 'string' || Buffer.byteLength(value.id, 'utf8') > 256)) {
                throw snapshotError('INVALID_SNAPSHOT_STRUCTURE', 'Runtime game object identifiers must be bounded strings.');
            }
            if (value.name !== undefined && (typeof value.name !== 'string' || Buffer.byteLength(value.name, 'utf8') > 1024)) {
                throw snapshotError('INVALID_SNAPSHOT_STRUCTURE', 'Runtime game object names must be bounded strings.');
            }
            if (value.children !== undefined && (!Array.isArray(value.children) || value.children.length > LIMITS.maxChildrenPerObject)) {
                throw snapshotError('SNAPSHOT_RESOURCE_LIMIT', 'A runtime game object has excessive children.');
            }
            if (value.components !== undefined && (!Array.isArray(value.components) || value.components.length > LIMITS.maxComponentsPerObject)) {
                throw snapshotError('SNAPSHOT_RESOURCE_LIMIT', 'A runtime game object has excessive components.');
            }
        }
        if (entry.role === 'component') {
            components += 1;
            if (components > LIMITS.maxComponents || !isRecord(value)) {
                throw snapshotError(components > LIMITS.maxComponents ? 'SNAPSHOT_RESOURCE_LIMIT' : 'INVALID_SNAPSHOT_STRUCTURE',
                    'The runtime snapshot contains invalid or excessive components.');
            }
            if (!COMPONENT_TYPE_PATTERN.test(value.type || '')) {
                throw snapshotError('INVALID_COMPONENT_TYPE', 'Runtime component types must be bounded identifiers.');
            }
        }

        if (Array.isArray(value)) {
            for (let index = value.length - 1; index >= 0; index -= 1) {
                let role = 'value';
                if (entry.key === 'gameObjects' || entry.key === 'children') role = 'gameObject';
                else if (entry.key === 'components') role = 'component';
                stack.push({ value: value[index], depth: entry.depth + 1, key: String(index), role });
            }
            continue;
        }
        for (const [key, child] of Object.entries(value)) {
            if (Buffer.byteLength(key, 'utf8') > LIMITS.maxKeyBytes) {
                throw snapshotError('SNAPSHOT_RESOURCE_LIMIT', 'The runtime snapshot contains an oversized field name.');
            }
            stack.push({ value: child, depth: entry.depth + 1, key, role: 'value' });
        }
    }

    return Object.freeze({ root, metrics: Object.freeze({ values, gameObjects, components }) });
}

module.exports = Object.freeze({ LIMITS, validateRuntimeSnapshot, isConfinedAssetPath });
