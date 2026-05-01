import { Canvas } from './Canvas';
import { GraphicRaycaster } from './GraphicRaycaster';
import { RectTransform } from './RectTransform';
import { Selectable } from './Selectable';
import { serialize } from '../Decorators';
import { resolveCanvasForGameObject, resolveCanvasInteractionState, resolveRectTransformRect, isRuntimeUIInputEnabled } from './UIRectUtils';
import { PointerEventData } from './UIEventInterfaces';

export class UIDropdown extends Selectable {
    @serialize public options: string[] = ['Option A', 'Option B', 'Option C'];
    @serialize public disabledOptionIndices: number[] = [];
    @serialize public popupDirection: 'Auto' | 'Down' | 'Up' = 'Auto';
    @serialize public selectedIndex: number = 0;
    @serialize public maxVisibleItems: number = 6;
    @serialize public normalColor: string = '#3f3f3f';
    @serialize public selectedColor: string = '#565656';
    @serialize public highlightedColor: string = '#4e4e4e';
    @serialize public pressedColor: string = '#2f6ea1';
    @serialize public disabledColor: string = '#2b2b2b';
    @serialize public itemBackgroundColor: string = '#2f2f2f';
    @serialize public itemSelectedColor: string = '#355f86';
    @serialize public itemHighlightedColor: string = '#4a4a4a';
    @serialize public textColor: string = '#ffffff';

    private element: HTMLDivElement | null = null;
    private headerElement: HTMLDivElement | null = null;
    private captionElement: HTMLDivElement | null = null;
    private arrowElement: HTMLDivElement | null = null;
    private popupElement: HTMLDivElement | null = null;
    private canvas: Canvas | null = null;
    private raycaster: GraphicRaycaster | null = null;
    private expanded: boolean = false;
    private highlightedOptionIndex: number = -1;
    private readonly optionItemHeight: number = 30;
    private readonly handleDocumentPointerDown = (event: PointerEvent) => {
        if (!this.expanded || !this.element) return;
        const target = event.target as Node | null;
        if (target && this.element.contains(target)) return;
        this.setExpanded(false);
    };

    public onValueChanged: (index: number, value: string | null) => void = () => { };

    public awake(): void {
        this.element = document.createElement('div');
        this.element.style.position = 'absolute';
        this.element.style.boxSizing = 'border-box';
        this.element.style.overflow = 'visible';

        this.headerElement = document.createElement('div');
        this.headerElement.style.position = 'absolute';
        this.headerElement.style.left = '0';
        this.headerElement.style.top = '0';
        this.headerElement.style.display = 'flex';
        this.headerElement.style.alignItems = 'center';
        this.headerElement.style.justifyContent = 'space-between';
        this.headerElement.style.padding = '0 8px';
        this.headerElement.style.border = '1px solid rgba(0,0,0,0.35)';
        this.headerElement.style.borderRadius = '3px';
        this.headerElement.style.boxSizing = 'border-box';
        this.headerElement.style.fontFamily = 'Arial, sans-serif';
        this.headerElement.style.fontSize = '14px';
        this.headerElement.style.userSelect = 'none';
        this.headerElement.tabIndex = -1;

        this.captionElement = document.createElement('div');
        this.captionElement.style.flex = '1';
        this.captionElement.style.whiteSpace = 'nowrap';
        this.captionElement.style.overflow = 'hidden';
        this.captionElement.style.textOverflow = 'ellipsis';
        this.captionElement.style.paddingRight = '8px';

        this.arrowElement = document.createElement('div');
        this.arrowElement.textContent = '▼';
        this.arrowElement.style.fontSize = '10px';
        this.arrowElement.style.opacity = '0.85';
        this.arrowElement.style.flex = '0 0 auto';

        this.popupElement = document.createElement('div');
        this.popupElement.style.position = 'absolute';
        this.popupElement.style.left = '0';
        this.popupElement.style.top = 'calc(100% + 2px)';
        this.popupElement.style.display = 'none';
        this.popupElement.style.flexDirection = 'column';
        this.popupElement.style.border = '1px solid rgba(0,0,0,0.45)';
        this.popupElement.style.borderRadius = '3px';
        this.popupElement.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
        this.popupElement.style.overflow = 'hidden';
        this.popupElement.style.zIndex = '8';

        this.headerElement.appendChild(this.captionElement);
        this.headerElement.appendChild(this.arrowElement);
        this.element.appendChild(this.headerElement);
        this.element.appendChild(this.popupElement);

        this.bindKeyboardEvents();
        this.attachToCanvas();
        document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
        this.selectedIndex = this.normalizeSelectedIndex(this.selectedIndex);
        this.highlightedOptionIndex = this.selectedIndex;
        this.updateVisuals();
    }

    public update(_dt: number): void {
        if (!this.canvas) {
            this.attachToCanvas();
        }
        this.selectedIndex = this.normalizeSelectedIndex(this.selectedIndex);
        if (this.expanded) {
            this.highlightedOptionIndex = this.normalizeSelectedIndex(this.highlightedOptionIndex);
        }
        this.updateVisuals();
    }

    public getRaycastElement(): HTMLElement | null {
        return this.headerElement;
    }

    public onPointerClick(_eventData: PointerEventData): void {
        if (!this.isInteractable()) return;
        this.toggleExpanded();
    }

    public onSubmit(): void {
        if (!this.isInteractable()) return;
        if (!this.expanded) {
            this.setExpanded(true);
            return;
        }

        this.setSelectedIndex(this.highlightedOptionIndex >= 0 ? this.highlightedOptionIndex : this.selectedIndex);
        this.setExpanded(false);
    }

    public onDeselect(): void {
        super.onDeselect();
        this.setExpanded(false);
    }

    public onScroll(eventData: PointerEventData): void {
        if (!this.isInteractable() || !this.expanded || this.options.length === 0) return;
        if (Math.abs(eventData.scrollDelta.y) <= 0.0001) return;
        this.moveHighlighted(eventData.scrollDelta.y > 0 ? 1 : -1);
    }

    public onDestroy(): void {
        document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
        if (this.headerElement && this.raycaster) {
            this.raycaster.unregisterGraphic(this.headerElement);
        }
        if (this.element?.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }

    public deserialize(data: any): void {
        super.deserialize(data);
        this.disabledOptionIndices = this.normalizeDisabledOptionIndices(this.disabledOptionIndices);
        this.selectedIndex = this.normalizeSelectedIndex(this.selectedIndex);
        this.highlightedOptionIndex = this.selectedIndex;
        this.updateVisuals();
    }

    public setSelectedIndex(index: number, notify: boolean = true): boolean {
        const normalized = this.normalizeSelectedIndex(index);
        const changed = normalized !== this.selectedIndex;
        this.selectedIndex = normalized;
        this.highlightedOptionIndex = normalized;
        if (changed && notify) {
            this.onValueChanged(this.selectedIndex, this.getSelectedOption());
        }
        this.updateVisuals();
        return changed;
    }

    public getSelectedOption(): string | null {
        if (this.selectedIndex < 0 || this.selectedIndex >= this.options.length) {
            return null;
        }
        return this.options[this.selectedIndex] ?? null;
    }

    protected notifySelectableStateChanged(): void {
        if (this.element) {
            this.updateVisuals();
        }
    }

    private bindKeyboardEvents(): void {
        this.headerElement?.addEventListener('keydown', (event) => {
            if (!this.isInteractable()) return;

            if (event.code === 'ArrowDown') {
                event.preventDefault();
                if (!this.expanded) {
                    this.setExpanded(true);
                    return;
                }
                this.moveHighlighted(1);
                return;
            }

            if (event.code === 'ArrowUp') {
                event.preventDefault();
                if (!this.expanded) {
                    this.setExpanded(true);
                    return;
                }
                this.moveHighlighted(-1);
                return;
            }

            if (event.code === 'Escape' && this.expanded) {
                event.preventDefault();
                this.setExpanded(false);
                return;
            }

            if (event.code === 'Space') {
                event.preventDefault();
                this.toggleExpanded();
                return;
            }

            if (event.code === 'Home' && this.expanded) {
                event.preventDefault();
                this.highlightedOptionIndex = this.findSelectableOption(0, 1);
                this.updateVisuals();
                return;
            }

            if (event.code === 'End' && this.expanded) {
                event.preventDefault();
                this.highlightedOptionIndex = this.findSelectableOption(Math.max(0, this.options.length - 1), -1);
                this.updateVisuals();
                return;
            }

            if (event.code === 'PageDown' && this.expanded) {
                event.preventDefault();
                this.moveHighlightedByPage(1);
                return;
            }

            if (event.code === 'PageUp' && this.expanded) {
                event.preventDefault();
                this.moveHighlightedByPage(-1);
            }
        });
    }

    private moveHighlighted(direction: 1 | -1): void {
        if (this.options.length === 0) {
            this.highlightedOptionIndex = -1;
            this.updateVisuals();
            return;
        }

        const current = this.highlightedOptionIndex >= 0 ? this.highlightedOptionIndex : this.selectedIndex;
        const next = this.findSelectableOption(current + direction, direction);
        this.highlightedOptionIndex = next;
        this.updateVisuals();
    }

    private moveHighlightedByPage(direction: 1 | -1): void {
        if (this.options.length === 0) return;
        const step = Math.max(1, this.maxVisibleItems - 1);
        const current = this.highlightedOptionIndex >= 0 ? this.highlightedOptionIndex : this.selectedIndex;
        const next = this.findSelectableOption(current + (step * direction), direction);
        this.highlightedOptionIndex = next;
        this.updateVisuals();
    }

    private attachToCanvas(): void {
        const canvas = resolveCanvasForGameObject(this.gameObject) ?? undefined;
        if (canvas) {
            if (this.canvas && this.canvas !== canvas && this.headerElement && this.raycaster) {
                this.raycaster.unregisterGraphic(this.headerElement);
            }
            this.canvas = canvas;
            canvas.addUIElement(this.element!);
        }
    }

    private updateVisuals(): void {
        if (!this.element || !this.headerElement || !this.captionElement || !this.arrowElement || !this.popupElement || !this.canvas) return;

        const interaction = resolveCanvasInteractionState(this.gameObject);
        const canInteract = this.isInteractable();
        const inputEnabled = isRuntimeUIInputEnabled();
        const selectedOption = this.getSelectedOption();

        this.element.style.pointerEvents = inputEnabled && interaction.blocksRaycasts ? 'auto' : 'none';
        this.element.style.opacity = `${interaction.alpha * (canInteract ? 1 : 0.75)}`;
        this.element.style.transformOrigin = 'top left';

        this.headerElement.style.background = this.resolveCurrentColor(canInteract);
        this.headerElement.style.color = canInteract ? this.textColor : 'rgba(255,255,255,0.65)';
        this.headerElement.style.outline = this.isSelectedState() ? '2px solid rgba(255,255,255,0.75)' : 'none';
        this.headerElement.style.outlineOffset = this.isSelectedState() ? '1px' : '';
        this.headerElement.style.boxShadow = this.isSelectedState()
            ? '0 0 0 1px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.06)'
            : 'none';

        this.captionElement.textContent = selectedOption ?? 'None';
        this.arrowElement.textContent = this.expanded ? '▲' : '▼';

        const rt = this.gameObject.getComponent(RectTransform);
        let width = 160;
        let height = 28;
        let left = 0;
        let top = 0;
        if (rt) {
            const rect = resolveRectTransformRect(this.gameObject, rt);
            width = rect.width;
            height = rect.height;
            left = rect.x;
            top = rect.y;
        }

        this.element.style.width = `${width}px`;
        this.element.style.height = `${height}px`;
        this.element.style.left = `${left}px`;
        this.element.style.top = `${top}px`;
        this.headerElement.style.width = `${width}px`;
        this.headerElement.style.height = `${height}px`;

        this.popupElement.style.display = this.expanded && this.options.length > 0 ? 'flex' : 'none';
        this.popupElement.style.width = `${width}px`;
        this.popupElement.style.background = this.itemBackgroundColor;
        this.popupElement.style.maxHeight = `${Math.max(1, this.maxVisibleItems) * this.optionItemHeight}px`;
        this.popupElement.style.overflowY = this.options.length > this.maxVisibleItems ? 'auto' : 'hidden';
        this.applyPopupDirection(height);
        this.renderOptions();
        this.syncPopupScrollPosition();

        this.syncRaycasterRegistration();
    }

    private renderOptions(): void {
        if (!this.popupElement) return;
        this.popupElement.innerHTML = '';

        this.options.forEach((option, index) => {
            const item = document.createElement('div');
            const highlighted = index === this.highlightedOptionIndex;
            const selected = index === this.selectedIndex;
            const disabled = this.isOptionDisabled(index);
            item.textContent = option;
            item.style.padding = '6px 8px';
            item.style.minHeight = `${this.optionItemHeight - 12}px`;
            item.style.fontFamily = 'Arial, sans-serif';
            item.style.fontSize = '13px';
            item.style.color = disabled ? 'rgba(255,255,255,0.45)' : this.textColor;
            item.style.background = highlighted
                ? this.itemHighlightedColor
                : (selected ? this.itemSelectedColor : this.itemBackgroundColor);
            item.style.cursor = disabled ? 'default' : 'pointer';
            item.style.opacity = disabled ? '0.75' : '1';
            item.style.userSelect = 'none';
            item.onmouseenter = () => {
                if (disabled) return;
                this.highlightedOptionIndex = index;
                this.updateVisuals();
            };
            item.onmousedown = (event) => {
                event.preventDefault();
            };
            item.onclick = (event) => {
                event.stopPropagation();
                if (disabled) return;
                this.setSelectedIndex(index, true);
                this.setExpanded(false);
                this.headerElement?.focus();
            };
            this.popupElement?.appendChild(item);
        });
    }

    private resolveCurrentColor(canInteract: boolean): string {
        if (!canInteract) return this.disabledColor;
        if (this.getTransitionState() === 'pressed') return this.pressedColor;
        if (this.getTransitionState() === 'highlighted') return this.highlightedColor;
        if (this.isSelectedState() || this.expanded) return this.selectedColor;
        return this.normalColor;
    }

    private applyPopupDirection(headerHeight: number): void {
        if (!this.popupElement || !this.headerElement) return;
        const popupHeight = Math.min(this.options.length, Math.max(1, this.maxVisibleItems)) * this.optionItemHeight;
        const headerRect = this.headerElement.getBoundingClientRect();
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const spaceBelow = viewportHeight - headerRect.bottom;
        const spaceAbove = headerRect.top;
        const openUp = this.popupDirection === 'Up'
            || (this.popupDirection === 'Auto' && spaceBelow < popupHeight && spaceAbove > spaceBelow);

        if (openUp) {
            this.popupElement.style.top = `-${popupHeight + 2}px`;
        } else {
            this.popupElement.style.top = `${headerHeight + 2}px`;
        }
    }

    private syncPopupScrollPosition(): void {
        if (!this.popupElement || !this.expanded || this.highlightedOptionIndex < 0) return;
        const visibleCount = Math.max(1, this.maxVisibleItems);
        const optionTop = this.highlightedOptionIndex * this.optionItemHeight;
        const optionBottom = optionTop + this.optionItemHeight;
        const viewportTop = this.popupElement.scrollTop;
        const viewportBottom = viewportTop + (visibleCount * this.optionItemHeight);

        if (optionTop < viewportTop) {
            this.popupElement.scrollTop = optionTop;
        } else if (optionBottom > viewportBottom) {
            this.popupElement.scrollTop = optionBottom - (visibleCount * this.optionItemHeight);
        }
    }

    private syncRaycasterRegistration(): void {
        if (!this.headerElement || !this.canvas) return;
        const nextRaycaster = this.canvas.gameObject.getComponent(GraphicRaycaster) ?? null;
        if (this.raycaster && this.raycaster !== nextRaycaster) {
            this.raycaster.unregisterGraphic(this.headerElement);
        }
        this.raycaster = nextRaycaster;
        if (this.raycaster) {
            this.raycaster.registerGraphic(this, this.headerElement);
        }
    }

    private setExpanded(expanded: boolean): void {
        if (this.expanded === expanded) {
            this.updateVisuals();
            return;
        }
        this.expanded = expanded;
        if (expanded) {
            this.highlightedOptionIndex = this.selectedIndex >= 0
                ? this.selectedIndex
                : this.findSelectableOption(0, 1);
            this.headerElement?.focus();
        }
        this.updateVisuals();
    }

    private toggleExpanded(): void {
        this.setExpanded(!this.expanded);
    }

    private normalizeSelectedIndex(index: number): number {
        if (this.options.length === 0) return -1;
        if (!Number.isFinite(index)) return 0;
        const clamped = Math.max(0, Math.min(Math.trunc(index), this.options.length - 1));
        if (!this.isOptionDisabled(clamped)) {
            return clamped;
        }
        return this.findSelectableOption(clamped, 1);
    }

    private normalizeDisabledOptionIndices(indices: number[]): number[] {
        if (!Array.isArray(indices) || this.options.length === 0) return [];
        return Array.from(new Set(
            indices
                .map((value) => Math.trunc(Number(value)))
                .filter((value) => Number.isFinite(value) && value >= 0 && value < this.options.length)
        )).sort((a, b) => a - b);
    }

    private isOptionDisabled(index: number): boolean {
        return this.disabledOptionIndices.includes(index);
    }

    private findSelectableOption(startIndex: number, direction: 1 | -1): number {
        if (this.options.length === 0) return -1;
        if (this.disabledOptionIndices.length >= this.options.length) {
            return Math.max(0, Math.min(this.options.length - 1, Math.trunc(startIndex) || 0));
        }

        let cursor = ((Math.trunc(startIndex) % this.options.length) + this.options.length) % this.options.length;
        for (let i = 0; i < this.options.length; i++) {
            if (!this.isOptionDisabled(cursor)) {
                return cursor;
            }
            cursor = (cursor + direction + this.options.length) % this.options.length;
        }
        return 0;
    }
}
