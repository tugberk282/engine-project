import { Component } from '../Component';
import { serialize } from '../Decorators';
import { GameObject } from '../GameObject';
import { Canvas } from './Canvas';
import { GraphicRaycaster } from './GraphicRaycaster';
import { RectTransform } from './RectTransform';
import { UIScrollbar } from './UIScrollbar';
import { PointerEventData, UIRaycastTarget } from './UIEventInterfaces';
import {
    resolveCanvasForGameObject,
    resolveCanvasInteractionState,
    resolveParentRectForGameObject,
    resolveRectTransformRect,
    isRuntimeUIInputEnabled
} from './UIRectUtils';

type MovementType = 'Unrestricted' | 'Elastic' | 'Clamped';
type ScrollbarVisibility = 'Permanent' | 'AutoHide' | 'AutoHideAndExpandViewport';

export class UIScrollRect extends Component implements UIRaycastTarget {
    @serialize public content: GameObject | null = null;
    @serialize public viewport: GameObject | null = null;
    @serialize public horizontal: boolean = true;
    @serialize public vertical: boolean = true;
    @serialize public movementType: MovementType = 'Clamped';
    @serialize public inertia: boolean = true;
    @serialize public decelerationRate: number = 0.135;
    @serialize public elasticity: number = 0.1;
    @serialize public scrollSensitivity: number = 20;
    @serialize public keyboardScrollStep: number = 0;
    @serialize public keyboardPageStep: number = 0;
    @serialize public horizontalNormalizedPosition: number = 0;
    @serialize public verticalNormalizedPosition: number = 1;
    @serialize public horizontalScrollbar: GameObject | null = null;
    @serialize public verticalScrollbar: GameObject | null = null;
    @serialize public horizontalScrollbarVisibility: ScrollbarVisibility = 'Permanent';
    @serialize public verticalScrollbarVisibility: ScrollbarVisibility = 'Permanent';

    private element: HTMLDivElement | null = null;
    private canvas: Canvas | null = null;
    private raycaster: GraphicRaycaster | null = null;
    private dragging: boolean = false;
    private updatingScrollbars: boolean = false;
    private clippedElements: Set<HTMLElement> = new Set();
    private boundHorizontalScrollbar: UIScrollbar | null = null;
    private boundVerticalScrollbar: UIScrollbar | null = null;
    private horizontalVelocity: number = 0;
    private verticalVelocity: number = 0;
    private focused: boolean = false;

    public awake(): void {
        this.element = document.createElement('div');
        this.element.style.position = 'absolute';
        this.element.style.boxSizing = 'border-box';
        this.element.style.background = 'transparent';
        this.element.style.pointerEvents = 'auto';
        this.element.style.cursor = 'grab';
        this.element.tabIndex = -1;
        this.attachToCanvas();
        this.updateVisuals();
    }

    public update(deltaTime: number): void {
        if (!this.canvas) {
            this.attachToCanvas();
        }
        this.stepInertiaAndElasticity(deltaTime);
        this.updateVisuals();
        this.syncScrollbarBindings();
    }

    public lateUpdate(): void {
        this.applyScrollPosition();
        this.syncScrollbarState();
        this.applyViewportClipping();
    }

    public onDestroy(): void {
        if (this.element && this.raycaster) {
            this.raycaster.unregisterGraphic(this.element);
        }
        if (this.element?.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
        this.clearClipping();
        if (this.boundHorizontalScrollbar) {
            this.boundHorizontalScrollbar.onValueChanged = () => { };
        }
        if (this.boundVerticalScrollbar) {
            this.boundVerticalScrollbar.onValueChanged = () => { };
        }
    }

    public deserialize(data: any): void {
        super.deserialize(data);
        this.horizontalNormalizedPosition = this.normalizePosition(this.horizontalNormalizedPosition);
        this.verticalNormalizedPosition = this.normalizePosition(this.verticalNormalizedPosition);
        this.decelerationRate = this.normalizeDecelerationRate(this.decelerationRate);
        this.elasticity = this.normalizeElasticity(this.elasticity);
        this.syncScrollbarBindings();
        this.updateVisuals();
    }

    public getRaycastElement(): HTMLElement | null {
        return this.element;
    }

    public isRaycastTargetEnabled(): boolean {
        return Boolean(this.element) && resolveCanvasInteractionState(this.gameObject).blocksRaycasts;
    }

    public isInteractable(): boolean {
        return resolveCanvasInteractionState(this.gameObject).interactable;
    }

    public onPointerDown(_eventData: PointerEventData): void {
        if (!this.isInteractable()) return;
        this.dragging = true;
        this.horizontalVelocity = 0;
        this.verticalVelocity = 0;
        this.element?.focus();
        this.updateVisuals();
    }

    public onPointerMove(eventData: PointerEventData): void {
        if (!this.isInteractable() || !this.dragging) return;

        const bounds = this.getScrollBounds();
        if (!bounds) return;
        const frameDelta = 1 / 60;

        if (this.horizontal && bounds.hiddenWidth > 0.0001) {
            const deltaNormalized = -(eventData.delta.x / bounds.hiddenWidth);
            this.setHorizontalNormalizedPosition(
                this.horizontalNormalizedPosition + deltaNormalized,
                true
            );
            this.horizontalVelocity = deltaNormalized / frameDelta;
        }
        if (this.vertical && bounds.hiddenHeight > 0.0001) {
            const deltaNormalized = eventData.delta.y / bounds.hiddenHeight;
            this.setVerticalNormalizedPosition(
                this.verticalNormalizedPosition + deltaNormalized,
                true
            );
            this.verticalVelocity = deltaNormalized / frameDelta;
        }
    }

    public onPointerUp(_eventData: PointerEventData): void {
        this.dragging = false;
        this.updateVisuals();
    }

    public onPointerCancel(_eventData: PointerEventData): void {
        this.dragging = false;
        this.updateVisuals();
    }

    public onScroll(eventData: PointerEventData): void {
        if (!this.isInteractable()) return;

        const bounds = this.getScrollBounds();
        if (!bounds) return;
        const frameDelta = 1 / 60;

        if (this.vertical && bounds.hiddenHeight > 0.0001) {
            const deltaNormalized = -((eventData.scrollDelta.y * this.scrollSensitivity / 100) / bounds.hiddenHeight);
            this.setVerticalNormalizedPosition(
                this.verticalNormalizedPosition + deltaNormalized,
                true
            );
            this.verticalVelocity = deltaNormalized / frameDelta;
            return;
        }

        if (this.horizontal && bounds.hiddenWidth > 0.0001) {
            const deltaNormalized = ((eventData.scrollDelta.y * this.scrollSensitivity / 100) / bounds.hiddenWidth);
            this.setHorizontalNormalizedPosition(
                this.horizontalNormalizedPosition + deltaNormalized,
                true
            );
            this.horizontalVelocity = deltaNormalized / frameDelta;
        }
    }

    public setHorizontalNormalizedPosition(value: number, sync: boolean = true): void {
        if (!this.horizontal) return;
        this.horizontalNormalizedPosition = this.normalizePosition(value);
        if (sync) {
            this.applyScrollPosition();
            this.syncScrollbarState();
            this.applyViewportClipping();
        }
    }

    public setVerticalNormalizedPosition(value: number, sync: boolean = true): void {
        if (!this.vertical) return;
        this.verticalNormalizedPosition = this.normalizePosition(value);
        if (sync) {
            this.applyScrollPosition();
            this.syncScrollbarState();
            this.applyViewportClipping();
        }
    }

    private attachToCanvas(): void {
        const canvas = resolveCanvasForGameObject(this.gameObject) ?? undefined;
        if (canvas) {
            if (this.canvas && this.canvas !== canvas && this.raycaster && this.element) {
                this.raycaster.unregisterGraphic(this.element);
            }
            this.canvas = canvas;
            canvas.addUIElement(this.element!);
        }
        this.bindKeyboardEvents();
    }

    private bindKeyboardEvents(): void {
        if (!this.element || this.element.dataset.uiScrollRectKeyboardBound === 'true') {
            return;
        }

        this.element.dataset.uiScrollRectKeyboardBound = 'true';
        this.element.addEventListener('focus', () => {
            this.focused = true;
            this.updateVisuals();
        });
        this.element.addEventListener('blur', () => {
            this.focused = false;
            this.updateVisuals();
        });
        this.element.addEventListener('keydown', (rawEvent) => {
            const event = rawEvent as KeyboardEvent;
            if (!this.isInteractable()) return;

            if (event.code === 'Home') {
                if (this.vertical) {
                    event.preventDefault();
                    this.setVerticalNormalizedPosition(1, true);
                    return;
                }
                if (this.horizontal) {
                    event.preventDefault();
                    this.setHorizontalNormalizedPosition(0, true);
                    return;
                }
            }

            if (event.code === 'End') {
                if (this.vertical) {
                    event.preventDefault();
                    this.setVerticalNormalizedPosition(0, true);
                    return;
                }
                if (this.horizontal) {
                    event.preventDefault();
                    this.setHorizontalNormalizedPosition(1, true);
                    return;
                }
            }

            const step = event.code === 'PageUp' || event.code === 'PageDown'
                ? this.getResolvedKeyboardPageStep()
                : this.getResolvedKeyboardStep();

            switch (event.code) {
                case 'ArrowUp':
                    if (!this.vertical) return;
                    event.preventDefault();
                    this.setVerticalNormalizedPosition(this.verticalNormalizedPosition + step, true);
                    return;
                case 'ArrowDown':
                    if (!this.vertical) return;
                    event.preventDefault();
                    this.setVerticalNormalizedPosition(this.verticalNormalizedPosition - step, true);
                    return;
                case 'ArrowLeft':
                    if (!this.horizontal) return;
                    event.preventDefault();
                    this.setHorizontalNormalizedPosition(this.horizontalNormalizedPosition - step, true);
                    return;
                case 'ArrowRight':
                    if (!this.horizontal) return;
                    event.preventDefault();
                    this.setHorizontalNormalizedPosition(this.horizontalNormalizedPosition + step, true);
                    return;
                case 'PageUp':
                    if (this.vertical) {
                        event.preventDefault();
                        this.setVerticalNormalizedPosition(this.verticalNormalizedPosition + step, true);
                        return;
                    }
                    if (this.horizontal) {
                        event.preventDefault();
                        this.setHorizontalNormalizedPosition(this.horizontalNormalizedPosition - step, true);
                    }
                    return;
                case 'PageDown':
                    if (this.vertical) {
                        event.preventDefault();
                        this.setVerticalNormalizedPosition(this.verticalNormalizedPosition - step, true);
                        return;
                    }
                    if (this.horizontal) {
                        event.preventDefault();
                        this.setHorizontalNormalizedPosition(this.horizontalNormalizedPosition + step, true);
                    }
                    return;
            }
        });
    }

    private updateVisuals(): void {
        if (!this.element || !this.canvas) return;

        const interaction = resolveCanvasInteractionState(this.gameObject);
        const inputEnabled = isRuntimeUIInputEnabled();
        const viewportRect = this.getEffectiveViewportRect();
        this.element.style.pointerEvents = inputEnabled && interaction.blocksRaycasts ? 'auto' : 'none';
        this.element.style.opacity = `${interaction.alpha}`;
        this.element.style.left = `${viewportRect.x}px`;
        this.element.style.top = `${viewportRect.y}px`;
        this.element.style.width = `${viewportRect.width}px`;
        this.element.style.height = `${viewportRect.height}px`;
        this.element.style.outline = this.focused ? '2px solid rgba(255,255,255,0.65)' : 'none';
        this.element.style.outlineOffset = this.focused ? '1px' : '';
        this.element.style.cursor = this.isInteractable() ? (this.dragging ? 'grabbing' : 'grab') : 'default';
        this.element.style.transformOrigin = 'top left';

        this.syncRaycasterRegistration();
    }

    private applyScrollPosition(): void {
        const contentRectTransform = this.content?.getComponent(RectTransform);
        if (!contentRectTransform) return;

        const viewportRect = this.getEffectiveViewportRect();
        const contentParentRect = resolveParentRectForGameObject(this.content!);
        const currentContentRect = resolveRectTransformRect(this.content!, contentRectTransform);
        const hiddenWidth = Math.max(0, currentContentRect.width - viewportRect.width);
        const hiddenHeight = Math.max(0, currentContentRect.height - viewportRect.height);

        const nextRect = {
            x: this.horizontal ? viewportRect.x - (hiddenWidth * this.horizontalNormalizedPosition) : currentContentRect.x,
            y: this.vertical ? viewportRect.y - (hiddenHeight * (1 - this.verticalNormalizedPosition)) : currentContentRect.y,
            width: currentContentRect.width,
            height: currentContentRect.height
        };

        contentRectTransform.setPixelRectWithin(contentParentRect, nextRect);
        this.refreshContentVisuals();
    }

    private refreshContentVisuals(): void {
        this.forEachContentGameObject((gameObject) => {
            gameObject.components.forEach((component) => {
                (component as any).updateVisuals?.();
            });
        });
    }

    private resolveViewportRect(): { x: number; y: number; width: number; height: number } {
        const viewportGameObject = this.viewport ?? this.gameObject;
        const rectTransform = viewportGameObject.getComponent(RectTransform);
        if (!rectTransform) {
            return resolveRectTransformRect(this.gameObject);
        }
        return resolveRectTransformRect(viewportGameObject, rectTransform);
    }

    private getRootRect(): { x: number; y: number; width: number; height: number } {
        const rectTransform = this.gameObject.getComponent(RectTransform);
        if (!rectTransform) {
            return resolveRectTransformRect(this.gameObject);
        }
        return resolveRectTransformRect(this.gameObject, rectTransform);
    }

    private getEffectiveViewportRect(): { x: number; y: number; width: number; height: number } {
        return this.resolveScrollbarVisibilityState().viewportRect;
    }

    private getScrollBounds(): { hiddenWidth: number; hiddenHeight: number } | null {
        const contentRectTransform = this.content?.getComponent(RectTransform);
        if (!contentRectTransform || !this.content) return null;
        const viewportRect = this.getEffectiveViewportRect();
        const contentRect = resolveRectTransformRect(this.content, contentRectTransform);
        return {
            hiddenWidth: Math.max(0, contentRect.width - viewportRect.width),
            hiddenHeight: Math.max(0, contentRect.height - viewportRect.height)
        };
    }

    private syncScrollbarBindings(): void {
        const nextHorizontal = this.horizontalScrollbar?.getComponent(UIScrollbar) ?? null;
        if (this.boundHorizontalScrollbar !== nextHorizontal) {
            if (this.boundHorizontalScrollbar) {
                this.boundHorizontalScrollbar.onValueChanged = () => { };
            }
            this.boundHorizontalScrollbar = nextHorizontal;
            if (this.boundHorizontalScrollbar) {
                this.boundHorizontalScrollbar.onValueChanged = (value: number) => {
                    if (this.updatingScrollbars) return;
                    this.setHorizontalNormalizedPosition(value, true);
                };
            }
        }

        const nextVertical = this.verticalScrollbar?.getComponent(UIScrollbar) ?? null;
        if (this.boundVerticalScrollbar !== nextVertical) {
            if (this.boundVerticalScrollbar) {
                this.boundVerticalScrollbar.onValueChanged = () => { };
            }
            this.boundVerticalScrollbar = nextVertical;
            if (this.boundVerticalScrollbar) {
                this.boundVerticalScrollbar.onValueChanged = (value: number) => {
                    if (this.updatingScrollbars) return;
                    this.setVerticalNormalizedPosition(value, true);
                };
            }
        }
    }

    private syncScrollbarState(): void {
        const bounds = this.getScrollBounds();
        if (!bounds) return;
        const visibilityState = this.resolveScrollbarVisibilityState();
        const viewportRect = visibilityState.viewportRect;

        this.updatingScrollbars = true;
        if (this.boundHorizontalScrollbar) {
            this.boundHorizontalScrollbar.setRuntimeVisible(visibilityState.horizontalVisible);
            this.boundHorizontalScrollbar.setSize(bounds.hiddenWidth <= 0.0001 ? 1 : viewportRect.width / Math.max(viewportRect.width, bounds.hiddenWidth + viewportRect.width));
            this.boundHorizontalScrollbar.setValue(this.horizontalNormalizedPosition, false);
        }
        if (this.boundVerticalScrollbar) {
            this.boundVerticalScrollbar.setRuntimeVisible(visibilityState.verticalVisible);
            this.boundVerticalScrollbar.setSize(bounds.hiddenHeight <= 0.0001 ? 1 : viewportRect.height / Math.max(viewportRect.height, bounds.hiddenHeight + viewportRect.height));
            this.boundVerticalScrollbar.setValue(this.verticalNormalizedPosition, false);
        }
        this.updatingScrollbars = false;
    }

    private applyViewportClipping(): void {
        if (!this.element) return;

        const viewportBounds = this.element.getBoundingClientRect();
        const nextClippedElements = new Set<HTMLElement>();

        this.forEachContentGameObject((gameObject) => {
            gameObject.components.forEach((component) => {
                const element = (component as any).getRaycastElement?.() as HTMLElement | null;
                if (!element || element === this.element) return;
                nextClippedElements.add(element);

                const rect = element.getBoundingClientRect();
                const insetTop = Math.max(0, viewportBounds.top - rect.top);
                const insetRight = Math.max(0, rect.right - viewportBounds.right);
                const insetBottom = Math.max(0, rect.bottom - viewportBounds.bottom);
                const insetLeft = Math.max(0, viewportBounds.left - rect.left);
                const hasOverlap = rect.right > viewportBounds.left
                    && rect.left < viewportBounds.right
                    && rect.bottom > viewportBounds.top
                    && rect.top < viewportBounds.bottom;

                element.style.clipPath = hasOverlap
                    ? `inset(${insetTop}px ${insetRight}px ${insetBottom}px ${insetLeft}px)`
                    : 'inset(100% 100% 100% 100%)';
            });
        });

        this.clippedElements.forEach((element) => {
            if (nextClippedElements.has(element)) return;
            element.style.clipPath = '';
        });
        this.clippedElements = nextClippedElements;
    }

    private clearClipping(): void {
        this.clippedElements.forEach((element) => {
            element.style.clipPath = '';
        });
        this.clippedElements.clear();
    }

    private forEachContentGameObject(visitor: (gameObject: GameObject) => void): void {
        if (!this.content) return;
        const queue: GameObject[] = [this.content];
        const visited = new Set<GameObject>();

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current || visited.has(current)) continue;
            visited.add(current);
            visitor(current);
            current.transform.children.forEach((child) => queue.push(child.gameObject));
        }
    }

    private resolveScrollbarVisibilityState(): {
        horizontalVisible: boolean;
        verticalVisible: boolean;
        viewportRect: { x: number; y: number; width: number; height: number };
    } {
        const baseViewportRect = this.resolveViewportRect();
        const rootRect = this.getRootRect();
        const contentRectTransform = this.content?.getComponent(RectTransform) ?? null;
        const contentRect = contentRectTransform && this.content
            ? resolveRectTransformRect(this.content, contentRectTransform)
            : null;

        let horizontalVisible = this.shouldForceScrollbarVisible('horizontal');
        let verticalVisible = this.shouldForceScrollbarVisible('vertical');
        let viewportRect = this.computeViewportRectForVisibility(rootRect, baseViewportRect, horizontalVisible, verticalVisible);

        for (let i = 0; i < 3; i++) {
            const nextHorizontalVisible = this.shouldForceScrollbarVisible('horizontal')
                || this.shouldAutoShowScrollbar('horizontal', contentRect, viewportRect.width);
            const nextVerticalVisible = this.shouldForceScrollbarVisible('vertical')
                || this.shouldAutoShowScrollbar('vertical', contentRect, viewportRect.height);
            const changed = nextHorizontalVisible !== horizontalVisible || nextVerticalVisible !== verticalVisible;
            horizontalVisible = nextHorizontalVisible;
            verticalVisible = nextVerticalVisible;
            viewportRect = this.computeViewportRectForVisibility(rootRect, baseViewportRect, horizontalVisible, verticalVisible);
            if (!changed) {
                break;
            }
        }

        return { horizontalVisible, verticalVisible, viewportRect };
    }

    private shouldForceScrollbarVisible(axis: 'horizontal' | 'vertical'): boolean {
        if (axis === 'horizontal') {
            return this.horizontal && Boolean(this.horizontalScrollbar) && this.horizontalScrollbarVisibility === 'Permanent';
        }
        return this.vertical && Boolean(this.verticalScrollbar) && this.verticalScrollbarVisibility === 'Permanent';
    }

    private shouldAutoShowScrollbar(
        axis: 'horizontal' | 'vertical',
        contentRect: { width: number; height: number } | null,
        viewportSize: number
    ): boolean {
        if (!contentRect) return false;
        if (axis === 'horizontal') {
            if (!this.horizontal || !this.horizontalScrollbar || this.horizontalScrollbarVisibility === 'Permanent') return false;
            return contentRect.width - viewportSize > 0.0001;
        }
        if (!this.vertical || !this.verticalScrollbar || this.verticalScrollbarVisibility === 'Permanent') return false;
        return contentRect.height - viewportSize > 0.0001;
    }

    private computeViewportRectForVisibility(
        rootRect: { x: number; y: number; width: number; height: number },
        baseViewportRect: { x: number; y: number; width: number; height: number },
        horizontalVisible: boolean,
        verticalVisible: boolean
    ): { x: number; y: number; width: number; height: number } {
        const expandHorizontal = this.horizontalScrollbarVisibility === 'AutoHideAndExpandViewport' && Boolean(this.horizontalScrollbar);
        const expandVertical = this.verticalScrollbarVisibility === 'AutoHideAndExpandViewport' && Boolean(this.verticalScrollbar);
        if (!expandHorizontal && !expandVertical) {
            return baseViewportRect;
        }

        const horizontalThickness = this.resolveScrollbarThickness(this.horizontalScrollbar, true);
        const verticalThickness = this.resolveScrollbarThickness(this.verticalScrollbar, false);

        return {
            x: rootRect.x,
            y: rootRect.y,
            width: Math.max(1, rootRect.width - (expandVertical && verticalVisible ? verticalThickness : 0)),
            height: Math.max(1, rootRect.height - (expandHorizontal && horizontalVisible ? horizontalThickness : 0))
        };
    }

    private resolveScrollbarThickness(scrollbar: GameObject | null, horizontal: boolean): number {
        if (!scrollbar) return 0;
        const rectTransform = scrollbar.getComponent(RectTransform);
        if (!rectTransform) return 0;
        const rect = resolveRectTransformRect(scrollbar, rectTransform);
        return horizontal ? rect.height : rect.width;
    }

    private syncRaycasterRegistration(): void {
        if (!this.element || !this.canvas) return;
        const nextRaycaster = this.canvas.gameObject.getComponent(GraphicRaycaster) ?? null;
        if (this.raycaster && this.raycaster !== nextRaycaster) {
            this.raycaster.unregisterGraphic(this.element);
        }
        this.raycaster = nextRaycaster;
        if (this.raycaster) {
            this.raycaster.registerGraphic(this, this.element);
        }
    }

    private normalize01(value: number): number {
        return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    }

    private normalizePosition(value: number): number {
        const numericValue = Number.isFinite(value) ? value : 0;
        if (this.movementType === 'Unrestricted') {
            return numericValue;
        }
        if (this.movementType === 'Elastic') {
            return Math.max(-0.5, Math.min(1.5, numericValue));
        }
        return this.normalize01(numericValue);
    }

    private normalizeDecelerationRate(value: number): number {
        if (!Number.isFinite(value)) return 0.135;
        return Math.max(0, Math.min(1, value));
    }

    private normalizeElasticity(value: number): number {
        if (!Number.isFinite(value)) return 0.1;
        return Math.max(0.01, Math.min(1, value));
    }

    private getResolvedKeyboardStep(): number {
        if (Number.isFinite(this.keyboardScrollStep) && this.keyboardScrollStep > 0) {
            return this.keyboardScrollStep;
        }
        return Math.max(0.01, Math.min(0.25, this.scrollSensitivity / 200));
    }

    private getResolvedKeyboardPageStep(): number {
        if (Number.isFinite(this.keyboardPageStep) && this.keyboardPageStep > 0) {
            return this.keyboardPageStep;
        }
        return Math.max(this.getResolvedKeyboardStep() * 3, 0.2);
    }

    private stepInertiaAndElasticity(deltaTime: number): void {
        const dt = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : (1 / 60);
        const bounds = this.getScrollBounds();
        if (!bounds) {
            this.horizontalVelocity = 0;
            this.verticalVelocity = 0;
            return;
        }

        if (!this.dragging && this.inertia) {
            const damping = Math.pow(this.normalizeDecelerationRate(this.decelerationRate), dt);
            if (this.horizontal && bounds.hiddenWidth > 0.0001 && Math.abs(this.horizontalVelocity) > 0.00001) {
                this.setHorizontalNormalizedPosition(this.horizontalNormalizedPosition + (this.horizontalVelocity * dt), false);
                this.horizontalVelocity *= damping;
            } else {
                this.horizontalVelocity = 0;
            }

            if (this.vertical && bounds.hiddenHeight > 0.0001 && Math.abs(this.verticalVelocity) > 0.00001) {
                this.setVerticalNormalizedPosition(this.verticalNormalizedPosition + (this.verticalVelocity * dt), false);
                this.verticalVelocity *= damping;
            } else {
                this.verticalVelocity = 0;
            }
        }

        if (!this.dragging && this.movementType === 'Elastic') {
            const spring = Math.min(1, this.normalizeElasticity(this.elasticity) * 12 * dt);

            const horizontalTarget = this.normalize01(this.horizontalNormalizedPosition);
            const verticalTarget = this.normalize01(this.verticalNormalizedPosition);

            if (this.horizontal && Math.abs(horizontalTarget - this.horizontalNormalizedPosition) > 0.0001) {
                const delta = (horizontalTarget - this.horizontalNormalizedPosition);
                this.horizontalNormalizedPosition += delta * spring;
                this.horizontalVelocity += delta * spring * 0.5;
            }

            if (this.vertical && Math.abs(verticalTarget - this.verticalNormalizedPosition) > 0.0001) {
                const delta = (verticalTarget - this.verticalNormalizedPosition);
                this.verticalNormalizedPosition += delta * spring;
                this.verticalVelocity += delta * spring * 0.5;
            }
        }

        if (this.movementType === 'Clamped') {
            this.horizontalNormalizedPosition = this.normalize01(this.horizontalNormalizedPosition);
            this.verticalNormalizedPosition = this.normalize01(this.verticalNormalizedPosition);
            if ((this.horizontalNormalizedPosition <= 0 && this.horizontalVelocity < 0)
                || (this.horizontalNormalizedPosition >= 1 && this.horizontalVelocity > 0)) {
                this.horizontalVelocity = 0;
            }
            if ((this.verticalNormalizedPosition <= 0 && this.verticalVelocity < 0)
                || (this.verticalNormalizedPosition >= 1 && this.verticalVelocity > 0)) {
                this.verticalVelocity = 0;
            }
        }
    }
}
