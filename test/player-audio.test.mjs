import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPlayerAudioGraph, consumePlayerAudioCommands, createWebAudioPlayback, isPlayerAudioActive } from '../electron/build/player-audio.mjs';

test('player audio graph selects the first active listener and active sources only', () => {
    const scene = { gameObjects: [
        {
            id: 'disabled-root', enabled: false,
            components: [{ type: 'AudioListener' }, { type: 'AudioSource', data: { clipPath: 'Assets/hidden.wav' } }],
            children: [{ id: 'disabled-child', components: [{ type: 'AudioSource', data: { clipPath: 'Assets/also-hidden.wav' } }] }]
        },
        {
            id: 'camera', components: [{ type: 'AudioListener' }], children: [
                { id: 'music', components: [{ type: 'AudioSource', data: { clipPath: 'Assets/music.ogg', spatial: false } }] },
                { id: 'muted', components: [{ type: 'AudioSource', enabled: false, data: { clipPath: 'Assets/muted.wav' } }] }
            ]
        },
        { id: 'second-listener', components: [{ type: 'AudioListener' }] }
    ] };

    const graph = collectPlayerAudioGraph(scene);
    assert.equal(graph.listenerObjectId, 'camera');
    assert.deepEqual(graph.sources.map((source) => source.objectId), ['disabled-root', 'disabled-child', 'music']);
    assert.deepEqual(graph.sources.map((source) => source.active), [false, false, true]);
    assert.equal(graph.sources[2].settings.clipPath, 'Assets/music.ogg');
    assert.equal(graph.sources[2].settings.spatial, false);
});

test('player audio activity follows authored ancestors', () => {
    assert.equal(isPlayerAudioActive(['root', 'source'], [{ id: 'root' }, { id: 'source' }]), true);
    assert.equal(isPlayerAudioActive(['root', 'source'], [{ id: 'root', active: false }, { id: 'source' }]), false);
});

test('Web Audio playback stops on disable and recreates its one-shot source on re-enable', () => {
    const created = [];
    const node = () => ({ connect(next) { return next; }, disconnect() {} });
    const context = {
        destination: node(), resume: async () => {},
        createGain() { return { ...node(), gain: { value: 0 } }; },
        createPanner() { return { ...node(), positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } }; },
        createBufferSource() {
            const source = { ...node(), playbackRate: { value: 1 }, startCount: 0, stopCount: 0,
                start() { this.startCount++; }, stop() { this.stopCount++; } };
            created.push(source);
            return source;
        }
    };
    const playback = createWebAudioPlayback(context, {}, {
        objectId: 'music', activePath: ['root', 'music'], settings: { playOnAwake: true, spatial: true, volume: 0.5 }
    });
    playback.sync(true);
    assert.equal(created.length, 1);
    assert.equal(created[0].startCount, 1);
    created[0].onended();
    playback.sync(true);
    assert.equal(created.length, 1, 'a completed one-shot must not restart every render frame');
    playback.sync(false);
    assert.equal(created[0].stopCount, 0, 'an already completed source does not need a second stop');
    playback.sync(true);
    assert.equal(created.length, 2);
    assert.equal(created[1].startCount, 1);
    playback.sync(false);
    assert.equal(created[1].stopCount, 1);
    playback.sync(true);
    assert.equal(created.length, 3);
});

test('player audio graph allows camera fallback when no listener is authored', () => {
    const graph = collectPlayerAudioGraph({ gameObjects: [{
        id: 'source', components: [{ type: 'AudioSource', data: { clipPath: 'Assets/sfx.wav' } }]
    }] });
    assert.equal(graph.listenerObjectId, null);
    assert.equal(graph.sources.length, 1);
});

test('manual audio commands play and stop a source with playOnAwake disabled', () => {
    const created = [];
    const node = () => ({ connect(next) { return next; }, disconnect() {} });
    const context = {
        destination: node(), resume: async () => {},
        createGain() { return { ...node(), gain: { value: 0 } }; },
        createPanner() { return { ...node(), positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } }; },
        createBufferSource() {
            const source = { ...node(), playbackRate: { value: 1 }, startCount: 0, stopCount: 0,
                start() { this.startCount++; }, stop() { this.stopCount++; } };
            created.push(source);
            return source;
        }
    };
    const playback = createWebAudioPlayback(context, {}, {
        objectId: 'sfx', activePath: ['sfx'], settings: { playOnAwake: false, spatial: false }
    });
    playback.sync(true);
    assert.equal(created.length, 0);
    playback.command('play');
    assert.equal(created.length, 1);
    assert.equal(created[0].startCount, 1);
    playback.command('stop');
    assert.equal(created[0].stopCount, 1);
    playback.sync(true);
    assert.equal(created.length, 1, 'a stopped source must not restart on repeated active frames');
    playback.command('play');
    assert.equal(created.length, 2);
});

test('player consumes each ordered audio command once across repeated runtime states', () => {
    const received = [];
    const playbacks = [{ descriptor: { objectId: 'sfx' }, command: (command) => received.push(command) }];
    const commands = [
        { sequence: 1, objectId: 'sfx', command: 'play' },
        { sequence: 2, objectId: 'missing', command: 'play' },
        { sequence: 3, objectId: 'sfx', command: 'stop' }
    ];
    let sequence = consumePlayerAudioCommands(commands, 0, playbacks);
    assert.equal(sequence, 3);
    assert.deepEqual(received, ['play', 'stop']);
    sequence = consumePlayerAudioCommands(commands, sequence, playbacks);
    assert.equal(sequence, 3);
    assert.deepEqual(received, ['play', 'stop']);
});

test('player retains the latest command until a dynamically spawned audio source is loaded', () => {
    const pending = new Map();
    let sequence = consumePlayerAudioCommands([
        { sequence: 1, objectId: 'spawned-sfx', command: 'play' },
        { sequence: 2, objectId: 'spawned-sfx', command: 'stop' }
    ], 0, [], pending);
    assert.equal(sequence, 2);
    assert.equal(pending.get('spawned-sfx'), 'stop');

    const received = [];
    const playback = {
        descriptor: { objectId: 'spawned-sfx' },
        command: (command) => received.push(command)
    };
    const pendingCommand = pending.get(playback.descriptor.objectId);
    playback.command(pendingCommand);
    pending.delete(playback.descriptor.objectId);
    assert.deepEqual(received, ['stop']);
    assert.equal(pending.has('spawned-sfx'), false);

    sequence = consumePlayerAudioCommands([
        { sequence: 3, objectId: 'spawned-sfx', command: 'play' }
    ], sequence, [playback], pending);
    assert.deepEqual(received, ['stop', 'play']);
    assert.equal(pending.size, 0);
});
