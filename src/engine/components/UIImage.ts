import { Component } from '../Component';
import { Canvas } from './Canvas';
import { GraphicRaycaster } from './GraphicRaycaster';
import { RectTransform } from './RectTransform';
import { serialize } from '../Decorators';
import { resolveCanvasForGameObject, resolveCanvasInteractionState, resolveRectTransformRect, isRuntimeUIInputEnabled } from './UIRectUtils';
import { UIRaycastTarget } from './UIEventInterfaces';

export class UIImage extends Component implements UIRaycastTarget {
    @serialize public color: string = '#ffffff';
    @serialize public spritePath: string | null = null;
    @serialize public raycastTarget: boolean = true;

    private element: HTMLDivElement | null = null;
    private canvas: Canvas | null = null;
    private raycaster: GraphicRaycaster | null = null;

    public awake(): void {
        this.element = document.createElement('div');
        this.element.style.position = 'absolute';
        this.attachToCanvas();
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
        } else {
            console.warn("UIImage needs to be a child of a Canvas!");
        }
    }

    public updateVisuals(): void {
        if (!this.element || !this.canvas) return;
        const interaction = resolveCanvasInteractionState(this.gameObject);
        this.element.style.backgroundColor = this.color;
        const inputEnabled = isRuntimeUIInputEnabled();
        this.element.style.pointerEvents = inputEnabled && this.raycastTarget && interaction.blocksRaycasts ? 'auto' : 'none';
        this.element.style.transformOrigin = 'top left';
        this.element.style.opacity = `${interaction.alpha}`;
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

        if (this.spritePath) {
            this.element.style.backgroundImage = `url(${this.spritePath})`;
            this.element.style.backgroundSize = 'cover';
        } else {
            this.element.style.backgroundImage = 'none';
        }
    }

    public update(_dt: number): void {
        if (!this.canvas) {
            this.attachToCanvas();
        }
        this.updateVisuals();
    }

    public serialize(): any {
        const data = super.serialize();
        data.data.color = this.color;
        data.data.spritePath = this.spritePath;
        return data;
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
