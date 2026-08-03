const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createRuntime() {
    const events = [];
    const self = { postMessage: (event) => events.push(event), onmessage: null };
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'engine', 'runtime.worker.js'), 'utf8');
    vm.runInNewContext(source, { self, JSON, Number });
    return {
        events,
        send(command, payload = {}, sessionId = 'session-1') {
            self.onmessage({ data: { protocolVersion: 1, sessionId, command, payload } });
            return events.at(-1);
        }
    };
}

test('start, pause, resume, tick, and stop have deterministic states', () => {
    const runtime = createRuntime();
    assert.equal(runtime.send('start', { snapshot: JSON.stringify({ formatVersion: 1, gameObjects: [] }) }).state, 'running');
    assert.equal(runtime.send('pause').state, 'paused');
    assert.equal(runtime.send('resume').state, 'running');
    assert.equal(runtime.send('tick', { deltaTime: 0.016 }).frame, 1);
    assert.equal(runtime.send('stop').state, 'idle');
});

test('restart replaces disposable runtime state', () => {
    const runtime = createRuntime();
    runtime.send('start', { snapshot: JSON.stringify({ formatVersion: 1 }) });
    assert.equal(runtime.send('tick', { deltaTime: 0.02 }).frame, 1);
    assert.equal(runtime.send('start', { snapshot: JSON.stringify({ formatVersion: 1 }) }, 'session-2').frame, 0);
});

test('invalid snapshots and frame deltas become bounded error envelopes', () => {
    const badSnapshot = createRuntime().send('start', { snapshot: '{' });
    assert.equal(badSnapshot.error.code, 'INVALID_SNAPSHOT');
    assert.equal(badSnapshot.error.message, 'The persisted scene snapshot could not be loaded.');

    const runtime = createRuntime();
    runtime.send('start', { snapshot: '{}' });
    assert.equal(runtime.send('tick', { deltaTime: 2 }).error.code, 'INVALID_DELTA');
});

test('heartbeat reports liveness without advancing deterministic simulation state', () => {
    const runtime = createRuntime();
    runtime.send('start', { snapshot: '{}' });
    runtime.send('tick', { deltaTime: 0.02 });
    const heartbeat = runtime.send('ping');
    assert.equal(heartbeat.type, 'heartbeat');
    assert.equal(heartbeat.state, 'running');
    assert.equal(heartbeat.frame, 1);
    assert.equal(heartbeat.time, 0.02);
});

test('invalid lifecycle transitions fail with a stable bounded error', () => {
    const runtime = createRuntime();
    runtime.send('start', { snapshot: '{}' });
    const invalidResume = runtime.send('resume');
    assert.equal(invalidResume.type, 'error');
    assert.equal(invalidResume.error.code, 'INVALID_TRANSITION');
    assert.equal(invalidResume.error.message, 'The runtime lifecycle transition is invalid.');
});

test('stale session commands cannot mutate a replacement session', () => {
    const runtime = createRuntime();
    runtime.send('start', { snapshot: '{}' }, 'session-1');
    runtime.send('stop', {}, 'session-1');
    runtime.send('start', { snapshot: '{}' }, 'session-2');
    const before = runtime.events.length;
    runtime.send('tick', { deltaTime: 0.02 }, 'session-1');
    assert.equal(runtime.events.length, before);
    assert.equal(runtime.send('tick', { deltaTime: 0.02 }, 'session-2').frame, 1);
});
