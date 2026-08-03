import { GameObject } from './GameObject';
import * as THREE from 'three';
import { PhysicsSystem } from './PhysicsSystem';
import { ScriptRegistry } from './ScriptRegistry';
import { AssetDatabase } from './AssetDatabase';
import { ProjectSettings } from './ProjectSettings';
import { Time } from './Time';
import { CoroutineManager } from './CoroutineManager';
import {
    normalizeSceneData,
    resolveSerializedReferences,
    SCENE_FORMAT_VERSION,
    SCENE_SCHEMA_VERSION,
    stableStringify,
    SerializedSceneEnvironment,
    SerializedGameObjectData,
    SerializedComponentData,
    mergePreservingUnknown
} from './Serialization';

export class Scene {
    public sceneId: string;
    public name: string = 'Untitled';
    public threeScene: THREE.Scene;
    public gameObjects: GameObject[] = [];

    // Environment Settings
    public ambientColor: string = "#ffffff";
    public ambientIntensity: number = 0.5;
    public backgroundColor: string = "#222222";
    public skyboxPath: string | null = null;

    // Post-Processing
    public enableBloom: boolean = false;
    public bloomStrength: number = 1.5;
    public bloomThreshold: number = 0.4;
    public bloomRadius: number = 0.85;

    // SSAO Settings
    public enableSSAO: boolean = false;
    public ssaoRadius: number = 16;
    public ssaoMinDistance: number = 0.005;
    public ssaoMaxDistance: number = 0.1;
    public ssaoLumInfluence: number = 0.9;

    // Fog Settings
    public enableFog: boolean = false;
    public fogColor: string = "#cccccc";
    public fogNear: number = 1;
    public fogFar: number = 50;
    public fogDensity: number = 0.02;
    public fogMode: 'Linear' | 'Exp2' = 'Linear';

    // Tone Mapping Settings
    public toneMapping: string = 'None';
    public toneMappingExposure: number = 1.0;

    // Advanced Post-Processing
    public enableVignette: boolean = false;
    public vignetteIntensity: number = 1.0;
    public vignetteOffset: number = 1.0;

    public enableChromaticAberration: boolean = false;
    public chromaticIntensity: number = 1.0;

    public enableFilmGrain: boolean = false;
    public filmGrainIntensity: number = 0.5;

    private ambientLight: THREE.AmbientLight;
    private isLoadingFromSerializedData: boolean = false;
    private serializedTemplate: Record<string, unknown> | null = null;

    constructor() {
        this.sceneId = globalThis.crypto?.randomUUID?.()
            ?? `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        this.threeScene = new THREE.Scene();
        this.threeScene.background = new THREE.Color(this.backgroundColor);

        // Basic Light
        this.ambientLight = new THREE.AmbientLight(this.ambientColor, this.ambientIntensity);
        this.threeScene.add(this.ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(5, 10, 7.5);
        this.threeScene.add(directionalLight);

        // Add Grid & Axes Helpers
        const gridHelper = new THREE.GridHelper(100, 100);
        this.threeScene.add(gridHelper);

        const axesHelper = new THREE.AxesHelper(5);
        this.threeScene.add(axesHelper);

        // Ensure Physics System is created
        PhysicsSystem.getInstance();
    }

    public updateEnvironment(): void {
        this.threeScene.background = new THREE.Color(this.backgroundColor);
        this.ambientLight.color.set(this.ambientColor);
        this.ambientLight.intensity = this.ambientIntensity;

        if (this.skyboxPath) {
            const loader = new THREE.CubeTextureLoader();
            const textures = ['px.jpg', 'nx.jpg', 'py.jpg', 'ny.jpg', 'pz.jpg', 'nz.jpg'];
            loader.setPath(this.skyboxPath + '/');
            loader.load(textures, (texture) => {
                this.threeScene.background = texture;
                this.threeScene.environment = texture;
            });
        }

        // Apply Fog
        if (this.enableFog) {
            if (this.fogMode === 'Linear') {
                this.threeScene.fog = new THREE.Fog(this.fogColor, this.fogNear, this.fogFar);
            } else {
                this.threeScene.fog = new THREE.FogExp2(this.fogColor, this.fogDensity);
            }
        } else {
            this.threeScene.fog = null;
        }
    }

    public addGameObject(go: GameObject, options?: { start?: boolean }) {
        const hierarchy = this.collectHierarchy(go);
        hierarchy.forEach((node) => {
            node.scene = this;
            if (!this.gameObjects.includes(node)) {
                this.gameObjects.push(node);
            }
        });

        if (!go.object3D.parent) {
            this.threeScene.add(go.object3D);
        }

        const shouldStart = options?.start ?? !this.isLoadingFromSerializedData;
        if (shouldStart) {
            hierarchy.forEach((node) => {
                node.flushPendingLifecycle(false);
                node.start();
            });
        }
    }

    public removeGameObject(go: GameObject, options?: { destroy?: boolean }) {
        const index = this.gameObjects.indexOf(go);
        if (index > -1) {
            const shouldDestroy = options?.destroy ?? true;
            const hierarchy = this.collectHierarchy(go);
            if (!shouldDestroy && go.transform.parent) {
                go.transform.setParent(null, true);
            }
            if (shouldDestroy) {
                go.onDestroy();
            }
            hierarchy.forEach((node) => {
                const nodeIndex = this.gameObjects.indexOf(node);
                if (nodeIndex > -1) {
                    this.gameObjects.splice(nodeIndex, 1);
                }
                node.scene = null;
            });
            if (shouldDestroy) {
                hierarchy.forEach((node) => node.object3D.removeFromParent());
            } else {
                go.object3D.removeFromParent();
            }
            return;
        }
        go.object3D.removeFromParent();
    }

    public findGameObjectByID(id: string): GameObject | undefined {
        return this.gameObjects.find((go) => go.id === id);
    }

    private accumulator: number = 0;
    private fixedDeltaTime: number = 1 / 50;

    public update(deltaTime: number) {
        const configuredFixedDelta = Math.max(0.0001, Number.isFinite(ProjectSettings.fixedDeltaTime) ? ProjectSettings.fixedDeltaTime : 0.02);
        const configuredMaxDelta = Math.max(configuredFixedDelta, Number.isFinite(ProjectSettings.maximumDeltaTime) ? ProjectSettings.maximumDeltaTime : 0.33);
        const configuredTimeScale = Math.max(0, Number.isFinite(ProjectSettings.timeScale) ? ProjectSettings.timeScale : 1);
        const boundedDelta = Math.min(Math.max(0, deltaTime), configuredMaxDelta);
        const scaledDelta = boundedDelta * configuredTimeScale;
        this.fixedDeltaTime = configuredFixedDelta;
        this.accumulator += scaledDelta;

        // Prevent a spiral-of-death when frame stalls are extreme.
        const maxFixedSteps = Math.max(1, Math.ceil(configuredMaxDelta / configuredFixedDelta) * 2);
        let fixedStepCount = 0;
        while (this.accumulator >= this.fixedDeltaTime && fixedStepCount < maxFixedSteps) {
            PhysicsSystem.getInstance().update(this.fixedDeltaTime, this.fixedDeltaTime);
            for (const go of this.gameObjects) {
                go.fixedUpdate(this.fixedDeltaTime);
            }
            CoroutineManager.getInstance().updateFixed();
            this.accumulator -= this.fixedDeltaTime;
            fixedStepCount += 1;
        }

        if (fixedStepCount >= maxFixedSteps) {
            this.accumulator = 0;
        }

        Time.advanceRuntime(scaledDelta, boundedDelta);

        for (const go of this.gameObjects) {
            go.update(scaledDelta);
        }

        CoroutineManager.getInstance().update(scaledDelta);

        for (const go of this.gameObjects) {
            go.lateUpdate();
        }

        CoroutineManager.getInstance().updateEndOfFrame();
    }

    public toJSON(): string {
        const roots = this.getRootGameObjectsInHierarchyOrder();
        const data = {
            formatVersion: SCENE_FORMAT_VERSION,
            sceneId: this.sceneId,
            name: this.name,
            version: SCENE_SCHEMA_VERSION,
            environment: this.serializeEnvironmentSettings(),
            gameObjects: roots.map(go => go.serialize())
        };
        return stableStringify(mergePreservingUnknown(this.serializedTemplate, data), 2);
    }

    public loadFromJSON(json: string): void {
        let parsed: unknown;
        try {
            parsed = JSON.parse(json);
        } catch (error) {
            console.error('Scene JSON parse failed:', error);
            return;
        }

        const data = normalizeSceneData(parsed);
        this.serializedTemplate = data;
        if (data.sceneId) this.sceneId = data.sceneId;
        this.name = data.name;
        this.applySerializedEnvironment(data.environment);
        this.isLoadingFromSerializedData = true;
        try {
            // Clear existing scene
            const toRemove = [...this.gameObjects];
            toRemove.forEach(go => this.removeGameObject(go));

            // First Pass: Reconstruct all GameObjects and Components
            const idMap = new Map<string, GameObject>();
            const pendingComponentData: Array<{
                component: any;
                data: Record<string, unknown>;
                template: SerializedComponentData;
            }> = [];
            const deserializeGameObject = (goData: SerializedGameObjectData, parent: GameObject | null = null): GameObject => {
                const go = new GameObject(goData.name);
                go.id = goData.id;
                go.tag = goData.tag;
                go.layer = goData.layer;
                go.isStatic = goData.isStatic;
                go.enabled = goData.enabled;
                go.prefabSource = goData.prefabSource;
                const resolvedSourcePath = goData.sourceAssetGuid
                    ? AssetDatabase.getInstance().getPath(goData.sourceAssetGuid) ?? goData.sourceAssetPath
                    : goData.sourceAssetPath;
                go.sourceAssetPath = resolvedSourcePath;
                go.sourceAssetGuid = goData.sourceAssetGuid;
                go.sourceAssetType = goData.sourceAssetType;
                idMap.set(go.id, go);

                // Restore Transform
                go.transform.position.fromArray(goData.transform.position);
                go.transform.rotation.set(goData.transform.rotation[0], goData.transform.rotation[1], goData.transform.rotation[2]);
                go.transform.scale.fromArray(goData.transform.scale);

                // Restore Components
                const unknownComponents: SerializedComponentData[] = [];
                goData.components.forEach((compData: SerializedComponentData) => {
                    const ComponentClass = ScriptRegistry.getComponentClass(compData.type);
                    if (ComponentClass) {
                        const comp = go.addComponent(ComponentClass, { invokeLifecycle: false });
                        pendingComponentData.push({
                            component: comp,
                            data: compData.data,
                            template: compData
                        });
                    } else {
                        unknownComponents.push(compData);
                    }
                });
                go.preserveSerializedData(goData, unknownComponents);

                this.addGameObject(go, { start: false });
                go.setActive(go.enabled);
                if (parent) go.transform.setParent(parent.transform, false);

                goData.children.forEach((childData) => deserializeGameObject(childData, go));
                return go;
            };

            data.gameObjects.forEach((goData) => deserializeGameObject(goData));

            // Second Pass: Resolve references
            pendingComponentData.forEach((entry) => {
                entry.component.preserveSerializedData?.(entry.template);
                const resolvedData = resolveSerializedReferences(entry.data, idMap);
                const resolvedObject = (resolvedData && typeof resolvedData === 'object' && !Array.isArray(resolvedData))
                    ? resolvedData as Record<string, unknown>
                    : {};
                if (entry.component.deserialize) {
                    entry.component.deserialize(resolvedObject);
                    return;
                }

                for (const [key, value] of Object.entries(resolvedObject)) {
                    entry.component[key] = value;
                }
            });

            this.gameObjects.forEach((go) => go.flushPendingLifecycle(false));
            this.gameObjects.forEach((go) => go.start());
            console.log(`Scene loaded with reference resolution (schema ${data.version}).`);
        } finally {
            this.isLoadingFromSerializedData = false;
        }
    }

    private serializeEnvironmentSettings(): SerializedSceneEnvironment {
        return {
            ambientColor: this.ambientColor,
            ambientIntensity: this.ambientIntensity,
            backgroundColor: this.backgroundColor,
            skyboxPath: this.skyboxPath,
            bloom: {
                enabled: this.enableBloom,
                strength: this.bloomStrength,
                threshold: this.bloomThreshold,
                radius: this.bloomRadius
            },
            ssao: {
                enabled: this.enableSSAO,
                radius: this.ssaoRadius,
                minDistance: this.ssaoMinDistance,
                maxDistance: this.ssaoMaxDistance,
                lumInfluence: this.ssaoLumInfluence
            },
            fog: {
                enabled: this.enableFog,
                color: this.fogColor,
                near: this.fogNear,
                far: this.fogFar,
                density: this.fogDensity,
                mode: this.fogMode
            },
            toneMapping: {
                mode: this.toneMapping,
                exposure: this.toneMappingExposure
            },
            postProcessing: {
                vignette: {
                    enabled: this.enableVignette,
                    intensity: this.vignetteIntensity,
                    offset: this.vignetteOffset
                },
                chromaticAberration: {
                    enabled: this.enableChromaticAberration,
                    intensity: this.chromaticIntensity
                },
                filmGrain: {
                    enabled: this.enableFilmGrain,
                    intensity: this.filmGrainIntensity
                }
            }
        };
    }

    private collectHierarchy(root: GameObject): GameObject[] {
        const nodes: GameObject[] = [];
        const walk = (node: GameObject) => {
            nodes.push(node);
            node.transform.children.forEach((child) => walk(child.gameObject));
        };
        walk(root);
        return nodes;
    }

    private getRootGameObjectsInHierarchyOrder(): GameObject[] {
        const roots = this.gameObjects.filter((go) => go.transform.parent === null);
        const remaining = new Set(roots);
        const ordered: GameObject[] = [];

        this.threeScene.children.forEach((child) => {
            const candidate = child.userData?.gameObject as GameObject | undefined;
            if (!candidate || !remaining.has(candidate)) return;
            ordered.push(candidate);
            remaining.delete(candidate);
        });

        remaining.forEach((go) => ordered.push(go));
        return ordered;
    }

    private applySerializedEnvironment(environment: SerializedSceneEnvironment): void {
        this.ambientColor = environment.ambientColor;
        this.ambientIntensity = environment.ambientIntensity;
        this.backgroundColor = environment.backgroundColor;
        this.skyboxPath = environment.skyboxPath;

        this.enableBloom = environment.bloom.enabled;
        this.bloomStrength = environment.bloom.strength;
        this.bloomThreshold = environment.bloom.threshold;
        this.bloomRadius = environment.bloom.radius;

        this.enableSSAO = environment.ssao.enabled;
        this.ssaoRadius = environment.ssao.radius;
        this.ssaoMinDistance = environment.ssao.minDistance;
        this.ssaoMaxDistance = environment.ssao.maxDistance;
        this.ssaoLumInfluence = environment.ssao.lumInfluence;

        this.enableFog = environment.fog.enabled;
        this.fogColor = environment.fog.color;
        this.fogNear = environment.fog.near;
        this.fogFar = environment.fog.far;
        this.fogDensity = environment.fog.density;
        this.fogMode = environment.fog.mode;

        this.toneMapping = environment.toneMapping.mode;
        this.toneMappingExposure = environment.toneMapping.exposure;

        this.enableVignette = environment.postProcessing.vignette.enabled;
        this.vignetteIntensity = environment.postProcessing.vignette.intensity;
        this.vignetteOffset = environment.postProcessing.vignette.offset;

        this.enableChromaticAberration = environment.postProcessing.chromaticAberration.enabled;
        this.chromaticIntensity = environment.postProcessing.chromaticAberration.intensity;

        this.enableFilmGrain = environment.postProcessing.filmGrain.enabled;
        this.filmGrainIntensity = environment.postProcessing.filmGrain.intensity;

        this.updateEnvironment();
    }
}
