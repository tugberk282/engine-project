export type RuntimeState = 'idle' | 'starting' | 'running' | 'paused' | 'stopping' | 'failed';

export interface RuntimeFailure {
    code: string;
    message: string;
}

export interface RuntimeBridgeOptions {
    heartbeatIntervalMs?: number;
    heartbeatTimeoutMs?: number;
    lifecycleTimeoutMs?: number;
    restartBackoffMs?: number;
    maxRestarts?: number;
}

export class RuntimeBridge {
    private state: RuntimeState = 'idle';
    private stoppingIntentionally = false;
    private readonly stateListeners = new Set<(state: RuntimeState) => void>();
    private readonly errorListeners = new Set<(error: RuntimeFailure) => void>();

    public constructor(_options: RuntimeBridgeOptions = {}) {}

    public start(snapshot: string): void {
        this.stoppingIntentionally = false;
        this.setState('starting');
        void this.request('runtime.start', { snapshot });
    }

    public pause(): void {
        if (this.state === 'running') void this.request('runtime.pause', {});
    }

    public resume(): void {
        if (this.state === 'paused') void this.request('runtime.resume', {});
    }

    public tick(deltaTime: number): void {
        if (this.state === 'running') void this.request('runtime.tick', { deltaTime });
    }

    public restart(snapshot: string): void {
        this.start(snapshot);
    }

    public stop(): void {
        this.stoppingIntentionally = true;
        this.setState('stopping');
        void this.request('runtime.stop', {});
    }

    public dispose(): void {
        this.stoppingIntentionally = true;
        if (this.state !== 'idle') void this.request('runtime.stop', {});
        this.setState('idle');
        this.stateListeners.clear();
        this.errorListeners.clear();
    }

    public getState(): RuntimeState {
        return this.state;
    }

    public onStateChange(listener: (state: RuntimeState) => void): () => void {
        this.stateListeners.add(listener);
        return () => this.stateListeners.delete(listener);
    }

    public onError(listener: (error: RuntimeFailure) => void): () => void {
        this.errorListeners.add(listener);
        return () => this.errorListeners.delete(listener);
    }

    private async request(command: string, payload: Record<string, unknown>): Promise<void> {
        try {
            const protocol = (window as any).tugberk?.v1;
            if (!protocol?.request) throw Object.assign(new Error('The supervised runtime protocol is unavailable.'), {
                code: 'RUNTIME_PROTOCOL_UNAVAILABLE'
            });
            const value = await protocol.request(command, payload) as { state?: RuntimeState };
            if (value?.state) this.setState(value.state);
        } catch (cause) {
            if (this.stoppingIntentionally) {
                this.setState('idle');
                return;
            }
            const error = {
                code: typeof (cause as any)?.code === 'string' ? (cause as any).code : 'RUNTIME_FAILED',
                message: typeof (cause as any)?.message === 'string'
                    ? (cause as any).message
                    : 'The play runtime failed.'
            };
            this.setState('failed');
            this.errorListeners.forEach((listener) => listener(error));
        }
    }

    private setState(state: RuntimeState): void {
        if (state === this.state) return;
        this.state = state;
        this.stateListeners.forEach((listener) => listener(state));
    }
}
