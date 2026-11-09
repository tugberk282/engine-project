import assert from 'node:assert/strict';
import test from 'node:test';
import {
    normalizeRuntimeScenePath,
    resolveRuntimeScenePath
} from '../src/engine/RuntimeSceneTransition.ts';

test('runtime scene paths are project-relative Assets paths', () => {
    assert.equal(normalizeRuntimeScenePath(' Assets\\Scenes\\Level.scene.json '), 'Assets/Scenes/Level.scene.json');
    for (const value of [null, '', '../Level.scene.json', 'Assets/../Level.scene.json', '/Assets/Level.scene.json', 'C:\\Assets\\Level.scene.json', 'Assets//Level.scene.json']) {
        assert.equal(normalizeRuntimeScenePath(value), null);
    }
});

test('runtime scene transitions are confined to the effective Scenes In Build list', () => {
    const projectScenes = ['Assets/Scenes/Main.scene.json', 'Assets/Scenes/Level.scene.json'];
    assert.equal(resolveRuntimeScenePath('assets\\scenes\\level.scene.json', [], projectScenes), 'Assets/Scenes/Level.scene.json');
    assert.equal(resolveRuntimeScenePath('Assets/Scenes/Level.scene.json', ['Assets/Scenes/Main.scene.json'], projectScenes), null);
    assert.equal(resolveRuntimeScenePath('Assets/Scenes/Main.scene.json', ['Assets\\Scenes\\Main.scene.json'], projectScenes), 'Assets/Scenes/Main.scene.json');
    assert.equal(resolveRuntimeScenePath('Assets/Scenes/Unknown.scene.json', [], projectScenes), null);
});
