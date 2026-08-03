'use strict';

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { canonicalProjectIdentity } = require('./project-trust');
const { validateExecutionRequest } = require('./execution-contract');

function executionError(code, message) {
    return Object.assign(new Error(message), { code });
}

class TrustGatedExecutionBroker {
    constructor({ trustStore, runners = {}, createOperationId = randomUUID } = {}) {
        if (!trustStore || typeof trustStore.get !== 'function') {
            throw new TypeError('A project trust store is required');
        }
        this.trustStore = trustStore;
        this.runners = new Map(Object.entries(runners));
        this.createOperationId = createOperationId;
        this.active = new Map();
        this.closed = false;
    }

    async execute(rawRequest) {
        if (this.closed) throw executionError('BROKER_SHUTDOWN', 'Execution broker is shut down');
        const validation = validateExecutionRequest(rawRequest);
        if (!validation.ok) {
            throw executionError(validation.code, 'Execution request is invalid');
        }
        const request = validation.value;
        const trust = this.trustStore.get(request.projectPath);
        if (!trust.trusted) {
            throw executionError('PROJECT_TRUST_REQUIRED', `Project-controlled ${request.kind} execution requires trust`);
        }
        const runner = this.runners.get(request.kind);
        if (typeof runner !== 'function') {
            throw executionError('EXECUTOR_UNAVAILABLE', `No ${request.kind} executor is registered`);
        }

        const operationId = this.createOperationId();
        const controller = new AbortController();
        const operation = {
            operationId,
            projectIdentity: trust.identity,
            kind: request.kind,
            controller,
            promise: null
        };
        this.active.set(operationId, operation);

        try {
            // Check again after admission and immediately before handing control to
            // an executor. This closes the revocation race between validation and dispatch.
            const dispatchTrust = this.trustStore.get(trust.root);
            if (!dispatchTrust.trusted || dispatchTrust.identity !== trust.identity || controller.signal.aborted) {
                throw executionError('PROJECT_TRUST_REVOKED', 'Project trust was revoked before execution');
            }
            const entrypoint = path.join(dispatchTrust.root, ...request.entrypoint.split('/'));
            operation.promise = Promise.resolve(runner(Object.freeze({
                operationId,
                kind: request.kind,
                projectRoot: dispatchTrust.root,
                projectIdentity: dispatchTrust.identity,
                entrypoint,
                arguments: request.arguments,
                signal: controller.signal
            })));
            const value = await operation.promise;
            if (controller.signal.aborted) {
                throw executionError('EXECUTION_CANCELLED', 'Execution was cancelled');
            }
            return Object.freeze({ operationId, value });
        } finally {
            this.active.delete(operationId);
        }
    }

    cancel(operationId, reason = 'Execution was cancelled') {
        const operation = this.active.get(operationId);
        if (!operation) return false;
        operation.controller.abort(executionError('EXECUTION_CANCELLED', reason));
        return true;
    }

    async revokeProject(projectPath) {
        const identity = canonicalProjectIdentity(projectPath).identity;
        const pending = [];
        for (const operation of this.active.values()) {
            if (operation.projectIdentity !== identity) continue;
            operation.controller.abort(executionError(
                'PROJECT_TRUST_REVOKED',
                'Project trust was revoked'
            ));
            if (operation.promise) pending.push(operation.promise.catch(() => {}));
        }
        await Promise.allSettled(pending);
    }

    async shutdown() {
        if (this.closed) return;
        this.closed = true;
        const pending = [];
        for (const operation of this.active.values()) {
            operation.controller.abort(executionError('BROKER_SHUTDOWN', 'Execution broker is shutting down'));
            if (operation.promise) pending.push(operation.promise.catch(() => {}));
        }
        await Promise.allSettled(pending);
    }

    get activeCount() {
        return this.active.size;
    }
}

module.exports = { TrustGatedExecutionBroker, executionError };
