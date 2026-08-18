'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { RuntimeSupervisor } = require('../electron/runtime/runtime-supervisor');
const { LIMITS, validateRuntimeSnapshot } = require('../electron/runtime/snapshot-validator');

function snapshot(overrides = {}) {
    return JSON.stringify({ formatVersion: 1, sceneId: 'security-test', gameObjects: [], ...overrides });
}

test('representative project scene and custom component identifiers remain valid', () => {
    const file = path.join(__dirname, '..', 'samples', 'vertical-slice', 'Assets', 'Scenes', 'Main.scene.json');
    const result = validateRuntimeSnapshot(fs.readFileSync(file, 'utf8'));
    assert.equal(result.metrics.gameObjects, 2);
    assert.equal(result.metrics.components, 3);
});

test('pathological snapshots fail with bounded stable errors', () => {
    let deep = { value: true };
    for (let index = 0; index <= LIMITS.maxDepth; index += 1) deep = { nested: deep };
    const cases = [
        [snapshot({ nested: deep }), 'SNAPSHOT_RESOURCE_LIMIT'],
        [snapshot({ gameObjects: Array.from({ length: LIMITS.maxGameObjects + 1 }, (_, index) => ({ id: `object-${index}` })) }), 'SNAPSHOT_RESOURCE_LIMIT'],
        [snapshot({ gameObjects: [{ id: 'x', components: Array.from({ length: LIMITS.maxComponentsPerObject + 1 }, () => ({ type: 'Camera' })) }] }), 'SNAPSHOT_RESOURCE_LIMIT'],
        [snapshot({ gameObjects: Array.from({ length: 51 }, () => ({ components: Array.from({ length: 1_000 }, () => ({ type: 'Camera' })) })) }), 'SNAPSHOT_RESOURCE_LIMIT'],
        [snapshot({ text: 'x'.repeat(LIMITS.maxStringBytes + 1) }), 'SNAPSHOT_RESOURCE_LIMIT'],
        [snapshot({ gameObjects: [{ components: [{ type: '../NativePlugin' }] }] }), 'INVALID_COMPONENT_TYPE'],
        [snapshot({ gameObjects: [{ sourceAssetPath: '../outside.asset' }] }), 'INVALID_ASSET_REFERENCE'],
        [snapshot({ environment: { skyboxPath: 'C:\\secrets\\sky.hdr' } }), 'INVALID_ASSET_REFERENCE'],
        [snapshot({ gameObjects: {} }), 'INVALID_SNAPSHOT_STRUCTURE']
    ];
    for (const [input, code] of cases) {
        assert.throws(() => validateRuntimeSnapshot(input),
            (error) => error.code === code && error.message.length < 256);
    }
    assert.throws(() => validateRuntimeSnapshot('{"formatVersion":1,"gameObjects":[],"overflow":1e400}'),
        (error) => error.code === 'INVALID_SNAPSHOT_STRUCTURE');
});

test('typed IPC preserves bounded snapshot validation codes', () => {
    const { stableError } = require('../electron/architecture/ipc-router');
    for (const code of ['INVALID_SNAPSHOT_STRUCTURE', 'SNAPSHOT_RESOURCE_LIMIT', 'INVALID_ASSET_REFERENCE', 'INVALID_COMPONENT_TYPE']) {
        assert.deepEqual(stableError(Object.assign(new Error('bounded'), { code })), { code, message: 'bounded' });
    }
});

test('invalid snapshots are rejected before process launch and do not enter restart flow', async () => {
    let launches = 0;
    const supervisor = new RuntimeSupervisor({
        forkProcess: () => {
            launches += 1;
            return new EventEmitter();
        }
    });
    await assert.rejects(supervisor.start(snapshot({ gameObjects: [{ components: [{ type: 'bad/type' }] }] })),
        (error) => error.code === 'INVALID_COMPONENT_TYPE');
    assert.equal(launches, 0);
    assert.equal(supervisor.state, 'idle');
    assert.equal(supervisor.restartCount, 0);
    assert.equal(supervisor.child, null);
});

test('project-relative asset references are accepted and absolute, traversal, URL, and empty segments are denied', () => {
    for (const value of ['Assets/Textures/albedo.png', 'Assets\\Materials\\Player.mat']) {
        assert.doesNotThrow(() => validateRuntimeSnapshot(snapshot({ environment: { skyboxPath: value } })));
    }
    for (const value of ['/etc/passwd', '../escape', 'file:///secret', 'https://example.test/a', 'Assets//bad']) {
        assert.throws(() => validateRuntimeSnapshot(snapshot({ environment: { skyboxPath: value } })),
            (error) => error.code === 'INVALID_ASSET_REFERENCE');
    }
});
