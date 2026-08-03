'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
    PersistenceError,
    stableStringify,
    contentHash,
    atomicWriteJson,
    loadVersionedJson,
    migrateScene,
    validateDocument,
    createRuntimeSnapshot
} = require('../electron/architecture/persistence');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

test('canonical project and scene fixtures round-trip deterministically', () => {
    for (const name of ['project-v1.json', 'scene-v1.json']) {
        const value = fixture(name);
        assert.equal(stableStringify(JSON.parse(stableStringify(value))), stableStringify(value));
    }
});

test('stable scene and object identifiers survive load and edits', () => {
    const scene = fixture('scene-v1.json');
    const before = { sceneId: scene.sceneId, objectId: scene.gameObjects[0].id };
    scene.gameObjects[0].name = 'Renamed Player';
    const loaded = JSON.parse(stableStringify(scene));
    assert.deepEqual({ sceneId: loaded.sceneId, objectId: loaded.gameObjects[0].id }, before);
    validateDocument('scene', loaded);
});

test('legacy scenes migrate forward through an explicit hook', () => {
    const migrated = migrateScene({ version: '1.4', gameObjects: [], environment: {} }, {
        createId: () => 'scene-migrated'
    });
    assert.equal(migrated.formatVersion, 1);
    assert.equal(migrated.sceneId, 'scene-migrated');
    assert.equal(migrated.name, 'Untitled');
});

test('atomic saves leave the prior valid generation as a recovery backup', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-persistence-'));
    const filePath = path.join(directory, 'Main.json');
    const first = fixture('scene-v1.json');
    const second = { ...first, name: 'Changed' };
    atomicWriteJson(filePath, first);
    atomicWriteJson(filePath, second);
    assert.deepEqual(JSON.parse(fs.readFileSync(`${filePath}.bak`, 'utf8')), first);
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), second);
});

test('corrupt primary and interrupted temporary saves recover from backup', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-recovery-'));
    const filePath = path.join(directory, 'Main.json');
    const scene = fixture('scene-v1.json');
    fs.writeFileSync(`${filePath}.bak`, stableStringify(scene));
    fs.writeFileSync(filePath, '{"truncated":');
    fs.writeFileSync(`${filePath}.tmp`, '{"interrupted":');
    const result = loadVersionedJson(filePath, 'scene');
    assert.equal(result.recoveredFromBackup, true);
    assert.equal(result.value.sceneId, 'scene-main');
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), scene);
});

test('future versions and invalid values fail with typed errors without mutation', () => {
    const future = { ...fixture('scene-v1.json'), formatVersion: 99 };
    const before = JSON.stringify(future);
    assert.throws(
        () => validateDocument('scene', future),
        (error) => error instanceof PersistenceError && error.code === 'VERSION_INVALID'
    );
    assert.throws(
        () => stableStringify({ value: Number.NaN }),
        (error) => error instanceof PersistenceError && error.code === 'NUMBER_INVALID'
    );
    assert.equal(JSON.stringify(future), before);
});

test('cyclic containers fail deterministically without mutating their source graph', () => {
    const cyclic = { label: 'root', child: { value: 1 } };
    cyclic.child.back = cyclic;

    assert.throws(
        () => stableStringify(cyclic),
        (error) => error instanceof PersistenceError && error.code === 'CYCLIC_REFERENCE'
    );
    assert.equal(cyclic.child.back, cyclic);
    assert.equal(cyclic.child.value, 1);
});

test('duplicate object IDs are rejected across the complete hierarchy', () => {
    const scene = fixture('scene-v1.json');
    scene.gameObjects[0].children = [{ ...scene.gameObjects[0], children: [] }];
    assert.throws(
        () => validateDocument('scene', scene),
        (error) => error instanceof PersistenceError && error.code === 'DUPLICATE_ID'
    );
});

test('writes return revisions and reject stale revision conflicts', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-revision-'));
    const filePath = path.join(directory, 'Main.json');
    const first = atomicWriteJson(filePath, fixture('scene-v1.json'));
    assert.equal(first.revision, contentHash(fs.readFileSync(filePath, 'utf8')));
    assert.throws(
        () => atomicWriteJson(filePath, { ...fixture('scene-v1.json'), name: 'stale' }, { expectedRevision: 'old' }),
        (error) => error instanceof PersistenceError && error.code === 'REVISION_CONFLICT'
    );
});

test('project paths normalize across Windows and Linux inputs', () => {
    const windows = fixture('project-v1.json');
    const linux = fixture('project-v1.json');
    windows.scenes[0].path = 'Assets\\Scenes\\Main.scene.json';
    linux.scenes[0].path = 'Assets/Scenes/Main.scene.json';
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-paths-'));
    const a = path.join(directory, 'windows.json');
    const b = path.join(directory, 'linux.json');
    fs.writeFileSync(a, JSON.stringify(windows));
    fs.writeFileSync(b, JSON.stringify(linux));
    assert.equal(loadVersionedJson(a, 'project').revision, loadVersionedJson(b, 'project').revision);
});

test('runtime snapshot excludes editor-only state and has a stable replay hash', () => {
    const scene = fixture('scene-v1.json');
    scene.editorState = { selection: ['player-root'] };
    const first = createRuntimeSnapshot(scene);
    scene.editorState.selection = [];
    const second = createRuntimeSnapshot(scene);
    assert.equal(first.hash, second.hash);
    assert.equal('editorState' in first.value, false);
});

test('unknown scene, object, component, and nested fields survive canonical persistence', () => {
    const scene = fixture('scene-v1.json');
    scene.futureSceneField = { revision: 7 };
    scene.environment.futureLighting = { probeMode: 'adaptive' };
    scene.gameObjects[0].futureObjectField = ['keep', 42];
    scene.gameObjects[0].components.push({
        type: 'FutureRenderer',
        data: { futureProperty: { quality: 'cinematic' } },
        futureComponentMetadata: true
    });

    const reloaded = JSON.parse(stableStringify(migrateScene(scene)));
    assert.deepEqual(reloaded.futureSceneField, { revision: 7 });
    assert.deepEqual(reloaded.environment.futureLighting, { probeMode: 'adaptive' });
    assert.deepEqual(reloaded.gameObjects[0].futureObjectField, ['keep', 42]);
    assert.deepEqual(reloaded.gameObjects[0].components.at(-1), {
        data: { futureProperty: { quality: 'cinematic' } },
        futureComponentMetadata: true,
        type: 'FutureRenderer'
    });
});
