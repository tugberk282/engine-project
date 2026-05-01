import { Component } from '../Component';
import { GameObject } from '../GameObject';
import { serialize } from '../Decorators';
import { resolveCanvasInteractionState } from './UIRectUtils';
import { NavigationDirection, PointerEventData, UIRaycastTarget } from './UIEventInterfaces';

export type SelectableTransitionState = 'normal' | 'highlighted' | 'pressed';

export abstract class Selectable extends Component implements UIRaycastTarget {
    @serialize public navigationMode: 'Automatic' | 'Explicit' | 'None' = 'Automatic';
    @serialize public navigationUp: GameObject | null = null;
    @serialize public navigationDown: GameObject | null = null;
    @serialize public navigationLeft: GameObject | null = null;
    @serialize public navigationRight: GameObject | null = null;
    @serialize public interactable: boolean = true;

    private transitionState: SelectableTransitionState = 'normal';
    private selected: boolean = false;
    private pointerInside: boolean = false;

    public isRaycastTargetEnabled(): boolean {
        return Boolean(this.getRaycastElement()) && resolveCanvasInteractionState(this.gameObject).blocksRaycasts;
    }

    public isInteractable(): boolean {
        const interaction = resolveCanvasInteractionState(this.gameObject);
        return this.interactable && interaction.interactable;
    }

    public isSelectable(): boolean {
        return this.navigationMode !== 'None';
    }

    public getNavigationTarget(direction: NavigationDirection): GameObject | null {
        if (this.navigationMode !== 'Explicit') {
            return null;
        }

        switch (direction) {
            case 'up':
                return this.navigationUp;
            case 'down':
                return this.navigationDown;
            case 'left':
                return this.navigationLeft;
            case 'right':
                return this.navigationRight;
        }
    }

    public onPointerEnter(_eventData: PointerEventData): void {
        this.pointerInside = true;
        if (!this.isInteractable()) return;
        if (this.transitionState !== 'pressed') {
            this.setTransitionState('highlighted');
        }
    }

    public onPointerExit(_eventData: PointerEventData): void {
        this.pointerInside = false;
        if (!this.isInteractable()) {
            this.setTransitionState('normal');
            return;
        }

        this.setTransitionState(this.selected ? 'highlighted' : 'normal');
    }

    public onPointerDown(_eventData: PointerEventData): void {
        if (!this.isInteractable()) return;
        this.setTransitionState('pressed');
    }

    public onPointerMove(eventData: PointerEventData): void {
        if (!this.isInteractable()) return;
        const inside = this.isPointerWithinInteractionElement(eventData.position);
        this.setTransitionState(inside ? 'pressed' : (this.selected ? 'highlighted' : 'normal'));
    }

    public onPointerUp(_eventData: PointerEventData): void {
        if (!this.isInteractable()) return;
        this.setTransitionState(this.pointerInside || this.selected ? 'highlighted' : 'normal');
    }

    public onPointerCancel(_eventData: PointerEventData): void {
        this.setTransitionState(this.selected || this.pointerInside ? 'highlighted' : 'normal');
    }

    public onSelect(): void {
        this.selected = true;
        if (this.isInteractable() && this.transitionState !== 'pressed') {
            this.setTransitionState('highlighted');
            this.focusInteractionElement();
            return;
        }
        this.notifySelectableStateChanged();
    }

    public onDeselect(): void {
        this.selected = false;
        if (this.transitionState !== 'pressed') {
            this.setTransitionState(this.pointerInside && this.isInteractable() ? 'highlighted' : 'normal');
        } else {
            this.notifySelectableStateChanged();
        }
        this.blurInteractionElement();
    }

    protected getTransitionState(): SelectableTransitionState {
        return this.transitionState;
    }

    protected isSelectedState(): boolean {
        return this.selected;
    }

    protected isPointerInsideState(): boolean {
        return this.pointerInside;
    }

    protected notifySelectableStateChanged(): void { }

    private setTransitionState(nextState: SelectableTransitionState): void {
        if (this.transitionState === nextState) {
            this.notifySelectableStateChanged();
            return;
        }

        this.transitionState = nextState;
        this.notifySelectableStateChanged();
    }

    private isPointerWithinInteractionElement(position: { x: number; y: number }): boolean {
        const element = this.getRaycastElement();
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return position.x >= rect.left
            && position.x <= rect.right
            && position.y >= rect.top
            && position.y <= rect.bottom;
    }

    private focusInteractionElement(): void {
        this.getRaycastElement()?.focus();
    }

    private blurInteractionElement(): void {
        this.getRaycastElement()?.blur();
    }

    public abstract getRaycastElement(): HTMLElement | null;
}
