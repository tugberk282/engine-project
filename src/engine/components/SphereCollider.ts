import { Collider } from "./Collider";
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GameObject } from "../GameObject";
import { RigidBody } from "./RigidBody";

export class SphereCollider extends Collider {
    public radius: number = 0.5;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    public getShape(): CANNON.Shape {
        return new CANNON.Sphere(this.radius);
    }

    public updateCollider(): void {
        const rb = this.gameObject.getComponent(RigidBody);
        if (rb) {
            rb.refreshShape();
        }
    }

    public getBounds(): THREE.Sphere {
        const worldSphere = new THREE.Sphere(this.center.clone(), this.radius);
        worldSphere.center.add(this.gameObject.transform.position);
        return worldSphere;
    }

    public createGizmo(): THREE.Object3D {
        const geometry = new THREE.SphereGeometry(1, 16, 16);
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
            mesh.scale.set(this.radius, this.radius, this.radius);
            mesh.position.copy(this.gameObject.transform.position).add(this.center);
            // Sphere rotation doesn't matter for collider bounds usually, but good to match
            mesh.rotation.copy(this.gameObject.transform.rotation);
        }
    }

    public setRadius(radius: number) {
        this.radius = radius;
        this.updateCollider();
    }

    public serialize(): any {
        return {
            type: 'SphereCollider',
            data: {
                center: [this.center.x, this.center.y, this.center.z],
                radius: this.radius,
                isTrigger: this.isTrigger,
                friction: this.friction,
                restitution: this.restitution
            }
        };
    }

    public deserialize(data: any): void {
        if (data.center) this.center.set(data.center[0], data.center[1], data.center[2]);
        if (data.radius !== undefined) this.radius = data.radius;
        this.isTrigger = data.isTrigger ?? false;
        this.friction = data.friction !== undefined ? data.friction : 0.5;
        this.restitution = data.restitution !== undefined ? data.restitution : 0.0;
        this.updateCollider();
    }
}
