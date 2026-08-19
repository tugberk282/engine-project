
import { Component } from '../engine/Component';
import { Input } from '../engine/Input';
import { RigidBody } from '../engine/components/RigidBody';
import { PhysicsSystem } from '../engine/PhysicsSystem';
import { serialize } from '../engine/Decorators';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class PlayerController extends Component {
    @serialize public moveSpeed: number = 5.0;
    @serialize public sprintMultiplier: number = 1.5;
    @serialize public jumpForce: number = 6.0;
    @serialize public lookSensitivity: number = 0.002;
    @serialize public maxGroundSlope: number = 50;
    @serialize public respawnY: number = -8;

    private rigidBody: RigidBody | undefined;
    private rotationY: number = 0;
    private spawnPosition = new THREE.Vector3();
    private finishBanner: HTMLElement | null = null;
    public grounded: boolean = false;
    public finished: boolean = false;

    public start(): void {
        this.rigidBody = this.gameObject.getComponent(RigidBody);
        if (!this.rigidBody) {
            console.warn("PlayerController: No RigidBody found on GameObject. Physics-based movement will be disabled.");
        }

        // Initialize rotation from current transform
        this.rotationY = this.gameObject.transform.rotation.y;
        this.spawnPosition.copy(this.gameObject.transform.position);
        this.rigidBody?.setFreezeRotation(true, true, true);
    }

    public update(deltaTime: number): void {
        if (this.gameObject.transform.position.y < this.respawnY) {
            this.respawn();
        }
        this.grounded = Boolean(this.rigidBody && PhysicsSystem.getInstance().isGrounded(this.rigidBody, this.maxGroundSlope));
        this.handleLook();
        this.handleMovement(deltaTime);
    }

    private handleLook(): void {
        // Mouse Look
        const mouseX = Input.mouseDelta.x;
        const mouseY = Input.mouseDelta.y;

        if (mouseX !== 0 || mouseY !== 0) {
            this.rotationY -= mouseX * this.lookSensitivity;

            // Optional: Vertical look (clamped) - Only affects camera if we had a dedicated camera setup here
            // For now, we mainly rotate the player body horizontally
            // this.rotationX -= mouseY * this.lookSensitivity;
            // this.rotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.rotationX));

            // Apply rotation to GameObject
            this.gameObject.transform.rotation.y = this.rotationY;
            if (this.rigidBody?.body) {
                this.rigidBody.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), this.rotationY);
            }
        }
    }

    private handleMovement(deltaTime: number): void {
        let speed = this.moveSpeed;
        if (Input.getKey('ShiftLeft') || Input.getKey('ShiftRight')) {
            speed *= this.sprintMultiplier;
        }

        // Calculate movement direction relative to player rotation
        const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotationY);
        const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rotationY);

        const moveDir = new THREE.Vector3();

        // Unity-style Input Axes
        const h = Input.GetAxis("Horizontal"); // A/D
        const v = Input.GetAxis("Vertical");   // W/S

        if (h !== 0) moveDir.add(right.multiplyScalar(h));
        if (v !== 0) moveDir.add(forward.multiplyScalar(v));

        if (moveDir.lengthSq() > 0) {
            moveDir.normalize();
        }

        // Apply Movement
        if (this.rigidBody) {
            // Physics-based movement (Velocity change)
            // We want to control X/Z velocity while preserving Y (gravity)
            const currentVel = this.rigidBody.getVelocity();

            // Simple approach: Set velocity directly (snappy movement)
            // A more physics-correct way would be adding forces, but for player controllers, setting velocity is often preferred for control
            this.rigidBody.setVelocity(
                moveDir.x * speed,
                currentVel.y,
                moveDir.z * speed
            );

            // A jump is an edge-triggered grounded action. Holding Space can
            // never retrigger it in mid-air or on landing.
            if (Input.getButtonDown('Jump') && this.grounded) {
                this.rigidBody.setVelocity(
                    moveDir.x * speed,
                    this.jumpForce,
                    moveDir.z * speed
                );
                this.grounded = false;
            }
        } else {
            // Transform-based movement (Fallback)
            this.gameObject.transform.position.x += moveDir.x * speed * deltaTime;
            this.gameObject.transform.position.z += moveDir.z * speed * deltaTime;

        }
    }

    public onTriggerEnter(other: any): void {
        const trigger = other?.gameObject ?? other;
        const tag = trigger?.tag;
        if (tag === 'Respawn') {
            this.respawn();
        } else if (tag === 'Finish') {
            this.showFinishState();
        }
    }

    public respawn(): void {
        this.finished = false;
        this.finishBanner?.remove();
        this.finishBanner = null;
        this.gameObject.transform.position.copy(this.spawnPosition);
        if (this.rigidBody?.body) {
            this.rigidBody.body.position.set(this.spawnPosition.x, this.spawnPosition.y, this.spawnPosition.z);
            this.rigidBody.body.previousPosition.copy(this.rigidBody.body.position);
            this.rigidBody.body.interpolatedPosition.copy(this.rigidBody.body.position);
            this.rigidBody.setVelocity(0, 0, 0);
            this.rigidBody.body.angularVelocity.set(0, 0, 0);
            this.rigidBody.body.wakeUp();
        }
    }

    public onDestroy(): void {
        this.finishBanner?.remove();
        this.finishBanner = null;
    }

    private showFinishState(): void {
        if (this.finished) return;
        this.finished = true;
        if (typeof document === 'undefined') return;
        const banner = document.createElement('div');
        banner.textContent = 'FINISH!';
        banner.setAttribute('role', 'status');
        banner.style.cssText = 'position:fixed;inset:12% 0 auto;z-index:10000;text-align:center;font:700 48px sans-serif;color:#fff;text-shadow:0 2px 12px #000;pointer-events:none';
        document.body.appendChild(banner);
        this.finishBanner = banner;
    }
}
