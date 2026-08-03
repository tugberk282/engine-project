const PROTOCOL_VERSION = 1;
let sessionId = '';
let state = 'idle';
let frame = 0;
let time = 0;
let snapshot = null;

function emitState() {
    self.postMessage({ type: 'state', sessionId, state, frame, time });
}

function fail(code, message) {
    state = 'failed';
    self.postMessage({ type: 'error', sessionId, error: { code, message } });
}

self.onmessage = (event) => {
    const envelope = event.data;
    if (!envelope || envelope.protocolVersion !== PROTOCOL_VERSION || typeof envelope.command !== 'string'
        || typeof envelope.sessionId !== 'string' || envelope.sessionId.length === 0) {
        fail('INVALID_ENVELOPE', 'The runtime command envelope is invalid.');
        return;
    }

    if (envelope.command === 'start') {
        sessionId = envelope.sessionId;
        frame = 0;
        time = 0;
        try {
            snapshot = JSON.parse(envelope.payload?.snapshot);
            if (!snapshot || typeof snapshot !== 'object') throw new Error('invalid snapshot');
            state = 'running';
            emitState();
        } catch {
            fail('INVALID_SNAPSHOT', 'The persisted scene snapshot could not be loaded.');
        }
        return;
    }

    if (envelope.sessionId !== sessionId || state === 'idle' || state === 'failed') return;

    switch (envelope.command) {
        case 'ping':
            self.postMessage({ type: 'heartbeat', sessionId, state, frame, time });
            break;
        case 'pause':
            if (state !== 'running') {
                fail('INVALID_TRANSITION', 'The runtime lifecycle transition is invalid.');
                break;
            }
            state = 'paused';
            emitState();
            break;
        case 'resume':
            if (state !== 'paused') {
                fail('INVALID_TRANSITION', 'The runtime lifecycle transition is invalid.');
                break;
            }
            state = 'running';
            emitState();
            break;
        case 'tick': {
            if (state !== 'running') break;
            const deltaTime = Number(envelope.payload?.deltaTime);
            if (!Number.isFinite(deltaTime) || deltaTime < 0 || deltaTime > 0.1) {
                fail('INVALID_DELTA', 'The runtime frame delta is outside the supported range.');
                break;
            }
            frame += 1;
            time += deltaTime;
            emitState();
            break;
        }
        case 'stop':
            snapshot = null;
            state = 'idle';
            emitState();
            sessionId = '';
            break;
        default:
            fail('UNKNOWN_COMMAND', 'The runtime command is not supported.');
    }
};
