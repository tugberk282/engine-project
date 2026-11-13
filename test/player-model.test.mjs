import test from 'node:test';
import assert from 'node:assert/strict';
import {
    bindPlayerModelHierarchy,
    collectPlayerModelResources,
    collectPlayerModels,
    consumePlayerAnimationCommands,
    createPlayerAnimationController,
    resolvePlayerModelResource,
    selectPlayerAnimationClip,
    updatePlayerAnimationControllers
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

test('player model collector preserves runtime prefab clone IDs and active hierarchy', () => {
    const scene = { gameObjects: [{
        id: 'runtime-prefab-4-1', enabled: false, components: [], children: [{
            id: 'runtime-prefab-4-2', name: 'Runtime Model', enabled: true,
            sourceAssetType: 'model', sourceAssetPath: 'Assets/Models/Runtime.glb',
            components: [{ type: 'Animator', data: { currentAnimation: 'Idle', playOnAwake: true } }],
            children: [{ id: 'runtime-prefab-4-3', name: 'MeshNode', components: [], children: [] }]
        }]
    }] };
    const [descriptor] = collectPlayerModels(scene);
    assert.equal(descriptor.objectId, 'runtime-prefab-4-2');
    assert.equal(descriptor.path, 'Assets/Models/Runtime.glb');
    assert.equal(descriptor.active, false);
    assert.deepEqual(descriptor.activePath, ['runtime-prefab-4-1', 'runtime-prefab-4-2']);
    assert.equal(descriptor.nodes[0].objectId, 'runtime-prefab-4-3');
    assert.equal(descriptor.animation.clip, 'Idle');
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

test('player animation controller executes sequenced play and stop commands once', () => {
    const actions = new Map();
    class AnimationMixer {
        clipAction(clip) {
            const action = {
                clip, played: 0, stopped: 0,
                setLoop(mode, repetitions) { this.loop = [mode, repetitions]; },
                play() { this.played += 1; },
                stop() { this.stopped += 1; }
            };
            actions.set(clip.name, action);
            return action;
        }
    }
    const THREE = { AnimationMixer, LoopRepeat: 'repeat', LoopOnce: 'once' };
    const descriptor = { objectId: 'hero', animation: { clip: 'Idle', speed: 1.5, loop: false } };
    const controller = createPlayerAnimationController(THREE, descriptor, {
        scene: {}, animations: [{ name: 'Idle' }, { name: 'Run' }]
    });
    let sequence = consumePlayerAnimationCommands([
        { sequence: 1, objectId: 'hero', command: 'play', clip: 'Run' }
    ], 0, [controller]);
    assert.equal(sequence, 1);
    assert.equal(actions.get('Run').played, 1);
    assert.equal(actions.get('Run').timeScale, 1.5);
    assert.equal(actions.get('Run').clampWhenFinished, true);
    assert.deepEqual(actions.get('Run').loop, ['once', Infinity]);
    sequence = consumePlayerAnimationCommands([
        { sequence: 1, objectId: 'hero', command: 'play', clip: 'Idle' },
        { sequence: 2, objectId: 'hero', command: 'stop' }
    ], sequence, [controller]);
    assert.equal(sequence, 2);
    assert.equal(actions.has('Idle'), false, 'an already consumed command must not replay');
    assert.equal(actions.get('Run').stopped, 1);
});

test('player retains the latest animation command until a spawned model controller loads', () => {
    const pending = new Map();
    let sequence = consumePlayerAnimationCommands([
        { sequence: 1, objectId: 'spawned-model', command: 'play', clip: 'Run' },
        { sequence: 2, objectId: 'spawned-model', command: 'stop' },
        { sequence: 3, objectId: 'spawned-model', command: 'play', clip: 'Idle' }
    ], 0, [], pending);
    assert.equal(sequence, 3);
    assert.deepEqual(pending.get('spawned-model'), { command: 'play', clip: 'Idle' });

    const received = [];
    const controller = {
        descriptor: { objectId: 'spawned-model' },
        play: (clip) => received.push(['play', clip]),
        stop: () => received.push(['stop'])
    };
    const pendingCommand = pending.get(controller.descriptor.objectId);
    if (pendingCommand.command === 'play') controller.play(pendingCommand.clip);
    else controller.stop();
    pending.delete(controller.descriptor.objectId);
    assert.deepEqual(received, [['play', 'Idle']]);
    assert.equal(pending.size, 0);

    sequence = consumePlayerAnimationCommands([
        { sequence: 4, objectId: 'spawned-model', command: 'stop' }
    ], sequence, [controller], pending);
    assert.equal(sequence, 4);
    assert.deepEqual(received, [['play', 'Idle'], ['stop']]);
    assert.equal(pending.size, 0);
});

test('player animation mixers freeze while their authored hierarchy is inactive', () => {
    const updates = [];
    const controllers = [
        { descriptor: { objectId: 'active' }, mixer: { update: (delta) => updates.push(['active', delta]) } },
        { descriptor: { objectId: 'inactive' }, mixer: { update: (delta) => updates.push(['inactive', delta]) } }
    ];
    updatePlayerAnimationControllers(controllers, 0.25, (descriptor) => descriptor.objectId === 'active');
    updatePlayerAnimationControllers(controllers, 0, () => true);
    assert.deepEqual(updates, [['active', 0.25]]);
});
