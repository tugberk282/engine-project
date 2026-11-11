import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
    BehaviourScriptAssetError,
    normalizeBehaviourScriptAssetPath,
    resolveBehaviourScriptAssets
} from '../src/engine/BehaviourScriptAssets.ts';

const require = createRequire(import.meta.url);
const { normalizeAssetPath, resolveBehaviourScriptAssetsForBuild } = require('../electron/build/behaviour-script-assets');

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
