import { Collider } from "./Collider";
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GameObject } from "../GameObject";
import { serialize } from "../Decorators";
import { RigidBody } from "./RigidBody";

/**
 * CapsuleCollider - Approximated using CANNON.Cylinder
 */
export class CapsuleCollider extends Collider {
    @serialize public radius: number = 0.5;
    @serialize public height: number = 2.0;
    @serialize public direction: 'X' | 'Y' | 'Z' = 'Y';

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    public getShape(): CANNON.Shape {
        // Cannon doesn't have a built-in Capsule shape, so we use a Cylinder.
        return new CANNON.Cylinder(this.radius, this.radius, this.height, 16);
    }

    public getBounds(): THREE.Box3 {
        const box = new THREE.Box3();
        const halfHeight = this.height / 2;
        const min = new THREE.Vector3(-this.radius, -halfHeight, -this.radius);
        const max = new THREE.Vector3(this.radius, halfHeight, this.radius);
        box.set(min, max);
        box.translate(this.center);
        box.applyMatrix4(this.gameObject.object3D.matrixWorld);
        return box;
    }

    public createGizmo(): THREE.Object3D {
        const geometry = new THREE.CapsuleGeometry(this.radius, this.height - (this.radius * 2), 4, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            wireframe: true,
            depthTest: false,
            transparent: true,
            opacity: 0.5
        });
        return new THREE.Mesh(geometry, material);
    }

    public updateGizmo(mesh: THREE.Object3D): void {
        if (mesh instanceof THREE.Mesh) {
            mesh.position.copy(this.gameObject.transform.position).add(this.center);
            mesh.rotation.copy(this.gameObject.transform.rotation);
        }
    }

    public setRadius(radius: number) {
        this.radius = radius;
        this.updateCollider();
    }

    public setHeight(height: number) {
        this.height = height;
        this.updateCollider();
    }

    public updateCollider(): void {
        const rb = this.gameObject.getComponent(RigidBody);
        if (rb) {
            rb.refreshShape();
        }
    }

    public serialize(): any {
        return {
            type: 'CapsuleCollider',
            data: {
                center: [this.center.x, this.center.y, this.center.z],
                radius: this.radius,
                height: this.height,
                direction: this.direction,
                isTrigger: this.isTrigger,
                friction: this.friction,
                restitution: this.restitution
            }
        };
    }

    public deserialize(data: any): void {
        if (data.center) this.center.set(data.center[0], data.center[1], data.center[2]);
        if (data.radius !== undefined) this.radius = data.radius;
        if (data.height !== undefined) this.height = data.height;
        if (data.direction) this.direction = data.direction;
        this.isTrigger = data.isTrigger ?? false;
        this.friction = data.friction !== undefined ? data.friction : 0.5;
        this.restitution = data.restitution !== undefined ? data.restitution : 0.0;
        this.updateCollider();
    }
}
