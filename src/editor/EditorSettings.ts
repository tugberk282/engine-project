/**
 * EditorSettings - Persistent user preferences for the editor experience.
 */
export type EditorBottomTab = 'project' | 'console' | 'render';
export type EditorViewportTab = 'scene' | 'game';
export type DockableEditorView = EditorBottomTab;
export type EditorDockHost = 'bottom' | 'inspector' | 'hierarchy' | 'viewport' | 'center-secondary' | 'center-tertiary';
export type EditorHierarchyTab = 'hierarchy' | DockableEditorView;
export type EditorInspectorTab = 'inspector' | DockableEditorView;
export type EditorSideDockSlot = 'left' | 'right';
export type EditorLayoutPreset = 'default' | 'scene' | 'scripting' | 'custom';
export type EditorPanelId = 'hierarchy-panel' | 'viewport-panel' | 'inspector-panel' | 'assets-panel';
export type EditorLayoutSlotId = 'slot1' | 'slot2';

export interface EditorFloatingPanelState {
    floating: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface EditorDockGraphState {
    hosts: Record<EditorDockHost, DockableEditorView[]>;
    activeTabs: Partial<Record<EditorDockHost, DockableEditorView>>;
}

export interface EditorLayoutSnapshot {
    hierarchyWidth: number;
    inspectorWidth: number;
    sidePanelWidths: Record<EditorSideDockSlot, number>;
    assetsHeight: number;
    hierarchyVisible: boolean;
    inspectorVisible: boolean;
    assetsVisible: boolean;
    activeBottomTab: EditorBottomTab;
    activeViewportTab: EditorViewportTab;
    bottomTabOrder: EditorBottomTab[];
    viewportTabOrder: EditorViewportTab[];
    activeViewportDockTab: DockableEditorView | null;
    viewportDockTabOrder: DockableEditorView[];
    activeCenterSecondaryTab: DockableEditorView | null;
    centerSecondaryTabOrder: DockableEditorView[];
    activeCenterTertiaryTab: DockableEditorView | null;
    centerTertiaryTabOrder: DockableEditorView[];
    activeHierarchyTab: EditorHierarchyTab;
    hierarchyTabOrder: EditorHierarchyTab[];
    activeInspectorTab: EditorInspectorTab;
    inspectorTabOrder: EditorInspectorTab[];
    viewHosts: Record<DockableEditorView, EditorDockHost>;
    dockGraph: EditorDockGraphState;
    floatingDockableHomeHosts: Partial<Record<DockableEditorView, EditorDockHost>>;
    floatingPanels: Partial<Record<EditorPanelId, EditorFloatingPanelState>>;
    sidePanelSlots: Record<'hierarchy-panel' | 'inspector-panel', EditorSideDockSlot>;
    centerSecondaryWidth: number;
    centerTertiaryWidth: number;
    layoutPreset: EditorLayoutPreset;
    activePanelId: EditorPanelId;
    prefabApplyTargetRootIds?: Record<string, string>;
    collapsedComponentsPerGameObject?: Record<string, string[]>;
}

export class EditorSettings {
    // Snap settings
    public static snapEnabled: boolean = false;
    public static snapTranslation: number = 1.0;
    public static snapRotation: number = 15.0; // In degrees
    public static snapScale: number = 0.25;
    public static transformPivotMode: 'pivot' | 'center' = 'pivot';
    public static transformSpaceMode: 'local' | 'world' = 'local';

    // Grid settings
    public static gridEnabled: boolean = true;
    public static gridSize: number = 100;
    public static gridDivisions: number = 100;
    public static gridColor1: string = '#444444';
    public static gridColor2: string = '#222222';

    // Camera settings
    public static cameraSpeed: number = 10;
    public static cameraSensitivity: number = 0.1;

    // Layout settings
    public static hierarchyWidth: number = 250;
    public static inspectorWidth: number = 320;
    public static sidePanelWidths: Record<EditorSideDockSlot, number> = {
        left: 250,
        right: 320
    };
    public static assetsHeight: number = 200;
    public static hierarchyVisible: boolean = true;
    public static inspectorVisible: boolean = true;
    public static assetsVisible: boolean = true;
    public static activeBottomTab: EditorBottomTab = 'project';
    public static activeViewportTab: EditorViewportTab = 'scene';
    public static bottomTabOrder: EditorBottomTab[] = ['project', 'console', 'render'];
    public static viewportTabOrder: EditorViewportTab[] = ['scene', 'game'];
    public static activeViewportDockTab: DockableEditorView | null = null;
    public static viewportDockTabOrder: DockableEditorView[] = [];
    public static activeCenterSecondaryTab: DockableEditorView | null = null;
    public static centerSecondaryTabOrder: DockableEditorView[] = [];
    public static activeCenterTertiaryTab: DockableEditorView | null = null;
    public static centerTertiaryTabOrder: DockableEditorView[] = [];
    public static activeHierarchyTab: EditorHierarchyTab = 'hierarchy';
    public static hierarchyTabOrder: EditorHierarchyTab[] = ['hierarchy'];
    public static activeInspectorTab: EditorInspectorTab = 'inspector';
    public static inspectorTabOrder: EditorInspectorTab[] = ['inspector'];
    public static viewHosts: Record<DockableEditorView, EditorDockHost> = {
        project: 'bottom',
        console: 'bottom',
        render: 'bottom'
    };
    public static dockGraph: EditorDockGraphState = {
        hosts: {
            bottom: ['project', 'console', 'render'],
            viewport: [],
            'center-secondary': [],
            'center-tertiary': [],
            hierarchy: [],
            inspector: []
        },
        activeTabs: {
            bottom: 'project'
        }
    };
    public static floatingDockableHomeHosts: Partial<Record<DockableEditorView, EditorDockHost>> = {};
    public static floatingPanels: Partial<Record<EditorPanelId, EditorFloatingPanelState>> = {};
    public static sidePanelSlots: Record<'hierarchy-panel' | 'inspector-panel', EditorSideDockSlot> = {
        'hierarchy-panel': 'left',
        'inspector-panel': 'right'
    };
    public static centerSecondaryWidth: number = 320;
    public static centerTertiaryWidth: number = 280;
    public static layoutPreset: EditorLayoutPreset = 'default';
    public static activePanelId: EditorPanelId = 'viewport-panel';
    public static savedLayouts: Partial<Record<EditorLayoutSlotId, EditorLayoutSnapshot>> = {};
    public static prefabApplyTargetRootIds: Record<string, string> = {};
    public static collapsedComponentsPerGameObject: Record<string, string[]> = {};

    public static save(): void {
        const settings = {
            snapEnabled: this.snapEnabled,
            snapTranslation: this.snapTranslation,
            snapRotation: this.snapRotation,
            snapScale: this.snapScale,
            transformPivotMode: this.transformPivotMode,
            transformSpaceMode: this.transformSpaceMode,
            gridEnabled: this.gridEnabled,
            gridSize: this.gridSize,
            gridDivisions: this.gridDivisions,
            gridColor1: this.gridColor1,
            gridColor2: this.gridColor2,
            cameraSpeed: this.cameraSpeed,
            cameraSensitivity: this.cameraSensitivity,
            hierarchyWidth: this.hierarchyWidth,
            inspectorWidth: this.inspectorWidth,
            sidePanelWidths: this.sidePanelWidths,
            assetsHeight: this.assetsHeight,
            hierarchyVisible: this.hierarchyVisible,
            inspectorVisible: this.inspectorVisible,
            assetsVisible: this.assetsVisible,
            activeBottomTab: this.activeBottomTab,
            activeViewportTab: this.activeViewportTab,
            bottomTabOrder: this.bottomTabOrder,
            viewportTabOrder: this.viewportTabOrder,
            activeViewportDockTab: this.activeViewportDockTab,
            viewportDockTabOrder: this.viewportDockTabOrder,
            activeCenterSecondaryTab: this.activeCenterSecondaryTab,
            centerSecondaryTabOrder: this.centerSecondaryTabOrder,
            activeCenterTertiaryTab: this.activeCenterTertiaryTab,
            centerTertiaryTabOrder: this.centerTertiaryTabOrder,
            activeHierarchyTab: this.activeHierarchyTab,
            hierarchyTabOrder: this.hierarchyTabOrder,
            activeInspectorTab: this.activeInspectorTab,
            inspectorTabOrder: this.inspectorTabOrder,
            viewHosts: this.viewHosts,
            dockGraph: this.dockGraph,
            floatingDockableHomeHosts: this.floatingDockableHomeHosts,
            floatingPanels: this.floatingPanels,
            sidePanelSlots: this.sidePanelSlots,
            centerSecondaryWidth: this.centerSecondaryWidth,
            centerTertiaryWidth: this.centerTertiaryWidth,
            layoutPreset: this.layoutPreset,
            activePanelId: this.activePanelId,
            savedLayouts: this.savedLayouts,
            prefabApplyTargetRootIds: this.prefabApplyTargetRootIds,
            collapsedComponentsPerGameObject: this.collapsedComponentsPerGameObject
        };
        localStorage.setItem('tugberkengine_editor_settings', JSON.stringify(settings));
    }

    public static load(): void {
        const saved = localStorage.getItem('tugberkengine_editor_settings');
        if (saved) {
            try {
                const settings = JSON.parse(saved);
                Object.assign(this, settings);
                if (!this.savedLayouts || typeof this.savedLayouts !== 'object') {
                    this.savedLayouts = {};
                }
                if (!this.prefabApplyTargetRootIds || typeof this.prefabApplyTargetRootIds !== 'object') {
                    this.prefabApplyTargetRootIds = {};
                }
                if (!this.collapsedComponentsPerGameObject || typeof this.collapsedComponentsPerGameObject !== 'object') {
                    this.collapsedComponentsPerGameObject = {};
                }
                if (!this.floatingPanels || typeof this.floatingPanels !== 'object') {
                    this.floatingPanels = {};
                }
                if (!this.floatingDockableHomeHosts || typeof this.floatingDockableHomeHosts !== 'object') {
                    this.floatingDockableHomeHosts = {};
                }
                if (!this.dockGraph || typeof this.dockGraph !== 'object') {
                    this.dockGraph = {
                        hosts: {
                            bottom: ['project', 'console', 'render'],
                            viewport: [],
                            'center-secondary': [],
                            'center-tertiary': [],
                            hierarchy: [],
                            inspector: []
                        },
                        activeTabs: {
                            bottom: 'project'
                        }
                    };
                }
                if (!this.sidePanelWidths || typeof this.sidePanelWidths !== 'object') {
                    this.sidePanelWidths = {
                        left: this.hierarchyWidth ?? 250,
                        right: this.inspectorWidth ?? 320
                    };
                }
                if (typeof this.centerSecondaryWidth !== 'number') {
                    this.centerSecondaryWidth = 320;
                }
                if (typeof this.centerTertiaryWidth !== 'number') {
                    this.centerTertiaryWidth = 280;
                }
                if (this.transformPivotMode !== 'pivot' && this.transformPivotMode !== 'center') {
                    this.transformPivotMode = 'pivot';
                }
                if (this.transformSpaceMode !== 'local' && this.transformSpaceMode !== 'world') {
                    this.transformSpaceMode = 'local';
                }
            } catch (e) {
                console.error("Failed to load editor settings", e);
            }
        }
    }
}
