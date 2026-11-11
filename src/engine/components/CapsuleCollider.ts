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

    public getShapeOrientation(): CANNON.Quaternion | undefined {
        const orientation = new CANNON.Quaternion();
        if (this.direction === 'X') orientation.setFromEuler(0, Math.PI / 2, 0);
        else if (this.direction === 'Y') orientation.setFromEuler(-Math.PI / 2, 0, 0);
        return orientation;
    }

    public getBounds(): THREE.Box3 {
        const box = new THREE.Box3();
        const halfSize = new THREE.Vector3(this.radius, this.radius, this.radius);
        halfSize[this.direction.toLowerCase() as 'x' | 'y' | 'z'] = this.height / 2;
        const min = halfSize.clone().multiplyScalar(-1);
        const max = halfSize;
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
        const mesh = new THREE.Mesh(geometry, material);
        this.applyDirection(mesh);
        return mesh;
    }

    public updateGizmo(mesh: THREE.Object3D): void {
        if (mesh instanceof THREE.Mesh) {
            mesh.position.copy(this.gameObject.transform.position).add(this.center);
            mesh.rotation.copy(this.gameObject.transform.rotation);
            this.applyDirection(mesh);
        }
    }

    public setRadius(radius: number) {
        if (!Number.isFinite(radius)) return;
        this.radius = Math.max(0.0001, radius);
        this.height = Math.max(this.height, this.radius * 2);
        this.updateCollider();
    }

    public setHeight(height: number) {
        if (!Number.isFinite(height)) return;
        this.height = Math.max(this.radius * 2, height);
        this.updateCollider();
    }

    public setDirection(direction: 'X' | 'Y' | 'Z') {
        if (direction !== 'X' && direction !== 'Y' && direction !== 'Z') return;
        this.direction = direction;
        this.updateCollider();
    }

    private applyDirection(mesh: THREE.Object3D): void {
        if (this.direction === 'X') mesh.rotateZ(-Math.PI / 2);
        else if (this.direction === 'Z') mesh.rotateX(Math.PI / 2);
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
        if (data.direction === 'X' || data.direction === 'Y' || data.direction === 'Z') this.direction = data.direction;
        else if (data.direction === 0) this.direction = 'X';
        else if (data.direction === 1) this.direction = 'Y';
        else if (data.direction === 2) this.direction = 'Z';
        this.isTrigger = data.isTrigger ?? false;
        this.friction = data.friction !== undefined ? data.friction : 0.5;
        this.restitution = data.restitution !== undefined ? data.restitution : 0.0;
        this.updateCollider();
    }
}
