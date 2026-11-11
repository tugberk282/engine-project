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
    @serialize public imageType: 'Simple' | 'Filled' = 'Simple';
    @serialize public preserveAspect: boolean = false;
    @serialize public fillMethod: 'Horizontal' | 'Vertical' | 'Radial360' = 'Horizontal';
    @serialize public fillOrigin: number = 0;
    @serialize public fillClockwise: boolean = true;
    @serialize public fillAmount: number = 1;

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
            this.element.style.backgroundSize = this.preserveAspect ? 'contain' : '100% 100%';
            this.element.style.backgroundPosition = 'center';
            this.element.style.backgroundRepeat = 'no-repeat';
        } else {
            this.element.style.backgroundImage = 'none';
        }
        this.applyImageType();
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

    private applyImageType(): void {
        if (!this.element) return;
        this.element.style.clipPath = 'none';
        this.element.style.maskImage = 'none';
        (this.element.style as any).webkitMaskImage = 'none';
        if (this.imageType !== 'Filled') return;
        const amount = Math.max(0, Math.min(1, Number(this.fillAmount) || 0));
        if (this.fillMethod === 'Horizontal') {
            const empty = (1 - amount) * 100;
            this.element.style.clipPath = this.fillOrigin === 1
                ? `inset(0 0 0 ${empty}%)`
                : `inset(0 ${empty}% 0 0)`;
            return;
        }
        if (this.fillMethod === 'Vertical') {
            const empty = (1 - amount) * 100;
            this.element.style.clipPath = this.fillOrigin === 1
                ? `inset(0 0 ${empty}% 0)`
                : `inset(${empty}% 0 0 0)`;
            return;
        }
        const origin = [180, 270, 0, 90][Math.max(0, Math.min(3, Math.trunc(this.fillOrigin)))] ?? 180;
        const sweep = amount * 360;
        const start = this.fillClockwise ? origin : origin - sweep;
        const mask = `conic-gradient(from ${start}deg, #000 0deg ${sweep}deg, transparent ${sweep}deg 360deg)`;
        this.element.style.maskImage = mask;
        (this.element.style as any).webkitMaskImage = mask;
    }
}
