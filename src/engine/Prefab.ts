import { GameObject } from './GameObject';
import { ScriptRegistry } from './ScriptRegistry';
import { AssetDatabase } from './AssetDatabase';
import {
    normalizePrefabData,
    normalizeSerializedGameObject,
    PREFAB_FORMAT_VERSION,
    PREFAB_SCHEMA_VERSION,
    resolveSerializedReferences,
    stableStringify,
    SerializedGameObjectData,
    SerializedComponentData
} from './Serialization';
import { DesktopBridge } from '../platform/DesktopBridge';
import { DesktopFileSystem } from '../platform/DesktopFileSystem';
import { PathUtils } from '../platform/PathUtils';

/**
 * Prefab - Reusable GameObject template (Unity-style)
 */
export class Prefab {
    public name: string;
    public sourcePath: string | null = null;
    private data: any;
    private prefabId: string;
    private schemaVersion: string = PREFAB_SCHEMA_VERSION;

    constructor(name: string, gameObject: GameObject) {
        this.name = name;
        this.prefabId = crypto.randomUUID();
        this.data = normalizeSerializedGameObject(gameObject.serialize(), gameObject.name);
    }

    /**
     * Create a new instance of this prefab
     */
    public instantiate(): GameObject {
        const go = Prefab.instantiateData(this.data);
        go.prefabSource = this.name !== 'temp' ? this.name : null;
        go.sourceAssetPath = this.sourcePath;
        go.sourceAssetGuid = this.sourcePath ? (AssetDatabase.getInstance().getGuid(this.sourcePath) ?? go.sourceAssetGuid) : null;
        go.sourceAssetType = this.sourcePath ? 'prefab' : null;
        return go;
    }

    /**
     * Recursively create a GameObject from serialized data
     */
    public static instantiateData(data: any, options?: { externalIdMap?: Map<string, GameObject> }): GameObject {
        const roots = this.instantiateManyData([data], options);
        return roots[0] ?? new GameObject('GameObject');
    }

    public static instantiateManyData(dataList: any[], options?: { externalIdMap?: Map<string, GameObject> }): GameObject[] {
        const idMap = options?.externalIdMap ?? new Map<string, GameObject>();
        const pendingComponents: Array<{
            component: any;
            data: Record<string, unknown>;
            template: SerializedComponentData;
        }> = [];
        const instantiated: GameObject[] = [];
        const roots: GameObject[] = [];

        dataList.forEach((rawData) => {
            const normalizedRoot = normalizeSerializedGameObject(rawData);
            const root = this.instantiateNode(normalizedRoot, null, idMap, pendingComponents, instantiated);
            roots.push(root);
        });

        this.resolvePendingComponentData(idMap, pendingComponents);
        instantiated.forEach((go) => go.flushPendingLifecycle(false));
        return roots;
    }

    /**
     * Serialize prefab to JSON
     */
    public toJSON(): string {
        return stableStringify({
            formatVersion: PREFAB_FORMAT_VERSION,
            prefabId: this.prefabId,
            version: this.schemaVersion,
            name: this.name,
            data: this.data
        }, 2);
    }

    /**
     * Load prefab from JSON
     */
    public static fromJSON(json: string): Prefab {
        try {
            const parsed = JSON.parse(json);
            const normalized = normalizePrefabData(parsed);
            return this.createFromData(normalized.name, normalized.data, normalized.version, normalized.prefabId);
        } catch (error) {
            console.error('Failed to parse prefab JSON. Falling back to empty prefab root.', error);
            const fallback = normalizePrefabData(null);
            return this.createFromData(fallback.name, fallback.data, fallback.version, fallback.prefabId);
        }
    }

    private static createFromData(name: string, data: SerializedGameObjectData, schemaVersion: string, prefabId: string): Prefab {
        const prefab = Object.create(Prefab.prototype) as Prefab;
        prefab.name = name;
        prefab.sourcePath = null;
        prefab.data = data;
        prefab.prefabId = prefabId;
        prefab.schemaVersion = schemaVersion;
        return prefab;
    }

    private static instantiateNode(
        data: SerializedGameObjectData,
        parent: GameObject | null,
        idMap: Map<string, GameObject>,
        pendingComponents: Array<{
            component: any;
            data: Record<string, unknown>;
            template: SerializedComponentData;
        }>,
        instantiated: GameObject[]
    ): GameObject {
        const go = new GameObject(data.name);
        go.id = crypto.randomUUID();
        go.tag = data.tag;
        go.layer = data.layer;
        go.enabled = data.enabled;
        go.prefabSource = data.prefabSource;
        const resolvedSourcePath = data.sourceAssetGuid
            ? AssetDatabase.getInstance().getPath(data.sourceAssetGuid) ?? data.sourceAssetPath
            : data.sourceAssetPath;
        go.sourceAssetPath = resolvedSourcePath;
        go.sourceAssetGuid = data.sourceAssetGuid;
        go.sourceAssetType = data.sourceAssetType;

        idMap.set(data.id, go);
        instantiated.push(go);

        go.transform.position.fromArray(data.transform.position);
        go.transform.rotation.set(
            data.transform.rotation[0],
            data.transform.rotation[1],
            data.transform.rotation[2]
        );
        go.transform.scale.fromArray(data.transform.scale);

        const unknownComponents: SerializedComponentData[] = [];
        data.components.forEach((componentData: SerializedComponentData) => {
            const ComponentClass = ScriptRegistry.getComponentClass(componentData.type);
            if (!ComponentClass) {
                unknownComponents.push(componentData);
                return;
            }
            const component = go.addComponent(ComponentClass, { invokeLifecycle: false });
            pendingComponents.push({
                component,
                data: componentData.data,
                template: componentData
            });
        });
        go.preserveSerializedData(data, unknownComponents);

        if (parent) {
            go.transform.setParent(parent.transform, false);
        }

        data.children.forEach((childData) => {
            this.instantiateNode(childData, go, idMap, pendingComponents, instantiated);
        });

        go.setActive(go.enabled);
        return go;
    }

    private static resolvePendingComponentData(
        idMap: Map<string, GameObject>,
        pendingComponents: Array<{
            component: any;
            data: Record<string, unknown>;
            template: SerializedComponentData;
        }>
    ): void {
        pendingComponents.forEach((entry) => {
            entry.component.preserveSerializedData?.(entry.template);
            const resolvedData = resolveSerializedReferences(entry.data, idMap);
            const payload = (resolvedData && typeof resolvedData === 'object' && !Array.isArray(resolvedData))
                ? resolvedData as Record<string, unknown>
                : {};

            if (entry.component.deserialize) {
                entry.component.deserialize(payload);
                return;
            }

            for (const [key, value] of Object.entries(payload)) {
                entry.component[key] = value;
            }
        });
    }
}

/**
 * Prefab Manager - Manages all prefabs
 */
export class PrefabManager {
    private static prefabs: Map<string, Prefab> = new Map();
    private static desktopBridge: DesktopBridge = new DesktopBridge();
    private static desktopFileSystem: DesktopFileSystem = new DesktopFileSystem();

    private static getAssetsPath(): string {
        // @ts-ignore
        if (window.Editor?.instance?.rootPath) {
            // @ts-ignore
            return window.Editor.instance.rootPath;
        }
        return PathUtils.join(this.desktopBridge.getCurrentWorkingDirectory(), 'Assets');
    }

    public static async savePrefab(name: string, gameObject: GameObject): Promise<void> {
        const prefab = new Prefab(name, gameObject);
        this.prefabs.set(name, prefab);

        // Save to Filesystem if available
        if (this.desktopFileSystem) {
            const assetsPath = this.getAssetsPath();
            if (!await this.desktopFileSystem.exists(assetsPath)) await this.desktopFileSystem.mkdir(assetsPath);

            const filePath = PathUtils.join(assetsPath, `${name}.prefab`);
            prefab.sourcePath = filePath;
            await this.desktopFileSystem.writeFile(filePath, prefab.toJSON());
            console.log(`Saved prefab to ${filePath}`);
        } else {
            // Fallback to localStorage
            localStorage.setItem(`prefab_${name}`, prefab.toJSON());
        }
    }

    public static async savePrefabInstance(gameObject: GameObject): Promise<string | null> {
        const targetPath = gameObject.sourceAssetPath
            ?? PathUtils.join(this.getAssetsPath(), `${gameObject.prefabSource || gameObject.name}.prefab`);
        const prefabName = PathUtils.basename(targetPath, '.prefab');
        const prefab = new Prefab(prefabName, gameObject);
        prefab.sourcePath = targetPath;
        this.prefabs.set(prefabName, prefab);
        await this.desktopFileSystem.writeFile(targetPath, prefab.toJSON(), 'utf8');
        return targetPath;
    }

    public static async loadPrefab(name: string): Promise<Prefab | null> {
        // Try memory first
        if (this.prefabs.has(name)) {
            return this.prefabs.get(name)!;
        }

        // Try Filesystem if available
        if (this.desktopFileSystem) {
            const assetsPath = this.getAssetsPath();
            const filePath = PathUtils.join(assetsPath, `${name}.prefab`);

            if (await this.desktopFileSystem.exists(filePath)) {
                try {
                    const json = await this.desktopFileSystem.readFile(filePath, 'utf8');
                    const prefab = Prefab.fromJSON(json);
                    prefab.sourcePath = filePath;
                    this.prefabs.set(name, prefab);
                    return prefab;
                } catch (err) {
                    console.error(`Failed to load prefab from ${filePath}`, err);
                }
            }
        }

        // Fallback to localStorage
        const json = localStorage.getItem(`prefab_${name}`);
        if (json) {
            const prefab = Prefab.fromJSON(json);
            this.prefabs.set(name, prefab);
            return prefab;
        }

        return null;
    }

    public static async loadPrefabFromPath(filePath: string): Promise<Prefab | null> {
        if (!await this.desktopFileSystem.exists(filePath)) return null;

        try {
            const json = await this.desktopFileSystem.readFile(filePath, 'utf8');
            const prefab = Prefab.fromJSON(json);
            prefab.sourcePath = filePath;
            this.prefabs.set(prefab.name, prefab);
            return prefab;
        } catch (err) {
            console.error(`Failed to load prefab from ${filePath}`, err);
            return null;
        }
    }

    public static applySerializedData(
        gameObject: GameObject,
        data: any,
        options?: { preserveTransform?: boolean; preserveSourceLink?: boolean }
    ): void {
        const normalizedData = normalizeSerializedGameObject(data, gameObject.name);
        const preserveTransform = options?.preserveTransform === true;
        const preserveSourceLink = options?.preserveSourceLink === true;
        const idMap = new Map<string, GameObject>();
        if (gameObject.scene) {
            gameObject.scene.gameObjects.forEach((go: GameObject) => idMap.set(go.id, go));
        }
        const pendingComponents: Array<{ component: any; data: Record<string, unknown> }> = [];
        const createdChildren: GameObject[] = [];
        idMap.set(normalizedData.id, gameObject);

        gameObject.name = normalizedData.name;
        gameObject.tag = normalizedData.tag;
        gameObject.layer = normalizedData.layer;
        gameObject.enabled = normalizedData.enabled;
        gameObject.prefabSource = normalizedData.prefabSource || gameObject.prefabSource || null;
        if (!preserveSourceLink) {
            const resolvedSourcePath = normalizedData.sourceAssetGuid
                ? AssetDatabase.getInstance().getPath(normalizedData.sourceAssetGuid) ?? normalizedData.sourceAssetPath
                : normalizedData.sourceAssetPath;
            gameObject.sourceAssetPath = resolvedSourcePath;
            gameObject.sourceAssetGuid = normalizedData.sourceAssetGuid;
            gameObject.sourceAssetType = normalizedData.sourceAssetType;
        }

        if (!preserveTransform) {
            gameObject.transform.position.fromArray(normalizedData.transform.position);
            gameObject.transform.rotation.set(
                normalizedData.transform.rotation[0],
                normalizedData.transform.rotation[1],
                normalizedData.transform.rotation[2]
            );
            gameObject.transform.scale.fromArray(normalizedData.transform.scale);
        }

        const toDestroy = gameObject.components.filter(c => c.constructor.name !== 'Transform');
        toDestroy.forEach(c => gameObject.removeComponent(c));

        normalizedData.components.forEach((compData: SerializedComponentData) => {
            const ComponentClass = ScriptRegistry.getComponentClass(compData.type);
            if (!ComponentClass) return;
            const component = gameObject.addComponent(ComponentClass, { invokeLifecycle: false });
            pendingComponents.push({
                component,
                data: compData.data
            });
        });

            const children = [...gameObject.transform.children];
        children.forEach(child => {
            child.gameObject.onDestroy();
            if (gameObject.scene) {
                gameObject.scene.removeGameObject(child.gameObject);
            }
        });

        const instantiateChild = (serializedChild: SerializedGameObjectData, parent: GameObject): GameObject => {
            const child = new GameObject(serializedChild.name);
            child.id = crypto.randomUUID();
            child.tag = serializedChild.tag;
            child.layer = serializedChild.layer;
            child.enabled = serializedChild.enabled;
            child.prefabSource = serializedChild.prefabSource;
            const resolvedSourcePath = serializedChild.sourceAssetGuid
                ? AssetDatabase.getInstance().getPath(serializedChild.sourceAssetGuid) ?? serializedChild.sourceAssetPath
                : serializedChild.sourceAssetPath;
            child.sourceAssetPath = resolvedSourcePath;
            child.sourceAssetGuid = serializedChild.sourceAssetGuid;
            child.sourceAssetType = serializedChild.sourceAssetType;

            idMap.set(serializedChild.id, child);
            child.transform.position.fromArray(serializedChild.transform.position);
            child.transform.rotation.set(
                serializedChild.transform.rotation[0],
                serializedChild.transform.rotation[1],
                serializedChild.transform.rotation[2]
            );
            child.transform.scale.fromArray(serializedChild.transform.scale);

            serializedChild.components.forEach((componentData: SerializedComponentData) => {
                const ComponentClass = ScriptRegistry.getComponentClass(componentData.type);
                if (!ComponentClass) return;
                const component = child.addComponent(ComponentClass, { invokeLifecycle: false });
                pendingComponents.push({
                    component,
                    data: componentData.data
                });
            });
            createdChildren.push(child);

            if (gameObject.scene) {
                gameObject.scene.addGameObject(child, { start: false });
            }
            child.transform.setParent(parent.transform, false);

            serializedChild.children.forEach((grandChild) => {
                instantiateChild(grandChild, child);
            });

            child.setActive(child.enabled);
            return child;
        };

        normalizedData.children.forEach((childData) => {
            instantiateChild(childData, gameObject);
        });

        pendingComponents.forEach((entry) => {
            const resolvedData = resolveSerializedReferences(entry.data, idMap);
            const payload = (resolvedData && typeof resolvedData === 'object' && !Array.isArray(resolvedData))
                ? resolvedData as Record<string, unknown>
                : {};

            if (entry.component.deserialize) {
                entry.component.deserialize(payload);
                return;
            }

            for (const [key, value] of Object.entries(payload)) {
                entry.component[key] = value;
            }
        });

        const shouldStartLifecycle = !!gameObject.scene;
        gameObject.flushPendingLifecycle(shouldStartLifecycle);
        createdChildren.forEach((child) => {
            child.flushPendingLifecycle(false);
            if (shouldStartLifecycle) {
                child.start();
            }
        });
        gameObject.setActive(gameObject.enabled);
        gameObject.overrides.clear();
    }

    public static async getAllPrefabNames(): Promise<string[]> {
        const names: Set<string> = new Set();

        // Get from Filesystem
        if (this.desktopFileSystem) {
            const assetsPath = this.getAssetsPath();
            if (await this.desktopFileSystem.exists(assetsPath)) {
                const files = await this.desktopFileSystem.readdir(assetsPath);
                files.forEach((file: string) => {
                    if (file.endsWith('.prefab')) {
                        names.add(file.replace('.prefab', ''));
                    }
                });
            }
        }

        // Get from localStorage
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('prefab_')) {
                names.add(key.replace('prefab_', ''));
            }
        }

        return Array.from(names);
    }

    public static async deletePrefab(name: string): Promise<void> {
        this.prefabs.delete(name);

        if (this.desktopFileSystem) {
            const assetsPath = this.getAssetsPath();
            const filePath = PathUtils.join(assetsPath, `${name}.prefab`);
            if (await this.desktopFileSystem.exists(filePath)) {
                await this.desktopFileSystem.unlink(filePath);

                // Also delete .meta if it exists
                const metaPath = filePath + '.meta';
                if (await this.desktopFileSystem.exists(metaPath)) await this.desktopFileSystem.unlink(metaPath);
            }
        }

        localStorage.removeItem(`prefab_${name}`);
    }

    public static async revertToPrefab(gameObject: GameObject, prefabRootOverride: GameObject | null = null): Promise<void> {
        const data = await this.getPrefabNodeDataForGameObject(gameObject, prefabRootOverride);
        if (!data) return;
        this.applySerializedData(gameObject, data, { preserveSourceLink: true });
    }

    public static async revertGameObjectPropertyToPrefab(
        gameObject: GameObject,
        propertyKey: 'name' | 'tag' | 'layer' | 'enabled',
        prefabRootOverride: GameObject | null = null
    ): Promise<void> {
        const prefabData = await this.getPrefabNodeDataForGameObject(gameObject, prefabRootOverride);
        if (!prefabData) return;

        (gameObject as any)[propertyKey] = prefabData[propertyKey];
        if (propertyKey === 'enabled') {
            gameObject.setActive(gameObject.enabled);
        }
        gameObject.overrides.delete(propertyKey);
    }

    public static async revertTransformPropertyToPrefab(
        gameObject: GameObject,
        propertyKey: 'position' | 'rotation' | 'scale',
        prefabRootOverride: GameObject | null = null
    ): Promise<void> {
        const prefabData = await this.getPrefabNodeDataForGameObject(gameObject, prefabRootOverride);
        if (!prefabData?.transform) return;

        if (propertyKey === 'rotation') {
            gameObject.transform.rotation.set(
                prefabData.transform.rotation[0],
                prefabData.transform.rotation[1],
                prefabData.transform.rotation[2]
            );
        } else {
            gameObject.transform[propertyKey].fromArray(prefabData.transform[propertyKey]);
        }

        gameObject.transform.overrides?.delete(propertyKey);
    }

    public static async revertComponentToPrefab(gameObject: GameObject, component: any, prefabRootOverride: GameObject | null = null): Promise<void> {
        const prefabData = await this.getPrefabNodeDataForGameObject(gameObject, prefabRootOverride);
        if (!prefabData) return;
        const typeName = component.constructor.name;

        if (typeName === 'Transform' || typeName === 'RectTransform') {
            gameObject.transform.position.fromArray(prefabData.transform.position);
            gameObject.transform.rotation.set(
                prefabData.transform.rotation[0],
                prefabData.transform.rotation[1],
                prefabData.transform.rotation[2]
            );
            gameObject.transform.scale.fromArray(prefabData.transform.scale);
            if (gameObject.transform.overrides) gameObject.transform.overrides.clear();
            return;
        }

        const compData = prefabData.components.find((c: any) => c.type === typeName);
        if (compData && component.deserialize) {
            const payload = await this.resolveComponentPayloadForInstance(gameObject, compData.data, prefabRootOverride);
            component.deserialize(payload);
            if (component.overrides) component.overrides.clear();
        }
    }

    public static async restoreRemovedComponent(gameObject: GameObject, componentType: string, prefabRootOverride: GameObject | null = null): Promise<void> {
        const prefabData = await this.getPrefabNodeDataForGameObject(gameObject, prefabRootOverride);
        if (!prefabData?.components) return;

        const existing = gameObject.components.find((component) => component.constructor.name === componentType);
        if (existing) return;

        const compData = prefabData.components.find((component: any) => component.type === componentType);
        if (!compData) return;

        const ComponentClass = ScriptRegistry.getComponentClass(componentType);
        if (!ComponentClass) return;

        const component = gameObject.addComponent(ComponentClass, { invokeLifecycle: false });
        if (component.deserialize) {
            const payload = await this.resolveComponentPayloadForInstance(gameObject, compData.data, prefabRootOverride);
            component.deserialize(payload);
        }
        gameObject.flushPendingLifecycle(false);
    }

    public static async restoreRemovedChild(gameObject: GameObject, childPath: string, prefabRootOverride: GameObject | null = null): Promise<void> {
        const prefabData = await this.getPrefabNodeDataForGameObject(gameObject, prefabRootOverride);
        if (!prefabData?.children) return;

        const childData = this.findPrefabChildDataByPath(prefabData, childPath);
        if (!childData) return;

        const parentPath = this.getParentPath(childPath);
        const parentGameObject = parentPath ? this.findCurrentChildByPath(gameObject, parentPath) : gameObject;
        if (!parentGameObject) return;

        const targetSegment = this.getLastPathSegment(childPath);
        const existing = parentGameObject.transform.children.find((child) => this.getPathSegment(child.gameObject) === targetSegment);
        if (existing) return;

        const externalIdMap = await this.buildInstancePrefabReferenceMap(gameObject, prefabRootOverride);
        const child = Prefab.instantiateData(childData, { externalIdMap });
        if (gameObject.scene) {
            gameObject.scene.addGameObject(child);
        }
        child.transform.setParent(parentGameObject.transform, false);
    }

    public static async applyGameObjectPropertyToPrefab(
        gameObject: GameObject,
        propertyKey: 'name' | 'tag' | 'layer' | 'enabled',
        prefabRootOverride: GameObject | null = null
    ): Promise<void> {
        await this.updatePrefabNodeData(gameObject, (prefabData) => {
            if (!prefabData) return;
            prefabData[propertyKey] = (gameObject as any)[propertyKey];
        }, prefabRootOverride);
    }

    public static async applyTransformPropertyToPrefab(
        gameObject: GameObject,
        propertyKey: 'position' | 'rotation' | 'scale',
        prefabRootOverride: GameObject | null = null
    ): Promise<void> {
        await this.updatePrefabNodeData(gameObject, (prefabData) => {
            if (!prefabData) return;
            prefabData.transform = prefabData.transform || {};
            if (propertyKey === 'rotation') {
                prefabData.transform.rotation = [
                    gameObject.transform.rotation.x,
                    gameObject.transform.rotation.y,
                    gameObject.transform.rotation.z
                ];
            } else {
                prefabData.transform[propertyKey] = gameObject.transform[propertyKey].toArray();
            }
        }, prefabRootOverride);
    }

    public static async applyComponentToPrefab(gameObject: GameObject, component: any, prefabRootOverride: GameObject | null = null): Promise<void> {
        await this.updatePrefabNodeData(gameObject, (prefabData) => {
            if (!prefabData) return;
            prefabData.components = prefabData.components || [];
            const serialized = component.serialize();
            const index = prefabData.components.findIndex((entry: any) => entry.type === serialized.type);
            if (index >= 0) {
                prefabData.components[index] = serialized;
            } else {
                prefabData.components.push(serialized);
            }
        }, prefabRootOverride);
    }

    public static async removeComponentFromPrefab(gameObject: GameObject, componentType: string, prefabRootOverride: GameObject | null = null): Promise<void> {
        await this.updatePrefabNodeData(gameObject, (prefabData) => {
            if (!prefabData) return;
            prefabData.components = (prefabData.components || []).filter((entry: any) => entry.type !== componentType);
        }, prefabRootOverride);
    }

    public static async applyChildToPrefab(
        gameObject: GameObject,
        childGameObject: GameObject,
        parentPath: string | null = null,
        prefabRootOverride: GameObject | null = null
    ): Promise<void> {
        await this.updatePrefabNodeData(gameObject, (prefabData) => {
            if (!prefabData) return;
            const parentData = parentPath ? this.findPrefabChildDataByPath(prefabData, parentPath) : prefabData;
            if (!parentData) return;
            parentData.children = parentData.children || [];
            const serialized = childGameObject.serialize();
            const targetSegment = this.getPathSegment(childGameObject);
            const index = parentData.children.findIndex((entry: any, entryIndex: number, array: any[]) =>
                this.getPathSegmentFromData(entry, array.slice(0, entryIndex)) === targetSegment
            );
            if (index >= 0) {
                parentData.children[index] = serialized;
            } else {
                parentData.children.push(serialized);
            }
        }, prefabRootOverride);
    }

    public static async removeChildFromPrefab(gameObject: GameObject, childPath: string, prefabRootOverride: GameObject | null = null): Promise<void> {
        await this.updatePrefabNodeData(gameObject, (prefabData) => {
            if (!prefabData) return;
            const parentPath = this.getParentPath(childPath);
            const parentData = parentPath ? this.findPrefabChildDataByPath(prefabData, parentPath) : prefabData;
            if (!parentData?.children) return;

            const targetSegment = this.getLastPathSegment(childPath);
            parentData.children = parentData.children.filter((entry: any, entryIndex: number, array: any[]) =>
                this.getPathSegmentFromData(entry, array.slice(0, entryIndex)) !== targetSegment
            );
        }, prefabRootOverride);
    }

    public static getPrefabOwningRoot(gameObject: GameObject): GameObject | null {
        return this.getPrefabOwnershipChain(gameObject)[0] ?? null;
    }

    public static getPrefabOwnershipChain(gameObject: GameObject): GameObject[] {
        const chain: GameObject[] = [];
        let current: GameObject | null = gameObject;
        while (current) {
            if (current.sourceAssetType === 'prefab' || current.sourceAssetPath || current.prefabSource) {
                chain.push(current);
            }
            current = current.transform.parent?.gameObject ?? null;
        }
        return chain;
    }

    public static async getPrefabRootDataForGameObject(gameObject: GameObject, prefabRootOverride: GameObject | null = null): Promise<any | null> {
        const prefabRoot = prefabRootOverride && this.getPrefabOwnershipChain(gameObject).includes(prefabRootOverride)
            ? prefabRootOverride
            : this.getPrefabOwningRoot(gameObject);
        if (!prefabRoot) return null;
        const prefab = prefabRoot.sourceAssetPath
            ? await this.loadPrefabFromPath(prefabRoot.sourceAssetPath)
            : await this.loadPrefab(prefabRoot.prefabSource!);
        return prefab ? (prefab as any).data : null;
    }

    public static async getPrefabNodeDataForGameObject(gameObject: GameObject, prefabRootOverride: GameObject | null = null): Promise<any | null> {
        const prefabRoot = prefabRootOverride && this.getPrefabOwnershipChain(gameObject).includes(prefabRootOverride)
            ? prefabRootOverride
            : this.getPrefabOwningRoot(gameObject);
        if (!prefabRoot) return null;
        const prefabData = await this.getPrefabRootDataForGameObject(gameObject, prefabRoot);
        if (!prefabData) return null;
        if (prefabRoot === gameObject) return prefabData;

        const relativePath = this.getRelativePrefabPath(prefabRoot, gameObject);
        if (!relativePath) return null;
        return this.findPrefabChildDataByPath(prefabData, relativePath);
    }

    public static getPrefabNodePathForGameObject(gameObject: GameObject, prefabRootOverride: GameObject | null = null): string | null {
        const prefabRoot = prefabRootOverride && this.getPrefabOwnershipChain(gameObject).includes(prefabRootOverride)
            ? prefabRootOverride
            : this.getPrefabOwningRoot(gameObject);
        if (!prefabRoot) return null;
        if (prefabRoot === gameObject) return null;
        return this.getRelativePrefabPath(prefabRoot, gameObject);
    }

    public static findPrefabInstanceNodeByPath(root: GameObject, childPath: string | null): GameObject | null {
        if (!childPath) return root;
        return this.findCurrentChildByPath(root, childPath);
    }

    private static async resolveComponentPayloadForInstance(
        gameObject: GameObject,
        data: unknown,
        prefabRootOverride: GameObject | null = null
    ): Promise<Record<string, unknown>> {
        const payload = (data && typeof data === 'object' && !Array.isArray(data))
            ? data as Record<string, unknown>
            : {};
        const idMap = await this.buildInstancePrefabReferenceMap(gameObject, prefabRootOverride);
        const resolved = resolveSerializedReferences(payload, idMap);
        if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
            return resolved as Record<string, unknown>;
        }
        return {};
    }

    private static async buildInstancePrefabReferenceMap(
        gameObject: GameObject,
        prefabRootOverride: GameObject | null = null
    ): Promise<Map<string, GameObject>> {
        const map = new Map<string, GameObject>();
        const prefabRoot = this.resolvePrefabRootForGameObject(gameObject, prefabRootOverride);
        if (!prefabRoot) return map;

        const prefabRootData = await this.getPrefabRootDataForGameObject(gameObject, prefabRoot);
        if (!prefabRootData || typeof prefabRootData !== 'object') return map;
        if (typeof prefabRootData.id === 'string') {
            map.set(prefabRootData.id, prefabRoot);
        }

        const walk = (nodeData: any, currentPath: string | null) => {
            const children = Array.isArray(nodeData?.children) ? nodeData.children : [];
            const previousSiblings: any[] = [];
            for (const childData of children) {
                const pathSegment = this.getPathSegmentFromData(childData, previousSiblings);
                const childPath = currentPath ? `${currentPath}/${pathSegment}` : pathSegment;
                const childGameObject = this.findCurrentChildByPath(prefabRoot, childPath);
                if (childGameObject && typeof childData?.id === 'string') {
                    map.set(childData.id, childGameObject);
                }
                walk(childData, childPath);
                previousSiblings.push(childData);
            }
        };

        walk(prefabRootData, null);
        return map;
    }

    private static resolvePrefabRootForGameObject(
        gameObject: GameObject,
        prefabRootOverride: GameObject | null = null
    ): GameObject | null {
        return prefabRootOverride && this.getPrefabOwnershipChain(gameObject).includes(prefabRootOverride)
            ? prefabRootOverride
            : this.getPrefabOwningRoot(gameObject);
    }

    private static async updatePrefabNodeData(
        gameObject: GameObject,
        updater: (prefabData: any) => void,
        prefabRootOverride: GameObject | null = null
    ): Promise<void> {
        const prefabRoot = prefabRootOverride && this.getPrefabOwnershipChain(gameObject).includes(prefabRootOverride)
            ? prefabRootOverride
            : this.getPrefabOwningRoot(gameObject);
        if (!prefabRoot) return;

        const prefab = prefabRoot.sourceAssetPath
            ? await this.loadPrefabFromPath(prefabRoot.sourceAssetPath)
            : await this.loadPrefab(prefabRoot.prefabSource!);
        if (!prefab) return;

        const rootData = (prefab as any).data;
        const nodeData = prefabRoot === gameObject
            ? rootData
            : this.findPrefabChildDataByPath(rootData, this.getRelativePrefabPath(prefabRoot, gameObject) ?? '');
        updater(nodeData);
        await this.persistPrefab(prefab);
    }

    private static async persistPrefab(prefab: Prefab): Promise<void> {
        this.prefabs.set(prefab.name, prefab);
        if (prefab.sourcePath) {
            await this.desktopFileSystem.writeFile(prefab.sourcePath, prefab.toJSON(), 'utf8');
            return;
        }

        localStorage.setItem(`prefab_${prefab.name}`, prefab.toJSON());
    }

    private static findPrefabChildDataByPath(prefabData: any, childPath: string): any | null {
        const segments = childPath.split('/').filter(Boolean);
        let currentNode = prefabData;

        for (const segment of segments) {
            const children = currentNode?.children ?? [];
            const nextChild = children.find((entry: any, entryIndex: number, array: any[]) =>
                this.getPathSegmentFromData(entry, array.slice(0, entryIndex)) === segment
            );
            if (!nextChild) return null;
            currentNode = nextChild;
        }

        return currentNode;
    }

    private static findCurrentChildByPath(root: GameObject, childPath: string): GameObject | null {
        const segments = childPath.split('/').filter(Boolean);
        let current = root;

        for (const segment of segments) {
            const next = current.transform.children.find((child) => this.getPathSegment(child.gameObject) === segment)?.gameObject ?? null;
            if (!next) return null;
            current = next;
        }

        return current;
    }

    private static getRelativePrefabPath(root: GameObject, target: GameObject): string | null {
        const segments: string[] = [];
        let current: GameObject | null = target;

        while (current && current !== root) {
            segments.unshift(this.getPathSegment(current));
            current = current.transform.parent?.gameObject ?? null;
        }

        return current === root ? segments.join('/') : null;
    }

    private static getPathSegment(gameObject: GameObject): string {
        if (!gameObject.transform.parent) return `${gameObject.name}#0`;
        const siblings = gameObject.transform.parent.children.map((child) => child.gameObject);
        const sameNameSiblings = siblings.filter((sibling) => sibling.name === gameObject.name);
        const index = sameNameSiblings.indexOf(gameObject);
        return `${gameObject.name}#${Math.max(0, index)}`;
    }

    private static getPathSegmentFromData(entry: any, previousSiblings: any[]): string {
        const siblingIndex = previousSiblings.filter((sibling) => sibling.name === entry.name).length;
        return `${entry.name}#${siblingIndex}`;
    }

    private static getParentPath(childPath: string): string | null {
        const segments = childPath.split('/').filter(Boolean);
        if (segments.length <= 1) return null;
        return segments.slice(0, -1).join('/');
    }

    private static getLastPathSegment(childPath: string): string {
        const segments = childPath.split('/').filter(Boolean);
        return segments[segments.length - 1] ?? childPath;
    }
}
