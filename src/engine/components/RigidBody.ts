import { Component } from "../Component";
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { GameObject } from "../GameObject";
import { PhysicsSystem } from "../PhysicsSystem";
import { Collider } from "./Collider";

export type RigidbodyInterpolation = 'None' | 'Interpolate' | 'Extrapolate';
export type CollisionDetectionMode = 'Discrete' | 'Continuous' | 'Continuous Dynamic' | 'Continuous Speculative';

export class RigidBody extends Component {
    public mass: number = 1.0;
    public isKinematic: boolean = false;
    public useGravity: boolean = true;
    public drag: number = 0;
    public angularDrag: number = 0.05;
    public freezePositionX: boolean = false;
    public freezePositionY: boolean = false;
    public freezePositionZ: boolean = false;
    public freezeRotationX: boolean = false;
    public freezeRotationY: boolean = false;
    public freezeRotationZ: boolean = false;
    public interpolation: RigidbodyInterpolation = 'None';
    public collisionDetectionMode: CollisionDetectionMode = 'Discrete';
    public body: CANNON.Body | null = null;
    private lastVisualPosition: THREE.Vector3 | null = null;
    private lastVisualQuaternion: THREE.Quaternion | null = null;
    private frozenPositionAnchor: { x: number | null; y: number | null; z: number | null } = {
        x: null,
        y: null,
        z: null
    };

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    public awake(): void {
        this.createBody();
    }

    private createBody(): void {
        if (this.body) return;

        this.body = new CANNON.Body({
            mass: this.isKinematic ? 0 : this.mass,
            type: this.isKinematic ? CANNON.BODY_TYPES.KINEMATIC : (this.mass === 0 ? CANNON.BODY_TYPES.STATIC : CANNON.BODY_TYPES.DYNAMIC),
            fixedRotation: this.freezeRotationX && this.freezeRotationY && this.freezeRotationZ,
            linearDamping: this.drag,
            angularDamping: this.angularDrag,
            allowSleep: true,
            position: new CANNON.Vec3(
                this.gameObject.transform.position.x,
                this.gameObject.transform.position.y,
                this.gameObject.transform.position.z
            )
        });

        // Sync initial rotation
        this.body.quaternion.set(
            this.gameObject.object3D.quaternion.x,
            this.gameObject.object3D.quaternion.y,
            this.gameObject.object3D.quaternion.z,
            this.gameObject.object3D.quaternion.w
        );

        (this.body as any).userData = { gameObject: this.gameObject, rigidBody: this };

        this.refreshShape();

        // Constraints
        if (this.freezeRotationX || this.freezeRotationY || this.freezeRotationZ) {
            this.body.angularFactor.set(
                this.freezeRotationX ? 0 : 1,
                this.freezeRotationY ? 0 : 1,
                this.freezeRotationZ ? 0 : 1
            );
        }

        this.applyRuntimeSettings();

        // Register
        PhysicsSystem.getInstance().registerBody(this);
    }

    public refreshShape(): void {
        if (!this.body) return;

        // Remove old shapes
        while (this.body.shapes.length > 0) {
            this.body.removeShape(this.body.shapes[0]);
        }

        const colliders = this.gameObject.getComponents(Collider as any);
        let hasTrigger = false;

        if (colliders.length > 0) {
            for (const rawCol of colliders) {
                const col = rawCol as unknown as Collider;
                const shape = col.getShape();
                const mat = new CANNON.Material({
                    friction: col.friction,
                    restitution: col.restitution
                });
                this.body.addShape(shape, undefined, undefined);
                // Assign material to the shape (Cannon 0.20+)
                shape.material = mat;
                if (col.isTrigger) hasTrigger = true;
            }
        } else {
            // Default shape if none found
            this.body.addShape(new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)));
        }

        this.body.collisionResponse = !hasTrigger;
        this.body.updateMassProperties();
    }

    public start(): void {
        // Body already created in awake
    }

    public update(): void {
        if (!this.body || !this.isKinematic) return;
        this.syncBodyFromTransform();
    }

    // Called by PhysicsSystem after simulation step
    public syncTransform(stepDelta: number = 1 / 60) {
        if (!this.body) return;
        const nextPosition = new THREE.Vector3(this.body.position.x, this.body.position.y, this.body.position.z);
        const nextQuaternion = new THREE.Quaternion(
            this.body.quaternion.x,
            this.body.quaternion.y,
            this.body.quaternion.z,
            this.body.quaternion.w
        );
        const bodyAny = this.body as any;

        if (this.interpolation === 'Interpolate') {
            const interpolatedPosition = bodyAny.interpolatedPosition as CANNON.Vec3 | undefined;
            const interpolatedQuaternion = bodyAny.interpolatedQuaternion as CANNON.Quaternion | undefined;
            if (interpolatedPosition) {
                nextPosition.set(interpolatedPosition.x, interpolatedPosition.y, interpolatedPosition.z);
            } else if (this.lastVisualPosition) {
                nextPosition.lerp(this.lastVisualPosition, 0.35);
            }
            if (interpolatedQuaternion) {
                nextQuaternion.set(
                    interpolatedQuaternion.x,
                    interpolatedQuaternion.y,
                    interpolatedQuaternion.z,
                    interpolatedQuaternion.w
                );
            } else if (this.lastVisualQuaternion) {
                nextQuaternion.slerp(this.lastVisualQuaternion, 0.35);
            }
        } else if (this.interpolation === 'Extrapolate') {
            nextPosition.add(new THREE.Vector3(
                this.body.velocity.x * stepDelta,
                this.body.velocity.y * stepDelta,
                this.body.velocity.z * stepDelta
            ));
        }

        this.gameObject.transform.position.copy(nextPosition);
        this.gameObject.object3D.quaternion.copy(nextQuaternion);
        this.lastVisualPosition = nextPosition.clone();
        this.lastVisualQuaternion = nextQuaternion.clone();
    }

    public setMass(mass: number) {
        this.mass = mass;
        this.applyRuntimeSettings();
    }

    public setVelocity(x: number, y: number, z: number) {
        if (this.body) {
            this.body.velocity.set(x, y, z);
        }
    }

    public getVelocity(): CANNON.Vec3 {
        return this.body ? this.body.velocity : new CANNON.Vec3();
    }

    public syncBodyFromTransform(): void {
        if (!this.body) return;
        this.body.position.set(
            this.gameObject.transform.position.x,
            this.gameObject.transform.position.y,
            this.gameObject.transform.position.z
        );
        this.body.quaternion.set(
            this.gameObject.object3D.quaternion.x,
            this.gameObject.object3D.quaternion.y,
            this.gameObject.object3D.quaternion.z,
            this.gameObject.object3D.quaternion.w
        );
        this.body.velocity.set(0, 0, 0);
        this.body.angularVelocity.set(0, 0, 0);
        this.updateFrozenPositionAnchors();
    }

    public enforceFrozenPosition(): void {
        if (!this.body) return;

        const bodyAny = this.body as any;
        if (this.freezePositionX && this.frozenPositionAnchor.x !== null) {
            this.body.position.x = this.frozenPositionAnchor.x;
            if (bodyAny.previousPosition) bodyAny.previousPosition.x = this.frozenPositionAnchor.x;
            if (bodyAny.interpolatedPosition) bodyAny.interpolatedPosition.x = this.frozenPositionAnchor.x;
        }
        if (this.freezePositionY && this.frozenPositionAnchor.y !== null) {
            this.body.position.y = this.frozenPositionAnchor.y;
            if (bodyAny.previousPosition) bodyAny.previousPosition.y = this.frozenPositionAnchor.y;
            if (bodyAny.interpolatedPosition) bodyAny.interpolatedPosition.y = this.frozenPositionAnchor.y;
        }
        if (this.freezePositionZ && this.frozenPositionAnchor.z !== null) {
            this.body.position.z = this.frozenPositionAnchor.z;
            if (bodyAny.previousPosition) bodyAny.previousPosition.z = this.frozenPositionAnchor.z;
            if (bodyAny.interpolatedPosition) bodyAny.interpolatedPosition.z = this.frozenPositionAnchor.z;
        }
    }

    public setKinematic(value: boolean): void {
        this.isKinematic = value;
        this.applyRuntimeSettings();
    }

    public setUseGravity(value: boolean): void {
        this.useGravity = value;
        this.applyRuntimeSettings();
    }

    public setDrag(value: number): void {
        this.drag = Math.max(0, Number.isFinite(value) ? value : this.drag);
        this.applyRuntimeSettings();
    }

    public setAngularDrag(value: number): void {
        this.angularDrag = Math.max(0, Number.isFinite(value) ? value : this.angularDrag);
        this.applyRuntimeSettings();
    }

    public setFreezeRotation(x: boolean, y: boolean, z: boolean): void {
        this.freezeRotationX = x;
        this.freezeRotationY = y;
        this.freezeRotationZ = z;
        this.applyRuntimeSettings();
    }

    public setFreezePosition(x: boolean, y: boolean, z: boolean): void {
        const previousX = this.freezePositionX;
        const previousY = this.freezePositionY;
        const previousZ = this.freezePositionZ;
        this.freezePositionX = x;
        this.freezePositionY = y;
        this.freezePositionZ = z;

        if (this.body) {
            if (!previousX && x) this.frozenPositionAnchor.x = this.body.position.x;
            if (!previousY && y) this.frozenPositionAnchor.y = this.body.position.y;
            if (!previousZ && z) this.frozenPositionAnchor.z = this.body.position.z;
            if (previousX && !x) this.frozenPositionAnchor.x = null;
            if (previousY && !y) this.frozenPositionAnchor.y = null;
            if (previousZ && !z) this.frozenPositionAnchor.z = null;
        }

        this.applyRuntimeSettings();
    }

    public setInterpolation(mode: RigidbodyInterpolation): void {
        this.interpolation = mode;
    }

    public setCollisionDetectionMode(mode: CollisionDetectionMode): void {
        this.collisionDetectionMode = mode;
        this.applyRuntimeSettings();
    }

    public onDestroy(): void {
        if (this.body) {
            PhysicsSystem.getInstance().unregisterBody(this);
            this.body = null;
        }
    }

    public serialize(): any {
        return {
            type: 'RigidBody',
            data: {
                mass: this.mass,
                isKinematic: this.isKinematic,
                useGravity: this.useGravity,
                drag: this.drag,
                angularDrag: this.angularDrag,
                freezePositionX: this.freezePositionX,
                freezePositionY: this.freezePositionY,
                freezePositionZ: this.freezePositionZ,
                freezeRotationX: this.freezeRotationX,
                freezeRotationY: this.freezeRotationY,
                freezeRotationZ: this.freezeRotationZ,
                interpolation: this.interpolation,
                collisionDetectionMode: this.collisionDetectionMode
            }
        };
    }

    public deserialize(data: any): void {
        this.mass = data.mass !== undefined ? data.mass : 1.0;
        this.isKinematic = data.isKinematic ?? false;
        this.useGravity = data.useGravity !== undefined ? data.useGravity : true;
        this.drag = data.drag ?? 0;
        this.angularDrag = data.angularDrag !== undefined ? data.angularDrag : 0.05;
        this.freezePositionX = data.freezePositionX ?? false;
        this.freezePositionY = data.freezePositionY ?? false;
        this.freezePositionZ = data.freezePositionZ ?? false;
        this.freezeRotationX = data.freezeRotationX ?? false;
        this.freezeRotationY = data.freezeRotationY ?? false;
        this.freezeRotationZ = data.freezeRotationZ ?? false;
        this.interpolation = data.interpolation ?? 'None';
        this.collisionDetectionMode = data.collisionDetectionMode ?? 'Discrete';
        this.applyRuntimeSettings();
    }

    private applyRuntimeSettings(): void {
        if (!this.body) return;

        this.body.mass = this.isKinematic ? 0 : this.mass;
        this.body.type = this.isKinematic ? CANNON.BODY_TYPES.KINEMATIC : (this.mass === 0 ? CANNON.BODY_TYPES.STATIC : CANNON.BODY_TYPES.DYNAMIC);
        this.body.linearDamping = this.drag;
        this.body.angularDamping = this.angularDrag;
        this.body.linearFactor.set(
            this.freezePositionX ? 0 : 1,
            this.freezePositionY ? 0 : 1,
            this.freezePositionZ ? 0 : 1
        );
        this.body.angularFactor.set(
            this.freezeRotationX ? 0 : 1,
            this.freezeRotationY ? 0 : 1,
            this.freezeRotationZ ? 0 : 1
        );
        this.updateFrozenPositionAnchors();
        (this.body as any).gravityScale = this.useGravity ? 1 : 0;
        this.applyCollisionDetectionRuntimeMode();
        this.body.updateMassProperties();
    }

    private applyCollisionDetectionRuntimeMode(): void {
        if (!this.body) return;
        const bodyAny = this.body as any;
        switch (this.collisionDetectionMode) {
            case 'Discrete':
                bodyAny.ccdSpeedThreshold = -1;
                bodyAny.ccdIterations = 0;
                break;
            case 'Continuous':
                bodyAny.ccdSpeedThreshold = 0;
                bodyAny.ccdIterations = 10;
                break;
            case 'Continuous Dynamic':
                bodyAny.ccdSpeedThreshold = 0;
                bodyAny.ccdIterations = 20;
                break;
            case 'Continuous Speculative':
                bodyAny.ccdSpeedThreshold = 0;
                bodyAny.ccdIterations = 5;
                break;
        }
    }

    private updateFrozenPositionAnchors(): void {
        if (!this.body) return;
        this.frozenPositionAnchor.x = this.freezePositionX ? this.body.position.x : null;
        this.frozenPositionAnchor.y = this.freezePositionY ? this.body.position.y : null;
        this.frozenPositionAnchor.z = this.freezePositionZ ? this.body.position.z : null;
    }
}
