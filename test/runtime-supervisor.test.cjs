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
