import { LayerManager } from './LayerManager';

/**
 * ProjectSettings - Unity-style project configuration
 */
export class ProjectSettings {
    // Quality Settings
    public static qualityLevel: number = 2; // 0=Low, 1=Medium, 2=High, 3=Ultra
    public static vSyncCount: number = 1;
    public static antiAliasing: number = 2; // 0, 2, 4, 8
    public static shadowQuality: 'Disable' | 'HardOnly' | 'All' = 'All';
    public static shadowResolution: 'Low' | 'Medium' | 'High' | 'VeryHigh' = 'High';

    // Physics Settings
    public static gravity: number = -9.81;
    public static defaultSolverIterations: number = 6;
    public static defaultSolverVelocityIterations: number = 1;
    public static bounceThreshold: number = 2;
    public static sleepThreshold: number = 0.005;
    public static defaultContactOffset: number = 0.01;

    // Time Settings
    public static fixedDeltaTime: number = 0.02; // 50 FPS
    public static maximumDeltaTime: number = 0.33;
    public static timeScale: number = 1.0;

    // Tags & Layers
    public static tags: string[] = ['Untagged', 'Respawn', 'Finish', 'EditorOnly', 'MainCamera', 'Player', 'GameController'];
    public static layerNames: string[] = [
        'Default', 'TransparentFX', 'Ignore Raycast', '', 'Water', 'UI',
        '', '', 'PostProcessing', '', '', '', '', '', '', '',
        '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''
    ];
    public static layerCollisionMatrix: number[] = new Array(32).fill(0xFFFFFFFF);

    // Input Settings
    public static inputAxes: Map<string, InputAxis> = new Map([
        ['Horizontal', {
            positiveButton: 'd',
            negativeButton: 'a',
            altPositiveButton: 'ArrowRight',
            altNegativeButton: 'ArrowLeft',
            gravity: 3,
            sensitivity: 3,
            snap: true,
            type: 'KeyOrMouseButton'
        }],
        ['Vertical', {
            positiveButton: 'w',
            negativeButton: 's',
            altPositiveButton: 'ArrowUp',
            altNegativeButton: 'ArrowDown',
            gravity: 3,
            sensitivity: 3,
            snap: true,
            type: 'KeyOrMouseButton'
        }],
        ['Fire1', {
            positiveButton: 'mouse0',
            negativeButton: '',
            gravity: 1000,
            sensitivity: 1000,
            snap: false,
            type: 'KeyOrMouseButton'
        }],
        ['Jump', {
            positiveButton: ' ',
            negativeButton: '',
            gravity: 1000,
            sensitivity: 1000,
            snap: false,
            type: 'KeyOrMouseButton'
        }]
    ]);

    // Graphics Settings
    public static targetFrameRate: number = 60;
    public static renderScale: number = 1.0;

    // Audio Settings
    public static masterVolume: number = 1.0;
    public static dopplerFactor: number = 1.0;

    // Save/Load Settings
    public static save(): void {
        this.captureRuntimeLayerSettings();
        const settings = {
            qualityLevel: this.qualityLevel,
            vSyncCount: this.vSyncCount,
            antiAliasing: this.antiAliasing,
            shadowQuality: this.shadowQuality,
            shadowResolution: this.shadowResolution,
            gravity: this.gravity,
            defaultSolverIterations: this.defaultSolverIterations,
            defaultSolverVelocityIterations: this.defaultSolverVelocityIterations,
            bounceThreshold: this.bounceThreshold,
            sleepThreshold: this.sleepThreshold,
            defaultContactOffset: this.defaultContactOffset,
            fixedDeltaTime: this.fixedDeltaTime,
            maximumDeltaTime: this.maximumDeltaTime,
            timeScale: this.timeScale,
            targetFrameRate: this.targetFrameRate,
            renderScale: this.renderScale,
            masterVolume: this.masterVolume,
            dopplerFactor: this.dopplerFactor,
            tags: this.tags,
            layerNames: this.layerNames,
            layerCollisionMatrix: this.layerCollisionMatrix
        };
        localStorage.setItem('tugberkengine_project_settings', JSON.stringify(settings));
    }

    public static load(): void {
        const saved = localStorage.getItem('tugberkengine_project_settings');
        if (saved) {
            const settings = JSON.parse(saved);
            Object.assign(this, settings);
        }
        this.layerNames = this.normalizeLayerNames(this.layerNames);
        this.layerCollisionMatrix = this.normalizeLayerCollisionMatrix(this.layerCollisionMatrix);
        this.applyRuntimeLayerSettings();
    }

    /**
     * Pull current runtime layer settings into ProjectSettings so persistence
     * always reflects the live editor state.
     */
    public static captureRuntimeLayerSettings(): void {
        const runtimeLayers = LayerManager.getInstance().serialize();
        this.layerNames = this.normalizeLayerNames(runtimeLayers.layers);
        this.layerCollisionMatrix = this.normalizeLayerCollisionMatrix(runtimeLayers.collisionMatrix);
    }

    /**
     * Push loaded layer settings back into LayerManager at startup/load time.
     */
    public static applyRuntimeLayerSettings(): void {
        const lm = LayerManager.getInstance();
        lm.deserialize({
            layers: this.layerNames,
            collisionMatrix: this.layerCollisionMatrix
        });
    }

    private static normalizeLayerNames(input: unknown): string[] {
        const names: string[] = new Array(32).fill('');
        if (Array.isArray(input)) {
            for (let i = 0; i < 32; i++) {
                const value = input[i];
                names[i] = typeof value === 'string' ? value : '';
            }
        }
        return names;
    }

    private static normalizeLayerCollisionMatrix(input: unknown): number[] {
        const matrix: number[] = new Array(32).fill(0xFFFFFFFF);
        if (Array.isArray(input)) {
            for (let i = 0; i < 32; i++) {
                const value = input[i];
                if (typeof value === 'number' && Number.isFinite(value)) {
                    matrix[i] = value >>> 0;
                }
            }
        }
        return matrix;
    }
}

export interface InputAxis {
    positiveButton: string;
    negativeButton: string;
    altPositiveButton?: string;
    altNegativeButton?: string;
    gravity: number;
    sensitivity: number;
    snap: boolean;
    type: 'KeyOrMouseButton' | 'MouseMovement' | 'JoystickAxis';
}
