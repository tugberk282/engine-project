/**
 * Play Mode Manager
 * Handles Play/Pause/Stop/Step execution modes and state restoration
 */

import { Scene } from './Scene';
import { SceneManager } from './SceneManager';
import { RuntimeBridge, RuntimeFailure, RuntimeFrame, RuntimeState } from './RuntimeBridge';
import { Input } from './Input';
import { Prefab } from './Prefab';

export type PlayMode = 'edit' | 'play' | 'paused';
export type PlayStep = 'frame' | 'physics' | 'full';

export class PlayModeManager {
    private static instance: PlayModeManager;
    private mode: PlayMode = 'edit';
    private timeScale: number = 1.0;
    private isPaused: boolean = false;
    private frame: number = 0;
    private time: number = 0;
    private deltaTime: number = 0;
    private lastFrameTime: number = 0;
    private targetFrameTime: number = 1 / 60; // 60 FPS default
    private readonly runtime = new RuntimeBridge();
    private runtimeError: RuntimeFailure | null = null;
    private lastRuntimeUiEvent: string | null = null;
    private lastRuntimeAudioSequence: number = 0;
    private lastRuntimeParticleSequence: number = 0;
    private lastRuntimeAnimationSequence: number = 0;
    private lastRuntimeSpawnSequence: number = 0;
    private runtimeSceneSnapshot: string | null = null;
    private runtimeScenePath: string | null = null;
    private sceneTransitionInFlight = false;
    private enteringPlayMode = false;
    private snapshotPreparer: ((snapshot: string) => Promise<string>) | null = null;
    private readonly reportedScriptDiagnostics = new Set<string>();
    private scriptReloadInFlight = false;

    private sceneSnapshot: any = null;
    private editorState: any = null;
    private onPlayCallbacks: Array<() => void> = [];
    private onPauseCallbacks: Array<() => void> = [];
    private onStopCallbacks: Array<() => void> = [];
    private onFrameCallbacks: Array<(deltaTime: number) => void> = [];

    private constructor() {
        this.runtime.onStateChange((state) => this.handleRuntimeState(state));
        this.runtime.onFrame((runtimeFrame) => this.applyRuntimeFrame(runtimeFrame));
        this.runtime.onError((error) => {
            this.runtimeError = error;
            console.error(`[PlayMode] ${error.code}: ${error.message}`);
            this.exitPlayMode();
        });
        if (typeof window !== 'undefined') {
            window.addEventListener('tugberk-ui-event', this.handleRuntimeUIEvent as EventListener);
            window.addEventListener('tugberk-runtime-load-scene', this.handleRuntimeLoadScene as EventListener);
        }
    }

    private readonly handleRuntimeUIEvent = (event: Event): void => {
        if (this.mode !== 'play') return;
        const detail = (event as CustomEvent<{ name?: string; value?: unknown }>).detail;
        const name = detail?.name;
        if (typeof name === 'string' && name.length > 0 && name.length <= 128) this.runtime.uiEvent(name, detail?.value);
    };

    private readonly handleRuntimeLoadScene = (event: Event): void => {
        if (this.mode !== 'play' || this.sceneTransitionInFlight) return;
        const scenePath = (event as CustomEvent<{ scenePath?: unknown }>).detail?.scenePath;
        if (typeof scenePath !== 'string' || !scenePath.trim()) return;
        void this.loadRuntimeScene(scenePath);
    };

    private async loadRuntimeScene(scenePath: string): Promise<void> {
        this.sceneTransitionInFlight = true;
        try {
            const editor = (window as any).Editor?.instance;
            if (!editor?.prepareRuntimeSceneSnapshot) {
                throw Object.assign(new Error('The editor runtime scene loader is unavailable.'), {
                    code: 'RUNTIME_SCENE_LOADER_UNAVAILABLE'
                });
            }
            const prepared = await editor.prepareRuntimeSceneSnapshot(scenePath) as { path: string; snapshot: string };
            if (this.mode !== 'play') return;
            const scene = SceneManager.getInstance().getActiveScene();
            if (!scene) throw Object.assign(new Error('No active scene is available for Play Mode.'), {
                code: 'RUNTIME_SCENE_UNAVAILABLE'
            });

            scene.loadFromJSON(prepared.snapshot);
            this.runtimeSceneSnapshot = prepared.snapshot;
            this.runtimeScenePath = prepared.path;
            this.lastRuntimeUiEvent = null;
            this.lastRuntimeAudioSequence = 0;
            this.lastRuntimeParticleSequence = 0;
            this.lastRuntimeAnimationSequence = 0;
            this.lastRuntimeSpawnSequence = 0;
            this.frame = 0;
            this.time = 0;
            this.deltaTime = 0;
            this.runtimeError = null;
            this.reportedScriptDiagnostics.clear();
            editor.onRuntimeSceneChanged?.(prepared.path);
            this.runtime.restart(prepared.snapshot);
            console.log(`[PlayMode] Loaded runtime scene: ${prepared.path}`);
        } catch (cause) {
            const code = typeof (cause as any)?.code === 'string'
                ? (cause as any).code
                : 'RUNTIME_SCENE_LOAD_FAILED';
            const message = typeof (cause as any)?.message === 'string'
                ? (cause as any).message
                : `Failed to load runtime scene '${scenePath}'.`;
            console.error(`[PlayMode] ${code}: ${message}`);
            window.dispatchEvent(new CustomEvent('tugberk-runtime-load-scene-error', {
                detail: { code, message, scenePath }
            }));
        } finally {
            this.sceneTransitionInFlight = false;
        }
    }

    public static getInstance(): PlayModeManager {
        if (!PlayModeManager.instance) {
            PlayModeManager.instance = new PlayModeManager();
        }
        return PlayModeManager.instance;
    }

    /**
     * Enter Play Mode
     * Saves editor state and starts execution
     */
    public async enterPlayMode(): Promise<boolean> {
        if (this.mode === 'play' || this.enteringPlayMode) return false;
        this.enteringPlayMode = true;

        // Save editor state
        this.saveEditorState();

        // Snapshot current scene
        const scene = SceneManager.getInstance().getActiveScene();
        if (scene) {
            this.sceneSnapshot = this.snapshotScene(scene);
            try {
                this.runtimeSceneSnapshot = this.snapshotPreparer
                    ? await this.snapshotPreparer(this.sceneSnapshot)
                    : this.sceneSnapshot;
            } catch (cause) {
                this.runtimeError = {
                    code: typeof (cause as any)?.code === 'string' ? (cause as any).code : 'RUNTIME_SNAPSHOT_PREPARE_FAILED',
                    message: typeof (cause as any)?.message === 'string' ? (cause as any).message : 'Play Mode snapshot preparation failed.'
                };
                this.sceneSnapshot = null;
                this.runtimeSceneSnapshot = null;
                this.enteringPlayMode = false;
                console.error(`[PlayMode] ${this.runtimeError.code}: ${this.runtimeError.message}`);
                return false;
            }
            this.runtimeScenePath = SceneManager.getInstance().getActiveScenePath();
        }

        this.mode = 'play';
        this.frame = 0;
        this.time = 0;
        this.deltaTime = 0;
        this.isPaused = false;
        this.lastFrameTime = performance.now() / 1000;

        this.runtimeError = null;
        this.reportedScriptDiagnostics.clear();
        this.lastRuntimeUiEvent = null;
        this.lastRuntimeAudioSequence = 0;
        this.lastRuntimeParticleSequence = 0;
        this.lastRuntimeAnimationSequence = 0;
        this.lastRuntimeSpawnSequence = 0;
        this.sceneTransitionInFlight = false;
        if (this.runtimeSceneSnapshot) this.runtime.start(this.runtimeSceneSnapshot);

        // Trigger callbacks
        this.onPlayCallbacks.forEach(cb => cb());

        console.log('[PlayMode] Entered Play Mode');
        this.enteringPlayMode = false;
        return true;
    }

    public setSnapshotPreparer(preparer: ((snapshot: string) => Promise<string>) | null): void {
        this.snapshotPreparer = preparer;
    }

    /**
     * Exit Play Mode
     * Restores scene to pre-play state
     */
    public exitPlayMode(): void {
        if (this.mode === 'edit') return;

        this.runtime.stop();
        this.lastRuntimeUiEvent = null;
        this.lastRuntimeAudioSequence = 0;
        this.lastRuntimeParticleSequence = 0;
        this.lastRuntimeAnimationSequence = 0;
        this.lastRuntimeSpawnSequence = 0;
        this.reportedScriptDiagnostics.clear();

        // Restore scene from snapshot
        if (this.sceneSnapshot) {
            this.restoreScene(this.sceneSnapshot);
            this.sceneSnapshot = null;
        }
        this.runtimeSceneSnapshot = null;
        this.runtimeScenePath = null;

        // Restore editor state
        this.restoreEditorState();

        this.mode = 'edit';
        this.isPaused = false;

        // Trigger callbacks
        this.onStopCallbacks.forEach(cb => cb());

        console.log('[PlayMode] Exited Play Mode');
    }

    /**
     * Pause Play Mode
     */
    public pausePlayMode(): void {
        if (this.mode !== 'play') return;
        if (this.isPaused) return;

        this.isPaused = true;
        this.runtime.pause();
        this.onPauseCallbacks.forEach(cb => cb());

        console.log('[PlayMode] Paused');
    }

    /**
     * Resume Play Mode
     */
    public resumePlayMode(): void {
        if (this.mode !== 'play') return;
        if (!this.isPaused) return;

        this.isPaused = false;
        this.runtime.resume();
        this.lastFrameTime = performance.now() / 1000;

        console.log('[PlayMode] Resumed');
    }

    /**
     * Step one frame in paused mode
     */
    public stepFrame(): void {
        if (this.mode !== 'play') return;
        this.isPaused = true;
        this.deltaTime = this.targetFrameTime;
        this.runtime.step(this.targetFrameTime, Input.snapshot());
    }

    /**
     * Update play mode each frame
     * Called from main render loop
     */
    public update(): void {
        if (this.mode !== 'play' || this.isPaused) return;

        const now = performance.now() / 1000;
        let frameDelta = now - this.lastFrameTime;

        // Cap delta time to prevent large jumps
        if (frameDelta > 0.1) frameDelta = 0.1;

        this.lastFrameTime = now;
        this.updateFrame(frameDelta * this.timeScale);
    }

    /**
     * Internal frame update
     */
    private updateFrame(delta: number): void {
        this.deltaTime = delta;
        this.runtime.tick(delta, Input.snapshot());

        // Call frame callbacks
        this.onFrameCallbacks.forEach(cb => cb(delta));
    }

    /**
     * Snapshot scene state
     */
    private snapshotScene(scene: Scene): string {
        return scene.toJSON();
    }

    /**
     * Restore scene from snapshot
     */
    private restoreScene(snapshot: string): void {
        const scene = SceneManager.getInstance().getActiveScene();
        if (!scene) return;
        scene.loadFromJSON(snapshot);
        console.log('[PlayMode] Scene restored from snapshot');
    }

    /**
     * Save editor state (selection, layout, etc.)
     */
    private saveEditorState(): void {
        // @ts-ignore
        const editor = window.Editor?.instance;
        if (editor) {
            this.editorState = {
                selectedGameObjectId: editor.selectedGameObject?.id ?? null,
                sceneView: editor.getSceneViewState?.()
            };
        }
    }

    /**
     * Restore editor state
     */
    private restoreEditorState(): void {
        // @ts-ignore
        const editor = window.Editor?.instance;
        if (editor && this.editorState) {
            const scene = SceneManager.getInstance().getActiveScene();
            const selected = this.editorState.selectedGameObjectId
                ? scene?.findGameObjectByID(this.editorState.selectedGameObjectId) ?? null
                : null;
            editor.selectGameObject?.(selected);
            editor.setSceneViewState?.(this.editorState.sceneView);
        }
    }

    // Getters
    public getMode(): PlayMode {
        return this.mode;
    }

    public isPlaying(): boolean {
        return this.mode === 'play';
    }

    public isPausedMode(): boolean {
        return this.isPaused;
    }

    public getFrame(): number {
        return this.frame;
    }

    public getTime(): number {
        return this.time;
    }

    public getDeltaTime(): number {
        return this.deltaTime;
    }

    public getTimeScale(): number {
        return this.timeScale;
    }

    public setTimeScale(scale: number): void {
        this.timeScale = Math.max(0, scale);
    }

    public setTargetFrameRate(fps: number): void {
        if (Number.isFinite(fps) && fps > 0) this.targetFrameTime = 1 / fps;
    }

    public restartPlayMode(): void {
        void this.reloadBehaviourScripts();
    }

    public async reloadBehaviourScripts(): Promise<boolean> {
        if (this.mode === 'edit' || !this.runtimeSceneSnapshot || this.scriptReloadInFlight) return false;
        this.scriptReloadInFlight = true;
        try {
            let prepared = this.runtimeSceneSnapshot;
            try {
                if (this.snapshotPreparer) prepared = await this.snapshotPreparer(prepared);
            } catch (cause) {
                const code = typeof (cause as any)?.code === 'string' ? (cause as any).code : 'BEHAVIOUR_SCRIPT_RELOAD_FAILED';
                const message = typeof (cause as any)?.message === 'string' ? (cause as any).message : 'BehaviourScript reload failed.';
                console.error(`[PlayMode] ${code}: ${message}`);
                return false;
            }
            if (this.getMode() === 'edit') return false;

            this.runtimeSceneSnapshot = prepared;
            this.frame = 0;
            this.time = 0;
            this.deltaTime = 0;
            this.isPaused = false;
            this.runtimeError = null;
            this.reportedScriptDiagnostics.clear();
            const scene = SceneManager.getInstance().getActiveScene();
            if (scene) scene.loadFromJSON(prepared);
            this.lastRuntimeUiEvent = null;
            this.lastRuntimeAudioSequence = 0;
            this.lastRuntimeParticleSequence = 0;
            this.lastRuntimeAnimationSequence = 0;
            this.lastRuntimeSpawnSequence = 0;
            this.runtime.restart(prepared);
            (window as any).Editor?.instance?.onRuntimeSceneChanged?.(this.runtimeScenePath || '');
            console.info('[PlayMode] BehaviourScript domain reload completed.');
            return true;
        } catch (cause) {
            const message = typeof (cause as any)?.message === 'string' ? (cause as any).message : String(cause);
            console.error(`[PlayMode] BehaviourScript domain reload could not restart the runtime: ${message}`);
            return false;
        } finally {
            this.scriptReloadInFlight = false;
        }
    }

    public getRuntimeState(): RuntimeState {
        return this.runtime.getState();
    }

    public getRuntimeError(): RuntimeFailure | null {
        return this.runtimeError;
    }

    public getRuntimeScenePath(): string | null {
        return this.runtimeScenePath;
    }

    private handleRuntimeState(state: RuntimeState): void {
        if (state === 'paused') this.isPaused = true;
        if (state === 'running') this.isPaused = false;
    }

    private applyRuntimeFrame(runtimeFrame: RuntimeFrame): void {
        if (this.mode !== 'play') return;
        this.frame = runtimeFrame.frame;
        this.time = runtimeFrame.timeMicros / 1_000_000;
        for (const diagnostic of runtimeFrame.behaviourScripts?.diagnostics || []) {
            const key = `${diagnostic.objectId}\u0000${diagnostic.phase}\u0000${diagnostic.message}`;
            if (this.reportedScriptDiagnostics.has(key)) continue;
            this.reportedScriptDiagnostics.add(key);
            console.error(`[BehaviourScript:${diagnostic.phase}] ${diagnostic.objectId || '(unknown object)'}: ${diagnostic.message}`);
        }
        const scene = SceneManager.getInstance().getActiveScene();
        if (!scene) return;
        for (const command of runtimeFrame.spawnCommands || []) {
            if (!Number.isInteger(command.sequence) || command.sequence <= this.lastRuntimeSpawnSequence) continue;
            const node = command.node as any;
            if (node && typeof node.id === 'string' && !scene.findGameObjectByID(node.id)) {
                const clone = Prefab.instantiateData(node, { preserveIds: true });
                scene.addGameObject(clone);
            }
            this.lastRuntimeSpawnSequence = Math.max(this.lastRuntimeSpawnSequence, command.sequence);
        }
        for (const command of runtimeFrame.audioCommands || []) {
            if (!Number.isInteger(command.sequence) || command.sequence <= this.lastRuntimeAudioSequence) continue;
            const gameObject = scene.findGameObjectByID(command.objectId);
            const source = gameObject?.getComponent<any>('AudioSource');
            if (command.command === 'play') source?.play?.();
            if (command.command === 'stop') source?.stop?.();
            this.lastRuntimeAudioSequence = Math.max(this.lastRuntimeAudioSequence, command.sequence);
        }
        for (const command of runtimeFrame.particleCommands || []) {
            if (!Number.isInteger(command.sequence) || command.sequence <= this.lastRuntimeParticleSequence) continue;
            const gameObject = scene.findGameObjectByID(command.objectId);
            const particles = gameObject?.getComponent<any>('ParticleSystem');
            if (command.command === 'play') particles?.play?.();
            if (command.command === 'stop') particles?.stop?.();
            this.lastRuntimeParticleSequence = Math.max(this.lastRuntimeParticleSequence, command.sequence);
        }
        for (const command of runtimeFrame.animationCommands || []) {
            if (!Number.isInteger(command.sequence) || command.sequence <= this.lastRuntimeAnimationSequence) continue;
            const gameObject = scene.findGameObjectByID(command.objectId);
            const animator = gameObject?.getComponent<any>('Animator');
            if (command.command === 'play' && animator) {
                const clip = command.clip || animator.currentAnimation || animator.animations?.keys?.().next?.().value;
                if (typeof clip === 'string' && clip.length > 0) animator.play?.(clip);
            }
            if (command.command === 'stop') animator?.stop?.();
            this.lastRuntimeAnimationSequence = Math.max(this.lastRuntimeAnimationSequence, command.sequence);
        }
        for (const transformState of runtimeFrame.transforms) {
            const gameObject = scene.findGameObjectByID(transformState.id);
            if (!gameObject) continue;
            if (typeof transformState.active === 'boolean' && gameObject.enabled !== transformState.active) {
                gameObject.setActive(transformState.active);
            }
            gameObject.transform.position.set(...transformState.position);
            gameObject.transform.rotation.set(...transformState.rotation);
            gameObject.transform.scale.set(...transformState.scale);
            gameObject.object3D.updateMatrixWorld(true);
        }
        if (runtimeFrame.lastUiEvent && runtimeFrame.lastUiEvent !== this.lastRuntimeUiEvent) {
            this.lastRuntimeUiEvent = runtimeFrame.lastUiEvent;
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('tugberk-runtime-ui-event', {
                    detail: { name: runtimeFrame.lastUiEvent, value: runtimeFrame.lastUiEventPayload }
                }));
            }
        }
    }

    // Event listeners
    public onPlay(callback: () => void): void {
        this.onPlayCallbacks.push(callback);
    }

    public onPause(callback: () => void): void {
        this.onPauseCallbacks.push(callback);
    }

    public onStop(callback: () => void): void {
        this.onStopCallbacks.push(callback);
    }

    public onFrame(callback: (deltaTime: number) => void): void {
        this.onFrameCallbacks.push(callback);
    }
}
