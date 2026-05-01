import { Component } from '../Component';
import { GameObject } from '../GameObject';
import * as THREE from 'three';

export class Transform extends Component {

    private _parent: Transform | null = null;
    private _children: Transform[] = [];

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    public get position(): THREE.Vector3 {
        return this.gameObject.object3D.position;
    }

    public set position(value: THREE.Vector3) {
        this.gameObject.object3D.position.copy(value);
    }

    public get rotation(): THREE.Euler {
        return this.gameObject.object3D.rotation;
    }

    public set rotation(value: THREE.Euler) {
        this.gameObject.object3D.rotation.copy(value);
    }

    public get scale(): THREE.Vector3 {
        return this.gameObject.object3D.scale;
    }

    public set scale(value: THREE.Vector3) {
        this.gameObject.object3D.scale.copy(value);
    }

    // --- Hierarchy ---

    public get parent(): Transform | null {
        return this._parent;
    }

    public set parent(value: Transform | null) {
        this.setParent(value);
    }

    public setParent(parent: Transform | null, worldPositionStays: boolean = true) {
        if (this._parent === parent) return;

        // Remove from old parent
        if (this._parent) {
            const index = this._parent._children.indexOf(this);
            if (index > -1) this._parent._children.splice(index, 1);
        }

        this._parent = parent;

        if (parent) {
            parent._children.push(this);
            if (worldPositionStays) {
                parent.gameObject.object3D.attach(this.gameObject.object3D);
            } else {
                parent.gameObject.object3D.add(this.gameObject.object3D);
            }
        } else {
            // Detaching from parent, attach to scene root
            if (this.gameObject.scene) {
                if (worldPositionStays) {
                    this.gameObject.scene.threeScene.attach(this.gameObject.object3D);
                } else {
                    this.gameObject.scene.threeScene.add(this.gameObject.object3D);
                }
            } else {
                // Fallback if no scene known (shouldn't happen in game)
                this.gameObject.object3D.removeFromParent();
            }
        }
    }

    public get childCount(): number {
        return this._children.length;
    }

    public getChild(index: number): Transform | null {
        if (index >= 0 && index < this._children.length) {
            return this._children[index];
        }
        return null;
    }

    public get children(): Transform[] {
        return this._children;
    }

    public get siblingIndex(): number {
        if (!this._parent) return -1;
        return this._parent._children.indexOf(this);
    }

    public setSiblingIndex(index: number): void {
        if (!this._parent) return;

        const siblings = this._parent._children;
        const fromIndex = siblings.indexOf(this);
        if (fromIndex < 0) return;

        const clampedIndex = Math.max(0, Math.min(index, siblings.length - 1));
        if (clampedIndex === fromIndex) return;

        siblings.splice(fromIndex, 1);
        siblings.splice(clampedIndex, 0, this);

        const parentObject3D = this._parent.gameObject.object3D;
        const objectChildren = parentObject3D.children;
        const objectFromIndex = objectChildren.indexOf(this.gameObject.object3D);
        if (objectFromIndex < 0) return;

        objectChildren.splice(objectFromIndex, 1);
        const nextSibling = siblings[clampedIndex + 1]?.gameObject.object3D ?? null;
        if (nextSibling) {
            const nextIndex = objectChildren.indexOf(nextSibling);
            if (nextIndex >= 0) {
                objectChildren.splice(nextIndex, 0, this.gameObject.object3D);
            } else {
                objectChildren.push(this.gameObject.object3D);
            }
        } else {
            objectChildren.push(this.gameObject.object3D);
        }
    }

    public isChildOf(parent: Transform): boolean {
        let current = this._parent;
        while (current) {
            if (current === parent) return true;
            current = current.parent;
        }
        return false;
    }

    public onDestroy() {
        this.setParent(null);
    }
}
