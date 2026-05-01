import { Component } from '../Component';
import { serialize } from '../Decorators';
import { RectTransform } from './RectTransform';
import { collectImmediateLayoutChildren, resolveParentRectForGameObject, resolveRectTransformRect } from './UIRectUtils';

export type ContentSizeFitMode = 'Unconstrained' | 'PreferredSize';

export class ContentSizeFitter extends Component {
    @serialize public horizontalFit: ContentSizeFitMode = 'Unconstrained';
    @serialize public verticalFit: ContentSizeFitMode = 'PreferredSize';
    @serialize public paddingLeft: number = 0;
    @serialize public paddingRight: number = 0;
    @serialize public paddingTop: number = 0;
    @serialize public paddingBottom: number = 0;

    public awake(): void {
        this.applyFitting();
    }

    public update(): void {
        this.applyFitting();
    }

    private applyFitting(): void {
        const rectTransform = this.gameObject.getComponent(RectTransform);
        if (!rectTransform) return;

        const parentRect = resolveParentRectForGameObject(this.gameObject);
        const selfRect = resolveRectTransformRect(this.gameObject, rectTransform);
        const children = collectImmediateLayoutChildren(this.gameObject, selfRect);
        if (children.length === 0) return;

        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;

        children.forEach((entry) => {
            minX = Math.min(minX, entry.rect.x - selfRect.x);
            minY = Math.min(minY, entry.rect.y - selfRect.y);
            maxX = Math.max(maxX, entry.rect.x - selfRect.x + entry.rect.width);
            maxY = Math.max(maxY, entry.rect.y - selfRect.y + entry.rect.height);
        });

        const contentWidth = Number.isFinite(minX) && Number.isFinite(maxX) ? Math.max(0, maxX - minX) : selfRect.width;
        const contentHeight = Number.isFinite(minY) && Number.isFinite(maxY) ? Math.max(0, maxY - minY) : selfRect.height;
        const fittedRect = {
            x: selfRect.x,
            y: selfRect.y,
            width: this.horizontalFit === 'PreferredSize'
                ? contentWidth + this.paddingLeft + this.paddingRight
                : selfRect.width,
            height: this.verticalFit === 'PreferredSize'
                ? contentHeight + this.paddingTop + this.paddingBottom
                : selfRect.height
        };

        rectTransform.setPixelRectWithin(parentRect, fittedRect);
    }
}
