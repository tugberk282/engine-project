import { GameObject } from '../engine/GameObject';
import { Scene } from '../engine/Scene';
import { Prefab } from '../engine/Prefab';

// ─── Command Interface ────────────────────────────────────────────────
export interface Command {
    execute(): void;
    undo(): void;
    name: string;
}

// ─── Command History Manager ──────────────────────────────────────────
export class CommandHistory {
    private static undoStack: Array<{ command: Command; beforeState: number; afterState: number }> = [];
    private static redoStack: Array<{ command: Command; beforeState: number; afterState: number }> = [];
    private static maxHistory: number = 100;
    private static listeners: Array<() => void> = [];
    private static mutationListeners: Array<(state: number) => void> = [];
    private static currentState: number = 0;
    private static nextState: number = 1;

    public static execute(command: Command): void {
        console.log(`Executing Command: ${command.name}`);
        const beforeState = this.currentState;
        command.execute();
        const afterState = this.nextState++;
        this.currentState = afterState;
        this.undoStack.push({ command, beforeState, afterState });
        this.redoStack = []; // Clear redo on new action

        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
        this.notifyListeners();
        this.notifyMutationListeners();
    }

    public static undo(): void {
        const entry = this.undoStack.pop();
        if (entry) {
            console.log(`Undoing Command: ${entry.command.name}`);
            entry.command.undo();
            this.currentState = entry.beforeState;
            this.redoStack.push(entry);
            this.notifyListeners();
            this.notifyMutationListeners();
        }
    }

    public static redo(): void {
        const entry = this.redoStack.pop();
        if (entry) {
            console.log(`Redoing Command: ${entry.command.name}`);
            entry.command.execute();
            this.currentState = entry.afterState;
            this.undoStack.push(entry);
            this.notifyListeners();
            this.notifyMutationListeners();
        }
    }

    public static clear(): void {
        this.undoStack = [];
        this.redoStack = [];
        this.currentState = 0;
        this.nextState = 1;
        this.notifyListeners();
    }

    public static canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    public static canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    public static getUndoName(): string | null {
        return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].command.name : null;
    }

    public static getRedoName(): string | null {
        return this.redoStack.length > 0 ? this.redoStack[this.redoStack.length - 1].command.name : null;
    }

    public static addListener(callback: () => void): void {
        this.listeners.push(callback);
    }

    public static removeListener(callback: () => void): void {
        this.listeners = this.listeners.filter(l => l !== callback);
    }

    public static addMutationListener(callback: (state: number) => void): void {
        this.mutationListeners.push(callback);
    }

    private static notifyListeners(): void {
        this.listeners.forEach(l => l());
    }

    private static notifyMutationListeners(): void {
        this.mutationListeners.forEach((listener) => listener(this.currentState));
    }
}

// ─── Group Command (for batching multiple operations) ─────────────────
export class GroupCommand implements Command {
    name: string;
    private commands: Command[];

    constructor(name: string, commands: Command[]) {
        this.name = name;
        this.commands = commands;
    }

    execute(): void {
        for (const cmd of this.commands) {
            cmd.execute();
        }
    }

    undo(): void {
        // Undo in reverse order
        for (let i = this.commands.length - 1; i >= 0; i--) {
            this.commands[i].undo();
        }
    }
}

// ─── Duplicate GameObject Command ─────────────────────────────────────
export class DuplicateGameObjectCommand implements Command {
    name: string;
    private scene: Scene;
    private sourceGO: GameObject;
    private duplicatedGO: GameObject | null = null;

    constructor(scene: Scene, sourceGO: GameObject) {
        this.scene = scene;
        this.sourceGO = sourceGO;
        this.name = `Duplicate ${sourceGO.name}`;
    }

    execute(): void {
        if (this.duplicatedGO) {
            // Re-add previously duplicated GO
            if (this.sourceGO.transform.parent) {
                this.duplicatedGO.transform.setParent(this.sourceGO.transform.parent, false);
            } else if (this.duplicatedGO.transform.parent) {
                this.duplicatedGO.transform.setParent(null, false);
            }
            this.scene.addGameObject(this.duplicatedGO);
            this.placeDuplicateAfterSource();
        } else {
            // Create a deep copy via serialize/deserialize
            const serialized = this.sourceGO.serialize();
            const referenceMap = new Map<string, GameObject>();
            this.scene.gameObjects.forEach((go) => referenceMap.set(go.id, go));
            this.duplicatedGO = Prefab.instantiateData(serialized, { externalIdMap: referenceMap });
            this.duplicatedGO.name = this.sourceGO.name + " (Copy)";

            // Parent it under the same parent
            if (this.sourceGO.transform.parent) {
                this.duplicatedGO.transform.setParent(this.sourceGO.transform.parent, false);
            }
            this.scene.addGameObject(this.duplicatedGO);
            this.placeDuplicateAfterSource();
        }
    }

    undo(): void {
        if (this.duplicatedGO) {
            this.scene.removeGameObject(this.duplicatedGO, { destroy: false });
        }
    }

    getDuplicatedGameObject(): GameObject | null {
        return this.duplicatedGO;
    }

    private placeDuplicateAfterSource(): void {
        if (!this.duplicatedGO) return;

        const sourceParent = this.sourceGO.transform.parent;
        if (sourceParent) {
            const siblings = sourceParent.children;
            const sourceIndex = siblings.indexOf(this.sourceGO.transform);
            if (sourceIndex < 0) return;
            const targetIndex = Math.min(sourceIndex + 1, siblings.length - 1);
            this.duplicatedGO.transform.setSiblingIndex(targetIndex);
            return;
        }

        this.reorderRootDuplicateAfterSource();
    }

    private reorderRootDuplicateAfterSource(): void {
        if (!this.duplicatedGO) return;
        if (this.sourceGO.transform.parent || this.duplicatedGO.transform.parent) return;

        const roots = this.scene.gameObjects.filter((go) => go.transform.parent === null);
        const sourceIndex = roots.indexOf(this.sourceGO);
        const duplicateIndex = roots.indexOf(this.duplicatedGO);
        if (sourceIndex < 0 || duplicateIndex < 0) return;

        const reorderedRoots = [...roots];
        const [duplicateRoot] = reorderedRoots.splice(duplicateIndex, 1);
        if (!duplicateRoot) return;
        const targetIndex = Math.min(sourceIndex + 1, reorderedRoots.length);
        reorderedRoots.splice(targetIndex, 0, duplicateRoot);

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
