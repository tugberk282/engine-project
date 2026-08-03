'use strict';

const path = require('node:path');
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');

class RuntimeSupervisor {
    constructor({
        workerPath = path.join(__dirname, 'runtime-process.js'),
        forkProcess = (file) => fork(file, [], {
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
            execArgv: ['--max-old-space-size=512'],
            windowsHide: true
        }),
        lifecycleTimeoutMs = 5000,
        heartbeatIntervalMs = 1000,
        heartbeatTimeoutMs = 3000,
        restartBackoffMs = 250,
        maxRestarts = 2,
        onDiagnostic = () => {}
    } = {}) {
        this.workerPath = workerPath;
        this.forkProcess = forkProcess;
        this.lifecycleTimeoutMs = lifecycleTimeoutMs;
        this.heartbeatIntervalMs = heartbeatIntervalMs;
        this.heartbeatTimeoutMs = heartbeatTimeoutMs;
        this.restartBackoffMs = restartBackoffMs;
        this.maxRestarts = maxRestarts;
        this.onDiagnostic = onDiagnostic;
        this.child = null;
        this.sessionId = '';
        this.snapshot = null;
        this.state = 'idle';
        this.restartCount = 0;
        this.pending = new Map();
        this.heartbeatTimer = null;
        this.restarting = null;
        this.stopping = false;
    }

    async start(snapshot) {
        await this.stop();
        this.snapshot = snapshot;
        this.restartCount = 0;
        this.stopping = false;
        return this.launch();
    }

    async launch() {
        this.state = 'starting';
        this.sessionId = randomUUID();
        const child = this.forkProcess(this.workerPath);
        this.child = child;
        child.on('message', (message) => this.handleMessage(child, message));
        child.once('exit', (code, signal) => this.handleTermination(child, 'RUNTIME_CRASH', { code, signal }));
        child.once('error', () => this.handleTermination(child, 'RUNTIME_START_FAILED'));
        const result = await this.request('start', { snapshot: this.snapshot }, this.lifecycleTimeoutMs);
        this.state = result.state;
        this.armHeartbeat();
        return result;
    }

    pause() { return this.transition('pause'); }
    resume() { return this.transition('resume'); }
    tick(deltaTime) { return this.transition('tick', { deltaTime }); }

    async transition(command, payload = {}) {
        if (!this.child) throw this.error('RUNTIME_NOT_RUNNING', 'The play runtime is not running.');
        const result = await this.request(command, payload, this.lifecycleTimeoutMs);
        this.state = result.state;
        return result;
    }

    async stop() {
        this.stopping = true;
        this.clearHeartbeat();
        if (this.restarting) {
            clearTimeout(this.restarting.timer);
            this.restarting.resolve();
            this.restarting = null;
        }
        const child = this.child;
        if (child) {
            try { await this.request('stop', {}, this.lifecycleTimeoutMs); } catch {}
            this.disposeChild(child);
        }
        this.snapshot = null;
        this.sessionId = '';
        this.state = 'idle';
        this.rejectPending('RUNTIME_STOPPED', 'The play runtime was stopped.');
        return { state: 'idle', frame: 0, timeMicros: 0 };
    }

    async shutdown() { await this.stop(); }

    request(command, payload, timeoutMs) {
        const child = this.child;
        if (!child?.connected) return Promise.reject(this.error('RUNTIME_NOT_RUNNING', 'The play runtime is not running.'));
        const requestId = randomUUID();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(this.error(command === 'ping' ? 'RUNTIME_HEARTBEAT_TIMEOUT' : 'RUNTIME_LIFECYCLE_TIMEOUT',
                    'The play runtime did not respond in time.'));
                if (command === 'ping') this.handleTermination(child, 'RUNTIME_HEARTBEAT_TIMEOUT');
            }, timeoutMs);
            this.pending.set(requestId, { resolve, reject, timer });
            child.send({ protocolVersion: 1, requestId, sessionId: this.sessionId, command, payload });
        });
    }

    handleMessage(source, message) {
        if (source !== this.child || message?.sessionId !== this.sessionId) return;
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.requestId);
        if (message.ok) pending.resolve(message.value);
        else pending.reject(this.error(message.error?.code || 'RUNTIME_FAILED', message.error?.message || 'The play runtime failed.'));
    }

    armHeartbeat() {
        this.clearHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            this.request('ping', {}, this.heartbeatTimeoutMs).catch(() => {});
        }, this.heartbeatIntervalMs);
        this.heartbeatTimer.unref?.();
    }

    clearHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
    }

    handleTermination(source, code, details = {}) {
        if (source !== this.child) return;
        this.disposeChild(source);
        this.clearHeartbeat();
        this.rejectPending(code, 'The play runtime stopped unexpectedly.');
        if (this.stopping || this.snapshot === null) return;
        this.onDiagnostic({ operation: 'runtime.terminated', outcome: 'failure', errorCode: code, details });
        if (this.restartCount >= this.maxRestarts) {
            this.state = 'failed';
            return;
        }
        const delay = this.restartBackoffMs * (2 ** this.restartCount++);
        this.state = 'starting';
        this.restarting = {};
        const promise = new Promise((resolve) => {
            this.restarting.resolve = resolve;
            this.restarting.timer = setTimeout(resolve, delay);
        });
        promise.then(() => {
            this.restarting = null;
            if (!this.stopping && this.snapshot !== null) {
                this.launch().catch((error) => this.handleTermination(this.child, error.code || 'RUNTIME_START_FAILED'));
            }
        });
    }

    disposeChild(child) {
        if (this.child === child) this.child = null;
        child.removeAllListeners();
        if (child.connected) child.disconnect();
        if (!child.killed) child.kill();
    }

    rejectPending(code, message) {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(this.error(code, message));
        }
        this.pending.clear();
    }

    error(code, message) { return Object.assign(new Error(message), { code }); }
}

module.exports = Object.freeze({ RuntimeSupervisor });
