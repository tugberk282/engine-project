import { Command } from './Command';
import { GameObject } from '../engine/GameObject';
import { Scene } from '../engine/Scene';
import { Component } from '../engine/Component';

export class CreateGameObjectCommand implements Command {
    public name: string;
    private go: GameObject;
    private scene: Scene;
    private parent: any;

    constructor(go: GameObject, scene: Scene, parent?: any) {
        this.go = go;
        this.scene = scene;
        this.parent = parent || null;
        this.name = `Create ${go.name}`;
    }

    execute(): void {
        if (this.parent) {
            this.go.transform.setParent(this.parent, false);
        } else if (this.go.transform.parent) {
            this.go.transform.setParent(null, false);
        }
        this.scene.addGameObject(this.go);
    }

    undo(): void {
        this.scene.removeGameObject(this.go, { destroy: false });
    }
}

export class DeleteGameObjectCommand implements Command {
    public name: string;
    private scene: Scene;
    private go: GameObject;
    private originalParent: any;
    private originalSiblingIndex: number;
    private originalRootIndex: number;

    constructor(go: GameObject, scene: Scene) {
        this.go = go;
        this.scene = scene;
        this.originalParent = go.transform.parent;
        this.originalSiblingIndex = go.transform.siblingIndex;
        this.originalRootIndex = this.getRootOrderIndex(go);
        this.name = `Delete ${go.name}`;
    }

    execute(): void {
        if (this.scene.gameObjects.indexOf(this.go) < 0) return;
        this.scene.removeGameObject(this.go, { destroy: false });
    }

    undo(): void {
        if (this.scene.gameObjects.indexOf(this.go) >= 0) return;

        const parentStillInScene = this.originalParent?.gameObject?.scene === this.scene;
        if (parentStillInScene) {
            this.go.transform.setParent(this.originalParent, false);
        } else if (this.go.transform.parent) {
            this.go.transform.setParent(null, false);
        }
        this.scene.addGameObject(this.go, { start: false });

        if (parentStillInScene && this.originalSiblingIndex >= 0) {
            const siblingCount = this.originalParent.children.length;
            const targetIndex = Math.min(this.originalSiblingIndex, Math.max(0, siblingCount - 1));
            this.go.transform.setSiblingIndex(targetIndex);
            return;
        }

        if (this.originalRootIndex >= 0) {
            this.reorderRootToIndex(this.go, this.originalRootIndex);
        }
    }

    private getRootOrderIndex(target: GameObject): number {
        if (target.transform.parent) return -1;
        const roots = this.scene.gameObjects.filter((go) => go.transform.parent === null);
        return roots.indexOf(target);
    }

    private reorderRootToIndex(target: GameObject, desiredIndex: number): void {
        if (target.transform.parent) return;
        const roots = this.scene.gameObjects.filter((go) => go.transform.parent === null);
        const currentIndex = roots.indexOf(target);
        if (currentIndex < 0) return;

        const clampedIndex = Math.max(0, Math.min(desiredIndex, roots.length - 1));
        if (clampedIndex === currentIndex) return;

        const reorderedRoots = [...roots];
        const [movedRoot] = reorderedRoots.splice(currentIndex, 1);
        if (!movedRoot) return;
        reorderedRoots.splice(clampedIndex, 0, movedRoot);

        let rootCursor = 0;
        this.scene.gameObjects = this.scene.gameObjects.map((go) => {
            if (go.transform.parent !== null) return go;
            return reorderedRoots[rootCursor++] ?? go;
        });

        const orderedRootObjects = reorderedRoots.map((go) => go.object3D);
        const rootObjectSet = new Set(orderedRootObjects);
        const sceneChildren = this.scene.threeScene.children;
        let objectCursor = 0;
        for (let i = 0; i < sceneChildren.length; i++) {
            if (!rootObjectSet.has(sceneChildren[i])) continue;
            sceneChildren[i] = orderedRootObjects[objectCursor++] ?? sceneChildren[i];
        }
    }
}

export class ReparentGameObjectCommand implements Command {
    public name: string;
    private go: GameObject;
    private oldParent: any;
    private newParent: any;
    private oldSiblingIndex: number;
    private oldRootIndex: number;
    private newSiblingIndex: number | null = null;
    private newRootIndex: number | null = null;

    constructor(go: GameObject, newParent: any) {
        this.go = go;
        this.oldParent = go.transform.parent;
        this.newParent = newParent ?? null;
        this.oldSiblingIndex = go.transform.siblingIndex;
        this.oldRootIndex = this.getRootOrderIndex(go);
        const targetName = this.newParent?.gameObject?.name ?? 'Root';
        this.name = `Reparent ${go.name} -> ${targetName}`;
    }

    execute(): void {
        this.go.transform.setParent(this.newParent, true);
        if (this.newParent) {
            if (this.newSiblingIndex === null) {
                this.newSiblingIndex = this.go.transform.siblingIndex;
            } else {
                this.go.transform.setSiblingIndex(this.newSiblingIndex);
            }
            return;
        }

        if (!this.go.scene) return;
        if (this.newRootIndex === null) {
            this.newRootIndex = this.getRootOrderIndex(this.go);
            return;
        }
        this.reorderRootToIndex(this.go, this.newRootIndex);
    }

    undo(): void {
        this.go.transform.setParent(this.oldParent, true);
        if (this.oldParent) {
            if (this.oldSiblingIndex >= 0) {
                this.go.transform.setSiblingIndex(this.oldSiblingIndex);
            }
            return;
        }
        if (this.oldRootIndex >= 0) {
            this.reorderRootToIndex(this.go, this.oldRootIndex);
        }
    }

    private getRootOrderIndex(target: GameObject): number {
        const scene = target.scene as Scene | null;
        if (!scene || target.transform.parent) return -1;
        const roots = scene.gameObjects.filter((go: GameObject) => go.transform.parent === null);
        return roots.indexOf(target);
    }

    private reorderRootToIndex(target: GameObject, desiredIndex: number): void {
        const scene = target.scene as Scene | null;
        if (!scene || target.transform.parent) return;

        const roots = scene.gameObjects.filter((go: GameObject) => go.transform.parent === null);
        const currentIndex = roots.indexOf(target);
        if (currentIndex < 0) return;

        const clampedIndex = Math.max(0, Math.min(desiredIndex, roots.length - 1));
        if (clampedIndex === currentIndex) return;

        const reorderedRoots = [...roots];
        const [movedRoot] = reorderedRoots.splice(currentIndex, 1);
        if (!movedRoot) return;
        reorderedRoots.splice(clampedIndex, 0, movedRoot);

        let rootCursor = 0;
        scene.gameObjects = scene.gameObjects.map((go: GameObject) => {
            if (go.transform.parent !== null) return go;
            return reorderedRoots[rootCursor++] ?? go;
        });

        const orderedRootObjects = reorderedRoots.map((go) => go.object3D);
        const rootObjectSet = new Set(orderedRootObjects);
        const sceneChildren = scene.threeScene.children;
        let objectCursor = 0;
        for (let i = 0; i < sceneChildren.length; i++) {
            if (!rootObjectSet.has(sceneChildren[i])) continue;
            sceneChildren[i] = orderedRootObjects[objectCursor++] ?? sceneChildren[i];
        }
    }
}

export class AddComponentCommand implements Command {
    public name: string;
    private go: GameObject;
    private componentClass: any;
    private componentInstance: Component | null = null;
    private componentIndex: number = -1;

    constructor(go: GameObject, componentClass: any) {
        this.go = go;
        this.componentClass = componentClass;
        this.name = `Add Component ${componentClass.name}`;
    }

    execute(): void {
        if (this.componentInstance) {
            const component = this.componentInstance;
            this.go.addComponent(component, {
                index: this.componentIndex >= 0 ? this.componentIndex : undefined
            });
        } else {
            this.componentInstance = this.go.addComponent(this.componentClass);
            this.componentIndex = this.go.components.indexOf(this.componentInstance!);
        }
    }

    undo(): void {
        if (this.componentInstance) {
            this.componentIndex = this.go.components.indexOf(this.componentInstance);
            this.go.removeComponent(this.componentInstance);
        }
    }
}

export class RenameGameObjectCommand implements Command {
    public name: string;
    private go: GameObject;
    private oldName: string;
    private newName: string;

    constructor(go: GameObject, newName: string) {
        this.go = go;
        this.oldName = go.name;
        this.newName = newName;
        this.name = `Rename '${this.oldName}' to '${this.newName}'`;
    }

    execute(): void {
        this.go.name = this.newName;
    }

    undo(): void {
        this.go.name = this.oldName;
    }
}

export class RemoveComponentCommand implements Command {
    public name: string;
    private go: GameObject;
    private component: Component;
    private index: number;

    constructor(go: GameObject, component: Component) {
        this.go = go;
        this.component = component;
        this.index = go.components.indexOf(component);
        this.name = `Remove Component ${component.constructor.name}`;
    }

    execute(): void {
        this.index = this.go.components.indexOf(this.component);
        if (this.index < 0) return;
        this.go.removeComponent(this.component);
    }

    undo(): void {
        if (this.go.components.includes(this.component)) return;
        this.go.addComponent(this.component, { index: this.index });
    }
}

export class ReorderComponentCommand implements Command {
    public name: string;
    private go: GameObject;
    private fromIndex: number;
    private toIndex: number;

    constructor(go: GameObject, fromIndex: number, toIndex: number) {
        this.go = go;
        this.fromIndex = fromIndex;
        this.toIndex = toIndex;
        this.name = `Reorder Component ${go.components[fromIndex].constructor.name}`;
    }

    execute(): void {
        this.go.moveComponent(this.fromIndex, this.toIndex);
    }

    undo(): void {
        this.go.moveComponent(this.toIndex, this.fromIndex);
    }
}

export class SetPropertyCommand implements Command {
    public name: string;
    private target: any;
    private property: string;
    private oldValue: any;
    private newValue: any;
    private onUpdate?: () => void;

    constructor(target: any, property: string, newValue: any, name?: string, onUpdate?: () => void) {
        this.target = target;
        this.property = property;
        this.newValue = newValue;
        this.oldValue = target[property];
        this.name = name || `Set ${property}`;
        this.onUpdate = onUpdate;
    }

    execute(): void {
        this.target[this.property] = this.newValue;
        if (this.onUpdate) this.onUpdate();
    }

    undo(): void {
        this.target[this.property] = this.oldValue;
        if (this.onUpdate) this.onUpdate();
    }
}
