import { Component } from '../Component';
import { serialize } from '../Decorators';
import { RectTransform } from './RectTransform';
import {
    collectImmediateLayoutChildren,
    getHorizontalAlignmentFactor,
    getVerticalAlignmentFactor,
    resolveRectTransformRect
} from './UIRectUtils';
import type { ChildAlignment } from './UIRectUtils';

export class VerticalLayoutGroup extends Component {
    @serialize public paddingLeft: number = 8;
    @serialize public paddingRight: number = 8;
    @serialize public paddingTop: number = 8;
    @serialize public paddingBottom: number = 8;
    @serialize public spacing: number = 6;
    @serialize public childAlignment: ChildAlignment = 'UpperLeft';
    @serialize public childControlWidth: boolean = true;
    @serialize public childControlHeight: boolean = true;
    @serialize public childForceExpandWidth: boolean = true;
    @serialize public childForceExpandHeight: boolean = false;

    public awake(): void {
        this.applyLayout();
    }

    public update(): void {
        this.applyLayout();
    }

    private applyLayout(): void {
        const rectTransform = this.gameObject.getComponent(RectTransform);
        if (!rectTransform) return;

        const selfRect = resolveRectTransformRect(this.gameObject, rectTransform);
        const children = collectImmediateLayoutChildren(this.gameObject, selfRect);
        if (children.length === 0) return;

        const innerWidth = Math.max(0, selfRect.width - this.paddingLeft - this.paddingRight);
        const innerHeight = Math.max(0, selfRect.height - this.paddingTop - this.paddingBottom);
        const totalSpacing = Math.max(0, children.length - 1) * this.spacing;
        const baseHeights = children.map((entry) => entry.rect.height);
        const totalBaseHeight = baseHeights.reduce((sum, height) => sum + height, 0);
        const extraHeight = Math.max(0, innerHeight - totalBaseHeight - totalSpacing);
        const expandHeight = this.childForceExpandHeight && children.length > 0 ? extraHeight / children.length : 0;
        const alignY = this.childForceExpandHeight ? 0 : getVerticalAlignmentFactor(this.childAlignment);
        let cursorY = selfRect.y + this.paddingTop + ((innerHeight - totalBaseHeight - totalSpacing) * alignY);

        children.forEach((entry, index) => {
            const width = this.childForceExpandWidth || this.childControlWidth
                ? innerWidth
                : entry.rect.width;
            const height = (this.childControlHeight ? entry.rect.height : entry.rect.height) + expandHeight;
            const alignX = getHorizontalAlignmentFactor(this.childAlignment);
            const x = selfRect.x + this.paddingLeft + ((innerWidth - width) * alignX);

            entry.rectTransform.setPixelRectWithin(selfRect, {
                x,
                y: cursorY,
                width,
                height
            });

            cursorY += height + (index < children.length - 1 ? this.spacing : 0);
        });
    }
}
