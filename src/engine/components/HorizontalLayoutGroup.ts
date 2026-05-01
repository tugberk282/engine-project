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

export class HorizontalLayoutGroup extends Component {
    @serialize public paddingLeft: number = 8;
    @serialize public paddingRight: number = 8;
    @serialize public paddingTop: number = 8;
    @serialize public paddingBottom: number = 8;
    @serialize public spacing: number = 6;
    @serialize public childAlignment: ChildAlignment = 'UpperLeft';
    @serialize public childControlWidth: boolean = true;
    @serialize public childControlHeight: boolean = true;
    @serialize public childForceExpandWidth: boolean = false;
    @serialize public childForceExpandHeight: boolean = true;

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
        const baseWidths = children.map((entry) => entry.rect.width);
        const totalBaseWidth = baseWidths.reduce((sum, width) => sum + width, 0);
        const extraWidth = Math.max(0, innerWidth - totalBaseWidth - totalSpacing);
        const expandWidth = this.childForceExpandWidth && children.length > 0 ? extraWidth / children.length : 0;
        const alignX = this.childForceExpandWidth ? 0 : getHorizontalAlignmentFactor(this.childAlignment);
        let cursorX = selfRect.x + this.paddingLeft + ((innerWidth - totalBaseWidth - totalSpacing) * alignX);

        children.forEach((entry, index) => {
            const width = (this.childControlWidth ? entry.rect.width : entry.rect.width) + expandWidth;
            const height = this.childForceExpandHeight || this.childControlHeight
                ? innerHeight
                : entry.rect.height;
            const alignY = getVerticalAlignmentFactor(this.childAlignment);
            const y = selfRect.y + this.paddingTop + ((innerHeight - height) * alignY);

            entry.rectTransform.setPixelRectWithin(selfRect, {
                x: cursorX,
                y,
                width,
                height
            });

            cursorX += width + (index < children.length - 1 ? this.spacing : 0);
        });
    }
}
