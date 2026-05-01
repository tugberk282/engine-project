import { Component } from '../Component';
import { serialize } from '../Decorators';
import { GameObject } from '../GameObject';
import { Input } from '../Input';
import { GraphicRaycaster } from './GraphicRaycaster';
import { NavigationDirection, PointerEventData, UIRaycastTarget } from './UIEventInterfaces';

export class EventSystem extends Component {
    public static current: EventSystem | null = null;

    @serialize public sendNavigationEvents: boolean = true;
    @serialize public pixelDragThreshold: number = 10;

    public firstSelectedGameObject: GameObject | null = null;

    private hoveredTarget: UIRaycastTarget | null = null;
    private pressedTarget: UIRaycastTarget | null = null;
    private selectedTarget: UIRaycastTarget | null = null;
    private pressPosition: { x: number; y: number } = { x: 0, y: 0 };
    private draggingPressedTarget: boolean = false;
    private eligibleForClick: boolean = false;
    private runtimeWasActive: boolean = false;

    public awake(): void {
        this.claimCurrent();
    }

    public onEnable(): void {
        this.claimCurrent();
    }

    public onDisable(): void {
        this.resetState();
        if (EventSystem.current === this) {
            EventSystem.current = null;
        }
    }

    public lateUpdate(): void {
        if (!this.isActiveCurrent()) return;

        const editor = (window as any).Editor?.instance;
        const runtimeInputEnabled = Boolean(editor?.isRuntimeUIInputEnabled?.());
        if (!runtimeInputEnabled) {
            if (this.runtimeWasActive) {
                this.resetState();
            }
            this.runtimeWasActive = false;
            return;
        }

        this.runtimeWasActive = true;
        const hostElement = editor?.getActiveUIHostElement?.() as HTMLElement | null;
        const pointerPosition = { x: Input.mousePosition.x, y: Input.mousePosition.y };
        const eventData = this.createPointerEventData(pointerPosition);
        const currentTarget = GraphicRaycaster.raycastAll(pointerPosition, hostElement)[0]?.target ?? null;
        const pointerDispatchTarget = this.resolveEventTarget(currentTarget, hostElement, (target) =>
            Boolean(
                target.onPointerDown
                || target.onPointerMove
                || target.onPointerUp
                || target.onPointerClick
                || target.onPointerCancel
                || target.isSelectable?.()
            )
        );
        const scrollDispatchTarget = this.resolveEventTarget(currentTarget, hostElement, (target) => Boolean(target.onScroll));

        this.updateHoverTarget(currentTarget, eventData);

        if (Input.getMouseButtonDown(0)) {
            this.handlePointerDown(pointerDispatchTarget, eventData);
        }

        if (this.pressedTarget && Input.getMouseButton(0)) {
            this.handlePressedPointerMove(eventData);
        }

        if (Input.getMouseButtonUp(0)) {
            this.handlePointerUp(pointerDispatchTarget, eventData);
        }

        if (Math.abs(Input.mouseWheel) > 0.0001) {
            scrollDispatchTarget?.onScroll?.(eventData);
        }

        if (this.sendNavigationEvents) {
            this.ensureFirstSelected(hostElement);
            if (Input.getKeyDown('Tab')) {
                const reverse = Input.getKey('ShiftLeft') || Input.getKey('ShiftRight');
                this.moveSelection(reverse ? -1 : 1, hostElement);
            }
            this.handleDirectionalNavigation(hostElement);

            if (Input.getButtonDown('Submit')) {
                this.resolveSelectedTarget(hostElement)?.onSubmit?.();
            }
            if (Input.getButtonDown('Cancel')) {
                this.cancelPressedTarget();
                this.updateSelectedTarget(null);
            }
        }
    }

    public setSelectedGameObject(target: GameObject | null): void {
        const hostElement = ((window as any).Editor?.instance?.getActiveUIHostElement?.() as HTMLElement | null) ?? null;
        const nextTarget = target ? GraphicRaycaster.findTargetForGameObject(target, hostElement) : null;
        this.updateSelectedTarget(nextTarget);
        if (target) {
            this.firstSelectedGameObject = target;
        }
    }

    public serialize(): any {
        return {
            type: 'EventSystem',
            data: {
                sendNavigationEvents: this.sendNavigationEvents,
                pixelDragThreshold: this.pixelDragThreshold,
                firstSelectedGameObject: this.firstSelectedGameObject ? { __ref: this.firstSelectedGameObject.id, __type: 'GameObject' } : null
            }
        };
    }

    public deserialize(data: any): void {
        this.sendNavigationEvents = data.sendNavigationEvents ?? true;
        this.pixelDragThreshold = Math.max(0, data.pixelDragThreshold ?? 10);
        this.firstSelectedGameObject = data.firstSelectedGameObject instanceof GameObject ? data.firstSelectedGameObject : null;
    }

    public onDestroy(): void {
        this.resetState();
        if (EventSystem.current === this) {
            EventSystem.current = null;
        }
    }

    private claimCurrent(): void {
        if (!EventSystem.current || !EventSystem.current.enabled) {
            EventSystem.current = this;
        }
    }

    private isActiveCurrent(): boolean {
        if (EventSystem.current === this) return true;
        if (!EventSystem.current || !EventSystem.current.enabled) {
            EventSystem.current = this;
            return true;
        }
        return false;
    }

    private createPointerEventData(position: { x: number; y: number }): PointerEventData {
        return {
            position,
            delta: { x: Input.mouseDelta.x, y: Input.mouseDelta.y },
            scrollDelta: { x: 0, y: Input.mouseWheel },
            button: 0,
            pressPosition: { ...this.pressPosition },
            dragThreshold: this.pixelDragThreshold,
            dragging: this.draggingPressedTarget,
            eligibleForClick: this.eligibleForClick
        };
    }

    private updateHoverTarget(nextTarget: UIRaycastTarget | null, eventData: PointerEventData): void {
        if (this.hoveredTarget === nextTarget) return;

        this.hoveredTarget?.onPointerExit?.(eventData);
        this.hoveredTarget = nextTarget;
        this.hoveredTarget?.onPointerEnter?.(eventData);
    }

    private handlePointerDown(target: UIRaycastTarget | null, eventData: PointerEventData): void {
        this.pressPosition = { ...eventData.position };
        const interactableTarget = this.isInteractable(target) ? target : null;
        this.pressedTarget = interactableTarget;
        this.draggingPressedTarget = false;
        this.eligibleForClick = Boolean(interactableTarget);
        if (!interactableTarget) {
            this.updateSelectedTarget(null);
            return;
        }

        if (this.isSelectable(interactableTarget)) {
            this.updateSelectedTarget(interactableTarget);
            this.firstSelectedGameObject = interactableTarget.gameObject;
        }
        interactableTarget.onPointerDown?.({
            ...eventData,
            pressPosition: { ...this.pressPosition },
            dragging: false,
            eligibleForClick: true
        });
    }

    private handlePressedPointerMove(eventData: PointerEventData): void {
        if (!this.pressedTarget) return;

        const movedDistance = Math.hypot(
            eventData.position.x - this.pressPosition.x,
            eventData.position.y - this.pressPosition.y
        );
        if (!this.draggingPressedTarget && movedDistance > this.pixelDragThreshold) {
            this.draggingPressedTarget = true;
            this.eligibleForClick = false;
        }

        this.pressedTarget.onPointerMove?.({
            ...eventData,
            dragging: this.draggingPressedTarget,
            eligibleForClick: this.eligibleForClick
        });
    }

    private handlePointerUp(target: UIRaycastTarget | null, eventData: PointerEventData): void {
        const pressedTarget = this.pressedTarget;
        const upEvent = {
            ...eventData,
            pressPosition: { ...this.pressPosition },
            dragging: this.draggingPressedTarget,
            eligibleForClick: this.eligibleForClick
        };

        pressedTarget?.onPointerUp?.(upEvent);
        if (
            pressedTarget
            && pressedTarget === target
            && this.isInteractable(pressedTarget)
            && this.eligibleForClick
        ) {
            pressedTarget.onPointerClick?.(upEvent);
        }

        this.pressedTarget = null;
        this.draggingPressedTarget = false;
        this.eligibleForClick = false;
    }

    private ensureFirstSelected(hostElement: HTMLElement | null): void {
        const currentSelected = this.resolveSelectedTarget(hostElement);
        if (currentSelected) {
            this.selectedTarget = currentSelected;
            return;
        }

        if (this.firstSelectedGameObject) {
            const firstTarget = GraphicRaycaster.findTargetForGameObject(this.firstSelectedGameObject, hostElement);
            if (firstTarget && this.isSelectable(firstTarget) && this.isInteractable(firstTarget)) {
                this.updateSelectedTarget(firstTarget);
                return;
            }
        }

        this.updateSelectedTarget(null);
    }

    private moveSelection(direction: 1 | -1, hostElement: HTMLElement | null): void {
        const selectables = GraphicRaycaster.getRegisteredTargets(hostElement)
            .filter((target) => this.isSelectable(target) && this.isInteractable(target));
        if (selectables.length === 0) return;

        const currentTarget = this.resolveSelectedTarget(hostElement);
        if (!currentTarget) {
            const fallbackIndex = direction === 1 ? 0 : selectables.length - 1;
            this.updateSelectedTarget(selectables[fallbackIndex] ?? null);
            return;
        }

        const currentIndex = selectables.indexOf(currentTarget);
        if (currentIndex < 0) {
            this.updateSelectedTarget(selectables[0] ?? null);
            return;
        }

        const nextIndex = (currentIndex + direction + selectables.length) % selectables.length;
        this.updateSelectedTarget(selectables[nextIndex] ?? null);
    }

    private handleDirectionalNavigation(hostElement: HTMLElement | null): void {
        const direction = this.getNavigationDirectionInput();
        if (!direction) return;

        const currentTarget = this.resolveSelectedTarget(hostElement);
        if (!currentTarget) {
            this.moveSelection(direction === 'up' || direction === 'left' ? -1 : 1, hostElement);
            return;
        }

        const explicitTarget = currentTarget.getNavigationTarget?.(direction) ?? null;
        const resolvedExplicitTarget = explicitTarget
            ? GraphicRaycaster.findTargetForGameObject(explicitTarget, hostElement)
            : null;
        if (resolvedExplicitTarget && this.isSelectable(resolvedExplicitTarget) && this.isInteractable(resolvedExplicitTarget)) {
            this.updateSelectedTarget(resolvedExplicitTarget);
            this.firstSelectedGameObject = resolvedExplicitTarget.gameObject;
            return;
        }

        const automaticTarget = this.findAutomaticDirectionalTarget(currentTarget, direction, hostElement);
        if (automaticTarget) {
            this.updateSelectedTarget(automaticTarget);
            this.firstSelectedGameObject = automaticTarget.gameObject;
        }
    }

    private resolveSelectedTarget(hostElement: HTMLElement | null): UIRaycastTarget | null {
        if (this.selectedTarget && this.selectedTarget.isRaycastTargetEnabled() && this.isInteractable(this.selectedTarget)) {
            return this.selectedTarget;
        }

        this.selectedTarget = this.selectedTarget
            ? GraphicRaycaster.findTargetForGameObject(this.selectedTarget.gameObject, hostElement)
            : null;
        if (this.selectedTarget && this.selectedTarget.isRaycastTargetEnabled() && this.isInteractable(this.selectedTarget)) {
            return this.selectedTarget;
        }
        return null;
    }

    private updateSelectedTarget(nextTarget: UIRaycastTarget | null): void {
        if (this.selectedTarget === nextTarget) return;

        this.selectedTarget?.onDeselect?.();
        this.selectedTarget = nextTarget;
        if (nextTarget) {
            this.firstSelectedGameObject = nextTarget.gameObject;
        }
        this.selectedTarget?.onSelect?.();
    }

    private getNavigationDirectionInput(): NavigationDirection | null {
        if (Input.getKeyDown('ArrowUp')) return 'up';
        if (Input.getKeyDown('ArrowDown')) return 'down';
        if (Input.getKeyDown('ArrowLeft')) return 'left';
        if (Input.getKeyDown('ArrowRight')) return 'right';
        return null;
    }

    private findAutomaticDirectionalTarget(
        currentTarget: UIRaycastTarget,
        direction: NavigationDirection,
        hostElement: HTMLElement | null
    ): UIRaycastTarget | null {
        const currentCenter = this.getTargetCenter(currentTarget);
        if (!currentCenter) return null;

        const directionVector = this.getDirectionVector(direction);
        const candidates = GraphicRaycaster.getRegisteredTargets(hostElement)
            .filter((candidate) => candidate !== currentTarget && this.isSelectable(candidate) && this.isInteractable(candidate));

        let bestTarget: UIRaycastTarget | null = null;
        let bestScore = Number.NEGATIVE_INFINITY;

        candidates.forEach((candidate) => {
            const candidateCenter = this.getTargetCenter(candidate);
            if (!candidateCenter) return;

            const deltaX = candidateCenter.x - currentCenter.x;
            const deltaY = candidateCenter.y - currentCenter.y;
            const magnitude = Math.hypot(deltaX, deltaY);
            if (magnitude <= 0.0001) return;

            const normalizedX = deltaX / magnitude;
            const normalizedY = deltaY / magnitude;
            const dot = normalizedX * directionVector.x + normalizedY * directionVector.y;
            if (dot <= 0.25) return;

            const perpendicular = Math.abs(normalizedX * directionVector.y - normalizedY * directionVector.x) * magnitude;
            const score = (dot * 10000) - magnitude - (perpendicular * 2);
            if (score > bestScore) {
                bestScore = score;
                bestTarget = candidate;
            }
        });

        return bestTarget;
    }

    private getTargetCenter(target: UIRaycastTarget): { x: number; y: number } | null {
        const element = target.getRaycastElement();
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return {
            x: rect.left + rect.width * 0.5,
            y: rect.top + rect.height * 0.5
        };
    }

    private getDirectionVector(direction: NavigationDirection): { x: number; y: number } {
        switch (direction) {
            case 'up':
                return { x: 0, y: -1 };
            case 'down':
                return { x: 0, y: 1 };
            case 'left':
                return { x: -1, y: 0 };
            case 'right':
                return { x: 1, y: 0 };
        }
    }

    private isSelectable(target: UIRaycastTarget | null): target is UIRaycastTarget {
        return Boolean(target?.isSelectable?.());
    }

    private isInteractable(target: UIRaycastTarget | null): target is UIRaycastTarget {
        if (!target) return false;
        return target.isInteractable?.() ?? true;
    }

    private resolveEventTarget(
        target: UIRaycastTarget | null,
        hostElement: HTMLElement | null,
        predicate: (target: UIRaycastTarget) => boolean
    ): UIRaycastTarget | null {
        if (!target) return null;

        let current: GameObject | null = target.gameObject;
        while (current) {
            const candidate = GraphicRaycaster.findTargetForGameObject(current, hostElement);
            if (candidate && predicate(candidate)) {
                return candidate;
            }
            current = current.transform.parent?.gameObject ?? null;
        }

        return null;
    }

    private resetState(): void {
        const pointerEvent = this.createPointerEventData({ x: Input.mousePosition.x, y: Input.mousePosition.y });
        this.hoveredTarget?.onPointerExit?.(pointerEvent);
        this.hoveredTarget = null;
        this.cancelPressedTarget();
        this.updateSelectedTarget(null);
    }

    private cancelPressedTarget(): void {
        if (!this.pressedTarget) return;

        this.pressedTarget.onPointerCancel?.({
            ...this.createPointerEventData({ x: Input.mousePosition.x, y: Input.mousePosition.y }),
            dragging: this.draggingPressedTarget,
            eligibleForClick: false
        });
        this.pressedTarget = null;
        this.draggingPressedTarget = false;
        this.eligibleForClick = false;
    }
}
