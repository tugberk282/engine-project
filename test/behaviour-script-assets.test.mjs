import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
    BehaviourScriptAssetError,
    normalizeBehaviourScriptAssetPath,
    normalizeRuntimePrefabAssetPath,
    resolveBehaviourScriptAssets
} from '../src/engine/BehaviourScriptAssets.ts';
import { BEHAVIOUR_SCRIPT_TEMPLATES, createBehaviourScriptTemplate } from '../src/engine/BehaviourScriptTemplates.ts';

const require = createRequire(import.meta.url);
const { normalizeAssetPath, normalizePrefabPath, resolveBehaviourScriptAssetsForBuild } = require('../electron/build/behaviour-script-assets');

test('BehaviourScript templates produce distinct bounded v1 programs', () => {
    assert.deepEqual(BEHAVIOUR_SCRIPT_TEMPLATES.map((entry) => entry.id), [
        'empty', 'input-movement', 'rotator', 'trigger-deactivator'
    ]);
    const programs = new Map(BEHAVIOUR_SCRIPT_TEMPLATES.map((entry) => [
        entry.id, JSON.parse(createBehaviourScriptTemplate(entry.id))
    ]));
    for (const program of programs.values()) {
        assert.equal(program.version, 1);
        assert.ok(Array.isArray(program.start));
        assert.ok(Array.isArray(program.update));
        assert.ok(Array.isArray(program.fixedUpdate));
        assert.equal(typeof program.events, 'object');
    }
    assert.equal(programs.get('input-movement').update[0].op, 'translate');
    assert.equal(programs.get('rotator').update[0].op, 'addRotation');
    assert.deepEqual(programs.get('trigger-deactivator').events.triggerEnter[0], {
        op: 'setActive', target: { eventField: 'otherId' }, value: false
    });
    assert.equal(new Set(Array.from(programs.values(), (program) => JSON.stringify(program))).size, programs.size);
});

function snapshot(assetPath, cachedProgram = '{}') {
    return JSON.stringify({ formatVersion: 1, gameObjects: [{
        id: 'actor', components: [{ type: 'BehaviourScript', data: { assetPath, program: cachedProgram } }], children: []
    }] });
}

test('BehaviourScript asset paths are project-relative, typed, and traversal-safe', () => {
    for (const valid of ['Assets/Move.behaviour.json', 'Assets/Scripts/Move.behaviour.json', 'Assets\\Scripts\\Move.behaviour.json']) {
        assert.equal(normalizeBehaviourScriptAssetPath(valid), valid.replaceAll('\\', '/'));
        assert.equal(normalizeAssetPath(valid), valid.replaceAll('\\', '/'));
    }
    for (const invalid of ['Move.behaviour.json', '../Move.behaviour.json', 'Assets/../Move.behaviour.json', 'C:\\Move.behaviour.json', '/Assets/Move.behaviour.json', 'Assets/Move.json']) {
        assert.equal(normalizeBehaviourScriptAssetPath(invalid), null);
        assert.equal(normalizeAssetPath(invalid), null);
    }
});

test('runtime prefab paths are project-relative, typed, and traversal-safe', () => {
    for (const valid of ['Assets/Projectile.prefab', 'Assets/Prefabs/Enemy.prefab', 'Assets\\Prefabs\\Enemy.prefab']) {
        assert.equal(normalizeRuntimePrefabAssetPath(valid), valid.replaceAll('\\', '/'));
        assert.equal(normalizePrefabPath(valid), valid.replaceAll('\\', '/'));
    }
    for (const invalid of ['Enemy.prefab', '../Enemy.prefab', 'Assets/../Enemy.prefab', 'C:\\Enemy.prefab', 'Assets/Enemy.json']) {
        assert.equal(normalizeRuntimePrefabAssetPath(invalid), null);
        assert.equal(normalizePrefabPath(invalid), null);
    }
});

test('Play Mode and Windows build resolve runtime prefab assets into Behaviour actions', async (t) => {
    const program = JSON.stringify({ version: 1, events: {
        Fire: [{ op: 'instantiatePrefab', prefabPath: 'Assets/Prefabs/Projectile.prefab', position: [1, 2, 3] }]
    } });
    const inlineSnapshot = snapshot('', program);
    const prefabDocument = JSON.stringify({ formatVersion: 1, data: {
        id: 'projectile-source', name: 'Projectile', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        components: [], children: []
    } });
    const resolved = await resolveBehaviourScriptAssets(inlineSnapshot, 'C:\\Project', async (absolutePath) =>
        absolutePath.replaceAll('\\', '/').endsWith('/Assets/Prefabs/Projectile.prefab') ? prefabDocument : null
    );
    const editorAction = JSON.parse(JSON.parse(resolved).gameObjects[0].components[0].data.program).events.Fire[0];
    assert.equal(editorAction.prefabData.name, 'Projectile');

    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tugberk-runtime-prefab-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const prefabPath = path.join(root, 'Assets', 'Prefabs', 'Projectile.prefab');
    await fs.promises.mkdir(path.dirname(prefabPath), { recursive: true });
    await fs.promises.writeFile(prefabPath, prefabDocument, 'utf8');
    const scenes = [{ value: JSON.parse(inlineSnapshot) }];
    const result = await resolveBehaviourScriptAssetsForBuild(scenes, root);
    const buildAction = JSON.parse(scenes[0].value.gameObjects[0].components[0].data.program).events.Fire[0];
    assert.equal(result.resolvedPrefabCount, 1);
    assert.equal(buildAction.prefabData.name, 'Projectile');
});

test('Play Mode resolver injects the latest reusable program without mutating editor snapshot bytes', async () => {
    const source = JSON.stringify({ version: 1, update: [{ op: 'translate', value: [1, 0, 0] }] }, null, 2);
    const editorSnapshot = snapshot('Assets/Scripts/Move.behaviour.json', '{"version":1,"update":[]}');
    const resolved = await resolveBehaviourScriptAssets(editorSnapshot, 'C:\\Project', async (absolutePath) => {
        assert.match(absolutePath.replaceAll('\\', '/'), /C:\/Project\/Assets\/Scripts\/Move\.behaviour\.json$/i);
        return source;
    });
    assert.equal(JSON.parse(resolved).gameObjects[0].components[0].data.program, source);
    assert.equal(JSON.parse(editorSnapshot).gameObjects[0].components[0].data.program, '{"version":1,"update":[]}');
});

test('Play Mode resolver returns typed missing and invalid asset failures', async () => {
    await assert.rejects(
        resolveBehaviourScriptAssets(snapshot('Assets/Missing.behaviour.json'), 'C:\\Project', async () => null),
        (error) => error instanceof BehaviourScriptAssetError && error.code === 'BEHAVIOUR_SCRIPT_ASSET_MISSING'
    );
    await assert.rejects(
        resolveBehaviourScriptAssets(snapshot('Assets/Bad.behaviour.json'), 'C:\\Project', async () => '{'),
        (error) => error instanceof BehaviourScriptAssetError && error.code === 'BEHAVIOUR_SCRIPT_ASSET_INVALID'
    );
});

test('Windows build resolver packages current asset bytes instead of stale scene cache', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tugberk-behaviour-asset-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const assetPath = path.join(root, 'Assets', 'Scripts', 'Move.behaviour.json');
    await fs.promises.mkdir(path.dirname(assetPath), { recursive: true });
    const source = JSON.stringify({ version: 1, start: [{ op: 'setPosition', value: [4, 5, 6] }] });
    await fs.promises.writeFile(assetPath, source, 'utf8');
    const scenes = [{ path: 'Assets/Scenes/Main.scene.json', value: JSON.parse(snapshot('Assets/Scripts/Move.behaviour.json', '{}')) }];
    const result = await resolveBehaviourScriptAssetsForBuild(scenes, root);
    assert.equal(result.resolvedAssetCount, 1);
    assert.equal(scenes[0].value.gameObjects[0].components[0].data.program, source);
});

test('Windows build resolver rejects missing and malformed external programs', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tugberk-behaviour-invalid-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    await fs.promises.mkdir(path.join(root, 'Assets'), { recursive: true });
    await assert.rejects(
        resolveBehaviourScriptAssetsForBuild([{ value: JSON.parse(snapshot('Assets/Missing.behaviour.json')) }], root),
        (error) => error.code === 'BEHAVIOUR_SCRIPT_ASSET_MISSING'
    );
    const badPath = path.join(root, 'Assets', 'Bad.behaviour.json');
    await fs.promises.writeFile(badPath, '{', 'utf8');
    await assert.rejects(
        resolveBehaviourScriptAssetsForBuild([{ value: JSON.parse(snapshot('Assets/Bad.behaviour.json')) }], root),
        (error) => error.code === 'BEHAVIOUR_SCRIPT_ASSET_INVALID'
    );
});
