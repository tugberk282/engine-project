'use strict';

const { createHash } = require('node:crypto');

const PROTOCOL_VERSION = 1;
let sessionId = '';
let state = 'idle';
let frame = 0;
let timeMicros = 0;
let snapshot = null;

function reply(requestId, result) {
    if (process.send) process.send({ protocolVersion: PROTOCOL_VERSION, requestId, sessionId, ...result });
}

function failure(requestId, code, message) {
    reply(requestId, { ok: false, error: { code, message } });
}

process.on('message', (message) => {
    if (!message || message.protocolVersion !== PROTOCOL_VERSION) return;
    const { requestId, command, payload = {}, sessionId: requestedSession } = message;
    if (command === 'ping') {
        reply(requestId, { ok: true, value: { state, frame, timeMicros } });
        return;
    }
    if (command === 'start') {
        sessionId = requestedSession;
        try {
            const parsed = JSON.parse(payload.snapshot);
            if (!parsed || typeof parsed !== 'object' || parsed.formatVersion !== 1) {
                return failure(requestId, 'RUNTIME_SNAPSHOT_VERSION_MISMATCH', 'The runtime snapshot version is not supported.');
            }
            snapshot = parsed;
            state = 'running';
            frame = 0;
            timeMicros = 0;
            const snapshotHash = createHash('sha256').update(payload.snapshot).digest('hex');
            reply(requestId, { ok: true, value: { state, frame, timeMicros, snapshotHash } });
        } catch {
            failure(requestId, 'INVALID_SNAPSHOT', 'The persisted scene snapshot could not be loaded.');
        }
        return;
    }
    if (requestedSession !== sessionId || state === 'idle' || state === 'failed') {
        return failure(requestId, 'STALE_RUNTIME_SESSION', 'The runtime session is no longer active.');
    }
    if (command === 'pause' && state === 'running') state = 'paused';
    else if (command === 'resume' && state === 'paused') state = 'running';
    else if (command === 'tick' && state === 'running') {
        const deltaTime = Number(payload.deltaTime);
        if (!Number.isFinite(deltaTime) || deltaTime < 0 || deltaTime > 0.1) {
            return failure(requestId, 'INVALID_DELTA', 'The runtime frame delta is outside the supported range.');
        }
        frame += 1;
        timeMicros += Math.round(deltaTime * 1_000_000);
    } else if (command === 'stop') {
        snapshot = null;
        state = 'idle';
    } else {
        return failure(requestId, 'INVALID_TRANSITION', 'The runtime lifecycle transition is invalid.');
    }
    reply(requestId, { ok: true, value: { state, frame, timeMicros } });
    if (command === 'stop') sessionId = '';
});

process.on('disconnect', () => process.exit(0));
