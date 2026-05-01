import { GameObject } from '../GameObject';

export type NavigationDirection = 'up' | 'down' | 'left' | 'right';

export type PointerEventData = {
    position: { x: number; y: number };
    delta: { x: number; y: number };
    scrollDelta: { x: number; y: number };
    button: number;
    pressPosition: { x: number; y: number };
    dragThreshold: number;
    dragging: boolean;
    eligibleForClick: boolean;
};

export interface UIRaycastTarget {
    gameObject: GameObject;
    getRaycastElement(): HTMLElement | null;
    isRaycastTargetEnabled(): boolean;
    isInteractable?(): boolean;
    isSelectable?(): boolean;
    getNavigationTarget?(direction: NavigationDirection): GameObject | null;
    onPointerEnter?(eventData: PointerEventData): void;
    onPointerExit?(eventData: PointerEventData): void;
    onPointerDown?(eventData: PointerEventData): void;
    onPointerMove?(eventData: PointerEventData): void;
    onPointerUp?(eventData: PointerEventData): void;
    onPointerClick?(eventData: PointerEventData): void;
    onPointerCancel?(eventData: PointerEventData): void;
    onScroll?(eventData: PointerEventData): void;
    onSelect?(): void;
    onDeselect?(): void;
    onSubmit?(): void;
}
