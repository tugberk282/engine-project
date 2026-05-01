export const SCENE_SCHEMA_VERSION = '1.4';
export const PREFAB_SCHEMA_VERSION = '1.2';

export type SourceAssetType = 'prefab' | 'model' | null;

export interface SerializedReferenceData {
    __ref: string;
    __type: 'GameObject' | 'Component';
    __comp?: string;
}

export interface SerializedComponentData {
    type: string;
    data: Record<string, unknown>;
}

export interface SerializedTransformData {
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
}

export interface SerializedGameObjectData {
    id: string;
    name: string;
    tag: string;
    layer: number;
    isStatic: boolean;
    enabled: boolean;
    prefabSource: string | null;
    sourceAssetPath: string | null;
    sourceAssetGuid: string | null;
    sourceAssetType: SourceAssetType;
    transform: SerializedTransformData;
    components: SerializedComponentData[];
    children: SerializedGameObjectData[];
}

export interface SerializedSceneEnvironment {
    ambientColor: string;
    ambientIntensity: number;
    backgroundColor: string;
    skyboxPath: string | null;
    bloom: {
        enabled: boolean;
        strength: number;
        threshold: number;
        radius: number;
    };
    ssao: {
        enabled: boolean;
        radius: number;
        minDistance: number;
        maxDistance: number;
        lumInfluence: number;
    };
    fog: {
        enabled: boolean;
        color: string;
        near: number;
        far: number;
        density: number;
        mode: 'Linear' | 'Exp2';
    };
    toneMapping: {
        mode: string;
        exposure: number;
    };
    postProcessing: {
        vignette: {
            enabled: boolean;
            intensity: number;
            offset: number;
        };
        chromaticAberration: {
            enabled: boolean;
            intensity: number;
        };
        filmGrain: {
            enabled: boolean;
            intensity: number;
        };
    };
}

export interface SerializedSceneData {
    version: string;
    environment: SerializedSceneEnvironment;
    gameObjects: SerializedGameObjectData[];
}

export interface SerializedPrefabData {
    version: string;
    name: string;
    data: SerializedGameObjectData;
}

function asObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function asString(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asInteger(value: unknown, fallback: number): number {
    const next = asNumber(value, fallback);
    return Math.trunc(next);
}

function asVector3(value: unknown, fallback: [number, number, number]): [number, number, number] {
    if (Array.isArray(value) && value.length >= 3) {
        const x = asNumber(value[0], fallback[0]);
        const y = asNumber(value[1], fallback[1]);
        const z = asNumber(value[2], fallback[2]);
        return [x, y, z];
    }
    return fallback;
}

function normalizeSourceAssetType(value: unknown): SourceAssetType {
    if (value === 'prefab' || value === 'model') return value;
    return null;
}

function normalizeReference(value: Record<string, unknown>): SerializedReferenceData | null {
    const ref = value.__ref;
    const type = value.__type;
    if (typeof ref !== 'string') return null;
    if (type !== 'GameObject' && type !== 'Component') return null;
    const normalized: SerializedReferenceData = {
        __ref: ref,
        __type: type
    };
    if (type === 'Component' && typeof value.__comp === 'string' && value.__comp.length > 0) {
        normalized.__comp = value.__comp;
    }
    return normalized;
}

function normalizeArbitraryData(value: unknown): unknown {
    if (value === null) return null;

    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => normalizeArbitraryData(entry));
    }

    const objectValue = asObject(value);
    if (!objectValue) return null;

    const reference = normalizeReference(objectValue);
    if (reference) {
        return reference;
    }

    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(objectValue)) {
        const normalizedEntry = normalizeArbitraryData(entry);
        if (normalizedEntry !== undefined) {
            normalized[key] = normalizedEntry;
        }
    }
    return normalized;
}

function normalizeComponent(componentValue: unknown): SerializedComponentData | null {
    const componentObject = asObject(componentValue);
    if (!componentObject) return null;

    const type = asString(componentObject.type, '');
    if (!type) return null;

    const rawData = asObject(componentObject.data) ?? {};
    const normalizedData = normalizeArbitraryData(rawData);
    const normalizedObject = asObject(normalizedData) ?? {};
    return {
        type,
        data: normalizedObject
    };
}

export function normalizeSerializedGameObject(data: unknown, fallbackName: string = 'GameObject'): SerializedGameObjectData {
    const objectData = asObject(data) ?? {};
    const transformData = asObject(objectData.transform) ?? {};
    const componentsData = Array.isArray(objectData.components) ? objectData.components : [];
    const childrenData = Array.isArray(objectData.children) ? objectData.children : [];

    const components = componentsData
        .map((entry) => normalizeComponent(entry))
        .filter((entry): entry is SerializedComponentData => entry !== null);

    const children = childrenData.map((entry) => normalizeSerializedGameObject(entry));
    const id = asString(objectData.id, crypto.randomUUID());

    return {
        id,
        name: asString(objectData.name, fallbackName),
        tag: asString(objectData.tag, 'Untagged'),
        layer: asInteger(objectData.layer, 0),
        isStatic: asBoolean(objectData.isStatic, false),
        enabled: asBoolean(objectData.enabled, true),
        prefabSource: asNullableString(objectData.prefabSource),
        sourceAssetPath: asNullableString(objectData.sourceAssetPath),
        sourceAssetGuid: asNullableString(objectData.sourceAssetGuid),
        sourceAssetType: normalizeSourceAssetType(objectData.sourceAssetType),
        transform: {
            position: asVector3(transformData.position, [0, 0, 0]),
            rotation: asVector3(transformData.rotation, [0, 0, 0]),
            scale: asVector3(transformData.scale, [1, 1, 1])
        },
        components,
        children
    };
}

export function normalizeSceneData(data: unknown): SerializedSceneData {
    const sceneObject = asObject(data) ?? {};
    const environmentObject = asObject(sceneObject.environment) ?? {};

    const bloomObject = asObject(environmentObject.bloom) ?? {};
    const ssaoObject = asObject(environmentObject.ssao) ?? {};
    const fogObject = asObject(environmentObject.fog) ?? {};
    const toneMappingObject = asObject(environmentObject.toneMapping) ?? {};
    const postObject = asObject(environmentObject.postProcessing) ?? {};
    const vignetteObject = asObject(postObject.vignette) ?? {};
    const chromaticObject = asObject(postObject.chromaticAberration) ?? {};
    const grainObject = asObject(postObject.filmGrain) ?? {};

    const roots = Array.isArray(sceneObject.gameObjects) ? sceneObject.gameObjects : [];

    return {
        version: asString(sceneObject.version, SCENE_SCHEMA_VERSION),
        environment: {
            ambientColor: asString(environmentObject.ambientColor, '#ffffff'),
            ambientIntensity: asNumber(environmentObject.ambientIntensity, 0.5),
            backgroundColor: asString(environmentObject.backgroundColor, '#222222'),
            skyboxPath: asNullableString(environmentObject.skyboxPath),
            bloom: {
                enabled: asBoolean(bloomObject.enabled, false),
                strength: asNumber(bloomObject.strength, 1.5),
                threshold: asNumber(bloomObject.threshold, 0.4),
                radius: asNumber(bloomObject.radius, 0.85)
            },
            ssao: {
                enabled: asBoolean(ssaoObject.enabled, false),
                radius: asNumber(ssaoObject.radius, 16),
                minDistance: asNumber(ssaoObject.minDistance, 0.005),
                maxDistance: asNumber(ssaoObject.maxDistance, 0.1),
                lumInfluence: asNumber(ssaoObject.lumInfluence, 0.9)
            },
            fog: {
                enabled: asBoolean(fogObject.enabled, false),
                color: asString(fogObject.color, '#cccccc'),
                near: asNumber(fogObject.near, 1),
                far: asNumber(fogObject.far, 50),
                density: asNumber(fogObject.density, 0.02),
                mode: fogObject.mode === 'Exp2' ? 'Exp2' : 'Linear'
            },
            toneMapping: {
                mode: asString(toneMappingObject.mode, 'None'),
                exposure: asNumber(toneMappingObject.exposure, 1)
            },
            postProcessing: {
                vignette: {
                    enabled: asBoolean(vignetteObject.enabled, false),
                    intensity: asNumber(vignetteObject.intensity, 1),
                    offset: asNumber(vignetteObject.offset, 1)
                },
                chromaticAberration: {
                    enabled: asBoolean(chromaticObject.enabled, false),
                    intensity: asNumber(chromaticObject.intensity, 1)
                },
                filmGrain: {
                    enabled: asBoolean(grainObject.enabled, false),
                    intensity: asNumber(grainObject.intensity, 0.5)
                }
            }
        },
        gameObjects: roots.map((root) => normalizeSerializedGameObject(root, 'GameObject'))
    };
}

export function normalizePrefabData(data: unknown): SerializedPrefabData {
    const objectData = asObject(data);

    if (!objectData) {
        const fallbackRoot = normalizeSerializedGameObject({}, 'PrefabRoot');
        return {
            version: PREFAB_SCHEMA_VERSION,
            name: 'Prefab',
            data: fallbackRoot
        };
    }

    if (objectData.data) {
        return {
            version: asString(objectData.version, PREFAB_SCHEMA_VERSION),
            name: asString(objectData.name, 'Prefab'),
            data: normalizeSerializedGameObject(objectData.data, 'PrefabRoot')
        };
    }

    const singleRoot = normalizeSerializedGameObject(objectData, 'PrefabRoot');
    return {
        version: PREFAB_SCHEMA_VERSION,
        name: asString(objectData.name, singleRoot.name || 'Prefab'),
        data: singleRoot
    };
}

export function resolveSerializedReferences<TGameObject extends { components: unknown[] }>(
    value: unknown,
    idMap: Map<string, TGameObject>
): unknown {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => resolveSerializedReferences(entry, idMap));
    }

    const objectValue = value as Record<string, unknown>;
    const reference = normalizeReference(objectValue);
    if (reference) {
        const targetGameObject = idMap.get(reference.__ref);
        if (!targetGameObject) return null;
        if (reference.__type === 'GameObject') return targetGameObject;
        if (reference.__type === 'Component' && reference.__comp) {
            const component = targetGameObject.components.find((entry) => {
                const ctor = (entry as { constructor?: { name?: string } }).constructor;
                return ctor?.name === reference.__comp;
            });
            return component ?? null;
        }
        return null;
    }

    const resolvedObject: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(objectValue)) {
        resolvedObject[key] = resolveSerializedReferences(entry, idMap);
    }
    return resolvedObject;
}

function sortKeysRecursively(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => sortKeysRecursively(entry));
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    const objectValue = value as Record<string, unknown>;
    const sortedObject: Record<string, unknown> = {};
    for (const key of Object.keys(objectValue).sort()) {
        sortedObject[key] = sortKeysRecursively(objectValue[key]);
    }
    return sortedObject;
}

export function stableStringify(value: unknown, indent: number = 2): string {
    return JSON.stringify(sortKeysRecursively(value), null, indent);
}
