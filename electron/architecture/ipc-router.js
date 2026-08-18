'use strict';

const { createResponse, validateRequest } = require('./contract');

const FALLBACK_REQUEST_ID = 'invalid-request';
const MAX_ENVELOPE_BYTES = 17 * 1024 * 1024;

function stableError(error) {
    const knownCodes = new Set([
        'DUPLICATE_REQUEST', 'GRANT_NOT_FOUND', 'INVALID_ENVELOPE',
        'INVALID_PAYLOAD', 'INVALID_REQUEST_ID', 'RENDERER_GONE',
        'REQUEST_CANCELLED', 'RESOURCE_TOO_LARGE', 'SCAN_LIMIT_EXCEEDED',
        'UNKNOWN_COMMAND', 'UNTRUSTED_SENDER', 'VERSION_MISMATCH',
        'PROJECT_INVALID', 'PROJECT_NOT_FOUND', 'TRUST_CANCELLED',
        'INVALID_SNAPSHOT', 'INVALID_SNAPSHOT_STRUCTURE',
        'RUNTIME_SNAPSHOT_VERSION_MISMATCH', 'SNAPSHOT_RESOURCE_LIMIT',
        'INVALID_ASSET_REFERENCE', 'INVALID_COMPONENT_TYPE'
    ]);
    const code = knownCodes.has(error?.code) ? error.code : 'REQUEST_FAILED';
    return {
        code,
        message: code === 'REQUEST_FAILED' ? 'Request failed' : String(error?.message || 'Request rejected')
    };
}

function usableRequestId(request) {
    return typeof request?.requestId === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(request.requestId)
        ? request.requestId
        : FALLBACK_REQUEST_ID;
}

function measureEnvelope(request) {
    try {
        return Buffer.byteLength(JSON.stringify(request), 'utf8');
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}

function createVersionedHandler({ authenticate, execute, onDiagnostic = () => {} }) {
    const requestsBySender = new Map();

    return async function handleVersionedRequest(event, request) {
        const requestId = usableRequestId(request);
        const started = Date.now();
        try {
            authenticate(event);
            if (measureEnvelope(request) > MAX_ENVELOPE_BYTES) {
                throw Object.assign(new Error('IPC envelope exceeds size limit'), { code: 'INVALID_PAYLOAD' });
            }

            const validation = validateRequest(request);
            if (!validation.ok) {
                throw Object.assign(new Error('Request rejected'), { code: validation.code });
            }

            const senderId = event.sender.id;
            let seen = requestsBySender.get(senderId);
            if (!seen) {
                seen = new Set();
                requestsBySender.set(senderId, seen);
                event.sender.once?.('destroyed', () => requestsBySender.delete(senderId));
            }
            if (seen.has(request.requestId)) {
                throw Object.assign(new Error('Request ID was already used'), { code: 'DUPLICATE_REQUEST' });
            }
            seen.add(request.requestId);

            const value = await execute(event, request);
            if (event.sender.isDestroyed()) {
                throw Object.assign(new Error('Renderer was destroyed before completion'), { code: 'RENDERER_GONE' });
            }
            onDiagnostic({
                processRole: 'main',
                requestId,
                operation: request.command,
                durationMs: Date.now() - started,
                outcome: 'success'
            });
            return createResponse(request.requestId, { ok: true, value });
        } catch (error) {
            const boundedError = stableError(error);
            onDiagnostic({
                processRole: 'main',
                requestId,
                operation: typeof request?.command === 'string' ? request.command : 'ipc.request',
                durationMs: Date.now() - started,
                outcome: 'failure',
                errorCode: boundedError.code
            });
            return createResponse(requestId, { ok: false, error: boundedError });
        }
    };
}

module.exports = Object.freeze({
    MAX_ENVELOPE_BYTES,
    createVersionedHandler,
    stableError
});
