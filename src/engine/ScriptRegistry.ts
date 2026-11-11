/// <reference types="vite/client" />
import { Component } from './Component';
import { AssetDatabase } from './AssetDatabase';

// Component category types
export type ComponentCategory = 'Physics' | 'Rendering' | 'UI' | 'Audio' | 'Animation' | 'Scripting' | 'Utility';

// Registry to hold all available component classes
export class ScriptRegistry {
    private static scripts: Map<string, any> = new Map();
    private static executionOrderByComponentName: Map<string, number> = new Map();
    private static autoReferencedByComponentName: Map<string, boolean> = new Map();
    private static componentCategoryMap: Map<string, ComponentCategory> = new Map();
    private static executionOrderVersion: number = 0;

    // Built-in component categories
    private static BUILTIN_CATEGORIES: Record<string, ComponentCategory> = {
        // Physics
        'RigidBody': 'Physics',
        'BoxCollider': 'Physics',
        'CapsuleCollider': 'Physics',
        'SphereCollider': 'Physics',
        'Collider': 'Physics',

        // Rendering
        'Camera': 'Rendering',
        'Light': 'Rendering',
        'MeshRenderer': 'Rendering',
        'MeshFilter': 'Rendering',
        'EditorCameraController': 'Rendering',

        // UI
        'Canvas': 'UI',
        'CanvasGroup': 'UI',
        'GraphicRaycaster': 'UI',
        'EventSystem': 'UI',
        'RectTransform': 'UI',
        'UIButton': 'UI',
        'UIInputField': 'UI',
        'UIDropdown': 'UI',
        'ToggleGroup': 'UI',
        'UIToggle': 'UI',
        'UISlider': 'UI',
        'UIScrollbar': 'UI',
        'UIScrollRect': 'UI',
        'UIImage': 'UI',
        'UIText': 'UI',
        'VerticalLayoutGroup': 'UI',
        'HorizontalLayoutGroup': 'UI',
        'ContentSizeFitter': 'UI',
        'UIEventAction': 'Utility',
        'BehaviourScript': 'Scripting',

        // Audio
        'AudioSource': 'Audio',
        'AudioListener': 'Audio',

        // Animation
        'Animator': 'Animation',
        'ParticleSystem': 'Animation'
    };

    public static initialize() {
        // Auto-load user scripts from src/scripts
        // Note: import.meta.glob is a Vite-specific feature
        const modules = import.meta.glob('../scripts/*.ts', { eager: true });

        for (const path in modules) {
            const module: any = modules[path];
            // Assume the default export or the first named export is the component class
            for (const key in module) {
                const exported = module[key];
                if (typeof exported === 'function' && exported.prototype instanceof Component) {
                    this.registerWithCategory(exported, 'Scripting', key);
                }
            }
        }
    }

    public static create(name: string, gameObject: any): Component | null {
        const scriptClass = this.scripts.get(name);
        if (scriptClass) {
            return new scriptClass(gameObject);
        }
        return null;
    }

    public static register(componentClass: any, componentName: string = componentClass.name) {
        const stableName = componentName.trim();
        if (!stableName) throw new Error('Component registration requires a stable name');
        Object.defineProperty(componentClass, '__componentTypeName', {
            value: stableName,
            configurable: true
        });
        this.scripts.set(stableName, componentClass);
    }

    public static refreshScriptExecutionOrderFromAssetDatabase(): void {
        this.executionOrderByComponentName.clear();
        this.autoReferencedByComponentName.clear();

        AssetDatabase.getInstance().getAllEntries()
            .filter((entry) => entry.meta.assetType === 'script')
            .forEach((entry) => {
                const order = this.parseExecutionOrder(entry.meta.importer.settings.executionOrder);
                const autoReferenced = this.parseAutoReferenced(entry.meta.importer.settings.autoReferenced);
                const fileName = entry.path.split(/[\/\\]/).pop() ?? '';
                const baseName = fileName.replace(/\.[^.]+$/, '');
                if (baseName) {
                    this.executionOrderByComponentName.set(baseName, order);
                    this.autoReferencedByComponentName.set(baseName, autoReferenced);
                }

                const explicitComponentName = entry.meta.userData?.componentName;
                if (typeof explicitComponentName === 'string' && explicitComponentName.trim().length > 0) {
                    const componentName = explicitComponentName.trim();
                    this.executionOrderByComponentName.set(componentName, order);
                    this.autoReferencedByComponentName.set(componentName, autoReferenced);
                }
            });

        this.executionOrderVersion += 1;
    }

    public static getExecutionOrder(componentName: string): number {
        return this.executionOrderByComponentName.get(componentName) ?? 0;
    }

    public static isAutoReferenced(componentName: string): boolean {
        return this.autoReferencedByComponentName.get(componentName) ?? true;
    }

    public static getExecutionOrderVersion(): number {
        return this.executionOrderVersion;
    }

    public static getComponentClass(name: string): any {
        return this.scripts.get(name);
    }

    public static getComponentName(componentOrClass: any): string {
        const componentClass = typeof componentOrClass === 'function'
            ? componentOrClass
            : componentOrClass?.constructor;
        return componentClass?.__componentTypeName ?? componentClass?.name ?? '';
    }

    public static getRegisteredNames(): string[] {
        return Array.from(this.scripts.keys());
    }

    public static getAddableComponentNames(): string[] {
        return this.getRegisteredNames().filter((name) => this.isAutoReferenced(name));
    }

    /**
     * Get component category for a given component name
     */
    public static getComponentCategory(componentName: string): ComponentCategory {
        return this.componentCategoryMap.get(componentName) || 'Scripting';
    }

    /**
     * Get all components grouped by category
     */
    public static getComponentsByCategory(): Record<ComponentCategory, string[]> {
        const grouped: Record<ComponentCategory, string[]> = {
            'Physics': [],
            'Rendering': [],
            'UI': [],
            'Audio': [],
            'Animation': [],
            'Scripting': [],
            'Utility': []
        };

        this.getAddableComponentNames().forEach((name) => {
            const category = this.getComponentCategory(name);
            grouped[category].push(name);
        });

        // Sort each category alphabetically (case-insensitive)
        Object.keys(grouped).forEach((category) => {
            grouped[category as ComponentCategory].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        });

        return grouped;
    }

    /**
     * Register component with specific category
     */
    public static registerWithCategory(componentClass: any, category?: ComponentCategory, componentName: string = componentClass.name): void {
        this.register(componentClass, componentName);
        if (category) {
            this.componentCategoryMap.set(componentName, category);
        } else if (this.BUILTIN_CATEGORIES[componentName]) {
            this.componentCategoryMap.set(componentName, this.BUILTIN_CATEGORIES[componentName]);
        } else {
            this.componentCategoryMap.set(componentName, 'Scripting');
        }
    }

    private static parseExecutionOrder(value: unknown): number {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return Math.trunc(value);
        }

        if (typeof value === 'string') {
            const parsed = Number(value.trim());
            if (Number.isFinite(parsed)) {
                return Math.trunc(parsed);
            }
        }

        return 0;
    }

    private static parseAutoReferenced(value: unknown): boolean {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'false' || normalized === '0') return false;
            if (normalized === 'true' || normalized === '1') return true;
        }
        return true;
    }
}
