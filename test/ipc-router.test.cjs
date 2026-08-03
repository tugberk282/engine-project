'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createVersionedHandler } = require('../electron/architecture/ipc-router');

function request(requestId = 'request-1') {
    return {
        protocolVersion: 1,
        requestId,
        command: 'telemetry.record',
        payload: { name: 'test', fields: {} }
    };
}

function sender(id = 7) {
    const listeners = {};
    return {
        id,
        destroyed: false,
        isDestroyed() { return this.destroyed; },
        once(name, callback) { listeners[name] = callback; },
        destroy() {
            this.destroyed = true;
            listeners.destroyed?.();
        }
    };
}

test('router rejects forged senders with a stable response and no native stack', async () => {
    const handler = createVersionedHandler({
        authenticate() {
            throw Object.assign(new Error('not the editor'), { code: 'UNTRUSTED_SENDER' });
        },
        execute: async () => assert.fail('must not execute')
    });
    const response = await handler({ sender: sender() }, request());
    assert.deepEqual(response.error, { code: 'UNTRUSTED_SENDER', message: 'not the editor' });
    assert.equal('stack' in response.error, false);
});

test('router rejects duplicate request IDs per renderer', async () => {
    const renderer = sender();
    const handler = createVersionedHandler({
        authenticate() {},
        execute: async () => true
    });
    assert.equal((await handler({ sender: renderer }, request())).ok, true);
    const duplicate = await handler({ sender: renderer }, request());
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.error.code, 'DUPLICATE_REQUEST');
});

test('router releases request state at renderer teardown', async () => {
    const first = sender(9);
    const handler = createVersionedHandler({
        authenticate() {},
        execute: async () => true
    });
    await handler({ sender: first }, request());
    first.destroy();
    const replacement = sender(9);
    assert.equal((await handler({ sender: replacement }, request())).ok, true);
});

test('router converts handler failures and renderer teardown to stable errors', async () => {
    const renderer = sender();
    const failureHandler = createVersionedHandler({
        authenticate() {},
        execute: async () => { throw new Error('native secret'); }
    });
    const failure = await failureHandler({ sender: renderer }, request('failure'));
    assert.deepEqual(failure.error, { code: 'REQUEST_FAILED', message: 'Request failed' });

    const tornDown = sender(10);
    const teardownHandler = createVersionedHandler({
        authenticate() {},
        execute: async () => {
            tornDown.destroy();
            return true;
        }
    });
    const response = await teardownHandler({ sender: tornDown }, request('teardown'));
    assert.equal(response.error.code, 'RENDERER_GONE');
});
