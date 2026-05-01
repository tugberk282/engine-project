import { Canvas } from './Canvas';
import { GraphicRaycaster } from './GraphicRaycaster';
import { RectTransform } from './RectTransform';
import { Selectable } from './Selectable';
import { serialize } from '../Decorators';
import { resolveCanvasForGameObject, resolveCanvasInteractionState, resolveRectTransformRect, isRuntimeUIInputEnabled } from './UIRectUtils';
import { PointerEventData } from './UIEventInterfaces';

export class UIButton extends Selectable {
    @serialize public label: string = "Button";
    @serialize public normalColor: string = '#4a4a4a';
    @serialize public selectedColor: string = '#666666';
    @serialize public highlightedColor: string = '#5a5a5a';
    @serialize public pressedColor: string = '#2f6ea1';
    @serialize public disabledColor: string = '#2b2b2b';

    private element: HTMLButtonElement | null = null;
    private canvas: Canvas | null = null;
    private raycaster: GraphicRaycaster | null = null;
    public onClick: () => void = () => { };

    public awake(): void {
        this.element = document.createElement('button');
        this.element.style.position = 'absolute';
        this.element.className = 'unity-button'; // Use editor styles for now
        this.element.type = 'button';
        this.element.tabIndex = -1;

        this.attachToCanvas();
        this.updateVisuals();
    }

    public updateVisuals(): void {
        if (!this.element || !this.canvas) return;
        const interaction = resolveCanvasInteractionState(this.gameObject);
        const canInteract = this.isInteractable();
        const inputEnabled = isRuntimeUIInputEnabled();
        this.element.innerText = this.label;
        this.element.disabled = !canInteract;
        this.element.style.pointerEvents = inputEnabled && interaction.blocksRaycasts ? 'auto' : 'none';
        this.element.style.transformOrigin = 'top left';
        this.element.style.opacity = `${interaction.alpha * (canInteract ? 1 : 0.75)}`;
        this.element.style.background = this.resolveCurrentColor(canInteract);
        this.element.style.border = '1px solid rgba(0,0,0,0.35)';
        this.element.style.color = '#ffffff';
        this.element.style.outline = this.isSelectedState() ? '2px solid rgba(255,255,255,0.75)' : 'none';
        this.element.style.outlineOffset = this.isSelectedState() ? '0px' : '';
        this.element.style.boxShadow = this.isSelectedState()
            ? '0 0 0 1px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.08)'
            : 'none';
        this.element.style.transition = 'background 0.08s ease, opacity 0.08s ease';
        this.syncRaycasterRegistration();

        const rt = this.gameObject.getComponent(RectTransform);
        if (rt) {
            const rect = resolveRectTransformRect(this.gameObject, rt);

            this.element.style.width = `${rect.width}px`;
            this.element.style.height = `${rect.height}px`;
            this.element.style.left = `${rect.x}px`;
            this.element.style.top = `${rect.y}px`;
        } else {
            this.element.style.width = '100px';
            this.element.style.height = '30px';
        }
    }

    public update(_dt: number): void {
        if (!this.canvas) {
            this.attachToCanvas();
        }
        this.updateVisuals();
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

    public serialize(): any {
        const data = super.serialize();
        data.data.label = this.label;
        return data;
    }

    public deserialize(data: any): void {
        super.deserialize(data);
        this.updateVisuals();
    }

    private resolveCurrentColor(canInteract: boolean): string {
        if (!canInteract) return this.disabledColor;
        if (this.getTransitionState() === 'pressed') return this.pressedColor;
        if (this.getTransitionState() === 'highlighted') return this.highlightedColor;
        if (this.isSelectedState()) return this.selectedColor;
        return this.normalColor;
    }

    public onDestroy(): void {
        if (this.element && this.raycaster) {
            this.raycaster.unregisterGraphic(this.element);
        }
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }

    public getRaycastElement(): HTMLElement | null {
        return this.element;
    }

    public onPointerClick(_eventData: PointerEventData): void {
        if (!this.isInteractable()) return;
        console.log(`Button '${this.label}' clicked!`);
        this.onClick();
    }

    public onSubmit(): void {
        if (!this.isInteractable()) return;
        this.onPointerDown({
            position: { x: 0, y: 0 },
            delta: { x: 0, y: 0 },
            scrollDelta: { x: 0, y: 0 },
            button: 0,
            pressPosition: { x: 0, y: 0 },
            dragThreshold: 0,
            dragging: false,
            eligibleForClick: true
        });
        this.updateVisuals();
        this.onClick();
        this.onPointerUp({
            position: { x: 0, y: 0 },
            delta: { x: 0, y: 0 },
            scrollDelta: { x: 0, y: 0 },
            button: 0,
            pressPosition: { x: 0, y: 0 },
            dragThreshold: 0,
            dragging: false,
            eligibleForClick: true
        });
        this.updateVisuals();
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

    protected notifySelectableStateChanged(): void {
        if (this.element) {
            this.updateVisuals();
        }
    }
}
