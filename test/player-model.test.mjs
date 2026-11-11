import test from 'node:test';
import assert from 'node:assert/strict';
import {
    bindPlayerModelHierarchy,
    collectPlayerModelResources,
    collectPlayerModels,
    resolvePlayerModelResource,
    selectPlayerAnimationClip
} from '../electron/build/player-model.mjs';

test('player model collector preserves GLB/GLTF source, activity, and Animator playback', () => {
    const scene = { gameObjects: [{
        id: 'character', enabled: true, sourceAssetType: 'model', sourceAssetPath: 'Assets\\Models\\hero.glb',
        components: [{ type: 'Animator', data: {
            currentAnimation: 'Run', speed: 1.5, loop: false, playOnAwake: true
        } }],
        children: [{
            id: 'nested', name: 'Body', sourceAssetType: 'model', sourceAssetPath: 'Assets/Models/prop.gltf', components: [],
            children: [{ id: 'hand', name: 'Hand', components: [] }]
        }]
    }] };
    assert.deepEqual(collectPlayerModels(scene), [{
        objectId: 'character', path: 'Assets/Models/hero.glb', active: true,
        activePath: ['character'],
        nodes: [{ objectId: 'nested', name: 'Body', transform: null, children: [{ objectId: 'hand', name: 'Hand', transform: null, children: [] }] }],
        animation: { clip: 'Run', speed: 1.5, loop: false, playOnAwake: true }
    }, {
        objectId: 'nested', path: 'Assets/Models/prop.gltf', active: true,
        activePath: ['character', 'nested'],
        nodes: [{ objectId: 'hand', name: 'Hand', transform: null, children: [] }],
        animation: null
    }]);
});

test('player model collector includes authored GLTF roots', () => {
    const scene = { gameObjects: [{
        id: 'prop', sourceAssetType: 'model', sourceAssetPath: 'Assets/Models/Props/Crate.gltf',
        components: [], children: []
    }] };
    assert.equal(collectPlayerModels(scene)[0].path, 'Assets/Models/Props/Crate.gltf');
});

test('GLTF dependencies resolve inside Assets and reject unsafe resources', () => {
    const resources = collectPlayerModelResources('Assets/Models/Hero/Hero.gltf', {
        buffers: [{ uri: 'mesh.bin?cache=1' }],
        images: [{ uri: '../../Textures/Hero%20Base.png' }, { uri: 'data:image/png;base64,AA==' }]
    });
    assert.deepEqual([...resources], [
        ['mesh.bin?cache=1', 'Assets/Models/Hero/mesh.bin'],
        ['../../Textures/Hero%20Base.png', 'Assets/Textures/Hero Base.png']
    ]);
    assert.throws(() => resolvePlayerModelResource('Assets/Hero.gltf', '../../secret.bin'), /escapes Assets/);
    assert.throws(() => resolvePlayerModelResource('Assets/Hero.gltf', 'https://example.com/mesh.bin'), /project-local/);
    assert.throws(() => resolvePlayerModelResource('Assets/Hero.gltf', '..%5C..%5Csecret.bin'), /escapes Assets/);
    assert.throws(() => resolvePlayerModelResource('Assets/Hero.gltf', 'shader.js'), /not an allowed/);
});

test('player model hierarchy binds authored object IDs by GLTF node name', () => {
    const hand = { name: 'Hand', children: [] };
    const body = { name: 'Body', children: [hand] };
    const root = { name: 'Scene', children: [{ name: 'Unrelated', children: [] }, body] };
    const bindings = new Map();
    bindPlayerModelHierarchy([
        { objectId: 'body-id', name: 'Body', children: [{ objectId: 'hand-id', name: 'Hand', children: [] }] }
    ], root, (id, object) => bindings.set(id, object));
    assert.equal(bindings.get('body-id'), body);
    assert.equal(bindings.get('hand-id'), hand);
});

test('player animation selection uses the authored clip with deterministic fallback', () => {
    const clips = [{ name: 'Idle' }, { name: 'Run' }];
    assert.equal(selectPlayerAnimationClip(clips, 'Run'), clips[1]);
    assert.equal(selectPlayerAnimationClip(clips, 'Missing'), clips[0]);
    assert.equal(selectPlayerAnimationClip([], 'Run'), null);
});
