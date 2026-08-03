'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { BuildError, assertBuildRequest, serializeError } = require('./build-contract');

class BuildService {
    constructor({ workerPath = path.join(__dirname, 'build-worker.js'), timeoutMs = 120_000, maxLogEntries = 500 } = {}) {
        this.workerPath = workerPath;
        this.timeoutMs = timeoutMs;
        this.maxLogEntries = maxLogEntries;
        this.active = new Map();
        this.shuttingDown = false;
    }

    async build(rawRequest, { signal, onProgress, onLog } = {}) {
        if (this.shuttingDown) throw new BuildError('SERVICE_SHUTTING_DOWN', 'Build service is shutting down');
        const request = assertBuildRequest(rawRequest);
        const buildId = randomUUID();
        const workspacePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tugberk-build-'));
        const publishTemp = `${request.outputPath}.tugberk-${buildId}.tmp`;
        const previousOutput = `${request.outputPath}.tugberk-${buildId}.previous`;
        const logs = [];
        let child;
        let timeout;
        const cancel = () => child?.connected && child.send({ type: 'cancel' });
        signal?.addEventListener('abort', cancel, { once: true });
        try {
            await fs.promises.rm(publishTemp, { recursive: true, force: true });
            child = fork(this.workerPath, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
            this.active.set(buildId, child);
            const result = await new Promise((resolve, reject) => {
                let settled = false;
                const settle = (callback, value) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    callback(value);
                };
                timeout = setTimeout(() => {
                    child.kill();
                    settle(reject, new BuildError('WORKER_TIMEOUT', 'Build worker exceeded its time limit'));
                }, this.timeoutMs);
                child.on('message', (message) => {
                    if (message?.type === 'progress') onProgress?.({ buildId, ...message });
                    if (message?.type === 'log') {
                        if (logs.length === this.maxLogEntries) logs.shift();
                        logs.push({ level: message.level, message: message.message });
                        onLog?.({ buildId, level: message.level, message: message.message });
                    }
                    if (message?.type === 'result') {
                        if (message.ok) settle(resolve, message.manifest);
                        else settle(reject, new BuildError(message.error.code, message.error.message, message.error.details));
                    }
                });
                child.once('error', (error) => settle(reject, new BuildError('WORKER_START_FAILED', error.message)));
                child.once('exit', (code, workerSignal) => {
                    if (!settled) settle(reject, new BuildError('WORKER_CRASHED',
                        `Build worker exited before completion (${workerSignal || code})`));
                });
                child.send({ type: 'build', request: { ...request, workspacePath } });
                if (signal?.aborted) cancel();
            });
            await fs.promises.mkdir(path.dirname(request.outputPath), { recursive: true });
            await fs.promises.rename(workspacePath, publishTemp);
            let movedPrevious = false;
            try {
                await fs.promises.rename(request.outputPath, previousOutput);
                movedPrevious = true;
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
            try {
                await fs.promises.rename(publishTemp, request.outputPath);
                if (movedPrevious) await fs.promises.rm(previousOutput, { recursive: true, force: true });
            } catch (error) {
                if (movedPrevious) await fs.promises.rename(previousOutput, request.outputPath).catch(() => {});
                throw error;
            }
            return Object.freeze({ buildId, manifest: result, outputPath: request.outputPath, logs: Object.freeze([...logs]) });
        } catch (error) {
            await fs.promises.rm(publishTemp, { recursive: true, force: true }).catch(() => {});
            throw error instanceof BuildError ? error : new BuildError(serializeError(error).code, error.message);
        } finally {
            signal?.removeEventListener('abort', cancel);
            clearTimeout(timeout);
            if (child && child.exitCode === null) child.kill();
            this.active.delete(buildId);
            await fs.promises.rm(workspacePath, { recursive: true, force: true }).catch(() => {});
        }
    }

    async shutdown() {
        this.shuttingDown = true;
        for (const child of this.active.values()) {
            if (child.connected) child.send({ type: 'cancel' });
            child.kill();
        }
        this.active.clear();
    }
}

module.exports = Object.freeze({ BuildService });
