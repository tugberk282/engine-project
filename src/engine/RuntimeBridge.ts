export type RuntimeState = 'idle' | 'starting' | 'running' | 'paused' | 'stopping' | 'failed';

export interface RuntimeFailure {
    code: string;
    message: string;
}

export interface RuntimeTransformState {
    id: string;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
}

export interface RuntimeFrame {
    state: RuntimeState;
    frame: number;
    timeMicros: number;
    fixedUpdateCount: number;
    updateCount: number;
    transforms: RuntimeTransformState[];
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
    private readonly frameListeners = new Set<(frame: RuntimeFrame) => void>();

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

    public step(deltaTime: number): void {
        void this.stepOnce(deltaTime);
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
        this.frameListeners.clear();
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

    public onFrame(listener: (frame: RuntimeFrame) => void): () => void {
        this.frameListeners.add(listener);
        return () => this.frameListeners.delete(listener);
    }

    private async request(command: string, payload: Record<string, unknown>): Promise<void> {
        try {
            const protocol = (window as any).tugberk?.v1;
            if (!protocol?.request) throw Object.assign(new Error('The supervised runtime protocol is unavailable.'), {
                code: 'RUNTIME_PROTOCOL_UNAVAILABLE'
            });
            const value = await protocol.request(command, payload) as Partial<RuntimeFrame>;
            if (value?.state) this.setState(value.state);
            if (Array.isArray(value?.transforms)
                && typeof value.frame === 'number'
                && typeof value.timeMicros === 'number') {
                this.frameListeners.forEach((listener) => listener(value as RuntimeFrame));
            }
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

    private async stepOnce(deltaTime: number): Promise<void> {
        if (this.state === 'running') await this.request('runtime.pause', {});
        if (this.state === 'paused') await this.request('runtime.step', { deltaTime });
    }

    private setState(state: RuntimeState): void {
        if (state === this.state) return;
        this.state = state;
        this.stateListeners.forEach((listener) => listener(state));
    }
}
