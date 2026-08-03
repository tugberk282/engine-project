'use strict';

class ShutdownCoordinator {
    constructor({ deadlineMs = 5000, onEvent = () => {} } = {}) {
        this.deadlineMs = deadlineMs;
        this.onEvent = onEvent;
        this.services = [];
        this.state = 'running';
        this.result = null;
    }

    register(name, shutdown) {
        if (this.state !== 'running') throw Object.assign(new Error('Shutdown has started'), { code: 'SERVICE_SHUTTING_DOWN' });
        this.services.push({ name, shutdown });
    }

    assertAcceptingWork() {
        if (this.state !== 'running') throw Object.assign(new Error('Service is shutting down'), { code: 'SERVICE_SHUTTING_DOWN' });
    }

    shutdown(reason = 'application-quit') {
        if (this.result) return this.result;
        this.state = 'shutting-down';
        const started = Date.now();
        this.onEvent({ operation: 'shutdown', outcome: 'started', details: { reason } });
        this.result = Promise.all(this.services.map(async ({ name, shutdown }) => {
            let timer;
            try {
                await Promise.race([
                    Promise.resolve().then(shutdown),
                    new Promise((_, reject) => {
                        timer = setTimeout(() => reject(Object.assign(new Error('Shutdown deadline exceeded'), {
                            code: 'SHUTDOWN_TIMEOUT'
                        })), this.deadlineMs);
                    })
                ]);
                return { name, outcome: 'clean' };
            } catch (error) {
                return { name, outcome: 'failed', errorCode: error?.code || 'SHUTDOWN_FAILED' };
            } finally {
                clearTimeout(timer);
            }
        })).then((services) => {
            this.state = 'stopped';
            const outcome = services.every((item) => item.outcome === 'clean') ? 'clean' : 'degraded';
            this.onEvent({ operation: 'shutdown', outcome, durationMs: Date.now() - started, details: { reason, services } });
            return Object.freeze({ outcome, services: Object.freeze(services) });
        });
        return this.result;
    }
}

module.exports = Object.freeze({ ShutdownCoordinator });
