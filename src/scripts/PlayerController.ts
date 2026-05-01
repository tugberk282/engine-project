
import { Component } from '../engine/Component';
import { Input } from '../engine/Input';
import { RigidBody } from '../engine/components/RigidBody';
import * as THREE from 'three';

export class PlayerController extends Component {
    // Configuration
    public moveSpeed: number = 5.0;
    public sprintMultiplier: number = 2.0;
    public jumpForce: number = 5.0;
    public lookSensitivity: number = 0.002;

    // State
    private rigidBody: RigidBody | undefined;
    private rotationY: number = 0;

    public start(): void {
        this.rigidBody = this.gameObject.getComponent(RigidBody);
        if (!this.rigidBody) {
            console.warn("PlayerController: No RigidBody found on GameObject. Physics-based movement will be disabled.");
        }

        // Initialize rotation from current transform
        this.rotationY = this.gameObject.transform.rotation.y;
    }

    public update(deltaTime: number): void {
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

            // Jump
            if (Input.getKey('Space') && Math.abs(currentVel.y) < 0.1) { // Simple ground check
                this.rigidBody.setVelocity(
                    currentVel.x,
                    this.jumpForce,
                    currentVel.z
                );
            }
        } else {
            // Transform-based movement (Fallback)
            this.gameObject.transform.position.x += moveDir.x * speed * deltaTime;
            this.gameObject.transform.position.z += moveDir.z * speed * deltaTime;

            // Simple "Fake" Jump or Y movement not implemented for non-physics fallback to keep it simple
            if (Input.getKey('Space')) {
                this.gameObject.transform.position.y += speed * deltaTime;
            }
            if (Input.getKey('ControlLeft')) {
                this.gameObject.transform.position.y -= speed * deltaTime;
            }
        }
    }
}
