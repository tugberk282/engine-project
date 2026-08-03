/**
 * Play Mode Manager
 * Handles Play/Pause/Stop/Step execution modes and state restoration
 */

import { Scene } from './Scene';
import { SceneManager } from './SceneManager';
import { RuntimeBridge, RuntimeFailure, RuntimeState } from './RuntimeBridge';

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

    private sceneSnapshot: any = null;
    private editorState: any = null;
    private onPlayCallbacks: Array<() => void> = [];
    private onPauseCallbacks: Array<() => void> = [];
    private onStopCallbacks: Array<() => void> = [];
    private onFrameCallbacks: Array<(deltaTime: number) => void> = [];

    private constructor() {
        this.runtime.onStateChange((state) => this.handleRuntimeState(state));
        this.runtime.onError((error) => {
            this.runtimeError = error;
            console.error(`[PlayMode] ${error.code}: ${error.message}`);
            this.exitPlayMode();
        });
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
    public enterPlayMode(): void {
        if (this.mode === 'play') return;

        // Save editor state
        this.saveEditorState();

        // Snapshot current scene
        const scene = SceneManager.getInstance().getActiveScene();
        if (scene) {
            this.sceneSnapshot = this.snapshotScene(scene);
        }

        this.mode = 'play';
        this.frame = 0;
        this.time = 0;
        this.deltaTime = 0;
        this.isPaused = false;
        this.lastFrameTime = performance.now() / 1000;

        this.runtimeError = null;
        if (this.sceneSnapshot) this.runtime.start(this.sceneSnapshot);

        // Trigger callbacks
        this.onPlayCallbacks.forEach(cb => cb());

        console.log('[PlayMode] Entered Play Mode');
    }

    /**
     * Exit Play Mode
     * Restores scene to pre-play state
     */
    public exitPlayMode(): void {
        if (this.mode === 'edit') return;

        this.runtime.stop();

        // Restore scene from snapshot
        if (this.sceneSnapshot) {
            this.restoreScene(this.sceneSnapshot);
            this.sceneSnapshot = null;
        }

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
        if (this.mode !== 'play' || !this.isPaused) return;

        this.updateFrame(this.targetFrameTime);
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
        this.time += delta;
        this.frame++;

        this.runtime.tick(delta);

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
                selectedGameObject: editor.selectedGameObject,
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
            editor.selectGameObject?.(this.editorState.selectedGameObject);
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
        if (this.mode === 'edit' || !this.sceneSnapshot) return;
        this.frame = 0;
        this.time = 0;
        this.deltaTime = 0;
        this.isPaused = false;
        this.runtimeError = null;
        this.runtime.restart(this.sceneSnapshot);
    }

    public getRuntimeState(): RuntimeState {
        return this.runtime.getState();
    }

    public getRuntimeError(): RuntimeFailure | null {
        return this.runtimeError;
    }

    private handleRuntimeState(state: RuntimeState): void {
        if (state === 'paused') this.isPaused = true;
        if (state === 'running') this.isPaused = false;
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
