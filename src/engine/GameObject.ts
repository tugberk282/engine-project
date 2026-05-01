import { Component } from './Component';
import { Transform } from './components/Transform'; // We will create this next
import { ScriptRegistry } from './ScriptRegistry';
import * as THREE from 'three';

type AddComponentOptions = {
    invokeLifecycle?: boolean;
    index?: number;
};

export class GameObject {
    public name: string;
    public transform: Transform;
    public components: Component[] = [];
    public id: string;
    public tag: string = "Untagged";
    public layer: number = 0;
    public isStatic: boolean = false;

    // Direct reference to Three.js Object3D for rendering
    // In a pure ECS, this might be separated, but for simplicity/Unity-likeness we bind it here
    public object3D: THREE.Object3D;
    public scene: any = null; // Typing as any to avoid circular dependency hell for now, or use interface.
    public enabled: boolean = true;
    public prefabSource: string | null = null; // Name of the prefab this was instantiated from
    public sourceAssetPath: string | null = null;
    public sourceAssetGuid: string | null = null;
    public sourceAssetType: 'prefab' | 'model' | null = null;
    public overrides: Set<string> = new Set(); // Track overridden properties (name, components, etc.)
    private orderedComponentCache: Component[] | null = null;
    private orderedComponentCacheVersion: number = -1;
    private orderedComponentCacheSize: number = -1;
    private pendingLifecycleComponents: Component[] = [];

    constructor(name: string = "New GameObject") {
        this.name = name;
        this.id = crypto.randomUUID();

        // Every GameObject has an underlying Three.js group/object
        this.object3D = new THREE.Group();
        this.object3D.userData = { gameObject: this };

        // Every GameObject has a Transform
        this.transform = this.addComponent(Transform);
    }

    public setActive(value: boolean): void {
        const changed = this.enabled !== value;
        this.enabled = value;
        this.object3D.visible = value;
        if (!changed) return;

        // Call OnEnable/OnDisable on all components
        for (const component of this.getComponentsInExecutionOrder()) {
            if (value) {
                component.onEnable();
            } else {
                component.onDisable();
            }
        }
    }

    public addComponent<T extends Component>(componentOrType: T | (new (go: GameObject) => T), options?: AddComponentOptions): T {
        let component: T;
        if (componentOrType instanceof Component) {
            component = componentOrType;
            if (component.gameObject !== this) {
                // Warn or handle reparenting if needed, for now assume fresh instance
                // component.gameObject = this; // Component constructor usually sets this, but if passed instance might be tricky.
                // Ideally ScriptRegistry creates with correct GO.
            }
        } else {
            component = new componentOrType(this);
        }

        const requestedIndex = options?.index;
        if (typeof requestedIndex === 'number' && Number.isFinite(requestedIndex)) {
            const targetIndex = Math.max(0, Math.min(Math.trunc(requestedIndex), this.components.length));
            this.components.splice(targetIndex, 0, component);
        } else {
            this.components.push(component);
        }
        this.invalidateOrderedComponentCache();
        if (options?.invokeLifecycle === false) {
            this.pendingLifecycleComponents.push(component);
            return component;
        }

        component.awake();
        if (this.enabled && component.enabled) {
            component.onEnable();
        }
        return component;
    }

    public getComponent<T extends Component>(componentType: new (go: GameObject) => T): T | undefined {
        return this.components.find(c => c instanceof componentType) as T;
    }

    public getComponents<T extends Component>(componentType: new (go: GameObject) => T): T[] {
        return this.components.filter(c => c instanceof componentType) as T[];
    }

    public removeComponent(component: Component): void {
        const index = this.components.indexOf(component);
        if (index > -1) {
            const pendingIndex = this.pendingLifecycleComponents.indexOf(component);
            if (pendingIndex >= 0) {
                this.pendingLifecycleComponents.splice(pendingIndex, 1);
            }
            component.onDestroy();
            this.components.splice(index, 1);
            this.invalidateOrderedComponentCache();
        }
    }

    public moveComponent(fromIndex: number, toIndex: number): void {
        if (fromIndex < 0 || fromIndex >= this.components.length) return;
        const targetIndex = Math.max(0, Math.min(toIndex, this.components.length - 1));
        if (fromIndex === targetIndex) return;

        const [component] = this.components.splice(fromIndex, 1);
        if (!component) return;
        this.components.splice(targetIndex, 0, component);
        this.invalidateOrderedComponentCache();
    }

    public flushPendingLifecycle(startPending: boolean = false): void {
        if (this.pendingLifecycleComponents.length === 0) return;
        const pending = [...this.pendingLifecycleComponents];
        this.pendingLifecycleComponents = [];

        for (const component of pending) {
            component.awake();
            if (this.enabled && component.enabled) {
                component.onEnable();
            }
            if (startPending) {
                component.start();
            }
        }
    }

    public start(): void {
        for (const component of this.getComponentsInExecutionOrder()) {
            component.start();
        }
    }

    public update(deltaTime: number): void {
        if (!this.enabled) return;

        for (const component of this.getComponentsInExecutionOrder()) {
            if (component.enabled) {
                component.update(deltaTime);
            }
        }
    }

    public fixedUpdate(fixedDeltaTime: number): void {
        if (!this.enabled) return;

        for (const component of this.getComponentsInExecutionOrder()) {
            if (component.enabled && (component as any).fixedUpdate) {
                (component as any).fixedUpdate(fixedDeltaTime);
            }
        }
    }

    public lateUpdate(): void {
        if (!this.enabled) return;

        for (const component of this.getComponentsInExecutionOrder()) {
            if (component.enabled) {
                component.lateUpdate();
            }
        }
    }

    public onDestroy(): void {
        for (const component of this.getComponentsInExecutionOrder()) {
            component.onDestroy();
        }
        // Remove children too? Scene.removeGameObject does not recursively remove children from scene list explicitly but THREE removes object3D.
        // If children are in scene list, they should also be removed.
        // But for now, let's just handle components.
        // Ideally, we should destroy children too if they are tracked separately in the scene.
        this.transform.children.forEach(child => child.gameObject.onDestroy());
    }

    public serialize(): any {
        return {
            id: this.id,
            name: this.name,
            tag: this.tag,
            layer: this.layer,
            isStatic: this.isStatic,
            enabled: this.enabled,
            prefabSource: this.prefabSource,
            sourceAssetPath: this.sourceAssetPath,
            sourceAssetGuid: this.sourceAssetGuid,
            sourceAssetType: this.sourceAssetType,
            transform: {
                position: this.transform.position.toArray(),
                rotation: [this.transform.rotation.x, this.transform.rotation.y, this.transform.rotation.z],
                scale: this.transform.scale.toArray()
            },
            components: this.components
                .filter(c => c.constructor.name !== 'Transform') // Preserve RectTransform-like subclasses
                .map(c => c.serialize()),
            children: this.transform.children.map(c => c.gameObject.serialize())
        };
    }

    private invalidateOrderedComponentCache(): void {
        this.orderedComponentCache = null;
        this.orderedComponentCacheVersion = -1;
        this.orderedComponentCacheSize = -1;
    }

    private getComponentsInExecutionOrder(): Component[] {
        const currentVersion = ScriptRegistry.getExecutionOrderVersion();
        if (
            this.orderedComponentCache
            && this.orderedComponentCacheVersion === currentVersion
            && this.orderedComponentCacheSize === this.components.length
        ) {
            return this.orderedComponentCache;
        }

        const ordered = this.components
            .map((component, index) => ({
                component,
                index,
                order: ScriptRegistry.getExecutionOrder(component.constructor.name)
            }))
            .sort((left, right) => {
                if (left.order !== right.order) return left.order - right.order;
                return left.index - right.index;
            })
            .map((entry) => entry.component);

        this.orderedComponentCache = ordered;
        this.orderedComponentCacheVersion = currentVersion;
        this.orderedComponentCacheSize = this.components.length;
        return ordered;
    }
}
