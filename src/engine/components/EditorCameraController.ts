import { Component } from '../Component';
import { GameObject } from '../GameObject';
import { Input } from '../Input';
import * as THREE from 'three';
import { SceneCameraNavigation } from '../../editor/SceneCameraNavigation';

export class EditorCameraController extends Component {
    public speed: number = 10;
    public sensitivity: number = 0.1;

    public pitch: number = 0;
    public yaw: number = 0;
    public orbitTarget: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
    public orbitDistance: number = 5;
    private readonly navigation: SceneCameraNavigation;

    constructor(gameObject: GameObject) {
        super(gameObject);
        this.navigation = new SceneCameraNavigation(gameObject.object3D);
    }

    public beginInteraction(): void {
        this.syncNavigationIn();
        this.navigation.beginInteraction();
    }

    public cancelInteraction(): boolean {
        const cancelled = this.navigation.cancelInteraction();
        this.syncNavigationOut();
        return cancelled;
    }

    public endInteraction(): void {
        this.navigation.endInteraction();
    }

    public focus(target: THREE.Vector3, radius: number = 1): void {
        this.syncNavigationIn();
        this.navigation.focus(target, radius);
        this.syncNavigationOut();
    }

    public orbit(deltaX: number, deltaY: number, scale: number = 1): void {
        this.syncNavigationIn();
        this.navigation.orbit(deltaX, deltaY, scale);
        this.syncNavigationOut();
    }

    public pan(deltaX: number, deltaY: number, scale: number = 1): void {
        this.syncNavigationIn();
        this.navigation.pan(deltaX, deltaY, scale);
        this.syncNavigationOut();
    }

    public zoom(delta: number): void {
        this.syncNavigationIn();
        this.navigation.zoom(delta);
        this.syncNavigationOut();
    }

    private syncNavigationIn(): void {
        this.navigation.speed = this.speed;
        this.navigation.sensitivity = this.sensitivity;
        this.navigation.pitch = this.pitch;
        this.navigation.yaw = this.yaw;
        this.navigation.orbitTarget.copy(this.orbitTarget);
        this.navigation.orbitDistance = this.orbitDistance;
    }

    private syncNavigationOut(): void {
        this.pitch = this.navigation.pitch;
        this.yaw = this.navigation.yaw;
        this.orbitTarget.copy(this.navigation.orbitTarget);
        this.orbitDistance = this.navigation.orbitDistance;
    }

    public update(deltaTime: number): void {
        const isOrbit = (Input.getKey('AltLeft') || Input.getKey('AltRight')) && Input.getMouseButton(0);
        const isPan = Input.getMouseButton(1); // Middle mouse
        const isFly = Input.getMouseButton(2); // Right mouse

        const transform = this.gameObject.object3D;

        // --- Zoom (Scroll Wheel) ---
        if (Input.mouseWheel !== 0) {
            this.zoom(Input.mouseWheel);
        }

        // --- Orbit (Alt + LMB) ---
        if (isOrbit) {
            this.orbit(Input.mouseDelta.x, Input.mouseDelta.y, deltaTime * 10);
        }

        // --- Pan (MMB) ---
        else if (isPan) {
            this.pan(Input.mouseDelta.x, Input.mouseDelta.y, deltaTime * 20);
        }

        // --- Fly (RMB) ---
        else if (isFly) {
            let actualSpeed = this.speed;
            if (Input.getKey('ShiftLeft') || Input.getKey('ShiftRight')) actualSpeed *= 4; // Shift Boost

            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(transform.quaternion);
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(transform.quaternion);
            const up = new THREE.Vector3(0, 1, 0);

            if (Input.getKey('KeyW')) transform.position.add(forward.clone().multiplyScalar(actualSpeed * deltaTime));
            if (Input.getKey('KeyS')) transform.position.sub(forward.clone().multiplyScalar(actualSpeed * deltaTime));
            if (Input.getKey('KeyD')) transform.position.add(right.clone().multiplyScalar(actualSpeed * deltaTime));
            if (Input.getKey('KeyA')) transform.position.sub(right.clone().multiplyScalar(actualSpeed * deltaTime));
            if (Input.getKey('KeyE')) transform.position.add(up.clone().multiplyScalar(actualSpeed * deltaTime));
            if (Input.getKey('KeyQ')) transform.position.sub(up.clone().multiplyScalar(actualSpeed * deltaTime));

            // Rotation (Smoother)
            const rotSpeed = this.sensitivity * deltaTime * 15;
            this.yaw -= Input.mouseDelta.x * rotSpeed;
            this.pitch -= Input.mouseDelta.y * rotSpeed;
            this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));
            transform.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
        }
    }
}
