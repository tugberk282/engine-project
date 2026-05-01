import { Component } from '../Component';
import { GameObject } from '../GameObject';
import * as THREE from 'three';

export type CameraClearFlags = 'Skybox' | 'Solid Color' | 'Depth Only' | "Don't Clear";
export type CameraRenderType = 'Base' | 'Overlay';
export type CameraViewportRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

/**
 * Camera - Unity-style camera component
 */
export class Camera extends Component {
    public camera!: THREE.Camera;
    public fieldOfView: number = 60;
    public nearClipPlane: number = 0.1;
    public farClipPlane: number = 1000;
    public orthographic: boolean = false;
    public orthographicSize: number = 5;
    public clearColor: THREE.Color = new THREE.Color(0.2, 0.3, 0.4);
    public clearAlpha: number = 1;
    public clearFlags: CameraClearFlags = 'Solid Color';
    public viewportRect: CameraViewportRect = { x: 0, y: 0, width: 1, height: 1 };
    public depth: number = 0; // Camera rendering order
    public usePostProcessing: boolean = true;
    public renderType: CameraRenderType = 'Base';
    public stackBaseCamera: GameObject | null = null;
    /**
     * Culling mask bitmask. Each bit corresponds to a layer (0-31).
     * -1 (0xFFFFFFFF) = render everything (default, matches Unity's "Everything").
     * 0 = render nothing.
     * Use (1 << layerIndex) to include specific layers.
     */
    public cullingMask: number = -1; // Everything

    constructor(gameObject: any) {
        super(gameObject);
        this.updateCamera();
    }

    public awake(): void {
        this.updateCamera();
    }

    private updateCamera(): void {
        if (this.orthographic) {
            const aspect = window.innerWidth / window.innerHeight;
            const height = this.orthographicSize;
            const width = height * aspect;
            this.camera = new THREE.OrthographicCamera(
                -width, width,
                height, -height,
                this.nearClipPlane,
                this.farClipPlane
            );
        } else {
            this.camera = new THREE.PerspectiveCamera(
                this.fieldOfView,
                window.innerWidth / window.innerHeight,
                this.nearClipPlane,
                this.farClipPlane
            );
        }

        // Sync camera position with GameObject transform
        this.syncTransform();
    }

    public update(): void {
        this.syncTransform();
    }

    private syncTransform(): void {
        if (this.camera) {
            this.camera.position.copy(this.gameObject.transform.position);
            this.camera.rotation.copy(this.gameObject.transform.rotation);
        }
    }

    public setOrthographic(ortho: boolean): void {
        if (this.orthographic !== ortho) {
            this.orthographic = ortho;
            this.updateCamera();
        }
    }

    public setFieldOfView(fov: number): void {
        this.fieldOfView = fov;
        if (!this.orthographic && this.camera instanceof THREE.PerspectiveCamera) {
            this.camera.fov = fov;
            this.camera.updateProjectionMatrix();
        }
    }

    public setOrthographicSize(size: number): void {
        this.orthographicSize = size;
        if (this.orthographic) {
            this.updateCamera();
        }
    }

    public setClippingPlanes(near: number, far: number): void {
        this.nearClipPlane = near;
        this.farClipPlane = far;

        if (this.camera instanceof THREE.PerspectiveCamera || this.camera instanceof THREE.OrthographicCamera) {
            this.camera.near = near;
            this.camera.far = far;
            this.camera.updateProjectionMatrix();
        }
    }

    public setClearFlags(flags: CameraClearFlags): void {
        this.clearFlags = flags;
    }

    public setRenderType(nextType: CameraRenderType): void {
        this.renderType = nextType;
        if (nextType !== 'Overlay') {
            this.stackBaseCamera = null;
        }
    }

    public getClearColorHex(): string {
        return `#${this.clearColor.getHexString()}`;
    }

    public setClearAlpha(alpha: number): void {
        if (!Number.isFinite(alpha)) return;
        this.clearAlpha = Math.max(0, Math.min(1, alpha));
    }

    public setViewportRect(nextRect: Partial<CameraViewportRect>): void {
        const width = this.clamp01(nextRect.width ?? this.viewportRect.width);
        const height = this.clamp01(nextRect.height ?? this.viewportRect.height);
        const maxX = Math.max(0, 1 - width);
        const maxY = Math.max(0, 1 - height);
        const x = this.clampRange(nextRect.x ?? this.viewportRect.x, 0, maxX);
        const y = this.clampRange(nextRect.y ?? this.viewportRect.y, 0, maxY);
        this.viewportRect = { x, y, width, height };
    }

    /**
     * Check if a given layer index is visible through this camera's culling mask.
     */
    public isLayerVisible(layer: number): boolean {
        if (this.cullingMask === -1) return true; // Everything
        return (this.cullingMask & (1 << layer)) !== 0;
    }

    public serialize(): any {
        return {
            type: 'Camera',
            data: {
                fieldOfView: this.fieldOfView,
                nearClipPlane: this.nearClipPlane,
                farClipPlane: this.farClipPlane,
                orthographic: this.orthographic,
                orthographicSize: this.orthographicSize,
                clearColor: this.clearColor.toArray(),
                clearAlpha: this.clearAlpha,
                clearFlags: this.clearFlags,
                viewportRect: {
                    x: this.viewportRect.x,
                    y: this.viewportRect.y,
                    width: this.viewportRect.width,
                    height: this.viewportRect.height
                },
                depth: this.depth,
                usePostProcessing: this.usePostProcessing,
                renderType: this.renderType,
                stackBaseCamera: this.stackBaseCamera ? { __ref: this.stackBaseCamera.id, __type: 'GameObject' } : null,
                cullingMask: this.cullingMask
            }
        };
    }

    public deserialize(data: any): void {
        this.fieldOfView = data.fieldOfView ?? 60;
        this.nearClipPlane = data.nearClipPlane ?? 0.1;
        this.farClipPlane = data.farClipPlane ?? 1000;
        this.orthographic = data.orthographic ?? false;
        this.orthographicSize = data.orthographicSize ?? 5;
        if (data.clearColor) this.clearColor.fromArray(data.clearColor);
        this.clearAlpha = Number.isFinite(data.clearAlpha) ? Math.max(0, Math.min(1, data.clearAlpha)) : 1;
        this.clearFlags = data.clearFlags ?? 'Solid Color';
        this.setViewportRect({
            x: data.viewportRect?.x ?? 0,
            y: data.viewportRect?.y ?? 0,
            width: data.viewportRect?.width ?? 1,
            height: data.viewportRect?.height ?? 1
        });
        this.depth = data.depth ?? 0;
        this.usePostProcessing = data.usePostProcessing ?? true;
        this.renderType = data.renderType === 'Overlay' ? 'Overlay' : 'Base';
        this.stackBaseCamera = data.stackBaseCamera instanceof GameObject ? data.stackBaseCamera : null;
        this.cullingMask = data.cullingMask !== undefined ? data.cullingMask : -1;
        this.updateCamera();
    }

    private clamp01(value: number): number {
        if (!Number.isFinite(value)) return 0;
        return Math.max(0, Math.min(1, value));
    }

    private clampRange(value: number, min: number, max: number): number {
        if (!Number.isFinite(value)) return min;
        return Math.max(min, Math.min(max, value));
    }

    // --- Gizmo ---
    public createGizmo(): THREE.Object3D {
        if (!this.camera) this.updateCamera();
        const helper = new THREE.CameraHelper(this.camera);
        // @ts-ignore
        helper.material.depthTest = false;
        // @ts-ignore
        helper.material.opacity = 0.5;
        // @ts-ignore
        helper.material.transparent = true;
        return helper;
    }

    public updateGizmo(helper: THREE.Object3D): void {
        if ((helper as any).update) (helper as any).update();
        helper.visible = this.enabled;
    }
}
