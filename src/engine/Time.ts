/**
 * Time System
 * Static time properties accessible from scripts
 */

import { ProjectSettings } from './ProjectSettings';

export class Time {
    private static runtimeTime: number = 0;
    private static runtimeDeltaTime: number = 0;
    private static runtimeFrameCount: number = 0;
    private static runtimeUnscaledTime: number = 0;
    private static runtimeUnscaledDeltaTime: number = 0;

    /**
     * Time elapsed since play started (in seconds)
     */
    public static get time(): number {
        return this.runtimeTime;
    }

    /**
     * Time delta for current frame (in seconds)
     */
    public static get deltaTime(): number {
        return this.runtimeDeltaTime;
    }

    /**
     * Unscaled time elapsed since play started (ignores timeScale).
     */
    public static get unscaledTime(): number {
        return this.runtimeUnscaledTime;
    }

    /**
     * Unscaled frame delta (ignores timeScale).
     */
    public static get unscaledDeltaTime(): number {
        return this.runtimeUnscaledDeltaTime;
    }

    /**
     * Current frame count since play start
     */
    public static get frameCount(): number {
        return this.runtimeFrameCount;
    }

    /**
     * Time scale (0-N, affects deltaTime)
     */
    public static get timeScale(): number {
        return ProjectSettings.timeScale;
    }

    public static set timeScale(scale: number) {
        ProjectSettings.timeScale = Math.max(0, Number.isFinite(scale) ? scale : ProjectSettings.timeScale);
    }

    /**
     * Real time in milliseconds
     */
    public static get realtimeSinceStartup(): number {
        return performance.now() / 1000;
    }

    /**
     * Fixed deltaTime for physics (default 0.02 = 50 FPS)
     */
    public static get fixedDeltaTime(): number {
        return ProjectSettings.fixedDeltaTime;
    }

    public static set fixedDeltaTime(value: number) {
        ProjectSettings.fixedDeltaTime = Math.max(0.0001, Number.isFinite(value) ? value : ProjectSettings.fixedDeltaTime);
    }

    /**
     * Maximum allowed deltaTime to prevent large jumps
     */
    public static get maximumDeltaTime(): number {
        return ProjectSettings.maximumDeltaTime;
    }

    public static set maximumDeltaTime(value: number) {
        ProjectSettings.maximumDeltaTime = Math.max(this.fixedDeltaTime, Number.isFinite(value) ? value : ProjectSettings.maximumDeltaTime);
    }

    public static resetRuntime(): void {
        this.runtimeTime = 0;
        this.runtimeDeltaTime = 0;
        this.runtimeFrameCount = 0;
        this.runtimeUnscaledTime = 0;
        this.runtimeUnscaledDeltaTime = 0;
    }

    public static advanceRuntime(deltaTime: number, unscaledDeltaTime?: number): void {
        const safeScaledDelta = Math.max(0, Number.isFinite(deltaTime) ? deltaTime : 0);
        const safeUnscaledDelta = Math.max(
            0,
            Number.isFinite(unscaledDeltaTime) ? (unscaledDeltaTime as number) : safeScaledDelta
        );

        this.runtimeDeltaTime = safeScaledDelta;
        this.runtimeTime += safeScaledDelta;
        this.runtimeUnscaledDeltaTime = safeUnscaledDelta;
        this.runtimeUnscaledTime += safeUnscaledDelta;
        this.runtimeFrameCount += 1;
    }
}
