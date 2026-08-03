'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_FORMAT_VERSION = 1;
const SCENE_FORMAT_VERSION = 1;
const PREFAB_FORMAT_VERSION = 1;

class PersistenceError extends Error {
    constructor(code, message, details = undefined, cause = undefined) {
        super(message, cause ? { cause } : undefined);
        this.name = 'PersistenceError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

function fail(code, message, details, cause) {
    throw new PersistenceError(code, message, details, cause);
}

function assertRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('DOCUMENT_INVALID', `${label} must be an object`, { label });
    }
}

function normalizePath(value) {
    return typeof value === 'string' ? value.replaceAll('\\', '/') : value;
}

function canonicalize(value, stack = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail('NUMBER_INVALID', 'Persisted numbers must be finite');
        return Object.is(value, -0) ? 0 : value;
    }
    if (typeof value === 'undefined') return undefined;
    if (typeof value !== 'object') fail('VALUE_INVALID', `Unsupported persisted value: ${typeof value}`);
    if (stack.has(value)) fail('CYCLIC_REFERENCE', 'Cannot persist cyclic data');
    stack.add(value);
    let result;
    if (Array.isArray(value)) {
        result = value.map((entry) => {
            const normalized = canonicalize(entry, stack);
            if (normalized === undefined) fail('VALUE_INVALID', 'Arrays cannot contain undefined');
            return normalized;
        });
    } else {
        result = {};
        for (const key of Object.keys(value).sort()) {
            const normalized = canonicalize(value[key], stack);
            if (normalized !== undefined) result[key] = normalized;
        }
    }
    stack.delete(value);
    return result;
}

function stableStringify(value, space = 2) {
    return `${JSON.stringify(canonicalize(value), null, space)}\n`;
}

function contentHash(valueOrText) {
    const text = typeof valueOrText === 'string' ? valueOrText : stableStringify(valueOrText);
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function atomicWriteText(filePath, content, options = {}) {
    const io = options.fs || fs;
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.tmp`;
    const backupPath = `${filePath}.bak`;
    const currentText = io.existsSync(filePath) ? io.readFileSync(filePath, 'utf8') : null;
    const currentRevision = currentText === null ? null : contentHash(currentText);
    if (options.expectedRevision !== undefined && options.expectedRevision !== currentRevision) {
        fail('REVISION_CONFLICT', 'The document changed since it was read', {
            expectedRevision: options.expectedRevision,
            actualRevision: currentRevision
        });
    }
    io.mkdirSync(directory, { recursive: true });
    let handle;
    try {
        handle = io.openSync(temporaryPath, 'w');
        io.writeFileSync(handle, content, 'utf8');
        io.fsyncSync(handle);
        io.closeSync(handle);
        handle = undefined;
        if (currentText !== null && !options.preserveBackup) io.copyFileSync(filePath, backupPath);
        io.renameSync(temporaryPath, filePath);
        try {
            const directoryHandle = io.openSync(directory, 'r');
            try { io.fsyncSync(directoryHandle); } finally { io.closeSync(directoryHandle); }
        } catch {}
    } catch (error) {
        if (handle !== undefined) {
            try { io.closeSync(handle); } catch {}
        }
        try { if (io.existsSync(temporaryPath)) io.unlinkSync(temporaryPath); } catch {}
        if (error instanceof PersistenceError) throw error;
        fail('WRITE_FAILED', `Could not durably write ${filePath}`, { filePath }, error);
    }
    return { revision: contentHash(content), previousRevision: currentRevision };
}

function atomicWriteJson(filePath, value, options = {}) {
    return atomicWriteText(filePath, stableStringify(value), options);
}

function migrateProjectV0(value) {
    return { ...value, formatVersion: 1, scenes: Array.isArray(value.scenes) ? value.scenes : [] };
}
function migrateSceneV0(value, options) {
    return {
        ...value,
        formatVersion: 1,
        sceneId: value.sceneId || options.createId?.() || null,
        name: typeof value.name === 'string' ? value.name : 'Untitled'
    };
}
function migratePrefabV0(value, options) {
    return {
        ...value,
        formatVersion: 1,
        prefabId: value.prefabId || options.createId?.() || null,
        name: typeof value.name === 'string' ? value.name : 'Prefab'
    };
}

const SCHEMA_REGISTRY = Object.freeze({
    project: Object.freeze({ currentVersion: PROJECT_FORMAT_VERSION, migrations: Object.freeze({ 0: migrateProjectV0 }) }),
    scene: Object.freeze({ currentVersion: SCENE_FORMAT_VERSION, migrations: Object.freeze({ 0: migrateSceneV0 }) }),
    prefab: Object.freeze({ currentVersion: PREFAB_FORMAT_VERSION, migrations: Object.freeze({ 0: migratePrefabV0 }) })
});

function migrateDocument(kind, value, options = {}) {
    assertRecord(value, kind);
    const schema = SCHEMA_REGISTRY[kind];
    if (!schema) fail('DOCUMENT_KIND_UNKNOWN', `Unknown document kind: ${kind}`, { kind });
    let version = value.formatVersion ?? 0;
    if (!Number.isInteger(version) || version < 0) fail('VERSION_INVALID', `${kind} formatVersion must be a non-negative integer`);
    if (version > schema.currentVersion) {
        fail('VERSION_UNSUPPORTED', `${kind} format version ${version} is newer than ${schema.currentVersion}`, {
            kind, version, supportedVersion: schema.currentVersion
        });
    }
    let migrated = value;
    while (version < schema.currentVersion) {
        const migration = schema.migrations[version];
        if (!migration) fail('MIGRATION_MISSING', `No ${kind} migration from version ${version}`);
        migrated = migration(migrated, options);
        version += 1;
        if (migrated.formatVersion !== version) fail('MIGRATION_INVALID', `${kind} migration did not advance exactly one version`);
    }
    return migrated;
}

function migrateProject(value, options) { return migrateDocument('project', value, options); }
function migrateScene(value, options) { return migrateDocument('scene', value, options); }
function migratePrefab(value, options) { return migrateDocument('prefab', value, options); }

function collectIds(nodes, seen = new Set()) {
    for (const node of nodes) {
        assertRecord(node, 'Game object');
        if (typeof node.id !== 'string' || node.id.length === 0) fail('OBJECT_ID_INVALID', 'Game object ID is required');
        if (seen.has(node.id)) fail('DUPLICATE_ID', `Duplicate game object ID: ${node.id}`, { id: node.id });
        seen.add(node.id);
        if (node.children !== undefined) {
            if (!Array.isArray(node.children)) fail('CHILDREN_INVALID', 'Game object children must be an array');
            collectIds(node.children, seen);
        }
    }
}

function validateDocument(kind, value) {
    assertRecord(value, kind);
    const schema = SCHEMA_REGISTRY[kind];
    if (!schema) fail('DOCUMENT_KIND_UNKNOWN', `Unknown document kind: ${kind}`, { kind });
    if (value.formatVersion !== schema.currentVersion) fail('VERSION_INVALID', `${kind} formatVersion is invalid`);
    const idField = `${kind}Id`;
    if (typeof value[idField] !== 'string' || value[idField].length === 0) fail('DOCUMENT_ID_INVALID', `${idField} is required`);
    if (typeof value.name !== 'string' || value.name.length === 0) fail('DOCUMENT_NAME_INVALID', `${kind} name is required`);
    if (kind === 'project') {
        if (!Array.isArray(value.scenes)) fail('PROJECT_SCENES_INVALID', 'Project scenes must be an array');
        const ids = new Set();
        for (const scene of value.scenes) {
            assertRecord(scene, 'Project scene entry');
            if (typeof scene.sceneId !== 'string' || !scene.sceneId) fail('SCENE_ID_INVALID', 'Project scene ID is required');
            if (ids.has(scene.sceneId)) fail('DUPLICATE_ID', `Duplicate project scene ID: ${scene.sceneId}`);
            ids.add(scene.sceneId);
            if (typeof scene.path !== 'string' || !scene.path) fail('SCENE_PATH_INVALID', 'Project scene path is required');
        }
    } else {
        const roots = kind === 'scene' ? value.gameObjects : [value.data];
        if (kind === 'scene' && !Array.isArray(roots)) fail('SCENE_OBJECTS_INVALID', 'Scene gameObjects must be an array');
        if (kind === 'prefab' && (!value.data || typeof value.data !== 'object')) fail('PREFAB_DATA_INVALID', 'Prefab data is required');
        collectIds(roots);
    }
    canonicalize(value);
    return value;
}

function normalizeDocument(kind, value) {
    const normalized = canonicalize(value);
    if (kind === 'project') {
        normalized.scenes = normalized.scenes.map((scene) => ({ ...scene, path: normalizePath(scene.path) }));
    }
    return normalized;
}

function loadVersionedJson(filePath, kind, options = {}) {
    const io = options.fs || fs;
    const backupPath = `${filePath}.bak`;
    let sourcePath = filePath;
    let sourceText;
    let parsed;
    try {
        sourceText = io.readFileSync(filePath, 'utf8');
        parsed = JSON.parse(sourceText);
    } catch (primaryError) {
        if (!io.existsSync(backupPath)) fail('DOCUMENT_CORRUPT', `Could not read ${filePath}`, { filePath }, primaryError);
        try {
            sourceText = io.readFileSync(backupPath, 'utf8');
            parsed = JSON.parse(sourceText);
            sourcePath = backupPath;
        } catch (backupError) {
            fail('RECOVERY_FAILED', `Primary and backup are corrupt for ${filePath}`, { filePath }, backupError);
        }
    }
    const originalVersion = parsed?.formatVersion ?? 0;
    const migrated = normalizeDocument(kind, migrateDocument(kind, parsed, options));
    validateDocument(kind, migrated);
    const changed = sourcePath !== filePath || originalVersion !== migrated.formatVersion || stableStringify(migrated) !== sourceText;
    if (changed) {
        atomicWriteText(filePath, stableStringify(migrated), {
            fs: io,
            preserveBackup: sourcePath === backupPath
        });
    }
    const text = stableStringify(migrated);
    return {
        value: migrated,
        revision: contentHash(text),
        recoveredFromBackup: sourcePath === backupPath,
        migrated: originalVersion !== migrated.formatVersion
    };
}

function createRuntimeSnapshot(scene) {
    validateDocument('scene', scene);
    const { editorState, ...runtime } = scene;
    const value = normalizeDocument('scene', runtime);
    const text = stableStringify(value);
    return { value, text, hash: contentHash(text) };
}

module.exports = {
    PROJECT_FORMAT_VERSION,
    SCENE_FORMAT_VERSION,
    PREFAB_FORMAT_VERSION,
    SCHEMA_REGISTRY,
    PersistenceError,
    stableStringify,
    contentHash,
    atomicWriteText,
    atomicWriteJson,
    migrateDocument,
    migrateProject,
    migrateScene,
    migratePrefab,
    validateDocument,
    normalizeDocument,
    loadVersionedJson,
    createRuntimeSnapshot
};
