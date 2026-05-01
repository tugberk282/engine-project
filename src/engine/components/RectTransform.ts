import { Transform } from './Transform';
import { GameObject } from '../GameObject';
import * as THREE from 'three';
import { serialize } from '../Decorators';

export class RectTransform extends Transform {
    @serialize public sizeDelta: THREE.Vector2 = new THREE.Vector2(100, 100);
    @serialize public anchoredPosition: THREE.Vector2 = new THREE.Vector2(0, 0);
    @serialize public anchorMin: THREE.Vector2 = new THREE.Vector2(0.5, 0.5);
    @serialize public anchorMax: THREE.Vector2 = new THREE.Vector2(0.5, 0.5);
    @serialize public pivot: THREE.Vector2 = new THREE.Vector2(0.5, 0.5);

    constructor(gameObject: GameObject) {
        super(gameObject);
    }

    public getPixelRect(parentWidth: number, parentHeight: number): { x: number, y: number, width: number, height: number } {
        return this.getLocalPixelRect(parentWidth, parentHeight);
    }

    public getPixelRectWithin(parentRect: { x: number, y: number, width: number, height: number }): { x: number, y: number, width: number, height: number } {
        const localRect = this.getLocalPixelRect(parentRect.width, parentRect.height);
        return {
            x: parentRect.x + localRect.x,
            y: parentRect.y + localRect.y,
            width: localRect.width,
            height: localRect.height
        };
    }

    public getLocalPixelRect(parentWidth: number, parentHeight: number): { x: number, y: number, width: number, height: number } {
        // Calculate anchor pixel positions
        const aMinX = this.anchorMin.x * parentWidth;
        const aMaxX = this.anchorMax.x * parentWidth;
        const aMinY = (1 - this.anchorMin.y) * parentHeight; // Invert Y for HTML (top=0)
        const aMaxY = (1 - this.anchorMax.y) * parentHeight;

        let width: number;
        let height: number;
        let x: number;
        let y: number;

        // Horizontal
        if (this.anchorMin.x === this.anchorMax.x) {
            width = this.sizeDelta.x;
            x = aMinX + this.anchoredPosition.x - (this.pivot.x * width);
        } else {
            // Stretching: sizeDelta.x is left/right padding if we were doing it perfectly
            // Simplified: treat as Width if not stretching, or offset if it's Unity-style
            width = (aMaxX - aMinX) + this.sizeDelta.x;
            x = aMinX + this.anchoredPosition.x;
        }

        // Vertical
        if (this.anchorMin.y === this.anchorMax.y) {
            height = this.sizeDelta.y;
            // In Unity, +Y anchoredPosition moves UP. In HTML, -Y moves UP.
            y = aMinY - this.anchoredPosition.y - ((1 - this.pivot.y) * height);
        } else {
            height = (aMinY - aMaxY) + this.sizeDelta.y;
            y = aMaxY - this.anchoredPosition.y;
        }

        return { x, y, width, height };
    }

    public setPixelRectWithin(
        parentRect: { x: number; y: number; width: number; height: number },
        rect: { x: number; y: number; width: number; height: number }
    ): void {
        this.setLocalPixelRect(parentRect.width, parentRect.height, {
            x: rect.x - parentRect.x,
            y: rect.y - parentRect.y,
            width: rect.width,
            height: rect.height
        });
    }

    public setLocalPixelRect(
        parentWidth: number,
        parentHeight: number,
        rect: { x: number; y: number; width: number; height: number }
    ): void {
        const width = Math.max(0, rect.width);
        const height = Math.max(0, rect.height);
        const aMinX = this.anchorMin.x * parentWidth;
        const aMaxX = this.anchorMax.x * parentWidth;
        const aMinY = (1 - this.anchorMin.y) * parentHeight;
        const aMaxY = (1 - this.anchorMax.y) * parentHeight;

        if (this.anchorMin.x === this.anchorMax.x) {
            this.sizeDelta.x = width;
            this.anchoredPosition.x = rect.x - aMinX + (this.pivot.x * width);
        } else {
            this.sizeDelta.x = width - (aMaxX - aMinX);
            this.anchoredPosition.x = rect.x - aMinX;
        }

        if (this.anchorMin.y === this.anchorMax.y) {
            this.sizeDelta.y = height;
            this.anchoredPosition.y = aMinY - rect.y - ((1 - this.pivot.y) * height);
        } else {
            this.sizeDelta.y = height - (aMinY - aMaxY);
            this.anchoredPosition.y = aMaxY - rect.y;
        }
    }
}
