import { Component } from '../Component';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export abstract class Collider extends Component {
    public isTrigger: boolean = false;
    public center: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
    public friction: number = 0.5;
    public restitution: number = 0.0;

    // Abstract methods that subclasses must implement
    public abstract getShape(): CANNON.Shape;
    public abstract updateCollider(): void;
    public abstract getBounds(): THREE.Box3 | THREE.Sphere; // simplified return type for now
    public abstract createGizmo(): THREE.Object3D;
    public abstract updateGizmo(mesh: THREE.Object3D): void;
    public setCenter(center: THREE.Vector3): void {
        this.center.copy(center);
        this.updateCollider();
    }
}
