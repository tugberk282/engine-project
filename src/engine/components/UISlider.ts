import { Canvas } from './Canvas';
import { GraphicRaycaster } from './GraphicRaycaster';
import { RectTransform } from './RectTransform';
import { Selectable } from './Selectable';
import { serialize } from '../Decorators';
import { resolveCanvasForGameObject, resolveCanvasInteractionState, resolveRectTransformRect, isRuntimeUIInputEnabled } from './UIRectUtils';
import { PointerEventData } from './UIEventInterfaces';

type SliderDirection = 'LeftToRight' | 'RightToLeft' | 'BottomToTop' | 'TopToBottom';

export class UISlider extends Selectable {
    @serialize public minValue: number = 0;
    @serialize public maxValue: number = 1;
    @serialize public value: number = 0.5;
    @serialize public wholeNumbers: boolean = false;
    @serialize public keyboardStep: number = 0;
    @serialize public keyboardPageStep: number = 0;
    @serialize public direction: SliderDirection = 'LeftToRight';
    @serialize public backgroundColor: string = '#3f3f3f';
    @serialize public fillColor: string = '#2f6ea1';
    @serialize public handleColor: string = '#f2f2f2';
    @serialize public highlightedColor: string = '#5a5a5a';
    @serialize public pressedColor: string = '#7a7a7a';
    @serialize public disabledColor: string = '#2b2b2b';

    private element: HTMLDivElement | null = null;
    private trackElement: HTMLDivElement | null = null;
    private fillElement: HTMLDivElement | null = null;
    private handleElement: HTMLDivElement | null = null;
    private canvas: Canvas | null = null;
    private raycaster: GraphicRaycaster | null = null;

    public onValueChanged: (value: number) => void = () => { };

    public awake(): void {
        this.element = document.createElement('div');
        this.element.style.position = 'absolute';
        this.element.style.display = 'flex';
        this.element.style.alignItems = 'center';
        this.element.style.boxSizing = 'border-box';
        this.element.tabIndex = -1;

        this.trackElement = document.createElement('div');
        this.trackElement.style.position = 'relative';
        this.trackElement.style.width = '100%';
        this.trackElement.style.height = '6px';
        this.trackElement.style.borderRadius = '999px';
        this.trackElement.style.overflow = 'visible';

        this.fillElement = document.createElement('div');
        this.fillElement.style.position = 'absolute';
        this.fillElement.style.top = '0';
        this.fillElement.style.height = '100%';
        this.fillElement.style.borderRadius = '999px';

        this.handleElement = document.createElement('div');
        this.handleElement.style.position = 'absolute';
        this.handleElement.style.top = '50%';
        this.handleElement.style.width = '16px';
        this.handleElement.style.height = '16px';
        this.handleElement.style.borderRadius = '50%';
        this.handleElement.style.transform = 'translate(-50%, -50%)';
        this.handleElement.style.boxShadow = '0 1px 3px rgba(0,0,0,0.45)';

        this.trackElement.appendChild(this.fillElement);
        this.trackElement.appendChild(this.handleElement);
        this.element.appendChild(this.trackElement);
        this.bindKeyboardEvents();

        this.attachToCanvas();
        this.value = this.normalizeValue(this.value);
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
        this.updateValueFromPointer(eventData.position, true);
    }

    public onPointerMove(eventData: PointerEventData): void {
        super.onPointerMove(eventData);
        if (!this.isInteractable()) return;
        this.updateValueFromPointer(eventData.position, true);
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
        this.updateVisuals();
    }

    public setValue(nextValue: number, notify: boolean = true): boolean {
        const normalized = this.normalizeValue(nextValue);
        const changed = normalized !== this.value;
        this.value = normalized;
        if (changed && notify) {
            this.onValueChanged(this.value);
        }
        this.updateVisuals();
        return changed;
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
        if (!this.element || !this.trackElement || !this.fillElement || !this.handleElement || !this.canvas) return;

        const interaction = resolveCanvasInteractionState(this.gameObject);
        const canInteract = this.isInteractable();
        const inputEnabled = isRuntimeUIInputEnabled();
        const transitionState = this.getTransitionState();
        const normalized = this.getNormalizedValue();
        const percent = Math.max(0, Math.min(1, normalized)) * 100;
        const isHorizontal = this.isHorizontal();

        this.element.style.pointerEvents = inputEnabled && interaction.blocksRaycasts ? 'auto' : 'none';
        this.element.style.transformOrigin = 'top left';
        this.element.style.opacity = `${interaction.alpha * (canInteract ? 1 : 0.75)}`;
        this.element.style.outline = this.isSelectedState() ? '2px solid rgba(255,255,255,0.75)' : 'none';
        this.element.style.outlineOffset = this.isSelectedState() ? '2px' : '';

        this.trackElement.style.background = canInteract ? this.backgroundColor : this.disabledColor;
        this.fillElement.style.background = canInteract ? this.fillColor : 'rgba(255,255,255,0.25)';
        if (isHorizontal) {
            this.fillElement.style.top = '0';
            this.fillElement.style.bottom = 'auto';
            this.fillElement.style.height = '100%';
            this.fillElement.style.width = `${percent}%`;
            if (this.direction === 'RightToLeft') {
                this.fillElement.style.right = '0';
                this.fillElement.style.left = 'auto';
                this.handleElement.style.left = `${100 - percent}%`;
            } else {
                this.fillElement.style.left = '0';
                this.fillElement.style.right = 'auto';
                this.handleElement.style.left = `${percent}%`;
            }

            this.handleElement.style.top = '50%';
            this.handleElement.style.width = '16px';
            this.handleElement.style.height = '16px';
            this.handleElement.style.transform = 'translate(-50%, -50%)';
        } else {
            this.fillElement.style.left = '0';
            this.fillElement.style.right = 'auto';
            this.fillElement.style.width = '100%';
            this.fillElement.style.height = `${percent}%`;
            if (this.direction === 'TopToBottom') {
                this.fillElement.style.top = '0';
                this.fillElement.style.bottom = 'auto';
                this.handleElement.style.top = `${percent}%`;
            } else {
                this.fillElement.style.bottom = '0';
                this.fillElement.style.top = 'auto';
                this.handleElement.style.top = `${100 - percent}%`;
            }

            this.handleElement.style.left = '50%';
            this.handleElement.style.width = '16px';
            this.handleElement.style.height = '16px';
            this.handleElement.style.transform = 'translate(-50%, -50%)';
        }

        this.handleElement.style.background = this.resolveHandleColor(canInteract, transitionState);

        const rt = this.gameObject.getComponent(RectTransform);
        if (rt) {
            const rect = resolveRectTransformRect(this.gameObject, rt);
            this.element.style.width = `${rect.width}px`;
            this.element.style.height = `${rect.height}px`;
            this.element.style.left = `${rect.x}px`;
            this.element.style.top = `${rect.y}px`;
        } else {
            this.element.style.width = '180px';
            this.element.style.height = '24px';
        }

        this.syncRaycasterRegistration();
    }

    private resolveHandleColor(canInteract: boolean, state: 'normal' | 'highlighted' | 'pressed'): string {
        if (!canInteract) return this.disabledColor;
        if (state === 'pressed') return this.pressedColor;
        if (state === 'highlighted') return this.highlightedColor;
        return this.handleColor;
    }

    private updateValueFromPointer(position: { x: number; y: number }, notify: boolean): void {
        if (!this.trackElement) return;
        const rect = this.trackElement.getBoundingClientRect();
        const axisLength = this.isHorizontal() ? rect.width : rect.height;
        if (axisLength <= 0) return;

        const normalized = this.getDirectionalPointerRatio(position, rect);
        const clamped = Math.max(0, Math.min(1, normalized));
        const nextValue = this.minValue + (this.maxValue - this.minValue) * clamped;
        this.setValue(nextValue, notify);
    }

    private bindKeyboardEvents(): void {
        this.element?.addEventListener('keydown', (rawEvent) => {
            const event = rawEvent as KeyboardEvent;
            if (!this.isInteractable()) return;

            if (event.code === 'Home') {
                event.preventDefault();
                this.setValue(this.minValue, true);
                return;
            }

            if (event.code === 'End') {
                event.preventDefault();
                this.setValue(this.maxValue, true);
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

    private normalizeValue(nextValue: number): number {
        const min = Math.min(this.minValue, this.maxValue);
        const max = Math.max(this.minValue, this.maxValue);
        const clamped = Math.max(min, Math.min(max, nextValue));
        return this.wholeNumbers ? Math.round(clamped) : clamped;
    }

    private getNormalizedValue(): number {
        const range = this.maxValue - this.minValue;
        if (Math.abs(range) <= 0.00001) return 0;
        return (this.value - this.minValue) / range;
    }

    private isHorizontal(): boolean {
        return this.direction === 'LeftToRight' || this.direction === 'RightToLeft';
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

        if (this.wholeNumbers) {
            return 1;
        }

        const range = Math.abs(this.maxValue - this.minValue);
        return range > 0.00001 ? range * 0.1 : 0.1;
    }

    private getResolvedKeyboardPageStep(): number {
        if (Number.isFinite(this.keyboardPageStep) && this.keyboardPageStep > 0) {
            return this.keyboardPageStep;
        }
        return this.getResolvedKeyboardStep() * 3;
    }

    private getDirectionalPointerRatio(position: { x: number; y: number }, rect: DOMRect): number {
        switch (this.direction) {
            case 'LeftToRight':
                return (position.x - rect.left) / rect.width;
            case 'RightToLeft':
                return (rect.right - position.x) / rect.width;
            case 'BottomToTop':
                return (rect.bottom - position.y) / rect.height;
            case 'TopToBottom':
                return (position.y - rect.top) / rect.height;
        }
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
