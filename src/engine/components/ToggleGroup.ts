import { Component } from '../Component';
import { serialize } from '../Decorators';
import { UIToggle } from './UIToggle';

export class ToggleGroup extends Component {
    @serialize public allowSwitchOff: boolean = false;

    private toggles: Set<UIToggle> = new Set();

    public registerToggle(toggle: UIToggle): void {
        this.toggles.add(toggle);
        this.ensureValidState(toggle);
    }

    public unregisterToggle(toggle: UIToggle): void {
        this.toggles.delete(toggle);
        this.ensureValidState();
    }

    public canToggleOff(toggle: UIToggle): boolean {
        if (this.allowSwitchOff) return true;
        if (!toggle.isOnValue()) return true;
        return Array.from(this.toggles).some((entry) => entry !== toggle && entry.isOnValue());
    }

    public notifyToggleActivated(toggle: UIToggle): void {
        this.toggles.forEach((entry) => {
            if (entry === toggle) return;
            entry.setIsOn(false, true, true);
        });
        this.ensureValidState(toggle);
    }

    public getRegisteredToggleCount(): number {
        return this.toggles.size;
    }

    private ensureValidState(preferredToggle?: UIToggle): void {
        const activeToggles = Array.from(this.toggles).filter((toggle) => toggle.isOnValue());
        if (activeToggles.length > 1) {
            const keeper = preferredToggle && activeToggles.includes(preferredToggle)
                ? preferredToggle
                : activeToggles[0];
            activeToggles.forEach((toggle) => {
                if (toggle === keeper) return;
                toggle.setIsOn(false, false, true);
            });
            return;
        }

        if (!this.allowSwitchOff && activeToggles.length === 0) {
            const fallback = preferredToggle ?? Array.from(this.toggles)[0];
            fallback?.setIsOn(true, false, true);
        }
    }
}
