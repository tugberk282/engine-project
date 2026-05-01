import { Canvas } from './Canvas';
import { GraphicRaycaster } from './GraphicRaycaster';
import { RectTransform } from './RectTransform';
import { Selectable } from './Selectable';
import { serialize } from '../Decorators';
import { resolveCanvasForGameObject, resolveCanvasInteractionState, resolveRectTransformRect, isRuntimeUIInputEnabled } from './UIRectUtils';
import { PointerEventData } from './UIEventInterfaces';

export class UIInputField extends Selectable {
    @serialize public text: string = '';
    @serialize public placeholder: string = 'Enter text...';
    @serialize public interactablePlaceholder: boolean = true;
    @serialize public selectAllOnFocus: boolean = false;
    @serialize public restoreTextOnEscape: boolean = true;
    @serialize public lineType: 'SingleLine' | 'MultiLineSubmit' | 'MultiLineNewline' = 'SingleLine';
    @serialize public textAlignment: 'Left' | 'Center' | 'Right' = 'Left';
    @serialize public backgroundColor: string = '#2f2f2f';
    @serialize public textColor: string = '#ffffff';
    @serialize public placeholderColor: string = '#7f7f7f';
    @serialize public selectedColor: string = '#3a3a3a';
    @serialize public highlightedColor: string = '#454545';
    @serialize public pressedColor: string = '#2f6ea1';
    @serialize public disabledColor: string = '#232323';
    @serialize public caretColor: string = '#ffffff';
    @serialize public readOnly: boolean = false;
    @serialize public characterLimit: number = 0;
    @serialize public contentType: 'Standard' | 'IntegerNumber' | 'DecimalNumber' | 'Password' = 'Standard';
    @serialize public characterValidation: 'None' | 'Alphanumeric' | 'Name' | 'EmailAddress' = 'None';

    private element: HTMLDivElement | null = null;
    private inputElement: HTMLInputElement | HTMLTextAreaElement | null = null;
    private placeholderElement: HTMLDivElement | null = null;
    private canvas: Canvas | null = null;
    private raycaster: GraphicRaycaster | null = null;
    private focused: boolean = false;
    private currentControlKind: 'input' | 'textarea' | null = null;
    private selectionStart: number = 0;
    private selectionEnd: number = 0;
    private pendingSelectAllOnFocus: boolean = false;
    private focusStartText: string = '';

    public onValueChanged: (value: string) => void = () => { };
    public onEndEdit: (value: string) => void = () => { };

    public awake(): void {
        this.element = document.createElement('div');
        this.element.style.position = 'absolute';
        this.element.style.boxSizing = 'border-box';
        this.element.style.display = 'flex';
        this.element.style.alignItems = 'center';
        this.element.style.padding = '0 8px';
        this.element.style.border = '1px solid rgba(0,0,0,0.35)';
        this.element.style.borderRadius = '3px';
        this.element.tabIndex = -1;

        this.placeholderElement = document.createElement('div');
        this.placeholderElement.style.position = 'absolute';
        this.placeholderElement.style.left = '8px';
        this.placeholderElement.style.right = '8px';
        this.placeholderElement.style.top = '50%';
        this.placeholderElement.style.transform = 'translateY(-50%)';
        this.placeholderElement.style.pointerEvents = 'none';
        this.placeholderElement.style.fontFamily = 'Arial, sans-serif';
        this.placeholderElement.style.fontSize = '14px';
        this.placeholderElement.style.whiteSpace = 'nowrap';
        this.placeholderElement.style.overflow = 'hidden';
        this.placeholderElement.style.textOverflow = 'ellipsis';

        this.ensureInputElement();
        this.element.appendChild(this.placeholderElement);

        this.attachToCanvas();
        this.updateVisuals();
    }

    public update(_dt: number): void {
        if (!this.canvas) {
            this.attachToCanvas();
        }
        this.ensureInputElement();
        this.updateVisuals();
    }

    public getRaycastElement(): HTMLElement | null {
        return this.element;
    }

    public onPointerClick(_eventData: PointerEventData): void {
        if (!this.isInteractable()) return;
        this.inputElement?.focus();
    }

    public onSelect(): void {
        super.onSelect();
        if (!this.isInteractable()) return;
        this.inputElement?.focus();
    }

    public onDeselect(): void {
        super.onDeselect();
        this.inputElement?.blur();
    }

    public onSubmit(): void {
        if (!this.isInteractable()) return;
        this.inputElement?.focus();
    }

    public onDestroy(): void {
        if (this.element && this.raycaster) {
            this.raycaster.unregisterGraphic(this.element);
        }
        if (this.element?.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }

    public deserialize(data: any): void {
        super.deserialize(data);
        this.text = this.normalizeText(this.text);
        this.ensureInputElement();
        this.updateVisuals();
    }

    public setText(value: string, notify: boolean = true): boolean {
        const normalized = this.normalizeText(value);
        const changed = normalized !== this.text;
        this.text = normalized;
        if (changed && notify) {
            this.onValueChanged(this.text);
        }
        this.updateVisuals();
        return changed;
    }

    protected notifySelectableStateChanged(): void {
        if (this.element) {
            this.updateVisuals();
        }
    }

    private ensureInputElement(): void {
        if (!this.element) return;

        const nextKind: 'input' | 'textarea' = this.isMultiline() ? 'textarea' : 'input';
        if (this.inputElement && this.currentControlKind === nextKind) {
            return;
        }

        const hadFocus = this.focused;
        this.syncSelectionFromInput();
        this.inputElement?.remove();
        this.inputElement = nextKind === 'textarea'
            ? document.createElement('textarea')
            : document.createElement('input');
        this.currentControlKind = nextKind;
        this.inputElement.style.flex = '1';
        this.inputElement.style.width = '100%';
        this.inputElement.style.background = 'transparent';
        this.inputElement.style.border = 'none';
        this.inputElement.style.outline = 'none';
        this.inputElement.style.fontFamily = 'Arial, sans-serif';
        this.inputElement.style.fontSize = '14px';
        this.inputElement.style.padding = '0';
        this.inputElement.style.margin = '0';
        this.inputElement.style.minWidth = '0';
        this.inputElement.style.resize = 'none';
        this.inputElement.style.boxSizing = 'border-box';
        this.inputElement.style.whiteSpace = this.isMultiline() ? 'pre-wrap' : 'nowrap';
        this.inputElement.style.overflow = this.isMultiline() ? 'auto' : 'hidden';

        if (this.inputElement instanceof HTMLInputElement) {
            this.inputElement.type = 'text';
        } else {
            this.inputElement.wrap = 'soft';
            this.inputElement.rows = 3;
        }

        this.element.insertBefore(this.inputElement, this.placeholderElement);
        this.bindInputEvents();
        this.inputElement.value = this.text;
        if (hadFocus) {
            this.pendingSelectAllOnFocus = this.selectAllOnFocus;
            this.inputElement.focus();
            this.restoreSelection();
        }
    }

    private bindInputEvents(): void {
        if (!this.inputElement) return;

        this.inputElement.addEventListener('focus', () => {
            this.focused = true;
            this.focusStartText = this.text;
            this.pendingSelectAllOnFocus = this.selectAllOnFocus;
            this.applyFocusSelectionPolicy();
            this.updateVisuals();
        });

        this.inputElement.addEventListener('blur', () => {
            this.syncSelectionFromInput();
            this.focused = false;
            this.onEndEdit(this.text);
            this.updateVisuals();
        });

        this.inputElement.addEventListener('input', () => {
            if (!this.inputElement) return;
            const previousLength = this.text.length;
            this.syncSelectionFromInput();
            const nextText = this.normalizeText(this.inputElement.value);
            if (nextText !== this.text) {
                this.text = nextText;
                this.onValueChanged(this.text);
            }
            if (this.inputElement.value !== nextText) {
                const lengthDelta = nextText.length - previousLength;
                this.inputElement.value = nextText;
                this.selectionStart = this.clampSelectionIndex(this.selectionStart + lengthDelta);
                this.selectionEnd = this.clampSelectionIndex(this.selectionEnd + lengthDelta);
                this.restoreSelection();
            } else {
                this.syncSelectionFromInput();
            }
            this.updateVisuals();
        });

        this.inputElement.addEventListener('select', () => {
            this.syncSelectionFromInput();
        });

        this.inputElement.addEventListener('keyup', () => {
            this.syncSelectionFromInput();
        });

        this.inputElement.addEventListener('mouseup', () => {
            this.syncSelectionFromInput();
        });

        this.inputElement.addEventListener('keydown', (rawEvent) => {
            const event = rawEvent as KeyboardEvent;
            if (event.code === 'Escape' && this.restoreTextOnEscape) {
                event.preventDefault();
                const changed = this.setText(this.focusStartText, false);
                if (changed) {
                    this.onValueChanged(this.text);
                }
                this.onEndEdit(this.text);
                this.inputElement?.blur();
                return;
            }
            if (event.code !== 'Enter') return;
            if (!this.isMultiline()) {
                this.onEndEdit(this.text);
                return;
            }

            if (this.lineType === 'MultiLineSubmit' && !event.shiftKey) {
                event.preventDefault();
                this.onEndEdit(this.text);
                this.inputElement?.blur();
            }
        });
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
        if (!this.element || !this.inputElement || !this.placeholderElement || !this.canvas) return;

        const interaction = resolveCanvasInteractionState(this.gameObject);
        const canInteract = this.isInteractable();
        const inputEnabled = isRuntimeUIInputEnabled();

        this.element.style.pointerEvents = inputEnabled && interaction.blocksRaycasts ? 'auto' : 'none';
        this.element.style.transformOrigin = 'top left';
        this.element.style.opacity = `${interaction.alpha * (canInteract ? 1 : 0.75)}`;
        this.element.style.background = this.resolveCurrentColor(canInteract);
        this.element.style.outline = this.isSelectedState() ? '2px solid rgba(255,255,255,0.75)' : 'none';
        this.element.style.outlineOffset = this.isSelectedState() ? '1px' : '';
        this.element.style.boxShadow = this.isSelectedState()
            ? '0 0 0 1px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.06)'
            : 'none';

        this.inputElement.disabled = !canInteract;
        this.inputElement.readOnly = this.readOnly;
        if (this.inputElement instanceof HTMLInputElement) {
            this.inputElement.type = this.contentType === 'Password' ? 'password' : 'text';
        }
        this.inputElement.inputMode = this.resolveInputMode();
        if (this.inputElement.value !== this.text) {
            this.syncSelectionFromInput();
            this.inputElement.value = this.text;
            this.restoreSelection();
        }
        this.inputElement.style.color = canInteract ? this.textColor : 'rgba(255,255,255,0.65)';
        this.inputElement.style.caretColor = this.caretColor;
        this.inputElement.style.textAlign = this.resolveTextAlign();
        this.inputElement.style.alignSelf = this.isMultiline() ? 'stretch' : 'center';
        this.inputElement.style.height = this.isMultiline() ? '100%' : 'auto';
        this.inputElement.style.lineHeight = this.isMultiline() ? '1.4' : `${Math.max(16, this.getResolvedHeight() - 10)}px`;

        this.placeholderElement.textContent = this.placeholder;
        this.placeholderElement.style.display = !this.focused && !this.text ? 'block' : 'none';
        this.placeholderElement.style.color = this.placeholderColor;
        this.placeholderElement.style.opacity = canInteract && this.interactablePlaceholder ? '1' : '0.8';
        this.placeholderElement.style.textAlign = this.resolveTextAlign();
        this.placeholderElement.style.top = this.isMultiline() ? '8px' : '50%';
        this.placeholderElement.style.transform = this.isMultiline() ? 'none' : 'translateY(-50%)';
        this.placeholderElement.style.whiteSpace = this.isMultiline() ? 'pre-wrap' : 'nowrap';

        const rt = this.gameObject.getComponent(RectTransform);
        if (rt) {
            const rect = resolveRectTransformRect(this.gameObject, rt);
            this.element.style.width = `${rect.width}px`;
            this.element.style.height = `${rect.height}px`;
            this.element.style.left = `${rect.x}px`;
            this.element.style.top = `${rect.y}px`;
        } else {
            this.element.style.width = '160px';
            this.element.style.height = '28px';
        }

        this.syncRaycasterRegistration();
    }

    private resolveCurrentColor(canInteract: boolean): string {
        if (!canInteract) return this.disabledColor;
        if (this.getTransitionState() === 'pressed') return this.pressedColor;
        if (this.getTransitionState() === 'highlighted') return this.highlightedColor;
        if (this.isSelectedState() || this.focused) return this.selectedColor;
        return this.backgroundColor;
    }

    private getResolvedHeight(): number {
        const rt = this.gameObject.getComponent(RectTransform);
        if (!rt) {
            return this.isMultiline() ? 72 : 28;
        }
        return resolveRectTransformRect(this.gameObject, rt).height;
    }

    private resolveInputMode(): string {
        if (this.characterValidation === 'EmailAddress') {
            return 'email';
        }
        switch (this.contentType) {
            case 'IntegerNumber':
                return 'numeric';
            case 'DecimalNumber':
                return 'decimal';
            default:
                return 'text';
        }
    }

    private normalizeText(value: string): string {
        let next = typeof value === 'string' ? value : '';
        if (!this.isMultiline()) {
            next = next.replace(/[\r\n]+/g, ' ');
        }
        switch (this.contentType) {
            case 'IntegerNumber':
                next = next.replace(/[^0-9-]/g, '');
                break;
            case 'DecimalNumber':
                next = next.replace(/[^0-9.\-]/g, '');
                break;
            default:
                break;
        }

        switch (this.characterValidation) {
            case 'Alphanumeric':
                next = next.replace(/[^a-zA-Z0-9]/g, '');
                break;
            case 'Name':
                next = next.replace(/[^a-zA-Z0-9 '\-]/g, '');
                next = next.replace(/\s{2,}/g, ' ');
                break;
            case 'EmailAddress':
                next = next.replace(/[^a-zA-Z0-9@._\-+]/g, '');
                break;
            default:
                break;
        }

        if (this.characterLimit > 0) {
            next = next.slice(0, this.characterLimit);
        }

        return next;
    }

    private isMultiline(): boolean {
        return this.lineType === 'MultiLineSubmit' || this.lineType === 'MultiLineNewline';
    }

    private resolveTextAlign(): 'left' | 'center' | 'right' {
        switch (this.textAlignment) {
            case 'Center':
                return 'center';
            case 'Right':
                return 'right';
            default:
                return 'left';
        }
    }

    private applyFocusSelectionPolicy(): void {
        if (!this.inputElement) return;
        if (this.pendingSelectAllOnFocus) {
            this.pendingSelectAllOnFocus = false;
            this.selectionStart = 0;
            this.selectionEnd = this.text.length;
            this.inputElement.select();
            this.syncSelectionFromInput();
            return;
        }
        this.restoreSelection();
    }

    private syncSelectionFromInput(): void {
        if (!this.inputElement) return;
        this.selectionStart = this.clampSelectionIndex(this.inputElement.selectionStart ?? this.text.length);
        this.selectionEnd = this.clampSelectionIndex(this.inputElement.selectionEnd ?? this.selectionStart);
    }

    private restoreSelection(): void {
        if (!this.inputElement || !this.focused) return;
        const start = this.clampSelectionIndex(this.selectionStart);
        const end = this.clampSelectionIndex(this.selectionEnd);
        this.inputElement.setSelectionRange(start, end);
    }

    private clampSelectionIndex(value: number): number {
        if (!Number.isFinite(value)) {
            return this.text.length;
        }
        return Math.max(0, Math.min(this.text.length, Math.floor(value)));
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
}
