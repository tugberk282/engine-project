import { Canvas } from './Canvas';
import { GraphicRaycaster } from './GraphicRaycaster';
import { RectTransform } from './RectTransform';
import { Selectable } from './Selectable';
import { serialize } from '../Decorators';
import { resolveCanvasForGameObject, resolveCanvasInteractionState, resolveRectTransformRect, isRuntimeUIInputEnabled } from './UIRectUtils';
import { PointerEventData } from './UIEventInterfaces';

type ScrollbarDirection = 'LeftToRight' | 'RightToLeft' | 'BottomToTop' | 'TopToBottom';

export class UIScrollbar extends Selectable {
    @serialize public value: number = 0;
    @serialize public size: number = 0.2;
    @serialize public numberOfSteps: number = 0;
    @serialize public keyboardStep: number = 0;
    @serialize public keyboardPageStep: number = 0;
    @serialize public direction: ScrollbarDirection = 'LeftToRight';
    @serialize public backgroundColor: string = '#3f3f3f';
    @serialize public handleColor: string = '#d9d9d9';
    @serialize public highlightedColor: string = '#f0f0f0';
    @serialize public pressedColor: string = '#2f6ea1';
    @serialize public disabledColor: string = '#2b2b2b';

    private element: HTMLDivElement | null = null;
    private trackElement: HTMLDivElement | null = null;
    private handleElement: HTMLDivElement | null = null;
    private canvas: Canvas | null = null;
    private raycaster: GraphicRaycaster | null = null;
    private draggingHandle: boolean = false;
    private dragPointerOffset: number = 0;
    private runtimeVisible: boolean = true;

    public onValueChanged: (value: number) => void = () => { };

    public awake(): void {
        this.element = document.createElement('div');
        this.element.style.position = 'absolute';
        this.element.style.boxSizing = 'border-box';
        this.element.tabIndex = -1;

        this.trackElement = document.createElement('div');
        this.trackElement.style.position = 'relative';
        this.trackElement.style.width = '100%';
        this.trackElement.style.height = '100%';
        this.trackElement.style.borderRadius = '999px';
        this.trackElement.style.overflow = 'hidden';

        this.handleElement = document.createElement('div');
        this.handleElement.style.position = 'absolute';
        this.handleElement.style.borderRadius = '999px';
        this.handleElement.style.boxShadow = '0 1px 3px rgba(0,0,0,0.45)';
        this.handleElement.style.border = '1px solid rgba(0,0,0,0.25)';
        this.handleElement.style.boxSizing = 'border-box';

        this.trackElement.appendChild(this.handleElement);
        this.element.appendChild(this.trackElement);
        this.bindKeyboardEvents();

        this.attachToCanvas();
        this.value = this.normalizeValue(this.value);
        this.size = this.normalizeSize(this.size);
        this.updateVisuals();
    }

    public update(_dt: number): void {
        if (!this.canvas) {
            this.attachToCanvas();
        }
        this.updateVisuals();
    }

    public getRaycastElement(): HTMLElement | null {
        return this.element;
    }

    public onPointerDown(eventData: PointerEventData): void {
        super.onPointerDown(eventData);
        if (!this.isInteractable()) return;
        this.beginPointerInteraction(eventData.position);
    }

    public onPointerMove(eventData: PointerEventData): void {
        super.onPointerMove(eventData);
        if (!this.isInteractable()) return;
        this.updateValueFromPointer(eventData.position, true);
    }

    public onPointerUp(eventData: PointerEventData): void {
        super.onPointerUp(eventData);
        this.draggingHandle = false;
        this.dragPointerOffset = 0;
    }

    public onPointerCancel(eventData: PointerEventData): void {
        super.onPointerCancel(eventData);
        this.draggingHandle = false;
        this.dragPointerOffset = 0;
    }

    public onDestroy(): void {
        if (this.element && this.raycaster) {
            this.raycaster.unregisterGraphic(this.element);
        }
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }

    public deserialize(data: any): void {
        super.deserialize(data);
        this.value = this.normalizeValue(this.value);
        this.size = this.normalizeSize(this.size);
        this.updateVisuals();
    }

    public setValue(nextValue: number, notify: boolean = true): boolean {
        const normalized = this.normalizeValue(nextValue);
        const changed = Math.abs(normalized - this.value) > 0.000001;
        this.value = normalized;
        if (changed && notify) {
            this.onValueChanged(this.value);
        }
        this.updateVisuals();
        return changed;
    }

    public setSize(nextSize: number): void {
        this.size = this.normalizeSize(nextSize);
        this.value = this.normalizeValue(this.value);
        this.updateVisuals();
    }

    public setRuntimeVisible(visible: boolean): void {
        this.runtimeVisible = visible;
        this.updateVisuals();
    }

    protected notifySelectableStateChanged(): void {
        if (this.element) {
            this.updateVisuals();
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
    }

    private updateVisuals(): void {
        if (!this.element || !this.trackElement || !this.handleElement || !this.canvas) return;

        const interaction = resolveCanvasInteractionState(this.gameObject);
        const canInteract = this.isInteractable();
        const inputEnabled = isRuntimeUIInputEnabled();
        const transitionState = this.getTransitionState();
        const size = this.normalizeSize(this.size);
        const handleStart = this.getHandleStart();
        const isHorizontal = this.isHorizontal();

        this.element.style.display = this.runtimeVisible ? 'block' : 'none';
        if (!this.runtimeVisible) {
            return;
        }

        this.element.style.pointerEvents = inputEnabled && interaction.blocksRaycasts ? 'auto' : 'none';
        this.element.style.transformOrigin = 'top left';
        this.element.style.opacity = `${interaction.alpha * (canInteract ? 1 : 0.75)}`;
        this.element.style.outline = this.isSelectedState() ? '2px solid rgba(255,255,255,0.75)' : 'none';
        this.element.style.outlineOffset = this.isSelectedState() ? '2px' : '';

        this.trackElement.style.background = canInteract ? this.backgroundColor : this.disabledColor;
        this.handleElement.style.background = this.resolveHandleColor(canInteract, transitionState);

        if (isHorizontal) {
            this.handleElement.style.top = '0';
            this.handleElement.style.height = '100%';
            this.handleElement.style.width = `${size * 100}%`;
            this.handleElement.style.left = `${handleStart * 100}%`;
        } else {
            this.handleElement.style.left = '0';
            this.handleElement.style.width = '100%';
            this.handleElement.style.height = `${size * 100}%`;
            this.handleElement.style.top = `${handleStart * 100}%`;
        }

        const rt = this.gameObject.getComponent(RectTransform);
        if (rt) {
            const rect = resolveRectTransformRect(this.gameObject, rt);
            this.element.style.width = `${rect.width}px`;
            this.element.style.height = `${rect.height}px`;
            this.element.style.left = `${rect.x}px`;
            this.element.style.top = `${rect.y}px`;
        } else {
            this.element.style.width = isHorizontal ? '160px' : '20px';
            this.element.style.height = isHorizontal ? '20px' : '160px';
        }

        this.syncRaycasterRegistration();
    }

    private beginPointerInteraction(position: { x: number; y: number }): void {
        if (!this.trackElement) return;
        const rect = this.trackElement.getBoundingClientRect();
        const axisLength = this.isHorizontal() ? rect.width : rect.height;
        if (axisLength <= 0) return;

        const pointerAxis = this.getPointerAxis(position, rect);
        const size = this.normalizeSize(this.size);
        const handleStart = this.getHandleStart();
        const handleStartPx = handleStart * axisLength;
        const handleSizePx = Math.max(axisLength * size, 1);
        const handleEndPx = handleStartPx + handleSizePx;

        this.draggingHandle = pointerAxis >= handleStartPx && pointerAxis <= handleEndPx;
        if (!this.draggingHandle) {
            const direction = pointerAxis < handleStartPx ? -1 : 1;
            this.dragPointerOffset = 0;
            this.setValue(this.value + (direction * this.getResolvedKeyboardPageStep()), true);
            return;
        }

        this.dragPointerOffset = this.draggingHandle
            ? Math.max(0, Math.min(handleSizePx, pointerAxis - handleStartPx))
            : handleSizePx * 0.5;

        this.updateValueFromPointer(position, true);
    }

    private updateValueFromPointer(position: { x: number; y: number }, notify: boolean): void {
        if (!this.trackElement) return;
        const rect = this.trackElement.getBoundingClientRect();
        const axisLength = this.isHorizontal() ? rect.width : rect.height;
        if (axisLength <= 0) return;

        const size = this.normalizeSize(this.size);
        const availableLength = Math.max(axisLength * (1 - size), 0);
        if (availableLength <= 0.0001) {
            this.setValue(0, notify);
            return;
        }

        const pointerAxis = this.getPointerAxis(position, rect);
        const rawStart = pointerAxis - this.dragPointerOffset;
        const clampedStart = Math.max(0, Math.min(availableLength, rawStart));
        const normalizedStart = clampedStart / availableLength;
        const nextValue = this.isReverseDirection() ? 1 - normalizedStart : normalizedStart;
        this.setValue(nextValue, notify);
    }

    private bindKeyboardEvents(): void {
        this.element?.addEventListener('keydown', (rawEvent) => {
            const event = rawEvent as KeyboardEvent;
            if (!this.isInteractable()) return;

            if (event.code === 'Home') {
                event.preventDefault();
                this.setValue(this.isReverseDirection() ? 1 : 0, true);
                return;
            }

            if (event.code === 'End') {
                event.preventDefault();
                this.setValue(this.isReverseDirection() ? 0 : 1, true);
                return;
            }

            const axisDelta = this.resolveKeyboardAxisDelta(event.code);
            if (axisDelta !== 0) {
                event.preventDefault();
                const step = event.code === 'PageUp' || event.code === 'PageDown'
                    ? this.getResolvedKeyboardPageStep()
                    : this.getResolvedKeyboardStep();
                this.setValue(this.value + (axisDelta * step), true);
            }
        });
    }

    private getPointerAxis(position: { x: number; y: number }, rect: DOMRect): number {
        switch (this.direction) {
            case 'LeftToRight':
            case 'RightToLeft':
                return position.x - rect.left;
            case 'BottomToTop':
                return rect.bottom - position.y;
            case 'TopToBottom':
                return position.y - rect.top;
        }
    }

    private resolveHandleColor(canInteract: boolean, state: 'normal' | 'highlighted' | 'pressed'): string {
        if (!canInteract) return this.disabledColor;
        if (state === 'pressed') return this.pressedColor;
        if (state === 'highlighted') return this.highlightedColor;
        return this.handleColor;
    }

    private getHandleStart(): number {
        const size = this.normalizeSize(this.size);
        const normalizedValue = this.isReverseDirection() ? 1 - this.value : this.value;
        return Math.max(0, Math.min(1 - size, normalizedValue * (1 - size)));
    }

    private isHorizontal(): boolean {
        return this.direction === 'LeftToRight' || this.direction === 'RightToLeft';
    }

    private isReverseDirection(): boolean {
        return this.direction === 'RightToLeft' || this.direction === 'TopToBottom';
    }

    private resolveKeyboardAxisDelta(code: string): number {
        switch (code) {
            case 'ArrowLeft':
                return this.direction === 'LeftToRight' ? -1 : (this.direction === 'RightToLeft' ? 1 : 0);
            case 'ArrowRight':
                return this.direction === 'LeftToRight' ? 1 : (this.direction === 'RightToLeft' ? -1 : 0);
            case 'ArrowUp':
                return this.direction === 'BottomToTop' ? 1 : (this.direction === 'TopToBottom' ? -1 : 0);
            case 'ArrowDown':
                return this.direction === 'BottomToTop' ? -1 : (this.direction === 'TopToBottom' ? 1 : 0);
            case 'PageUp':
                return 1;
            case 'PageDown':
                return -1;
            default:
                return 0;
        }
    }

    private getResolvedKeyboardStep(): number {
        if (Number.isFinite(this.keyboardStep) && this.keyboardStep > 0) {
            return this.keyboardStep;
        }

        const steps = Math.max(0, Math.floor(this.numberOfSteps));
        if (steps > 1) {
            return 1 / (steps - 1);
        }

        return 0.1;
    }

    private getResolvedKeyboardPageStep(): number {
        if (Number.isFinite(this.keyboardPageStep) && this.keyboardPageStep > 0) {
            return this.keyboardPageStep;
        }
        return Math.max(this.getResolvedKeyboardStep() * 3, this.size * 0.95);
    }

    private normalizeSize(nextSize: number): number {
        if (!Number.isFinite(nextSize)) return 0.2;
        return Math.max(0.05, Math.min(1, nextSize));
    }

    private normalizeValue(nextValue: number): number {
        const clamped = Math.max(0, Math.min(1, Number.isFinite(nextValue) ? nextValue : 0));
        const steps = Math.max(0, Math.floor(this.numberOfSteps));
        if (steps <= 1) {
            return clamped;
        }
        const stepSize = 1 / (steps - 1);
        return Math.round(clamped / stepSize) * stepSize;
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
}
