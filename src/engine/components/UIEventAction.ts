import { Component } from '../Component';
import { serialize } from '../Decorators';

export type UIEventActionMode = 'SetActive' | 'ToggleActive' | 'SetPosition' | 'SetRotation' | 'SetScale' | 'SetVelocity' | 'SetText' | 'LoadScene';

/** Applies a declared UI event to this object without executing arbitrary script source. */
export class UIEventAction extends Component {
    @serialize public eventName: string = '';
    @serialize public targetObjectId: string = '';
    @serialize public action: UIEventActionMode = 'SetActive';
    @serialize public active: boolean = true;
    @serialize public position: [number, number, number] = [0, 0, 0];
    @serialize public rotation: [number, number, number] = [0, 0, 0];
    @serialize public scale: [number, number, number] = [1, 1, 1];
    @serialize public velocity: [number, number, number] = [0, 0, 0];
    @serialize public text: string = '';
    @serialize public useEventValue: boolean = false;
    @serialize public scenePath: string = '';

    private readonly handleEvent = (event: Event): void => {
        const detail = (event as CustomEvent<{ name?: string }>).detail;
        if (!this.enabled || !this.eventName || detail?.name !== this.eventName) return;
        if (this.action === 'LoadScene') {
            if (this.scenePath && typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('tugberk-runtime-load-scene', { detail: { scenePath: this.scenePath } }));
            }
            return;
        }
        const target = this.targetObjectId
            ? this.gameObject.scene?.findGameObjectByID?.(this.targetObjectId)
            : this.gameObject;
        if (!target) return;
        if (this.action === 'SetPosition') {
            target.transform.position.set(...this.position);
            return;
        }
        if (this.action === 'SetRotation') {
            target.transform.rotation.set(...this.rotation);
            return;
        }
        if (this.action === 'SetScale') {
            target.transform.scale.set(...this.scale);
            return;
        }
        if (this.action === 'SetVelocity') {
            const rigidbody = target.getComponent('RigidBody') as ({ body?: { velocity?: { set: (x: number, y: number, z: number) => void } | null } } | undefined);
            rigidbody?.body?.velocity?.set(...this.velocity);
            return;
        }
        if (this.action === 'SetText') {
            const value = (detail as { value?: unknown } | undefined)?.value;
            const displayValue = value && typeof value === 'object' && 'value' in value
                ? (value as { value?: unknown }).value
                : value;
            const nextText = this.useEventValue
                ? this.text.split('{value}').join(displayValue == null ? '' : String(displayValue))
                : this.text;
            const textComponent = target.getComponent('UIText') as ({ text?: string; updateVisuals?: () => void } | undefined);
            const inputComponent = target.getComponent('UIInputField') as ({ setText?: (value: string) => void } | undefined);
            if (textComponent) { textComponent.text = nextText; textComponent.updateVisuals?.(); }
            inputComponent?.setText?.(nextText);
            return;
        }
        const next = this.action === 'ToggleActive' ? !target.enabled : this.active;
        target.setActive(next);
    };

    public onEnable(): void {
        if (typeof window !== 'undefined') window.addEventListener('tugberk-runtime-ui-event', this.handleEvent);
    }

    public onDisable(): void {
        if (typeof window !== 'undefined') window.removeEventListener('tugberk-runtime-ui-event', this.handleEvent);
    }

    public onDestroy(): void {
        this.onDisable();
    }
}
