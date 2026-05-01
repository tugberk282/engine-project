import { Component } from '../Component';
import { GameObject } from '../GameObject';
import { Input } from '../Input';
import * as THREE from 'three';

export class EditorCameraController extends Component {
    public speed: number = 10;
    public sensitivity: number = 0.1;

    public pitch: number = 0;
    public yaw: number = 0;
    public orbitTarget: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
    public orbitDistance: number = 5;

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    public update(deltaTime: number): void {
        const isOrbit = (Input.getKey('AltLeft') || Input.getKey('AltRight')) && Input.getMouseButton(0);
        const isPan = Input.getMouseButton(1); // Middle mouse
        const isFly = Input.getMouseButton(2); // Right mouse

        const transform = this.gameObject.object3D;

        // --- Zoom (Scroll Wheel) ---
        if (Input.mouseWheel !== 0) {
            const zoomDir = new THREE.Vector3(0, 0, 1).applyQuaternion(transform.quaternion);
            transform.position.add(zoomDir.multiplyScalar(Input.mouseWheel * 0.01 * this.speed));
            // Also update pitch/yaw if we want to zoom towards a target in the future
        }

        // --- Orbit (Alt + LMB) ---
        if (isOrbit) {
            this.yaw -= Input.mouseDelta.x * this.sensitivity * deltaTime * 10;
            this.pitch -= Input.mouseDelta.y * this.sensitivity * deltaTime * 10;
            this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));

            // Orbit logic
            const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
            const offset = new THREE.Vector3(0, 0, this.orbitDistance).applyQuaternion(quat);
            transform.position.copy(this.orbitTarget).add(offset);
            transform.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
        }

        // --- Pan (MMB) ---
        else if (isPan) {
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(transform.quaternion);
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(transform.quaternion);

            transform.position.sub(right.multiplyScalar(Input.mouseDelta.x * this.sensitivity * deltaTime * 20));
            transform.position.add(up.multiplyScalar(Input.mouseDelta.y * this.sensitivity * deltaTime * 20));
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
