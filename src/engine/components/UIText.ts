import { Component } from '../Component';
import { Canvas } from './Canvas';
import { GraphicRaycaster } from './GraphicRaycaster';
import { RectTransform } from './RectTransform';
import { serialize } from '../Decorators';
import { resolveCanvasForGameObject, resolveCanvasInteractionState, resolveRectTransformRect, isRuntimeUIInputEnabled } from './UIRectUtils';
import { UIRaycastTarget } from './UIEventInterfaces';

export class UIText extends Component implements UIRaycastTarget {
    @serialize public text: string = "New Text";
    @serialize public fontSize: number = 14;
    @serialize public color: string = "#ffffff";
    @serialize public alignment: 'left' | 'center' | 'right' = 'left';
    @serialize public raycastTarget: boolean = false;

    private element: HTMLDivElement | null = null;

    private canvas: Canvas | null = null;
    private raycaster: GraphicRaycaster | null = null;

    public awake(): void {
        this.element = document.createElement('div');
        this.element.style.position = 'absolute';
        this.element.style.pointerEvents = 'none'; // Text usually shouldn't block clicks
        this.element.style.whiteSpace = 'nowrap';
        this.element.style.overflow = 'hidden';

        this.attachToCanvas();
        this.updateVisuals();
    }

    public updateVisuals(): void {
        if (!this.element || !this.canvas) return;
        const interaction = resolveCanvasInteractionState(this.gameObject);
        this.element.innerText = this.text;
        this.element.style.fontSize = `${this.fontSize}px`;
        this.element.style.color = this.color;
        this.element.style.textAlign = this.alignment;
        this.element.style.fontFamily = 'Arial, sans-serif'; // Default engine font
        this.element.style.transformOrigin = 'top left';
        this.element.style.opacity = `${interaction.alpha}`;
        const inputEnabled = isRuntimeUIInputEnabled();
        this.element.style.pointerEvents = inputEnabled && this.raycastTarget && interaction.blocksRaycasts ? 'auto' : 'none';
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
            this.element.style.height = '20px';
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

    public update(): void {
        if (!this.canvas) {
            this.attachToCanvas();
        }
        this.updateVisuals();
    }

    public deserialize(data: any): void {
        super.deserialize(data);
        this.updateVisuals();
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

    public isRaycastTargetEnabled(): boolean {
        if (!this.element) return false;
        const interaction = resolveCanvasInteractionState(this.gameObject);
        return this.raycastTarget && interaction.blocksRaycasts;
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
