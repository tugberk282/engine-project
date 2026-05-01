import { Collider } from "./Collider";
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GameObject } from "../GameObject";
import { RigidBody } from "./RigidBody";

export class BoxCollider extends Collider {
    public size: THREE.Vector3 = new THREE.Vector3(1, 1, 1);

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    public getShape(): CANNON.Shape {
        return new CANNON.Box(new CANNON.Vec3(this.size.x / 2, this.size.y / 2, this.size.z / 2));
    }

    public updateCollider(): void {
        const rb = this.gameObject.getComponent(RigidBody);
        if (rb) {
            rb.refreshShape();
        }
    }

    public getBounds(): THREE.Box3 {
        const halfSize = this.size.clone().multiplyScalar(0.5);
        const min = this.center.clone().sub(halfSize);
        const max = this.center.clone().add(halfSize);
        const box = new THREE.Box3(min, max);
        box.translate(this.gameObject.transform.position);
        return box;
    }

    public createGizmo(): THREE.Object3D {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            wireframe: true,
            depthTest: false,
            transparent: true,
            opacity: 0.5
        });
        const mesh = new THREE.Mesh(geometry, material);
        // It will be scaled/positioned by the Editor gizmo system
        return mesh;
    }

    public updateGizmo(mesh: THREE.Object3D): void {
        if (mesh instanceof THREE.Mesh) {
            mesh.scale.set(this.size.x, this.size.y, this.size.z);
            mesh.position.copy(this.gameObject.transform.position).add(this.center);
            mesh.rotation.copy(this.gameObject.transform.rotation);
        }
    }

    public setSize(size: THREE.Vector3) {
        this.size.copy(size);
        this.updateCollider();
    }

    public serialize(): any {
        return {
            type: 'BoxCollider',
            data: {
                center: [this.center.x, this.center.y, this.center.z],
                size: [this.size.x, this.size.y, this.size.z],
                isTrigger: this.isTrigger,
                friction: this.friction,
                restitution: this.restitution
            }
        };
    }

    public deserialize(data: any): void {
        if (data.center) this.center.set(data.center[0], data.center[1], data.center[2]);
        if (data.size) this.size.set(data.size[0], data.size[1], data.size[2]);
        this.isTrigger = data.isTrigger ?? false;
        this.friction = data.friction !== undefined ? data.friction : 0.5;
        this.restitution = data.restitution !== undefined ? data.restitution : 0.0;
        this.updateCollider();
    }
}
