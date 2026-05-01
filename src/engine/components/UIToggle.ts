import { Canvas } from './Canvas';
import { GraphicRaycaster } from './GraphicRaycaster';
import { RectTransform } from './RectTransform';
import { Selectable } from './Selectable';
import { ToggleGroup } from './ToggleGroup';
import { serialize } from '../Decorators';
import { GameObject } from '../GameObject';
import { resolveCanvasForGameObject, resolveCanvasInteractionState, resolveRectTransformRect, isRuntimeUIInputEnabled } from './UIRectUtils';
import { PointerEventData } from './UIEventInterfaces';

export class UIToggle extends Selectable {
    @serialize public label: string = 'Toggle';
    @serialize public isOn: boolean = false;
    @serialize public group: GameObject | null = null;
    @serialize public offBackgroundColor: string = '#3f3f3f';
    @serialize public onBackgroundColor: string = '#2f6ea1';
    @serialize public highlightedColor: string = '#5a5a5a';
    @serialize public pressedColor: string = '#7a7a7a';
    @serialize public disabledColor: string = '#2b2b2b';
    @serialize public checkmarkColor: string = '#ffffff';
    @serialize public textColor: string = '#ffffff';

    private element: HTMLDivElement | null = null;
    private boxElement: HTMLDivElement | null = null;
    private checkmarkElement: HTMLDivElement | null = null;
    private labelElement: HTMLDivElement | null = null;
    private canvas: Canvas | null = null;
    private raycaster: GraphicRaycaster | null = null;
    private registeredGroup: ToggleGroup | null = null;
    private focused: boolean = false;

    public onValueChanged: (value: boolean) => void = () => { };

    public awake(): void {
        this.element = document.createElement('div');
        this.element.style.position = 'absolute';
        this.element.style.display = 'flex';
        this.element.style.alignItems = 'center';
        this.element.style.gap = '8px';
        this.element.style.boxSizing = 'border-box';
        this.element.tabIndex = -1;

        this.boxElement = document.createElement('div');
        this.boxElement.style.width = '18px';
        this.boxElement.style.height = '18px';
        this.boxElement.style.border = '1px solid rgba(0,0,0,0.45)';
        this.boxElement.style.boxSizing = 'border-box';
        this.boxElement.style.display = 'flex';
        this.boxElement.style.alignItems = 'center';
        this.boxElement.style.justifyContent = 'center';
        this.boxElement.style.flex = '0 0 auto';

        this.checkmarkElement = document.createElement('div');
        this.checkmarkElement.textContent = String.fromCharCode(10003);
        this.checkmarkElement.style.fontSize = '12px';
        this.checkmarkElement.style.fontWeight = '700';
        this.checkmarkElement.style.lineHeight = '1';
        this.checkmarkElement.style.userSelect = 'none';

        this.labelElement = document.createElement('div');
        this.labelElement.style.flex = '1';
        this.labelElement.style.whiteSpace = 'nowrap';
        this.labelElement.style.overflow = 'hidden';
        this.labelElement.style.textOverflow = 'ellipsis';
        this.labelElement.style.fontFamily = 'Arial, sans-serif';
        this.labelElement.style.fontSize = '14px';

        this.boxElement.appendChild(this.checkmarkElement);
        this.element.appendChild(this.boxElement);
        this.element.appendChild(this.labelElement);
        this.bindInteractionEvents();

        this.attachToCanvas();
        this.updateVisuals();
    }

    public update(_dt: number): void {
        if (!this.canvas) {
            this.attachToCanvas();
        }
        this.syncToggleGroupRegistration();
        this.updateVisuals();
    }

    public getRaycastElement(): HTMLElement | null {
        return this.element;
    }

    public onPointerClick(_eventData: PointerEventData): void {
        if (!this.isInteractable()) return;
        this.setIsOn(!this.isOn);
    }

    public onSubmit(): void {
        if (!this.isInteractable()) return;
        this.setIsOn(!this.isOn);
    }

    public onDestroy(): void {
        this.registeredGroup?.unregisterToggle(this);
        if (this.element && this.raycaster) {
            this.raycaster.unregisterGraphic(this.element);
        }
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }

    public deserialize(data: any): void {
        super.deserialize(data);
        this.syncToggleGroupRegistration();
        this.updateVisuals();
    }

    public setIsOn(value: boolean, notify: boolean = true, fromGroup: boolean = false): boolean {
        const toggleGroup = this.getToggleGroup();
        if (!fromGroup && !value && toggleGroup && !toggleGroup.canToggleOff(this)) {
            return false;
        }

        const changed = this.isOn !== value;
        this.isOn = value;
        if (changed && value && toggleGroup && !fromGroup) {
            toggleGroup.notifyToggleActivated(this);
        }
        if (changed && notify) {
            this.onValueChanged(this.isOn);
        }
        this.updateVisuals();
        return changed;
    }

    public isOnValue(): boolean {
        return this.isOn;
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
        if (!this.element || !this.boxElement || !this.checkmarkElement || !this.labelElement || !this.canvas) return;

        const interaction = resolveCanvasInteractionState(this.gameObject);
        const canInteract = this.isInteractable();
        const inputEnabled = isRuntimeUIInputEnabled();
        const state = this.getTransitionState();

        this.element.style.pointerEvents = inputEnabled && interaction.blocksRaycasts ? 'auto' : 'none';
        this.element.style.transformOrigin = 'top left';
        this.element.style.opacity = `${interaction.alpha * (canInteract ? 1 : 0.75)}`;
        this.element.style.outline = (this.isSelectedState() || this.focused) ? '2px solid rgba(255,255,255,0.75)' : 'none';
        this.element.style.outlineOffset = this.isSelectedState() ? '0px' : '';
        this.element.style.boxShadow = (this.isSelectedState() || this.focused)
            ? '0 0 0 1px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.08)'
            : 'none';

        this.boxElement.style.background = this.resolveBoxColor(canInteract, state);
        this.checkmarkElement.style.display = this.isOn ? 'block' : 'none';
        this.checkmarkElement.style.color = this.checkmarkColor;
        this.labelElement.textContent = this.label;
        this.labelElement.style.color = canInteract ? this.textColor : 'rgba(255,255,255,0.7)';

        const rt = this.gameObject.getComponent(RectTransform);
        if (rt) {
            const rect = resolveRectTransformRect(this.gameObject, rt);
            this.element.style.width = `${rect.width}px`;
            this.element.style.height = `${rect.height}px`;
            this.element.style.left = `${rect.x}px`;
            this.element.style.top = `${rect.y}px`;
        } else {
            this.element.style.width = '160px';
            this.element.style.height = '24px';
        }

        this.syncRaycasterRegistration();
    }

    private bindInteractionEvents(): void {
        this.element?.addEventListener('focus', () => {
            this.focused = true;
            this.updateVisuals();
        });
        this.element?.addEventListener('blur', () => {
            this.focused = false;
            this.updateVisuals();
        });
        this.element?.addEventListener('keydown', (rawEvent) => {
            const event = rawEvent as KeyboardEvent;
            if (!this.isInteractable()) return;
            if (event.code !== 'Space' && event.code !== 'Enter' && event.code !== 'NumpadEnter') return;
            event.preventDefault();
            this.setIsOn(!this.isOn);
        });
    }

    private resolveBoxColor(canInteract: boolean, state: 'normal' | 'highlighted' | 'pressed'): string {
        if (!canInteract) return this.disabledColor;
        if (state === 'pressed') return this.pressedColor;
        if (state === 'highlighted') return this.highlightedColor;
        return this.isOn ? this.onBackgroundColor : this.offBackgroundColor;
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

    private syncToggleGroupRegistration(): void {
        const nextGroup = this.getToggleGroup();
        if (this.registeredGroup === nextGroup) return;

        this.registeredGroup?.unregisterToggle(this);
        this.registeredGroup = nextGroup;
        this.registeredGroup?.registerToggle(this);
    }

    private getToggleGroup(): ToggleGroup | null {
        return this.group?.getComponent(ToggleGroup) ?? null;
    }
}
