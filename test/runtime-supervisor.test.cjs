'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { RuntimeSupervisor } = require('../electron/runtime/runtime-supervisor');

const snapshot = JSON.stringify({
    formatVersion: 1,
    sceneId: 'replay-fixture',
    gameObjects: [{ id: 'player', position: [0, 0, 0] }]
});

const authoredSnapshot = fs.readFileSync(path.join(
    __dirname, '..', 'samples', 'playable-runtime', 'Assets', 'Scenes', 'PlayableSlice.json'
), 'utf8');
const topDownSnapshot = fs.readFileSync(path.join(
    __dirname, '..', 'samples', 'vertical-slice', 'Assets', 'Scenes', 'TopDown.scene.json'
), 'utf8');

function hashReplay(states) {
    return createHash('sha256').update(JSON.stringify(states)).digest('hex');
}

test('100 isolated play runs produce the same replay hash and never mutate editor bytes', async () => {
    const originalBytes = Buffer.from(snapshot);
    const hashes = [];
    for (let run = 0; run < 100; run += 1) {
        const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
        const states = [await supervisor.start(snapshot)];
        for (const deltaTime of [0.016, 0.016, 0.017, 0.016]) {
            states.push(await supervisor.tick(deltaTime));
        }
        hashes.push(hashReplay(states.map(({ state, frame, timeMicros, snapshotHash }) => ({
            state, frame, timeMicros, snapshotHash
        }))));
        await supervisor.shutdown();
    }
    assert.equal(new Set(hashes).size, 1);
    assert.deepEqual(Buffer.from(snapshot), originalBytes);
});

test('malformed and version-mismatched snapshots return stable bounded failures', async () => {
    for (const [input, code] of [
        ['{', 'INVALID_SNAPSHOT'],
        [JSON.stringify({ formatVersion: 2 }), 'RUNTIME_SNAPSHOT_VERSION_MISMATCH']
    ]) {
        const supervisor = new RuntimeSupervisor();
        await assert.rejects(supervisor.start(input), (error) => error.code === code && error.message.length < 256);
        await supervisor.shutdown();
    }
});

test('restart replaces the runtime process and starts from the replacement snapshot', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const first = await supervisor.start(snapshot);
    const firstChild = supervisor.child;
    const firstSessionId = supervisor.sessionId;
    const replacementSnapshot = JSON.stringify({
        formatVersion: 1,
        sceneId: 'replacement-scene',
        gameObjects: [{ id: 'replacement', position: [4, 5, 6] }]
    });

    const restarted = await supervisor.restart(replacementSnapshot);
    assert.equal(restarted.state, 'running');
    assert.notEqual(supervisor.child, firstChild);
    assert.notEqual(supervisor.sessionId, firstSessionId);
    assert.notEqual(restarted.snapshotHash, first.snapshotHash);
    assert.equal(supervisor.snapshot, replacementSnapshot);
    await supervisor.shutdown();
});

test('runtime crash is isolated, preserves snapshot bytes, and consumes at most two restarts', async () => {
    const diagnostics = [];
    const supervisor = new RuntimeSupervisor({
        heartbeatIntervalMs: 60_000,
        restartBackoffMs: 5,
        onDiagnostic: (event) => diagnostics.push(event)
    });
    const originalBytes = Buffer.from(snapshot);
    await supervisor.start(snapshot);
    supervisor.child.kill();
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(supervisor.state, 'running');
    assert.deepEqual(Buffer.from(snapshot), originalBytes);
    supervisor.child.kill();
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(supervisor.state, 'running');
    supervisor.child.kill();
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(supervisor.state, 'failed');
    assert.equal(diagnostics.length, 3);
    await supervisor.shutdown();
    assert.equal(supervisor.child, null);
    assert.equal(supervisor.pending.size, 0);
    assert.equal(supervisor.heartbeatTimer, null);
});

test('shutdown is idempotent and releases process, timers, and pending requests', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    await supervisor.start(snapshot);
    await Promise.all([supervisor.shutdown(), supervisor.shutdown()]);
    assert.equal(supervisor.state, 'idle');
    assert.equal(supervisor.child, null);
    assert.equal(supervisor.pending.size, 0);
    assert.equal(supervisor.heartbeatTimer, null);
});

test('authored Update and fixed-step components execute in the child runtime and return observable transforms', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const originalBytes = Buffer.from(authoredSnapshot);
    const started = await supervisor.start(authoredSnapshot);
    assert.deepEqual(started.transforms[0], {
        id: 'moving-cube', position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1]
    });

    const advanced = await supervisor.tick(0.04);
    assert.equal(advanced.updateCount, 1);
    assert.equal(advanced.fixedUpdateCount, 2);
    assert.equal(advanced.transforms[0].rotation[1], 0.16);
    assert.ok(advanced.transforms[0].position[1] < 2, 'fixed-step gravity must visibly move the authored object');
    assert.deepEqual(Buffer.from(authoredSnapshot), originalBytes, 'runtime must not mutate editor snapshot bytes');
    await supervisor.shutdown();
});

test('generic RigidBody resolves against authored box floors', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const rigidBodySnapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            {
                id: 'body',
                transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
                components: [
                    { type: 'RigidBody', data: { mass: 1, useGravity: true, velocity: [0, 0, 0] } },
                    { type: 'BoxCollider', data: { size: [1, 1, 1], isTrigger: false } }
                ]
            },
            {
                id: 'floor',
                transform: { position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [4, 1, 4] },
                components: [{ type: 'BoxCollider', data: { size: [1, 1, 1], isTrigger: false } }]
            }
        ]
    });
    await supervisor.start(rigidBodySnapshot);
    for (let index = 0; index < 10; index += 1) await supervisor.tick(0.1);
    const body = (await supervisor.tick(0.02)).transforms.find(({ id }) => id === 'body');
    assert.equal(body.position[1], 0.5);
    await supervisor.shutdown();
});

test('generic RigidBody resolves against authored sphere colliders', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const snapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            { id: 'body', transform: { position: [0, 2, 0], scale: [1, 1, 1] }, components: [
                { type: 'RigidBody', data: { mass: 1, useGravity: true, velocity: [0, 0, 0] } },
                { type: 'SphereCollider', data: { radius: 0.5, isTrigger: false } }
            ] },
            { id: 'floor', transform: { position: [0, -0.5, 0], scale: [1, 1, 1] }, components: [
                { type: 'SphereCollider', data: { radius: 1, isTrigger: false } }
            ] }
        ]
    });
    try {
        await supervisor.start(snapshot);
        let state;
        for (let index = 0; index < 120; index += 1) state = await supervisor.tick(0.02);
        assert.ok(state.transforms.find(({ id }) => id === 'body').position[1] > 0.45);
    } finally {
        await supervisor.shutdown();
    }
});

test('generic RigidBody resolves against authored capsule colliders', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const capsuleSnapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            { id: 'body', transform: { position: [0, 3, 0], scale: [1, 1, 1] }, components: [
                { type: 'RigidBody', data: { mass: 1, useGravity: true, velocity: [0, 0, 0] } },
                { type: 'BoxCollider', data: { size: [1, 1, 1] } }
            ] },
            { id: 'capsule-platform', transform: { position: [0, -0.5, 0], scale: [2, 1, 2] }, components: [
                { type: 'CapsuleCollider', data: { radius: 0.5, height: 2, center: [0, 0.25, 0] } }
            ] }
        ]
    });
    try {
        await supervisor.start(capsuleSnapshot);
        let state;
        for (let index = 0; index < 140; index += 1) state = await supervisor.tick(0.02);
        assert.equal(state.transforms.find(({ id }) => id === 'body').position[1], 1.25);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised RigidBody applies authored drag and frozen position axes', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const constrainedSnapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [{
            id: 'body', transform: { position: [1, 2, 3], scale: [1, 1, 1] }, components: [{
                type: 'RigidBody', data: {
                    mass: 1, useGravity: false, velocity: [4, 3, 2], drag: 1,
                    freezePositionX: true
                }
            }]
        }]
    });
    try {
        await supervisor.start(constrainedSnapshot);
        const first = await supervisor.tick(0.02);
        const second = await supervisor.tick(0.02);
        assert.deepEqual(first.transforms[0].position, [1, 2.06, 3.04]);
        assert.deepEqual(second.transforms[0].position.map(value => Number(value.toFixed(6))), [1, 2.1188, 3.0792]);
    } finally {
        await supervisor.shutdown();
    }
});

test('authored box colliders use world-space size and center for contacts', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const scaledSnapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            {
                id: 'body',
                transform: { position: [0.9, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
                components: [
                    { type: 'RigidBody', data: { mass: 1, useGravity: true, velocity: [0, 0, 0] } },
                    { type: 'BoxCollider', data: { size: [1, 1, 1], isTrigger: false } }
                ]
            },
            {
                id: 'scaled-floor',
                transform: { position: [2, -0.5, 0], rotation: [0, 0, 0], scale: [2, 1, 2] },
                components: [{ type: 'BoxCollider', data: { size: [2, 1, 2], center: [-0.1, 0, 0], isTrigger: false } }]
            }
        ]
    });
    await supervisor.start(scaledSnapshot);
    for (let index = 0; index < 10; index += 1) await supervisor.tick(0.1);
    const body = (await supervisor.tick(0.02)).transforms.find(({ id }) => id === 'body');
    assert.equal(body.position[1], 0.5, 'scaled floor geometry must support an overlapping body');
    await supervisor.shutdown();
});

test('runtime collision matrix filters authored body contacts', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const matrix = new Array(32).fill(0xFFFFFFFF);
    matrix[1] &= ~(1 << 0);
    matrix[0] &= ~(1 << 1);
    const filteredSnapshot = JSON.stringify({
        formatVersion: 1,
        layerCollisionMatrix: matrix,
        gameObjects: [
            { id: 'body', layer: 1, transform: { position: [0, 2, 0], scale: [1, 1, 1] }, components: [
                { type: 'RigidBody', data: { mass: 1, useGravity: true } },
                { type: 'BoxCollider', data: { size: [1, 1, 1] } }
            ] },
            { id: 'floor', layer: 0, transform: { position: [0, -0.5, 0], scale: [4, 1, 4] }, components: [
                { type: 'BoxCollider', data: { size: [1, 1, 1] } }
            ] }
        ]
    });
    await supervisor.start(filteredSnapshot);
    for (let index = 0; index < 10; index += 1) await supervisor.tick(0.1);
    const body = (await supervisor.tick(0.02)).transforms.find(({ id }) => id === 'body');
    assert.ok(body.position[1] < 0.5, 'filtered layers must not create a supporting contact');
    await supervisor.shutdown();
});

test('pause freezes authored state and step advances exactly one frame while remaining paused', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    await supervisor.start(authoredSnapshot);
    const paused = await supervisor.pause();
    assert.equal(paused.state, 'paused');
    await assert.rejects(supervisor.tick(0.02), (error) => error.code === 'INVALID_TRANSITION');
    const stepped = await supervisor.step(0.02);
    assert.equal(stepped.state, 'paused');
    assert.equal(stepped.frame, 1);
    assert.equal(stepped.fixedUpdateCount, 1);
    assert.equal(stepped.transforms[0].rotation[1], 0.08);
    await supervisor.shutdown();
});

test('PlayerController consumes supervised input and resolves against authored floor', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const playerSnapshot = JSON.stringify({
        formatVersion: 1,
        sceneId: 'input-fixture',
        gameObjects: [
            { id: 'player', transform: { position: [0, 2, 0], scale: [1, 1, 1] }, components: [
                { type: 'PlayerController', data: { moveSpeed: 5, jumpForce: 6, fixedStep: 0.02 } },
                { type: 'CapsuleCollider', data: { radius: 0.5, height: 2 } }
            ] },
            { id: 'floor', transform: { position: [0, -0.5, 0], scale: [10, 1, 10] }, components: [
                { type: 'BoxCollider', data: { size: [10, 1, 10] } }
            ] }
        ]
    });
    try {
        await supervisor.start(playerSnapshot);
        const moved = await supervisor.tick(0.02, { Horizontal: 1 });
        assert.ok(moved.transforms.find(({ id }) => id === 'player').position[0] > 0);
        let grounded;
        for (let index = 0; index < 60; index += 1) grounded = await supervisor.tick(0.02, {});
        assert.equal(grounded.transforms.find(({ id }) => id === 'player').position[1], 1);
    } finally {
        await supervisor.shutdown();
    }
});

test('PlayerController applies mouse-look input to rotation-relative movement', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const snapshot = JSON.stringify({
        formatVersion: 1, sceneId: 'mouse-look-fixture', gameObjects: [
            { id: 'player', name: 'Player', transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [
                { type: 'PlayerController', data: { moveSpeed: 5, lookSensitivity: 0.1, gravity: 0 } },
                { type: 'CapsuleCollider', data: { height: 2, radius: 0.5 } }
            ] }
        ]
    });
    try {
        await supervisor.start(snapshot);
        const frame = await supervisor.tick(0.02, { LookX: 1, Vertical: 1 });
        const player = frame.transforms.find(({ id }) => id === 'player');
        assert.ok(player.rotation[1] < 0);
        assert.ok(player.position[0] < 0, 'forward movement must follow the rotated player heading');
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised gameplay resolves authored collect and finish triggers with score', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    try {
        await supervisor.start(topDownSnapshot);
        let state;
        for (let index = 0; index < 35; index += 1) state = await supervisor.tick(0.02, { Horizontal: 1 });
        assert.equal(state.gameplay.collectedCount, 1);
        assert.equal(state.gameplay.score, 250);
        for (let index = 0; index < 35; index += 1) state = await supervisor.tick(0.02, { Horizontal: 1 });
        assert.equal(state.gameplay.status, 'finished');
    } finally {
        await supervisor.shutdown();
    }
});

test('follow GameplayCamera tracks the supervised player and returns camera state', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const snapshot = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            { id: 'player', transform: { position: [0, 1, 0], scale: [1, 1, 1] }, components: [{ type: 'PlayerController', data: { moveSpeed: 5, gravity: 0 } }] },
            { id: 'camera', transform: { position: [0, 6, 8], scale: [1, 1, 1] }, components: [{ type: 'GameplayCamera', data: { mode: 'follow', offset: [0, 6, 8] } }] }
        ]
    });
    try {
        await supervisor.start(snapshot);
        const frame = await supervisor.tick(0.02, { Horizontal: 1 });
        assert.equal(frame.gameplay.camera.mode, 'follow');
        assert.equal(frame.gameplay.camera.position[0], frame.gameplay.player.position[0]);
        assert.equal(frame.transforms.find(({ id }) => id === 'camera').position[0], frame.gameplay.player.position[0]);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised UI Restart event recreates the authored runtime world', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    try {
        await supervisor.start(topDownSnapshot);
        await supervisor.tick(0.02, { Horizontal: 1 });
        const restarted = await supervisor.uiEvent('Restart');
        assert.equal(restarted.lastUiEvent, 'Restart');
        assert.deepEqual(Array.from(restarted.gameplay.player.position), [0, 0.5, 0]);
        assert.equal(restarted.gameplay.collectedCount, 0);
        assert.equal(restarted.gameplay.status, 'playing');
    } finally {
        await supervisor.shutdown();
    }
});

test('standalone runtime applies cross-object UIEventAction transforms', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    const scene = JSON.stringify({
        formatVersion: 1,
        gameObjects: [
            { id: 'button', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [{ type: 'UIEventAction', data: { eventName: 'Open', action: 'SetRotation', rotation: [0, 1, 0], targetObjectId: 'door' } }] },
            { id: 'door', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [] }
        ]
    });
    try {
        await supervisor.start(scene);
        const result = await supervisor.uiEvent('Open');
        assert.deepEqual(Array.from(result.transforms.find(({ id }) => id === 'door').rotation), [0, 1, 0]);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised LoadScene action remains host-owned without toggling objects', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    try {
        await supervisor.start(JSON.stringify({
            formatVersion: 1,
            gameObjects: [{
                id: 'loader', enabled: true, transform: {}, components: [{
                    type: 'UIEventAction', data: {
                        eventName: 'NextLevel', action: 'LoadScene', active: false,
                        scenePath: 'Assets/Scenes/Level2.scene.json'
                    }
                }]
            }]
        }));
        const state = await supervisor.uiEvent('NextLevel');
        assert.equal(state.lastUiEvent, 'NextLevel');
        assert.equal(state.transforms[0].active, undefined);
    } finally {
        await supervisor.shutdown();
    }
});

test('supervised AutoRotate matches the authored speed and axis contract', async () => {
    const supervisor = new RuntimeSupervisor({ heartbeatIntervalMs: 60_000 });
    try {
        await supervisor.start(JSON.stringify({
            formatVersion: 1,
            gameObjects: [{ id: 'rotor', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: [{ type: 'AutoRotate', data: { speed: 90, axis: [0, 0, 1] } }] }]
        }));
        const state = await supervisor.tick(0.1);
        assert.ok(Math.abs(state.transforms.find(({ id }) => id === 'rotor').rotation[2] - Math.PI / 20) < 1e-6);
    } finally {
        await supervisor.shutdown();
    }
});
