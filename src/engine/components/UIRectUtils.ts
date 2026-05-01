import { GameObject } from '../GameObject';
import { Canvas } from './Canvas';
import { CanvasGroup } from './CanvasGroup';
import { RectTransform } from './RectTransform';
import { Transform } from './Transform';

export type PixelRect = { x: number; y: number; width: number; height: number };
export type CanvasInteractionState = { alpha: number; interactable: boolean; blocksRaycasts: boolean };
export type ChildAlignment =
    | 'UpperLeft'
    | 'UpperCenter'
    | 'UpperRight'
    | 'MiddleLeft'
    | 'MiddleCenter'
    | 'MiddleRight'
    | 'LowerLeft'
    | 'LowerCenter'
    | 'LowerRight';

export function resolveCanvasForGameObject(gameObject: GameObject): Canvas | null {
    let current: Transform | null = gameObject.transform;
    while (current) {
        const canvas = current.gameObject.getComponent(Canvas);
        if (canvas) return canvas;
        current = current.parent;
    }
    return null;
}

export function resolveCanvasRootRect(canvas: Canvas | null): PixelRect {
    const size = canvas?.getPixelSize() ?? { width: window.innerWidth, height: window.innerHeight };
    return { x: 0, y: 0, width: size.width, height: size.height };
}

export function resolveParentRectForGameObject(gameObject: GameObject): PixelRect {
    const canvas = resolveCanvasForGameObject(gameObject);
    const rootRect = resolveCanvasRootRect(canvas);
    return resolveParentRectFromTransform(gameObject.transform.parent, rootRect);
}

export function resolveRectTransformRect(gameObject: GameObject, rectTransform?: RectTransform): PixelRect {
    const targetRectTransform = rectTransform ?? gameObject.getComponent(RectTransform);
    if (!targetRectTransform) {
        return resolveParentRectForGameObject(gameObject);
    }

    return targetRectTransform.getPixelRectWithin(resolveParentRectForGameObject(gameObject));
}

export function collectImmediateLayoutChildren(
    gameObject: GameObject,
    parentRect: PixelRect
): Array<{ gameObject: GameObject; rectTransform: RectTransform; rect: PixelRect }> {
    return gameObject.transform.children
        .map((childTransform) => childTransform.gameObject)
        .filter((childGameObject) => !childGameObject.getComponent(Canvas))
        .map((childGameObject) => {
            const rectTransform = childGameObject.getComponent(RectTransform);
            if (!rectTransform) return null;
            return {
                gameObject: childGameObject,
                rectTransform,
                rect: rectTransform.getPixelRectWithin(parentRect)
            };
        })
        .filter((entry): entry is { gameObject: GameObject; rectTransform: RectTransform; rect: PixelRect } => entry !== null);
}

export function resolveCanvasInteractionState(gameObject: GameObject): CanvasInteractionState {
    let current: Transform | null = gameObject.transform;
    let alpha = 1;
    let interactable = true;
    let blocksRaycasts = true;

    while (current) {
        const canvasGroup = current.gameObject.getComponent(CanvasGroup);
        if (canvasGroup) {
            alpha *= canvasGroup.alpha;
            interactable = interactable && canvasGroup.interactable;
            blocksRaycasts = blocksRaycasts && canvasGroup.blocksRaycasts;
            if (canvasGroup.ignoreParentGroups) {
                break;
            }
        }
        current = current.parent;
    }

    return {
        alpha: Math.max(0, alpha),
        interactable,
        blocksRaycasts
    };
}

export function isRuntimeUIInputEnabled(): boolean {
    return Boolean((window as any).Editor?.instance?.isRuntimeUIInputEnabled?.());
}

export function getHorizontalAlignmentFactor(alignment: ChildAlignment): number {
    if (alignment.endsWith('Left')) return 0;
    if (alignment.endsWith('Center')) return 0.5;
    return 1;
}

export function getVerticalAlignmentFactor(alignment: ChildAlignment): number {
    if (alignment.startsWith('Upper')) return 0;
    if (alignment.startsWith('Middle')) return 0.5;
    return 1;
}

function resolveParentRectFromTransform(transform: Transform | null, rootRect: PixelRect): PixelRect {
    if (!transform) return rootRect;
    if (transform.gameObject.getComponent(Canvas)) return rootRect;

    const ancestorRect = resolveParentRectFromTransform(transform.parent, rootRect);
    const rectTransform = transform.gameObject.getComponent(RectTransform);
    if (!rectTransform) return ancestorRect;
    return rectTransform.getPixelRectWithin(ancestorRect);
}
