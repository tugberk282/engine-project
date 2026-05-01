/// <reference types="vite/client" />
import { Component } from './Component';
import { AssetDatabase } from './AssetDatabase';
import { RigidBody } from './components/RigidBody';
import { MeshRenderer } from './components/MeshRenderer';
import { EditorCameraController } from './components/EditorCameraController';
import { AudioSource } from './components/AudioSource';
import { AudioListener } from './components/AudioListener';
import { ParticleSystem } from './components/ParticleSystem';
import { Camera } from './components/Camera';
import { Light } from './components/Light';
import { Animator } from './components/Animator';
import { BoxCollider } from './components/BoxCollider';
import { CapsuleCollider } from './components/CapsuleCollider';
import { MeshFilter } from './components/MeshFilter';
import { Canvas } from './components/Canvas';
import { CanvasGroup } from './components/CanvasGroup';
import { EventSystem } from './components/EventSystem';
import { GraphicRaycaster } from './components/GraphicRaycaster';
import { RectTransform } from './components/RectTransform';
import { UIImage } from './components/UIImage';
import { UIText } from './components/UIText';
import { UIButton } from './components/UIButton';
import { UIInputField } from './components/UIInputField';
import { UIDropdown } from './components/UIDropdown';
import { ToggleGroup } from './components/ToggleGroup';
import { UIToggle } from './components/UIToggle';
import { UISlider } from './components/UISlider';
import { UIScrollbar } from './components/UIScrollbar';
import { UIScrollRect } from './components/UIScrollRect';
import { VerticalLayoutGroup } from './components/VerticalLayoutGroup';
import { HorizontalLayoutGroup } from './components/HorizontalLayoutGroup';
import { ContentSizeFitter } from './components/ContentSizeFitter';

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

        // Audio
        'AudioSource': 'Audio',
        'AudioListener': 'Audio',

        // Animation
        'Animator': 'Animation',
        'ParticleSystem': 'Animation'
    };

    public static initialize() {
        // Register Core Components with categories
        this.registerWithCategory(MeshRenderer, 'Rendering');
        this.registerWithCategory(MeshFilter, 'Rendering');
        this.registerWithCategory(Canvas, 'UI');
        this.registerWithCategory(CanvasGroup, 'UI');
        this.registerWithCategory(GraphicRaycaster, 'UI');
        this.registerWithCategory(EventSystem, 'UI');
        this.registerWithCategory(RectTransform, 'UI');
        this.registerWithCategory(UIImage, 'UI');
        this.registerWithCategory(UIText, 'UI');
        this.registerWithCategory(UIButton, 'UI');
        this.registerWithCategory(UIInputField, 'UI');
        this.registerWithCategory(UIDropdown, 'UI');
        this.registerWithCategory(ToggleGroup, 'UI');
        this.registerWithCategory(UIToggle, 'UI');
        this.registerWithCategory(UISlider, 'UI');
        this.registerWithCategory(UIScrollbar, 'UI');
        this.registerWithCategory(UIScrollRect, 'UI');
        this.registerWithCategory(VerticalLayoutGroup, 'UI');
        this.registerWithCategory(HorizontalLayoutGroup, 'UI');
        this.registerWithCategory(ContentSizeFitter, 'UI');

        this.registerWithCategory(RigidBody, 'Physics');
        this.registerWithCategory(EditorCameraController, 'Rendering');
        this.registerWithCategory(AudioSource, 'Audio');
        this.registerWithCategory(AudioListener, 'Audio');
        this.registerWithCategory(ParticleSystem, 'Animation');
        this.registerWithCategory(Camera, 'Rendering');
        this.registerWithCategory(Light, 'Rendering');
        this.registerWithCategory(Animator, 'Animation');
        this.registerWithCategory(BoxCollider, 'Physics');
        this.registerWithCategory(CapsuleCollider, 'Physics');

        // Auto-load user scripts from src/scripts
        // Note: import.meta.glob is a Vite-specific feature
        const modules = import.meta.glob('../scripts/*.ts', { eager: true });

        for (const path in modules) {
            const module: any = modules[path];
            // Assume the default export or the first named export is the component class
            for (const key in module) {
                const exported = module[key];
                if (typeof exported === 'function' && exported.prototype instanceof Component) {
                    this.registerWithCategory(exported, 'Scripting');
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

    public static register(componentClass: any) {
        this.scripts.set(componentClass.name, componentClass);
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
    public static registerWithCategory(componentClass: any, category?: ComponentCategory): void {
        this.register(componentClass);
        if (category) {
            this.componentCategoryMap.set(componentClass.name, category);
        } else if (this.BUILTIN_CATEGORIES[componentClass.name]) {
            this.componentCategoryMap.set(componentClass.name, this.BUILTIN_CATEGORIES[componentClass.name]);
        } else {
            this.componentCategoryMap.set(componentClass.name, 'Scripting');
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
