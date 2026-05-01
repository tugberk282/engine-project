import { Component } from '../Component';
import { GameObject } from '../GameObject';
import { Camera as CameraComponent } from './Camera';
import * as THREE from 'three';

export enum RenderMode {
    ScreenSpaceOverlay = 'ScreenSpaceOverlay',
    ScreenSpaceCamera = 'ScreenSpaceCamera',
    WorldSpace = 'WorldSpace'
}

export enum CanvasScaleMode {
    ConstantPixelSize = 'ConstantPixelSize',
    ScaleWithScreenSize = 'ScaleWithScreenSize'
}

/**
 * Canvas - Unity-style UI canvas
 */
export class Canvas extends Component {
    public renderMode: RenderMode = RenderMode.ScreenSpaceOverlay;
    public sortingOrder: number = 0;
    public pixelPerfect: boolean = false;
    public scaleMode: CanvasScaleMode = CanvasScaleMode.ScaleWithScreenSize;
    public referenceResolution: THREE.Vector2 = new THREE.Vector2(1920, 1080);
    public matchWidthOrHeight: number = 0.5;
    public planeDistance: number = 100;
    public worldSpacePixelsPerUnit: number = 100;
    public targetCamera: GameObject | null = null;

    private htmlElement: HTMLDivElement | null = null;
    private logicalSize: { width: number; height: number } = { width: 1920, height: 1080 };

    public awake(): void {
        this.createCanvas();
        this.syncCanvasElement();
    }

    public update(): void {
        this.syncCanvasElement();
    }

    private createCanvas(): void {
        if (this.htmlElement) return;

        this.htmlElement = document.createElement('div');
        this.htmlElement.className = 'unity-canvas';
        this.htmlElement.style.position = 'absolute';
        this.htmlElement.style.top = '0';
        this.htmlElement.style.left = '0';
        this.htmlElement.style.pointerEvents = 'none';
        this.htmlElement.style.overflow = 'hidden';
        this.htmlElement.style.transformOrigin = 'top left';
        this.htmlElement.style.willChange = 'transform';
        this.getCanvasContainer().appendChild(this.htmlElement);
    }

    public addUIElement(element: HTMLElement): void {
        if (this.htmlElement) {
            this.htmlElement.appendChild(element);
        }
    }

    public getRootElement(): HTMLDivElement | null {
        return this.htmlElement;
    }

    public getRenderCamera(): THREE.Camera | null {
        return this.resolveRenderCamera();
    }

    public getDistanceToRenderCamera(): number | null {
        const renderCamera = this.resolveRenderCamera();
        if (!renderCamera) return null;
        if (this.renderMode === RenderMode.ScreenSpaceCamera) {
            return this.planeDistance;
        }

        if (this.renderMode === RenderMode.WorldSpace) {
            const cameraPosition = new THREE.Vector3();
            const canvasPosition = new THREE.Vector3();
            renderCamera.getWorldPosition(cameraPosition);
            this.gameObject.object3D.getWorldPosition(canvasPosition);
            return cameraPosition.distanceTo(canvasPosition);
        }

        return null;
    }

    public removeUIElement(element: HTMLElement): void {
        if (this.htmlElement && this.htmlElement.contains(element)) {
            this.htmlElement.removeChild(element);
        }
    }

    public setRenderMode(mode: RenderMode): void {
        this.renderMode = mode;
        this.syncCanvasElement();
    }

    public getPixelSize(): { width: number; height: number } {
        return { ...this.logicalSize };
    }

    public setSortingOrder(order: number): void {
        this.sortingOrder = order;
        this.syncCanvasElement();
    }

    public setPixelPerfect(enabled: boolean): void {
        this.pixelPerfect = enabled;
        this.syncCanvasElement();
    }

    public setScaleMode(mode: CanvasScaleMode): void {
        this.scaleMode = mode;
        this.syncCanvasElement();
    }

    public setReferenceResolution(width: number, height: number): void {
        this.referenceResolution.set(
            Math.max(1, Number.isFinite(width) ? width : this.referenceResolution.x),
            Math.max(1, Number.isFinite(height) ? height : this.referenceResolution.y)
        );
        this.syncCanvasElement();
    }

    public setMatchWidthOrHeight(value: number): void {
        this.matchWidthOrHeight = THREE.MathUtils.clamp(Number.isFinite(value) ? value : this.matchWidthOrHeight, 0, 1);
        this.syncCanvasElement();
    }

    public setPlaneDistance(value: number): void {
        this.planeDistance = Math.max(0.01, Number.isFinite(value) ? value : this.planeDistance);
        this.syncCanvasElement();
    }

    public setWorldSpacePixelsPerUnit(value: number): void {
        this.worldSpacePixelsPerUnit = Math.max(1, Number.isFinite(value) ? value : this.worldSpacePixelsPerUnit);
        this.syncCanvasElement();
    }

    public setTargetCamera(target: GameObject | null): void {
        this.targetCamera = target;
        this.syncCanvasElement();
    }

    private syncCanvasElement(): void {
        this.createCanvas();
        if (!this.htmlElement) return;

        const container = this.getCanvasContainer();
        if (this.htmlElement.parentElement !== container) {
            container.appendChild(this.htmlElement);
        }

        const viewport = this.getViewportSize(container);
        this.logicalSize = this.getLogicalSize(viewport.width, viewport.height);
        const renderCamera = this.resolveRenderCamera();

        this.htmlElement.dataset.renderMode = this.renderMode;
        this.htmlElement.style.zIndex = this.sortingOrder.toString();
        this.htmlElement.style.width = `${this.logicalSize.width}px`;
        this.htmlElement.style.height = `${this.logicalSize.height}px`;
        this.htmlElement.style.display = 'block';

        if (this.renderMode === RenderMode.WorldSpace) {
            this.syncWorldSpaceCanvas(renderCamera, viewport.width, viewport.height);
            return;
        }

        if (this.renderMode === RenderMode.ScreenSpaceCamera && !renderCamera) {
            this.htmlElement.style.display = 'none';
            return;
        }

        this.htmlElement.style.overflow = 'hidden';
        const scale = this.getCanvasScale(this.logicalSize.width, this.logicalSize.height, viewport.width, viewport.height);
        const finalScale = this.pixelPerfect ? Math.max(0.01, Math.round(scale * 1000) / 1000) : scale;
        const offsetX = this.pixelPerfect
            ? Math.round((viewport.width - this.logicalSize.width * finalScale) * 0.5)
            : (viewport.width - this.logicalSize.width * finalScale) * 0.5;
        const offsetY = this.pixelPerfect
            ? Math.round((viewport.height - this.logicalSize.height * finalScale) * 0.5)
            : (viewport.height - this.logicalSize.height * finalScale) * 0.5;

        this.htmlElement.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${finalScale})`;
    }

    private syncWorldSpaceCanvas(renderCamera: THREE.Camera | null, viewportWidth: number, viewportHeight: number): void {
        if (!this.htmlElement) return;
        if (!renderCamera) {
            this.htmlElement.style.display = 'none';
            return;
        }

        const worldPosition = this.gameObject.object3D.getWorldPosition(new THREE.Vector3());
        const projected = worldPosition.clone().project(renderCamera);
        const isVisible = Number.isFinite(projected.x)
            && Number.isFinite(projected.y)
            && Number.isFinite(projected.z)
            && projected.z >= -1
            && projected.z <= 1;
        if (!isVisible) {
            this.htmlElement.style.display = 'none';
            return;
        }

        const screenX = (projected.x * 0.5 + 0.5) * viewportWidth;
        const screenY = (-projected.y * 0.5 + 0.5) * viewportHeight;
        const pixelsPerWorldUnit = this.getPixelsPerWorldUnit(renderCamera, worldPosition, viewportHeight);
        const objectScale = this.gameObject.object3D.getWorldScale(new THREE.Vector3());
        const averageScale = Math.max(0.0001, (Math.abs(objectScale.x) + Math.abs(objectScale.y)) * 0.5);
        const scale = (pixelsPerWorldUnit / this.worldSpacePixelsPerUnit) * averageScale;
        const finalScale = this.pixelPerfect ? Math.max(0.01, Math.round(scale * 1000) / 1000) : scale;

        this.htmlElement.style.overflow = 'visible';
        this.htmlElement.style.transform = `translate(${screenX}px, ${screenY}px) scale(${finalScale})`;
    }

    private getCanvasContainer(): HTMLElement {
        return ((window as any).Editor?.instance?.getActiveUIHostElement?.() as HTMLElement | null)
            || document.getElementById('scene-view')
            || document.body;
    }

    private getViewportSize(container: HTMLElement): { width: number; height: number } {
        return {
            width: container.clientWidth || window.innerWidth,
            height: container.clientHeight || window.innerHeight
        };
    }

    private getLogicalSize(viewportWidth: number, viewportHeight: number): { width: number; height: number } {
        if (this.scaleMode === CanvasScaleMode.ScaleWithScreenSize) {
            return {
                width: Math.max(1, this.referenceResolution.x),
                height: Math.max(1, this.referenceResolution.y)
            };
        }

        return {
            width: Math.max(1, viewportWidth),
            height: Math.max(1, viewportHeight)
        };
    }

    private getCanvasScale(logicalWidth: number, logicalHeight: number, viewportWidth: number, viewportHeight: number): number {
        if (this.scaleMode === CanvasScaleMode.ConstantPixelSize) {
            return 1;
        }

        const widthScale = viewportWidth / Math.max(1, logicalWidth);
        const heightScale = viewportHeight / Math.max(1, logicalHeight);
        const logWidth = Math.log2(Math.max(widthScale, 0.0001));
        const logHeight = Math.log2(Math.max(heightScale, 0.0001));
        return Math.pow(2, THREE.MathUtils.lerp(logWidth, logHeight, this.matchWidthOrHeight));
    }

    private resolveRenderCamera(): THREE.Camera | null {
        const targetCameraComponent = this.targetCamera?.getComponent(CameraComponent);
        if (targetCameraComponent?.camera) {
            return targetCameraComponent.camera;
        }

        return ((window as any).Editor?.instance?.resolveCanvasRenderCamera?.(this.targetCamera) as THREE.Camera | undefined)
            ?? ((window as any).Editor?.instance?.camera as THREE.Camera | undefined)
            ?? null;
    }

    private getPixelsPerWorldUnit(camera: THREE.Camera, worldPosition: THREE.Vector3, viewportHeight: number): number {
        if (camera instanceof THREE.PerspectiveCamera) {
            const cameraPosition = new THREE.Vector3();
            camera.getWorldPosition(cameraPosition);
            const distance = Math.max(0.01, cameraPosition.distanceTo(worldPosition));
            const frustumHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * distance;
            return viewportHeight / Math.max(0.0001, frustumHeight);
        }

        if (camera instanceof THREE.OrthographicCamera) {
            return viewportHeight / Math.max(0.0001, camera.top - camera.bottom);
        }

        return viewportHeight / Math.max(1, this.planeDistance);
    }

    public serialize(): any {
        return {
            type: 'Canvas',
            data: {
                renderMode: this.renderMode,
                sortingOrder: this.sortingOrder,
                pixelPerfect: this.pixelPerfect,
                scaleMode: this.scaleMode,
                referenceResolution: this.referenceResolution.toArray(),
                matchWidthOrHeight: this.matchWidthOrHeight,
                planeDistance: this.planeDistance,
                worldSpacePixelsPerUnit: this.worldSpacePixelsPerUnit,
                targetCamera: this.targetCamera ? { __ref: this.targetCamera.id, __type: 'GameObject' } : null
            }
        };
    }

    public deserialize(data: any): void {
        this.renderMode = data.renderMode ?? RenderMode.ScreenSpaceOverlay;
        this.sortingOrder = data.sortingOrder ?? 0;
        this.pixelPerfect = data.pixelPerfect ?? false;
        this.scaleMode = data.scaleMode ?? CanvasScaleMode.ScaleWithScreenSize;
        if (Array.isArray(data.referenceResolution) && data.referenceResolution.length >= 2) {
            this.referenceResolution.fromArray(data.referenceResolution);
        }
        this.matchWidthOrHeight = THREE.MathUtils.clamp(data.matchWidthOrHeight ?? 0.5, 0, 1);
        this.planeDistance = Math.max(0.01, data.planeDistance ?? 100);
        this.worldSpacePixelsPerUnit = Math.max(1, data.worldSpacePixelsPerUnit ?? 100);
        this.targetCamera = data.targetCamera instanceof GameObject ? data.targetCamera : null;
        this.syncCanvasElement();
    }

    public onDestroy(): void {
        if (this.htmlElement && this.htmlElement.parentNode) {
            this.htmlElement.parentNode.removeChild(this.htmlElement);
            this.htmlElement = null;
        }
    }
}
