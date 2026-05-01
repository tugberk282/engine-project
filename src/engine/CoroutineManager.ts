/**
 * Coroutine System
 * Async script execution using generators
 */

export interface IEnumerator {
    [Symbol.iterator](): Iterator<any>;
}

export class WaitForSeconds {
    public readonly duration: number;

    constructor(duration: number) {
        this.duration = duration;
    }
}

export class WaitForSecondsRealtime {
    public readonly duration: number;

    constructor(duration: number) {
        this.duration = duration;
    }
}

export class WaitForEndOfFrame {
    // Marker for end of frame wait
}

export class WaitForFixedUpdate {
    // Marker for fixed update wait
}

export class WaitUntil {
    public readonly condition: () => boolean;

    constructor(condition: () => boolean) {
        this.condition = condition;
    }
}

export class WaitWhile {
    public readonly condition: () => boolean;

    constructor(condition: () => boolean) {
        this.condition = condition;
    }
}

interface CoroutineState {
    generator: Generator<any, void, any>;
    time: number;
    realtime: number;
    waiting?: any;
    waitStartedRealtime?: number;
    active: boolean;
}

export class CoroutineManager {
    private static instance: CoroutineManager;
    private coroutines: Map<object, CoroutineState[]> = new Map();
    private toAdd: Array<{ owner: object; state: CoroutineState }> = [];
    private toRemove: CoroutineState[] = [];

    private constructor() { }

    public static getInstance(): CoroutineManager {
        if (!CoroutineManager.instance) {
            CoroutineManager.instance = new CoroutineManager();
        }
        return CoroutineManager.instance;
    }

    /**
     * Start a coroutine
     */
    public startCoroutine(owner: object, generator: Generator<any, void, any>): void {
        const state: CoroutineState = {
            generator,
            time: 0,
            realtime: performance.now() / 1000,
            active: true
        };

        this.toAdd.push({ owner, state });
    }

    /**
     * Stop all coroutines for an owner
     */
    public stopCoroutines(owner: object): void {
        if (this.coroutines.has(owner)) {
            const states = this.coroutines.get(owner)!;
            states.forEach(state => {
                state.active = false;
                this.toRemove.push(state);
            });
        }
    }

    /**
     * Stop specific coroutine
     */
    public stopCoroutine(state: CoroutineState): void {
        state.active = false;
        this.toRemove.push(state);
    }

    /**
     * Update coroutines in normal frame update phase.
     */
    public update(deltaTime: number): void {
        this.flushPendingCoroutines();
        this.forEachState((state) => this.stepState(state, deltaTime, 'frame'));
        this.pruneInactiveCoroutines();
    }

    /**
     * Resume coroutines waiting for fixed update.
     */
    public updateFixed(): void {
        this.flushPendingCoroutines();
        this.forEachState((state) => this.stepState(state, 0, 'fixed'));
        this.pruneInactiveCoroutines();
    }

    /**
     * Resume coroutines waiting for end-of-frame.
     */
    public updateEndOfFrame(): void {
        this.flushPendingCoroutines();
        this.forEachState((state) => this.stepState(state, 0, 'endOfFrame'));
        this.pruneInactiveCoroutines();
    }

    public clearAll(): void {
        this.coroutines.clear();
        this.toAdd = [];
        this.toRemove = [];
    }

    private flushPendingCoroutines(): void {
        // Add pending coroutines
        this.toAdd.forEach(({ owner, state }) => {
            if (!this.coroutines.has(owner)) {
                this.coroutines.set(owner, []);
            }
            this.coroutines.get(owner)!.push(state);
        });
        this.toAdd = [];
    }

    private forEachState(visitor: (state: CoroutineState) => void): void {
        this.coroutines.forEach((states, owner) => {
            const activeStates = states.filter(state => state.active);
            activeStates.forEach(visitor);
            this.coroutines.set(owner, activeStates);
        });
    }

    private stepState(state: CoroutineState, deltaTime: number, phase: 'frame' | 'fixed' | 'endOfFrame'): void {
        state.realtime = performance.now() / 1000;
        if (phase === 'frame') {
            state.time += deltaTime;
        }

        try {
            let shouldContinue = true;

            // Check if waiting condition is met
            if (state.waiting) {
                if (state.waiting instanceof WaitForSeconds) {
                    shouldContinue = phase === 'frame' && state.time >= state.waiting.duration;
                } else if (state.waiting instanceof WaitForSecondsRealtime) {
                    shouldContinue = phase === 'frame'
                        && (performance.now() / 1000) - (state.waitStartedRealtime ?? state.realtime) >= state.waiting.duration;
                } else if (state.waiting instanceof WaitUntil) {
                    shouldContinue = phase === 'frame' && state.waiting.condition();
                } else if (state.waiting instanceof WaitWhile) {
                    shouldContinue = phase === 'frame' && !state.waiting.condition();
                } else if (state.waiting instanceof WaitForFixedUpdate) {
                    shouldContinue = phase === 'fixed';
                } else if (state.waiting instanceof WaitForEndOfFrame) {
                    shouldContinue = phase === 'endOfFrame';
                }
            }

            if (shouldContinue) {
                state.time = 0;
                state.waiting = undefined;
                const result = state.generator.next();

                if (result.done) {
                    state.active = false;
                } else {
                    state.waiting = result.value;
                    if (result.value instanceof WaitForSecondsRealtime) {
                        state.waitStartedRealtime = performance.now() / 1000;
                    }
                }
            }
        } catch (error) {
            console.error('[Coroutine] Error:', error);
            state.active = false;
        }
    }

    private pruneInactiveCoroutines(): void {
        // Remove inactive coroutines
        this.toRemove.forEach(state => {
            this.coroutines.forEach((states) => {
                const idx = states.indexOf(state);
                if (idx >= 0) {
                    states.splice(idx, 1);
                }
            });
        });
        this.toRemove = [];
    }
}

/**
 * Component extension for coroutine support
 */
export class CoroutineComponent {
    protected StartCoroutine(generator: Generator<any, void, any>): void {
        CoroutineManager.getInstance().startCoroutine(this, generator);
    }

    protected StopCoroutines(): void {
        CoroutineManager.getInstance().stopCoroutines(this);
    }
}
