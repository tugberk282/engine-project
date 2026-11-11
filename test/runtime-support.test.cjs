'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectRuntimeDiagnostics } = require('../electron/build/runtime-support');

test('runtime diagnostics reports unsupported components without hiding supported ones', () => {
    const diagnostics = collectRuntimeDiagnostics([{
        path: 'Scenes/Main.scene',
        value: { gameObjects: [
            { id: 'camera', components: [{ type: 'Camera' }] },
            { components: [{ type: 'BoxCollider' }, { type: 'CustomEnemyScript' }], children: [{ components: [{ type: 'CustomEnemyScript' }] }] }
        ] }
    }]);
    assert.deepEqual(diagnostics, [{ type: 'CustomEnemyScript', count: 2, scenes: ['Scenes/Main.scene'] }]);
});

test('runtime diagnostics is empty for the supported gameplay contract', () => {
    assert.deepEqual(collectRuntimeDiagnostics([{
        path: 'Scenes/Main.scene', value: { gameObjects: [
            { id: 'camera', components: [{ type: 'Camera' }] },
            { components: [{ type: 'PlayerController' }, { type: 'RigidBody' }, { type: 'BoxCollider' }, { type: 'AudioSource' }, { type: 'UIEventAction' }, { type: 'BehaviourScript', data: { program: '{}' } }] },
            { components: [{ type: 'Canvas' }], children: [
                { components: [{ type: 'RectTransform', data: { sizeDelta: [160, 30] } }, { type: 'VerticalLayoutGroup' }, { type: 'HorizontalLayoutGroup' }, { type: 'ContentSizeFitter' }, { type: 'UIScrollbar' }, { type: 'UIScrollRect', data: { movementType: 'Clamped', inertia: false } }, { type: 'UIButton', data: { eventName: 'Start' } }] }
            ] }
        ] }
    }]), []);
});

test('runtime diagnostics reports ScrollRect behavior outside the standalone contract', () => {
    const diagnostics = collectRuntimeDiagnostics([{
        path: 'Assets/Scenes/Menu.scene.json', value: { gameObjects: [
            { id: 'camera', components: [{ type: 'Camera' }] },
            { id: 'inventory', name: 'Inventory', components: [{ type: 'UIScrollRect', data: { movementType: 'Elastic', inertia: true } }] }
        ] }
    }]);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].type, 'PartialScrollRectBehavior');
    assert.match(diagnostics[0].message, /clamped non-inertial/);
});

test('runtime diagnostics exposes missing cameras and invalid overlay stacks', () => {
    const diagnostics = collectRuntimeDiagnostics([
        { path: 'Scenes/NoCamera.scene', value: { gameObjects: [{ components: [] }] } },
        { path: 'Scenes/Disabled.scene', value: { gameObjects: [{ id: 'camera', enabled: false, components: [{ type: 'Camera' }] }] } },
        { path: 'Scenes/Stack.scene', value: { gameObjects: [
            { id: 'base', components: [{ type: 'Camera', data: { renderType: 'Base' } }] },
            { id: 'overlay', components: [{ type: 'Camera', data: { renderType: 'Overlay', stackBaseCamera: { __ref: 'missing' } } }] }
        ] } }
    ]);
    assert.deepEqual(diagnostics.map(entry => [entry.type, entry.scenes[0], entry.count]), [
        ['InvalidCameraStack', 'Scenes/Stack.scene', 1],
        ['MissingCamera', 'Scenes/Disabled.scene', 1],
        ['MissingCamera', 'Scenes/NoCamera.scene', 1]
    ]);
    assert.match(diagnostics[0].message, /independent pass/);
});

test('runtime diagnostics reports LoadScene targets excluded from the build', () => {
    const diagnostics = collectRuntimeDiagnostics([
        { path: 'Assets/Scenes/Main.scene.json', value: { gameObjects: [{ id: 'camera', components: [
            { type: 'Camera' },
            { type: 'UIEventAction', data: { action: 'LoadScene', scenePath: 'Assets/Scenes/Level2.scene.json' } }
        ] }] } },
        { path: 'Assets/Scenes/Menu.scene.json', value: { gameObjects: [{ id: 'camera-2', components: [
            { type: 'Camera' },
            { type: 'UIEventAction', data: { action: 'LoadScene', scenePath: 'Assets/Scenes/Main.scene.json' } }
        ] }] } }
    ]);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].type, 'InvalidSceneReference');
    assert.equal(diagnostics[0].count, 1);
    assert.match(diagnostics[0].message, /not selected in Build Settings/);
});

test('runtime diagnostics distinguishes supported GLB/GLTF models from unsupported model references', () => {
    const diagnostics = collectRuntimeDiagnostics([{
        path: 'Assets/Scenes/Models.scene.json', value: { gameObjects: [
            { id: 'camera', components: [{ type: 'Camera' }] },
            { id: 'hero', sourceAssetType: 'model', sourceAssetPath: 'Assets/Models/Hero.glb', components: [{ type: 'Animator' }] },
            { id: 'gltf', sourceAssetType: 'model', sourceAssetPath: 'Assets/Models/Hero.gltf', components: [{ type: 'Animator' }] },
            { id: 'legacy', sourceAssetType: 'model', sourceAssetPath: 'Assets/Models/Legacy.fbx', components: [{ type: 'Animator' }] },
            { id: 'missing', sourceAssetType: 'model', sourceAssetPath: null, components: [] }
        ] }
    }]);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].type, 'UnsupportedModelFormat');
    assert.equal(diagnostics[0].count, 2);
    assert.match(diagnostics[0].message, /Legacy\.fbx/);
    assert.match(diagnostics[0].message, /missing model path/);
});

test('runtime diagnostics rejects malformed BehaviourScript programs before packaging', () => {
    const diagnostics = collectRuntimeDiagnostics([{
        path: 'Assets/Scenes/Scripted.scene.json', value: { gameObjects: [
            { id: 'camera', components: [{ type: 'Camera' }] },
            { id: 'actor', name: 'Actor', components: [{ type: 'BehaviourScript', data: { program: '{' } }] }
        ] }
    }]);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].type, 'InvalidBehaviourScript');
    assert.match(diagnostics[0].message, /Actor: Invalid JSON/);
});
