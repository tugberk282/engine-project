import { Component } from '../Component';
import { serialize } from '../Decorators';
import { GameObject } from '../GameObject';
import * as THREE from 'three';
import { Canvas } from './Canvas';
import { Transform } from './Transform';
import { UIRaycastTarget } from './UIEventInterfaces';

export type UIRaycastHit = {
    raycaster: GraphicRaycaster;
    canvas: Canvas;
    element: HTMLElement;
    target: UIRaycastTarget;
    sortingOrder: number;
    renderModePriority: number;
    hierarchyOrder: number[];
    registrationOrder: number;
};

export class GraphicRaycaster extends Component {
    @serialize public ignoreReversedGraphics: boolean = true;
    @serialize public blockingObjects: 'None' | 'TwoD' | 'ThreeD' | 'All' = 'None';
    @serialize public blockingMask: number = -1;

    private static activeRaycasters: Set<GraphicRaycaster> = new Set();

    private graphics: Map<HTMLElement, UIRaycastTarget> = new Map();
    private registrationOrder: Map<HTMLElement, number> = new Map();
    private nextRegistrationOrder: number = 0;

    public awake(): void {
        if (this.enabled) {
            GraphicRaycaster.activeRaycasters.add(this);
        }
    }

    public onEnable(): void {
        GraphicRaycaster.activeRaycasters.add(this);
    }

    public onDisable(): void {
        GraphicRaycaster.activeRaycasters.delete(this);
    }

    public registerGraphic(target: UIRaycastTarget, element: HTMLElement): void {
        this.graphics.set(element, target);
        if (!this.registrationOrder.has(element)) {
            this.registrationOrder.set(element, this.nextRegistrationOrder++);
        }
    }

    public unregisterGraphic(element: HTMLElement): void {
        this.graphics.delete(element);
        this.registrationOrder.delete(element);
    }

    public raycast(screenPosition: { x: number; y: number }, hostElement?: HTMLElement | null): UIRaycastHit[] {
        const canvas = this.gameObject.getComponent(Canvas);
        const rootElement = canvas?.getRootElement() ?? null;
        if (!canvas || !rootElement || rootElement.style.display === 'none') {
            return [];
        }

        if (hostElement && rootElement !== hostElement && !hostElement.contains(rootElement)) {
            return [];
        }

        if (this.ignoreReversedGraphics && this.isCanvasFacingAway(canvas)) {
            return [];
        }

        if (this.isBlockedBySceneObjects(screenPosition, canvas, hostElement)) {
            return [];
        }

        const hits: UIRaycastHit[] = [];
        const seenTargets = new Set<UIRaycastTarget>();
        const elements = document.elementsFromPoint(screenPosition.x, screenPosition.y);

        for (const candidate of elements) {
            if (!(candidate instanceof HTMLElement)) continue;
            if (candidate !== rootElement && !rootElement.contains(candidate)) continue;

            let current: HTMLElement | null = candidate;
            while (current) {
                const target = this.graphics.get(current);
                if (target && !seenTargets.has(target) && target.isRaycastTargetEnabled()) {
                    seenTargets.add(target);
                    hits.push({
                        raycaster: this,
                        canvas,
                        element: current,
                        target,
                        sortingOrder: canvas.sortingOrder ?? 0,
                        renderModePriority: this.getRenderModePriority(canvas),
                        hierarchyOrder: this.getHierarchyOrder(target.gameObject, this.gameObject),
                        registrationOrder: this.registrationOrder.get(current) ?? 0
                    });
                    break;
                }

                if (current === rootElement) {
                    break;
                }
                current = current.parentElement;
            }
        }

        return hits;
    }

    public getRegisteredTargets(): UIRaycastTarget[] {
        const uniqueTargets = new Set<UIRaycastTarget>();
        this.graphics.forEach((target) => {
            if (target.isRaycastTargetEnabled()) {
                uniqueTargets.add(target);
            }
        });
        return Array.from(uniqueTargets);
    }

    public static raycastAll(screenPosition: { x: number; y: number }, hostElement?: HTMLElement | null): UIRaycastHit[] {
        const hits = Array.from(this.activeRaycasters)
            .filter((raycaster) => raycaster.enabled)
            .flatMap((raycaster) => raycaster.raycast(screenPosition, hostElement));

        hits.sort((left, right) => {
            if (left.sortingOrder !== right.sortingOrder) {
                return right.sortingOrder - left.sortingOrder;
            }
            if (left.renderModePriority !== right.renderModePriority) {
                return right.renderModePriority - left.renderModePriority;
            }
            const hierarchyCompare = GraphicRaycaster.compareHierarchyOrder(left.hierarchyOrder, right.hierarchyOrder);
            if (hierarchyCompare !== 0) {
                return hierarchyCompare;
            }
            return right.registrationOrder - left.registrationOrder;
        });

        return hits;
    }

    public static findTargetForGameObject(gameObject: GameObject, hostElement?: HTMLElement | null): UIRaycastTarget | null {
        const targets = this.getRegisteredTargets(hostElement);
        return targets.find((target) => target.gameObject === gameObject) ?? null;
    }

    public static getRegisteredTargets(hostElement?: HTMLElement | null): UIRaycastTarget[] {
        const uniqueTargets = new Set<UIRaycastTarget>();
        const sortedRaycasters = Array.from(this.activeRaycasters)
            .filter((raycaster) => raycaster.enabled)
            .sort((left, right) => {
                const leftOrder = left.gameObject.getComponent(Canvas)?.sortingOrder ?? 0;
                const rightOrder = right.gameObject.getComponent(Canvas)?.sortingOrder ?? 0;
                return rightOrder - leftOrder;
            });

        sortedRaycasters.forEach((raycaster) => {
            const canvas = raycaster.gameObject.getComponent(Canvas);
            const rootElement = canvas?.getRootElement() ?? null;
            if (hostElement && rootElement && rootElement !== hostElement && !hostElement.contains(rootElement)) {
                return;
            }
            raycaster.getRegisteredTargets()
                .sort((left, right) => {
                    const hierarchyCompare = GraphicRaycaster.compareHierarchyOrder(
                        raycaster.getHierarchyOrder(left.gameObject, raycaster.gameObject),
                        raycaster.getHierarchyOrder(right.gameObject, raycaster.gameObject)
                    );
                    if (hierarchyCompare !== 0) {
                        return hierarchyCompare;
                    }
                    const leftElement = left.getRaycastElement();
                    const rightElement = right.getRaycastElement();
                    const leftRegistration = leftElement ? raycaster.registrationOrder.get(leftElement) ?? 0 : 0;
                    const rightRegistration = rightElement ? raycaster.registrationOrder.get(rightElement) ?? 0 : 0;
                    return rightRegistration - leftRegistration;
                })
                .forEach((target) => uniqueTargets.add(target));
        });

        return Array.from(uniqueTargets);
    }

    public onDestroy(): void {
        GraphicRaycaster.activeRaycasters.delete(this);
        this.graphics.clear();
        this.registrationOrder.clear();
    }

    private isCanvasFacingAway(canvas: Canvas): boolean {
        if (canvas.renderMode !== 'WorldSpace') {
            return false;
        }

        const camera = canvas.getRenderCamera();
        if (!camera) return false;

        const canvasPosition = new THREE.Vector3();
        const cameraPosition = new THREE.Vector3();
        const canvasForward = new THREE.Vector3();

        canvas.gameObject.object3D.getWorldPosition(canvasPosition);
        camera.getWorldPosition(cameraPosition);
        canvas.gameObject.object3D.getWorldDirection(canvasForward);

        const toCamera = cameraPosition.sub(canvasPosition).normalize();
        return canvasForward.dot(toCamera) <= 0;
    }

    private isBlockedBySceneObjects(
        screenPosition: { x: number; y: number },
        canvas: Canvas,
        hostElement?: HTMLElement | null
    ): boolean {
        if (this.blockingObjects === 'None') {
            return false;
        }
        if (canvas.renderMode === 'ScreenSpaceOverlay') {
            return false;
        }

        const camera = canvas.getRenderCamera();
        if (!camera) return false;

        const viewportRect = (hostElement ?? canvas.getRootElement()?.parentElement)?.getBoundingClientRect();
        if (!viewportRect || viewportRect.width <= 0 || viewportRect.height <= 0) {
            return false;
        }

        const normalizedX = ((screenPosition.x - viewportRect.left) / viewportRect.width) * 2 - 1;
        const normalizedY = -(((screenPosition.y - viewportRect.top) / viewportRect.height) * 2 - 1);
        if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
            return false;
        }
        if (Math.abs(normalizedX) > 1 || Math.abs(normalizedY) > 1) {
            return false;
        }

        const editor = (window as any).Editor?.instance;
        const scene = editor?.scene;
        if (!scene?.threeScene) {
            return false;
        }

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(normalizedX, normalizedY), camera);
        const intersections = raycaster.intersectObjects(scene.threeScene.children, true);
        const blockingDistance = intersections.find((intersection) => this.isValidBlockingIntersection(intersection.object))?.distance ?? null;
        if (blockingDistance === null) {
            return false;
        }

        const canvasDistance = canvas.getDistanceToRenderCamera();
        if (canvasDistance === null) {
            return false;
        }

        return blockingDistance < canvasDistance;
    }

    private isValidBlockingIntersection(object: THREE.Object3D): boolean {
        let current: THREE.Object3D | null = object;
        while (current) {
            const owner = current.userData?.gameObject as GameObject | undefined;
            if (owner) {
                if (owner === this.gameObject || owner.transform.isChildOf(this.gameObject.transform)) {
                    return false;
                }

                if (this.blockingMask !== -1 && (this.blockingMask & (1 << owner.layer)) === 0) {
                    return false;
                }

                return true;
            }

            if (
                current.type === 'GridHelper'
                || current.type === 'AxesHelper'
                || current.type === 'TransformControls'
                || current.name === 'SceneGizmo'
            ) {
                return false;
            }

            current = current.parent;
        }

        return false;
    }

    private getRenderModePriority(canvas: Canvas): number {
        switch (canvas.renderMode) {
            case 'ScreenSpaceOverlay':
                return 3;
            case 'ScreenSpaceCamera':
                return 2;
            case 'WorldSpace':
                return 1;
            default:
                return 0;
        }
    }

    private getHierarchyOrder(target: GameObject, root: GameObject): number[] {
        const order: number[] = [];
        let current: Transform | null = target.transform;
        while (current && current.gameObject !== root) {
            order.unshift(current.siblingIndex);
            current = current.parent;
        }
        return order;
    }

    private static compareHierarchyOrder(left: number[], right: number[]): number {
        const sharedLength = Math.min(left.length, right.length);
        for (let index = 0; index < sharedLength; index += 1) {
            if (left[index] !== right[index]) {
                return right[index] - left[index];
            }
        }
        return right.length - left.length;
    }
}
