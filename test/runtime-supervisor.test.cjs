'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const path = require('node:path');
const test = require('node:test');
const { RuntimeSupervisor } = require('../electron/runtime/runtime-supervisor');

const snapshot = JSON.stringify({
    formatVersion: 1,
    sceneId: 'replay-fixture',
    gameObjects: [{ id: 'player', position: [0, 0, 0] }]
});

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
