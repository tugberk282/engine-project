import * as THREE from 'three';

export type SceneCameraNavigationSnapshot = {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    orbitTarget: THREE.Vector3;
    orbitDistance: number;
    pitch: number;
    yaw: number;
};

export class SceneCameraNavigation {
    public speed = 10;
    public sensitivity = 0.1;
    public pitch = 0;
    public yaw = 0;
    public orbitTarget = new THREE.Vector3();
    public orbitDistance = 5;
    private interactionStart: SceneCameraNavigationSnapshot | null = null;
    private readonly camera: THREE.Object3D;

    constructor(camera: THREE.Object3D) {
        this.camera = camera;
    }

    public beginInteraction(): void {
        this.interactionStart = this.snapshot();
    }

    public cancelInteraction(): boolean {
        if (!this.interactionStart) return false;
        this.restore(this.interactionStart);
        this.interactionStart = null;
        return true;
    }

    public endInteraction(): void {
        this.interactionStart = null;
    }

    public focus(target: THREE.Vector3, radius = 1): void {
        this.orbitTarget.copy(target);
        this.orbitDistance = Math.max(radius * 2.5, 0.01);
        const offset = new THREE.Vector3(0, 0, this.orbitDistance).applyQuaternion(this.camera.quaternion);
        this.camera.position.copy(this.orbitTarget).add(offset);
    }

    public orbit(deltaX: number, deltaY: number, scale = 1): void {
        this.yaw -= deltaX * this.sensitivity * scale;
        this.pitch = THREE.MathUtils.clamp(
            this.pitch - deltaY * this.sensitivity * scale,
            -Math.PI / 2 + 0.001,
            Math.PI / 2 - 0.001
        );
        const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
        this.camera.position.copy(this.orbitTarget).add(
            new THREE.Vector3(0, 0, this.orbitDistance).applyQuaternion(quaternion)
        );
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }

    public pan(deltaX: number, deltaY: number, scale = 1): void {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
        const displacement = right.multiplyScalar(-deltaX * this.sensitivity * scale)
            .add(up.multiplyScalar(deltaY * this.sensitivity * scale));
        this.camera.position.add(displacement);
        this.orbitTarget.add(displacement);
    }

    public zoom(delta: number): void {
        const direction = this.orbitTarget.clone().sub(this.camera.position);
        if (direction.lengthSq() < 0.000001) {
            direction.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
        } else {
            direction.normalize();
        }
        const nextDistance = Math.max(0.01, this.orbitDistance - delta * 0.01 * this.speed);
        this.camera.position.copy(this.orbitTarget).addScaledVector(direction, -nextDistance);
        this.orbitDistance = nextDistance;
    }

    private snapshot(): SceneCameraNavigationSnapshot {
        return {
            position: this.camera.position.clone(),
            rotation: this.camera.rotation.clone(),
            orbitTarget: this.orbitTarget.clone(),
            orbitDistance: this.orbitDistance,
            pitch: this.pitch,
            yaw: this.yaw
        };
    }

    private restore(snapshot: SceneCameraNavigationSnapshot): void {
        this.camera.position.copy(snapshot.position);
        this.camera.rotation.copy(snapshot.rotation);
        this.orbitTarget.copy(snapshot.orbitTarget);
        this.orbitDistance = snapshot.orbitDistance;
        this.pitch = snapshot.pitch;
        this.yaw = snapshot.yaw;
    }
}
