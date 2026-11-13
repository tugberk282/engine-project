import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPlayerParticleSystems, consumePlayerParticleCommands, PlayerParticleSimulation } from '../electron/build/player-particles.mjs';

test('player particle collector preserves authored simulation settings and activity', () => {
    const systems = collectPlayerParticleSystems({ gameObjects: [{
        id: 'fx-root', enabled: true, components: [], children: [{
            id: 'sparks', components: [{ type: 'ParticleSystem', data: {
                emissionRate: 20, duration: 0.5, startLifetime: 1, startSize: 0.2,
                startSpeed: 2, gravity: [0, -2, 0], startColor: [1, 0, 0], endColor: [0, 0, 1],
                texturePath: 'Assets\\FX\\spark.png', maxParticles: 12, loop: false, playOnAwake: true
            } }]
        }]
    }] });
    assert.deepEqual(systems, [{
        objectId: 'sparks', active: true, activePath: ['fx-root', 'sparks'], emissionRate: 20,
        duration: 0.5, startLifetime: 1, startSize: 0.2, startSpeed: 2, gravity: [0, -2, 0],
        startColor: [1, 0, 0], endColor: [0, 0, 1], texturePath: 'Assets/FX/spark.png',
        maxParticles: 12, loop: false, playOnAwake: true
    }]);
});

test('non-looping player particles emit deterministically and stop after duration plus lifetime', () => {
    const settings = {
        objectId: 'sparks', emissionRate: 10, duration: 0.2, startLifetime: 0.3,
        startSpeed: 1, gravity: [0, -1, 0], maxParticles: 10, loop: false, playOnAwake: true
    };
    const first = new PlayerParticleSimulation(settings);
    const second = new PlayerParticleSimulation(settings);
    first.update(0.1); second.update(0.1);
    assert.equal(first.particles.length, 1);
    assert.deepEqual(first.particles, second.particles);
    for (let index = 0; index < 10; index += 1) first.update(0.1);
    assert.equal(first.particles.length, 0);
    assert.equal(first.playing, false);
});

test('inactive particle hierarchy freezes emission and lifetime', () => {
    const simulation = new PlayerParticleSimulation({
        objectId: 'paused', emissionRate: 10, duration: 1, startLifetime: 1,
        startSpeed: 0, gravity: [0, 0, 0], maxParticles: 10, loop: true, playOnAwake: true
    });
    simulation.update(0.1, false);
    assert.equal(simulation.elapsed, 0);
    assert.equal(simulation.particles.length, 0);
    simulation.update(0.1, true);
    assert.equal(simulation.particles.length, 1);
});

test('manual particle commands start, stop, clear, and consume once', () => {
    const simulation = new PlayerParticleSimulation({
        objectId: 'fx', emissionRate: 10, duration: 1, startLifetime: 1,
        startSpeed: 0, gravity: [0, 0, 0], maxParticles: 10, loop: true, playOnAwake: false
    });
    simulation.update(0.1, true);
    assert.equal(simulation.particles.length, 0);
    const emitter = {
        descriptor: { objectId: 'fx' },
        command(command) { if (command === 'play') simulation.play(); else simulation.stop(); }
    };
    const commands = [{ sequence: 1, objectId: 'fx', command: 'play' }];
    let sequence = consumePlayerParticleCommands(commands, 0, [emitter]);
    simulation.update(0.1, true);
    assert.equal(simulation.particles.length, 1);
    sequence = consumePlayerParticleCommands(commands, sequence, [emitter]);
    assert.equal(sequence, 1);
    sequence = consumePlayerParticleCommands([{ sequence: 2, objectId: 'fx', command: 'stop' }], sequence, [emitter]);
    assert.equal(sequence, 2);
    assert.equal(simulation.playing, false);
    assert.equal(simulation.particles.length, 0);
    assert.equal(simulation.elapsed, 0);
});

test('particle collector accepts a dynamically materialized prefab subtree', () => {
    const systems = collectPlayerParticleSystems({ gameObjects: [{
        id: 'runtime-prefab-1', components: [], children: [{
            id: 'runtime-prefab-2', enabled: true,
            components: [{ type: 'ParticleSystem', data: { emissionRate: 6, playOnAwake: false } }],
            children: []
        }]
    }] });
    assert.equal(systems.length, 1);
    assert.equal(systems[0].objectId, 'runtime-prefab-2');
    assert.deepEqual(systems[0].activePath, ['runtime-prefab-1', 'runtime-prefab-2']);
    assert.equal(systems[0].emissionRate, 6);
    assert.equal(systems[0].playOnAwake, false);
});
