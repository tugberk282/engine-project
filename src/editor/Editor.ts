import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import { Scene } from '../engine/Scene';
import { SceneManager } from '../engine/SceneManager';
import { GameObject } from '../engine/GameObject';
import { Camera, type CameraClearFlags } from '../engine/components/Camera';
import { Light, LightType } from '../engine/components/Light';
import { AudioSource } from '../engine/components/AudioSource';
import { Canvas } from '../engine/components/Canvas';
import { EventSystem } from '../engine/components/EventSystem';
import { GraphicRaycaster } from '../engine/components/GraphicRaycaster';
import { RectTransform } from '../engine/components/RectTransform';
import { UIImage } from '../engine/components/UIImage';
import { UIText } from '../engine/components/UIText';
import { UIButton } from '../engine/components/UIButton';
import { UIInputField } from '../engine/components/UIInputField';
import { UIDropdown } from '../engine/components/UIDropdown';
import { UIToggle } from '../engine/components/UIToggle';
import { UISlider } from '../engine/components/UISlider';
import { UIScrollbar } from '../engine/components/UIScrollbar';
import { UIScrollRect } from '../engine/components/UIScrollRect';
import { MeshRenderer } from '../engine/components/MeshRenderer';
import { MeshFilter } from '../engine/components/MeshFilter';
import { MaterialManager } from '../engine/Material';

import { Input } from '../engine/Input';
import { Component } from '../engine/Component';
import { PlayModeManager } from '../engine/PlayModeManager';
import { EditorCameraController } from '../engine/components/EditorCameraController';
import { ScriptRegistry } from '../engine/ScriptRegistry';
import { Prefab, PrefabManager } from '../engine/Prefab';
import { CommandHistory, DuplicateGameObjectCommand, GroupCommand, type Command } from './Command';
import { AddComponentCommand, CreateGameObjectCommand, DeleteGameObjectCommand, ReparentGameObjectCommand } from './LifecycleCommands';
import { ProjectSettingsWindow } from './ProjectSettingsWindow';
import { EditorInspectors } from './EditorInspectors';
import { ProjectWindow, type ProjectAssetSelection } from './ProjectWindow';
import { HierarchyWindow } from './HierarchyWindow';
import { InspectorWindow } from './InspectorWindow';
import { ThemeManager } from './ThemeManager';
import { ConsoleWindow } from './ConsoleWindow';
import { AssetDatabase } from '../engine/AssetDatabase';
import { AssetImporter } from '../engine/AssetImporter';
import { SceneGizmo } from './SceneGizmo';
import { RenderSettingsWindow } from './RenderSettingsWindow';
import { DesktopBridge } from '../platform/DesktopBridge';
import { DirtyState } from './DirtyState';
import { DesktopFileSystem } from '../platform/DesktopFileSystem';
import { PathUtils } from '../platform/PathUtils';
import { ProjectSettings } from '../engine/ProjectSettings';
import {
    EditorSettings,
    type DockableEditorView,
    type EditorBottomTab,
    type EditorDockGraphState,
    type EditorDockHost,
    type EditorFloatingPanelState,
    type EditorHierarchyTab,
    type EditorInspectorTab,
    type EditorLayoutPreset,
    type EditorLayoutSlotId,
    type EditorLayoutSnapshot,
    type EditorPanelId,
    type EditorSideDockSlot,
    type EditorViewportTab
} from './EditorSettings';
import { calculateViewportSize, viewportSizeEquals, type ViewportSize } from './ViewportSizing';
import { EditorSelection, type EditorSelectionSource } from './EditorSelection';
// // import { BuildSettingsWindow } from './BuildSettingsWindow';

type FloatingDockTarget = {
    panelId: Exclude<EditorPanelId, 'viewport-panel'>;
    slot?: EditorSideDockSlot;
    host?: EditorDockHost;
};

type ClipboardGameObjectPayload = {
    data: any;
    prefabApplyTargetDepthByPath: Record<string, number>;
};

export class Editor {
    private scene: Scene;
    private renderer: THREE.WebGLRenderer;
    private camera: THREE.PerspectiveCamera;
    private sceneView: HTMLElement;
    private selectedGameObject: GameObject | null = null;
    private selectedGameObjects: GameObject[] = [];
    public readonly selection = new EditorSelection();
    private clipboard: ClipboardGameObjectPayload[] = [];
    private transformControls: TransformControls;
    private activeTransformToolMode: 'view' | 'translate' | 'rotate' | 'scale' | 'rect' = 'translate';
    private clock: THREE.Clock;
    private sceneGizmo: SceneGizmo;
    private composer!: EffectComposer;
    private bloomPass!: UnrealBloomPass;
    private ssaoPass!: SSAOPass;
    private outlinePass!: OutlinePass;
    private vignettePass!: ShaderPass;
    private filmGrainPass!: FilmPass;
    private chromaticAberrationPass!: ShaderPass;
    private viewportResizeObserver: ResizeObserver | null = null;
    private viewportResizeFrame: number | null = null;
    private appliedViewportSize: ViewportSize | null = null;

    private gridHelper!: THREE.GridHelper;
    private statusBar: HTMLElement;
    private statsTimer: number = 0;
    private sceneOnboardingHint: HTMLElement | null = null;

    // Play Mode State
    private isPlaying: boolean = false;
    private isPaused: boolean = false;
    private stepRequest: boolean = false;
    private readonly playMode = PlayModeManager.getInstance();
    private isGameView: boolean = false;
    private perfAccumulatedSeconds: number = 0;
    private perfAccumulatedFrames: number = 0;
    private smoothedFps: number = 0;
    private smoothedFrameMs: number = 0;
    private frameGateLastTime: number = 0;
    private transformPivotMode: 'pivot' | 'center' = 'pivot';
    private transformSpaceMode: 'local' | 'world' = 'local';
    private temporarySnapActive: boolean = false;
    private multiSelectionPivotHandle: THREE.Object3D | null = null;

    private rootPath: string = "";
    private readonly projectPath: string;
    private readonly dirtyState = new DirtyState();

    // Gizmos
    private gizmos: Map<Component, THREE.Object3D> = new Map();

    // Electron APIs
    private fs: DesktopFileSystem;
    private electronAPI: any;
    private desktopBridge: DesktopBridge;
    private prefabApplyTargetRootIds: Map<string, string> = new Map();

    public inspectors: EditorInspectors;
    public projectWindow: ProjectWindow;
    public hierarchyWindow: HierarchyWindow;
    public inspectorWindow: InspectorWindow;
    public consoleWindow: ConsoleWindow;
    public renderSettingsWindow: RenderSettingsWindow;

    private cameraGO!: GameObject;
    private selectionHelpers: Map<GameObject, THREE.BoxHelper> = new Map();
    private readonly minHierarchyWidth: number = 180;
    private readonly minInspectorWidth: number = 260;
    private readonly minViewportWidth: number = 420;
    private readonly minCenterSecondaryWidth: number = 240;
    private readonly minCenterTertiaryWidth: number = 220;
    private readonly defaultCenterSecondaryWidth: number = 320;
    private readonly defaultCenterTertiaryWidth: number = 280;
    private readonly minAssetsHeight: number = 140;
    private readonly minMainAreaHeight: number = 220;
    private readonly defaultViewportTabOrder: EditorViewportTab[] = ['scene', 'game'];
    private readonly defaultViewportDockTabOrder: DockableEditorView[] = [];
    private readonly defaultCenterSecondaryTabOrder: DockableEditorView[] = [];
    private readonly defaultCenterTertiaryTabOrder: DockableEditorView[] = [];
    private readonly defaultBottomTabOrder: EditorBottomTab[] = ['project', 'console', 'render'];
    private readonly defaultHierarchyTabOrder: EditorHierarchyTab[] = ['hierarchy'];
    private readonly defaultInspectorTabOrder: EditorInspectorTab[] = ['inspector'];
    private readonly defaultViewHosts: Record<DockableEditorView, EditorDockHost> = {
        project: 'bottom',
        console: 'bottom',
        render: 'bottom'
    };
    private readonly defaultSidePanelSlots: Record<'hierarchy-panel' | 'inspector-panel', EditorSideDockSlot> = {
        'hierarchy-panel': 'left',
        'inspector-panel': 'right'
    };
    private readonly defaultSidePanelWidths: Record<EditorSideDockSlot, number> = {
        left: 250,
        right: 320
    };
    private readonly floatablePanels: Exclude<EditorPanelId, 'viewport-panel'>[] = ['hierarchy-panel', 'inspector-panel', 'assets-panel'];
    private readonly panelDockMounts: Record<Exclude<EditorPanelId, 'viewport-panel'>, { parentId: string; nextSiblingId: string | null }> = {
        'hierarchy-panel': { parentId: 'main-area', nextSiblingId: null },
        'inspector-panel': { parentId: 'main-area', nextSiblingId: null },
        'assets-panel': { parentId: 'editor-container', nextSiblingId: 'floating-layer' }
    };
    private activeBottomTab: EditorBottomTab = 'project';
    private activeViewportTab: EditorViewportTab = 'scene';
    private activeViewportDockTab: DockableEditorView | null = null;
    private activeCenterSecondaryTab: DockableEditorView | null = null;
    private activeCenterTertiaryTab: DockableEditorView | null = null;
    private activeHierarchyTab: EditorHierarchyTab = 'hierarchy';
    private activeInspectorTab: EditorInspectorTab = 'inspector';
    private activeViewportFocusHost: 'viewport' | 'center-secondary' | 'center-tertiary' = 'viewport';
    private currentLayoutPreset: EditorLayoutPreset = 'default';
    private activePanelId: EditorPanelId = 'viewport-panel';
    private maximizedPanelId: EditorPanelId | null = null;
    private floatingDockableHomeHosts: Partial<Record<DockableEditorView, EditorDockHost>> = {};
    private draggedTabHost: 'viewport' | EditorDockHost | null = null;
    private draggedViewportTab: EditorViewportTab | null = null;
    private draggedDockableTab: DockableEditorView | null = null;
    private dockableTabDropHandled: boolean = false;
    private dockHighlightDepth: Record<EditorDockHost, number> = { bottom: 0, viewport: 0, 'center-secondary': 0, 'center-tertiary': 0, hierarchy: 0, inspector: 0 };
    private activeFloatingDockTarget: FloatingDockTarget | null = null;
    private activeDockHostPreview: EditorDockHost | null = null;
    private floatingZCounter: number = 50;
    private floatingPanelDragState: {
        panelId: Exclude<EditorPanelId, 'viewport-panel'>;
        pointerId: number;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
    } | null = null;
    private floatingPanelResizeState: {
        panelId: Exclude<EditorPanelId, 'viewport-panel'>;
        pointerId: number;
        startX: number;
        startY: number;
        originWidth: number;
        originHeight: number;
    } | null = null;

    constructor(projectPath: string) {
        this.projectPath = projectPath;
        // Initialize Core Systems first
        this.clock = new THREE.Clock();
        ProjectSettings.load();
        this.scene = SceneManager.getInstance().newScene();
        EditorSettings.load();
        Input.initialize();
        ScriptRegistry.initialize();
        this.desktopBridge = new DesktopBridge();
        this.fs = new DesktopFileSystem();

        // @ts-ignore
        window.Editor = {
            instance: this,
            selectGameObjectPublic: (go: GameObject | null) => this.selectGameObject(go)
        };

        // UI Systems
        this.inspectors = new EditorInspectors();
        ProjectSettingsWindow.initialize(this.inspectors);

        // Modular Windows
        this.inspectorWindow = new InspectorWindow(document.getElementById('inspector-panel')!, this.inspectors);
        this.hierarchyWindow = new HierarchyWindow(document.getElementById('hierarchy-panel')!, this.scene, (go: GameObject) => this.selectGameObject(go));
        this.consoleWindow = new ConsoleWindow(document.getElementById('console-content')!);
        this.renderSettingsWindow = new RenderSettingsWindow(document.getElementById('render-content')!, this.scene, () => this.updatePostProcessing());

        this.electronAPI = this.desktopBridge.getElectronAPI();
        this.playMode.onStop(() => {
            const runtimeFailed = this.playMode.getRuntimeError() !== null;
            this.isPlaying = false;
            this.isPaused = false;
            this.stepRequest = false;
            this.updatePlayModeButtons();
            this.hierarchyWindow.refresh();
            this.inspectorWindow.refresh();
            this.setTab('scene', false);
            if (runtimeFailed) {
                this.setBottomTab('console', false);
                this.consoleWindow.onGUI();
            }
        });
        CommandHistory.addMutationListener((state) => this.dirtyState.setCommandRevision(state));
        this.dirtyState.subscribe((dirty) => this.desktopBridge.setEditorDirty(dirty));
        this.desktopBridge.onCloseSaveRequested( async() => await this.saveActiveScene());

        this.rootPath = PathUtils.join(projectPath, 'Assets');

        this.projectWindow = new ProjectWindow(this);
        this.projectWindow.initialize();

        // Initialize Asset Database
        AssetDatabase.getInstance().refresh(this.rootPath);

        this.sceneView = document.getElementById('scene-view')!;
        this.statusBar = this.createStatusBar();
        this.initializeLayout();

        // Initialize Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setPixelRatio(calculateViewportSize(1, 1, window.devicePixelRatio)?.pixelRatio ?? 1);
        this.renderer.setSize(this.sceneView.clientWidth, this.sceneView.clientHeight, false);
        this.renderer.toneMapping = THREE.ReinhardToneMapping;
        this.sceneView.appendChild(this.renderer.domElement);
        this.initializeViewportResizePolicy();

        // Setup Camera & Gizmos
        this.camera = new THREE.PerspectiveCamera(75, this.sceneView.clientWidth / this.sceneView.clientHeight, 0.1, 1000);

        const cameraGO = new GameObject("Editor Camera");
        this.cameraGO = cameraGO;
        cameraGO.object3D = this.camera;
        cameraGO.object3D.position.set(5, 5, 5);
        this.camera.lookAt(0, 0, 0);
        this.cameraGO.addComponent(EditorCameraController);
        const editorCameraController = this.cameraGO.getComponent(EditorCameraController);
        if (editorCameraController) {
            editorCameraController.pitch = -0.6154797086703873;
            editorCameraController.yaw = 0.7853981633974483;
            editorCameraController.orbitDistance = this.camera.position.length();
            editorCameraController.orbitTarget.set(0, 0, 0);
        }
        this.scene.addGameObject(this.cameraGO);
        this.sceneGizmo = new SceneGizmo(document.getElementById('scene-view')!, this.camera, (dir: THREE.Vector3) => this.setCameraOrientation(dir));
        this.initializeSceneCameraPointerWorkflow(editorCameraController);

        // Setup Post-Processing
        this.composer = new EffectComposer(this.renderer);
        const renderPass = new RenderPass(this.scene.threeScene, this.camera);
        this.composer.addPass(renderPass);

        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(this.sceneView.clientWidth, this.sceneView.clientHeight),
            1.5, 0.4, 0.85
        );
        this.bloomPass.enabled = false;
        this.composer.addPass(this.bloomPass);

        this.ssaoPass = new SSAOPass(this.scene.threeScene, this.camera, this.sceneView.clientWidth, this.sceneView.clientHeight);
        this.ssaoPass.enabled = false;
        this.composer.addPass(this.ssaoPass);

        this.outlinePass = new OutlinePass(new THREE.Vector2(this.sceneView.clientWidth, this.sceneView.clientHeight), this.scene.threeScene, this.camera);
        this.outlinePass.edgeStrength = 4;
        this.outlinePass.edgeThickness = 1;
        this.outlinePass.visibleEdgeColor.set(0xff9d00); // Unity Orange
        this.outlinePass.hiddenEdgeColor.set(0xff9d00);
        this.composer.addPass(this.outlinePass);

        // Advanced Post-Processing
        this.vignettePass = new ShaderPass(VignetteShader);
        this.vignettePass.enabled = false;
        this.composer.addPass(this.vignettePass);

        // Simple Chromatic Aberration Shader Placeholder
        const ChromaticAberrationShader = {
            uniforms: {
                "tDiffuse": { value: null },
                "amount": { value: 0.005 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform float amount;
                varying vec2 vUv;
                void main() {
                    vec4 col = texture2D( tDiffuse, vUv );
                    col.r = texture2D( tDiffuse, vec2( vUv.x + amount, vUv.y ) ).r;
                    col.b = texture2D( tDiffuse, vec2( vUv.x - amount, vUv.y ) ).b;
                    gl_FragColor = col;
                }
            `
        };
        this.chromaticAberrationPass = new ShaderPass(ChromaticAberrationShader);
        this.chromaticAberrationPass.enabled = false;
        this.composer.addPass(this.chromaticAberrationPass);

        // @ts-ignore
        this.filmGrainPass = new FilmPass(0.5, 0.5, 648, false);
        this.filmGrainPass.enabled = false;
        this.composer.addPass(this.filmGrainPass);

        const outputPass = new OutputPass();
        this.composer.addPass(outputPass);

        this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
        this.scene.threeScene.add(this.transformControls);
        // sceneGizmo already initialized after cameraGO creation

        // Events
        this.initializeTransformControlsEvents();
        this.initializeTabEvents();
        this.initializeToolButtonEvents();
        this.initializeKeyBindings();
        this.initializeMenuPresentation();
        this.initializeMenuEvents();
        this.initializeToolbarEvents();
        this.initializeDragAndDrop();
        this.initializeSelectionEvents();
        this.initializeThemeMenu();

        // Misc
        window.addEventListener('resize', () => this.onWindowResize());
        document.getElementById('save-btn')?.addEventListener('click',  async() => await this.saveActiveScene());
        document.getElementById('load-btn')?.addEventListener('click',  async() => await this.showOpenSceneDialog());
        document.getElementById('settings-btn')?.addEventListener('click', () => ProjectSettingsWindow.show());
        window.setInterval( async() => {
            if (!this.dirtyState.isDirty) return;
            const scenePath = SceneManager.getInstance().getActiveScenePath();
            void await this.desktopBridge.writeRecovery(this.projectPath, scenePath, this.scene.toJSON())
                .catch((error) => console.warn('Autosave recovery failed:', error));
        }, 30_000);
        // Default Scene
        this.createDemoScene();
        window.setTimeout(async () => {
            await this.restorePersistedSceneOnStartup();
            await this.offerRecovery();
        }, 0);

        // Finalize
        this.gridHelper = new THREE.GridHelper(EditorSettings.gridSize, EditorSettings.gridDivisions, EditorSettings.gridColor1, EditorSettings.gridColor2);
        this.scene.threeScene.add(this.gridHelper);
        this.updatePostProcessing(); // Initial sync
        this.hierarchyWindow.refresh();
        this.projectWindow.refresh();
        this.animate();
    }

    private initializeLayout() {
        this.activeBottomTab = EditorSettings.activeBottomTab ?? 'project';
        this.activeViewportTab = EditorSettings.activeViewportTab ?? 'scene';
        this.activeViewportDockTab = EditorSettings.activeViewportDockTab ?? null;
        this.activeCenterSecondaryTab = EditorSettings.activeCenterSecondaryTab ?? null;
        this.activeCenterTertiaryTab = EditorSettings.activeCenterTertiaryTab ?? null;
        this.activeHierarchyTab = EditorSettings.activeHierarchyTab ?? 'hierarchy';
        this.activeInspectorTab = EditorSettings.activeInspectorTab ?? 'inspector';
        this.activeViewportFocusHost = this.activeCenterTertiaryTab
            ? 'center-tertiary'
            : this.activeCenterSecondaryTab
                ? 'center-secondary'
                : 'viewport';
        this.currentLayoutPreset = EditorSettings.layoutPreset ?? 'default';
        this.activePanelId = EditorSettings.activePanelId ?? 'viewport-panel';
        EditorSettings.dockGraph = this.normalizeDockGraph(EditorSettings.dockGraph);
        this.floatingDockableHomeHosts = this.normalizeFloatingDockableHomeHosts(EditorSettings.floatingDockableHomeHosts);
        this.prefabApplyTargetRootIds = this.normalizePrefabApplyTargetRootIds(EditorSettings.prefabApplyTargetRootIds);
        this.applyDockGraphToLegacyState(EditorSettings.dockGraph);
        this.normalizeTabSettings();
        this.applyTabOrders();
        this.initializeFloatingPanels();
        this.applyStoredLayout();
        this.initializeSplitters();
        this.initializePanelFocusTracking();
    }

    private applyStoredLayout() {
        const requiredLayoutRoots = [
            'editor-container',
            'main-area',
            'viewport-panel',
            'floating-layer',
            'viewport-workspace'
        ] as const;
        if (requiredLayoutRoots.some((id) => !document.getElementById(id))) {
            console.warn('Skipping layout application because required layout DOM roots are missing.');
            return;
        }

        this.floatingDockableHomeHosts = this.normalizeFloatingDockableHomeHosts(this.floatingDockableHomeHosts);
        EditorSettings.floatingDockableHomeHosts = { ...this.floatingDockableHomeHosts };
        this.syncDockGraphFromLegacyState();
        this.normalizeTabSettings();
        this.applyTabOrders();
        this.applyDockedViewHosts();
        this.applyFloatingPanelStates();
        this.applySidePanelDockLayout();
        this.updateFloatingDockGuideLabels();
        this.applyPanelWidths();
        this.applyPanelVisibility(false);
        this.setTab(this.activeViewportTab, false);
        this.updateDockedViewState();
        this.clampLayoutSizes();
        this.updateSplitterVisibility();
        this.syncWindowMenuState();
    }

    private applyPanelWidths() {
        const hierarchyPanel = document.getElementById('hierarchy-panel') as HTMLElement | null;
        const inspectorPanel = document.getElementById('inspector-panel') as HTMLElement | null;
        const assetsPanel = document.getElementById('assets-panel') as HTMLElement | null;
        const centerSecondaryPanel = document.getElementById('center-secondary-panel') as HTMLElement | null;
        const centerTertiaryPanel = document.getElementById('center-tertiary-panel') as HTMLElement | null;

        if (hierarchyPanel && !this.isPanelFloating('hierarchy-panel')) hierarchyPanel.style.flex = `0 0 ${this.getSidePanelWidth('hierarchy-panel')}px`;
        if (inspectorPanel && !this.isPanelFloating('inspector-panel')) inspectorPanel.style.flex = `0 0 ${this.getSidePanelWidth('inspector-panel')}px`;
        if (assetsPanel && !this.isPanelFloating('assets-panel')) assetsPanel.style.flex = `0 0 ${EditorSettings.assetsHeight}px`;
        if (centerSecondaryPanel) centerSecondaryPanel.style.flex = this.isCenterSecondaryVisible() ? `0 0 ${EditorSettings.centerSecondaryWidth}px` : '0 0 0';
        if (centerTertiaryPanel) centerTertiaryPanel.style.flex = this.isCenterTertiaryVisible() ? `0 0 ${EditorSettings.centerTertiaryWidth}px` : '0 0 0';
    }

    private applyPanelVisibility(save: boolean) {
        this.setPanelVisibility('hierarchy-panel', EditorSettings.hierarchyVisible, save);
        this.setPanelVisibility('inspector-panel', EditorSettings.inspectorVisible, save);
        this.setPanelVisibility('assets-panel', EditorSettings.assetsVisible, save);
        const centerSecondaryPanel = document.getElementById('center-secondary-panel') as HTMLElement | null;
        const centerTertiaryPanel = document.getElementById('center-tertiary-panel') as HTMLElement | null;
        if (centerSecondaryPanel) centerSecondaryPanel.style.display = this.isCenterSecondaryVisible() ? 'flex' : 'none';
        if (centerTertiaryPanel) centerTertiaryPanel.style.display = this.isCenterTertiaryVisible() ? 'flex' : 'none';
    }

    private initializeFloatingPanels() {
        this.floatablePanels.forEach((panelId) => {
            const panel = document.getElementById(panelId) as HTMLElement | null;
            if (!panel) return;

            panel.addEventListener('pointerdown', () => {
                if (!this.isPanelFloating(panelId)) return;
                this.setActivePanel(panelId);
            });
            panel.addEventListener('focusin', () => {
                if (!this.isPanelFloating(panelId)) return;
                this.setActivePanel(panelId);
                panel.classList.add('floating-panel-focus-within');
            });
            panel.addEventListener('focusout', () => {
                requestAnimationFrame(() => {
                    if (!panel.matches(':focus-within')) {
                        panel.classList.remove('floating-panel-focus-within');
                    }
                });
            });

            if (!panel.querySelector('.floating-resize-handle')) {
                const resizeHandle = document.createElement('div');
                resizeHandle.className = 'floating-resize-handle';
                resizeHandle.addEventListener('pointerdown', (event) => this.beginFloatingResize(event, panelId));
                panel.appendChild(resizeHandle);
            }
        });

        this.initializeFloatingDockGuides();
        this.initializePanelWindowActions();
        this.bindFloatingHeaderDrag('hierarchy-panel-header', 'hierarchy-panel');
        this.bindFloatingHeaderDrag('inspector-panel-header', 'inspector-panel');
        this.bindFloatingHeaderDrag('bottom-panel-header', 'assets-panel');
    }

    private initializeFloatingDockGuides() {
        const floatingLayer = document.getElementById('floating-layer') as HTMLElement | null;
        if (!floatingLayer) return;

        this.getFloatingDockTargets().forEach((target) => {
            const guideId = this.getFloatingDockGuideId(target);
            if (document.getElementById(guideId)) return;

            const guide = document.createElement('div');
            guide.id = guideId;
            guide.className = 'floating-dock-guide';
            guide.dataset.label = this.getFloatingDockGuideLabel(target);
            floatingLayer.appendChild(guide);
        });

        if (!document.getElementById('floating-dock-preview')) {
            const preview = document.createElement('div');
            preview.id = 'floating-dock-preview';
            preview.className = 'floating-dock-preview';
            floatingLayer.appendChild(preview);
        }

        if (!document.getElementById('dock-host-preview')) {
            const preview = document.createElement('div');
            preview.id = 'dock-host-preview';
            preview.className = 'dock-host-preview';
            floatingLayer.appendChild(preview);
        }

        this.updateFloatingDockGuideLabels();
    }

    private getFloatingDockTargets(
        panelId?: Exclude<EditorPanelId, 'viewport-panel'>
    ): FloatingDockTarget[] {
        if (!panelId) {
            return [
                { panelId: 'hierarchy-panel', slot: 'left' },
                { panelId: 'hierarchy-panel', slot: 'right' },
                { panelId: 'hierarchy-panel', host: 'bottom' },
                { panelId: 'hierarchy-panel', host: 'viewport' },
                { panelId: 'hierarchy-panel', host: 'inspector' },
                { panelId: 'inspector-panel', slot: 'left' },
                { panelId: 'inspector-panel', slot: 'right' },
                { panelId: 'inspector-panel', host: 'bottom' },
                { panelId: 'inspector-panel', host: 'viewport' },
                { panelId: 'inspector-panel', host: 'hierarchy' },
                { panelId: 'assets-panel' },
                { panelId: 'assets-panel', host: 'viewport' }
            ];
        }

        if (panelId === 'assets-panel') {
            return [
                { panelId, slot: 'left' },
                { panelId },
                { panelId, slot: 'right' },
                { panelId, host: 'viewport' }
            ];
        }

        const targets: FloatingDockTarget[] = [
            { panelId, slot: 'left' },
            { panelId, slot: 'right' }
        ];

        if (this.getDockableTabsForPanel(panelId).length > 0) {
            targets.push(
                { panelId, host: 'bottom' },
                { panelId, host: 'viewport' },
                { panelId, host: panelId === 'hierarchy-panel' ? 'inspector' : 'hierarchy' }
            );
        }

        return targets;
    }

    private getFloatingDockGuideId(target: FloatingDockTarget): string {
        if (target.host) {
            return `floating-dock-guide-${target.panelId}-${target.host}`;
        }
        return target.slot
            ? `floating-dock-guide-${target.panelId}-${target.slot}`
            : `floating-dock-guide-${target.panelId}`;
    }

    private getFloatingDockGuideLabel(target: FloatingDockTarget): string {
        if (target.host === 'viewport') return 'Dock to Viewport';
        if (target.host === 'bottom') return 'Dock Tabs to Bottom';
        if (target.host === 'hierarchy') return 'Tabs to Hierarchy';
        if (target.host === 'inspector') return 'Tabs to Inspector';
        if (target.panelId === 'assets-panel' && target.slot) {
            return this.getPanelIdForSideSlot(target.slot) === 'hierarchy-panel'
                ? 'Dock to Hierarchy'
                : 'Dock to Inspector';
        }
        if (target.panelId === 'assets-panel') return 'Dock Bottom';
        return target.slot === 'left' ? 'Dock Left' : 'Dock Right';
    }

    private getOppositeSideDockSlot(slot: EditorSideDockSlot): EditorSideDockSlot {
        return slot === 'left' ? 'right' : 'left';
    }

    private normalizeSidePanelSlots(
        sidePanelSlots: Partial<Record<'hierarchy-panel' | 'inspector-panel', EditorSideDockSlot>> | undefined
    ): Record<'hierarchy-panel' | 'inspector-panel', EditorSideDockSlot> {
        const hierarchySlot = sidePanelSlots?.['hierarchy-panel'];
        const inspectorSlot = sidePanelSlots?.['inspector-panel'];

        const normalizedHierarchySlot: EditorSideDockSlot =
            hierarchySlot === 'left' || hierarchySlot === 'right'
                ? hierarchySlot
                : inspectorSlot === 'left' || inspectorSlot === 'right'
                    ? this.getOppositeSideDockSlot(inspectorSlot)
                    : this.defaultSidePanelSlots['hierarchy-panel'];

        const normalizedInspectorSlot: EditorSideDockSlot =
            inspectorSlot === 'left' || inspectorSlot === 'right'
                ? inspectorSlot === normalizedHierarchySlot
                    ? this.getOppositeSideDockSlot(normalizedHierarchySlot)
                    : inspectorSlot
                : this.getOppositeSideDockSlot(normalizedHierarchySlot);

        return {
            'hierarchy-panel': normalizedHierarchySlot,
            'inspector-panel': normalizedInspectorSlot
        };
    }

    private normalizeSidePanelWidths(
        sidePanelWidths: Partial<Record<EditorSideDockSlot, number>> | undefined,
        sidePanelSlots: Record<'hierarchy-panel' | 'inspector-panel', EditorSideDockSlot> = EditorSettings.sidePanelSlots
    ): Record<EditorSideDockSlot, number> {
        const fallbackFromLegacy = {
            [sidePanelSlots['hierarchy-panel']]: EditorSettings.hierarchyWidth || this.defaultSidePanelWidths[sidePanelSlots['hierarchy-panel']],
            [sidePanelSlots['inspector-panel']]: EditorSettings.inspectorWidth || this.defaultSidePanelWidths[sidePanelSlots['inspector-panel']]
        } as Record<EditorSideDockSlot, number>;

        return {
            left: Math.max(
                this.minHierarchyWidth,
                Math.round(sidePanelWidths?.left ?? fallbackFromLegacy.left ?? this.defaultSidePanelWidths.left)
            ),
            right: Math.max(
                this.minHierarchyWidth,
                Math.round(sidePanelWidths?.right ?? fallbackFromLegacy.right ?? this.defaultSidePanelWidths.right)
            )
        };
    }

    private syncLegacyPanelWidthsFromSideSlots() {
        EditorSettings.hierarchyWidth = EditorSettings.sidePanelWidths[this.getSidePanelSlot('hierarchy-panel')];
        EditorSettings.inspectorWidth = EditorSettings.sidePanelWidths[this.getSidePanelSlot('inspector-panel')];
    }

    private getSidePanelSlot(panelId: 'hierarchy-panel' | 'inspector-panel'): EditorSideDockSlot {
        return EditorSettings.sidePanelSlots[panelId];
    }

    private getPanelIdForSideSlot(slot: EditorSideDockSlot): 'hierarchy-panel' | 'inspector-panel' {
        return this.getSidePanelSlot('hierarchy-panel') === slot ? 'hierarchy-panel' : 'inspector-panel';
    }

    private getDockedPanelIdForSideSlot(slot: EditorSideDockSlot): 'hierarchy-panel' | 'inspector-panel' | null {
        const panelId = this.getPanelIdForSideSlot(slot);
        return this.isPanelDockedVisible(panelId) ? panelId : null;
    }

    private getSidePanelWidth(panelId: 'hierarchy-panel' | 'inspector-panel'): number {
        return EditorSettings.sidePanelWidths[this.getSidePanelSlot(panelId)];
    }

    private setSidePanelWidth(panelId: 'hierarchy-panel' | 'inspector-panel', width: number) {
        this.setSideSlotWidth(this.getSidePanelSlot(panelId), width);
    }

    private getMinSidePanelWidth(panelId: 'hierarchy-panel' | 'inspector-panel'): number {
        return panelId === 'hierarchy-panel' ? this.minHierarchyWidth : this.minInspectorWidth;
    }

    private getSideSlotWidth(slot: EditorSideDockSlot): number {
        return EditorSettings.sidePanelWidths[slot];
    }

    private setSideSlotWidth(slot: EditorSideDockSlot, width: number) {
        EditorSettings.sidePanelWidths[slot] = Math.round(width);
        this.syncLegacyPanelWidthsFromSideSlots();
    }

    private getMaxSidePanelWidth(panelId: 'hierarchy-panel' | 'inspector-panel'): number {
        return this.getMaxSideSlotWidth(this.getSidePanelSlot(panelId), panelId);
    }

    private getMaxSideSlotWidth(slot: EditorSideDockSlot, panelId?: 'hierarchy-panel' | 'inspector-panel') {
        const mainArea = document.getElementById('main-area') as HTMLElement | null;
        if (!mainArea) {
            return panelId ? this.getMinSidePanelWidth(panelId) : this.minHierarchyWidth;
        }

        const leftPanelId = this.getDockedPanelIdForSideSlot('left');
        const rightPanelId = this.getDockedPanelIdForSideSlot('right');
        const splitterAllowance =
            (leftPanelId ? 4 : 0) +
            (rightPanelId ? 4 : 0);
        const oppositeSlot = this.getOppositeSideDockSlot(slot);
        const oppositePanelId = this.getDockedPanelIdForSideSlot(oppositeSlot);
        const minCurrent = panelId ? this.getMinSidePanelWidth(panelId) : this.minHierarchyWidth;
        const minOpposite = oppositePanelId ? this.getMinSidePanelWidth(oppositePanelId) : 0;

        return Math.max(
            minCurrent,
            mainArea.clientWidth - splitterAllowance - this.minViewportWidth - minOpposite
        );
    }

    private applySidePanelDockLayout() {
        const mainArea = document.getElementById('main-area') as HTMLElement | null;
        const viewportPanel = document.getElementById('viewport-panel') as HTMLElement | null;
        const leftSplitter = document.getElementById('left-splitter') as HTMLElement | null;
        const rightSplitter = document.getElementById('right-splitter') as HTMLElement | null;
        if (!mainArea || !viewportPanel || !leftSplitter || !rightSplitter) return;

        const leftPanel = document.getElementById(this.getPanelIdForSideSlot('left')) as HTMLElement | null;
        const rightPanel = document.getElementById(this.getPanelIdForSideSlot('right')) as HTMLElement | null;

        if (leftPanel && leftPanel.parentElement === mainArea) {
            mainArea.appendChild(leftPanel);
        }
        mainArea.appendChild(leftSplitter);
        mainArea.appendChild(viewportPanel);
        mainArea.appendChild(rightSplitter);
        if (rightPanel && rightPanel.parentElement === mainArea) {
            mainArea.appendChild(rightPanel);
        }
    }

    private updateFloatingDockGuideLabels() {
        this.getFloatingDockTargets().forEach((target) => {
            const guide = document.getElementById(this.getFloatingDockGuideId(target));
            if (!guide) return;
            guide.setAttribute('data-label', this.getFloatingDockGuideLabel(target));
        });
    }

    private initializePanelWindowActions() {
        this.attachPanelWindowActions('hierarchy-panel-header', 'hierarchy-panel');
        this.attachPanelWindowActions('inspector-panel-header', 'inspector-panel');
        this.attachPanelWindowActions('bottom-panel-header', 'assets-panel');
    }

    private attachPanelWindowActions(
        headerId: string,
        panelId: Exclude<EditorPanelId, 'viewport-panel'>
    ) {
        const header = document.getElementById(headerId) as HTMLElement | null;
        if (!header || header.querySelector('.panel-window-actions')) return;

        const actions = document.createElement('div');
        actions.className = 'panel-window-actions';

        const dockButton = document.createElement('button');
        dockButton.className = 'panel-window-btn panel-window-dock';
        dockButton.type = 'button';
        dockButton.title = 'Toggle Floating';
        dockButton.setAttribute('aria-label', 'Toggle Floating');
        dockButton.textContent = '[]';
        dockButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.toggleFloatingPanel(panelId);
        });

        const closeButton = document.createElement('button');
        closeButton.className = 'panel-window-btn panel-window-close';
        closeButton.type = 'button';
        closeButton.title = 'Close Panel';
        closeButton.setAttribute('aria-label', 'Close Panel');
        closeButton.textContent = 'x';
        closeButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.setPanelVisibility(panelId, false);
            if (this.activePanelId === panelId) {
                this.setActivePanel('viewport-panel');
            }
            this.resize();
        });

        actions.appendChild(dockButton);
        actions.appendChild(closeButton);
        header.appendChild(actions);
        this.updatePanelWindowActions(panelId);
    }

    private updatePanelWindowActions(panelId: Exclude<EditorPanelId, 'viewport-panel'>) {
        const panel = document.getElementById(panelId) as HTMLElement | null;
        if (!panel) return;

        const dockButton = panel.querySelector('.panel-window-dock') as HTMLElement | null;
        if (dockButton) {
            const floating = this.isPanelFloating(panelId);
            dockButton.classList.toggle('is-active', floating);
            dockButton.textContent = floating ? '><' : '[]';
            dockButton.setAttribute('title', floating ? 'Restore Docked Panel' : 'Float Panel');
            dockButton.setAttribute('aria-label', floating ? 'Restore Docked Panel' : 'Float Panel');
            dockButton.setAttribute('aria-pressed', floating ? 'true' : 'false');
        }
    }

    private updateAllPanelWindowActions() {
        this.floatablePanels.forEach((panelId) => this.updatePanelWindowActions(panelId));
    }

    private updateFloatingPanelActiveState() {
        this.floatablePanels.forEach((panelId) => {
            const panel = document.getElementById(panelId) as HTMLElement | null;
            if (!panel) return;
            panel.classList.toggle('floating-panel-active', this.isPanelFloating(panelId) && this.activePanelId === panelId);
        });
    }

    private reconcileViewportFocusHostAfterLayoutMutation() {
        if (this.activeViewportFocusHost === 'center-tertiary' && !this.isCenterTertiaryVisible()) {
            this.activeViewportFocusHost = this.isCenterSecondaryVisible() ? 'center-secondary' : 'viewport';
        }

        if (this.activeViewportFocusHost === 'center-secondary' && !this.isCenterSecondaryVisible()) {
            this.activeViewportFocusHost = this.isCenterTertiaryVisible() ? 'center-tertiary' : 'viewport';
        }
    }

    private finalizeLayoutMutation(options?: {
        save?: boolean;
        updatedPanelId?: Exclude<EditorPanelId, 'viewport-panel'> | null;
    }) {
        this.normalizeTabSettings();
        this.reconcileViewportFocusHostAfterLayoutMutation();
        this.updateDockedViewState();
        this.setActivePanel(this.getResolvedActivePanel(this.activePanelId));
        this.applyPanelVisibility(false);
        this.applyFloatingPanelStates();
        if (options?.updatedPanelId) {
            this.updatePanelWindowActions(options.updatedPanelId);
        } else {
            this.updateAllPanelWindowActions();
        }
        this.updateSplitterVisibility();
        this.clampLayoutSizes();
        this.syncWindowMenuState();
        this.updateFloatingPanelActiveState();
        this.resize();
        if (options?.save ?? true) {
            this.saveLayout();
        }
    }

    private bindFloatingHeaderDrag(
        headerId: string,
        panelId: Exclude<EditorPanelId, 'viewport-panel'>
    ) {
        const header = document.getElementById(headerId) as HTMLElement | null;
        if (!header) return;

        header.addEventListener('pointerdown', (event: PointerEvent) => {
            const target = event.target as HTMLElement | null;
            if (!target) return;
            if (!this.isPanelFloating(panelId)) return;
            if (['INPUT', 'BUTTON', 'SELECT', 'OPTION', 'LABEL'].includes(target.tagName)) return;
            if (target.closest('.floating-resize-handle')) return;

            const panel = document.getElementById(panelId) as HTMLElement | null;
            if (!panel) return;

            event.preventDefault();
            this.floatingPanelDragState = {
                panelId,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                originX: parseFloat(panel.style.left || '0'),
                originY: parseFloat(panel.style.top || '0')
            };

            panel.classList.add('floating-panel-dragging');
            header.setPointerCapture(event.pointerId);

            const handleMove = (moveEvent: PointerEvent) => {
                if (!this.floatingPanelDragState || this.floatingPanelDragState.pointerId !== moveEvent.pointerId) return;
                this.updateFloatingPanelPosition(
                    panelId,
                    this.floatingPanelDragState.originX + (moveEvent.clientX - this.floatingPanelDragState.startX),
                    this.floatingPanelDragState.originY + (moveEvent.clientY - this.floatingPanelDragState.startY)
                );
                this.updateFloatingDockGuides(panelId, moveEvent.clientX, moveEvent.clientY);
            };

            const handleUp = (upEvent: PointerEvent) => {
                if (!this.floatingPanelDragState || this.floatingPanelDragState.pointerId !== upEvent.pointerId) return;
                const dockTarget = this.activeFloatingDockTarget;
                let didDockToHost = false;
                this.floatingPanelDragState = null;
                panel.classList.remove('floating-panel-dragging');
                header.releasePointerCapture(upEvent.pointerId);
                header.removeEventListener('pointermove', handleMove);
                header.removeEventListener('pointerup', handleUp);
                this.clearFloatingDockGuides();

                if (dockTarget && dockTarget.panelId === panelId) {
                    if (panelId === 'assets-panel' && dockTarget.host === 'viewport') {
                        const dockedBottomTabs = [...EditorSettings.bottomTabOrder];
                        const preferredActiveTab = this.getPreferredDockableTabForPanel(panelId);

                        dockedBottomTabs.forEach((tab) => this.moveDockableTabToHost(tab, 'viewport', undefined, { deferLayout: true }));

                        const current = this.ensureFloatingPanelState(panelId);
                        EditorSettings.floatingPanels[panelId] = { ...current, floating: false };
                        this.restoreDockedPanel(panelId);
                        this.setPanelVisibility('assets-panel', false, false);

                        if (preferredActiveTab) {
                            this.setViewportDockTab(preferredActiveTab, false);
                        }

                        this.setActivePanel('viewport-panel');
                        didDockToHost = true;
                    } else if (panelId === 'assets-panel' && dockTarget.slot) {
                        const sideTargetPanelId = this.getPanelIdForSideSlot(dockTarget.slot);
                        const sideTargetHost: EditorDockHost = sideTargetPanelId === 'hierarchy-panel' ? 'hierarchy' : 'inspector';
                        const dockedBottomTabs = [...EditorSettings.bottomTabOrder];
                        const preferredActiveTab = this.getPreferredDockableTabForPanel(panelId);

                        dockedBottomTabs.forEach((tab) => this.moveDockableTabToHost(tab, sideTargetHost, undefined, { deferLayout: true }));

                        const current = this.ensureFloatingPanelState(panelId);
                        EditorSettings.floatingPanels[panelId] = { ...current, floating: false };
                        this.restoreDockedPanel(panelId);
                        this.setPanelVisibility('assets-panel', false, false);

                        if (preferredActiveTab) {
                            if (sideTargetHost === 'hierarchy') {
                                this.setHierarchyTab(preferredActiveTab, false);
                            } else {
                                this.setInspectorTab(preferredActiveTab, false);
                            }
                        }

                        this.setActivePanel(sideTargetPanelId);
                        didDockToHost = true;
                    } else if (panelId !== 'assets-panel' && dockTarget.host) {
                        const preferredActiveTab = this.getPreferredDockableTabForPanel(panelId);
                        this.movePanelDockableTabsToHost(panelId, dockTarget.host, { rememberSourceHosts: true, deferLayout: true });

                        if (dockTarget.host === 'viewport' && preferredActiveTab) {
                            this.setViewportDockTab(preferredActiveTab, false);
                            this.setActivePanel('viewport-panel');
                        } else if (dockTarget.host === 'bottom' && preferredActiveTab) {
                            this.setBottomTab(preferredActiveTab, false);
                            this.setActivePanel('assets-panel');
                        } else if (dockTarget.host === 'hierarchy' && preferredActiveTab) {
                            this.setHierarchyTab(preferredActiveTab, false);
                            this.setActivePanel('hierarchy-panel');
                        } else if (dockTarget.host === 'inspector' && preferredActiveTab) {
                            this.setInspectorTab(preferredActiveTab, false);
                            this.setActivePanel('inspector-panel');
                        }
                        didDockToHost = true;
                    } else if (dockTarget.slot && panelId !== 'assets-panel') {
                        EditorSettings.sidePanelSlots = this.normalizeSidePanelSlots({
                            ...EditorSettings.sidePanelSlots,
                            [panelId]: dockTarget.slot
                        });
                        this.syncLegacyPanelWidthsFromSideSlots();
                        didDockToHost = true;
                    }

                    if (didDockToHost) {
                        const current = this.ensureFloatingPanelState(panelId);
                        EditorSettings.floatingPanels[panelId] = { ...current, floating: false };
                        this.restoreDockedPanel(panelId);
                        this.finalizeLayoutMutation({ updatedPanelId: panelId });
                        return;
                    }
                }

                this.saveLayout();
            };

            header.addEventListener('pointermove', handleMove);
            header.addEventListener('pointerup', handleUp);
        });
    }

    private beginFloatingResize(
        event: PointerEvent,
        panelId: Exclude<EditorPanelId, 'viewport-panel'>
    ) {
        if (!this.isPanelFloating(panelId)) return;

        const panel = document.getElementById(panelId) as HTMLElement | null;
        if (!panel) return;

        event.preventDefault();
        event.stopPropagation();
        panel.classList.add('floating-panel-resizing');

        this.floatingPanelResizeState = {
            panelId,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originWidth: panel.offsetWidth,
            originHeight: panel.offsetHeight
        };

        const handleMove = (moveEvent: PointerEvent) => {
            if (!this.floatingPanelResizeState || this.floatingPanelResizeState.pointerId !== moveEvent.pointerId) return;
            this.updateFloatingPanelSize(
                panelId,
                this.floatingPanelResizeState.originWidth + (moveEvent.clientX - this.floatingPanelResizeState.startX),
                this.floatingPanelResizeState.originHeight + (moveEvent.clientY - this.floatingPanelResizeState.startY)
            );
        };

        const handleUp = (upEvent: PointerEvent) => {
            if (!this.floatingPanelResizeState || this.floatingPanelResizeState.pointerId !== upEvent.pointerId) return;
            this.floatingPanelResizeState = null;
            panel.classList.remove('floating-panel-resizing');
            document.removeEventListener('pointermove', handleMove);
            document.removeEventListener('pointerup', handleUp);
            this.saveLayout();
        };

        document.addEventListener('pointermove', handleMove);
        document.addEventListener('pointerup', handleUp);
    }

    private isPanelFloating(panelId: EditorPanelId): boolean {
        return Boolean(EditorSettings.floatingPanels[panelId]?.floating);
    }

    private isPanelDockedVisible(panelId: Exclude<EditorPanelId, 'viewport-panel'>): boolean {
        return this.getPanelVisibleSetting(panelId) && !this.isPanelFloating(panelId);
    }

    private getPanelVisibleSetting(panelId: Exclude<EditorPanelId, 'viewport-panel'>): boolean {
        if (panelId === 'hierarchy-panel') return EditorSettings.hierarchyVisible;
        if (panelId === 'inspector-panel') return EditorSettings.inspectorVisible;
        return EditorSettings.assetsVisible;
    }

    private ensureFloatingPanelState(
        panelId: Exclude<EditorPanelId, 'viewport-panel'>
    ): EditorFloatingPanelState {
        const existing = EditorSettings.floatingPanels[panelId];
        const normalized = this.normalizeFloatingPanelState(panelId, existing);
        EditorSettings.floatingPanels[panelId] = normalized;
        return normalized;
    }

    private normalizeFloatingPanelState(
        panelId: Exclude<EditorPanelId, 'viewport-panel'>,
        state?: Partial<EditorFloatingPanelState>
    ): EditorFloatingPanelState {
        const floatingLayer = document.getElementById('floating-layer') as HTMLElement | null;
        const layerWidth = Math.max(400, floatingLayer?.clientWidth ?? 1200);
        const layerHeight = Math.max(300, floatingLayer?.clientHeight ?? 700);
        const defaults = this.getDefaultFloatingPanelState(panelId, layerWidth, layerHeight);

        const width = THREE.MathUtils.clamp(
            state?.width ?? defaults.width,
            panelId === 'assets-panel' ? 420 : 220,
            layerWidth
        );
        const height = THREE.MathUtils.clamp(
            state?.height ?? defaults.height,
            this.minAssetsHeight,
            layerHeight
        );
        const x = THREE.MathUtils.clamp(state?.x ?? defaults.x, 0, Math.max(0, layerWidth - width));
        const y = THREE.MathUtils.clamp(state?.y ?? defaults.y, 0, Math.max(0, layerHeight - height));

        return {
            floating: state?.floating ?? false,
            x,
            y,
            width,
            height
        };
    }

    private getDefaultFloatingPanelState(
        panelId: Exclude<EditorPanelId, 'viewport-panel'>,
        layerWidth: number,
        layerHeight: number
    ): EditorFloatingPanelState {
        if (panelId === 'hierarchy-panel') {
            return { floating: false, x: 32, y: 36, width: 280, height: Math.min(460, layerHeight - 48) };
        }
        if (panelId === 'inspector-panel') {
            return {
                floating: false,
                x: Math.max(24, layerWidth - 360),
                y: 36,
                width: 340,
                height: Math.min(520, layerHeight - 48)
            };
        }
        return {
            floating: false,
            x: Math.max(24, Math.round((layerWidth - 720) / 2)),
            y: Math.max(40, layerHeight - 320),
            width: Math.min(760, layerWidth - 48),
            height: 260
        };
    }

    private applyFloatingPanelStates() {
        this.floatablePanels.forEach((panelId) => {
            if (this.isPanelFloating(panelId)) {
                this.floatPanel(panelId);
            } else {
                this.restoreDockedPanel(panelId);
            }
        });
    }

    private floatPanel(panelId: Exclude<EditorPanelId, 'viewport-panel'>) {
        const panel = document.getElementById(panelId) as HTMLElement | null;
        const floatingLayer = document.getElementById('floating-layer') as HTMLElement | null;
        if (!panel || !floatingLayer) return;

        const state = this.ensureFloatingPanelState(panelId);
        if (panel.parentElement !== floatingLayer) {
            floatingLayer.appendChild(panel);
        }

        panel.classList.add('floating-panel');
        panel.tabIndex = 0;
        this.bringFloatingPanelToFront(panelId);
        panel.style.left = `${state.x}px`;
        panel.style.top = `${state.y}px`;
        panel.style.width = `${state.width}px`;
        panel.style.height = `${state.height}px`;
        panel.style.flex = '0 0 auto';
        this.updatePanelWindowActions(panelId);
        this.updateFloatingPanelActiveState();
    }

    private restoreDockedPanel(panelId: Exclude<EditorPanelId, 'viewport-panel'>) {
        const panel = document.getElementById(panelId) as HTMLElement | null;
        if (!panel) return;

        if (panelId === 'assets-panel') {
            const mount = this.panelDockMounts[panelId];
            const parent = document.getElementById(mount.parentId) as HTMLElement | null;
            const nextSibling = mount.nextSiblingId ? document.getElementById(mount.nextSiblingId) : null;
            if (!parent) return;

            if (panel.parentElement !== parent) {
                parent.insertBefore(panel, nextSibling);
            }
        } else {
            const mainArea = document.getElementById('main-area') as HTMLElement | null;
            if (!mainArea) return;
            if (panel.parentElement !== mainArea) {
                mainArea.appendChild(panel);
            }
            this.applySidePanelDockLayout();
        }

        panel.classList.remove('floating-panel');
        panel.classList.remove('floating-panel-focus-within');
        panel.removeAttribute('tabindex');
        panel.style.zIndex = '';
        panel.style.left = '';
        panel.style.top = '';
        panel.style.width = '';
        panel.style.height = '';
        panel.style.flex = '';
        this.updatePanelWindowActions(panelId);
        this.updateFloatingPanelActiveState();
    }

    private bringFloatingPanelToFront(panelId: Exclude<EditorPanelId, 'viewport-panel'>) {
        const panel = document.getElementById(panelId) as HTMLElement | null;
        if (!panel) return;
        this.floatingZCounter += 1;
        panel.style.zIndex = String(this.floatingZCounter);
    }

    private updateFloatingDockGuides(
        panelId: Exclude<EditorPanelId, 'viewport-panel'>,
        clientX: number,
        clientY: number
    ) {
        let nextActiveTarget: typeof this.activeFloatingDockTarget = null;

        this.getFloatingDockTargets(panelId).forEach((candidateTarget) => {
            const guide = document.getElementById(this.getFloatingDockGuideId(candidateTarget)) as HTMLElement | null;
            if (!guide) return;

            const rect = this.getFloatingDockGuideRect(candidateTarget);
            guide.style.left = `${rect.x}px`;
            guide.style.top = `${rect.y}px`;
            guide.style.width = `${rect.width}px`;
            guide.style.height = `${rect.height}px`;
            guide.classList.add('visible');

            const floatingLayer = document.getElementById('floating-layer') as HTMLElement | null;
            const layerRect = floatingLayer?.getBoundingClientRect();
            const localX = layerRect ? clientX - layerRect.left : 0;
            const localY = layerRect ? clientY - layerRect.top : 0;
            const isActive =
                localX >= rect.x &&
                localX <= rect.x + rect.width &&
                localY >= rect.y &&
                localY <= rect.y + rect.height;

            guide.classList.toggle('active', isActive);
            if (isActive) {
                nextActiveTarget = candidateTarget;
            }
        });

        this.activeFloatingDockTarget = nextActiveTarget;
        if (nextActiveTarget) {
            this.showFloatingDockPreview(nextActiveTarget);
        } else {
            this.hideFloatingDockPreview();
        }
    }

    private clearFloatingDockGuides() {
        this.activeFloatingDockTarget = null;
        this.getFloatingDockTargets().forEach((target) => {
            document.getElementById(this.getFloatingDockGuideId(target))?.classList.remove('visible', 'active');
        });
        this.hideFloatingDockPreview();
    }

    private getFloatingDockGuideRect(target: FloatingDockTarget) {
        const floatingLayer = document.getElementById('floating-layer') as HTMLElement | null;
        const width = Math.max(400, floatingLayer?.clientWidth ?? 1200);
        const height = Math.max(300, floatingLayer?.clientHeight ?? 700);

        if (target.host === 'viewport') {
            const guideWidth = Math.min(280, Math.max(180, width * 0.22));
            const guideHeight = Math.min(180, Math.max(120, height * 0.18));
            return {
                x: Math.round((width - guideWidth) * 0.5),
                y: Math.round((height - guideHeight) * 0.45),
                width: guideWidth,
                height: guideHeight
            };
        }

        if (target.host === 'bottom') {
            const guideWidth = Math.min(280, Math.max(180, width * 0.24));
            const guideHeight = Math.min(110, Math.max(84, height * 0.12));
            return {
                x: Math.round((width - guideWidth) * 0.5),
                y: height - guideHeight - 14,
                width: guideWidth,
                height: guideHeight
            };
        }

        if (target.host === 'hierarchy' || target.host === 'inspector') {
            const targetSlot = this.getSidePanelSlot(target.host === 'hierarchy' ? 'hierarchy-panel' : 'inspector-panel');
            const guideWidth = Math.min(170, Math.max(128, width * 0.14));
            const guideHeight = Math.min(120, Math.max(84, height * 0.14));
            const x = targetSlot === 'left'
                ? Math.max(12, Math.round(guideWidth * 0.18))
                : width - guideWidth - Math.max(12, Math.round(guideWidth * 0.18));
            return {
                x,
                y: Math.round((height - guideHeight) * 0.42),
                width: guideWidth,
                height: guideHeight
            };
        }

        if (target.slot === 'left') {
            return { x: 10, y: 12, width: Math.min(180, Math.max(140, width * 0.18)), height: Math.max(140, height - 24) };
        }
        if (target.slot === 'right') {
            const guideWidth = Math.min(200, Math.max(150, width * 0.2));
            return { x: width - guideWidth - 10, y: 12, width: guideWidth, height: Math.max(140, height - 24) };
        }

        return {
            x: 12,
            y: Math.max(24, height - Math.min(180, Math.max(140, height * 0.25)) - 10),
            width: Math.max(220, width - 24),
            height: Math.min(180, Math.max(140, height * 0.25))
        };
    }

    private showFloatingDockPreview(target: FloatingDockTarget) {
        const preview = document.getElementById('floating-dock-preview') as HTMLElement | null;
        const floatingLayer = document.getElementById('floating-layer') as HTMLElement | null;
        if (!preview || !floatingLayer) return;

        const rect = this.getFloatingDockPreviewRect(target);
        preview.style.left = `${rect.x}px`;
        preview.style.top = `${rect.y}px`;
        preview.style.width = `${rect.width}px`;
        preview.style.height = `${rect.height}px`;
        preview.classList.add('visible');
    }

    private hideFloatingDockPreview() {
        document.getElementById('floating-dock-preview')?.classList.remove('visible');
    }

    private getFloatingDockPreviewRect(target: FloatingDockTarget) {
        const floatingLayer = document.getElementById('floating-layer') as HTMLElement | null;
        const layerRect = floatingLayer?.getBoundingClientRect();
        const mainArea = document.getElementById('main-area') as HTMLElement | null;
        const viewportPanel = document.getElementById('viewport-panel') as HTMLElement | null;
        const assetsPanel = document.getElementById('assets-panel') as HTMLElement | null;
        const hierarchyPanel = document.getElementById('hierarchy-panel') as HTMLElement | null;
        const inspectorPanel = document.getElementById('inspector-panel') as HTMLElement | null;

        const fallback = this.getFloatingDockGuideRect(target);
        if (!layerRect || !mainArea || !viewportPanel) return fallback;

        const mainRect = mainArea.getBoundingClientRect();
        const viewportRect = viewportPanel.getBoundingClientRect();
        const hierarchyRect = hierarchyPanel?.getBoundingClientRect();
        const inspectorRect = inspectorPanel?.getBoundingClientRect();
        const assetsRect = assetsPanel?.getBoundingClientRect();

        if (target.host === 'viewport') {
            return {
                x: viewportRect.left - layerRect.left,
                y: viewportRect.top - layerRect.top,
                width: viewportRect.width,
                height: viewportRect.height
            };
        }

        if (target.host === 'bottom') {
            const height = this.isPanelDockedVisible('assets-panel')
                ? (assetsRect?.height ?? EditorSettings.assetsHeight)
                : EditorSettings.assetsHeight;
            const width = assetsRect?.width ?? Math.max(mainRect.width, viewportRect.width + (hierarchyRect?.width ?? 0) + (inspectorRect?.width ?? 0));
            return {
                x: (assetsRect?.left ?? mainRect.left) - layerRect.left,
                y: (assetsRect?.top ?? (mainRect.bottom - height)) - layerRect.top,
                width,
                height
            };
        }

        if (target.host === 'hierarchy' || target.host === 'inspector') {
            const targetPanelRect = target.host === 'hierarchy' ? hierarchyRect : inspectorRect;
            const targetSlot = this.getSidePanelSlot(target.host === 'hierarchy' ? 'hierarchy-panel' : 'inspector-panel');
            const fallbackWidth = this.getSideSlotWidth(targetSlot);
            return {
                x: (targetPanelRect?.left ?? (targetSlot === 'left' ? mainRect.left : mainRect.right - fallbackWidth)) - layerRect.left,
                y: mainRect.top - layerRect.top,
                width: targetPanelRect?.width ?? fallbackWidth,
                height: mainRect.height
            };
        }

        if (target.slot) {
            const targetPanelId = target.panelId === 'assets-panel'
                ? this.getPanelIdForSideSlot(target.slot)
                : target.panelId;
            const sideSlot = target.slot;
            const panelRect = targetPanelId === 'hierarchy-panel' ? hierarchyRect : inspectorRect;
            const width = this.isPanelDockedVisible(targetPanelId)
                ? (panelRect?.width ?? this.getSideSlotWidth(sideSlot))
                : this.getSideSlotWidth(sideSlot);

            if (sideSlot === 'left') {
                return {
                    x: mainRect.left - layerRect.left,
                    y: mainRect.top - layerRect.top,
                    width,
                    height: mainRect.height
                };
            }

            return {
                x: mainRect.right - layerRect.left - width,
                y: mainRect.top - layerRect.top,
                width,
                height: mainRect.height
            };
        }

        const height = this.isPanelDockedVisible('assets-panel')
            ? (assetsRect?.height ?? EditorSettings.assetsHeight)
            : EditorSettings.assetsHeight;
        const width = Math.max(mainRect.width, viewportRect.width + (hierarchyRect?.width ?? 0) + (inspectorRect?.width ?? 0));
        return {
            x: (assetsRect?.left ?? mainRect.left) - layerRect.left,
            y: (assetsRect?.top ?? (mainRect.bottom - height)) - layerRect.top,
            width: assetsRect?.width ?? width,
            height
        };
    }

    private updateFloatingPanelPosition(
        panelId: Exclude<EditorPanelId, 'viewport-panel'>,
        x: number,
        y: number
    ) {
        const state = this.ensureFloatingPanelState(panelId);
        const normalized = this.normalizeFloatingPanelState(panelId, { ...state, x, y, floating: true });
        EditorSettings.floatingPanels[panelId] = normalized;
        const panel = document.getElementById(panelId) as HTMLElement | null;
        if (!panel) return;

        panel.style.left = `${normalized.x}px`;
        panel.style.top = `${normalized.y}px`;
    }

    private updateFloatingPanelSize(
        panelId: Exclude<EditorPanelId, 'viewport-panel'>,
        width: number,
        height: number
    ) {
        const state = this.ensureFloatingPanelState(panelId);
        const normalized = this.normalizeFloatingPanelState(panelId, { ...state, width, height, floating: true });
        EditorSettings.floatingPanels[panelId] = normalized;
        const panel = document.getElementById(panelId) as HTMLElement | null;
        if (!panel) return;

        panel.style.width = `${normalized.width}px`;
        panel.style.height = `${normalized.height}px`;
        this.resize();
    }

    private tryRestoreFloatingDockableViewsToHome(): boolean {
        if (!this.isPanelFloating('assets-panel')) return false;

        const floatingTabs = [...EditorSettings.bottomTabOrder];
        const tabsToRestore = floatingTabs.filter((tab) => {
            const homeHost = this.floatingDockableHomeHosts[tab];
            return Boolean(homeHost && homeHost !== 'bottom');
        });
        if (tabsToRestore.length === 0) return false;

        const current = this.ensureFloatingPanelState('assets-panel');
        EditorSettings.floatingPanels['assets-panel'] = { ...current, floating: false };
        const preferredActiveTab = tabsToRestore.includes(this.activeBottomTab) ? this.activeBottomTab : tabsToRestore[0];

        tabsToRestore.forEach((tab) => {
            const homeHost = this.floatingDockableHomeHosts[tab];
            if (!homeHost || homeHost === 'bottom') return;
            this.moveDockableTabToHost(tab, homeHost, undefined, { deferLayout: true });
            delete this.floatingDockableHomeHosts[tab];
        });

        this.restoreDockedPanel('assets-panel');
        const hasRemainingBottomTabs = EditorSettings.bottomTabOrder.length > 0;
        this.setPanelVisibility('assets-panel', hasRemainingBottomTabs, false);

        if (hasRemainingBottomTabs) {
            const nextBottomTab = EditorSettings.bottomTabOrder.includes(this.activeBottomTab)
                ? this.activeBottomTab
                : EditorSettings.bottomTabOrder[0];
            this.setBottomTab(nextBottomTab, false);
            this.setActivePanel('assets-panel');
        } else {
            const restoredHost = this.getViewHost(preferredActiveTab);
            if (restoredHost === 'viewport') {
                this.setViewportDockTab(preferredActiveTab, false);
                this.setActivePanel('viewport-panel');
            } else if (restoredHost === 'hierarchy') {
                this.setHierarchyTab(preferredActiveTab, false);
                this.setActivePanel('hierarchy-panel');
            } else if (restoredHost === 'inspector') {
                this.setInspectorTab(preferredActiveTab, false);
                this.setActivePanel('inspector-panel');
            }
        }

        this.finalizeLayoutMutation({ updatedPanelId: 'assets-panel' });
        return true;
    }

    private getDetachedViewCount(): number {
        return (['project', 'console', 'render'] as DockableEditorView[]).filter((tab) => {
            const homeHost = this.floatingDockableHomeHosts[tab];
            return Boolean(homeHost && homeHost !== this.getViewHost(tab));
        }).length;
    }

    private isDockableViewDetached(view: DockableEditorView): boolean {
        const homeHost = this.floatingDockableHomeHosts[view];
        return Boolean(homeHost && homeHost !== this.getViewHost(view));
    }

    private getRestorableActiveDockableView(): DockableEditorView | null {
        const activeView = this.getActiveDockableView();
        return activeView && this.isDockableViewDetached(activeView) ? activeView : null;
    }

    private restoreDockableViewToHome(view: DockableEditorView) {
        const homeHost = this.floatingDockableHomeHosts[view];
        if (!homeHost || homeHost === this.getViewHost(view)) return;

        this.moveDockableTabToHost(view, homeHost, undefined, { deferLayout: true });
        delete this.floatingDockableHomeHosts[view];

        if (homeHost === 'viewport') {
            this.setViewportDockTab(view, false);
            this.setActivePanel('viewport-panel');
        } else if (homeHost === 'hierarchy') {
            this.setHierarchyTab(view, false);
            this.setActivePanel('hierarchy-panel');
        } else if (homeHost === 'inspector') {
            this.setInspectorTab(view, false);
            this.setActivePanel('inspector-panel');
        } else {
            this.setBottomTab(view, false);
            this.setActivePanel('assets-panel');
        }
    }

    private restoreActiveDetachedView() {
        const activeView = this.getRestorableActiveDockableView();
        if (!activeView) return;

        this.restoreDockableViewToHome(activeView);
        this.finalizeLayoutMutation({ updatedPanelId: 'assets-panel' });
    }

    private restoreDetachedViews() {
        const detachedViews = (['project', 'console', 'render'] as DockableEditorView[]).filter((tab) => {
            const homeHost = this.floatingDockableHomeHosts[tab];
            return Boolean(homeHost && homeHost !== this.getViewHost(tab));
        });
        if (detachedViews.length === 0) return;

        const preferredActiveTab = detachedViews.includes(this.activeBottomTab) ? this.activeBottomTab : detachedViews[0];
        const preferredTargetHost = this.floatingDockableHomeHosts[preferredActiveTab];

        detachedViews.forEach((tab) => {
            const homeHost = this.floatingDockableHomeHosts[tab];
            if (!homeHost || homeHost === this.getViewHost(tab)) return;
            this.moveDockableTabToHost(tab, homeHost, undefined, { deferLayout: true });
            delete this.floatingDockableHomeHosts[tab];
        });

        if (this.isPanelFloating('assets-panel')) {
            const current = this.ensureFloatingPanelState('assets-panel');
            EditorSettings.floatingPanels['assets-panel'] = { ...current, floating: false };
            this.restoreDockedPanel('assets-panel');
        }

        if (EditorSettings.bottomTabOrder.length === 0) {
            this.setPanelVisibility('assets-panel', false, false);
        } else {
            const nextBottomTab = EditorSettings.bottomTabOrder.includes(this.activeBottomTab)
                ? this.activeBottomTab
                : EditorSettings.bottomTabOrder[0];
            this.setBottomTab(nextBottomTab, false);
        }

        if (preferredTargetHost === 'viewport') {
            this.setViewportDockTab(preferredActiveTab, false);
            this.setActivePanel('viewport-panel');
        } else if (preferredTargetHost === 'hierarchy') {
            this.setHierarchyTab(preferredActiveTab, false);
            this.setActivePanel('hierarchy-panel');
        } else if (preferredTargetHost === 'inspector') {
            this.setInspectorTab(preferredActiveTab, false);
            this.setActivePanel('inspector-panel');
        }

        this.finalizeLayoutMutation({ updatedPanelId: 'assets-panel' });
    }

    private toggleFloatingPanel(panelId: EditorPanelId = this.activePanelId) {
        if (panelId === 'viewport-panel') return;
        if (this.maximizedPanelId) this.restoreMaximizedPanel();

        const nextFloating = !this.isPanelFloating(panelId);
        if (!nextFloating && panelId === 'assets-panel' && this.tryRestoreFloatingDockableViewsToHome()) {
            return;
        }
        const current = this.ensureFloatingPanelState(panelId);
        EditorSettings.floatingPanels[panelId] = { ...current, floating: nextFloating };

        if (nextFloating) {
            this.floatPanel(panelId);
        } else {
            this.restoreDockedPanel(panelId);
        }

        this.finalizeLayoutMutation({ updatedPanelId: panelId });
    }

    private dockAllFloatingPanels() {
        if (this.maximizedPanelId) this.restoreMaximizedPanel();

        let changed = false;
        this.floatablePanels.forEach((panelId) => {
            if (!this.isPanelFloating(panelId)) return;
            if (panelId === 'assets-panel' && this.tryRestoreFloatingDockableViewsToHome()) {
                changed = true;
                return;
            }
            const current = this.ensureFloatingPanelState(panelId);
            EditorSettings.floatingPanels[panelId] = { ...current, floating: false };
            this.restoreDockedPanel(panelId);
            this.updatePanelWindowActions(panelId);
            changed = true;
        });

        if (!changed) return;

        this.finalizeLayoutMutation();
    }

    private floatDockableView(view: DockableEditorView) {
        if (this.maximizedPanelId) this.restoreMaximizedPanel();

        const currentHost = this.getViewHost(view);
        if (currentHost !== 'bottom') {
            this.moveDockableTabToHost(view, 'bottom', undefined, { deferLayout: true });
            this.floatingDockableHomeHosts[view] = currentHost;
        } else {
            delete this.floatingDockableHomeHosts[view];
            if (!EditorSettings.assetsVisible) {
                this.setPanelVisibility('assets-panel', true, false);
            }
        }

        if (currentHost !== 'bottom' && !EditorSettings.assetsVisible) {
            this.setPanelVisibility('assets-panel', true, false);
        }

        this.activeBottomTab = view;
        this.setActivePanel('assets-panel');

        const current = this.ensureFloatingPanelState('assets-panel');
        EditorSettings.floatingPanels['assets-panel'] = { ...current, floating: true };
        this.floatPanel('assets-panel');

        this.finalizeLayoutMutation({ updatedPanelId: 'assets-panel' });
    }

    private floatActiveDockableView() {
        const activeView = this.getActiveDockableView();
        if (!activeView) return;
        this.floatDockableView(activeView);
    }

    private initializeSplitters() {
        this.bindSplitter('left-splitter', 'col-resize', (event, start, panelId) => {
            if (panelId === 'assets-panel' || panelId === 'center-secondary-panel') return;
            const sidePanelId = panelId as 'hierarchy-panel' | 'inspector-panel';
            const maxWidth = this.getMaxSidePanelWidth(sidePanelId);
            this.setSidePanelWidth(sidePanelId, THREE.MathUtils.clamp(
                start.size + (event.clientX - start.x),
                this.getMinSidePanelWidth(sidePanelId),
                maxWidth
            ));
            this.applyPanelWidths();
            this.clampLayoutSizes();
            this.resize();
        });

        this.bindSplitter('right-splitter', 'col-resize', (event, start, panelId) => {
            if (panelId === 'assets-panel' || panelId === 'center-secondary-panel') return;
            const sidePanelId = panelId as 'hierarchy-panel' | 'inspector-panel';
            const maxWidth = this.getMaxSidePanelWidth(sidePanelId);
            this.setSidePanelWidth(sidePanelId, THREE.MathUtils.clamp(
                start.size - (event.clientX - start.x),
                this.getMinSidePanelWidth(sidePanelId),
                maxWidth
            ));
            this.applyPanelWidths();
            this.clampLayoutSizes();
            this.resize();
        });

        this.bindSplitter('bottom-splitter', 'row-resize', (event, start) => {
            const maxHeight = this.getMaxAssetsHeight();
            EditorSettings.assetsHeight = THREE.MathUtils.clamp(
                start.size - (event.clientY - start.y),
                this.minAssetsHeight,
                maxHeight
            );
            this.applyPanelWidths();
            this.clampLayoutSizes();
            this.resize();
        });

        this.bindSplitter('center-secondary-splitter', 'col-resize', (event, start) => {
            const viewportWorkspace = document.getElementById('viewport-workspace') as HTMLElement | null;
            if (!viewportWorkspace) return;
            const reservedForTertiary = this.isCenterTertiaryVisible() ? EditorSettings.centerTertiaryWidth + 4 : 0;
            const maxWidth = Math.max(this.minCenterSecondaryWidth, viewportWorkspace.clientWidth - this.minViewportWidth - reservedForTertiary - 4);
            EditorSettings.centerSecondaryWidth = THREE.MathUtils.clamp(
                start.size - (event.clientX - start.x),
                this.minCenterSecondaryWidth,
                maxWidth
            );
            this.applyPanelWidths();
            this.clampLayoutSizes();
            this.resize();
        });

        this.bindSplitter('center-tertiary-splitter', 'col-resize', (event, start) => {
            const viewportWorkspace = document.getElementById('viewport-workspace') as HTMLElement | null;
            if (!viewportWorkspace) return;
            const reservedForSecondary = this.isCenterSecondaryVisible() ? EditorSettings.centerSecondaryWidth + 4 : 0;
            const maxWidth = Math.max(this.minCenterTertiaryWidth, viewportWorkspace.clientWidth - this.minViewportWidth - reservedForSecondary - 4);
            EditorSettings.centerTertiaryWidth = THREE.MathUtils.clamp(
                start.size - (event.clientX - start.x),
                this.minCenterTertiaryWidth,
                maxWidth
            );
            this.applyPanelWidths();
            this.clampLayoutSizes();
            this.resize();
        });
    }

    private bindSplitter(
        splitterId: string,
        cursor: string,
        onMove: (
            event: PointerEvent,
            start: { x: number; y: number; size: number },
            targetId: Exclude<EditorPanelId, 'viewport-panel'> | 'center-secondary-panel' | 'center-tertiary-panel'
        ) => void
    ) {
        const splitter = document.getElementById(splitterId) as HTMLElement | null;
        if (!splitter) return;

        const getTargetId = () => splitterId === 'left-splitter'
            ? this.getDockedPanelIdForSideSlot('left')
            : splitterId === 'right-splitter'
                ? this.getDockedPanelIdForSideSlot('right')
                : splitterId === 'center-secondary-splitter'
                    ? 'center-secondary-panel' as const
                : splitterId === 'center-tertiary-splitter'
                    ? 'center-tertiary-panel' as const
                : 'assets-panel' as const;
        const getTargetSize = (targetId: Exclude<EditorPanelId, 'viewport-panel'> | 'center-secondary-panel' | 'center-tertiary-panel') => {
            if (targetId === 'assets-panel') return EditorSettings.assetsHeight;
            if (targetId === 'center-secondary-panel') return EditorSettings.centerSecondaryWidth;
            if (targetId === 'center-tertiary-panel') return EditorSettings.centerTertiaryWidth;
            return this.getSidePanelWidth(targetId);
        };
        const syncSeparatorValue = () => {
            const targetId = getTargetId();
            if (!targetId) return;
            splitter.setAttribute('aria-valuenow', String(Math.round(getTargetSize(targetId))));
            const minimum = targetId === 'assets-panel'
                ? this.minAssetsHeight
                : targetId === 'center-secondary-panel'
                    ? this.minCenterSecondaryWidth
                    : targetId === 'center-tertiary-panel'
                        ? this.minCenterTertiaryWidth
                        : this.getMinSidePanelWidth(targetId);
            splitter.setAttribute('aria-valuemin', String(Math.round(minimum)));
        };

        splitter.setAttribute('role', 'separator');
        splitter.setAttribute('aria-orientation', cursor === 'row-resize' ? 'horizontal' : 'vertical');
        splitter.setAttribute('aria-label', cursor === 'row-resize' ? 'Resize bottom panel' : 'Resize editor panels');
        splitter.tabIndex = 0;
        syncSeparatorValue();
        splitter.addEventListener('keydown', (event: KeyboardEvent) => {
            const horizontal = cursor === 'row-resize';
            const handledArrow = horizontal
                ? event.key === 'ArrowUp' || event.key === 'ArrowDown'
                : event.key === 'ArrowLeft' || event.key === 'ArrowRight';
            if (!handledArrow && event.key !== 'Home' && event.key !== 'End') return;

            const targetId = getTargetId();
            if (!targetId) return;
            const panel = document.getElementById(targetId) as HTMLElement | null;
            if (!panel) return;

            event.preventDefault();
            const currentSize = getTargetSize(targetId);
            const step = event.shiftKey ? 50 : 10;
            let delta = 0;
            const inverted = splitterId !== 'left-splitter';
            if (event.key === 'Home') delta = inverted ? 100000 : -100000;
            if (event.key === 'End') delta = inverted ? -100000 : 100000;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') delta = -step;
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') delta = step;

            onMove(new PointerEvent('pointermove', {
                clientX: horizontal ? 0 : delta,
                clientY: horizontal ? delta : 0
            }), { x: 0, y: 0, size: currentSize }, targetId);
            syncSeparatorValue();
            this.saveLayout();
        });

        splitter.addEventListener('pointerdown', (event: PointerEvent) => {
            const targetId = getTargetId();
            if (!targetId) return;
            const panel = document.getElementById(targetId) as HTMLElement | null;
            if (!panel) return;

            event.preventDefault();
            splitter.classList.add('dragging');

            const start = {
                x: event.clientX,
                y: event.clientY,
                size: splitterId === 'bottom-splitter' ? panel.offsetHeight : panel.offsetWidth
            };

            const previousCursor = document.body.style.cursor;
            const previousUserSelect = document.body.style.userSelect;
            document.body.style.cursor = cursor;
            document.body.style.userSelect = 'none';

            const handleMove = (moveEvent: PointerEvent) => onMove(moveEvent, start, targetId);
            const handleUp = () => {
                splitter.classList.remove('dragging');
                document.body.style.cursor = previousCursor;
                document.body.style.userSelect = previousUserSelect;
                document.removeEventListener('pointermove', handleMove);
                document.removeEventListener('pointerup', handleUp);
                syncSeparatorValue();
                this.saveLayout();
            };

            document.addEventListener('pointermove', handleMove);
            document.addEventListener('pointerup', handleUp);
        });
    }

    private setPanelVisibility(id: string, visible: boolean, save: boolean = true) {
        const panel = document.getElementById(id) as HTMLElement | null;
        if (!panel) return;

        if (id === 'hierarchy-panel') EditorSettings.hierarchyVisible = visible;
        if (id === 'inspector-panel') EditorSettings.inspectorVisible = visible;
        if (id === 'assets-panel') EditorSettings.assetsVisible = visible;

        panel.style.display = visible ? 'flex' : 'none';

        this.updateSplitterVisibility();
        this.clampLayoutSizes();
        this.syncWindowMenuState();

        if (save) this.saveLayout();
    }

    private updateSplitterVisibility() {
        const leftSplitter = document.getElementById('left-splitter') as HTMLElement | null;
        const rightSplitter = document.getElementById('right-splitter') as HTMLElement | null;
        const bottomSplitter = document.getElementById('bottom-splitter') as HTMLElement | null;
        const centerSecondarySplitter = document.getElementById('center-secondary-splitter') as HTMLElement | null;
        const centerTertiarySplitter = document.getElementById('center-tertiary-splitter') as HTMLElement | null;
        const hasLeftDockedPanel = !!this.getDockedPanelIdForSideSlot('left');
        const hasRightDockedPanel = !!this.getDockedPanelIdForSideSlot('right');
        const hasBottomDockedPanel = this.isPanelDockedVisible('assets-panel');
        const hasCenterSecondary = this.isCenterSecondaryVisible();
        const hasCenterTertiary = this.isCenterTertiaryVisible();

        if (leftSplitter) leftSplitter.style.display = hasLeftDockedPanel ? 'block' : 'none';
        if (rightSplitter) rightSplitter.style.display = hasRightDockedPanel ? 'block' : 'none';
        if (bottomSplitter) bottomSplitter.style.display = hasBottomDockedPanel ? 'block' : 'none';
        if (centerSecondarySplitter) centerSecondarySplitter.style.display = hasCenterSecondary ? 'block' : 'none';
        if (centerTertiarySplitter) centerTertiarySplitter.style.display = hasCenterSecondary && hasCenterTertiary ? 'block' : 'none';
    }

    private clampLayoutSizes() {
        const mainArea = document.getElementById('main-area') as HTMLElement | null;
        if (mainArea) {
            const splitterAllowance =
                (this.isPanelDockedVisible('hierarchy-panel') ? 4 : 0) +
                (this.isPanelDockedVisible('inspector-panel') ? 4 : 0);
            const totalSideSpace = Math.max(0, mainArea.clientWidth - splitterAllowance - this.minViewportWidth);
            const leftPanelId = this.getDockedPanelIdForSideSlot('left');
            const rightPanelId = this.getDockedPanelIdForSideSlot('right');

            if (leftPanelId) {
                const maxLeft = Math.max(
                    this.getMinSidePanelWidth(leftPanelId),
                    totalSideSpace - (rightPanelId ? this.getMinSidePanelWidth(rightPanelId) : 0)
                );
                EditorSettings.sidePanelWidths.left = THREE.MathUtils.clamp(
                    EditorSettings.sidePanelWidths.left,
                    this.getMinSidePanelWidth(leftPanelId),
                    maxLeft
                );
            }

            if (rightPanelId) {
                const maxRight = Math.max(
                    this.getMinSidePanelWidth(rightPanelId),
                    totalSideSpace - (leftPanelId ? EditorSettings.sidePanelWidths.left : 0)
                );
                EditorSettings.sidePanelWidths.right = THREE.MathUtils.clamp(
                    EditorSettings.sidePanelWidths.right,
                    this.getMinSidePanelWidth(rightPanelId),
                    maxRight
                );
            }

            this.syncLegacyPanelWidthsFromSideSlots();
            this.applyPanelWidths();
        }

        const viewportWorkspace = document.getElementById('viewport-workspace') as HTMLElement | null;
        if (viewportWorkspace && (this.isCenterSecondaryVisible() || this.isCenterTertiaryVisible())) {
            const hasCenterSecondary = this.isCenterSecondaryVisible();
            const hasCenterTertiary = this.isCenterTertiaryVisible();
            const splitterAllowance =
                (hasCenterSecondary ? 4 : 0) +
                (hasCenterSecondary && hasCenterTertiary ? 4 : 0);
            const availableDockWidth = Math.max(0, viewportWorkspace.clientWidth - this.minViewportWidth - splitterAllowance);

            if (hasCenterTertiary) {
                const maxCenterTertiaryWidth = Math.max(
                    this.minCenterTertiaryWidth,
                    availableDockWidth - (hasCenterSecondary ? this.minCenterSecondaryWidth : 0)
                );
                EditorSettings.centerTertiaryWidth = THREE.MathUtils.clamp(
                    EditorSettings.centerTertiaryWidth,
                    this.minCenterTertiaryWidth,
                    maxCenterTertiaryWidth
                );
            }

            if (hasCenterSecondary) {
                const maxCenterSecondaryWidth = Math.max(
                    this.minCenterSecondaryWidth,
                    availableDockWidth - (hasCenterTertiary ? EditorSettings.centerTertiaryWidth : 0)
                );
                EditorSettings.centerSecondaryWidth = THREE.MathUtils.clamp(
                    EditorSettings.centerSecondaryWidth,
                    this.minCenterSecondaryWidth,
                    maxCenterSecondaryWidth
                );
            }

            if (!hasCenterSecondary) {
                EditorSettings.centerSecondaryWidth = this.defaultCenterSecondaryWidth;
            }

            if (!hasCenterTertiary) {
                EditorSettings.centerTertiaryWidth = this.defaultCenterTertiaryWidth;
            }

            this.applyPanelWidths();
        } else {
            EditorSettings.centerSecondaryWidth = this.defaultCenterSecondaryWidth;
            EditorSettings.centerTertiaryWidth = this.defaultCenterTertiaryWidth;
        }

        const editorContainer = document.getElementById('editor-container') as HTMLElement | null;
        const menuBar = document.getElementById('menu-bar') as HTMLElement | null;
        const toolbar = document.getElementById('toolbar') as HTMLElement | null;
        const bottomSplitter = document.getElementById('bottom-splitter') as HTMLElement | null;
        const statusBar = document.getElementById('status-bar') as HTMLElement | null;
        if (!editorContainer || !menuBar || !toolbar || !statusBar) return;

        const chromeHeight =
            menuBar.offsetHeight +
            toolbar.offsetHeight +
            statusBar.offsetHeight +
            (this.isPanelDockedVisible('assets-panel') ? (bottomSplitter?.offsetHeight ?? 0) : 0);
        const availableHeight = Math.max(0, editorContainer.clientHeight - chromeHeight);
        const maxAssetsHeight = Math.max(this.minAssetsHeight, availableHeight - this.minMainAreaHeight);

        if (this.isPanelDockedVisible('assets-panel')) {
            EditorSettings.assetsHeight = THREE.MathUtils.clamp(
                EditorSettings.assetsHeight,
                this.minAssetsHeight,
                maxAssetsHeight
            );
            this.applyPanelWidths();
        }
    }

    private getMaxAssetsHeight() {
        const editorContainer = document.getElementById('editor-container') as HTMLElement | null;
        const menuBar = document.getElementById('menu-bar') as HTMLElement | null;
        const toolbar = document.getElementById('toolbar') as HTMLElement | null;
        const statusBar = document.getElementById('status-bar') as HTMLElement | null;
        const bottomSplitter = document.getElementById('bottom-splitter') as HTMLElement | null;
        if (!editorContainer || !menuBar || !toolbar || !statusBar) return this.minAssetsHeight;

        const chromeHeight =
            menuBar.offsetHeight +
            toolbar.offsetHeight +
            statusBar.offsetHeight +
            (this.isPanelDockedVisible('assets-panel') ? (bottomSplitter?.offsetHeight ?? 0) : 0);

        return Math.max(this.minAssetsHeight, editorContainer.clientHeight - chromeHeight - this.minMainAreaHeight);
    }

    private normalizeLayoutSnapshot(layout: Partial<EditorLayoutSnapshot> | null | undefined): EditorLayoutSnapshot {
        const fallback = this.captureLayoutState();
        const dockableViews = ['project', 'console', 'render'] as const;
        const viewportTabs = ['scene', 'game'] as const;
        const layoutPresets = ['default', 'scene', 'scripting', 'custom'] as const;
        const panelIds = ['hierarchy-panel', 'viewport-panel', 'inspector-panel', 'assets-panel'] as const;
        const sideSlots = ['left', 'right'] as const;
        const dockHosts = ['bottom', 'inspector', 'hierarchy', 'viewport', 'center-secondary', 'center-tertiary'] as const;

        const coerceNumber = (value: unknown, nextFallback: number) =>
            Number.isFinite(value) ? Math.round(Number(value)) : nextFallback;
        const coerceBoolean = (value: unknown, nextFallback: boolean) =>
            typeof value === 'boolean' ? value : nextFallback;
        const coerceEnum = <T extends string>(value: unknown, allowed: readonly T[], nextFallback: T): T =>
            typeof value === 'string' && allowed.includes(value as T) ? (value as T) : nextFallback;
        const coerceNullableEnum = <T extends string>(value: unknown, allowed: readonly T[], nextFallback: T | null): T | null => {
            if (value === null) return null;
            return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : nextFallback;
        };
        const coerceUniqueList = <T extends string>(value: unknown, allowed: readonly T[], nextFallback: T[]): T[] => {
            if (!Array.isArray(value)) return [...nextFallback];
            const seen = new Set<T>();
            const normalized: T[] = [];
            value.forEach((item) => {
                if (typeof item !== 'string' || !allowed.includes(item as T)) return;
                const typedItem = item as T;
                if (seen.has(typedItem)) return;
                seen.add(typedItem);
                normalized.push(typedItem);
            });
            return normalized.length > 0 ? normalized : [...nextFallback];
        };

        const normalizedViewHosts: Record<DockableEditorView, EditorDockHost> = { ...fallback.viewHosts };
        dockableViews.forEach((view) => {
            normalizedViewHosts[view] = coerceEnum(
                layout?.viewHosts?.[view],
                dockHosts,
                fallback.viewHosts[view]
            );
        });

        const normalizedSideSlots: Record<'hierarchy-panel' | 'inspector-panel', EditorSideDockSlot> = {
            'hierarchy-panel': coerceEnum(layout?.sidePanelSlots?.['hierarchy-panel'], sideSlots, fallback.sidePanelSlots['hierarchy-panel']),
            'inspector-panel': coerceEnum(layout?.sidePanelSlots?.['inspector-panel'], sideSlots, fallback.sidePanelSlots['inspector-panel'])
        };

        const normalizedSnapshot: EditorLayoutSnapshot = {
            hierarchyWidth: coerceNumber(layout?.hierarchyWidth, fallback.hierarchyWidth),
            inspectorWidth: coerceNumber(layout?.inspectorWidth, fallback.inspectorWidth),
            sidePanelWidths: {
                left: coerceNumber(layout?.sidePanelWidths?.left, fallback.sidePanelWidths.left),
                right: coerceNumber(layout?.sidePanelWidths?.right, fallback.sidePanelWidths.right)
            },
            assetsHeight: coerceNumber(layout?.assetsHeight, fallback.assetsHeight),
            hierarchyVisible: coerceBoolean(layout?.hierarchyVisible, fallback.hierarchyVisible),
            inspectorVisible: coerceBoolean(layout?.inspectorVisible, fallback.inspectorVisible),
            assetsVisible: coerceBoolean(layout?.assetsVisible, fallback.assetsVisible),
            activeBottomTab: coerceEnum(layout?.activeBottomTab, dockableViews, fallback.activeBottomTab),
            activeViewportTab: coerceEnum(layout?.activeViewportTab, viewportTabs, fallback.activeViewportTab),
            bottomTabOrder: coerceUniqueList(layout?.bottomTabOrder, dockableViews, fallback.bottomTabOrder),
            viewportTabOrder: coerceUniqueList(layout?.viewportTabOrder, viewportTabs, fallback.viewportTabOrder),
            activeViewportDockTab: coerceNullableEnum(layout?.activeViewportDockTab, dockableViews, fallback.activeViewportDockTab),
            viewportDockTabOrder: coerceUniqueList(layout?.viewportDockTabOrder, dockableViews, fallback.viewportDockTabOrder),
            activeCenterSecondaryTab: coerceNullableEnum(layout?.activeCenterSecondaryTab, dockableViews, fallback.activeCenterSecondaryTab),
            centerSecondaryTabOrder: coerceUniqueList(layout?.centerSecondaryTabOrder, dockableViews, fallback.centerSecondaryTabOrder),
            activeCenterTertiaryTab: coerceNullableEnum(layout?.activeCenterTertiaryTab, dockableViews, fallback.activeCenterTertiaryTab),
            centerTertiaryTabOrder: coerceUniqueList(layout?.centerTertiaryTabOrder, dockableViews, fallback.centerTertiaryTabOrder),
            activeHierarchyTab: coerceEnum(layout?.activeHierarchyTab, ['hierarchy', ...dockableViews], fallback.activeHierarchyTab),
            hierarchyTabOrder: coerceUniqueList(layout?.hierarchyTabOrder, ['hierarchy', ...dockableViews], fallback.hierarchyTabOrder),
            activeInspectorTab: coerceEnum(layout?.activeInspectorTab, ['inspector', ...dockableViews], fallback.activeInspectorTab),
            inspectorTabOrder: coerceUniqueList(layout?.inspectorTabOrder, ['inspector', ...dockableViews], fallback.inspectorTabOrder),
            viewHosts: normalizedViewHosts,
            dockGraph: this.normalizeDockGraph(layout?.dockGraph),
            floatingDockableHomeHosts: this.normalizeFloatingDockableHomeHosts(layout?.floatingDockableHomeHosts),
            floatingPanels: this.normalizeFloatingPanelMap(layout?.floatingPanels),
            sidePanelSlots: normalizedSideSlots,
            centerSecondaryWidth: coerceNumber(layout?.centerSecondaryWidth, fallback.centerSecondaryWidth),
            centerTertiaryWidth: coerceNumber(layout?.centerTertiaryWidth, fallback.centerTertiaryWidth),
            layoutPreset: coerceEnum(layout?.layoutPreset, layoutPresets, fallback.layoutPreset),
            activePanelId: coerceEnum(layout?.activePanelId, panelIds, fallback.activePanelId),
            prefabApplyTargetRootIds: layout?.prefabApplyTargetRootIds,
            collapsedComponentsPerGameObject: layout?.collapsedComponentsPerGameObject
        };

        return normalizedSnapshot;
    }

    private applyLayoutSnapshotSafely(
        layout: Partial<EditorLayoutSnapshot> | null | undefined,
        options?: {
            fallbackLayout?: EditorLayoutSnapshot;
            fallbackPanelId?: EditorPanelId;
            save?: boolean;
            warningLabel?: string;
        }
    ) {
        const fallbackLayout = options?.fallbackLayout ?? this.captureLayoutState();
        const fallbackPanelId = options?.fallbackPanelId ?? this.getResolvedActivePanel(fallbackLayout.activePanelId);

        try {
            this.applyLayoutState(layout);
            const targetPanelId = this.getResolvedActivePanel((layout as Partial<EditorLayoutSnapshot> | undefined)?.activePanelId ?? this.activePanelId);
            this.setActivePanel(targetPanelId);
            this.resize();
            if (options?.save ?? true) {
                this.saveLayout(false);
            }
        } catch (error) {
            console.warn(options?.warningLabel ?? 'Failed to apply layout snapshot. Restoring fallback layout.', error);
            this.applyLayoutState(fallbackLayout);
            this.setActivePanel(fallbackPanelId);
            this.resize();
            if (options?.save ?? true) {
                this.saveLayout(false);
            }
        }
    }

    private captureLayoutState(): EditorLayoutSnapshot {
        return {
            hierarchyWidth: EditorSettings.hierarchyWidth,
            inspectorWidth: EditorSettings.inspectorWidth,
            sidePanelWidths: { ...EditorSettings.sidePanelWidths },
            assetsHeight: EditorSettings.assetsHeight,
            hierarchyVisible: EditorSettings.hierarchyVisible,
            inspectorVisible: EditorSettings.inspectorVisible,
            assetsVisible: EditorSettings.assetsVisible,
            activeBottomTab: this.activeBottomTab,
            activeViewportTab: this.activeViewportTab,
            bottomTabOrder: [...EditorSettings.bottomTabOrder],
            viewportTabOrder: [...EditorSettings.viewportTabOrder],
            activeViewportDockTab: this.activeViewportDockTab,
            viewportDockTabOrder: [...EditorSettings.viewportDockTabOrder],
            activeCenterSecondaryTab: this.activeCenterSecondaryTab,
            centerSecondaryTabOrder: [...EditorSettings.centerSecondaryTabOrder],
            activeCenterTertiaryTab: this.activeCenterTertiaryTab,
            centerTertiaryTabOrder: [...EditorSettings.centerTertiaryTabOrder],
            activeHierarchyTab: this.activeHierarchyTab,
            hierarchyTabOrder: [...EditorSettings.hierarchyTabOrder],
            activeInspectorTab: this.activeInspectorTab,
            inspectorTabOrder: [...EditorSettings.inspectorTabOrder],
            viewHosts: { ...EditorSettings.viewHosts },
            dockGraph: this.buildDockGraphFromLegacyState(),
            floatingDockableHomeHosts: { ...this.floatingDockableHomeHosts },
            floatingPanels: { ...EditorSettings.floatingPanels },
            sidePanelSlots: { ...EditorSettings.sidePanelSlots },
            centerSecondaryWidth: EditorSettings.centerSecondaryWidth,
            centerTertiaryWidth: EditorSettings.centerTertiaryWidth,
            layoutPreset: this.currentLayoutPreset,
            activePanelId: this.getResolvedActivePanel(this.activePanelId),
            prefabApplyTargetRootIds: this.serializePrefabApplyTargetRootIds()
        };
    }

    private applyLayoutState(layout: Partial<EditorLayoutSnapshot> | null | undefined) {
        const normalizedLayout = this.normalizeLayoutSnapshot(layout);
        EditorSettings.hierarchyWidth = normalizedLayout.hierarchyWidth;
        EditorSettings.inspectorWidth = normalizedLayout.inspectorWidth;
        EditorSettings.sidePanelSlots = this.normalizeSidePanelSlots(normalizedLayout.sidePanelSlots);
        EditorSettings.sidePanelWidths = this.normalizeSidePanelWidths(normalizedLayout.sidePanelWidths, EditorSettings.sidePanelSlots);
        EditorSettings.assetsHeight = normalizedLayout.assetsHeight;
        EditorSettings.hierarchyVisible = normalizedLayout.hierarchyVisible;
        EditorSettings.inspectorVisible = normalizedLayout.inspectorVisible;
        EditorSettings.assetsVisible = normalizedLayout.assetsVisible;
        this.activeBottomTab = normalizedLayout.activeBottomTab;
        this.activeViewportTab = normalizedLayout.activeViewportTab;
        EditorSettings.bottomTabOrder = [...normalizedLayout.bottomTabOrder];
        EditorSettings.viewportTabOrder = [...normalizedLayout.viewportTabOrder];
        this.activeViewportDockTab = normalizedLayout.activeViewportDockTab ?? null;
        EditorSettings.viewportDockTabOrder = [...normalizedLayout.viewportDockTabOrder];
        this.activeCenterSecondaryTab = normalizedLayout.activeCenterSecondaryTab ?? null;
        EditorSettings.centerSecondaryTabOrder = [...normalizedLayout.centerSecondaryTabOrder];
        this.activeCenterTertiaryTab = normalizedLayout.activeCenterTertiaryTab ?? null;
        EditorSettings.centerTertiaryTabOrder = [...normalizedLayout.centerTertiaryTabOrder];
        this.activeHierarchyTab = normalizedLayout.activeHierarchyTab;
        EditorSettings.hierarchyTabOrder = [...normalizedLayout.hierarchyTabOrder];
        this.activeInspectorTab = normalizedLayout.activeInspectorTab;
        EditorSettings.inspectorTabOrder = [...normalizedLayout.inspectorTabOrder];
        EditorSettings.viewHosts = this.normalizeViewHosts(normalizedLayout.viewHosts);
        EditorSettings.dockGraph = this.normalizeDockGraph(normalizedLayout.dockGraph);
        this.applyDockGraphToLegacyState(EditorSettings.dockGraph);
        this.floatingDockableHomeHosts = this.normalizeFloatingDockableHomeHosts(normalizedLayout.floatingDockableHomeHosts);
        EditorSettings.floatingDockableHomeHosts = { ...this.floatingDockableHomeHosts };
        EditorSettings.floatingPanels = this.normalizeFloatingPanelMap(normalizedLayout.floatingPanels);
        EditorSettings.centerSecondaryWidth = Math.max(this.minCenterSecondaryWidth, Math.round(normalizedLayout.centerSecondaryWidth ?? this.defaultCenterSecondaryWidth));
        EditorSettings.centerTertiaryWidth = Math.max(this.minCenterTertiaryWidth, Math.round(normalizedLayout.centerTertiaryWidth ?? this.defaultCenterTertiaryWidth));
        this.currentLayoutPreset = normalizedLayout.layoutPreset ?? 'default';
        this.activePanelId = this.getResolvedActivePanel(normalizedLayout.activePanelId);
        this.prefabApplyTargetRootIds = this.normalizePrefabApplyTargetRootIds(normalizedLayout.prefabApplyTargetRootIds);
        EditorSettings.prefabApplyTargetRootIds = this.serializePrefabApplyTargetRootIds();
        this.syncLegacyPanelWidthsFromSideSlots();
        this.applyStoredLayout();
    }

    private normalizeTabSettings() {
        EditorSettings.viewportTabOrder = this.normalizeTabOrder(EditorSettings.viewportTabOrder, this.defaultViewportTabOrder);
        EditorSettings.viewHosts = this.normalizeViewHosts(EditorSettings.viewHosts);
        EditorSettings.sidePanelSlots = this.normalizeSidePanelSlots(EditorSettings.sidePanelSlots);
        EditorSettings.sidePanelWidths = this.normalizeSidePanelWidths(EditorSettings.sidePanelWidths, EditorSettings.sidePanelSlots);
        this.syncLegacyPanelWidthsFromSideSlots();
        EditorSettings.viewportDockTabOrder = this.normalizeTabOrder(
            (EditorSettings.viewportDockTabOrder ?? []).filter((tab) => EditorSettings.viewHosts[tab] === 'viewport'),
            this.defaultBottomTabOrder.filter((tab) => EditorSettings.viewHosts[tab] === 'viewport')
        );
        EditorSettings.centerSecondaryTabOrder = this.normalizeTabOrder(
            (EditorSettings.centerSecondaryTabOrder ?? []).filter((tab) => EditorSettings.viewHosts[tab] === 'center-secondary'),
            this.defaultBottomTabOrder.filter((tab) => EditorSettings.viewHosts[tab] === 'center-secondary')
        );
        EditorSettings.centerTertiaryTabOrder = this.normalizeTabOrder(
            (EditorSettings.centerTertiaryTabOrder ?? []).filter((tab) => EditorSettings.viewHosts[tab] === 'center-tertiary'),
            this.defaultBottomTabOrder.filter((tab) => EditorSettings.viewHosts[tab] === 'center-tertiary')
        );
        this.compactCenterDockHosts();
        EditorSettings.hierarchyTabOrder = this.normalizeTabOrder(
            (EditorSettings.hierarchyTabOrder ?? []).filter((tab) => tab === 'hierarchy' || EditorSettings.viewHosts[tab] === 'hierarchy'),
            this.getDefaultHierarchyTabOrder()
        );
        if (!EditorSettings.hierarchyTabOrder.includes('hierarchy')) {
            EditorSettings.hierarchyTabOrder.unshift('hierarchy');
        } else if (EditorSettings.hierarchyTabOrder[0] !== 'hierarchy') {
            EditorSettings.hierarchyTabOrder = ['hierarchy', ...EditorSettings.hierarchyTabOrder.filter((tab) => tab !== 'hierarchy')];
        }
        EditorSettings.bottomTabOrder = this.normalizeTabOrder(
            (EditorSettings.bottomTabOrder ?? []).filter((tab) => EditorSettings.viewHosts[tab] === 'bottom'),
            this.defaultBottomTabOrder.filter((tab) => EditorSettings.viewHosts[tab] === 'bottom')
        );
        EditorSettings.inspectorTabOrder = this.normalizeTabOrder(
            (EditorSettings.inspectorTabOrder ?? []).filter((tab) => tab === 'inspector' || EditorSettings.viewHosts[tab] === 'inspector'),
            this.getDefaultInspectorTabOrder()
        );
        if (!EditorSettings.inspectorTabOrder.includes('inspector')) {
            EditorSettings.inspectorTabOrder.unshift('inspector');
        } else if (EditorSettings.inspectorTabOrder[0] !== 'inspector') {
            EditorSettings.inspectorTabOrder = ['inspector', ...EditorSettings.inspectorTabOrder.filter((tab) => tab !== 'inspector')];
        }
        if (!EditorSettings.viewportTabOrder.includes(this.activeViewportTab)) {
            this.activeViewportTab = EditorSettings.activeViewportTab = 'scene';
        }
        if (this.activeViewportDockTab && !EditorSettings.viewportDockTabOrder.includes(this.activeViewportDockTab)) {
            this.activeViewportDockTab = EditorSettings.activeViewportDockTab = (EditorSettings.viewportDockTabOrder[0] ?? null);
        }
        if (this.activeCenterSecondaryTab && !EditorSettings.centerSecondaryTabOrder.includes(this.activeCenterSecondaryTab)) {
            this.activeCenterSecondaryTab = EditorSettings.activeCenterSecondaryTab = (EditorSettings.centerSecondaryTabOrder[0] ?? null);
        } else if (!this.activeCenterSecondaryTab && EditorSettings.centerSecondaryTabOrder.length > 0) {
            this.activeCenterSecondaryTab = EditorSettings.activeCenterSecondaryTab = EditorSettings.centerSecondaryTabOrder[0];
        }
        if (this.activeCenterTertiaryTab && !EditorSettings.centerTertiaryTabOrder.includes(this.activeCenterTertiaryTab)) {
            this.activeCenterTertiaryTab = EditorSettings.activeCenterTertiaryTab = (EditorSettings.centerTertiaryTabOrder[0] ?? null);
        } else if (!this.activeCenterTertiaryTab && EditorSettings.centerTertiaryTabOrder.length > 0) {
            this.activeCenterTertiaryTab = EditorSettings.activeCenterTertiaryTab = EditorSettings.centerTertiaryTabOrder[0];
        }
        if (this.activeViewportFocusHost === 'center-tertiary' && EditorSettings.centerTertiaryTabOrder.length === 0) {
            this.activeViewportFocusHost = EditorSettings.centerSecondaryTabOrder.length > 0 ? 'center-secondary' : 'viewport';
        } else if (this.activeViewportFocusHost === 'center-secondary' && EditorSettings.centerSecondaryTabOrder.length === 0) {
            this.activeViewportFocusHost = EditorSettings.centerTertiaryTabOrder.length > 0 ? 'center-tertiary' : 'viewport';
        }
        if (EditorSettings.bottomTabOrder.length === 0) {
            this.activeBottomTab = EditorSettings.activeBottomTab = 'project';
        } else if (!EditorSettings.bottomTabOrder.includes(this.activeBottomTab)) {
            this.activeBottomTab = EditorSettings.activeBottomTab = EditorSettings.bottomTabOrder[0];
        }
        if (!EditorSettings.hierarchyTabOrder.includes(this.activeHierarchyTab)) {
            this.activeHierarchyTab = EditorSettings.activeHierarchyTab = 'hierarchy';
        }
        if (!EditorSettings.inspectorTabOrder.includes(this.activeInspectorTab)) {
            this.activeInspectorTab = EditorSettings.activeInspectorTab = 'inspector';
        }
    }

    private normalizeViewHosts(
        viewHosts: Partial<Record<DockableEditorView, EditorDockHost>> | undefined
    ): Record<DockableEditorView, EditorDockHost> {
        const normalized = { ...this.defaultViewHosts };
        (Object.keys(this.defaultViewHosts) as DockableEditorView[]).forEach((view) => {
            const host = viewHosts?.[view];
            if (host === 'bottom' || host === 'inspector' || host === 'hierarchy' || host === 'viewport' || host === 'center-secondary' || host === 'center-tertiary') {
                normalized[view] = host;
            }
        });
        return normalized;
    }

    private normalizeFloatingPanelMap(
        floatingPanels: Partial<Record<EditorPanelId, EditorFloatingPanelState>> | undefined
    ): Partial<Record<EditorPanelId, EditorFloatingPanelState>> {
        const normalized: Partial<Record<EditorPanelId, EditorFloatingPanelState>> = {};
        this.floatablePanels.forEach((panelId) => {
            normalized[panelId] = this.normalizeFloatingPanelState(panelId, floatingPanels?.[panelId]);
        });
        return normalized;
    }

    private getDefaultInspectorTabOrder(): EditorInspectorTab[] {
        return [
            ...this.defaultInspectorTabOrder,
            ...this.defaultBottomTabOrder.filter((tab) => EditorSettings.viewHosts[tab] === 'inspector')
        ];
    }

    private getDefaultHierarchyTabOrder(): EditorHierarchyTab[] {
        return [
            ...this.defaultHierarchyTabOrder,
            ...this.defaultBottomTabOrder.filter((tab) => EditorSettings.viewHosts[tab] === 'hierarchy')
        ];
    }

    private normalizeTabOrder<T extends string>(order: T[] | undefined, defaults: readonly T[]): T[] {
        const normalized: T[] = [];
        (Array.isArray(order) ? order : []).forEach((item) => {
            if (defaults.includes(item) && !normalized.includes(item)) {
                normalized.push(item);
            }
        });
        defaults.forEach((item) => {
            if (!normalized.includes(item)) {
                normalized.push(item);
            }
        });
        return normalized;
    }

    private compactCenterDockGraph(
        hosts: Record<EditorDockHost, DockableEditorView[]>,
        activeTabs?: Partial<Record<EditorDockHost, DockableEditorView>>
    ) {
        if (hosts['center-secondary'].length === 0 && hosts['center-tertiary'].length > 0) {
            hosts['center-secondary'] = [...hosts['center-tertiary']];
            hosts['center-tertiary'] = [];

            if (activeTabs) {
                activeTabs['center-secondary'] = activeTabs['center-tertiary'] ?? hosts['center-secondary'][0];
                delete activeTabs['center-tertiary'];
            }
        }
    }

    private compactCenterDockHosts() {
        if (EditorSettings.centerSecondaryTabOrder.length === 0 && EditorSettings.centerTertiaryTabOrder.length > 0) {
            EditorSettings.centerSecondaryTabOrder = [...EditorSettings.centerTertiaryTabOrder];
            EditorSettings.centerTertiaryTabOrder = [];

            EditorSettings.centerSecondaryTabOrder.forEach((tab) => {
                if (EditorSettings.viewHosts[tab] === 'center-tertiary') {
                    EditorSettings.viewHosts[tab] = 'center-secondary';
                }
                if (this.floatingDockableHomeHosts[tab] === 'center-tertiary') {
                    this.floatingDockableHomeHosts[tab] = 'center-secondary';
                }
            });

            this.activeCenterSecondaryTab = this.activeCenterTertiaryTab ?? EditorSettings.centerSecondaryTabOrder[0] ?? null;
            this.activeCenterTertiaryTab = null;
            EditorSettings.activeCenterSecondaryTab = this.activeCenterSecondaryTab;
            EditorSettings.activeCenterTertiaryTab = null;
            EditorSettings.centerSecondaryWidth = Math.max(EditorSettings.centerSecondaryWidth, EditorSettings.centerTertiaryWidth);
            EditorSettings.centerTertiaryWidth = 280;

            if (this.activeViewportFocusHost === 'center-tertiary') {
                this.activeViewportFocusHost = 'center-secondary';
            }
        }

        if (!this.isCenterSecondaryVisible() && !this.isCenterTertiaryVisible()) {
            this.activeCenterSecondaryTab = null;
            this.activeCenterTertiaryTab = null;
            if (this.activeViewportFocusHost !== 'viewport') {
                this.activeViewportFocusHost = 'viewport';
            }
        }
    }

    private resolveDockHostTarget(host: EditorDockHost, tab: DockableEditorView): EditorDockHost {
        if (host !== 'center-tertiary') return host;

        const remainingSecondaryTabs = EditorSettings.centerSecondaryTabOrder.filter((item) => item !== tab);
        return remainingSecondaryTabs.length === 0 ? 'center-secondary' : 'center-tertiary';
    }

    private normalizeFloatingDockableHomeHosts(
        homeHosts: Partial<Record<DockableEditorView, EditorDockHost>> | undefined
    ): Partial<Record<DockableEditorView, EditorDockHost>> {
        const normalized: Partial<Record<DockableEditorView, EditorDockHost>> = {};
        (['project', 'console', 'render'] as DockableEditorView[]).forEach((tab) => {
            const host = homeHosts?.[tab];
            if (host && host !== 'bottom' && ['viewport', 'center-secondary', 'center-tertiary', 'hierarchy', 'inspector'].includes(host)) {
                normalized[tab] = host;
            }
        });
        return normalized;
    }

    private normalizePrefabApplyTargetRootIds(
        savedTargets: Record<string, string> | undefined
    ): Map<string, string> {
        const normalized = new Map<string, string>();
        if (!savedTargets || typeof savedTargets !== 'object') {
            return normalized;
        }

        Object.entries(savedTargets).forEach(([selectionId, targetId]) => {
            if (typeof selectionId !== 'string' || typeof targetId !== 'string') return;
            if (!selectionId || !targetId) return;
            normalized.set(selectionId, targetId);
        });

        return normalized;
    }

    private serializePrefabApplyTargetRootIds(): Record<string, string> {
        return Object.fromEntries(this.prefabApplyTargetRootIds.entries());
    }

    private getActiveDockableTabForHost(host: EditorDockHost): DockableEditorView | null {
        if (host === 'bottom') {
            return EditorSettings.bottomTabOrder.includes(this.activeBottomTab) ? this.activeBottomTab : (EditorSettings.bottomTabOrder[0] ?? null);
        }

        if (host === 'viewport') {
            return this.activeViewportDockTab && EditorSettings.viewportDockTabOrder.includes(this.activeViewportDockTab)
                ? this.activeViewportDockTab
                : (EditorSettings.viewportDockTabOrder[0] ?? null);
        }

        if (host === 'center-secondary') {
            return this.activeCenterSecondaryTab && EditorSettings.centerSecondaryTabOrder.includes(this.activeCenterSecondaryTab)
                ? this.activeCenterSecondaryTab
                : (EditorSettings.centerSecondaryTabOrder[0] ?? null);
        }

        if (host === 'center-tertiary') {
            return this.activeCenterTertiaryTab && EditorSettings.centerTertiaryTabOrder.includes(this.activeCenterTertiaryTab)
                ? this.activeCenterTertiaryTab
                : (EditorSettings.centerTertiaryTabOrder[0] ?? null);
        }

        if (host === 'hierarchy') {
            return this.activeHierarchyTab !== 'hierarchy' && EditorSettings.hierarchyTabOrder.includes(this.activeHierarchyTab)
                ? this.activeHierarchyTab
                : (EditorSettings.hierarchyTabOrder.find((tab): tab is DockableEditorView => tab !== 'hierarchy') ?? null);
        }

        return this.activeInspectorTab !== 'inspector' && EditorSettings.inspectorTabOrder.includes(this.activeInspectorTab)
            ? this.activeInspectorTab
            : (EditorSettings.inspectorTabOrder.find((tab): tab is DockableEditorView => tab !== 'inspector') ?? null);
    }

    private buildDockGraphFromLegacyState(): EditorDockGraphState {
        return this.normalizeDockGraph({
            hosts: {
                bottom: [...EditorSettings.bottomTabOrder],
                viewport: [...EditorSettings.viewportDockTabOrder],
                'center-secondary': [...EditorSettings.centerSecondaryTabOrder],
                'center-tertiary': [...EditorSettings.centerTertiaryTabOrder],
                hierarchy: EditorSettings.hierarchyTabOrder.filter((tab): tab is DockableEditorView => tab !== 'hierarchy'),
                inspector: EditorSettings.inspectorTabOrder.filter((tab): tab is DockableEditorView => tab !== 'inspector')
            },
            activeTabs: {
                bottom: this.getActiveDockableTabForHost('bottom') ?? undefined,
                viewport: this.getActiveDockableTabForHost('viewport') ?? undefined,
                'center-secondary': this.getActiveDockableTabForHost('center-secondary') ?? undefined,
                'center-tertiary': this.getActiveDockableTabForHost('center-tertiary') ?? undefined,
                hierarchy: this.getActiveDockableTabForHost('hierarchy') ?? undefined,
                inspector: this.getActiveDockableTabForHost('inspector') ?? undefined
            }
        });
    }

    private normalizeDockGraph(
        dockGraph: Partial<EditorDockGraphState> | EditorDockGraphState | undefined
    ): EditorDockGraphState {
        const preferredHosts = this.normalizeViewHosts(EditorSettings.viewHosts);
        const hostOrder: EditorDockHost[] = ['bottom', 'viewport', 'center-secondary', 'center-tertiary', 'hierarchy', 'inspector'];
        const normalizedHosts: Record<EditorDockHost, DockableEditorView[]> = {
            bottom: [],
            viewport: [],
            'center-secondary': [],
            'center-tertiary': [],
            hierarchy: [],
            inspector: []
        };
        const assigned = new Set<DockableEditorView>();

        hostOrder.forEach((host) => {
            const tabs = Array.isArray(dockGraph?.hosts?.[host]) ? dockGraph.hosts[host] : [];
            tabs.forEach((tab) => {
                if (!this.defaultBottomTabOrder.includes(tab) || assigned.has(tab)) return;
                normalizedHosts[host].push(tab);
                assigned.add(tab);
            });
        });

        this.defaultBottomTabOrder.forEach((tab) => {
            if (assigned.has(tab)) return;
            const fallbackHost = preferredHosts[tab] ?? this.defaultViewHosts[tab];
            normalizedHosts[fallbackHost].push(tab);
            assigned.add(tab);
        });

        const normalizedActiveTabs: Partial<Record<EditorDockHost, DockableEditorView>> = {};
        hostOrder.forEach((host) => {
            const candidate = dockGraph?.activeTabs?.[host];
            if (candidate && normalizedHosts[host].includes(candidate)) {
                normalizedActiveTabs[host] = candidate;
                return;
            }

            const current = this.getActiveDockableTabForHost(host);
            if (current && normalizedHosts[host].includes(current)) {
                normalizedActiveTabs[host] = current;
                return;
            }

            if (normalizedHosts[host][0]) {
                normalizedActiveTabs[host] = normalizedHosts[host][0];
            }
        });

        this.compactCenterDockGraph(normalizedHosts, normalizedActiveTabs);

        return {
            hosts: normalizedHosts,
            activeTabs: normalizedActiveTabs
        };
    }

    private applyDockGraphToLegacyState(dockGraph: EditorDockGraphState) {
        const normalizedDockGraph = this.normalizeDockGraph(dockGraph);
        EditorSettings.dockGraph = normalizedDockGraph;

        const nextViewHosts = { ...this.defaultViewHosts };
        (Object.entries(normalizedDockGraph.hosts) as Array<[EditorDockHost, DockableEditorView[]]>).forEach(([host, tabs]) => {
            tabs.forEach((tab) => {
                nextViewHosts[tab] = host;
            });
        });

        EditorSettings.viewHosts = nextViewHosts;
        EditorSettings.bottomTabOrder = [...normalizedDockGraph.hosts.bottom];
        EditorSettings.viewportDockTabOrder = [...normalizedDockGraph.hosts.viewport];
        EditorSettings.centerSecondaryTabOrder = [...normalizedDockGraph.hosts['center-secondary']];
        EditorSettings.centerTertiaryTabOrder = [...normalizedDockGraph.hosts['center-tertiary']];
        EditorSettings.hierarchyTabOrder = ['hierarchy', ...normalizedDockGraph.hosts.hierarchy];
        EditorSettings.inspectorTabOrder = ['inspector', ...normalizedDockGraph.hosts.inspector];

        this.activeBottomTab = normalizedDockGraph.activeTabs.bottom ?? (EditorSettings.bottomTabOrder[0] ?? 'project');
        this.activeViewportDockTab = normalizedDockGraph.activeTabs.viewport ?? null;
        this.activeCenterSecondaryTab = normalizedDockGraph.activeTabs['center-secondary'] ?? null;
        this.activeCenterTertiaryTab = normalizedDockGraph.activeTabs['center-tertiary'] ?? null;
        this.activeHierarchyTab = normalizedDockGraph.activeTabs.hierarchy ?? 'hierarchy';
        this.activeInspectorTab = normalizedDockGraph.activeTabs.inspector ?? 'inspector';
        this.activeViewportFocusHost = this.activeCenterTertiaryTab
            ? 'center-tertiary'
            : this.activeCenterSecondaryTab
                ? 'center-secondary'
                : 'viewport';
    }

    private syncDockGraphFromLegacyState() {
        this.applyDockGraphToLegacyState(this.buildDockGraphFromLegacyState());
    }

    private applyTabOrders() {
        this.applyTabOrder('viewport-tabs', EditorSettings.viewportTabOrder.map((tab) => this.getViewportTabId(tab)));
        this.applyTabOrder('viewport-dock-tabs', EditorSettings.viewportDockTabOrder.map((tab) => this.getBottomTabId(tab)));
        this.applyTabOrder('center-secondary-tabs', EditorSettings.centerSecondaryTabOrder.map((tab) => this.getBottomTabId(tab)));
        this.applyTabOrder('center-tertiary-tabs', EditorSettings.centerTertiaryTabOrder.map((tab) => this.getBottomTabId(tab)));
        this.applyTabOrder('hierarchy-tabs', EditorSettings.hierarchyTabOrder.map((tab) => this.getHierarchyTabId(tab)));
        this.applyTabOrder('bottom-tabs', EditorSettings.bottomTabOrder.map((tab) => this.getBottomTabId(tab)));
        this.applyTabOrder('inspector-tabs', EditorSettings.inspectorTabOrder.map((tab) => this.getInspectorTabId(tab)));
    }

    private applyTabOrder(containerId: string, orderedTabIds: string[]) {
        const container = document.getElementById(containerId);
        if (!container) return;

        orderedTabIds.forEach((tabId) => {
            const tabEl = document.getElementById(tabId);
            if (tabEl) {
                container.appendChild(tabEl);
            }
        });
    }

    private getViewportTabId(tab: EditorViewportTab): string {
        return tab === 'scene' ? 'tab-scene' : 'tab-game';
    }

    private getBottomTabId(tab: EditorBottomTab): string {
        if (tab === 'project') return 'tab-assets';
        if (tab === 'console') return 'tab-console';
        return 'tab-render';
    }

    private getHierarchyTabId(tab: EditorHierarchyTab): string {
        if (tab === 'hierarchy') return 'tab-hierarchy';
        return this.getBottomTabId(tab);
    }

    private getInspectorTabId(tab: EditorInspectorTab): string {
        if (tab === 'inspector') return 'tab-inspector';
        return this.getBottomTabId(tab);
    }

    private getViewHost(tab: DockableEditorView): EditorDockHost {
        return EditorSettings.viewHosts[tab];
    }

    private getDockableViewLabel(tab: DockableEditorView): string {
        if (tab === 'project') return 'Project';
        if (tab === 'console') return 'Console';
        return 'Render Settings';
    }

    private getDockableTabsForPanel(panelId: Exclude<EditorPanelId, 'viewport-panel'>): DockableEditorView[] {
        if (panelId === 'assets-panel') {
            return [...EditorSettings.bottomTabOrder];
        }

        if (panelId === 'hierarchy-panel') {
            return EditorSettings.hierarchyTabOrder.filter((tab): tab is DockableEditorView => tab !== 'hierarchy');
        }

        return EditorSettings.inspectorTabOrder.filter((tab): tab is DockableEditorView => tab !== 'inspector');
    }

    private getPreferredDockableTabForPanel(panelId: Exclude<EditorPanelId, 'viewport-panel'>): DockableEditorView | null {
        const dockableTabs = this.getDockableTabsForPanel(panelId);
        if (dockableTabs.length === 0) return null;

        if (panelId === 'assets-panel') {
            return dockableTabs.includes(this.activeBottomTab) ? this.activeBottomTab : dockableTabs[0];
        }

        if (panelId === 'hierarchy-panel') {
            return this.activeHierarchyTab !== 'hierarchy' && dockableTabs.includes(this.activeHierarchyTab)
                ? this.activeHierarchyTab
                : dockableTabs[0];
        }

        return this.activeInspectorTab !== 'inspector' && dockableTabs.includes(this.activeInspectorTab)
            ? this.activeInspectorTab
            : dockableTabs[0];
    }

    private movePanelDockableTabsToHost(
        panelId: Exclude<EditorPanelId, 'viewport-panel'>,
        targetHost: EditorDockHost,
        options?: { rememberSourceHosts?: boolean; deferLayout?: boolean }
    ): DockableEditorView[] {
        const dockableTabs = this.getDockableTabsForPanel(panelId);
        dockableTabs.forEach((tab) => {
            const sourceHost = this.getViewHost(tab);
            this.moveDockableTabToHost(tab, targetHost, undefined, { deferLayout: options?.deferLayout });
            if (options?.rememberSourceHosts && sourceHost !== targetHost) {
                this.floatingDockableHomeHosts[tab] = sourceHost;
            }
        });
        return dockableTabs;
    }

    private getContentIdForDockableView(tab: DockableEditorView): string {
        if (tab === 'project') return 'assets-content';
        if (tab === 'console') return 'console-content';
        return 'render-content';
    }

    private getActiveDockableView(): DockableEditorView | null {
        const resolvedPanel = this.getResolvedActivePanel(this.activePanelId);

        if (resolvedPanel === 'viewport-panel') {
            if (this.activeViewportFocusHost === 'center-tertiary') {
                return this.activeCenterTertiaryTab ?? this.activeCenterSecondaryTab ?? this.activeViewportDockTab;
            }
            if (this.activeViewportFocusHost === 'center-secondary') {
                return this.activeCenterSecondaryTab ?? this.activeCenterTertiaryTab ?? this.activeViewportDockTab;
            }
            return this.activeViewportDockTab ?? this.activeCenterSecondaryTab ?? this.activeCenterTertiaryTab;
        }

        if (resolvedPanel === 'assets-panel' && EditorSettings.assetsVisible) {
            return this.activeBottomTab;
        }

        if (resolvedPanel === 'hierarchy-panel' && EditorSettings.hierarchyVisible && this.activeHierarchyTab !== 'hierarchy') {
            return this.activeHierarchyTab;
        }

        if (resolvedPanel === 'inspector-panel' && EditorSettings.inspectorVisible && this.activeInspectorTab !== 'inspector') {
            return this.activeInspectorTab;
        }

        return null;
    }

    private isCenterSecondaryVisible(): boolean {
        return EditorSettings.centerSecondaryTabOrder.length > 0;
    }

    private isCenterTertiaryVisible(): boolean {
        return EditorSettings.centerTertiaryTabOrder.length > 0;
    }

    private applyDockedViewHosts() {
        this.mountPanelContent('hierarchy-panel', 'hierarchy-content');
        this.mountPanelContent('inspector-panel', 'inspector-content');

        (['project', 'console', 'render'] as DockableEditorView[]).forEach((view) => {
            const host = this.getViewHost(view);
            const panelId = host === 'viewport'
                ? 'viewport-panel'
                : host === 'center-secondary'
                    ? 'center-secondary-panel'
                : host === 'center-tertiary'
                    ? 'center-tertiary-panel'
                : host === 'hierarchy'
                    ? 'hierarchy-panel'
                    : host === 'inspector'
                        ? 'inspector-panel'
                        : 'assets-panel';
            this.mountPanelContent(panelId, this.getContentIdForDockableView(view));
        });
    }

    private mountPanelContent(panelId: 'viewport-panel' | 'center-secondary-panel' | 'center-tertiary-panel' | 'hierarchy-panel' | 'inspector-panel' | 'assets-panel', contentId: string) {
        const panel = document.getElementById(panelId === 'viewport-panel' ? 'viewport-dock-content-host' : panelId);
        const content = document.getElementById(contentId);
        if (!panel || !content) return;

        panel.appendChild(content);
        (content as HTMLElement).style.flex = '1';
    }

    private reorderViewportTabs(source: EditorViewportTab, target: EditorViewportTab) {
        EditorSettings.viewportTabOrder = this.reorderList(EditorSettings.viewportTabOrder, source, target);
        this.applyTabOrders();
        this.saveLayout();
    }

    private reorderBottomTabs(source: EditorBottomTab, target: EditorBottomTab) {
        EditorSettings.bottomTabOrder = this.reorderList(EditorSettings.bottomTabOrder, source, target);
        this.applyTabOrders();
        this.saveLayout();
    }

    private reorderViewportDockTabs(source: DockableEditorView, target: DockableEditorView) {
        EditorSettings.viewportDockTabOrder = this.reorderList(EditorSettings.viewportDockTabOrder, source, target);
        this.applyTabOrders();
        this.saveLayout();
    }

    private reorderCenterSecondaryTabs(source: DockableEditorView, target: DockableEditorView) {
        EditorSettings.centerSecondaryTabOrder = this.reorderList(EditorSettings.centerSecondaryTabOrder, source, target);
        this.applyTabOrders();
        this.saveLayout();
    }

    private reorderCenterTertiaryTabs(source: DockableEditorView, target: DockableEditorView) {
        EditorSettings.centerTertiaryTabOrder = this.reorderList(EditorSettings.centerTertiaryTabOrder, source, target);
        this.applyTabOrders();
        this.saveLayout();
    }

    private reorderInspectorTabs(source: EditorInspectorTab, target: EditorInspectorTab) {
        if (source === 'inspector') return;
        EditorSettings.inspectorTabOrder = this.reorderList(EditorSettings.inspectorTabOrder, source, target);
        if (EditorSettings.inspectorTabOrder[0] !== 'inspector') {
            EditorSettings.inspectorTabOrder = ['inspector', ...EditorSettings.inspectorTabOrder.filter((tab) => tab !== 'inspector')];
        }
        this.applyTabOrders();
        this.saveLayout();
    }

    private reorderHierarchyTabs(source: EditorHierarchyTab, target: EditorHierarchyTab) {
        if (source === 'hierarchy') return;
        EditorSettings.hierarchyTabOrder = this.reorderList(EditorSettings.hierarchyTabOrder, source, target);
        if (EditorSettings.hierarchyTabOrder[0] !== 'hierarchy') {
            EditorSettings.hierarchyTabOrder = ['hierarchy', ...EditorSettings.hierarchyTabOrder.filter((tab) => tab !== 'hierarchy')];
        }
        this.applyTabOrders();
        this.saveLayout();
    }

    private resolveDockInsertionTarget(
        host: EditorDockHost,
        targetTab?: EditorHierarchyTab | EditorInspectorTab | EditorBottomTab
    ): EditorHierarchyTab | EditorInspectorTab | EditorBottomTab | undefined {
        if (host === 'hierarchy' && targetTab === 'hierarchy') {
            return EditorSettings.hierarchyTabOrder.find((tab) => tab !== 'hierarchy');
        }

        if (host === 'inspector' && targetTab === 'inspector') {
            return EditorSettings.inspectorTabOrder.find((tab) => tab !== 'inspector');
        }

        return targetTab;
    }

    private moveDockableTabToHostEnd(tab: DockableEditorView, host: EditorDockHost) {
        if (host === 'viewport') {
            EditorSettings.viewportDockTabOrder = [
                ...EditorSettings.viewportDockTabOrder.filter((item) => item !== tab),
                tab
            ];
            this.activeViewportFocusHost = 'viewport';
            this.activeViewportDockTab = tab;
            this.setActivePanel('viewport-panel');
        } else if (host === 'center-secondary') {
            EditorSettings.centerSecondaryTabOrder = [
                ...EditorSettings.centerSecondaryTabOrder.filter((item) => item !== tab),
                tab
            ];
            this.activeViewportFocusHost = 'center-secondary';
            this.activeCenterSecondaryTab = tab;
            this.setActivePanel('viewport-panel');
        } else if (host === 'center-tertiary') {
            EditorSettings.centerTertiaryTabOrder = [
                ...EditorSettings.centerTertiaryTabOrder.filter((item) => item !== tab),
                tab
            ];
            this.activeViewportFocusHost = 'center-tertiary';
            this.activeCenterTertiaryTab = tab;
            this.setActivePanel('viewport-panel');
        } else if (host === 'bottom') {
            EditorSettings.bottomTabOrder = [
                ...EditorSettings.bottomTabOrder.filter((item) => item !== tab),
                tab
            ];
            this.activeBottomTab = tab;
            this.setActivePanel('assets-panel');
        } else if (host === 'hierarchy') {
            EditorSettings.hierarchyTabOrder = [
                'hierarchy',
                ...EditorSettings.hierarchyTabOrder.filter((item) => item !== 'hierarchy' && item !== tab),
                tab
            ];
            this.activeHierarchyTab = tab;
            this.setActivePanel('hierarchy-panel');
        } else {
            EditorSettings.inspectorTabOrder = [
                'inspector',
                ...EditorSettings.inspectorTabOrder.filter((item) => item !== 'inspector' && item !== tab),
                tab
            ];
            this.activeInspectorTab = tab;
            this.setActivePanel('inspector-panel');
        }

        this.applyTabOrders();
        this.updateDockedViewState();
        this.syncWindowMenuState();
        this.saveLayout();
    }

    private dropDockableTabOntoHost(
        targetHost: EditorDockHost,
        targetTab?: EditorHierarchyTab | EditorInspectorTab | EditorBottomTab
    ) {
        if (!this.draggedDockableTab) return;

        const sourceTab = this.draggedDockableTab;
        const sourceHost = this.getViewHost(sourceTab);
        const resolvedTargetTab = this.resolveDockInsertionTarget(targetHost, targetTab);

        if (sourceHost === targetHost && resolvedTargetTab) {
            if (targetHost === 'viewport') {
                this.reorderViewportDockTabs(sourceTab, resolvedTargetTab as DockableEditorView);
                return;
            }
            if (targetHost === 'center-secondary') {
                this.reorderCenterSecondaryTabs(sourceTab, resolvedTargetTab as DockableEditorView);
                return;
            }
            if (targetHost === 'center-tertiary') {
                this.reorderCenterTertiaryTabs(sourceTab, resolvedTargetTab as DockableEditorView);
                return;
            }
            if (targetHost === 'bottom') {
                this.reorderBottomTabs(sourceTab, resolvedTargetTab as EditorBottomTab);
                return;
            }
            if (targetHost === 'hierarchy') {
                this.reorderHierarchyTabs(sourceTab, resolvedTargetTab as EditorHierarchyTab);
                return;
            }
            this.reorderInspectorTabs(sourceTab, resolvedTargetTab as EditorInspectorTab);
            return;
        }

        if (sourceHost === targetHost && !resolvedTargetTab) {
            this.moveDockableTabToHostEnd(sourceTab, targetHost);
            return;
        }

        this.moveDockableTabToHost(sourceTab, targetHost, resolvedTargetTab);
    }

    private moveDockableTabToHost(
        tab: DockableEditorView,
        host: EditorDockHost,
        targetTab?: EditorHierarchyTab | EditorInspectorTab | EditorBottomTab,
        options?: { deferLayout?: boolean }
    ) {
        host = this.resolveDockHostTarget(host, tab);
        const currentHost = this.getViewHost(tab);
        if (currentHost === host && !targetTab) return;
        delete this.floatingDockableHomeHosts[tab];

        EditorSettings.viewHosts[tab] = host;

        EditorSettings.viewportDockTabOrder = EditorSettings.viewportDockTabOrder.filter((item) => item !== tab);
        EditorSettings.centerSecondaryTabOrder = EditorSettings.centerSecondaryTabOrder.filter((item) => item !== tab);
        EditorSettings.centerTertiaryTabOrder = EditorSettings.centerTertiaryTabOrder.filter((item) => item !== tab);
        EditorSettings.bottomTabOrder = EditorSettings.bottomTabOrder.filter((item) => item !== tab);
        EditorSettings.hierarchyTabOrder = EditorSettings.hierarchyTabOrder.filter((item) => item !== tab);
        EditorSettings.inspectorTabOrder = EditorSettings.inspectorTabOrder.filter((item) => item !== tab);

        if (host === 'viewport') {
            this.insertDockableTab(EditorSettings.viewportDockTabOrder, tab, targetTab);
            if (this.activeCenterSecondaryTab === tab) this.activeCenterSecondaryTab = null;
            if (this.activeCenterTertiaryTab === tab) this.activeCenterTertiaryTab = null;
            if (this.activeHierarchyTab === tab) this.activeHierarchyTab = 'hierarchy';
            if (this.activeInspectorTab === tab) this.activeInspectorTab = 'inspector';
            this.activeViewportFocusHost = 'viewport';
            this.activeViewportDockTab = tab;
            this.setActivePanel('viewport-panel');
        } else if (host === 'center-secondary') {
            this.insertDockableTab(EditorSettings.centerSecondaryTabOrder, tab, targetTab as DockableEditorView | undefined);
            if (this.activeViewportDockTab === tab) this.activeViewportDockTab = null;
            if (this.activeCenterTertiaryTab === tab) this.activeCenterTertiaryTab = null;
            if (this.activeHierarchyTab === tab) this.activeHierarchyTab = 'hierarchy';
            if (this.activeInspectorTab === tab) this.activeInspectorTab = 'inspector';
            this.activeViewportFocusHost = 'center-secondary';
            this.activeCenterSecondaryTab = tab;
            this.setActivePanel('viewport-panel');
        } else if (host === 'center-tertiary') {
            this.insertDockableTab(EditorSettings.centerTertiaryTabOrder, tab, targetTab as DockableEditorView | undefined);
            if (this.activeViewportDockTab === tab) this.activeViewportDockTab = null;
            if (this.activeCenterSecondaryTab === tab) this.activeCenterSecondaryTab = null;
            if (this.activeHierarchyTab === tab) this.activeHierarchyTab = 'hierarchy';
            if (this.activeInspectorTab === tab) this.activeInspectorTab = 'inspector';
            this.activeViewportFocusHost = 'center-tertiary';
            this.activeCenterTertiaryTab = tab;
            this.setActivePanel('viewport-panel');
        } else if (host === 'bottom') {
            if (!EditorSettings.assetsVisible) this.setPanelVisibility('assets-panel', true, false);
            this.insertDockableTab(
                EditorSettings.bottomTabOrder,
                tab,
                targetTab && targetTab !== 'inspector' && targetTab !== 'hierarchy' ? targetTab : undefined
            );
            if (this.activeViewportDockTab === tab) this.activeViewportDockTab = null;
            if (this.activeCenterSecondaryTab === tab) this.activeCenterSecondaryTab = null;
            if (this.activeCenterTertiaryTab === tab) this.activeCenterTertiaryTab = null;
            if (this.activeHierarchyTab === tab) this.activeHierarchyTab = 'hierarchy';
            if (this.activeInspectorTab === tab) this.activeInspectorTab = 'inspector';
            this.activeBottomTab = tab;
            this.setActivePanel('assets-panel');
        } else if (host === 'hierarchy') {
            if (!EditorSettings.hierarchyVisible) this.setPanelVisibility('hierarchy-panel', true, false);
            if (this.activeViewportDockTab === tab) this.activeViewportDockTab = null;
            if (this.activeCenterSecondaryTab === tab) this.activeCenterSecondaryTab = null;
            if (this.activeCenterTertiaryTab === tab) this.activeCenterTertiaryTab = null;
            this.insertDockableTab(EditorSettings.hierarchyTabOrder, tab, this.resolveDockInsertionTarget(host, targetTab));
            if (this.activeInspectorTab === tab) this.activeInspectorTab = 'inspector';
            this.activeHierarchyTab = tab;
            this.setActivePanel('hierarchy-panel');
        } else {
            if (!EditorSettings.inspectorVisible) this.setPanelVisibility('inspector-panel', true, false);
            if (this.activeViewportDockTab === tab) this.activeViewportDockTab = null;
            if (this.activeCenterSecondaryTab === tab) this.activeCenterSecondaryTab = null;
            if (this.activeCenterTertiaryTab === tab) this.activeCenterTertiaryTab = null;
            if (this.activeHierarchyTab === tab) this.activeHierarchyTab = 'hierarchy';
            this.insertDockableTab(EditorSettings.inspectorTabOrder, tab, this.resolveDockInsertionTarget(host, targetTab));
            this.activeInspectorTab = tab;
            this.setActivePanel('inspector-panel');
        }

        this.compactCenterDockHosts();
        this.normalizeTabSettings();
        this.applyTabOrders();
        this.applyDockedViewHosts();
        this.updateDockedViewState();
        if (!options?.deferLayout) {
            this.saveLayout();
            this.resize();
        }
    }

    private dockViewToHost(view: DockableEditorView, host: EditorDockHost) {
        if (this.maximizedPanelId) this.restoreMaximizedPanel();
        this.moveDockableTabToHost(view, host, undefined, { deferLayout: true });
        this.revealDockedView(view, false, false);
        this.finalizeLayoutMutation();
    }

    private insertDockableTab<T extends string>(list: T[], tab: T, targetTab?: T) {
        if (!targetTab || !list.includes(targetTab)) {
            list.push(tab);
            return;
        }

        const index = list.indexOf(targetTab);
        list.splice(index, 0, tab);
    }

    private reorderList<T extends string>(list: T[], source: T, target: T): T[] {
        if (source === target) return [...list];

        const next = list.filter((item) => item !== source);
        const targetIndex = next.indexOf(target);
        if (targetIndex === -1) {
            next.push(source);
            return next;
        }

        next.splice(targetIndex, 0, source);
        return next;
    }

    private getViewportHostTabOrder(): Array<EditorViewportTab | DockableEditorView> {
        return [
            ...EditorSettings.viewportTabOrder,
            ...EditorSettings.viewportDockTabOrder.filter((tab) => this.getViewHost(tab) === 'viewport'),
            ...EditorSettings.centerSecondaryTabOrder.filter((tab) => this.getViewHost(tab) === 'center-secondary'),
            ...EditorSettings.centerTertiaryTabOrder.filter((tab) => this.getViewHost(tab) === 'center-tertiary')
        ];
    }

    private getActiveViewportHostTab(): EditorViewportTab | DockableEditorView {
        if (this.activeViewportFocusHost === 'center-tertiary') {
            return this.activeCenterTertiaryTab ?? this.activeCenterSecondaryTab ?? this.activeViewportDockTab ?? this.activeViewportTab;
        }
        if (this.activeViewportFocusHost === 'center-secondary') {
            return this.activeCenterSecondaryTab ?? this.activeCenterTertiaryTab ?? this.activeViewportDockTab ?? this.activeViewportTab;
        }
        return this.activeViewportDockTab ?? this.activeCenterSecondaryTab ?? this.activeCenterTertiaryTab ?? this.activeViewportTab;
    }

    private setActiveViewportHostTab(tab: EditorViewportTab | DockableEditorView) {
        if (tab === 'scene' || tab === 'game') {
            this.setTab(tab);
            return;
        }

        if (this.getViewHost(tab) === 'center-secondary') {
            this.setCenterSecondaryTab(tab);
            return;
        }

        if (this.getViewHost(tab) === 'center-tertiary') {
            this.setCenterTertiaryTab(tab);
            return;
        }

        this.setViewportDockTab(tab);
    }

    private cycleActivePanelTabs(direction: 1 | -1) {
        const resolvedPanel = this.getResolvedActivePanel(this.activePanelId);

        if (resolvedPanel === 'viewport-panel') {
            const viewportHostOrder = this.getViewportHostTabOrder();
            const activeViewportHostTab = this.getActiveViewportHostTab();
            const nextViewportHostTab = this.getAdjacentTab(viewportHostOrder, activeViewportHostTab, direction);
            this.setActiveViewportHostTab(nextViewportHostTab);
            return;
        }

        if (resolvedPanel === 'assets-panel' && EditorSettings.assetsVisible) {
            if (EditorSettings.bottomTabOrder.length === 0) return;
            const nextTab = this.getAdjacentTab(EditorSettings.bottomTabOrder, this.activeBottomTab, direction);
            this.setBottomTab(nextTab);
            return;
        }

        if (resolvedPanel === 'hierarchy-panel' && EditorSettings.hierarchyVisible) {
            if (EditorSettings.hierarchyTabOrder.length === 0) return;
            const nextTab = this.getAdjacentTab(EditorSettings.hierarchyTabOrder, this.activeHierarchyTab, direction);
            this.setHierarchyTab(nextTab);
            return;
        }

        if (resolvedPanel === 'inspector-panel' && EditorSettings.inspectorVisible) {
            if (EditorSettings.inspectorTabOrder.length === 0) return;
            const nextTab = this.getAdjacentTab(EditorSettings.inspectorTabOrder, this.activeInspectorTab, direction);
            this.setInspectorTab(nextTab);
        }
    }

    private getAdjacentTab<T extends string>(order: T[], active: T, direction: 1 | -1): T {
        const normalizedOrder = order.length > 0 ? order : [active];
        const currentIndex = Math.max(0, normalizedOrder.indexOf(active));
        const nextIndex = (currentIndex + direction + normalizedOrder.length) % normalizedOrder.length;
        return normalizedOrder[nextIndex];
    }

    private getResolvedActivePanel(panelId: EditorPanelId = this.activePanelId): EditorPanelId {
        if (panelId === 'hierarchy-panel' && EditorSettings.hierarchyVisible) return panelId;
        if (panelId === 'inspector-panel' && EditorSettings.inspectorVisible) return panelId;
        if (panelId === 'assets-panel' && EditorSettings.assetsVisible) return panelId;
        return 'viewport-panel';
    }

    private saveLayout(markCustom: boolean = true) {
        if (markCustom) {
            this.currentLayoutPreset = 'custom';
        }
        EditorSettings.activeBottomTab = this.activeBottomTab;
        EditorSettings.activeViewportTab = this.activeViewportTab;
        EditorSettings.activeViewportDockTab = this.activeViewportDockTab;
        EditorSettings.activeCenterSecondaryTab = this.activeCenterSecondaryTab;
        EditorSettings.activeCenterTertiaryTab = this.activeCenterTertiaryTab;
        EditorSettings.activeHierarchyTab = this.activeHierarchyTab;
        EditorSettings.activeInspectorTab = this.activeInspectorTab;
        EditorSettings.viewHosts = this.normalizeViewHosts(EditorSettings.viewHosts);
        EditorSettings.floatingPanels = this.normalizeFloatingPanelMap(EditorSettings.floatingPanels);
        EditorSettings.sidePanelSlots = this.normalizeSidePanelSlots(EditorSettings.sidePanelSlots);
        EditorSettings.sidePanelWidths = this.normalizeSidePanelWidths(EditorSettings.sidePanelWidths, EditorSettings.sidePanelSlots);
        this.syncLegacyPanelWidthsFromSideSlots();
        EditorSettings.viewportDockTabOrder = [...this.normalizeTabOrder(
            EditorSettings.viewportDockTabOrder,
            this.defaultBottomTabOrder.filter((tab) => EditorSettings.viewHosts[tab] === 'viewport')
        )];
        EditorSettings.bottomTabOrder = [...this.normalizeTabOrder(
            EditorSettings.bottomTabOrder,
            this.defaultBottomTabOrder.filter((tab) => EditorSettings.viewHosts[tab] === 'bottom')
        )];
        EditorSettings.centerSecondaryTabOrder = [...this.normalizeTabOrder(
            EditorSettings.centerSecondaryTabOrder,
            this.defaultBottomTabOrder.filter((tab) => EditorSettings.viewHosts[tab] === 'center-secondary')
        )];
        EditorSettings.centerTertiaryTabOrder = [...this.normalizeTabOrder(
            EditorSettings.centerTertiaryTabOrder,
            this.defaultBottomTabOrder.filter((tab) => EditorSettings.viewHosts[tab] === 'center-tertiary')
        )];
        EditorSettings.viewportTabOrder = [...this.normalizeTabOrder(EditorSettings.viewportTabOrder, this.defaultViewportTabOrder)];
        EditorSettings.hierarchyTabOrder = [...this.normalizeTabOrder(EditorSettings.hierarchyTabOrder, this.getDefaultHierarchyTabOrder())];
        EditorSettings.inspectorTabOrder = [...this.normalizeTabOrder(EditorSettings.inspectorTabOrder, this.getDefaultInspectorTabOrder())];
        EditorSettings.dockGraph = this.buildDockGraphFromLegacyState();
        EditorSettings.layoutPreset = this.currentLayoutPreset;
        EditorSettings.activePanelId = this.getResolvedActivePanel(this.activePanelId);
        EditorSettings.floatingDockableHomeHosts = this.normalizeFloatingDockableHomeHosts(this.floatingDockableHomeHosts);
        EditorSettings.prefabApplyTargetRootIds = this.serializePrefabApplyTargetRootIds();
        EditorSettings.save();
    }

    private resetLayout() {
        const previousLayout = this.captureLayoutState();
        this.maximizedPanelId = null;
        this.applyLayoutSnapshotSafely({
            hierarchyWidth: 250,
            inspectorWidth: 320,
            sidePanelWidths: { ...this.defaultSidePanelWidths },
            assetsHeight: 200,
            hierarchyVisible: true,
            inspectorVisible: true,
            assetsVisible: true,
            activeBottomTab: 'project',
            activeViewportTab: 'scene',
            activeViewportDockTab: null,
            viewportDockTabOrder: [...this.defaultViewportDockTabOrder],
            activeCenterSecondaryTab: null,
            centerSecondaryTabOrder: [...this.defaultCenterSecondaryTabOrder],
            activeCenterTertiaryTab: null,
            centerTertiaryTabOrder: [...this.defaultCenterTertiaryTabOrder],
            activeHierarchyTab: 'hierarchy',
            hierarchyTabOrder: [...this.defaultHierarchyTabOrder],
            activeInspectorTab: 'inspector',
            inspectorTabOrder: [...this.defaultInspectorTabOrder],
            bottomTabOrder: [...this.defaultBottomTabOrder],
            viewportTabOrder: [...this.defaultViewportTabOrder],
            viewHosts: { ...this.defaultViewHosts },
            dockGraph: this.normalizeDockGraph(undefined),
            floatingDockableHomeHosts: {},
            floatingPanels: {},
            sidePanelSlots: { ...this.defaultSidePanelSlots },
            centerSecondaryWidth: this.defaultCenterSecondaryWidth,
            centerTertiaryWidth: this.defaultCenterTertiaryWidth,
            layoutPreset: 'default',
            activePanelId: 'viewport-panel',
            prefabApplyTargetRootIds: {}
        }, {
            fallbackLayout: previousLayout,
            fallbackPanelId: this.getResolvedActivePanel(previousLayout.activePanelId),
            warningLabel: 'Failed to reset layout. Restoring previous layout.'
        });
        this.activeViewportFocusHost = 'viewport';
    }

    private applyLayoutPreset(preset: Exclude<EditorLayoutPreset, 'custom'>) {
        const previousLayout = this.captureLayoutState();
        this.maximizedPanelId = null;
        const presetLayout: Partial<EditorLayoutSnapshot> = preset === 'default'
            ? {
                hierarchyWidth: 250,
                inspectorWidth: 320,
                sidePanelWidths: { ...this.defaultSidePanelWidths },
                assetsHeight: 200,
                hierarchyVisible: true,
                inspectorVisible: true,
                assetsVisible: true,
                activeBottomTab: 'project',
                activeViewportTab: 'scene',
                activeViewportDockTab: null,
                viewportDockTabOrder: [...this.defaultViewportDockTabOrder],
                activeCenterSecondaryTab: null,
                centerSecondaryTabOrder: [...this.defaultCenterSecondaryTabOrder],
                activeCenterTertiaryTab: null,
                centerTertiaryTabOrder: [...this.defaultCenterTertiaryTabOrder],
                activeHierarchyTab: 'hierarchy',
                hierarchyTabOrder: [...this.defaultHierarchyTabOrder],
                activeInspectorTab: 'inspector',
                inspectorTabOrder: [...this.defaultInspectorTabOrder],
                bottomTabOrder: [...this.defaultBottomTabOrder],
                viewportTabOrder: [...this.defaultViewportTabOrder],
                viewHosts: { ...this.defaultViewHosts },
                dockGraph: this.normalizeDockGraph(undefined),
                floatingDockableHomeHosts: {},
                floatingPanels: {},
                sidePanelSlots: { ...this.defaultSidePanelSlots },
                centerSecondaryWidth: this.defaultCenterSecondaryWidth,
                centerTertiaryWidth: this.defaultCenterTertiaryWidth,
                layoutPreset: 'default',
                activePanelId: 'viewport-panel',
                prefabApplyTargetRootIds: {}
            }
            : preset === 'scene'
                ? {
                    hierarchyWidth: 220,
                    inspectorWidth: 300,
                    sidePanelWidths: { left: 220, right: 300 },
                    assetsHeight: 180,
                    hierarchyVisible: true,
                    inspectorVisible: false,
                    assetsVisible: false,
                    activeBottomTab: 'project',
                    activeViewportTab: 'scene',
                    activeViewportDockTab: null,
                    viewportDockTabOrder: [...this.defaultViewportDockTabOrder],
                    activeCenterSecondaryTab: null,
                    centerSecondaryTabOrder: [...this.defaultCenterSecondaryTabOrder],
                    activeCenterTertiaryTab: null,
                    centerTertiaryTabOrder: [...this.defaultCenterTertiaryTabOrder],
                    activeHierarchyTab: 'hierarchy',
                    hierarchyTabOrder: [...this.defaultHierarchyTabOrder],
                    activeInspectorTab: 'inspector',
                    inspectorTabOrder: [...this.defaultInspectorTabOrder],
                    bottomTabOrder: [...this.defaultBottomTabOrder],
                    viewportTabOrder: [...this.defaultViewportTabOrder],
                    viewHosts: { ...this.defaultViewHosts },
                    dockGraph: this.normalizeDockGraph(undefined),
                    floatingDockableHomeHosts: {},
                    floatingPanels: {},
                    sidePanelSlots: { ...this.defaultSidePanelSlots },
                    centerSecondaryWidth: this.defaultCenterSecondaryWidth,
                    centerTertiaryWidth: this.defaultCenterTertiaryWidth,
                    layoutPreset: 'scene',
                    activePanelId: 'viewport-panel',
                    prefabApplyTargetRootIds: {}
                }
                : {
                    hierarchyWidth: 220,
                    inspectorWidth: 300,
                    sidePanelWidths: { left: 220, right: 300 },
                    assetsHeight: 260,
                    hierarchyVisible: true,
                    inspectorVisible: false,
                    assetsVisible: true,
                    activeBottomTab: 'console',
                    activeViewportTab: 'scene',
                    activeViewportDockTab: null,
                    viewportDockTabOrder: [...this.defaultViewportDockTabOrder],
                    activeCenterSecondaryTab: null,
                    centerSecondaryTabOrder: [...this.defaultCenterSecondaryTabOrder],
                    activeCenterTertiaryTab: null,
                    centerTertiaryTabOrder: [...this.defaultCenterTertiaryTabOrder],
                    activeHierarchyTab: 'hierarchy',
                    hierarchyTabOrder: [...this.defaultHierarchyTabOrder],
                    activeInspectorTab: 'inspector',
                    inspectorTabOrder: [...this.defaultInspectorTabOrder],
                    bottomTabOrder: ['console', 'project', 'render'],
                    viewportTabOrder: [...this.defaultViewportTabOrder],
                    viewHosts: { ...this.defaultViewHosts },
                    dockGraph: this.normalizeDockGraph({
                        hosts: {
                            bottom: ['console', 'project', 'render'],
                            viewport: [],
                            'center-secondary': [],
                            'center-tertiary': [],
                            hierarchy: [],
                            inspector: []
                        },
                        activeTabs: {
                            bottom: 'console'
                        }
                    }),
                    floatingDockableHomeHosts: {},
                    floatingPanels: {},
                    sidePanelSlots: { ...this.defaultSidePanelSlots },
                    centerSecondaryWidth: this.defaultCenterSecondaryWidth,
                    centerTertiaryWidth: this.defaultCenterTertiaryWidth,
                    layoutPreset: 'scripting',
                    activePanelId: 'assets-panel',
                    prefabApplyTargetRootIds: {}
                };

        this.applyLayoutSnapshotSafely(presetLayout, {
            fallbackLayout: previousLayout,
            fallbackPanelId: this.getResolvedActivePanel(previousLayout.activePanelId),
            warningLabel: `Failed to apply ${preset} layout preset. Restoring previous layout.`
        });
        this.activeViewportFocusHost = 'viewport';
    }

    private saveLayoutSlot(slot: EditorLayoutSlotId) {
        EditorSettings.savedLayouts[slot] = this.captureLayoutState();
        this.saveLayout(false);
        this.syncWindowMenuState();
    }

    private loadLayoutSlot(slot: EditorLayoutSlotId) {
        const layout = EditorSettings.savedLayouts[slot];
        if (!layout) return;

        const previousLayout = this.captureLayoutState();
        this.maximizedPanelId = null;
        try {
            this.applyLayoutState(layout);
            this.setActivePanel(this.getResolvedActivePanel(layout.activePanelId));
            this.resize();
            this.saveLayout(false);
        } catch (error) {
            console.warn(`Failed to load layout slot ${slot}. Restoring previous layout.`, error);
            this.applyLayoutState(previousLayout);
            this.setActivePanel(this.getResolvedActivePanel(previousLayout.activePanelId));
            this.resize();
            this.saveLayout(false);
        }
    }

    private syncWindowMenuState() {
        const setCheck = (id: string, checked: boolean) => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = checked ? 'x' : '';
                const menuItem = el.closest('.dropdown-item') as HTMLElement | null;
                if (menuItem) {
                    menuItem.setAttribute('aria-checked', checked ? 'true' : 'false');
                }
            }
        };
        const setMenuItemContent = (id: string, label: string, shortcut?: string) => {
            const el = document.getElementById(id);
            if (!el) return;
            const labelSpan = el.querySelector('.menu-label') as HTMLElement | null;
            if (labelSpan) {
                labelSpan.textContent = label;
            } else {
                el.textContent = label;
            }

            const shortcutSpan = el.querySelector('.shortcut') as HTMLElement | null;
            if (shortcutSpan) {
                shortcutSpan.textContent = shortcut ?? '';
                shortcutSpan.style.display = shortcut ? 'inline-block' : 'none';
            }
        };
        const setMenuDisabled = (id: string, disabled: boolean) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.toggle('disabled', disabled);
            el.setAttribute('aria-disabled', disabled ? 'true' : 'false');
        };

        setCheck('check-hierarchy', EditorSettings.hierarchyVisible);
        setCheck('check-inspector', EditorSettings.inspectorVisible);
        setCheck('check-project', this.isDockedViewVisible('project'));
        setCheck('check-console', this.isDockedViewVisible('console'));
        setCheck('check-render', this.isDockedViewVisible('render'));
        setCheck('check-preset-default', this.currentLayoutPreset === 'default');
        setCheck('check-preset-scene', this.currentLayoutPreset === 'scene');
        setCheck('check-preset-scripting', this.currentLayoutPreset === 'scripting');
        setCheck('check-preset-custom', this.currentLayoutPreset === 'custom');
        setCheck('check-layout-slot-1', Boolean(EditorSettings.savedLayouts.slot1));
        setCheck('check-layout-slot-2', Boolean(EditorSettings.savedLayouts.slot2));
        setCheck('check-dock-project-bottom', this.getViewHost('project') === 'bottom');
        setCheck('check-dock-project-viewport', this.getViewHost('project') === 'viewport');
        setCheck('check-dock-project-center-secondary', this.getViewHost('project') === 'center-secondary');
        setCheck('check-dock-project-center-tertiary', this.getViewHost('project') === 'center-tertiary');
        setCheck('check-dock-project-hierarchy', this.getViewHost('project') === 'hierarchy');
        setCheck('check-dock-project-inspector', this.getViewHost('project') === 'inspector');
        setCheck('check-dock-console-bottom', this.getViewHost('console') === 'bottom');
        setCheck('check-dock-console-viewport', this.getViewHost('console') === 'viewport');
        setCheck('check-dock-console-center-secondary', this.getViewHost('console') === 'center-secondary');
        setCheck('check-dock-console-center-tertiary', this.getViewHost('console') === 'center-tertiary');
        setCheck('check-dock-console-hierarchy', this.getViewHost('console') === 'hierarchy');
        setCheck('check-dock-console-inspector', this.getViewHost('console') === 'inspector');
        setCheck('check-dock-render-bottom', this.getViewHost('render') === 'bottom');
        setCheck('check-dock-render-viewport', this.getViewHost('render') === 'viewport');
        setCheck('check-dock-render-center-secondary', this.getViewHost('render') === 'center-secondary');
        setCheck('check-dock-render-center-tertiary', this.getViewHost('render') === 'center-tertiary');
        setCheck('check-dock-render-hierarchy', this.getViewHost('render') === 'hierarchy');
        setCheck('check-dock-render-inspector', this.getViewHost('render') === 'inspector');
        setCheck('check-hierarchy-left', this.getSidePanelSlot('hierarchy-panel') === 'left');
        setCheck('check-hierarchy-right', this.getSidePanelSlot('hierarchy-panel') === 'right');
        setCheck('check-inspector-left', this.getSidePanelSlot('inspector-panel') === 'left');
        setCheck('check-inspector-right', this.getSidePanelSlot('inspector-panel') === 'right');

        const hasExplicitSelection = this.selectedGameObjects.some((go) => go !== this.cameraGO);
        const hasSingleSelection = !!(this.selectedGameObject && this.selectedGameObject !== this.cameraGO);
        const hasSelection = hasExplicitSelection || hasSingleSelection;
        const hasClipboard = this.clipboard.length > 0;

        setMenuDisabled('menu-undo', !CommandHistory.canUndo());
        setMenuDisabled('menu-redo', !CommandHistory.canRedo());
        setMenuDisabled('menu-copy', !hasSelection);
        setMenuDisabled('menu-cut', !hasSelection);
        setMenuDisabled('menu-paste', !hasClipboard);
        setMenuDisabled('menu-paste-as-child', !(hasClipboard && hasSelection));
        setMenuDisabled('menu-duplicate', !hasSelection);
        setMenuDisabled('menu-delete', !hasSelection);
        setMenuDisabled('menu-create-empty-child', !hasSelection);
        setMenuDisabled('menu-create-empty-parent', !hasSelection);

        setMenuItemContent('menu-maximize-active', this.maximizedPanelId ? 'Restore Active Panel' : 'Maximize Active Panel', 'Shift+Space');

        if (this.activePanelId === 'viewport-panel') {
            setMenuItemContent('menu-float-active', 'Float Active Panel (Viewport Locked)');
        } else {
            setMenuItemContent(
                'menu-float-active',
                this.isPanelFloating(this.activePanelId as Exclude<EditorPanelId, 'viewport-panel'>) ? 'Restore Docked Panel' : 'Float Active Panel'
            );
        }

        const activeView = this.getActiveDockableView();
        setMenuItemContent('menu-float-active-view', activeView ? `Float ${this.getDockableViewLabel(activeView)}` : 'Float Active View (None)');

        const restorableActiveView = this.getRestorableActiveDockableView();
        setMenuItemContent(
            'menu-restore-active-view',
            restorableActiveView ? `Restore ${this.getDockableViewLabel(restorableActiveView)}` : 'Restore Active View (None)'
        );

        const detachedViewCount = this.getDetachedViewCount();
        setMenuItemContent(
            'menu-restore-detached-views',
            detachedViewCount > 0 ? `Restore Detached Views (${detachedViewCount})` : 'Restore Detached Views (None)'
        );

        const hasFloatingPanels = this.floatablePanels.some((panelId) => this.isPanelFloating(panelId));
        setMenuItemContent('menu-dock-all-floating', hasFloatingPanels ? 'Dock All Floating Panels' : 'Dock All Floating Panels (None)');
    }

    private isDockedViewVisible(view: DockableEditorView): boolean {
        const host = this.getViewHost(view);
        if (host === 'viewport') {
            return this.activeViewportDockTab === view;
        }
        if (host === 'center-secondary') {
            return this.activeCenterSecondaryTab === view;
        }
        if (host === 'center-tertiary') {
            return this.activeCenterTertiaryTab === view;
        }
        if (host === 'bottom') {
            return EditorSettings.assetsVisible && this.activeBottomTab === view;
        }
        if (host === 'hierarchy') {
            return EditorSettings.hierarchyVisible && this.activeHierarchyTab === view;
        }
        return EditorSettings.inspectorVisible && this.activeInspectorTab === view;
    }

    private initializePanelFocusTracking() {
        const panels: EditorPanelId[] = [
            'hierarchy-panel',
            'viewport-panel',
            'inspector-panel',
            'assets-panel'
        ];

        panels.forEach((panelId) => {
            const panel = document.getElementById(panelId);
            if (!panel) return;

            panel.addEventListener('pointerdown', () => this.setActivePanel(panelId));
        });

        const headerMap: Array<[string, EditorPanelId]> = [
            ['hierarchy-panel-header', 'hierarchy-panel'],
            ['viewport-panel-header', 'viewport-panel'],
            ['inspector-panel-header', 'inspector-panel'],
            ['bottom-panel-header', 'assets-panel']
        ];

        headerMap.forEach(([headerId, panelId]) => {
            const header = document.getElementById(headerId);
            if (!header) return;

            header.addEventListener('dblclick', (event) => {
                const target = event.target as HTMLElement | null;
                if (target && ['INPUT', 'BUTTON', 'SELECT', 'OPTION', 'LABEL'].includes(target.tagName)) return;
                this.toggleMaximizePanel(panelId);
            });
        });

        document.getElementById('viewport-content')?.addEventListener('pointerdown', () => this.setActiveViewportFocusHost('viewport'));
        document.getElementById('center-secondary-panel')?.addEventListener('pointerdown', () => this.setActiveViewportFocusHost('center-secondary'));
        document.getElementById('center-tertiary-panel')?.addEventListener('pointerdown', () => this.setActiveViewportFocusHost('center-tertiary'));
        document.getElementById('center-secondary-header')?.addEventListener('dblclick', () => this.toggleMaximizePanel('viewport-panel'));
        document.getElementById('center-tertiary-header')?.addEventListener('dblclick', () => this.toggleMaximizePanel('viewport-panel'));

        this.setActivePanel(this.activePanelId);
    }

    private setActiveViewportFocusHost(host: 'viewport' | 'center-secondary' | 'center-tertiary') {
        this.activeViewportFocusHost = host;
        this.setActivePanel('viewport-panel');
    }

    private setActivePanel(panelId: EditorPanelId) {
        this.activePanelId = panelId;
        EditorSettings.activePanelId = panelId;
        const panels = ['hierarchy-panel', 'viewport-panel', 'inspector-panel', 'assets-panel'];
        panels.forEach((id) => document.getElementById(id)?.classList.toggle('active-panel', id === panelId));

        if (panelId !== 'viewport-panel' && this.isPanelFloating(panelId)) {
            const floatingLayer = document.getElementById('floating-layer') as HTMLElement | null;
            const panel = document.getElementById(panelId) as HTMLElement | null;
            if (floatingLayer && panel) {
                floatingLayer.appendChild(panel);
            }
            this.bringFloatingPanelToFront(panelId);
        }
        this.updateFloatingPanelActiveState();
    }

    private toggleMaximizePanel(panelId: EditorPanelId = this.activePanelId) {
        if (panelId !== 'viewport-panel' && this.isPanelFloating(panelId)) return;
        if (this.maximizedPanelId === panelId) {
            this.restoreMaximizedPanel();
            return;
        }

        this.maximizedPanelId = panelId;
        this.applyMaximizedPanel(panelId);
    }

    private applyMaximizedPanel(panelId: EditorPanelId) {
        const hierarchyPanel = document.getElementById('hierarchy-panel') as HTMLElement | null;
        const viewportPanel = document.getElementById('viewport-panel') as HTMLElement | null;
        const inspectorPanel = document.getElementById('inspector-panel') as HTMLElement | null;
        const assetsPanel = document.getElementById('assets-panel') as HTMLElement | null;
        const leftSplitter = document.getElementById('left-splitter') as HTMLElement | null;
        const rightSplitter = document.getElementById('right-splitter') as HTMLElement | null;
        const bottomSplitter = document.getElementById('bottom-splitter') as HTMLElement | null;
        const mainArea = document.getElementById('main-area') as HTMLElement | null;

        if (!hierarchyPanel || !viewportPanel || !inspectorPanel || !assetsPanel || !mainArea) return;

        hierarchyPanel.style.display = panelId === 'hierarchy-panel' ? 'flex' : 'none';
        viewportPanel.style.display = panelId === 'viewport-panel' ? 'flex' : 'none';
        inspectorPanel.style.display = panelId === 'inspector-panel' ? 'flex' : 'none';
        assetsPanel.style.display = panelId === 'assets-panel' ? 'flex' : 'none';

        if (leftSplitter) leftSplitter.style.display = 'none';
        if (rightSplitter) rightSplitter.style.display = 'none';
        if (bottomSplitter) bottomSplitter.style.display = 'none';

        mainArea.style.display = panelId === 'assets-panel' ? 'none' : 'flex';

        if (panelId === 'hierarchy-panel') hierarchyPanel.style.flex = '1 1 auto';
        if (panelId === 'viewport-panel') viewportPanel.style.flex = '1 1 auto';
        if (panelId === 'inspector-panel') inspectorPanel.style.flex = '1 1 auto';
        if (panelId === 'assets-panel') assetsPanel.style.flex = '1 1 auto';

        this.setActivePanel(panelId);
        this.syncWindowMenuState();
        this.resize();
    }

    private restoreMaximizedPanel() {
        if (!this.maximizedPanelId) return;
        this.maximizedPanelId = null;
        this.applyStoredLayout();
        this.setActivePanel(this.activePanelId);
        this.resize();
    }

    private setBottomTab(tab: EditorBottomTab, save: boolean = true) {
        if (this.getViewHost(tab) !== 'bottom') {
            this.revealDockedView(tab, save);
            return;
        }

        this.activeViewportDockTab = null;
        this.activeBottomTab = tab;
        this.updateDockedViewState();
        this.syncWindowMenuState();
        if (save) this.saveLayout();
    }

    private setViewportDockTab(tab: DockableEditorView, save: boolean = true) {
        if (this.getViewHost(tab) !== 'viewport') {
            this.revealDockedView(tab, save);
            return;
        }

        this.activeViewportFocusHost = 'viewport';
        this.activeViewportDockTab = tab;
        this.updateDockedViewState();
        this.syncWindowMenuState();
        if (save) this.saveLayout();
    }

    private setCenterSecondaryTab(tab: DockableEditorView, save: boolean = true) {
        if (this.getViewHost(tab) !== 'center-secondary') {
            this.revealDockedView(tab, save);
            return;
        }

        this.activeViewportFocusHost = 'center-secondary';
        this.activeCenterSecondaryTab = tab;
        this.updateDockedViewState();
        this.syncWindowMenuState();
        if (save) this.saveLayout();
    }

    private setCenterTertiaryTab(tab: DockableEditorView, save: boolean = true) {
        if (this.getViewHost(tab) !== 'center-tertiary') {
            this.revealDockedView(tab, save);
            return;
        }

        this.activeViewportFocusHost = 'center-tertiary';
        this.activeCenterTertiaryTab = tab;
        this.updateDockedViewState();
        this.syncWindowMenuState();
        if (save) this.saveLayout();
    }

    private setHierarchyTab(tab: EditorHierarchyTab, save: boolean = true) {
        if (tab !== 'hierarchy' && this.getViewHost(tab) !== 'hierarchy') {
            this.revealDockedView(tab, save);
            return;
        }

        this.activeHierarchyTab = tab;
        this.updateDockedViewState();
        this.syncWindowMenuState();
        if (save) this.saveLayout();
    }

    private setInspectorTab(tab: EditorInspectorTab, save: boolean = true) {
        if (tab !== 'inspector' && this.getViewHost(tab) !== 'inspector') {
            this.revealDockedView(tab, save);
            return;
        }

        this.activeInspectorTab = tab;
        this.updateDockedViewState();
        this.syncWindowMenuState();
        if (save) this.saveLayout();
    }

    private updateDockedViewState() {
        const resolvedBottomTab = EditorSettings.bottomTabOrder.includes(this.activeBottomTab)
            ? this.activeBottomTab
            : (EditorSettings.bottomTabOrder[0] ?? null);
        const resolvedViewportDockTab = this.activeViewportDockTab && EditorSettings.viewportDockTabOrder.includes(this.activeViewportDockTab)
            ? this.activeViewportDockTab
            : (EditorSettings.viewportDockTabOrder[0] ?? null);
        const resolvedCenterSecondaryTab = this.activeCenterSecondaryTab && EditorSettings.centerSecondaryTabOrder.includes(this.activeCenterSecondaryTab)
            ? this.activeCenterSecondaryTab
            : (EditorSettings.centerSecondaryTabOrder[0] ?? null);
        const resolvedCenterTertiaryTab = this.activeCenterTertiaryTab && EditorSettings.centerTertiaryTabOrder.includes(this.activeCenterTertiaryTab)
            ? this.activeCenterTertiaryTab
            : (EditorSettings.centerTertiaryTabOrder[0] ?? null);
        const resolvedHierarchyTab = EditorSettings.hierarchyTabOrder.includes(this.activeHierarchyTab)
            ? this.activeHierarchyTab
            : 'hierarchy';
        const resolvedInspectorTab = EditorSettings.inspectorTabOrder.includes(this.activeInspectorTab)
            ? this.activeInspectorTab
            : 'inspector';

        this.activeBottomTab = resolvedBottomTab ?? this.activeBottomTab;
        this.activeViewportDockTab = resolvedViewportDockTab;
        this.activeCenterSecondaryTab = resolvedCenterSecondaryTab;
        this.activeCenterTertiaryTab = resolvedCenterTertiaryTab;
        this.activeHierarchyTab = resolvedHierarchyTab;
        this.activeInspectorTab = resolvedInspectorTab;

        const dockableTabs: DockableEditorView[] = ['project', 'console', 'render'];

        const tabState: Array<{ tabId: string; active: boolean }> = [
            { tabId: 'tab-hierarchy', active: resolvedHierarchyTab === 'hierarchy' },
            { tabId: 'tab-inspector', active: resolvedInspectorTab === 'inspector' },
            ...dockableTabs.map((tab) => ({
                tabId: this.getBottomTabId(tab),
                active:
                    this.getViewHost(tab) === 'bottom'
                        ? resolvedBottomTab === tab
                        : this.getViewHost(tab) === 'viewport'
                            ? resolvedViewportDockTab === tab
                        : this.getViewHost(tab) === 'center-secondary'
                            ? resolvedCenterSecondaryTab === tab
                        : this.getViewHost(tab) === 'center-tertiary'
                            ? resolvedCenterTertiaryTab === tab
                        : this.getViewHost(tab) === 'hierarchy'
                            ? resolvedHierarchyTab === tab
                            : resolvedInspectorTab === tab
            }))
        ];

        tabState.forEach(({ tabId, active }) => {
            const tabEl = document.getElementById(tabId) as HTMLElement | null;
            if (!tabEl) return;
            tabEl.classList.toggle('active-tab', active);
        });

        dockableTabs.forEach((tab) => {
            const tabEl = document.getElementById(this.getBottomTabId(tab)) as HTMLElement | null;
            if (!tabEl) return;
            tabEl.classList.toggle('detached-view', this.isDockableViewDetached(tab));
        });

        dockableTabs.forEach((tab) => {
            const contentEl = document.getElementById(this.getContentIdForDockableView(tab)) as HTMLElement | null;
            if (!contentEl) return;

            const host = this.getViewHost(tab);
            const active = host === 'viewport'
                ? resolvedViewportDockTab === tab
                : host === 'center-secondary'
                ? resolvedCenterSecondaryTab === tab
                : host === 'center-tertiary'
                ? resolvedCenterTertiaryTab === tab
                : host === 'bottom'
                ? resolvedBottomTab === tab
                : host === 'hierarchy'
                    ? resolvedHierarchyTab === tab
                    : resolvedInspectorTab === tab;
            contentEl.style.display = active ? 'block' : 'none';
        });

        const hierarchyContent = document.getElementById('hierarchy-content') as HTMLElement | null;
        if (hierarchyContent) {
            hierarchyContent.style.display = resolvedHierarchyTab === 'hierarchy' ? 'block' : 'none';
        }
        const hierarchyTools = document.getElementById('hierarchy-panel-tools') as HTMLElement | null;
        if (hierarchyTools) {
            hierarchyTools.style.display = resolvedHierarchyTab === 'hierarchy' ? 'flex' : 'none';
        }

        const inspectorContent = document.getElementById('inspector-content') as HTMLElement | null;
        if (inspectorContent) {
            inspectorContent.style.display = resolvedInspectorTab === 'inspector' ? 'block' : 'none';
        }

        if (resolvedViewportDockTab === 'render' || resolvedCenterSecondaryTab === 'render' || resolvedCenterTertiaryTab === 'render' || resolvedBottomTab === 'render' || resolvedHierarchyTab === 'render' || resolvedInspectorTab === 'render') {
            this.renderSettingsWindow.refresh();
        }

        this.updateViewportHostState();
    }

    private revealDockedView(view: DockableEditorView, save: boolean = true, resize: boolean = true) {
        if (this.maximizedPanelId) this.restoreMaximizedPanel();

        const host = this.getViewHost(view);
        if (host === 'viewport') {
            this.activeViewportDockTab = view;
            this.setActiveViewportFocusHost('viewport');
            this.setViewportDockTab(view, save);
        } else if (host === 'center-secondary') {
            this.activeCenterSecondaryTab = view;
            this.setActiveViewportFocusHost('center-secondary');
            this.setCenterSecondaryTab(view, save);
        } else if (host === 'center-tertiary') {
            if (!this.isCenterSecondaryVisible()) {
                this.moveDockableTabToHost(view, 'center-secondary', undefined, { deferLayout: !save && !resize });
                if (!save && !resize) {
                    this.revealDockedView(view, save, resize);
                    return;
                }
                return;
            }
            this.activeCenterTertiaryTab = view;
            this.setActiveViewportFocusHost('center-tertiary');
            this.setCenterTertiaryTab(view, save);
        } else if (host === 'bottom') {
            if (!EditorSettings.assetsVisible) this.setPanelVisibility('assets-panel', true, false);
            this.activeBottomTab = view;
            this.setActivePanel('assets-panel');
            this.setBottomTab(view, save);
        } else if (host === 'hierarchy') {
            if (!EditorSettings.hierarchyVisible) this.setPanelVisibility('hierarchy-panel', true, false);
            this.activeHierarchyTab = view;
            this.setActivePanel('hierarchy-panel');
            this.setHierarchyTab(view, save);
        } else {
            if (!EditorSettings.inspectorVisible) this.setPanelVisibility('inspector-panel', true, false);
            this.activeInspectorTab = view;
            this.setActivePanel('inspector-panel');
            this.setInspectorTab(view, save);
        }
        if (resize) this.resize();
    }

    private toggleDockedView(view: DockableEditorView) {
        const host = this.getViewHost(view);
        const isVisible = this.isDockedViewVisible(view);

        if (!isVisible) {
            this.revealDockedView(view);
            return;
        }

        if (host === 'viewport') {
            this.activeViewportDockTab = null;
            this.setTab(this.activeViewportTab, false);
            this.setActivePanel('viewport-panel');
        } else if (host === 'center-secondary') {
            const fallback = EditorSettings.centerSecondaryTabOrder.find((tab) => tab !== view) ?? null;
            if (fallback) {
                this.setCenterSecondaryTab(fallback, false);
                this.setActiveViewportFocusHost('center-secondary');
            } else {
                this.activeCenterSecondaryTab = null;
                this.setActiveViewportFocusHost(this.activeCenterTertiaryTab ? 'center-tertiary' : 'viewport');
            }
        } else if (host === 'center-tertiary') {
            const fallback = EditorSettings.centerTertiaryTabOrder.find((tab) => tab !== view) ?? null;
            if (fallback) {
                this.setCenterTertiaryTab(fallback, false);
                this.setActiveViewportFocusHost('center-tertiary');
            } else {
                this.activeCenterTertiaryTab = null;
                this.setActiveViewportFocusHost(this.activeCenterSecondaryTab ? 'center-secondary' : 'viewport');
            }
        } else if (host === 'bottom') {
            const fallback = EditorSettings.bottomTabOrder.find((tab) => tab !== view) ?? null;
            if (fallback) {
                this.setBottomTab(fallback, false);
                this.setActivePanel('assets-panel');
            } else {
                this.setPanelVisibility('assets-panel', false, false);
                if (this.activePanelId === 'assets-panel') {
                    this.setActivePanel('viewport-panel');
                }
            }
        } else if (host === 'hierarchy') {
            this.setHierarchyTab('hierarchy', false);
            this.setActivePanel('hierarchy-panel');
        } else {
            this.setInspectorTab('inspector', false);
            this.setActivePanel('inspector-panel');
        }

        this.syncWindowMenuState();
        this.resize();
        this.saveLayout();
    }

    private initializeMenuPresentation() {
        const menuBar = document.getElementById('menu-bar');
        menuBar?.setAttribute('role', 'menubar');

        const dropdownItems = Array.from(document.querySelectorAll('.dropdown-item')) as HTMLElement[];
        dropdownItems.forEach((item) => {
            const existingLabel = item.querySelector('.menu-label');
            if (!existingLabel) {
                const shortcut = item.querySelector('.shortcut');
                const check = item.querySelector('.menu-check');
                const textNodes = Array.from(item.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
                const labelText = textNodes.map((node) => node.textContent?.trim() ?? '').join(' ').trim();
                textNodes.forEach((node) => item.removeChild(node));

                if (labelText.length > 0) {
                    const labelSpan = document.createElement('span');
                    labelSpan.className = 'menu-label';
                    labelSpan.textContent = labelText;
                    const preferredReference = shortcut ?? check ?? item.firstChild;
                    const referenceNode = preferredReference?.parentNode === item
                        ? preferredReference
                        : null;
                    if (referenceNode) {
                        item.insertBefore(labelSpan, referenceNode);
                    } else {
                        item.appendChild(labelSpan);
                    }
                }
            }

            const hasSubmenu = item.classList.contains('submenu');
            const hasCheck = !!item.querySelector('.menu-check');
            item.setAttribute('role', hasCheck ? 'menuitemcheckbox' : 'menuitem');
            item.setAttribute('tabindex', '-1');
            item.setAttribute('aria-disabled', item.classList.contains('disabled') ? 'true' : 'false');
            if (!item.title) {
                const label = (item.querySelector('.menu-label') as HTMLElement | null)?.textContent?.trim() ?? item.textContent?.trim() ?? '';
                const shortcut = (item.querySelector('.shortcut') as HTMLElement | null)?.textContent?.trim() ?? '';
                item.title = shortcut ? `${label} (${shortcut})` : label;
            }
            if (hasSubmenu) {
                item.setAttribute('aria-haspopup', 'true');
                item.setAttribute('aria-expanded', 'false');
            }
        });

        const menuItems = Array.from(document.querySelectorAll('.menu-item')) as HTMLElement[];
        menuItems.forEach((item) => {
            item.setAttribute('role', 'menuitem');
            item.setAttribute('aria-haspopup', 'true');
            item.setAttribute('aria-expanded', 'false');
            if (!item.title) {
                const label = item.childNodes[0]?.textContent?.trim() ?? 'Menu';
                item.title = `${label} Menu`;
            }
            const dropdown = item.querySelector(':scope > .dropdown-content') as HTMLElement | null;
            dropdown?.setAttribute('role', 'menu');
        });

        const separators = Array.from(document.querySelectorAll('.dropdown-content hr')) as HTMLHRElement[];
        separators.forEach((separator) => separator.setAttribute('role', 'separator'));
    }

    private initializeMenuEvents() {
        const closeAllMenus = () => {
            const openMenus = Array.from(document.querySelectorAll('.menu-item.menu-open')) as HTMLElement[];
            openMenus.forEach((item) => {
                item.classList.remove('menu-open');
                item.setAttribute('aria-expanded', 'false');
            });

            const openSubmenus = Array.from(document.querySelectorAll('.dropdown-item.submenu.submenu-open')) as HTMLElement[];
            openSubmenus.forEach((item) => {
                item.classList.remove('submenu-open');
                item.setAttribute('aria-expanded', 'false');
            });
        };

        const bindMenuAction = (id: string, handler: () => void) => {
            document.getElementById(id)?.addEventListener('click', (event) => {
                const target = event.currentTarget as HTMLElement | null;
                if (target?.classList.contains('disabled') || target?.getAttribute('aria-disabled') === 'true') {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                handler();
                closeAllMenus();
            });
        };

        const menuItems = Array.from(document.querySelectorAll('.menu-item')) as HTMLElement[];
        const getEnabledItems = (menu: HTMLElement) => Array.from(menu.querySelectorAll<HTMLElement>(':scope > .dropdown-item'))
            .filter((entry) => entry.getAttribute('aria-disabled') !== 'true' && !entry.classList.contains('disabled'));
        const focusMenuEntry = (menuItem: HTMLElement, position: 'first' | 'last' = 'first') => {
            const dropdown = menuItem.querySelector<HTMLElement>(':scope > .dropdown-content');
            if (!dropdown) return;
            closeAllMenus();
            menuItem.classList.add('menu-open');
            menuItem.setAttribute('aria-expanded', 'true');
            const entries = getEnabledItems(dropdown);
            entries[position === 'first' ? 0 : entries.length - 1]?.focus();
        };

        menuItems.forEach((item, index) => {
            item.tabIndex = index === 0 ? 0 : -1;
            item.addEventListener('click', (event) => {
                const clickTarget = event.target as HTMLElement | null;
                if (clickTarget?.closest('.dropdown-content')) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();
                const shouldOpen = !item.classList.contains('menu-open');
                closeAllMenus();
                if (shouldOpen) {
                    item.classList.add('menu-open');
                    item.setAttribute('aria-expanded', 'true');
                }
            });
            item.addEventListener('mouseenter', () => item.setAttribute('aria-expanded', 'true'));
            item.addEventListener('mouseleave', () => {
                if (!item.classList.contains('menu-open')) {
                    item.setAttribute('aria-expanded', 'false');
                }
            });
            item.addEventListener('keydown', (event: KeyboardEvent) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    focusMenuEntry(item, event.key === 'ArrowUp' ? 'last' : 'first');
                    return;
                }
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                const nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + menuItems.length) % menuItems.length;
                menuItems.forEach((candidate, candidateIndex) => candidate.tabIndex = candidateIndex === nextIndex ? 0 : -1);
                menuItems[nextIndex].focus();
            });
        });

        const submenuItems = Array.from(document.querySelectorAll('.dropdown-item.submenu')) as HTMLElement[];
        submenuItems.forEach((item) => {
            item.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const shouldOpen = !item.classList.contains('submenu-open');
                const siblingSubmenus = Array.from(item.parentElement?.querySelectorAll(':scope > .dropdown-item.submenu.submenu-open') ?? []) as HTMLElement[];
                siblingSubmenus.forEach((entry) => {
                    if (entry === item) return;
                    entry.classList.remove('submenu-open');
                    entry.setAttribute('aria-expanded', 'false');
                });
                item.classList.toggle('submenu-open', shouldOpen);
                item.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
            });
            item.addEventListener('mouseenter', () => item.setAttribute('aria-expanded', 'true'));
            item.addEventListener('mouseleave', () => {
                if (!item.classList.contains('submenu-open')) {
                    item.setAttribute('aria-expanded', 'false');
                }
            });
        });

        document.getElementById('menu-bar')?.addEventListener('keydown', (event: KeyboardEvent) => {
            const current = document.activeElement as HTMLElement | null;
            if (!current?.classList.contains('dropdown-item')) return;
            const menu = current.parentElement;
            if (!menu) return;
            const entries = getEnabledItems(menu);
            const currentIndex = entries.indexOf(current);

            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                entries[(currentIndex + direction + entries.length) % entries.length]?.focus();
            } else if ((event.key === 'Enter' || event.key === ' ') && !current.classList.contains('submenu')) {
                event.preventDefault();
                current.click();
            } else if ((event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') && current.classList.contains('submenu')) {
                event.preventDefault();
                current.classList.add('submenu-open');
                current.setAttribute('aria-expanded', 'true');
                const submenu = current.querySelector<HTMLElement>(':scope > .sub-dropdown');
                if (submenu) getEnabledItems(submenu)[0]?.focus();
            } else if (event.key === 'ArrowLeft' && current.closest('.sub-dropdown')) {
                event.preventDefault();
                const parentItem = current.parentElement?.closest<HTMLElement>('.dropdown-item.submenu');
                parentItem?.classList.remove('submenu-open');
                parentItem?.setAttribute('aria-expanded', 'false');
                parentItem?.focus();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                const topMenu = current.closest<HTMLElement>('.menu-item');
                closeAllMenus();
                topMenu?.focus();
            } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !current.closest('.sub-dropdown')) {
                event.preventDefault();
                const topMenu = current.closest<HTMLElement>('.menu-item');
                const topIndex = topMenu ? menuItems.indexOf(topMenu) : -1;
                if (topIndex < 0) return;
                const nextIndex = (topIndex + (event.key === 'ArrowRight' ? 1 : -1) + menuItems.length) % menuItems.length;
                focusMenuEntry(menuItems[nextIndex]);
            }
        });

        document.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key !== 'Alt' || event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            closeAllMenus();
            menuItems[0]?.focus();
        });
        document.addEventListener('click', () => closeAllMenus());

        // File Menu
        bindMenuAction('menu-new-scene', () => this.newScene());
        bindMenuAction('menu-open-scene',  async() => await this.showOpenSceneDialog());
        bindMenuAction('menu-save-scene',  async() => await this.saveActiveScene());
        bindMenuAction('menu-save-scene-as',  async() => await this.showSaveSceneAsDialog());
        bindMenuAction('menu-exit', () => this.electronAPI?.exitApp?.());

        // Edit Menu
        bindMenuAction('menu-undo', () => { CommandHistory.undo(); this.hierarchyWindow.refresh(); this.inspectorWindow.refresh(); });
        bindMenuAction('menu-redo', () => { CommandHistory.redo(); this.hierarchyWindow.refresh(); this.inspectorWindow.refresh(); });
        bindMenuAction('menu-copy', () => this.copySelected());
        bindMenuAction('menu-cut', () => this.cutSelected());
        bindMenuAction('menu-paste', () => this.pasteSelected());
        bindMenuAction('menu-paste-as-child', () => this.pasteAsChildOfSelection());
        bindMenuAction('menu-duplicate', () => this.duplicateSelected());
        bindMenuAction('menu-delete', () => this.deleteSelected());

        // GameObject Menu
        bindMenuAction('menu-create-empty', () => this.createEmptyGameObject());
        bindMenuAction('menu-create-empty-child', () => this.createEmptyChildForSelection());
        bindMenuAction('menu-create-empty-parent', () => this.createEmptyParentForSelection());
        bindMenuAction('create-cube', () => this.createPrimitive('Cube'));
        bindMenuAction('create-sphere', () => this.createPrimitive('Sphere'));
        bindMenuAction('create-capsule', () => this.createPrimitive('Capsule'));
        bindMenuAction('create-cylinder', () => this.createPrimitive('Cylinder'));
        bindMenuAction('create-plane', () => this.createPrimitive('Plane'));
        bindMenuAction('create-quad', () => this.createPrimitive('Quad'));
        bindMenuAction('create-camera', () => this.createPrimitive('Camera'));
        bindMenuAction('create-directional-light', () => this.createDirectionalLight());
        bindMenuAction('create-point-light', () => this.createPointLight());
        bindMenuAction('create-spot-light', () => this.createSpotLight());
        bindMenuAction('create-audio-source', () => this.createAudioSourceObject());
        bindMenuAction('create-ui-canvas', () => this.createUICanvas());
        bindMenuAction('create-ui-image', () => this.createUIElement('Image'));
        bindMenuAction('create-ui-text', () => this.createUIElement('Text'));
        bindMenuAction('create-ui-button', () => this.createUIElement('Button'));
        bindMenuAction('create-ui-input-field', () => this.createUIElement('InputField'));
        bindMenuAction('create-ui-dropdown', () => this.createUIElement('Dropdown'));
        bindMenuAction('create-ui-toggle', () => this.createUIElement('Toggle'));
        bindMenuAction('create-ui-slider', () => this.createUIElement('Slider'));
        bindMenuAction('create-ui-scrollbar', () => this.createUIElement('Scrollbar'));
        bindMenuAction('create-ui-scroll-view', () => this.createUIElement('ScrollView'));

        // Window Menu
        bindMenuAction('toggle-hierarchy', () => this.togglePanel('hierarchy-panel'));
        bindMenuAction('toggle-inspector', () => this.togglePanel('inspector-panel'));
        bindMenuAction('toggle-project', () => this.toggleDockedView('project'));
        bindMenuAction('toggle-console', () => this.toggleDockedView('console'));
        bindMenuAction('toggle-render', () => this.toggleDockedView('render'));
        bindMenuAction('menu-maximize-active', () => this.toggleMaximizePanel());
        bindMenuAction('menu-float-active', () => this.toggleFloatingPanel());
        bindMenuAction('menu-float-active-view', () => this.floatActiveDockableView());
        bindMenuAction('menu-restore-active-view', () => this.restoreActiveDetachedView());
        bindMenuAction('menu-restore-detached-views', () => this.restoreDetachedViews());
        bindMenuAction('menu-dock-all-floating', () => this.dockAllFloatingPanels());
        bindMenuAction('menu-next-tab', () => this.cycleActivePanelTabs(1));
        bindMenuAction('menu-previous-tab', () => this.cycleActivePanelTabs(-1));
        bindMenuAction('menu-reset-layout', () => this.resetLayout());
        bindMenuAction('menu-preset-default', () => this.applyLayoutPreset('default'));
        bindMenuAction('menu-preset-scene', () => this.applyLayoutPreset('scene'));
        bindMenuAction('menu-preset-scripting', () => this.applyLayoutPreset('scripting'));
        bindMenuAction('menu-save-layout-slot-1', () => this.saveLayoutSlot('slot1'));
        bindMenuAction('menu-load-layout-slot-1', () => this.loadLayoutSlot('slot1'));
        bindMenuAction('menu-save-layout-slot-2', () => this.saveLayoutSlot('slot2'));
        bindMenuAction('menu-load-layout-slot-2', () => this.loadLayoutSlot('slot2'));
        bindMenuAction('menu-dock-project-bottom', () => this.dockViewToHost('project', 'bottom'));
        bindMenuAction('menu-dock-project-viewport', () => this.dockViewToHost('project', 'viewport'));
        bindMenuAction('menu-dock-project-center-secondary', () => this.dockViewToHost('project', 'center-secondary'));
        bindMenuAction('menu-dock-project-center-tertiary', () => this.dockViewToHost('project', 'center-tertiary'));
        bindMenuAction('menu-dock-project-hierarchy', () => this.dockViewToHost('project', 'hierarchy'));
        bindMenuAction('menu-dock-project-inspector', () => this.dockViewToHost('project', 'inspector'));
        bindMenuAction('menu-dock-console-bottom', () => this.dockViewToHost('console', 'bottom'));
        bindMenuAction('menu-dock-console-viewport', () => this.dockViewToHost('console', 'viewport'));
        bindMenuAction('menu-dock-console-center-secondary', () => this.dockViewToHost('console', 'center-secondary'));
        bindMenuAction('menu-dock-console-center-tertiary', () => this.dockViewToHost('console', 'center-tertiary'));
        bindMenuAction('menu-dock-console-hierarchy', () => this.dockViewToHost('console', 'hierarchy'));
        bindMenuAction('menu-dock-console-inspector', () => this.dockViewToHost('console', 'inspector'));
        bindMenuAction('menu-dock-render-bottom', () => this.dockViewToHost('render', 'bottom'));
        bindMenuAction('menu-dock-render-viewport', () => this.dockViewToHost('render', 'viewport'));
        bindMenuAction('menu-dock-render-center-secondary', () => this.dockViewToHost('render', 'center-secondary'));
        bindMenuAction('menu-dock-render-center-tertiary', () => this.dockViewToHost('render', 'center-tertiary'));
        bindMenuAction('menu-dock-render-hierarchy', () => this.dockViewToHost('render', 'hierarchy'));
        bindMenuAction('menu-dock-render-inspector', () => this.dockViewToHost('render', 'inspector'));
        bindMenuAction('menu-hierarchy-left', () => this.setSidePanelSlot('hierarchy-panel', 'left'));
        bindMenuAction('menu-hierarchy-right', () => this.setSidePanelSlot('hierarchy-panel', 'right'));
        bindMenuAction('menu-inspector-left', () => this.setSidePanelSlot('inspector-panel', 'left'));
        bindMenuAction('menu-inspector-right', () => this.setSidePanelSlot('inspector-panel', 'right'));
        bindMenuAction('menu-swap-side-panels', () => this.swapSidePanels());
    }

    private setSidePanelSlot(
        panelId: 'hierarchy-panel' | 'inspector-panel',
        slot: EditorSideDockSlot
    ) {
        const nextSlots = this.normalizeSidePanelSlots({
            ...EditorSettings.sidePanelSlots,
            [panelId]: slot
        });
        const changed = nextSlots['hierarchy-panel'] !== EditorSettings.sidePanelSlots['hierarchy-panel']
            || nextSlots['inspector-panel'] !== EditorSettings.sidePanelSlots['inspector-panel'];
        if (!changed) return;

        EditorSettings.sidePanelSlots = nextSlots;
        this.syncLegacyPanelWidthsFromSideSlots();
        this.applyStoredLayout();
        this.setActivePanel(this.getResolvedActivePanel(this.activePanelId));
        this.resize();
        this.saveLayout();
    }

    private swapSidePanels() {
        EditorSettings.sidePanelSlots = this.normalizeSidePanelSlots({
            'hierarchy-panel': this.getOppositeSideDockSlot(this.getSidePanelSlot('hierarchy-panel')),
            'inspector-panel': this.getOppositeSideDockSlot(this.getSidePanelSlot('inspector-panel'))
        });
        this.syncLegacyPanelWidthsFromSideSlots();
        this.applyStoredLayout();
        this.setActivePanel(this.getResolvedActivePanel(this.activePanelId));
        this.resize();
        this.saveLayout();
    }

    private initializeToolbarEvents() {
        const playBtn = document.getElementById('play-btn');
        const pauseBtn = document.getElementById('pause-btn');
        const stepBtn = document.getElementById('step-btn');

        if (playBtn) {
            playBtn.onclick = () => {
                if (this.isPlaying) {
                    this.playMode.exitPlayMode();
                    return;
                }
                this.playMode.enterPlayMode();
                this.isPlaying = true;
                this.isPaused = false;
                this.updatePlayModeButtons();
                this.setTab('game', false);
            };
        }

        if (pauseBtn) {
            pauseBtn.onclick = () => {
                if (!this.isPlaying) return;
                this.isPaused = !this.isPaused;
                if (this.isPaused) this.playMode.pausePlayMode();
                else this.playMode.resumePlayMode();
                this.updatePlayModeButtons();
            };
        }

        if (stepBtn) {
            stepBtn.onclick = () => {
                if (!this.isPlaying) return;
                this.isPaused = true;
                this.playMode.stepFrame();
                this.updatePlayModeButtons();
            };
        }
    }

    private initializeDragAndDrop() {
        this.sceneView.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer!.dropEffect = 'copy';
        };

        this.sceneView.ondrop =  async(e) => {
            e.preventDefault();
            const data = e.dataTransfer!.getData("text/plain");
            if (!data) return;

            try {
                const payload = JSON.parse(data);
                const rect = this.renderer.domElement.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

                const raycaster = new THREE.Raycaster();
                raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);

                // Find intersections with scene geometry
                const intersects = raycaster.intersectObjects(this.scene.threeScene.children, true);
                // Filter out helper objects like Grid, TransformControls, etc.
                const validIntersects = intersects.filter(hit => {
                    let obj: any = hit.object;
                    while (obj) {
                        if (obj === this.transformControls || obj.type === 'GridHelper' || obj.name === 'SceneGizmo') return false;
                        obj = obj.parent;
                    }
                    return true;
                });

                if (payload.type === 'prefab') {
                    const targetPos = new THREE.Vector3();
                    if (validIntersects.length > 0) {
                        targetPos.copy(validIntersects[0].point);
                    } else {
                        // Fallback to ground plane or distance
                        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
                        if (raycaster.ray.intersectPlane(plane, targetPos)) {
                            // Hit ground
                        } else {
                            raycaster.ray.at(10, targetPos);
                        }
                    }

                    const prefab = payload.fullPath
                        ? await PrefabManager.loadPrefabFromPath(payload.fullPath)
                        : await PrefabManager.loadPrefab(payload.name);
                    if (prefab) {
                        const go = prefab.instantiate();
                        go.transform.position.copy(targetPos);
                        this.scene.addGameObject(go);
                        this.selectGameObject(go);
                        this.hierarchyWindow.refresh();
                        console.log(`Instantiated ${payload.name} at`, targetPos);
                    }
                } else if (payload.type === 'material') {
                    if (validIntersects.length > 0) {
                        const hitObject = validIntersects[0].object;
                        // Find GameObject associated with this Object3D
                        const go = this.scene.gameObjects.find(g => g.object3D === hitObject || g.object3D.children.includes(hitObject));
                        if (go) {
                            const renderer = go.getComponent(MeshRenderer);
                            if (renderer) {
                                const matName = payload.name;
                                const mat = MaterialManager.getMaterial(payload.fullPath || matName);
                                if (mat) {
                                    renderer.material = mat;
                                    this.inspectorWindow.refresh();
                                    console.log(`Applied material ${matName} to ${go.name}`);
                                }
                            }
                        }
                    }
                } else if (payload.type === 'texture') {
                    if (validIntersects.length > 0) {
                        const hitObject = validIntersects[0].object;
                        const go = this.scene.gameObjects.find(g => g.object3D === hitObject || g.object3D.children.includes(hitObject));
                        if (go) {
                            const renderer = go.getComponent(MeshRenderer);
                            if (renderer && renderer.material) {
                                await AssetImporter.importTexture(payload.fullPath, (tex) => {
                                    tex.name = payload.name;
                                    renderer.material!.setMainTexture(tex);
                                    this.inspectorWindow.refresh();
                                    console.log(`Applied texture ${payload.name} to ${go.name}`);
                                });
                            }
                        }
                    }
                } else if (payload.type === 'file' && AssetImporter.isModelFile(payload.filename || payload.name)) {
                    // Model file drop — import GLTF/GLB
                    const targetPos = new THREE.Vector3();
                    if (validIntersects.length > 0) {
                        targetPos.copy(validIntersects[0].point);
                    } else {
                        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
                        if (!raycaster.ray.intersectPlane(plane, targetPos)) {
                            raycaster.ray.at(10, targetPos);
                        }
                    }

                    await AssetImporter.importModel(payload.fullPath, (rootGO) => {
                        rootGO.transform.position.copy(targetPos);
                        const cmd = new CreateGameObjectCommand(rootGO, this.scene);
                        CommandHistory.execute(cmd);
                        this.selectGameObject(rootGO);
                        this.hierarchyWindow.refresh();
                        console.log(`Imported model ${payload.name} at`, targetPos);
                    });
                }
            } catch (err) {
                console.error("Drop failed:", err);
            }

            // Also handle external file drops (from OS explorer)
            if (e.dataTransfer!.files && e.dataTransfer!.files.length > 0) {
                for (let i = 0; i < e.dataTransfer!.files.length; i++) {
                    const file = e.dataTransfer!.files[i];
                    const filePath = (file as any).path;
                    if (filePath && AssetImporter.isModelFile(file.name)) {
                        await AssetImporter.importModel(filePath, (rootGO) => {
                            const cmd = new CreateGameObjectCommand(rootGO, this.scene);
                            CommandHistory.execute(cmd);
                            this.selectGameObject(rootGO);
                            this.hierarchyWindow.refresh();
                            console.log(`Imported external model: ${file.name}`);
                        });
                    }
                }
            }
        };
    }

    private initializeSelectionEvents() {
        let isSelecting = false;
        let startPos = { x: 0, y: 0 };
        const selectionBox = document.createElement('div');
        selectionBox.style.position = 'absolute';
        selectionBox.style.border = '1px solid #3a79bb';
        selectionBox.style.background = 'rgba(58, 121, 187, 0.2)';
        selectionBox.style.pointerEvents = 'none';
        selectionBox.style.display = 'none';
        selectionBox.style.zIndex = '1000';
        this.sceneView.appendChild(selectionBox);

        const canvas = this.renderer.domElement;

        canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // Only LMB
            if (Input.getKey('AltLeft') || Input.getKey('AltRight')) return; // Orbiting
            // @ts-ignore
            if (this.transformControls.dragging) return; // Using Gizmo

            isSelecting = true;
            startPos = { x: e.clientX, y: e.clientY };

            selectionBox.style.left = `${e.clientX}px`;
            selectionBox.style.top = `${e.clientY}px`;
            selectionBox.style.width = '0px';
            selectionBox.style.height = '0px';
        });

        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            isSelecting = false;
            selectionBox.style.display = 'none';
            this.sceneClickCycleState = null;

            const raycaster = new THREE.Raycaster();
            const mouse = new THREE.Vector2();
            const bounds = canvas.getBoundingClientRect();
            mouse.x = ((e.clientX - bounds.left) / bounds.width) * 2 - 1;
            mouse.y = -((e.clientY - bounds.top) / bounds.height) * 2 + 1;
            raycaster.setFromCamera(mouse, this.camera);
            const intersects = raycaster.intersectObjects(this.scene.threeScene.children, true);

            const hitOwners = this.getSelectionCandidateOwners(intersects);
            if (hitOwners.length > 0) {
                const hitOwner = hitOwners[0];
                if (!this.selectedGameObjects.includes(hitOwner)) {
                    this.selectGameObject(hitOwner, false, 'scene');
                }
            }

            const worldPoint = this.getSceneWorldPointFromMouseEvent(e, intersects);
            this.showSceneContextMenu(e.clientX, e.clientY, worldPoint);
        });

        window.addEventListener('mousemove', (e) => {
            if (!isSelecting) return;

            selectionBox.style.display = 'block';
            const left = Math.min(startPos.x, e.clientX);
            const top = Math.min(startPos.y, e.clientY);
            const width = Math.abs(startPos.x - e.clientX);
            const height = Math.abs(startPos.y - e.clientY);

            selectionBox.style.left = `${left}px`;
            selectionBox.style.top = `${top}px`;
            selectionBox.style.width = `${width}px`;
            selectionBox.style.height = `${height}px`;
        });

        window.addEventListener('mouseup', (e) => {
            if (!isSelecting) return;
            isSelecting = false;

            selectionBox.style.display = 'none';

            const moved = Math.sqrt(Math.pow(e.clientX - startPos.x, 2) + Math.pow(e.clientY - startPos.y, 2));

            if (moved < 5) {
                // Single Click Selection
                const raycaster = new THREE.Raycaster();
                const mouse = new THREE.Vector2();
                const bounds = canvas.getBoundingClientRect();
                mouse.x = ((e.clientX - bounds.left) / bounds.width) * 2 - 1;
                mouse.y = -((e.clientY - bounds.top) / bounds.height) * 2 + 1;

                raycaster.setFromCamera(mouse, this.camera);
                const intersects = raycaster.intersectObjects(this.scene.threeScene.children, true);

                const hitOwners = this.getSelectionCandidateOwners(intersects);
                if (hitOwners.length > 0) {
                    const toggleAdditive = e.ctrlKey || e.metaKey;
                    const additiveOnly = e.shiftKey && !toggleAdditive;
                    const reverseCycle = toggleAdditive && e.shiftKey;
                    const go = this.resolveSceneClickSelection(hitOwners, e.clientX, e.clientY, reverseCycle);
                    if (go) {
                        if (additiveOnly) {
                            this.addGameObjectToSelection(go, 'scene');
                        } else {
                            this.selectGameObject(go, toggleAdditive, 'scene');
                        }
                        if (e.detail >= 2 && !toggleAdditive && !additiveOnly) {
                            this.focusOnSelection();
                        }
                    }
                } else if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                    this.selectGameObject(null, false, 'scene');
                    this.sceneClickCycleState = null;
                }
            } else {
                // Box Selection
                this.sceneClickCycleState = null;
                const bounds = canvas.getBoundingClientRect();
                const boxXMin = (Math.min(startPos.x, e.clientX) - bounds.left) / bounds.width * 2 - 1;
                const boxXMax = (Math.max(startPos.x, e.clientX) - bounds.left) / bounds.width * 2 - 1;
                const boxYMin = -((Math.max(startPos.y, e.clientY) - bounds.top) / bounds.height * 2 - 1);
                const boxYMax = -((Math.min(startPos.y, e.clientY) - bounds.top) / bounds.height * 2 - 1);

                const cameraFrustum = new THREE.Frustum();
                const projScreenMatrix = new THREE.Matrix4();
                projScreenMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
                cameraFrustum.setFromProjectionMatrix(projScreenMatrix);

                const boxTargets: GameObject[] = [];
                this.scene.gameObjects.forEach(go => {
                    if (go === this.cameraGO) return;
                    if (!cameraFrustum.intersectsObject(go.object3D)) return;
                    if (this.intersectsSelectionRectNDC(go, boxXMin, boxXMax, boxYMin, boxYMax)) {
                        boxTargets.push(go);
                    }
                });

                const additive = e.ctrlKey || e.metaKey || e.shiftKey;
                this.selectGameObjectRange(boxTargets, additive, null, 'scene');
            }
        });
    }

    private getSelectionCandidateOwners(intersects: THREE.Intersection[]): GameObject[] {
        const owners: GameObject[] = [];
        const seenIds = new Set<string>();

        intersects.forEach((hit) => {
            if (this.isSceneHelperObject(hit.object)) return;

            const owner = this.findGameObjectByObject3D(hit.object);
            if (!owner || seenIds.has(owner.id)) return;
            seenIds.add(owner.id);
            owners.push(owner);
        });

        return owners;
    }

    private resolveSceneClickSelection(candidates: GameObject[], x: number, y: number, reverse: boolean = false): GameObject {
        const now = performance.now();
        const candidateIds = candidates.map((candidate) => candidate.id);
        const previous = this.sceneClickCycleState;
        const sameCandidates = previous
            ? previous.candidateIds.length === candidateIds.length &&
            previous.candidateIds.every((id, index) => id === candidateIds[index])
            : false;
        const movedLittle = previous
            ? Math.hypot(previous.x - x, previous.y - y) <= 6
            : false;
        const withinCycleWindow = previous
            ? now - previous.time <= 800
            : false;

        const shouldCycle = !!(previous && sameCandidates && movedLittle && withinCycleWindow);
        const nextIndex = shouldCycle
            ? (reverse
                ? (previous.index - 1 + candidates.length) % candidates.length
                : (previous.index + 1) % candidates.length)
            : 0;

        this.sceneClickCycleState = {
            x,
            y,
            time: now,
            candidateIds,
            index: nextIndex
        };

        return candidates[nextIndex];
    }

    private isSceneHelperObject(object: THREE.Object3D | null): boolean {
        let current: any = object;
        while (current) {
            if (current === this.transformControls || current.type === 'GridHelper' || current.name === 'SceneGizmo') {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    private getSceneWorldPointFromMouseEvent(
        event: MouseEvent,
        intersects?: THREE.Intersection[]
    ): THREE.Vector3 {
        const hitPoint = (intersects ?? []).find((hit) => !this.isSceneHelperObject(hit.object))?.point;
        if (hitPoint) {
            return hitPoint.clone();
        }

        const mouse = new THREE.Vector2();
        const bounds = this.renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        mouse.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.camera);

        const worldPoint = new THREE.Vector3();
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        if (raycaster.ray.intersectPlane(plane, worldPoint)) {
            return worldPoint;
        }
        return raycaster.ray.at(8, worldPoint);
    }

    private showSceneContextMenu(x: number, y: number, worldPoint: THREE.Vector3): void {
        this.removeSceneContextMenu();
        const selectionTargets = this.getSelectionStateTargets();
        const hasSelection = selectionTargets.length > 0;
        const allEnabled = hasSelection && selectionTargets.every((go) => go.enabled);
        const allStatic = hasSelection && selectionTargets.every((go) => Boolean(go.isStatic));
        const primarySelection = this.selectedGameObject && this.selectedGameObject !== this.cameraGO
            ? this.selectedGameObject
            : (this.selectedGameObjects.find((go) => go !== this.cameraGO) ?? null);
        const hasParentSelection = !!primarySelection?.transform.parent;
        const hasChildSelection = (primarySelection?.transform.childCount ?? 0) > 0;
        const primaryParent = primarySelection?.transform.parent ?? null;
        const siblingIndex = primaryParent && primarySelection
            ? primaryParent.children.indexOf(primarySelection.transform)
            : -1;
        const siblingCount = primaryParent?.children.length ?? 0;
        const hasPrevSiblingSelection = siblingCount > 1 && siblingIndex > 0;
        const hasNextSiblingSelection = siblingCount > 1 && siblingIndex >= 0 && siblingIndex < (siblingCount - 1);
        const canMoveSiblingUp = this.canMoveSelectionSibling(-1);
        const canMoveSiblingDown = this.canMoveSelectionSibling(1);
        const canSetFirstSibling = this.canSetSelectionSiblingPosition('first');
        const canSetLastSibling = this.canSetSelectionSiblingPosition('last');

        const menu = document.createElement('div');
        menu.id = 'scene-context-menu';
        menu.style.cssText = `
            position: fixed; left: ${x}px; top: ${y}px;
            background: #2d2d2d; border: 1px solid #555;
            padding: 4px 0; z-index: 9999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            min-width: 210px; border-radius: 3px;
            font-family: 'Segoe UI', sans-serif;
        `;

        const addItem = (label: string, action: () => void, color?: string, disabled: boolean = false) => {
            const item = document.createElement('div');
            item.innerText = label;
            item.style.cssText = `
                padding: 5px 14px; font-size: 12px; cursor: pointer;
                color: ${color || '#eee'}; white-space: nowrap;
                opacity: ${disabled ? '0.45' : '1'};
            `;
            item.onmouseenter = () => item.style.background = disabled ? 'transparent' : '#3267ab';
            item.onmouseleave = () => item.style.background = 'transparent';
            item.onclick = (event) => {
                event.stopPropagation();
                if (disabled) return;
                action();
                this.removeSceneContextMenu();
            };
            menu.appendChild(item);
        };

        const addSeparator = () => {
            const sep = document.createElement('div');
            sep.style.cssText = 'height: 1px; background: #555; margin: 3px 0;';
            menu.appendChild(sep);
        };

        addItem('Frame Selected', () => this.focusOnSelectionOrScene(), undefined, !hasSelection);
        addItem(allEnabled ? 'Set Inactive' : 'Set Active', () => this.setSelectionActiveState(!allEnabled), undefined, !hasSelection);
        addItem(allStatic ? 'Clear Static' : 'Set Static', () => this.setSelectionStaticState(!allStatic), undefined, !hasSelection);
        addItem('Select Parent (Alt+Up)', () => this.selectParentOfSelection(), undefined, !hasParentSelection);
        addItem('Select First Child (Alt+Down)', () => this.selectFirstChildOfSelection(), undefined, !hasChildSelection);
        addItem('Select Previous Sibling (Alt+Left)', () => this.selectSiblingOfSelection(-1), undefined, !hasPrevSiblingSelection);
        addItem('Select Next Sibling (Alt+Right)', () => this.selectSiblingOfSelection(1), undefined, !hasNextSiblingSelection);
        addItem('Move Up Sibling (Ctrl/Cmd+Alt+Up)', () => this.moveSelectionSibling(-1), undefined, !canMoveSiblingUp);
        addItem('Move Down Sibling (Ctrl/Cmd+Alt+Down)', () => this.moveSelectionSibling(1), undefined, !canMoveSiblingDown);
        addItem('Set As First Sibling (Ctrl/Cmd+Alt+Home)', () => this.setSelectionSiblingPosition('first'), undefined, !canSetFirstSibling);
        addItem('Set As Last Sibling (Ctrl/Cmd+Alt+End)', () => this.setSelectionSiblingPosition('last'), undefined, !canSetLastSibling);
        addItem('Select Children', () => this.selectChildrenOfSelection(false), undefined, !hasSelection);
        addItem('Select Descendants', () => this.selectChildrenOfSelection(true), undefined, !hasSelection);
        addItem('Move Selection Here', () => this.moveSelectionToWorldPoint(worldPoint.clone()), undefined, !hasSelection);
        addItem('Snap Selection To Ground (End)', () => this.snapSelectionToGround(false), undefined, !hasSelection);
        addItem('Snap Selection To Ground Individual (Shift+End)', () => this.snapSelectionToGround(true), undefined, !hasSelection);
        addItem('Unparent Selection', () => this.unparentTopLevelSelection(), undefined, !hasSelection);
        addItem('Cut Selected', () => this.cutSelected(), undefined, !hasSelection);
        addItem('Duplicate Selected', () => this.duplicateSelected(), undefined, !hasSelection);
        addItem('Delete Selected', () => this.deleteSelected(), '#ff6b6b', !hasSelection);
        addSeparator();
        addItem('Paste Here', () => this.pasteSelected(worldPoint.clone(), true), undefined, this.clipboard.length === 0);
        addItem('Paste Here (Stacked)', () => this.pasteSelected(worldPoint.clone(), false), undefined, this.clipboard.length === 0);
        addItem('Paste As Child (Ctrl/Cmd+Shift+V)', () => this.pasteAsChildOfSelection(), undefined, this.clipboard.length === 0 || !hasSelection);
        addItem('Paste As Child Here', () => this.pasteAsChildOfSelection(worldPoint.clone(), true), undefined, this.clipboard.length === 0 || !hasSelection);
        addItem('Paste As Child Here (Stacked)', () => this.pasteAsChildOfSelection(worldPoint.clone(), false), undefined, this.clipboard.length === 0 || !hasSelection);
        addItem('Create Empty', () => this.createEmptyGameObject(undefined, worldPoint.clone()));
        addItem('Create Empty Child (Ctrl/Cmd+Alt+Shift+N)', () => this.createEmptyChildForSelection(worldPoint.clone()), undefined, !hasSelection);
        addItem('Create Empty Parent (Ctrl/Cmd+Shift+G)', () => this.createEmptyParentForSelection(worldPoint.clone()), undefined, !hasSelection);
        addItem('Create Cube', () => this.createPrimitive('Cube', undefined, worldPoint.clone()));
        addItem('Create Sphere', () => this.createPrimitive('Sphere', undefined, worldPoint.clone()));
        addItem('Create Capsule', () => this.createPrimitive('Capsule', undefined, worldPoint.clone()));
        addItem('Create Cylinder', () => this.createPrimitive('Cylinder', undefined, worldPoint.clone()));
        addItem('Create Plane', () => this.createPrimitive('Plane', undefined, worldPoint.clone()));
        addItem('Create Quad', () => this.createPrimitive('Quad', undefined, worldPoint.clone()));
        addSeparator();
        addItem('Create Directional Light', () => this.createDirectionalLight(undefined, worldPoint.clone()));
        addItem('Create Point Light', () => this.createPointLight(undefined, worldPoint.clone()));
        addItem('Create Spot Light', () => this.createSpotLight(undefined, worldPoint.clone()));
        addItem('Create Audio Source', () => this.createAudioSourceObject(undefined, worldPoint.clone()));
        addItem('Create Camera', () => this.createPrimitive('Camera', undefined, worldPoint.clone()));
        addSeparator();
        addItem('Create UI Canvas', () => this.createUICanvas());
        addItem('Create UI Image', () => this.createUIElement('Image'));
        addItem('Create UI Text', () => this.createUIElement('Text'));
        addItem('Create UI Button', () => this.createUIElement('Button'));
        addItem('Create UI Input Field', () => this.createUIElement('InputField'));
        addItem('Create UI Dropdown', () => this.createUIElement('Dropdown'));
        addItem('Create UI Toggle', () => this.createUIElement('Toggle'));
        addItem('Create UI Slider', () => this.createUIElement('Slider'));
        addItem('Create UI Scrollbar', () => this.createUIElement('Scrollbar'));
        addItem('Create UI Scroll View', () => this.createUIElement('ScrollView'));

        document.body.appendChild(menu);
        setTimeout(() => document.addEventListener('click', () => this.removeSceneContextMenu(), { once: true }), 0);
    }

    public selectChildrenOfSelection(recursive: boolean): void {
        const targets = this.getTopLevelSelectionTargets();
        if (targets.length === 0) return;

        const selectedChildren: GameObject[] = [];
        const collect = (parent: GameObject) => {
            parent.transform.children.forEach((childTransform) => {
                const child = childTransform.gameObject;
                if (child === this.cameraGO) return;
                selectedChildren.push(child);
                if (recursive) collect(child);
            });
        };

        targets.forEach((target) => collect(target));
        if (selectedChildren.length === 0) return;
        this.selectGameObjectRange(selectedChildren, false);
    }

    public selectParentOfSelection(): void {
        const primarySelection = this.selectedGameObject && this.selectedGameObject !== this.cameraGO
            ? this.selectedGameObject
            : (this.selectedGameObjects.find((go) => go !== this.cameraGO) ?? null);
        const parentGO = primarySelection?.transform.parent?.gameObject ?? null;
        if (!parentGO) return;
        this.selectGameObject(parentGO, false);
    }

    public selectFirstChildOfSelection(): void {
        const primarySelection = this.selectedGameObject && this.selectedGameObject !== this.cameraGO
            ? this.selectedGameObject
            : (this.selectedGameObjects.find((go) => go !== this.cameraGO) ?? null);
        const firstChild = primarySelection?.transform.children[0]?.gameObject ?? null;
        if (!firstChild) return;
        this.selectGameObject(firstChild, false);
    }

    public selectSiblingOfSelection(direction: 1 | -1): void {
        const primarySelection = this.selectedGameObject && this.selectedGameObject !== this.cameraGO
            ? this.selectedGameObject
            : (this.selectedGameObjects.find((go) => go !== this.cameraGO) ?? null);
        if (!primarySelection) return;
        const transform = primarySelection?.transform;
        if (!transform?.parent) return;

        const siblings = transform.parent.children;
        const currentIndex = siblings.indexOf(transform);
        const targetIndex = currentIndex + direction;
        if (targetIndex < 0 || targetIndex >= siblings.length) return;

        const sibling = siblings[targetIndex]?.gameObject ?? null;
        if (!sibling || sibling === this.cameraGO) return;
        this.selectGameObject(sibling, false);
    }

    public moveSelectionSibling(direction: 1 | -1): void {
        const plans = this.createSiblingShiftPlans(direction);
        if (plans.length === 0) return;

        CommandHistory.execute({
            name: direction < 0 ? 'Move Sibling Up' : 'Move Sibling Down',
            execute: () => plans.forEach((plan) => this.applySiblingOrderPlan(plan.after, plan.isRoot)),
            undo: () => plans.forEach((plan) => this.applySiblingOrderPlan(plan.before, plan.isRoot))
        });
        this.hierarchyWindow.refresh();
        this.inspectorWindow.refresh();
    }

    public setSelectionSiblingPosition(position: 'first' | 'last'): void {
        const plans = this.createSiblingEdgePlans(position);
        if (plans.length === 0) return;

        CommandHistory.execute({
            name: position === 'first' ? 'Set First Sibling' : 'Set Last Sibling',
            execute: () => plans.forEach((plan) => this.applySiblingOrderPlan(plan.after, plan.isRoot)),
            undo: () => plans.forEach((plan) => this.applySiblingOrderPlan(plan.before, plan.isRoot))
        });
        this.hierarchyWindow.refresh();
        this.inspectorWindow.refresh();
    }

    public canMoveSelectionSibling(direction: 1 | -1, selectedOverride?: GameObject[]): boolean {
        return this.createSiblingShiftPlans(direction, selectedOverride).length > 0;
    }

    public canSetSelectionSiblingPosition(position: 'first' | 'last', selectedOverride?: GameObject[]): boolean {
        return this.createSiblingEdgePlans(position, selectedOverride).length > 0;
    }

    private createSiblingShiftPlans(
        direction: 1 | -1,
        selectedOverride?: GameObject[]
    ): Array<{ parent: any | null; before: any[]; after: any[]; isRoot: boolean }> {
        const groups = this.getSiblingSelectionGroups(selectedOverride);
        const plans: Array<{ parent: any | null; before: any[]; after: any[]; isRoot: boolean }> = [];

        groups.forEach((selectedTransforms, parent) => {
            const before = parent ? [...parent.children] : this.getRootSiblingTransforms();
            const after = [...before];
            const selectedSet = new Set(selectedTransforms);

            if (direction < 0) {
                for (let i = 1; i < after.length; i++) {
                    if (!selectedSet.has(after[i])) continue;
                    if (selectedSet.has(after[i - 1])) continue;
                    const current = after[i];
                    after[i] = after[i - 1];
                    after[i - 1] = current;
                }
            } else {
                for (let i = after.length - 2; i >= 0; i--) {
                    if (!selectedSet.has(after[i])) continue;
                    if (selectedSet.has(after[i + 1])) continue;
                    const current = after[i];
                    after[i] = after[i + 1];
                    after[i + 1] = current;
                }
            }

            if (after.some((entry, index) => entry !== before[index])) {
                plans.push({ parent, before, after, isRoot: !parent });
            }
        });

        return plans;
    }

    private createSiblingEdgePlans(
        position: 'first' | 'last',
        selectedOverride?: GameObject[]
    ): Array<{ parent: any | null; before: any[]; after: any[]; isRoot: boolean }> {
        const groups = this.getSiblingSelectionGroups(selectedOverride);
        const plans: Array<{ parent: any | null; before: any[]; after: any[]; isRoot: boolean }> = [];

        groups.forEach((selectedTransforms, parent) => {
            const before = parent ? [...parent.children] : this.getRootSiblingTransforms();
            const selectedSet = new Set(selectedTransforms);
            const selected = before.filter((entry) => selectedSet.has(entry));
            const unselected = before.filter((entry) => !selectedSet.has(entry));
            const after = position === 'first' ? [...selected, ...unselected] : [...unselected, ...selected];

            if (after.some((entry, index) => entry !== before[index])) {
                plans.push({ parent, before, after, isRoot: !parent });
            }
        });

        return plans;
    }

    private applySiblingOrderPlan(
        orderedChildren: any[],
        isRoot: boolean
    ): void {
        if (isRoot) {
            this.applyRootSiblingOrderPlan(orderedChildren);
            return;
        }
        orderedChildren.forEach((childTransform, index) => {
            childTransform.setSiblingIndex(index);
        });
    }

    private getSiblingSelectionGroups(selectedOverride?: GameObject[]): Map<any | null, any[]> {
        const groups = new Map<any | null, any[]>();
        const selected = (selectedOverride ?? this.selectedGameObjects).filter((go) => go !== this.cameraGO);

        selected.forEach((go) => {
            const parent = go.transform.parent;
            const key = parent ?? null;
            const bucket = groups.get(key) ?? [];
            bucket.push(go.transform);
            groups.set(key, bucket);
        });

        return groups;
    }

    private getRootSiblingTransforms(): any[] {
        return this.scene.gameObjects
            .filter((go) => go !== this.cameraGO && go.transform.parent === null)
            .map((go) => go.transform);
    }

    private applyRootSiblingOrderPlan(orderedRootTransforms: any[]): void {
        const currentRoots = this.getRootSiblingTransforms();
        if (currentRoots.length !== orderedRootTransforms.length) return;

        const currentRootSet = new Set(currentRoots);
        if (orderedRootTransforms.some((entry) => !currentRootSet.has(entry))) return;

        const orderedRootGameObjects = orderedRootTransforms.map((entry) => entry.gameObject as GameObject);
        let rootCursor = 0;
        this.scene.gameObjects = this.scene.gameObjects.map((go) => {
            if (go === this.cameraGO || go.transform.parent !== null) return go;
            return orderedRootGameObjects[rootCursor++] ?? go;
        });

        const orderedRootObjects = orderedRootGameObjects.map((go) => go.object3D);
        const orderedRootSet = new Set(orderedRootObjects);
        const sceneChildren = this.scene.threeScene.children;
        let sceneChildCursor = 0;
        for (let i = 0; i < sceneChildren.length; i++) {
            if (!orderedRootSet.has(sceneChildren[i])) continue;
            sceneChildren[i] = orderedRootObjects[sceneChildCursor++] ?? sceneChildren[i];
        }
    }

    private removeSceneContextMenu(): void {
        document.getElementById('scene-context-menu')?.remove();
    }

    private findGameObjectByObject3D(object: THREE.Object3D | null): GameObject | null {
        if (!object) return null;
        let current: THREE.Object3D | null = object;
        while (current) {
            const owner = this.scene.gameObjects.find((go) => go.object3D === current);
            if (owner && owner !== this.cameraGO) return owner;
            current = current.parent;
        }
        return null;
    }

    private intersectsSelectionRectNDC(go: GameObject, minX: number, maxX: number, minY: number, maxY: number): boolean {
        const projectedRect = this.getGameObjectProjectedRectNDC(go);
        if (!projectedRect) return false;

        return !(
            projectedRect.maxX < minX ||
            projectedRect.minX > maxX ||
            projectedRect.maxY < minY ||
            projectedRect.minY > maxY
        );
    }

    private getGameObjectProjectedRectNDC(go: GameObject): { minX: number; maxX: number; minY: number; maxY: number } | null {
        const bounds = new THREE.Box3().setFromObject(go.object3D);
        const points: THREE.Vector3[] = [];
        const centerPoint = new THREE.Vector3();

        if (bounds.isEmpty()) {
            const worldPos = new THREE.Vector3();
            go.object3D.getWorldPosition(worldPos);
            points.push(worldPos);
            centerPoint.copy(worldPos);
        } else {
            points.push(new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z));
            points.push(new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z));
            points.push(new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z));
            points.push(new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z));
            points.push(new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z));
            points.push(new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z));
            points.push(new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z));
            points.push(new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z));
            points.push(bounds.getCenter(centerPoint));
        }

        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let hasValidPoint = false;

        points.forEach((point) => {
            const projected = point.clone().project(this.camera);
            if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) return;
            if (projected.z < -1 || projected.z > 1) return;
            minX = Math.min(minX, projected.x);
            maxX = Math.max(maxX, projected.x);
            minY = Math.min(minY, projected.y);
            maxY = Math.max(maxY, projected.y);
            hasValidPoint = true;
        });

        if (!hasValidPoint) {
            const projectedCenter = centerPoint.clone().project(this.camera);
            if (!Number.isFinite(projectedCenter.x) || !Number.isFinite(projectedCenter.y) || !Number.isFinite(projectedCenter.z)) {
                return null;
            }
            if (projectedCenter.z < -1 || projectedCenter.z > 1) {
                return null;
            }
            return {
                minX: projectedCenter.x,
                maxX: projectedCenter.x,
                minY: projectedCenter.y,
                maxY: projectedCenter.y
            };
        }

        return { minX, maxX, minY, maxY };
    }

    private initializeTabEvents() {
        const tabScene = document.getElementById('tab-scene');
        const tabGame = document.getElementById('tab-game');
        if (tabScene) tabScene.onclick = () => this.setTab('scene');
        if (tabGame) tabGame.onclick = () => this.setTab('game');
        document.getElementById('tab-hierarchy')?.addEventListener('click', () => this.setHierarchyTab('hierarchy'));
        document.getElementById('tab-inspector')?.addEventListener('click', () => this.setInspectorTab('inspector'));
        document.getElementById('tab-assets')?.addEventListener('click', () => this.activateDockableTab('project'));
        document.getElementById('tab-console')?.addEventListener('click', () => this.activateDockableTab('console'));
        document.getElementById('tab-render')?.addEventListener('click', () => this.activateDockableTab('render'));
        this.initializeTabKeyboardNavigation();
        this.initializeDockableTabCloseButton('tab-close-assets', 'project');
        this.initializeDockableTabCloseButton('tab-close-console', 'console');
        this.initializeDockableTabCloseButton('tab-close-render', 'render');
        this.initializeTabReordering();
    }

    private initializeTabKeyboardNavigation() {
        const syncTabs = () => {
            document.querySelectorAll<HTMLElement>('.panel-tab-strip').forEach((tabList) => {
                tabList.setAttribute('role', 'tablist');
                const tabs = Array.from(tabList.querySelectorAll<HTMLElement>(':scope > .tab'))
                    .filter((tab) => tab.offsetParent !== null);
                tabs.forEach((tab) => {
                    const selected = tab.classList.contains('active-tab');
                    tab.setAttribute('role', 'tab');
                    tab.setAttribute('aria-selected', selected ? 'true' : 'false');
                    tab.tabIndex = selected ? 0 : -1;
                });
                if (tabs.length > 0 && !tabs.some((tab) => tab.tabIndex === 0)) {
                    tabs[0].tabIndex = 0;
                }
            });
        };

        document.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
            tab.addEventListener('keydown', (event: KeyboardEvent) => {
                if (event.target !== tab) return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    tab.click();
                    syncTabs();
                    return;
                }
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

                const tabs = Array.from(tab.parentElement?.querySelectorAll<HTMLElement>(':scope > .tab') ?? [])
                    .filter((candidate) => candidate.offsetParent !== null);
                const index = tabs.indexOf(tab);
                if (index < 0 || tabs.length < 2) return;
                event.preventDefault();
                const nextIndex = event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                        ? tabs.length - 1
                        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                tabs[nextIndex].focus();
            });
        });

        const observer = new MutationObserver(syncTabs);
        document.querySelectorAll('.panel-tab-strip').forEach((tabList) => {
            observer.observe(tabList, { childList: true, subtree: false });
        });
        document.querySelectorAll('.tab').forEach((tab) => {
            observer.observe(tab, { attributes: true, attributeFilter: ['class', 'style'] });
        });
        syncTabs();
    }

    private initializeDockableTabCloseButton(buttonId: string, view: DockableEditorView) {
        const button = document.getElementById(buttonId) as HTMLButtonElement | null;
        if (!button) return;

        button.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.toggleDockedView(view);
        });
    }

    private activateDockableTab(tab: DockableEditorView) {
        if (this.getViewHost(tab) === 'viewport') {
            this.setViewportDockTab(tab);
            this.setActiveViewportFocusHost('viewport');
            return;
        }

        if (this.getViewHost(tab) === 'center-secondary') {
            this.setCenterSecondaryTab(tab);
            this.setActiveViewportFocusHost('center-secondary');
            return;
        }

        if (this.getViewHost(tab) === 'center-tertiary') {
            this.setCenterTertiaryTab(tab);
            this.setActiveViewportFocusHost('center-tertiary');
            return;
        }

        if (this.getViewHost(tab) === 'bottom') {
            this.setBottomTab(tab);
            this.setActivePanel('assets-panel');
            return;
        }

        if (this.getViewHost(tab) === 'hierarchy') {
            this.setHierarchyTab(tab);
            this.setActivePanel('hierarchy-panel');
            return;
        }

        this.setInspectorTab(tab);
        this.setActivePanel('inspector-panel');
    }

    private initializeTabReordering() {
        this.initializeViewportTabDrag('tab-scene', 'scene');
        this.initializeViewportTabDrag('tab-game', 'game');
        this.initializeDockableTabDrag('tab-assets', 'project');
        this.initializeDockableTabDrag('tab-console', 'console');
        this.initializeDockableTabDrag('tab-render', 'render');
        this.initializeStaticHostTabDropZone('tab-hierarchy', 'hierarchy', 'hierarchy');
        this.initializeStaticHostTabDropZone('tab-inspector', 'inspector', 'inspector');
        this.initializeHostContainerDropZone('viewport-dock-tabs', 'viewport');
        this.initializeHostContainerDropZone('center-secondary-tabs', 'center-secondary');
        this.initializeHostContainerDropZone('center-tertiary-tabs', 'center-tertiary');
        this.initializeHostContainerDropZone('bottom-tabs', 'bottom');
        this.initializeHostContainerDropZone('hierarchy-tabs', 'hierarchy');
        this.initializeHostContainerDropZone('inspector-tabs', 'inspector');
    }

    private initializeViewportTabDrag(tabId: string, tab: EditorViewportTab) {
        const element = document.getElementById(tabId);
        if (!element) return;

        element.setAttribute('draggable', 'true');
        element.addEventListener('dragstart', (event) => {
            this.draggedTabHost = 'viewport';
            this.draggedViewportTab = tab;
            element.classList.add('dragging-tab');
            event.dataTransfer!.effectAllowed = 'move';
        });
        element.addEventListener('dragover', (event) => {
            if (this.draggedTabHost !== 'viewport' || !this.draggedViewportTab || this.draggedViewportTab === tab) return;
            event.preventDefault();
            element.classList.add('drop-target');
        });
        element.addEventListener('dragleave', () => element.classList.remove('drop-target'));
        element.addEventListener('drop', (event) => {
            if (this.draggedTabHost !== 'viewport' || !this.draggedViewportTab) return;
            event.preventDefault();
            event.stopPropagation();
            this.reorderViewportTabs(this.draggedViewportTab, tab);
            element.classList.remove('drop-target');
        });
        element.addEventListener('dragend', () => this.clearTabDragState());
    }

    private initializeDockableTabDrag(tabId: string, tab: DockableEditorView) {
        const element = document.getElementById(tabId);
        if (!element) return;

        element.setAttribute('draggable', 'true');
        element.addEventListener('dragstart', (event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('.tab-close')) {
                event.preventDefault();
                return;
            }
            this.draggedTabHost = this.getViewHost(tab);
            this.draggedDockableTab = tab;
            this.dockableTabDropHandled = false;
            element.classList.add('dragging-tab');
            event.dataTransfer!.effectAllowed = 'move';
        });
        element.addEventListener('dragover', (event) => {
            if (!this.draggedDockableTab || this.draggedDockableTab === tab) return;
            event.preventDefault();
            element.classList.add('drop-target');
        });
        element.addEventListener('dragleave', () => element.classList.remove('drop-target'));
        element.addEventListener('drop', (event) => {
            if (!this.draggedDockableTab) return;
            event.preventDefault();
            event.stopPropagation();
            this.dockableTabDropHandled = true;
            this.dropDockableTabOntoHost(this.getViewHost(tab), tab);
            element.classList.remove('drop-target');
        });
        element.addEventListener('dragend', (event) => this.handleDockableTabDragEnd(event));
    }

    private initializeStaticHostTabDropZone(
        tabId: 'tab-hierarchy' | 'tab-inspector',
        host: 'hierarchy' | 'inspector',
        fixedTab: 'hierarchy' | 'inspector'
    ) {
        const staticTab = document.getElementById(tabId);
        if (!staticTab) return;

        staticTab.setAttribute('draggable', 'false');
        staticTab.addEventListener('dragenter', (event) => {
            if (!this.draggedDockableTab) return;
            event.preventDefault();
            this.updateDockHostHighlight(host, 1);
        });
        staticTab.addEventListener('dragover', (event) => {
            if (!this.draggedDockableTab) return;
            event.preventDefault();
            this.setDockHostHighlight(host, true);
            staticTab.classList.add('drop-target');
        });
        staticTab.addEventListener('dragleave', () => {
            staticTab.classList.remove('drop-target');
            this.updateDockHostHighlight(host, -1);
        });
        staticTab.addEventListener('drop', (event) => {
            if (!this.draggedDockableTab) return;
            event.preventDefault();
            event.stopPropagation();
            this.dockableTabDropHandled = true;
            this.dropDockableTabOntoHost(host, fixedTab);
            staticTab.classList.remove('drop-target');
            this.resetDockHostHighlight(host);
        });
    }

    private initializeHostContainerDropZone(containerId: 'viewport-dock-tabs' | 'center-secondary-tabs' | 'center-tertiary-tabs' | 'bottom-tabs' | 'hierarchy-tabs' | 'inspector-tabs', host: EditorDockHost) {
        const container = document.getElementById(containerId);
        const panel = document.getElementById(
            host === 'viewport'
                ? 'viewport-content'
                : host === 'center-secondary'
                    ? 'center-secondary-panel'
                : host === 'center-tertiary'
                    ? 'center-tertiary-panel'
                : host === 'bottom'
                    ? 'assets-panel'
                    : host === 'hierarchy'
                        ? 'hierarchy-panel'
                        : 'inspector-panel'
        );
        const header = document.getElementById(
            host === 'viewport'
                ? 'viewport-panel-header'
                : host === 'center-secondary'
                    ? 'center-secondary-header'
                : host === 'center-tertiary'
                    ? 'center-tertiary-header'
                : host === 'bottom'
                    ? 'bottom-panel-header'
                    : host === 'hierarchy'
                        ? 'hierarchy-panel-header'
                        : 'inspector-panel-header'
        );
        const contentTarget = document.getElementById(
            host === 'viewport'
                ? 'viewport-content'
                : host === 'center-secondary'
                    ? 'center-secondary-panel'
                : host === 'center-tertiary'
                    ? 'center-tertiary-panel'
                : host === 'bottom'
                    ? 'assets-panel'
                    : host === 'hierarchy'
                        ? 'hierarchy-panel'
                        : 'inspector-panel'
        );
        const targets = [panel, container, header, contentTarget].filter((element, index, array): element is HTMLElement => {
            if (!element) return false;
            return array.indexOf(element) === index;
        });
        if (targets.length === 0) return;

        targets.forEach((target) => {
            target.addEventListener('dragenter', (event) => {
                if (!this.draggedDockableTab) return;
                event.preventDefault();
                this.updateDockHostHighlight(host, 1);
            });

            target.addEventListener('dragover', (event) => {
                if (!this.draggedDockableTab) return;
                event.preventDefault();
                this.setDockHostHighlight(host, true);
            });

            target.addEventListener('dragleave', () => {
                this.updateDockHostHighlight(host, -1);
            });

            target.addEventListener('drop', (event) => {
                if (!this.draggedDockableTab) return;
                event.preventDefault();
                event.stopPropagation();
                this.dockableTabDropHandled = true;
                this.dropDockableTabOntoHost(host);
                this.resetDockHostHighlight(host);
            });
        });
    }

    private updateDockHostHighlight(host: EditorDockHost, delta: number) {
        this.dockHighlightDepth[host] = Math.max(0, this.dockHighlightDepth[host] + delta);
        this.setDockHostHighlight(host, this.dockHighlightDepth[host] > 0);
    }

    private resetDockHostHighlight(host: EditorDockHost) {
        this.dockHighlightDepth[host] = 0;
        this.setDockHostHighlight(host, false);
    }

    private setDockHostHighlight(host: EditorDockHost, active: boolean) {
        const panel = document.getElementById(
            host === 'viewport'
                ? 'viewport-content'
                : host === 'center-secondary'
                ? 'center-secondary-panel'
                : host === 'center-tertiary'
                ? 'center-tertiary-panel'
                : host === 'bottom'
                ? 'assets-panel'
                : host === 'hierarchy'
                    ? 'hierarchy-panel'
                    : 'inspector-panel'
        );
        const header = document.getElementById(
            host === 'viewport'
                ? 'viewport-panel-header'
                : host === 'center-secondary'
                ? 'center-secondary-header'
                : host === 'center-tertiary'
                ? 'center-tertiary-header'
                : host === 'bottom'
                    ? 'bottom-panel-header'
                    : host === 'hierarchy'
                    ? 'hierarchy-panel-header'
                        : 'inspector-panel-header'
        );
        const tabStrip = document.getElementById(
            host === 'viewport'
                ? 'viewport-dock-tabs'
                : host === 'center-secondary'
                    ? 'center-secondary-tabs'
                : host === 'center-tertiary'
                    ? 'center-tertiary-tabs'
                : host === 'bottom'
                    ? 'bottom-tabs'
                : host === 'hierarchy'
                    ? 'hierarchy-tabs'
                    : 'inspector-tabs'
        );
        panel?.classList.toggle('dock-target-panel', active);
        header?.classList.toggle('dock-target-header', active);
        tabStrip?.classList.toggle('drop-target-strip', active);

        if (active) {
            this.showDockHostPreview(host);
            return;
        }

        if (this.activeDockHostPreview === host) {
            const fallbackHost = (Object.entries(this.dockHighlightDepth) as Array<[EditorDockHost, number]>)
                .find(([candidateHost, depth]) => candidateHost !== host && depth > 0)?.[0] ?? null;
            if (fallbackHost) {
                this.showDockHostPreview(fallbackHost);
            } else {
                this.hideDockHostPreview();
            }
        }
    }

    private clearTabDragState() {
        this.draggedTabHost = null;
        this.draggedViewportTab = null;
        this.draggedDockableTab = null;
        this.dockableTabDropHandled = false;
        this.resetDockHostHighlight('viewport');
        this.resetDockHostHighlight('center-secondary');
        this.resetDockHostHighlight('center-tertiary');
        this.resetDockHostHighlight('bottom');
        this.resetDockHostHighlight('hierarchy');
        this.resetDockHostHighlight('inspector');
        document.querySelectorAll('.dragging-tab, .drop-target').forEach((element) => {
            element.classList.remove('dragging-tab', 'drop-target');
        });
    }

    private handleDockableTabDragEnd(event: DragEvent) {
        const draggedTab = this.draggedDockableTab;
        const shouldFloat =
            draggedTab !== null &&
            !this.dockableTabDropHandled &&
            (event.clientX !== 0 || event.clientY !== 0) &&
            (event.dataTransfer?.dropEffect ?? 'none') === 'none';

        this.clearTabDragState();

        if (!draggedTab || !shouldFloat) return;
        this.floatDockableView(draggedTab);
    }

    private showDockHostPreview(host: EditorDockHost) {
        const preview = document.getElementById('dock-host-preview') as HTMLElement | null;
        const rect = this.getDockHostPreviewRect(host);
        if (!preview || !rect) return;

        preview.dataset.host = host;
        preview.style.left = `${rect.x}px`;
        preview.style.top = `${rect.y}px`;
        preview.style.width = `${rect.width}px`;
        preview.style.height = `${rect.height}px`;
        preview.classList.add('visible');
        this.activeDockHostPreview = host;
    }

    private hideDockHostPreview() {
        this.activeDockHostPreview = null;
        document.getElementById('dock-host-preview')?.classList.remove('visible');
    }

    private getDockHostPreviewRect(host: EditorDockHost) {
        const floatingLayer = document.getElementById('floating-layer') as HTMLElement | null;
        const panel = document.getElementById(
            host === 'viewport'
                ? 'viewport-content'
                : host === 'center-secondary'
                    ? 'center-secondary-panel'
                : host === 'center-tertiary'
                    ? 'center-tertiary-panel'
                : host === 'bottom'
                    ? 'assets-panel'
                    : host === 'hierarchy'
                        ? 'hierarchy-panel'
                        : 'inspector-panel'
        ) as HTMLElement | null;
        const header = document.getElementById(
            host === 'viewport'
                ? 'viewport-panel-header'
                : host === 'center-secondary'
                    ? 'center-secondary-header'
                : host === 'center-tertiary'
                    ? 'center-tertiary-header'
                : host === 'bottom'
                    ? 'bottom-panel-header'
                    : host === 'hierarchy'
                        ? 'hierarchy-panel-header'
                        : 'inspector-panel-header'
        ) as HTMLElement | null;
        if (!floatingLayer || !panel) return null;

        const layerRect = floatingLayer.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const headerRect = header?.getBoundingClientRect();
        const topOffset = headerRect ? headerRect.bottom - panelRect.top : 0;

        return {
            x: panelRect.left - layerRect.left,
            y: panelRect.top - layerRect.top + topOffset,
            width: panelRect.width,
            height: Math.max(0, panelRect.height - topOffset)
        };
    }

    private initializeTransformControlsEvents() {
        type TransformSnapshot = {
            position: THREE.Vector3;
            rotation: THREE.Euler;
            scale: THREE.Vector3;
        };
        const cloneSnapshot = (target: GameObject): TransformSnapshot => ({
            position: target.transform.position.clone(),
            rotation: target.transform.rotation.clone(),
            scale: target.transform.scale.clone()
        });
        const applySnapshot = (target: GameObject, snapshot: TransformSnapshot) => {
            target.transform.position.copy(snapshot.position);
            target.transform.rotation.copy(snapshot.rotation);
            target.transform.scale.copy(snapshot.scale);
            target.object3D.updateMatrixWorld(true);
        };
        const snapshotChanged = (before: TransformSnapshot, after: TransformSnapshot): boolean => {
            const epsilon = 0.000001;
            return !before.position.equals(after.position)
                || Math.abs(before.rotation.x - after.rotation.x) > epsilon
                || Math.abs(before.rotation.y - after.rotation.y) > epsilon
                || Math.abs(before.rotation.z - after.rotation.z) > epsilon
                || !before.scale.equals(after.scale);
        };

        let initialSnapshotsById = new Map<string, { target: GameObject; snapshot: TransformSnapshot }>();
        let initialPivotWorld: THREE.Matrix4 | null = null;
        let initialWorldById = new Map<string, THREE.Matrix4>();
        let altDuplicateTriggeredThisDrag = false;

        window.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || !this.transformControls.dragging || initialSnapshotsById.size === 0) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            this.transformControls.reset();
            initialSnapshotsById.forEach(({ target, snapshot }) => applySnapshot(target, snapshot));
            this.syncRigidBodiesForTargets(Array.from(initialSnapshotsById.values(), ({ target }) => target));
            initialSnapshotsById = new Map();
            initialPivotWorld = null;
            initialWorldById = new Map();
            altDuplicateTriggeredThisDrag = false;
            this.updateTransformControlsAttachment();
            this.inspectorWindow.refresh();
        }, { capture: true });

        this.transformControls.addEventListener('mousedown', () => {
            if (!this.isPlaying && this.isAltModifierDown() && !altDuplicateTriggeredThisDrag && this.selectedGameObjects.length > 0) {
                this.duplicateSelected();
                altDuplicateTriggeredThisDrag = true;
            }

            const targets = this.getActiveTransformTargets();
            initialSnapshotsById = new Map();
            initialWorldById = new Map();

            targets.forEach((target) => {
                initialSnapshotsById.set(target.id, { target, snapshot: cloneSnapshot(target) });
            });

            if (this.shouldUseCenterPivotHandle() && this.multiSelectionPivotHandle) {
                this.multiSelectionPivotHandle.updateMatrixWorld(true);
                initialPivotWorld = this.multiSelectionPivotHandle.matrixWorld.clone();
                targets.forEach((target) => {
                    target.object3D.updateMatrixWorld(true);
                    initialWorldById.set(target.id, target.object3D.matrixWorld.clone());
                });
            } else {
                initialPivotWorld = null;
            }
        });

        this.transformControls.addEventListener('mouseup', () => {
            if (initialSnapshotsById.size === 0) return;

            const changedEntries: Array<{
                target: GameObject;
                before: TransformSnapshot;
                after: TransformSnapshot;
            }> = [];
            initialSnapshotsById.forEach(({ target, snapshot }) => {
                const current = cloneSnapshot(target);
                if (!snapshotChanged(snapshot, current)) return;
                changedEntries.push({
                    target,
                    before: snapshot,
                    after: current
                });
            });

            if (changedEntries.length > 0) {
                CommandHistory.execute({
                    name: changedEntries.length === 1
                        ? `Transform ${changedEntries[0].target.name}`
                        : `Transform ${changedEntries.length} objects`,
                    execute: () => {
                        changedEntries.forEach((entry) => applySnapshot(entry.target, entry.after));
                        this.syncRigidBodiesForTargets(changedEntries.map((entry) => entry.target));
                        this.updateTransformControlsAttachment();
                        this.inspectorWindow.refresh();
                    },
                    undo: () => {
                        changedEntries.forEach((entry) => applySnapshot(entry.target, entry.before));
                        this.syncRigidBodiesForTargets(changedEntries.map((entry) => entry.target));
                        this.updateTransformControlsAttachment();
                        this.inspectorWindow.refresh();
                    }
                });
            }

            initialSnapshotsById = new Map();
            initialPivotWorld = null;
            initialWorldById = new Map();
            altDuplicateTriggeredThisDrag = false;
        });

        this.transformControls.addEventListener('dragging-changed', (event: any) => {
            const controller = this.cameraGO.getComponent(EditorCameraController);
            if (controller) {
                (controller as any).enabled = !event.value;
            }
            if (!event.value) altDuplicateTriggeredThisDrag = false;
        });

        this.transformControls.addEventListener('change', () => {
            if (this.transformControls.dragging) {
                this.applyCenterPivotTransformDelta(initialPivotWorld, initialWorldById);
            }
            this.inspectorWindow.refresh();
            this.syncRigidBodiesForTargets(this.getActiveTransformTargets());
        });
    }

    private isAltModifierDown(): boolean {
        return Input.getKey('AltLeft') || Input.getKey('AltRight');
    }

    private initializeSceneCameraPointerWorkflow(controller: EditorCameraController | null | undefined): void {
        if (!controller) return;
        const canvas = this.renderer.domElement;
        let activePointerId: number | null = null;

        canvas.addEventListener('pointerdown', (event) => {
            const isOrbit = event.button === 0 && event.altKey;
            const isPanOrFly = event.button === 1 || event.button === 2;
            if (!isOrbit && !isPanOrFly) return;
            activePointerId = event.pointerId;
            controller.beginInteraction();
            canvas.setPointerCapture?.(event.pointerId);
        });

        canvas.addEventListener('pointerup', (event) => {
            if (event.pointerId !== activePointerId) return;
            controller.endInteraction();
            if (canvas.hasPointerCapture?.(event.pointerId)) {
                canvas.releasePointerCapture(event.pointerId);
            }
            activePointerId = null;
        });

        canvas.addEventListener('lostpointercapture', () => {
            if (activePointerId === null) return;
            controller.cancelInteraction();
            activePointerId = null;
        });

        window.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || activePointerId === null) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            controller.cancelInteraction();
            if (canvas.hasPointerCapture?.(activePointerId)) {
                canvas.releasePointerCapture(activePointerId);
            }
            activePointerId = null;
        }, { capture: true });
    }

    private getActiveTransformTargets(): GameObject[] {
        if (this.shouldUseCenterPivotHandle()) {
            return [...this.selectedGameObjects];
        }
        return this.selectedGameObject ? [this.selectedGameObject] : [];
    }

    private shouldUseCenterPivotHandle(): boolean {
        return this.transformPivotMode === 'center' && this.selectedGameObjects.length > 1;
    }

    private ensureMultiSelectionPivotHandle(): THREE.Object3D {
        if (!this.multiSelectionPivotHandle) {
            this.multiSelectionPivotHandle = new THREE.Object3D();
            this.multiSelectionPivotHandle.name = 'Editor Multi Pivot';
            this.multiSelectionPivotHandle.visible = false;
        }
        if (this.multiSelectionPivotHandle.parent !== this.scene.threeScene) {
            this.scene.threeScene.add(this.multiSelectionPivotHandle);
        }
        return this.multiSelectionPivotHandle;
    }

    private updateTransformControlsAttachment() {
        if (this.activeTransformToolMode === 'view') {
            this.transformControls.detach();
            return;
        }

        if (!this.selectedGameObject || this.selectedGameObjects.length === 0) {
            this.transformControls.detach();
            return;
        }

        if (this.shouldUseCenterPivotHandle()) {
            const pivotHandle = this.ensureMultiSelectionPivotHandle();
            const box = new THREE.Box3();
            this.selectedGameObjects.forEach((target) => {
                box.expandByObject(target.object3D);
            });

            const center = new THREE.Vector3();
            if (!box.isEmpty()) {
                box.getCenter(center);
            } else {
                this.selectedGameObjects.forEach((target) => center.add(target.object3D.getWorldPosition(new THREE.Vector3())));
                center.divideScalar(this.selectedGameObjects.length);
            }

            pivotHandle.position.copy(center);
            if (this.transformSpaceMode === 'local' && this.selectedGameObject) {
                pivotHandle.quaternion.copy(this.selectedGameObject.object3D.getWorldQuaternion(new THREE.Quaternion()));
            } else {
                pivotHandle.quaternion.identity();
            }
            pivotHandle.scale.set(1, 1, 1);
            pivotHandle.updateMatrixWorld(true);
            this.transformControls.attach(pivotHandle);
            return;
        }

        this.transformControls.attach(this.selectedGameObject.object3D);
    }

    private applyCenterPivotTransformDelta(
        initialPivotWorld: THREE.Matrix4 | null,
        initialWorldById: Map<string, THREE.Matrix4>
    ) {
        if (!this.shouldUseCenterPivotHandle() || !initialPivotWorld || !this.multiSelectionPivotHandle) return;

        this.multiSelectionPivotHandle.updateMatrixWorld(true);
        const inverseInitial = new THREE.Matrix4().copy(initialPivotWorld).invert();
        const deltaWorld = new THREE.Matrix4().multiplyMatrices(this.multiSelectionPivotHandle.matrixWorld, inverseInitial);

        this.selectedGameObjects.forEach((target) => {
            const startWorld = initialWorldById.get(target.id);
            if (!startWorld) return;

            const targetWorld = new THREE.Matrix4().multiplyMatrices(deltaWorld, startWorld);
            const parentWorldInverse = target.object3D.parent
                ? new THREE.Matrix4().copy(target.object3D.parent.matrixWorld).invert()
                : null;
            const targetLocal = parentWorldInverse
                ? new THREE.Matrix4().multiplyMatrices(parentWorldInverse, targetWorld)
                : targetWorld;

            const position = new THREE.Vector3();
            const quaternion = new THREE.Quaternion();
            const scale = new THREE.Vector3();
            targetLocal.decompose(position, quaternion, scale);

            target.object3D.position.copy(position);
            target.object3D.quaternion.copy(quaternion);
            target.object3D.scale.copy(scale);
            target.object3D.updateMatrixWorld(true);
        });
    }

    private syncRigidBodiesForTargets(targets: GameObject[]) {
        targets.forEach((target) => {
            const rigidBody = target.components.find((component) => component.constructor?.name === 'RigidBody') as any;
            rigidBody?.syncBodyFromTransform?.();
        });
    }

    private initializeToolButtonEvents() {
        const btnTranslate = document.getElementById('tool-translate') as HTMLButtonElement;
        const btnRotate = document.getElementById('tool-rotate') as HTMLButtonElement;
        const btnScale = document.getElementById('tool-scale') as HTMLButtonElement;
        const btnPivot = document.getElementById('tool-pivot') as HTMLButtonElement;
        const btnSpace = document.getElementById('tool-space') as HTMLButtonElement;
        const btnSnap = document.getElementById('tool-snap') as HTMLButtonElement;

        this.transformPivotMode = EditorSettings.transformPivotMode === 'center' ? 'center' : 'pivot';
        this.transformSpaceMode = EditorSettings.transformSpaceMode === 'world' ? 'world' : 'local';
        this.transformControls.setSpace(this.transformSpaceMode);
        this.applySnapSettingsToTransformControls();
        this.setTransformToolMode('translate');

        btnTranslate.onclick = () => {
            this.setTransformToolMode('translate');
        };
        btnRotate.onclick = () => {
            this.setTransformToolMode('rotate');
        };
        btnScale.onclick = () => {
            this.setTransformToolMode('scale');
        };

        btnPivot.onclick = () => {
            this.transformPivotMode = this.transformPivotMode === 'pivot' ? 'center' : 'pivot';
            EditorSettings.transformPivotMode = this.transformPivotMode;
            EditorSettings.save();
            this.updateTransformToolToggleButtons();
            this.updateTransformControlsAttachment();
        };

        btnSpace.onclick = () => {
            this.transformSpaceMode = this.transformSpaceMode === 'local' ? 'world' : 'local';
            EditorSettings.transformSpaceMode = this.transformSpaceMode;
            EditorSettings.save();
            this.transformControls.setSpace(this.transformSpaceMode);
            this.updateTransformToolToggleButtons();
            this.updateTransformControlsAttachment();
        };

        btnSnap.onclick = () => {
            EditorSettings.snapEnabled = !EditorSettings.snapEnabled;
            EditorSettings.save();
            this.applySnapSettingsToTransformControls();
            this.updateTransformToolToggleButtons();
        };

        const btnStats = document.getElementById('tool-stats') as HTMLButtonElement;
        if (btnStats) {
            btnStats.onclick = () => {
                if (this.statsOverlay) {
                    const isHidden = this.statsOverlay.style.display === 'none';
                    this.statsOverlay.style.display = isHidden ? 'block' : 'none';
                    btnStats.classList.toggle('active', isHidden);
                }
            };
        }

        const btnWireframe = document.getElementById('tool-wireframe') as HTMLButtonElement;
        if (btnWireframe) {
            btnWireframe.onclick = () => {
                this.isWireframe = !this.isWireframe;
                btnWireframe.classList.toggle('active', this.isWireframe);
                this.scene.threeScene.traverse((child) => {
                    if (child instanceof THREE.Mesh && child.material) {
                        const mats = Array.isArray(child.material) ? child.material : [child.material];
                        mats.forEach(m => m.wireframe = this.isWireframe);
                    }
                });
            };
        }

        const resSelect = document.getElementById('game-resolution-select') as HTMLSelectElement;
        if (resSelect) {
            resSelect.onchange = () => this.updateGameViewResolution();
        }

        const gameStatsBtn = document.getElementById('game-stats-btn') as HTMLButtonElement;
        if (gameStatsBtn) {
            gameStatsBtn.onclick = () => {
                if (this.statsOverlay) {
                    const isHidden = this.statsOverlay.style.display === 'none';
                    this.statsOverlay.style.display = isHidden ? 'block' : 'none';
                    gameStatsBtn.classList.toggle('active', isHidden);
                    if (btnStats) btnStats.classList.toggle('active', isHidden);
                }
            };
        }

        window.addEventListener('resize', () => this.scheduleViewportResize());
        window.visualViewport?.addEventListener('resize', () => this.scheduleViewportResize());
    }

    private isWireframe: boolean = false;

    private initializeKeyBindings() {
        window.addEventListener('keydown',  async(event) => {
            const activeElement = document.activeElement as HTMLElement | null;
            const isTextEditing = activeElement?.matches('input, textarea, select, [contenteditable="true"], [role="textbox"]') === true;
            if (isTextEditing) return;

            if (event.key === 'Control' && !EditorSettings.snapEnabled) {
                this.temporarySnapActive = true;
                this.applySnapSettingsToTransformControls();
                this.updateTransformToolToggleButtons();
            }

            const commandKey = event.ctrlKey || event.metaKey;
            const hasRectSelection = Boolean(
                this.selectedGameObject?.getComponent(RectTransform) || this.selectedGameObject?.getComponent(Canvas)
            );

            switch (event.key.toLowerCase()) {
                case 'q':
                    this.setTransformToolMode('view');
                    break;
                case 'w':
                    this.setTransformToolMode('translate');
                    break;
                case 'e':
                    this.setTransformToolMode('rotate');
                    break;
                case 'r':
                    this.setTransformToolMode('scale');
                    break;
                case 't':
                    this.setTransformToolMode(hasRectSelection ? 'rect' : 'translate');
                    break;
                case 'z':
                    if (commandKey) {
                        event.preventDefault();
                        if (event.shiftKey) {
                            CommandHistory.redo();
                        } else {
                            CommandHistory.undo();
                        }
                        this.hierarchyWindow.refresh();
                        this.inspectorWindow.refresh();
                    } else {
                        this.transformPivotMode = this.transformPivotMode === 'pivot' ? 'center' : 'pivot';
                        EditorSettings.transformPivotMode = this.transformPivotMode;
                        EditorSettings.save();
                        this.updateTransformToolToggleButtons();
                        this.updateTransformControlsAttachment();
                    }
                    break;
                case 'y':
                    if (commandKey) {
                        event.preventDefault();
                        CommandHistory.redo();
                        this.hierarchyWindow.refresh();
                        this.inspectorWindow.refresh();
                    }
                    break;
                case 's': if (commandKey) { event.preventDefault(); await this.saveActiveScene(); } break;
                case 'f':
                    this.focusOnSelectionOrScene();
                    break;
                case 'f2':
                    event.preventDefault();
                    this.hierarchyWindow.beginRenameForSelection();
                    break;
                case 'arrowup':
                    if (event.altKey && commandKey) {
                        event.preventDefault();
                        this.moveSelectionSibling(-1);
                    } else if (event.altKey && !commandKey) {
                        event.preventDefault();
                        this.selectParentOfSelection();
                    }
                    break;
                case 'arrowdown':
                    if (event.altKey && commandKey) {
                        event.preventDefault();
                        this.moveSelectionSibling(1);
                    } else if (event.altKey && !commandKey) {
                        event.preventDefault();
                        this.selectFirstChildOfSelection();
                    }
                    break;
                case 'arrowleft':
                    if (event.altKey && !commandKey) {
                        event.preventDefault();
                        this.selectSiblingOfSelection(-1);
                    }
                    break;
                case 'arrowright':
                    if (event.altKey && !commandKey) {
                        event.preventDefault();
                        this.selectSiblingOfSelection(1);
                    }
                    break;
                case 'home':
                    if (event.altKey && commandKey) {
                        event.preventDefault();
                        this.setSelectionSiblingPosition('first');
                    }
                    break;
                case 'a':
                    if (commandKey) {
                        event.preventDefault();
                        this.selectAllSceneObjects();
                    }
                    break;
                case 'd':
                    if (commandKey) {
                        event.preventDefault();
                        this.duplicateSelected();
                    }
                    break;
                case 'c':
                    if (commandKey) {
                        event.preventDefault();
                        this.copySelected();
                    }
                    break;
                case 'v':
                    if (commandKey) {
                        event.preventDefault();
                        if (event.shiftKey) {
                            this.pasteAsChildOfSelection();
                        } else {
                            this.pasteSelected();
                        }
                    }
                    break;
                case 'x':
                    if (commandKey) {
                        event.preventDefault();
                        this.cutSelected();
                    } else {
                        this.transformSpaceMode = this.transformSpaceMode === 'local' ? 'world' : 'local';
                        this.transformControls.setSpace(this.transformSpaceMode);
                        EditorSettings.transformSpaceMode = this.transformSpaceMode;
                        EditorSettings.save();
                        this.updateTransformToolToggleButtons();
                        this.updateTransformControlsAttachment();
                    }
                    break;
                case 'g':
                    if (commandKey && event.shiftKey) {
                        event.preventDefault();
                        this.createEmptyParentForSelection();
                    }
                    break;
                case 'n':
                    if (commandKey && event.shiftKey && event.altKey) {
                        event.preventDefault();
                        this.createEmptyChildForSelection();
                    } else if (commandKey && event.shiftKey) {
                        event.preventDefault();
                        this.createEmptyGameObject();
                    }
                    break;
                case '[':
                case '{':
                    event.preventDefault();
                    this.adjustActiveSnapStep(-1);
                    break;
                case ']':
                case '}':
                    event.preventDefault();
                    this.adjustActiveSnapStep(1);
                    break;
                case 'delete':
                    this.deleteSelected();
                    break;
                case 'end':
                    if (event.altKey && commandKey) {
                        event.preventDefault();
                        this.setSelectionSiblingPosition('last');
                    } else {
                        event.preventDefault();
                        this.snapSelectionToGround(event.shiftKey);
                    }
                    break;
                case ' ':
                    if (event.shiftKey) {
                        event.preventDefault();
                        this.toggleMaximizePanel();
                    }
                    break;
                case 'tab':
                    if (event.ctrlKey) {
                        event.preventDefault();
                        this.cycleActivePanelTabs(event.shiftKey ? -1 : 1);
                    }
                    break;
                case 'escape':
                    if (document.getElementById('scene-context-menu')) {
                        event.preventDefault();
                        this.removeSceneContextMenu();
                        break;
                    }
                    if (this.selectedGameObjects.length > 0 || this.selectedGameObject) {
                        event.preventDefault();
                        this.selectGameObject(null);
                    }
                    break;
            }
        });

        window.addEventListener('keyup', (event) => {
            if (event.key !== 'Control') return;
            if (EditorSettings.snapEnabled) return;
            this.temporarySnapActive = false;
            this.applySnapSettingsToTransformControls();
            this.updateTransformToolToggleButtons();
        });
    }

    private updatePlayModeButtons() {
        const playBtn = document.getElementById('play-btn') as HTMLButtonElement | null;
        const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement | null;
        const stepBtn = document.getElementById('step-btn') as HTMLButtonElement | null;

        if (playBtn) {
            playBtn.innerText = this.isPlaying ? "Stop" : "Play";
            playBtn.title = this.isPlaying ? 'Stop Play Mode (Ctrl+P)' : 'Play Mode (Ctrl+P)';
            playBtn.style.color = this.isPlaying ? "var(--unity-accent)" : "";
        }
        if (pauseBtn) {
            pauseBtn.disabled = !this.isPlaying;
            pauseBtn.classList.toggle('active', this.isPaused);
            pauseBtn.title = this.isPaused ? 'Resume Play Mode' : 'Pause Play Mode';
            pauseBtn.style.color = this.isPaused ? "var(--unity-accent)" : "";
        }
        if (stepBtn) {
            stepBtn.disabled = !this.isPlaying;
            stepBtn.title = this.isPlaying ? 'Step One Frame' : 'Step One Frame (Play Mode Required)';
        }

        // Tint UI
        const container = document.getElementById('editor-container');
        if (container) {
            if (this.isPlaying) container.classList.add('play-mode-tint');
            else container.classList.remove('play-mode-tint');
        }
    }

    public updatePostProcessing() {
        if (!this.bloomPass || !this.ssaoPass) return;

        this.bloomPass.enabled = this.scene.enableBloom;
        this.bloomPass.strength = this.scene.bloomStrength;
        this.bloomPass.threshold = this.scene.bloomThreshold;
        this.bloomPass.radius = this.scene.bloomRadius;

        this.ssaoPass.enabled = this.scene.enableSSAO;
        this.ssaoPass.kernelRadius = this.scene.ssaoRadius;
        this.ssaoPass.minDistance = this.scene.ssaoMinDistance;
        this.ssaoPass.maxDistance = this.scene.ssaoMaxDistance;

        // Tone Mapping
        const toneMappingMap: Record<string, THREE.ToneMapping> = {
            'None': THREE.NoToneMapping,
            'Linear': THREE.LinearToneMapping,
            'Reinhard': THREE.ReinhardToneMapping,
            'Cineon': THREE.CineonToneMapping,
            'ACES Filmic': THREE.ACESFilmicToneMapping,
        };
        this.renderer.toneMapping = toneMappingMap[this.scene.toneMapping] ?? THREE.NoToneMapping;
        this.renderer.toneMappingExposure = this.scene.toneMappingExposure;

        // Advanced Effects Sync
        if (this.vignettePass) {
            this.vignettePass.enabled = this.scene.enableVignette;
            if (this.vignettePass.uniforms?.["darkness"]) {
                this.vignettePass.uniforms["darkness"].value = this.scene.vignetteIntensity;
            }
            if (this.vignettePass.uniforms?.["offset"]) {
                this.vignettePass.uniforms["offset"].value = this.scene.vignetteOffset;
            }
        }

        if (this.chromaticAberrationPass) {
            this.chromaticAberrationPass.enabled = this.scene.enableChromaticAberration;
            if (this.chromaticAberrationPass.uniforms?.["amount"]) {
                this.chromaticAberrationPass.uniforms["amount"].value = this.scene.chromaticIntensity * 0.005;
            }
        }

        if (this.filmGrainPass) {
            this.filmGrainPass.enabled = this.scene.enableFilmGrain;
            // @ts-ignore
            if (this.filmGrainPass.uniforms?.["nIntensity"]) {
                // @ts-ignore
                this.filmGrainPass.uniforms["nIntensity"].value = this.scene.filmGrainIntensity;
            }
        }

        // Grid Update
        if (this.gridHelper) {
            this.gridHelper.visible = EditorSettings.gridEnabled;
        }
        if (this.gridHelper?.geometry?.attributes?.['position']?.count !== undefined
            && this.gridHelper.geometry.attributes['position'].count !== (EditorSettings.gridDivisions + 1) * 4) {
            // Redraw grid if divisions changed (advanced logic skipped for now, just size)
        }

        // Snapping Update
        this.applySnapSettingsToTransformControls();
        this.updateTransformToolToggleButtons();
    }

    private togglePanel(id: string) {
        if (this.maximizedPanelId) this.restoreMaximizedPanel();
        const panel = document.getElementById(id);
        if (panel) {
            const visible = panel.style.display === 'none';
            this.setPanelVisibility(id, visible);
            this.resize();
        }
    }

    private async applySceneSnapshot(snapshot: string, scenePath: string | null): Promise<void> {
        this.scene.loadFromJSON(snapshot);
        SceneManager.getInstance().setActiveScene(this.scene, scenePath);
        this.selectGameObject(null);
        this.hierarchyWindow.refresh();
        this.inspectorWindow.refresh();
        await this.projectWindow.refresh();
        this.syncWindowMenuState();
    }

    private executeSceneSnapshotCommand(name: string, nextSnapshot: string, nextPath: string | null): void {
        const previousSnapshot = this.scene.toJSON();
        const previousPath = SceneManager.getInstance().getActiveScenePath();
        if (previousSnapshot === nextSnapshot && previousPath === nextPath) {
            return;
        }

        CommandHistory.execute({
            name,
            execute:  async() => await this.applySceneSnapshot(nextSnapshot, nextPath),
            undo:  async() => await this.applySceneSnapshot(previousSnapshot, previousPath)
        });
    }

    private captureSelectionSnapshot(): { selectedIds: string[]; activeId: string | null } {
        return {
            selectedIds: this.selectedGameObjects.map((go) => go.id),
            activeId: this.selectedGameObject?.id ?? null
        };
    }

    private restoreSelectionSnapshot(snapshot: { selectedIds: string[]; activeId: string | null }): void {
        const uniqueIds = Array.from(new Set(snapshot.selectedIds));
        const selected = uniqueIds
            .map((id) => this.scene.findGameObjectByID(id))
            .filter((go): go is GameObject => !!go);

        if (selected.length === 0) {
            this.selectGameObject(null);
            return;
        }

        if (snapshot.activeId) {
            const activeIndex = selected.findIndex((go) => go.id === snapshot.activeId);
            if (activeIndex >= 0 && activeIndex !== selected.length - 1) {
                const [active] = selected.splice(activeIndex, 1);
                if (active) {
                    selected.push(active);
                }
            }
        }

        this.selectGameObjectRange(selected, false);
    }

    private executeSceneMutationCommand(name: string, mutate: () => boolean | Promise<boolean>): void {
        const previousSnapshot = this.scene.toJSON();
        const previousPath = SceneManager.getInstance().getActiveScenePath();
        const previousSelection = this.captureSelectionSnapshot();
        const didMutate = mutate();
        const nextSnapshot = this.scene.toJSON();
        const nextPath = SceneManager.getInstance().getActiveScenePath();
        const nextSelection = this.captureSelectionSnapshot();

        if (!didMutate || (previousSnapshot === nextSnapshot && previousPath === nextPath)) {
            return;
        }

        CommandHistory.execute({
            name,
            execute:  async() => {
                await this.applySceneSnapshot(nextSnapshot, nextPath);
                this.restoreSelectionSnapshot(nextSelection);
            },
            undo:  async() => {
                await this.applySceneSnapshot(previousSnapshot, previousPath);
                this.restoreSelectionSnapshot(previousSelection);
            }
        });
    }

    private async readTextFileIfExists(filePath: string): Promise<string | null> {
        if (!filePath) return null;
        console.warn(`readTextFileIfExists fallback path hit for '${filePath}'. Prefer async bridge call in new code.`);
        try {
            if (!await this.fs?.exists(filePath)) return null;
            return await this.fs.readFile(filePath, 'utf8');
        } catch (error) {
            console.warn(`Failed to read file snapshot for '${filePath}'`, error);
            return null;
        }
    }

    private async restorePrefabSourceSnapshot(sourcePath: string, sourceJson: string | null): Promise<void> {
        if (sourceJson === null) return;
        await this.fs.writeFile(sourcePath, sourceJson, 'utf8');
        await PrefabManager.loadPrefabFromPath(sourcePath);
        await this.projectWindow.refreshAssetRuntime(sourcePath);
    }

    private async executePrefabBackedSceneMutationCommand(name: string, sourcePath: string, mutate: () => boolean | Promise<boolean>): Promise<void> {
        const previousSnapshot = this.scene.toJSON();
        const previousPath = SceneManager.getInstance().getActiveScenePath();
        const previousSelection = this.captureSelectionSnapshot();
        const previousSourceJson = await this.readTextFileIfExists(sourcePath);

        const didMutate = mutate();

        const nextSnapshot = this.scene.toJSON();
        const nextPath = SceneManager.getInstance().getActiveScenePath();
        const nextSelection = this.captureSelectionSnapshot();
        const nextSourceJson = await this.readTextFileIfExists(sourcePath);

        if (
            !didMutate
            || (
                previousSnapshot === nextSnapshot
                && previousPath === nextPath
                && previousSourceJson === nextSourceJson
            )
        ) {
            return;
        }

        CommandHistory.execute({
            name,
            execute:  async() => {
                await this.restorePrefabSourceSnapshot(sourcePath, nextSourceJson);
                await this.applySceneSnapshot(nextSnapshot, nextPath);
                this.restoreSelectionSnapshot(nextSelection);
            },
            undo:  async() => {
                await this.restorePrefabSourceSnapshot(sourcePath, previousSourceJson);
                await this.applySceneSnapshot(previousSnapshot, previousPath);
                this.restoreSelectionSnapshot(previousSelection);
            }
        });
    }

    private buildDefaultSceneSnapshot(): string {
        const tempScene = new Scene();

        const cube = new GameObject("Cube");
        const cubeRenderer = cube.addComponent(MeshRenderer);
        cubeRenderer.mesh.geometry = new THREE.BoxGeometry(1, 1, 1);
        const autoRotate = ScriptRegistry.create("AutoRotate", cube);
        if (autoRotate) {
            cube.addComponent(autoRotate);
            (autoRotate as any).rotationSpeed = 4.0;
        }
        tempScene.addGameObject(cube);

        const floor = new GameObject("Floor");
        const renderer = floor.addComponent(MeshRenderer);
        renderer.mesh.geometry = new THREE.PlaneGeometry(10, 10);
        renderer.mesh.rotateX(-Math.PI / 2);
        renderer.setColor(0x444444);
        floor.transform.position.y = -1;
        tempScene.addGameObject(floor);

        return tempScene.toJSON();
    }

    private async confirmSceneReplacement(action: 'create a new scene' | 'open another scene'): Promise<boolean> {
        if (!this.dirtyState.isDirty) return true;

        if (confirm(`Save changes before you ${action}?`)) {
            return await this.saveActiveScene();
        }

        if (!confirm(`Discard your unsaved changes and ${action}?`)) {
            return false;
        }

        return true;
    }

    public async newScene(): Promise<void> {
        if (!await this.confirmSceneReplacement('create a new scene')) return;

        const nextSnapshot = this.buildDefaultSceneSnapshot();
        this.executeSceneSnapshotCommand('New Scene', nextSnapshot, null);
        await this.desktopBridge.discardRecovery(this.projectPath);
    }

    public async openScene(scenePath: string): Promise<boolean> {
        try {
            const sceneManager = SceneManager.getInstance();
            const prepared = await sceneManager.prepareScene(scenePath);
            if (!await this.confirmSceneReplacement('open another scene')) return false;

            const scene = sceneManager.activatePreparedScene(prepared);
            this.setScene(scene);
            await this.desktopBridge.discardRecovery(this.projectPath);
            return true;
        } catch (error) {
            console.error(`Invalid scene file '${scenePath}':`, error);
            return false;
        }
    }

    private async showOpenSceneDialog() {
        const result = await this.electronAPI?.showOpenDialog?.({
            title: 'Open Scene',
            defaultPath: this.rootPath || undefined,
            filters: [{ name: 'Scene Files', extensions: ['json', 'scene'] }],
            properties: ['openFile']
        });

        if (!result) return;

        const selectedPath = typeof result.filePath === 'string' && result.filePath.length > 0
            ? result.filePath
            : (Array.isArray(result.filePaths) && result.filePaths.length > 0 ? result.filePaths[0] : null);

        if (!result.canceled && selectedPath) {
            try {
                const sceneManager = SceneManager.getInstance();
                const prepared = await sceneManager.prepareScene(selectedPath);
                if (!await this.confirmSceneReplacement('open another scene')) return;

                const scene = sceneManager.activatePreparedScene(prepared);
                this.setScene(scene);
                await this.desktopBridge.discardRecovery(this.projectPath);
            } catch (error) {
                console.error(`Invalid scene file '${selectedPath}':`, error);
                return;
            }
        }
    }

    private async showSaveSceneAsDialog(): Promise<boolean> {
        const defaultScenePath = this.rootPath ? await this.desktopBridge.pathJoin(this.rootPath, 'Scenes', 'NewScene.json') : 'NewScene.json';
        const result = await this.electronAPI?.showSaveDialog?.({
            title: 'Save Scene As',
            defaultPath: defaultScenePath,
            filters: [{ name: 'Scene Files', extensions: ['json', 'scene'] }]
        });

        if (!result) return false;

        if (!result.canceled && result.filePath) {
            SceneManager.getInstance().setActiveScene(this.scene);
            await SceneManager.getInstance().saveSceneAs(result.filePath);
            await this.projectWindow.refresh();
            this.dirtyState.markPersisted();
            await this.desktopBridge.discardRecovery(this.projectPath);
            return true;
        }
        return false;
    }

    private applySpawnPosition(go: GameObject, worldPosition?: THREE.Vector3, parent?: any) {
        if (!worldPosition) return;
        if (parent?.gameObject?.object3D) {
            const local = parent.gameObject.object3D.worldToLocal(worldPosition.clone());
            go.transform.position.copy(local);
        } else {
            go.transform.position.copy(worldPosition);
        }
        go.object3D.updateMatrixWorld(true);
    }

    private createEmptyGameObject(parent?: any, worldPosition?: THREE.Vector3, prefabApplyTargetSource?: GameObject | null) {
        const go = new GameObject("New GameObject");
        this.applySpawnPosition(go, worldPosition, parent ?? null);
        const cmd = new CreateGameObjectCommand(go, this.scene, parent ?? null);
        CommandHistory.execute(cmd);
        this.inheritPrefabApplyTargetPreference(go, prefabApplyTargetSource ?? parent?.gameObject ?? null);
        this.selectGameObject(go);
        this.hierarchyWindow.refresh();
    }

    private createPrimitive(type: string, parent?: any, worldPosition?: THREE.Vector3) {
        const go = new GameObject(type);
        if (type === 'Cube') {
            const meshFilter = go.addComponent(MeshFilter);
            meshFilter.setPrimitiveType('Cube');
            const mr = go.addComponent(MeshRenderer);
            mr.mesh.geometry = new THREE.BoxGeometry(1, 1, 1);
        } else if (type === 'Sphere') {
            const meshFilter = go.addComponent(MeshFilter);
            meshFilter.setPrimitiveType('Sphere');
            const mr = go.addComponent(MeshRenderer);
            mr.mesh.geometry = new THREE.SphereGeometry(0.5, 32, 32);
        } else if (type === 'Capsule') {
            const meshFilter = go.addComponent(MeshFilter);
            meshFilter.setPrimitiveType('Capsule');
            const mr = go.addComponent(MeshRenderer);
            mr.mesh.geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 16);
        } else if (type === 'Cylinder') {
            const meshFilter = go.addComponent(MeshFilter);
            meshFilter.setPrimitiveType('Cylinder');
            const mr = go.addComponent(MeshRenderer);
            mr.mesh.geometry = new THREE.CylinderGeometry(0.5, 0.5, 2, 32);
        } else if (type === 'Plane') {
            const meshFilter = go.addComponent(MeshFilter);
            meshFilter.setPrimitiveType('Plane');
            const mr = go.addComponent(MeshRenderer);
            mr.mesh.geometry = new THREE.PlaneGeometry(1, 1);
            mr.mesh.rotateX(-Math.PI / 2);
        } else if (type === 'Quad') {
            const meshFilter = go.addComponent(MeshFilter);
            meshFilter.setPrimitiveType('Quad');
            const mr = go.addComponent(MeshRenderer);
            mr.mesh.geometry = new THREE.PlaneGeometry(1, 1);
        } else if (type === 'Camera') {
            go.addComponent(Camera);
        } else if (type === 'Light') {
            const light = go.addComponent(Light);
            light.setLightType(LightType.Directional);
        }

        this.applySpawnPosition(go, worldPosition, parent ?? null);
        const cmd = new CreateGameObjectCommand(go, this.scene, parent ?? null);
        CommandHistory.execute(cmd);
        this.selectGameObject(go);
        this.hierarchyWindow.refresh();
    }

    private createDirectionalLight(parent?: any, worldPosition?: THREE.Vector3) {
        const go = new GameObject('Directional Light');
        const light = go.addComponent(Light);
        light.setLightType(LightType.Directional);
        light.intensity = 1.0;
        this.applySpawnPosition(go, worldPosition, parent ?? null);
        const cmd = new CreateGameObjectCommand(go, this.scene, parent ?? null);
        CommandHistory.execute(cmd);
        this.selectGameObject(go);
        this.hierarchyWindow.refresh();
    }

    private createPointLight(parent?: any, worldPosition?: THREE.Vector3) {
        const go = new GameObject('Point Light');
        const light = go.addComponent(Light);
        light.setLightType(LightType.Point);
        light.intensity = 1.0;
        light.range = 10;
        this.applySpawnPosition(go, worldPosition, parent ?? null);
        const cmd = new CreateGameObjectCommand(go, this.scene, parent ?? null);
        CommandHistory.execute(cmd);
        this.selectGameObject(go);
        this.hierarchyWindow.refresh();
    }

    private createSpotLight(parent?: any, worldPosition?: THREE.Vector3) {
        const go = new GameObject('Spot Light');
        const light = go.addComponent(Light);
        light.setLightType(LightType.Spot);
        light.intensity = 1.0;
        light.range = 10;
        light.setSpotAngle(30);
        this.applySpawnPosition(go, worldPosition, parent ?? null);
        const cmd = new CreateGameObjectCommand(go, this.scene, parent ?? null);
        CommandHistory.execute(cmd);
        this.selectGameObject(go);
        this.hierarchyWindow.refresh();
    }

    private createAudioSourceObject(parent?: any, worldPosition?: THREE.Vector3) {
        const go = new GameObject('Audio Source');
        go.addComponent(AudioSource);
        this.applySpawnPosition(go, worldPosition, parent ?? null);
        const cmd = new CreateGameObjectCommand(go, this.scene, parent ?? null);
        CommandHistory.execute(cmd);
        this.selectGameObject(go);
        this.hierarchyWindow.refresh();
    }

    private createUICanvas() {
        const commands: Command[] = [];
        const canvasGO = new GameObject('Canvas');
        canvasGO.addComponent(Canvas);
        canvasGO.addComponent(GraphicRaycaster);
        commands.push(new CreateGameObjectCommand(canvasGO, this.scene, null));
        this.appendEventSystemSupport(commands);

        if (commands.length === 1) {
            CommandHistory.execute(commands[0]);
        } else {
            CommandHistory.execute(new GroupCommand('Create UI Canvas', commands));
        }
        this.selectGameObject(canvasGO);
        this.hierarchyWindow.refresh();
    }

    private createUIElement(kind: 'Image' | 'Text' | 'Button' | 'InputField' | 'Dropdown' | 'Toggle' | 'Slider' | 'Scrollbar' | 'ScrollView') {
        if (kind === 'ScrollView') {
            this.createUIScrollView();
            return;
        }

        const canvasContext = this.findCanvasContextForSelection();
        const commands: Command[] = [];
        let canvasGO = canvasContext;

        if (!canvasGO) {
            canvasGO = new GameObject('Canvas');
            canvasGO.addComponent(Canvas);
            canvasGO.addComponent(GraphicRaycaster);
            commands.push(new CreateGameObjectCommand(canvasGO, this.scene, null));
        } else {
            this.appendCanvasRuntimeSupport(canvasGO, commands);
        }

        this.appendEventSystemSupport(commands);

        const parentTransform = this.getDefaultUIParentTransform(canvasGO);
        const go = new GameObject(kind);
        go.addComponent(RectTransform);
        if (kind === 'Image') {
            go.addComponent(UIImage);
        } else if (kind === 'Text') {
            go.addComponent(UIText);
        } else if (kind === 'Button') {
            go.addComponent(UIButton);
        } else if (kind === 'InputField') {
            go.addComponent(UIInputField);
        } else if (kind === 'Dropdown') {
            go.addComponent(UIDropdown);
        } else if (kind === 'Toggle') {
            go.addComponent(UIToggle);
        } else if (kind === 'Slider') {
            go.addComponent(UISlider);
        } else {
            go.addComponent(UIScrollbar);
        }
        commands.push(new CreateGameObjectCommand(go, this.scene, parentTransform));

        if (commands.length === 1) {
            CommandHistory.execute(commands[0]);
        } else {
            CommandHistory.execute(new GroupCommand(`Create UI ${kind}`, commands));
        }

        this.selectGameObject(go);
        this.hierarchyWindow.refresh();
    }

    private createUIScrollView(): void {
        const canvasContext = this.findCanvasContextForSelection();
        const commands: Command[] = [];
        let canvasGO = canvasContext;

        if (!canvasGO) {
            canvasGO = new GameObject('Canvas');
            canvasGO.addComponent(Canvas);
            canvasGO.addComponent(GraphicRaycaster);
            commands.push(new CreateGameObjectCommand(canvasGO, this.scene, null));
        } else {
            this.appendCanvasRuntimeSupport(canvasGO, commands);
        }

        this.appendEventSystemSupport(commands);

        const parentTransform = this.getDefaultUIParentTransform(canvasGO);
        const root = new GameObject('Scroll View');
        const rootRect = root.addComponent(RectTransform);
        rootRect.sizeDelta.set(260, 180);
        const rootImage = root.addComponent(UIImage);
        rootImage.color = '#2c2c2c';
        const scrollRect = root.addComponent(UIScrollRect);

        const viewport = new GameObject('Viewport');
        const viewportRect = viewport.addComponent(RectTransform);
        viewportRect.setLocalPixelRect(260, 180, { x: 0, y: 0, width: 242, height: 162 });
        const viewportImage = viewport.addComponent(UIImage);
        viewportImage.color = '#1d1d1d';

        const content = new GameObject('Content');
        const contentRect = content.addComponent(RectTransform);
        contentRect.setLocalPixelRect(242, 162, { x: 0, y: 0, width: 242, height: 320 });

        const hScrollbarGO = new GameObject('Scrollbar Horizontal');
        const hScrollbarRect = hScrollbarGO.addComponent(RectTransform);
        hScrollbarRect.setLocalPixelRect(260, 180, { x: 0, y: 162, width: 242, height: 18 });
        const hScrollbar = hScrollbarGO.addComponent(UIScrollbar);
        hScrollbar.direction = 'LeftToRight';
        hScrollbar.size = 0.35;

        const vScrollbarGO = new GameObject('Scrollbar Vertical');
        const vScrollbarRect = vScrollbarGO.addComponent(RectTransform);
        vScrollbarRect.setLocalPixelRect(260, 180, { x: 242, y: 0, width: 18, height: 162 });
        const vScrollbar = vScrollbarGO.addComponent(UIScrollbar);
        vScrollbar.direction = 'BottomToTop';
        vScrollbar.size = 0.35;

        scrollRect.viewport = viewport;
        scrollRect.content = content;
        scrollRect.horizontalScrollbar = hScrollbarGO;
        scrollRect.verticalScrollbar = vScrollbarGO;
        scrollRect.horizontal = true;
        scrollRect.vertical = true;
        scrollRect.horizontalNormalizedPosition = 0;
        scrollRect.verticalNormalizedPosition = 1;

        commands.push(new CreateGameObjectCommand(root, this.scene, parentTransform));
        commands.push(new CreateGameObjectCommand(viewport, this.scene, root.transform));
        commands.push(new CreateGameObjectCommand(content, this.scene, viewport.transform));
        commands.push(new CreateGameObjectCommand(hScrollbarGO, this.scene, root.transform));
        commands.push(new CreateGameObjectCommand(vScrollbarGO, this.scene, root.transform));

        CommandHistory.execute(new GroupCommand('Create UI Scroll View', commands));
        this.selectGameObject(root);
        this.hierarchyWindow.refresh();
    }

    private findCanvasContextForSelection(): GameObject | null {
        let current = this.selectedGameObject;
        while (current) {
            if (current.getComponent(Canvas)) {
                return current;
            }
            current = current.transform.parent?.gameObject ?? null;
        }
        return null;
    }

    private getDefaultUIParentTransform(canvasGO: GameObject): any {
        const selected = this.selectedGameObject;
        if (!selected) return canvasGO.transform;

        const selectedCanvas = this.findCanvasContextForSelection();
        if (!selectedCanvas || selectedCanvas !== canvasGO) return canvasGO.transform;

        if (selected.getComponent(RectTransform) || selected.getComponent(Canvas)) {
            return selected.transform;
        }
        return canvasGO.transform;
    }

    private appendCanvasRuntimeSupport(canvasGO: GameObject, commands: Command[]): void {
        if (!canvasGO.getComponent(GraphicRaycaster)) {
            commands.push(new AddComponentCommand(canvasGO, GraphicRaycaster));
        }
    }

    private appendEventSystemSupport(commands: Command[]): void {
        if (this.findEventSystem()) return;

        const eventSystemGO = new GameObject('EventSystem');
        eventSystemGO.addComponent(EventSystem);
        commands.push(new CreateGameObjectCommand(eventSystemGO, this.scene, null));
    }

    private findEventSystem(): GameObject | null {
        return this.scene.gameObjects.find((go) => Boolean(go.getComponent(EventSystem))) ?? null;
    }

    public createEmptyChildForSelection(worldPosition?: THREE.Vector3) {
        const targets = this.getTopLevelSelectionTargets();
        if (targets.length === 0) {
            this.createEmptyGameObject(undefined, worldPosition);
            return;
        }

        if (targets.length === 1) {
            this.createEmptyGameObject(targets[0].transform, worldPosition, targets[0]);
            return;
        }

        const createdChildren: GameObject[] = [];
        const commands: Command[] = [];

        // Multi-selection child create: create one child per top-level target.
        // Keep local-zero placement under each parent for deterministic hierarchy behavior.
        targets.forEach((target) => {
            const child = new GameObject('GameObject');
            if (worldPosition) {
                const localPoint = target.object3D.worldToLocal(worldPosition.clone());
                child.transform.position.copy(localPoint);
            }
            createdChildren.push(child);
            commands.push(new CreateGameObjectCommand(child, this.scene, target.transform));
        });

        CommandHistory.execute(new GroupCommand(`Create Empty Child (${targets.length})`, commands));
        createdChildren.forEach((child, index) => {
            this.inheritPrefabApplyTargetPreference(child, targets[index] ?? null);
        });

        if (createdChildren.length > 0) {
            this.selectGameObjectRange(createdChildren, false);
        }
        this.hierarchyWindow.refresh();
    }

    public createEmptyParentForSelection(worldPosition?: THREE.Vector3) {
        const targets = this.getTopLevelSelectionTargets();
        if (targets.length === 0) {
            this.createEmptyGameObject(undefined, worldPosition);
            return;
        }

        const parent = new GameObject('New Parent');
        const bounds = new THREE.Box3();
        targets.forEach((target) => {
            bounds.expandByObject(target.object3D);
        });

        const center = worldPosition?.clone() ?? new THREE.Vector3();
        if (!worldPosition) {
            if (!bounds.isEmpty()) {
                bounds.getCenter(center);
            } else {
                targets.forEach((target) => center.add(target.object3D.getWorldPosition(new THREE.Vector3())));
                center.divideScalar(targets.length);
            }
        }
        parent.object3D.position.copy(center);
        parent.object3D.updateMatrixWorld(true);

        const commands: Command[] = [new CreateGameObjectCommand(parent, this.scene)];
        const firstParent = targets[0].transform.parent ?? null;
        const hasSharedParent = targets.every((target) => (target.transform.parent ?? null) === firstParent);
        if (hasSharedParent && firstParent) {
            commands.push(new ReparentGameObjectCommand(parent, firstParent));
        }
        targets.forEach((target) => {
            commands.push(new ReparentGameObjectCommand(target, parent.transform));
        });

        if (commands.length === 1) {
            CommandHistory.execute(commands[0]);
        } else {
            CommandHistory.execute(new GroupCommand(`Create Empty Parent (${targets.length})`, commands));
        }

        this.inheritPrefabApplyTargetPreference(parent, this.resolveInheritedPrefabApplyTargetSource(targets));

        this.selectGameObject(parent, false);
        this.hierarchyWindow.refresh();
    }

    private resolveInheritedPrefabApplyTargetSource(targets: GameObject[]): GameObject | null {
        if (targets.length === 0) return null;
        const normalizedTargets = this.normalizeSelectionTargets(targets);
        if (normalizedTargets.length === 0) return null;

        const activeSelection = this.selectedGameObject && normalizedTargets.includes(this.selectedGameObject)
            ? this.selectedGameObject
            : (normalizedTargets[normalizedTargets.length - 1] ?? normalizedTargets[0] ?? null);
        if (!activeSelection) return null;

        const activePreferredTarget = this.getPrefabApplyTargetRoot(activeSelection);
        if (!activePreferredTarget) return null;

        const allSharePreferredTarget = normalizedTargets.every((target) => this.getPrefabApplyTargetRoot(target)?.id === activePreferredTarget.id);
        return allSharePreferredTarget ? activeSelection : null;
    }

    private inheritPrefabApplyTargetPreference(target: GameObject, source: GameObject | null): void {
        if (!target || !source) return;
        const sourcePreferredRoot = this.getPrefabApplyTargetRoot(source);
        if (!sourcePreferredRoot) return;

        const targetOwnershipChain = PrefabManager.getPrefabOwnershipChain(target);
        const preferredTarget = targetOwnershipChain.find((entry) => entry.sourceAssetPath === sourcePreferredRoot.sourceAssetPath && entry.prefabSource === sourcePreferredRoot.prefabSource)
            ?? targetOwnershipChain.find((entry) => entry.id === sourcePreferredRoot.id)
            ?? null;
        if (!preferredTarget) return;
        if (targetOwnershipChain[0]?.id === preferredTarget.id) return;

        this.prefabApplyTargetRootIds.set(target.id, preferredTarget.id);
        this.persistPrefabApplyTargetRootPreferences();
    }

    private getTopLevelSelectionTargets(): GameObject[] {
        const selected = this.selectedGameObjects.filter((go) => go !== this.cameraGO);
        if (selected.length === 0 && this.selectedGameObject && this.selectedGameObject !== this.cameraGO) {
            return [this.selectedGameObject];
        }
        if (selected.length === 0) return [];

        const selectedSet = new Set(selected);
        return selected.filter((go) => {
            let current = go.transform.parent;
            while (current) {
                if (selectedSet.has(current.gameObject)) return false;
                current = current.parent;
            }
            return true;
        });
    }

    // ─── Delete Selected ──────────────────────────────────────────────
    private moveSelectionToWorldPoint(worldPoint: THREE.Vector3): void {
        const targets = this.getTopLevelSelectionTargets();
        if (targets.length === 0) return;

        const bounds = new THREE.Box3();
        targets.forEach((target) => bounds.expandByObject(target.object3D));
        const center = new THREE.Vector3();
        if (!bounds.isEmpty()) {
            bounds.getCenter(center);
        } else {
            targets.forEach((target) => center.add(target.object3D.getWorldPosition(new THREE.Vector3())));
            center.divideScalar(targets.length);
        }

        const delta = worldPoint.clone().sub(center);
        const beforeById = new Map<string, THREE.Vector3>();
        const afterById = new Map<string, THREE.Vector3>();

        targets.forEach((target) => {
            const before = target.transform.position.clone();
            const after = before.clone().add(delta);
            beforeById.set(target.id, before);
            afterById.set(target.id, after);
        });

        CommandHistory.execute({
            name: targets.length === 1
                ? `Move ${targets[0].name} Here`
                : `Move ${targets.length} objects Here`,
            execute: () => {
                targets.forEach((target) => {
                    const next = afterById.get(target.id);
                    if (!next) return;
                    target.transform.position.copy(next);
                    target.object3D.updateMatrixWorld(true);
                });
                this.syncRigidBodiesForTargets(targets);
                this.updateTransformControlsAttachment();
                this.inspectorWindow.refresh();
            },
            undo: () => {
                targets.forEach((target) => {
                    const previous = beforeById.get(target.id);
                    if (!previous) return;
                    target.transform.position.copy(previous);
                    target.object3D.updateMatrixWorld(true);
                });
                this.syncRigidBodiesForTargets(targets);
                this.updateTransformControlsAttachment();
                this.inspectorWindow.refresh();
            }
        });
    }

    private unparentTopLevelSelection(): void {
        const targets = this.getTopLevelSelectionTargets().filter((target) => target.transform.parent !== null);
        if (targets.length === 0) return;

        const commands = targets.map((target) => new ReparentGameObjectCommand(target, null));
        if (commands.length === 1) {
            CommandHistory.execute(commands[0]);
        } else {
            CommandHistory.execute(new GroupCommand(`Unparent ${commands.length} objects`, commands));
        }

        this.hierarchyWindow.refresh();
        this.inspectorWindow.refresh();
    }

    private snapSelectionToGround(individual: boolean = false): void {
        const targets = this.getTopLevelSelectionTargets();
        if (targets.length === 0) return;

        const targetSet = new Set(targets);
        const beforeById = new Map<string, THREE.Vector3>();
        const afterById = new Map<string, THREE.Vector3>();

        if (individual || targets.length === 1) {
            targets.forEach((target) => {
                const before = target.transform.position.clone();
                const after = this.calculateGroundSnappedPosition(target, targetSet);
                beforeById.set(target.id, before);
                afterById.set(target.id, after);
            });
        } else {
            const groupSnap = this.calculateGroupGroundSnapDelta(targets, targetSet);
            if (!groupSnap) return;

            targets.forEach((target) => {
                const before = target.transform.position.clone();
                const after = before.clone().add(new THREE.Vector3(0, groupSnap.deltaY, 0));
                beforeById.set(target.id, before);
                afterById.set(target.id, after);
            });
        }

        const hasChange = targets.some((target) => {
            const before = beforeById.get(target.id);
            const after = afterById.get(target.id);
            return !!before && !!after && !before.equals(after);
        });
        if (!hasChange) return;

        CommandHistory.execute({
            name: targets.length === 1
                ? `Snap ${targets[0].name} To Ground`
                : `Snap ${targets.length} objects To Ground`,
            execute: () => {
                targets.forEach((target) => {
                    const next = afterById.get(target.id);
                    if (!next) return;
                    target.transform.position.copy(next);
                    target.object3D.updateMatrixWorld(true);
                });
                this.syncRigidBodiesForTargets(targets);
                this.updateTransformControlsAttachment();
                this.inspectorWindow.refresh();
                this.hierarchyWindow.refresh();
            },
            undo: () => {
                targets.forEach((target) => {
                    const previous = beforeById.get(target.id);
                    if (!previous) return;
                    target.transform.position.copy(previous);
                    target.object3D.updateMatrixWorld(true);
                });
                this.syncRigidBodiesForTargets(targets);
                this.updateTransformControlsAttachment();
                this.inspectorWindow.refresh();
                this.hierarchyWindow.refresh();
            }
        });
    }

    private calculateGroundSnappedPosition(target: GameObject, selectedTopLevels: Set<GameObject>): THREE.Vector3 {
        target.object3D.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(target.object3D);
        const before = target.transform.position.clone();
        if (bounds.isEmpty()) return before;

        const centerX = (bounds.min.x + bounds.max.x) * 0.5;
        const centerZ = (bounds.min.z + bounds.max.z) * 0.5;
        let groundY = this.raycastGroundYAt(centerX, centerZ, bounds.max.y, selectedTopLevels);
        if (groundY === null) groundY = 0;
        const deltaY = groundY - bounds.min.y;
        return before.clone().add(new THREE.Vector3(0, deltaY, 0));
    }

    private calculateGroupGroundSnapDelta(
        targets: GameObject[],
        selectedTopLevels: Set<GameObject>
    ): { deltaY: number } | null {
        const combinedBounds = new THREE.Box3();
        targets.forEach((target) => {
            target.object3D.updateMatrixWorld(true);
            combinedBounds.expandByObject(target.object3D);
        });
        if (combinedBounds.isEmpty()) return null;

        const centerX = (combinedBounds.min.x + combinedBounds.max.x) * 0.5;
        const centerZ = (combinedBounds.min.z + combinedBounds.max.z) * 0.5;
        let groundY = this.raycastGroundYAt(centerX, centerZ, combinedBounds.max.y, selectedTopLevels);
        if (groundY === null) groundY = 0;

        return { deltaY: groundY - combinedBounds.min.y };
    }

    private raycastGroundYAt(
        x: number,
        z: number,
        startY: number,
        selectedTopLevels: Set<GameObject>
    ): number | null {
        const origin = new THREE.Vector3(x, startY + 1000, z);
        const raycaster = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, 5000);
        const intersects = raycaster.intersectObjects(this.scene.threeScene.children, true);

        for (const hit of intersects) {
            if (this.isSceneHelperObject(hit.object)) continue;
            if (this.belongsToSelectedTopLevelTree(hit.object, selectedTopLevels)) continue;
            return hit.point.y;
        }
        return null;
    }

    private belongsToSelectedTopLevelTree(object: THREE.Object3D | null, selectedTopLevels: Set<GameObject>): boolean {
        let current: THREE.Object3D | null = object;
        while (current) {
            const owner = this.scene.gameObjects.find((go) => go.object3D === current);
            if (owner && selectedTopLevels.has(owner)) return true;
            current = current.parent;
        }
        return false;
    }

    public deleteSelected(): void {
        const targets = this.getTopLevelSelectionTargets();
        if (targets.length === 0) return;

        if (targets.length === 1) {
            const cmd = new DeleteGameObjectCommand(targets[0], this.scene);
            CommandHistory.execute(cmd);
        } else {
            const cmds = targets.map(go => new DeleteGameObjectCommand(go, this.scene));
            const group = new GroupCommand(`Delete ${targets.length} objects`, cmds);
            CommandHistory.execute(group);
        }

        this.selectGameObject(null);
        this.hierarchyWindow.refresh();
    }

    // ─── Duplicate Selected ───────────────────────────────────────────
    public duplicateSelected(): void {
        const targets = this.getTopLevelSelectionTargets();
        if (targets.length === 0) return;

        const newObjects: GameObject[] = [];
        if (targets.length === 1) {
            const applyTargetDepthMap = this.capturePrefabApplyTargetDepthMap(targets[0]);
            const cmd = new DuplicateGameObjectCommand(this.scene, targets[0]);
            CommandHistory.execute(cmd);
            const dup = cmd.getDuplicatedGameObject();
            if (dup) {
                if (this.restorePrefabApplyTargetDepthMap(dup, applyTargetDepthMap)) {
                    this.persistPrefabApplyTargetRootPreferences();
                }
                newObjects.push(dup);
            }
        } else {
            const referenceMap = this.createSceneReferenceMap();
            const serialized = targets.map((go) => go.serialize());
            const applyTargetDepthMaps = targets.map((go) => this.capturePrefabApplyTargetDepthMap(go));
            const duplicates = Prefab.instantiateManyData(serialized, { externalIdMap: referenceMap });
            duplicates.forEach((dup, index) => {
                dup.name = `${targets[index]?.name ?? dup.name} (Copy)`;
            });

            const commands: Command[] = duplicates.map((duplicate, index) => {
                const source = targets[index];
                return {
                    name: `Duplicate ${source?.name ?? duplicate.name}`,
                    execute: () => {
                        if (!source) return;
                        if (source.transform.parent) {
                            duplicate.transform.setParent(source.transform.parent, false);
                        } else if (duplicate.transform.parent) {
                            duplicate.transform.setParent(null, false);
                        }
                        this.scene.addGameObject(duplicate);
                        this.placeGameObjectAfterSource(source, duplicate);
                    },
                    undo: () => {
                        this.scene.removeGameObject(duplicate, { destroy: false });
                    }
                };
            });

            if (commands.length > 0) {
                CommandHistory.execute(new GroupCommand(`Duplicate ${commands.length} objects`, commands));
                let restoredAnyApplyTarget = false;
                duplicates.forEach((dup, index) => {
                    if (dup.scene === this.scene) {
                        restoredAnyApplyTarget = this.restorePrefabApplyTargetDepthMap(dup, applyTargetDepthMaps[index] ?? {}) || restoredAnyApplyTarget;
                        newObjects.push(dup);
                    }
                });
                if (restoredAnyApplyTarget) {
                    this.persistPrefabApplyTargetRootPreferences();
                }
            }
        }

        // Select duplicated objects
        if (newObjects.length > 0) {
            this.selectGameObjectRange(newObjects, false, newObjects[newObjects.length - 1] ?? null);
        }
        this.hierarchyWindow.refresh();
    }

    private placeGameObjectAfterSource(source: GameObject, duplicate: GameObject): void {
        const sourceParent = source.transform.parent;
        if (sourceParent) {
            const siblings = sourceParent.children;
            const sourceIndex = siblings.indexOf(source.transform);
            if (sourceIndex < 0) return;
            const targetIndex = Math.min(sourceIndex + 1, siblings.length - 1);
            duplicate.transform.setSiblingIndex(targetIndex);
            return;
        }

        this.reorderRootGameObjectAfterSource(source, duplicate);
    }

    private reorderRootGameObjectAfterSource(source: GameObject, duplicate: GameObject): void {
        if (source.transform.parent || duplicate.transform.parent) return;

        const roots = this.scene.gameObjects.filter((go) => go.transform.parent === null);
        const sourceIndex = roots.indexOf(source);
        const duplicateIndex = roots.indexOf(duplicate);
        if (sourceIndex < 0 || duplicateIndex < 0) return;

        const reorderedRoots = [...roots];
        const [duplicateRoot] = reorderedRoots.splice(duplicateIndex, 1);
        if (!duplicateRoot) return;
        const targetIndex = Math.min(sourceIndex + 1, reorderedRoots.length);
        reorderedRoots.splice(targetIndex, 0, duplicateRoot);

        let rootCursor = 0;
        this.scene.gameObjects = this.scene.gameObjects.map((go) => {
            if (go.transform.parent !== null) return go;
            return reorderedRoots[rootCursor++] ?? go;
        });

        const orderedRootObjects = reorderedRoots.map((go) => go.object3D);
        const rootObjectSet = new Set(orderedRootObjects);
        const sceneChildren = this.scene.threeScene.children;
        let objectCursor = 0;
        for (let i = 0; i < sceneChildren.length; i++) {
            if (!rootObjectSet.has(sceneChildren[i])) continue;
            sceneChildren[i] = orderedRootObjects[objectCursor++] ?? sceneChildren[i];
        }
    }

    // ─── Copy Selected ────────────────────────────────────────────────
    public cutSelected(): void {
        const targets = this.getTopLevelSelectionTargets();
        if (targets.length === 0) return;
        this.copySelected();
        this.deleteSelected();
    }

    public copySelected(): void {
        const targets = this.getTopLevelSelectionTargets();
        if (targets.length === 0) return;
        this.clipboard = targets.map((go) => ({
            data: go.serialize(),
            prefabApplyTargetDepthByPath: this.capturePrefabApplyTargetDepthMap(go)
        }));
        console.log(`Copied ${targets.length} object(s) to clipboard`);
        this.syncWindowMenuState();
    }

    public getClipboardSize(): number {
        return this.clipboard.length;
    }

    public pasteAsChildOfSelection(worldPosition?: THREE.Vector3, preserveOffsets: boolean = true): void {
        if (this.clipboard.length === 0) return;
        const targets = this.getTopLevelSelectionTargets();
        if (targets.length === 0) return;

        if (targets.length === 1) {
            this.pasteSelected(worldPosition, preserveOffsets, targets[0].transform);
            return;
        }

        const pastedObjects: GameObject[] = [];
        const commands: CreateGameObjectCommand[] = [];

        targets.forEach((target) => {
            const parentTransform = target.transform;
            const parentPastedObjects = this.instantiateSerializedGameObjects(this.clipboard);

            parentPastedObjects.forEach((go) => {
                go.name = go.name + " (Pasted)";
                pastedObjects.push(go);
                commands.push(new CreateGameObjectCommand(go, this.scene, parentTransform));
            });

            if (worldPosition && parentPastedObjects.length > 0) {
                this.offsetGameObjectsToWorldPoint(parentPastedObjects, worldPosition, preserveOffsets);
                this.convertPastedObjectsToParentLocalSpace(parentPastedObjects, parentTransform);
            }
        });

        if (commands.length === 0) return;
        CommandHistory.execute(new GroupCommand(`Paste As Child (${commands.length})`, commands));
        this.restoreClipboardPrefabApplyTargets(pastedObjects, targets.length);

        this.selectGameObjectRange(pastedObjects, false);
        this.hierarchyWindow.refresh();
        this.syncWindowMenuState();
    }

    // ─── Paste from Clipboard ─────────────────────────────────────────
    public pasteSelected(worldPosition?: THREE.Vector3, preserveOffsets: boolean = true, parentOverride: any = null): void {
        if (this.clipboard.length === 0) return;

        const pastedObjects = this.instantiateSerializedGameObjects(this.clipboard);
        if (pastedObjects.length === 0) return;
        const cmds: CreateGameObjectCommand[] = [];

        for (const go of pastedObjects) {
            go.name = go.name + " (Pasted)";
            if (!parentOverride) {
                // Keep root-level paste visibly offset to avoid exact overlap.
                go.transform.position.x += 1;
            }
            const cmd = new CreateGameObjectCommand(go, this.scene, parentOverride ?? undefined);
            cmds.push(cmd);
        }

        if (worldPosition && pastedObjects.length > 0) {
            this.offsetGameObjectsToWorldPoint(pastedObjects, worldPosition, preserveOffsets);
        }
        if (parentOverride && pastedObjects.length > 0) {
            this.convertPastedObjectsToParentLocalSpace(pastedObjects, parentOverride);
        }

        if (cmds.length === 1) {
            CommandHistory.execute(cmds[0]);
        } else {
            const group = new GroupCommand(`Paste ${cmds.length} objects`, cmds);
            CommandHistory.execute(group);
        }

        this.restoreClipboardPrefabApplyTargets(pastedObjects);

        // Select pasted objects
        if (pastedObjects.length > 0) {
            this.selectGameObjectRange(pastedObjects, false, pastedObjects[pastedObjects.length - 1] ?? null);
        }
        this.hierarchyWindow.refresh();
        this.syncWindowMenuState();
    }

    private offsetGameObjectsToWorldPoint(
        objects: GameObject[],
        worldPoint: THREE.Vector3,
        preserveOffsets: boolean = true
    ): void {
        if (objects.length === 0) return;
        objects.forEach((obj) => obj.object3D.updateMatrixWorld(true));

        const anchor = new THREE.Vector3();
        if (preserveOffsets) {
            const combinedBounds = new THREE.Box3();
            objects.forEach((obj) => combinedBounds.expandByObject(obj.object3D));
            if (!combinedBounds.isEmpty()) {
                combinedBounds.getCenter(anchor);
            } else {
                anchor.copy(objects[0].object3D.getWorldPosition(new THREE.Vector3()));
            }
        } else {
            anchor.copy(objects[0].object3D.getWorldPosition(new THREE.Vector3()));
        }

        const delta = worldPoint.clone().sub(anchor);
        objects.forEach((obj) => {
            obj.transform.position.add(delta);
            obj.object3D.updateMatrixWorld(true);
        });
    }

    private convertPastedObjectsToParentLocalSpace(objects: GameObject[], parentTransform: any): void {
        parentTransform.gameObject.object3D.updateMatrixWorld(true);
        objects.forEach((obj) => {
            obj.object3D.updateMatrixWorld(true);
            const worldPos = obj.object3D.getWorldPosition(new THREE.Vector3());
            const localPos = parentTransform.gameObject.object3D.worldToLocal(worldPos);
            obj.transform.position.copy(localPos);
            obj.object3D.updateMatrixWorld(true);
        });
    }

    // ─── Deserialize a GameObject from data ───────────────────────────
    private createSceneReferenceMap(): Map<string, GameObject> {
        const map = new Map<string, GameObject>();
        this.scene.gameObjects.forEach((go) => map.set(go.id, go));
        return map;
    }

    private instantiateSerializedGameObjects(dataList: any[]): GameObject[] {
        const referenceMap = this.createSceneReferenceMap();
        return Prefab.instantiateManyData(dataList.map((entry) => entry.data), { externalIdMap: referenceMap });
    }

    private capturePrefabApplyTargetDepthMap(root: GameObject): Record<string, number> {
        const captured: Record<string, number> = {};

        const visit = (current: GameObject, currentPath: string | null) => {
            const preferredTargetId = this.prefabApplyTargetRootIds.get(current.id) ?? null;
            if (preferredTargetId) {
                const ownershipChain = PrefabManager.getPrefabOwnershipChain(current);
                const preferredIndex = ownershipChain.findIndex((entry) => entry.id === preferredTargetId);
                if (preferredIndex > 0) {
                    captured[currentPath ?? ''] = preferredIndex;
                }
            }

            current.transform.children.forEach((childTransform) => {
                const child = childTransform.gameObject;
                const childPath = this.getRelativeHierarchyPath(root, child);
                if (!childPath) return;
                visit(child, childPath);
            });
        };

        visit(root, null);
        return captured;
    }

    private restoreClipboardPrefabApplyTargets(pastedObjects: GameObject[], repeatCount: number = 1): void {
        if (pastedObjects.length === 0 || this.clipboard.length === 0) return;
        const rootsPerPaste = this.clipboard.length;
        if (rootsPerPaste === 0) return;

        const safeRepeatCount = Math.max(1, repeatCount);
        let didRestoreAny = false;
        for (let repeatIndex = 0; repeatIndex < safeRepeatCount; repeatIndex++) {
            for (let clipboardIndex = 0; clipboardIndex < rootsPerPaste; clipboardIndex++) {
                const pastedIndex = repeatIndex * rootsPerPaste + clipboardIndex;
                const pastedRoot = pastedObjects[pastedIndex];
                const payload = this.clipboard[clipboardIndex];
                if (!pastedRoot || !payload) continue;
                didRestoreAny = this.restorePrefabApplyTargetDepthMap(pastedRoot, payload.prefabApplyTargetDepthByPath) || didRestoreAny;
            }
        }

        if (didRestoreAny) {
            this.persistPrefabApplyTargetRootPreferences();
        }
    }

    private restorePrefabApplyTargetDepthMap(root: GameObject, depthByPath: Record<string, number>): boolean {
        if (!depthByPath || typeof depthByPath !== 'object') return false;

        let didRestoreAny = false;
        Object.entries(depthByPath).forEach(([path, preferredDepth]) => {
            if (!Number.isFinite(preferredDepth) || preferredDepth <= 0) return;
            const target = this.findGameObjectByRelativeHierarchyPath(root, path || null);
            if (!target) return;

            const ownershipChain = PrefabManager.getPrefabOwnershipChain(target);
            const preferredRoot = ownershipChain[Math.trunc(preferredDepth)] ?? null;
            if (!preferredRoot) return;
            this.prefabApplyTargetRootIds.set(target.id, preferredRoot.id);
            didRestoreAny = true;
        });

        return didRestoreAny;
    }

    private persistPrefabApplyTargetRootPreferences(): void {
        EditorSettings.prefabApplyTargetRootIds = this.serializePrefabApplyTargetRootIds();
        this.saveLayout(false);
    }

    private findGameObjectByRelativeHierarchyPath(root: GameObject, relativePath: string | null): GameObject | null {
        if (!relativePath) return root;

        const segments = relativePath.split('/').filter(Boolean);
        let current = root;
        for (const segment of segments) {
            const next = current.transform.children.find((child) => this.getHierarchyPathSegment(child.gameObject) === segment)?.gameObject ?? null;
            if (!next) return null;
            current = next;
        }
        return current;
    }

    private getRelativeHierarchyPath(root: GameObject, target: GameObject): string | null {
        if (root === target) return null;

        const segments: string[] = [];
        let current: GameObject | null = target;
        while (current && current !== root) {
            segments.unshift(this.getHierarchyPathSegment(current));
            current = current.transform.parent?.gameObject ?? null;
        }

        return current === root ? segments.join('/') : null;
    }

    private getHierarchyPathSegment(gameObject: GameObject): string {
        const parent = gameObject.transform.parent;
        if (!parent) return `${gameObject.name}#0`;

        const siblings = parent.children.map((child) => child.gameObject);
        const sameNameSiblings = siblings.filter((sibling) => sibling.name === gameObject.name);
        const index = sameNameSiblings.indexOf(gameObject);
        return `${gameObject.name}#${Math.max(0, index)}`;
    }

    private setTab(mode: EditorViewportTab, save: boolean = true) {
        this.activeViewportTab = mode;
        this.activeViewportFocusHost = 'viewport';
        this.activeViewportDockTab = null;
        this.updateViewportHostState();
        this.syncWindowMenuState();
        if (save) this.saveLayout();
    }

    private updateViewportHostState() {
        this.isGameView = !this.activeViewportDockTab && this.activeViewportTab === 'game';
        const tabScene = document.getElementById('tab-scene');
        const tabGame = document.getElementById('tab-game');
        const viewScene = document.getElementById('scene-view');
        const viewGame = document.getElementById('game-view');
        const viewportContent = document.getElementById('viewport-content');
        const viewportDockContentHost = document.getElementById('viewport-dock-content-host') as HTMLElement | null;
        const sceneToolbar = document.getElementById('scene-toolbar');
        const gameToolbar = document.getElementById('game-toolbar');
        const editorContainer = document.getElementById('editor-container');

        const dockedViewportContents = ['assets-content', 'console-content', 'render-content']
            .map((id) => document.getElementById(id) as HTMLElement | null)
            .filter((element): element is HTMLElement => element !== null && element.parentElement?.id === 'viewport-dock-content-host');

        const viewportDockTabs = ['tab-assets', 'tab-console', 'tab-render']
            .map((id) => document.getElementById(id) as HTMLElement | null)
            .filter((element): element is HTMLElement => element !== null && element.parentElement?.id === 'viewport-dock-tabs');

        const dockedViewportActive = this.activeViewportDockTab !== null;

        if (tabScene && tabGame) {
            tabScene.classList.toggle('active-tab', !dockedViewportActive && this.activeViewportTab === 'scene');
            tabGame.classList.toggle('active-tab', !dockedViewportActive && this.activeViewportTab === 'game');
            tabScene.style.fontWeight = !dockedViewportActive && this.activeViewportTab === 'scene' ? 'bold' : 'normal';
            tabGame.style.fontWeight = !dockedViewportActive && this.activeViewportTab === 'game' ? 'bold' : 'normal';
            tabScene.style.color = !dockedViewportActive && this.activeViewportTab === 'scene' ? '#fff' : '#888';
            tabGame.style.color = !dockedViewportActive && this.activeViewportTab === 'game' ? '#fff' : '#888';

            viewportDockTabs.forEach((tab) => {
                tab.classList.toggle('viewport-host-active', dockedViewportActive);
            });

            if (dockedViewportActive) {
                this.isGameView = false;
                if (viewScene) viewScene.style.display = 'none';
                if (viewGame) viewGame.style.display = 'none';
                if (sceneToolbar) sceneToolbar.style.display = 'none';
                if (gameToolbar) gameToolbar.style.display = 'none';
                if (viewportContent) viewportContent.style.display = 'flex';
                if (viewportDockContentHost) viewportDockContentHost.style.display = 'block';
                dockedViewportContents.forEach((content) => {
                    content.style.display = this.activeViewportDockTab !== null && this.getContentIdForDockableView(this.activeViewportDockTab) === content.id
                        ? 'block'
                        : 'none';
                });
                if (editorContainer) editorContainer.style.filter = 'none';
            } else if (this.activeViewportTab === 'scene') {
                tabScene.classList.add('active-tab');
                tabGame.classList.remove('active-tab');
                if (viewScene) viewScene.style.display = 'block';
                if (viewGame) viewGame.style.display = 'none';
                if (viewportContent) viewportContent.style.display = 'flex';
                if (viewportDockContentHost) viewportDockContentHost.style.display = 'none';
                if (sceneToolbar) sceneToolbar.style.display = 'flex';
                if (gameToolbar) gameToolbar.style.display = 'none';
                dockedViewportContents.forEach((content) => content.style.display = 'none');
                if (this.renderer) {
                    viewScene?.appendChild(this.renderer.domElement);
                }
                if (editorContainer) editorContainer.style.filter = 'none';

                // Restore scene size
                if (this.renderer) {
                    this.scheduleViewportResize();
                }
            } else {
                tabGame.classList.add('active-tab');
                tabScene.classList.remove('active-tab');
                if (viewGame) viewGame.style.display = 'flex';
                if (viewScene) viewScene.style.display = 'none';
                if (viewportContent) viewportContent.style.display = 'flex';
                if (viewportDockContentHost) viewportDockContentHost.style.display = 'none';
                if (sceneToolbar) sceneToolbar.style.display = 'none';
                if (gameToolbar) gameToolbar.style.display = 'flex';
                dockedViewportContents.forEach((content) => content.style.display = 'none');
                const gameContainer = document.getElementById('game-view-container');
                if (gameContainer && this.renderer) gameContainer.appendChild(this.renderer.domElement);

                // Apply subtle tint in Play Mode
                if (editorContainer) editorContainer.style.filter = 'sepia(0.1) brightness(0.9) saturate(1.1)';

                if (this.renderer) this.updateGameViewResolution();
            }
            if (this.renderer) this.resize();
        }
    }

    private updateGameViewResolution() {
        const resSelect = document.getElementById('game-resolution-select') as HTMLSelectElement;
        const container = document.getElementById('game-view');
        const gameContainer = document.getElementById('game-view-container');
        if (!resSelect || !container || !gameContainer) return;

        const val = resSelect.value;

        // Reset container first
        gameContainer.style.width = '100%';
        gameContainer.style.height = '100%';

        if (val === 'free') {
            const w = container.clientWidth;
            const h = container.clientHeight;
            this.applyViewportSize(w, h, w / h);
        } else {
            let ratio = 16 / 9;
            if (val === '16:10') ratio = 16 / 10;
            if (val === '4:3') ratio = 4 / 3;
            if (val === '1920:1080') ratio = 1920 / 1080;
            if (val === '1280:720') ratio = 1280 / 720;

            const maxWidth = container.clientWidth;
            const maxHeight = container.clientHeight;

            let targetWidth = maxWidth;
            let targetHeight = maxWidth / ratio;

            if (targetHeight > maxHeight) {
                targetHeight = maxHeight;
                targetWidth = maxHeight * ratio;
            }

            gameContainer.style.width = targetWidth + 'px';
            gameContainer.style.height = targetHeight + 'px';

            this.applyViewportSize(targetWidth, targetHeight, ratio);
        }
    }

    private updateToolButtons(activeMode: string) {
        const tools = ['translate', 'rotate', 'scale'];
        tools.forEach(mode => {
            const btn = document.getElementById(`tool-${mode}`);
            if (btn) {
                if (mode === activeMode) btn.classList.add('active');
                else btn.classList.remove('active');
            }
        });
        this.updateTransformToolToggleButtons();
    }

    private setTransformToolMode(mode: 'view' | 'translate' | 'rotate' | 'scale' | 'rect') {
        this.activeTransformToolMode = mode;

        if (mode === 'view') {
            this.transformControls.detach();
            this.updateToolButtons('none');
            return;
        }

        const resolvedMode = mode === 'rect' ? 'translate' : mode;
        this.transformControls.setMode(resolvedMode);
        this.updateToolButtons(resolvedMode);
        this.updateTransformControlsAttachment();
    }

    private updateTransformToolToggleButtons() {
        const btnPivot = document.getElementById('tool-pivot') as HTMLButtonElement | null;
        const btnSpace = document.getElementById('tool-space') as HTMLButtonElement | null;
        const btnSnap = document.getElementById('tool-snap') as HTMLButtonElement | null;

        if (btnPivot) {
            btnPivot.innerText = this.transformPivotMode === 'center' ? 'Center' : 'Pivot';
            btnPivot.classList.toggle('active', this.transformPivotMode === 'center');
            btnPivot.title = this.transformPivotMode === 'center' ? 'Center Pivot Mode' : 'Pivot Mode';
        }

        if (btnSpace) {
            btnSpace.innerText = this.transformSpaceMode === 'world' ? 'World' : 'Local';
            btnSpace.classList.toggle('active', this.transformSpaceMode === 'world');
            btnSpace.title = this.transformSpaceMode === 'world' ? 'World Space (X)' : 'Local Space (X)';
        }

        if (btnSnap) {
            const persistent = EditorSettings.snapEnabled;
            const effective = persistent || this.temporarySnapActive;
            const snapInfo = this.getActiveSnapInfo();
            btnSnap.innerText = this.temporarySnapActive && !persistent
                ? `Snap: Hold (${snapInfo.label})`
                : `Snap: ${persistent ? 'On' : 'Off'} (${snapInfo.label})`;
            btnSnap.title = `Current ${snapInfo.mode} snap: ${snapInfo.valueText}. Use [ / ] to adjust active tool snap.`;
            btnSnap.classList.toggle('active', effective);
        }
    }

    private getActiveTransformMode(): 'translate' | 'rotate' | 'scale' {
        const mode = this.transformControls.getMode();
        if (mode === 'rotate' || mode === 'scale') return mode;
        return 'translate';
    }

    private getActiveSnapInfo(): { mode: 'translate' | 'rotate' | 'scale'; valueText: string; label: string } {
        const mode = this.getActiveTransformMode();
        if (mode === 'rotate') {
            const value = EditorSettings.snapRotation;
            return { mode, valueText: `${value.toFixed(1)}deg`, label: `R ${value.toFixed(1)}deg` };
        }
        if (mode === 'scale') {
            const value = EditorSettings.snapScale;
            return { mode, valueText: value.toFixed(3), label: `S ${value.toFixed(3)}` };
        }
        const value = EditorSettings.snapTranslation;
        return { mode, valueText: value.toFixed(3), label: `T ${value.toFixed(3)}` };
    }

    private adjustActiveSnapStep(direction: -1 | 1): void {
        const mode = this.getActiveTransformMode();
        if (mode === 'rotate') {
            const rotationSteps = [1, 2, 5, 10, 15, 30, 45, 90];
            const current = EditorSettings.snapRotation;
            const nearestIndex = rotationSteps.reduce((bestIndex, step, index) => {
                const bestDelta = Math.abs(rotationSteps[bestIndex] - current);
                const delta = Math.abs(step - current);
                return delta < bestDelta ? index : bestIndex;
            }, 0);
            const nextIndex = Math.min(rotationSteps.length - 1, Math.max(0, nearestIndex + direction));
            EditorSettings.snapRotation = rotationSteps[nextIndex];
        } else if (mode === 'scale') {
            const nextValue = direction > 0
                ? EditorSettings.snapScale * 2
                : EditorSettings.snapScale / 2;
            EditorSettings.snapScale = THREE.MathUtils.clamp(Number(nextValue.toFixed(4)), 0.001, 10);
        } else {
            const nextValue = direction > 0
                ? EditorSettings.snapTranslation * 2
                : EditorSettings.snapTranslation / 2;
            EditorSettings.snapTranslation = THREE.MathUtils.clamp(Number(nextValue.toFixed(4)), 0.001, 1000);
        }

        EditorSettings.save();
        this.applySnapSettingsToTransformControls();
        this.updateTransformToolToggleButtons();
    }

    private applySnapSettingsToTransformControls() {
        const effective = EditorSettings.snapEnabled || this.temporarySnapActive;
        if (effective) {
            this.transformControls.setTranslationSnap(EditorSettings.snapTranslation);
            this.transformControls.setRotationSnap(THREE.MathUtils.degToRad(EditorSettings.snapRotation));
            this.transformControls.setScaleSnap(EditorSettings.snapScale);
        } else {
            this.transformControls.setTranslationSnap(null);
            this.transformControls.setRotationSnap(null);
            this.transformControls.setScaleSnap(null);
        }
    }

    private createDemoScene() {
        const cube = new GameObject("Cube");
        const cubeFilter = cube.addComponent(MeshFilter);
        cubeFilter.setPrimitiveType('Cube');
        const cubeRenderer = cube.addComponent(MeshRenderer);
        cubeRenderer.mesh.geometry = new THREE.BoxGeometry(1, 1, 1);
        const autoRotate = ScriptRegistry.create("AutoRotate", cube);
        if (autoRotate) {
            cube.addComponent(autoRotate);
            (autoRotate as any).rotationSpeed = 4.0;
        }
        this.scene.addGameObject(cube);

        const floor = new GameObject("Floor");
        const floorFilter = floor.addComponent(MeshFilter);
        floorFilter.setPrimitiveType('Plane');
        const renderer = floor.addComponent(MeshRenderer);
        renderer.mesh.geometry = new THREE.PlaneGeometry(10, 10);
        renderer.mesh.rotateX(-Math.PI / 2);
        renderer.setColor(0x444444);
        floor.transform.position.y = -1;
        this.scene.addGameObject(floor);
    }

    private onWindowResize() {
        EditorSettings.floatingPanels = this.normalizeFloatingPanelMap(EditorSettings.floatingPanels);
        this.applyFloatingPanelStates();
        this.clampLayoutSizes();
        this.scheduleViewportResize();
    }

    private initializeViewportResizePolicy() {
        if (typeof ResizeObserver !== 'undefined') {
            this.viewportResizeObserver = new ResizeObserver(() => this.scheduleViewportResize());
            [
                this.sceneView,
                document.getElementById('game-view'),
                document.getElementById('game-view-container'),
                document.getElementById('viewport-content')
            ].forEach((host) => {
                if (host) this.viewportResizeObserver?.observe(host);
            });
        }
    }

    private scheduleViewportResize() {
        if (this.viewportResizeFrame !== null) return;
        this.viewportResizeFrame = requestAnimationFrame(() => {
            this.viewportResizeFrame = null;
            if (this.isGameView) this.updateGameViewResolution();
            else this.resize();
        });
    }

    private applyViewportSize(width: number, height: number, aspect = width / height) {
        const nextSize = calculateViewportSize(width, height, window.devicePixelRatio);
        if (!nextSize || viewportSizeEquals(this.appliedViewportSize, nextSize)) return;
        this.appliedViewportSize = nextSize;
        this.renderer.setPixelRatio(nextSize.pixelRatio);
        this.renderer.setSize(nextSize.width, nextSize.height, false);
        this.composer.setPixelRatio(nextSize.pixelRatio);
        this.composer.setSize(nextSize.width, nextSize.height);
        if (this.ssaoPass) this.ssaoPass.setSize(nextSize.width, nextSize.height);
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
        if (this.sceneGizmo) this.sceneGizmo.onResize();
    }

    private resize() {
        const container = this.renderer.domElement.parentElement;
        if (!container) return;
        this.applyViewportSize(container.clientWidth, container.clientHeight);
    }

    private animate() {
        requestAnimationFrame(() => this.animate());
        const nowSeconds = performance.now() / 1000;
        if (this.isPlaying && this.shouldThrottleFrame(nowSeconds)) {
            return;
        }

        const deltaTime = this.clock.getDelta();
        this.updatePerformanceMetrics(deltaTime);
        Input.update(deltaTime);

        if (this.isPlaying && (!this.isPaused || this.stepRequest)) {
            this.playMode.update();
            this.stepRequest = false;
        } else {
            if (this.cameraGO?.enabled) {
                this.cameraGO.update(deltaTime);
                this.cameraGO.lateUpdate();
            }
            this.gizmos.forEach((helper, comp) => {
                if ((comp as any).updateGizmo) (comp as any).updateGizmo(helper);
                //@ts-ignore
                else if (helper && helper.update) helper.update();
            });
        }

        if (this.isGameView) {
            this.renderGameView();
        } else {
            this.composer.render();
        }

        if (this.scene) {
            this.updatePostProcessing();
        }
        this.sceneGizmo.update();
        this.updateSceneIcons();
        this.selectionHelpers.forEach(helper => helper.update());

        // Keyboard Shortcuts
        if (Input.getKeyDown('KeyF')) this.focusOnSelectionOrScene();
        if (Input.getButtonDown('Submit')) { /* Handle Enter if needed */ }

        Input.lateUpdate();

        this.statsTimer += deltaTime;
        if (this.statsTimer >= 0.1) {
            this.updateStatusBar();
            this.updateSceneOnboardingHint();
            this.updateStatsOverlay();
            this.statsTimer = 0;
        }
    }

    private statsOverlay: HTMLElement | null = null;
    private updatePerformanceMetrics(deltaTime: number): void {
        const safeDelta = Math.max(0, Number.isFinite(deltaTime) ? deltaTime : 0);
        this.perfAccumulatedSeconds += safeDelta;
        this.perfAccumulatedFrames += 1;
        if (this.perfAccumulatedSeconds < 0.25) return;

        this.smoothedFps = this.perfAccumulatedSeconds > 0
            ? this.perfAccumulatedFrames / this.perfAccumulatedSeconds
            : 0;
        this.smoothedFrameMs = this.smoothedFps > 0 ? 1000 / this.smoothedFps : 0;
        this.perfAccumulatedSeconds = 0;
        this.perfAccumulatedFrames = 0;
    }

    private updateStatsOverlay() {
        if (!this.statsOverlay) {
            this.statsOverlay = document.createElement('div');
            this.statsOverlay.style.cssText = `
                position: absolute; top: 68px; right: 10px;
                background: rgba(0,0,0,0.62); color: #cfd6df;
                padding: 10px; font-family: monospace; font-size: 11px;
                border-radius: 4px; pointer-events: none; z-index: 100;
                min-width: 210px;
                display: none;
            `;
            this.sceneView.appendChild(this.statsOverlay);
        }

        const info = this.renderer.info;
        const totalObjects = this.scene?.gameObjects?.length ?? 0;
        const activeObjects = (this.scene?.gameObjects ?? []).filter((go) => go.enabled).length;
        const selectionCount = this.selectedGameObjects.filter((go) => go !== this.cameraGO).length;
        const fps = this.smoothedFps > 0 ? Math.round(this.smoothedFps) : 0;
        const ms = this.smoothedFrameMs > 0 ? this.smoothedFrameMs.toFixed(1) : '0.0';
        this.statsOverlay.innerHTML = `
            <div style="color: #fff; font-weight: bold; margin-bottom: 4px; border-bottom: 1px solid #555;">Stats (${this.isGameView ? 'Game' : 'Scene'})</div>
            FPS: ${fps} (${ms} ms)<br>
            Draw Calls: ${info.render.calls}<br>
            Triangles: ${info.render.triangles}<br>
            Lines: ${info.render.lines}<br>
            Textures: ${info.memory.textures}<br>
            Geometries: ${info.memory.geometries}<br>
            Objects: ${activeObjects}/${totalObjects}<br>
            Selected: ${selectionCount}
        `;
    }

    private createStatusBar(): HTMLElement {
        const existing = document.getElementById('status-bar');
        if (existing) return existing;

        const bar = document.createElement('div');
        bar.id = 'editor-status-bar';
        bar.style.position = 'absolute';
        bar.style.bottom = '0'; bar.style.left = '0'; bar.style.right = '0';
        bar.style.height = '22px';
        bar.style.background = 'var(--unity-bg-header)';
        bar.style.borderTop = '1px solid var(--unity-border)';
        bar.style.display = 'flex';
        bar.style.alignItems = 'center';
        bar.style.padding = '0 10px';
        bar.style.fontSize = '11px';
        bar.style.color = 'var(--unity-text-dim)';
        bar.style.zIndex = '100';
        document.body.appendChild(bar);
        return bar;
    }

    private updateStatusBar() {
        const fpsVal = this.smoothedFps > 0 ? Math.round(this.smoothedFps) : 0;
        const frameMs = this.smoothedFrameMs > 0 ? this.smoothedFrameMs.toFixed(1) : '0.0';

        const scenePath = SceneManager.getInstance().getActiveScenePath() || "Unsaved Scene";
        const lastLog = (this.consoleWindow as any).logs?.length > 0
            ? (this.consoleWindow as any).logs[(this.consoleWindow as any).logs.length - 1].message
            : "Ready";

        const displayLog = lastLog.length > 80 ? lastLog.substring(0, 77) + "..." : lastLog;
        const selectionTargets = this.selectedGameObjects.filter((go) => go !== this.cameraGO);
        const selectionLabel = selectionTargets.length === 0
            ? 'No Selection'
            : selectionTargets.length === 1
                ? `Selected: ${selectionTargets[0].name}`
                : `Selected: ${selectionTargets.length} Objects`;
        const sceneName = scenePath.split(/[\\/]/).pop() || scenePath;
        const playModeText = this.isPlaying ? (this.isPaused ? 'PAUSED' : 'PLAYING') : 'EDITING';

        const setText = (id: string, value: string, title?: string) => {
            const element = this.statusBar.querySelector(`#${id}`) as HTMLElement | null;
            if (!element) return;
            if (element.textContent !== value) {
                element.textContent = value;
            }
            if (title !== undefined && element.getAttribute('title') !== title) {
                element.setAttribute('title', title);
            }
        };

        setText('status-text', displayLog, lastLog);
        setText('status-selection', selectionLabel, selectionLabel);
        setText('status-scene', sceneName, scenePath);
        setText('status-fps', `FPS: ${fpsVal}`);
        setText('status-ms', `MS: ${frameMs}`);
        setText('status-drawcalls', `DC: ${this.renderer.info.render.calls}`);
        setText('status-playmode', playModeText, playModeText);

        const playModeEl = this.statusBar.querySelector('#status-playmode') as HTMLElement | null;
        if (playModeEl) {
            playModeEl.classList.toggle('is-playing', this.isPlaying && !this.isPaused);
            playModeEl.classList.toggle('is-paused', this.isPlaying && this.isPaused);
        }
    }

    private updateSceneOnboardingHint() {
        if (!this.sceneView) return;

        if (!this.sceneOnboardingHint) {
            const hint = document.createElement('div');
            hint.className = 'scene-onboarding-hint';
            hint.style.display = 'none';
            this.sceneView.appendChild(hint);
            this.sceneOnboardingHint = hint;
        }

        if (this.isGameView) {
            this.sceneOnboardingHint.style.display = 'none';
            return;
        }

        const sceneObjects = (this.scene?.gameObjects ?? []).filter((go) => go !== this.cameraGO);
        const selectedObjects = this.selectedGameObjects.filter((go) => go !== this.cameraGO);

        if (sceneObjects.length === 0) {
            this.sceneOnboardingHint.innerHTML = `
                <strong>Start by creating a GameObject</strong>
                Use the Hierarchy + button, right click in Hierarchy, or open the GameObject menu to place your first object.
            `;
            this.sceneOnboardingHint.style.display = 'block';
            return;
        }

        if (selectedObjects.length === 0) {
            this.sceneOnboardingHint.innerHTML = `
                <strong>Select an object to inspect it</strong>
                Click an object in Hierarchy or Scene view, then use W, E and R to move, rotate or scale the current selection.
            `;
            this.sceneOnboardingHint.style.display = 'block';
            return;
        }

        this.sceneOnboardingHint.style.display = 'none';
    }

    public selectGameObject(go: GameObject | null, additive: boolean = false, source: EditorSelectionSource = 'hierarchy') {
        if (!go) {
            this.applyGameObjectSelection([], null, source);
            return;
        }

        if (additive) {
            const current = this.normalizeSelectionTargets(this.selectedGameObjects);
            const index = current.indexOf(go);
            if (index > -1) {
                current.splice(index, 1);
                const nextActive = current[current.length - 1] ?? null;
                this.applyGameObjectSelection(current, nextActive, source);
                return;
            }

            this.applyGameObjectSelection([...current, go], go, source);
            return;
        }

        this.applyGameObjectSelection([go], go, source);
    }

    public selectGameObjectRange(
        gameObjects: GameObject[],
        additive: boolean = false,
        preferredActive: GameObject | null = null,
        source: EditorSelectionSource = 'hierarchy'
    ) {
        const uniqueTargets = this.normalizeSelectionTargets(gameObjects);
        const nextSelection = additive
            ? [
                ...this.normalizeSelectionTargets(this.selectedGameObjects).filter((selected) => !uniqueTargets.includes(selected)),
                ...uniqueTargets
            ]
            : uniqueTargets;
        const nextActive = preferredActive && nextSelection.includes(preferredActive)
            ? preferredActive
            : (nextSelection[nextSelection.length - 1] ?? null);
        this.applyGameObjectSelection(nextSelection, nextActive, source);
    }

    private addGameObjectToSelection(go: GameObject, source: EditorSelectionSource = 'hierarchy'): void {
        if (!go || go === this.cameraGO) return;
        const ordered = [
            ...this.selectedGameObjects.filter((selected) => selected !== go && selected !== this.cameraGO),
            go
        ];
        this.selectGameObjectRange(ordered, false, null, source);
    }

    private updateOutlineSelection() {
        if (!this.outlinePass) return;
        const selectedObjects: THREE.Object3D[] = [];
        this.selectedGameObjects.forEach(go => {
            if (go.object3D) selectedObjects.push(go.object3D);
        });
        this.outlinePass.selectedObjects = selectedObjects;
    }

    public getSelectedGameObjects(): GameObject[] {
        return [...this.selectedGameObjects];
    }

    public setSelectionActiveState(nextEnabled: boolean, selectedOverride?: GameObject[]): void {
        const targets = this.getSelectionStateTargets(selectedOverride);
        if (targets.length === 0) return;

        const oldValues = targets.map((target) => Boolean(target.enabled));
        const primary = targets[targets.length - 1] ?? targets[0];
        CommandHistory.execute({
            name: `Toggle Active ${primary.name} (${targets.length} selected)`,
            execute: () => {
                targets.forEach((target) => target.setActive(nextEnabled));
                this.hierarchyWindow.refresh();
                this.inspectorWindow.refresh();
            },
            undo: () => {
                targets.forEach((target, index) => target.setActive(oldValues[index]));
                this.hierarchyWindow.refresh();
                this.inspectorWindow.refresh();
            }
        });
    }

    public setSelectionStaticState(nextStatic: boolean, selectedOverride?: GameObject[]): void {
        const targets = this.getSelectionStateTargets(selectedOverride);
        if (targets.length === 0) return;

        const oldValues = targets.map((target) => Boolean(target.isStatic));
        const primary = targets[targets.length - 1] ?? targets[0];
        CommandHistory.execute({
            name: `Change Static ${primary.name} (${targets.length} selected)`,
            execute: () => {
                targets.forEach((target) => {
                    target.isStatic = nextStatic;
                });
                this.hierarchyWindow.refresh();
                this.inspectorWindow.refresh();
            },
            undo: () => {
                targets.forEach((target, index) => {
                    target.isStatic = oldValues[index];
                });
                this.hierarchyWindow.refresh();
                this.inspectorWindow.refresh();
            }
        });
    }

    private normalizeSelectionTargets(targets: Array<GameObject | null | undefined>): GameObject[] {
        const unique: GameObject[] = [];
        const seen = new Set<string>();
        targets.forEach((target) => {
            if (!target || target === this.cameraGO) return;
            if (seen.has(target.id)) return;
            seen.add(target.id);
            unique.push(target);
        });
        return unique;
    }

    private getSelectionStateTargets(selectedOverride?: GameObject[]): GameObject[] {
        const normalized = this.normalizeSelectionTargets(selectedOverride ?? this.selectedGameObjects);
        if (normalized.length > 0) return normalized;
        return this.selectedGameObject && this.selectedGameObject !== this.cameraGO
            ? [this.selectedGameObject]
            : [];
    }

    private applyGameObjectSelection(
        targets: Array<GameObject | null | undefined>,
        preferredActive: GameObject | null = null,
        source: EditorSelectionSource = 'command'
    ): void {
        const normalizedTargets = this.normalizeSelectionTargets(targets);
        const activeSelection = preferredActive && normalizedTargets.includes(preferredActive)
            ? preferredActive
            : (normalizedTargets[normalizedTargets.length - 1] ?? null);

        this.selectionHelpers.forEach((helper) => this.scene.threeScene.remove(helper));
        this.selectionHelpers.clear();

        this.selectedGameObjects = normalizedTargets;
        this.selectedGameObject = activeSelection;
        this.selection.selectScene(normalizedTargets.map((target) => target.id), activeSelection?.id ?? null, source);
        this.projectWindow?.applyAuthoritativeSelection(null);

        this.selectedGameObjects.forEach((target) => {
            const helper = new THREE.BoxHelper(target.object3D, 0xffff00);
            // @ts-ignore
            helper.material.opacity = 0.5;
            // @ts-ignore
            helper.material.transparent = true;
            this.scene.threeScene.add(helper);
            this.selectionHelpers.set(target, helper);
        });

        this.outlinePass.selectedObjects = this.selectedGameObjects.map((obj) => obj.object3D);
        this.updateTransformControlsAttachment();

        this.gizmos.forEach((gizmo) => this.scene.threeScene.remove(gizmo));
        this.gizmos.clear();

        if (this.selectedGameObject) {
            this.selectedGameObject.components.forEach((component) => {
                if (!(component as any).createGizmo) return;
                const gizmo = (component as any).createGizmo();
                if (!gizmo) return;
                this.scene.threeScene.add(gizmo);
                this.gizmos.set(component, gizmo);
            });
            this.inspectorWindow.selectGameObject(this.selectedGameObject);
        } else {
            this.inspectorWindow.selectGameObject(null);
        }

        this.hierarchyWindow.refresh();
        this.updateOutlineSelection();
        this.syncWindowMenuState();
    }

    public selectProjectAsset(asset: ProjectAssetSelection, focus = false): void {
        if (!asset.meta?.guid) throw new Error(`Cannot select asset without GUID: ${asset.path}`);
        this.clearSceneSelectionVisuals();
        this.selection.selectAsset(asset.meta.guid, asset.path, 'project', {
            panel: 'project', controlId: focus ? asset.meta.guid : null
        });
        this.projectWindow?.applyAuthoritativeSelection(asset.path);
        this.inspectorWindow.selectAsset(asset);
        this.hierarchyWindow.refresh();
        this.syncWindowMenuState();
    }

    public reconcileProjectSelection(clearMissing = false): void {
        const next = this.selection.reconcileAsset((guid) => AssetDatabase.getInstance().getPath(guid) ?? null);
        if (next.kind !== 'asset' || next.resolved) return;
        this.projectWindow?.applyAuthoritativeSelection(null);
        if (clearMissing) {
            this.selection.clear('command');
            this.inspectorWindow.selectGameObject(null);
        } else {
            this.inspectorWindow.selectMissingAsset(next.guid, next.lastKnownPath);
        }
    }

    private clearSceneSelectionVisuals(): void {
        this.selectionHelpers.forEach((helper) => this.scene.threeScene.remove(helper));
        this.selectionHelpers.clear();
        this.selectedGameObjects = [];
        this.selectedGameObject = null;
        if (this.outlinePass) this.outlinePass.selectedObjects = [];
        this.updateTransformControlsAttachment();
        this.gizmos.forEach((gizmo) => this.scene.threeScene.remove(gizmo));
        this.gizmos.clear();
    }

    public selectAllSceneObjects() {
        const allSceneObjects = this.scene.gameObjects.filter((go) => go !== this.cameraGO);
        this.selectGameObjectRange(allSceneObjects, false);
    }

    public getPrefabContextRoot(gameObject: GameObject): GameObject | null {
        return PrefabManager.getPrefabOwningRoot(gameObject);
    }

    public getPrefabApplyTargetRoot(gameObject: GameObject): GameObject | null {
        const chain = PrefabManager.getPrefabOwnershipChain(gameObject);
        if (chain.length === 0) return null;

        const preferredId = this.prefabApplyTargetRootIds.get(gameObject.id);
        const preferredRoot = preferredId ? chain.find((candidate) => candidate.id === preferredId) ?? null : null;
        if (preferredId && !preferredRoot) {
            this.prefabApplyTargetRootIds.delete(gameObject.id);
            EditorSettings.prefabApplyTargetRootIds = this.serializePrefabApplyTargetRootIds();
        }
        return preferredRoot ?? chain[0];
    }

    public setPrefabApplyTargetRoot(gameObject: GameObject, prefabRootId: string): void {
        const chain = PrefabManager.getPrefabOwnershipChain(gameObject);
        const targetRoot = chain.find((candidate) => candidate.id === prefabRootId);
        if (!targetRoot) return;
        this.prefabApplyTargetRootIds.set(gameObject.id, targetRoot.id);
        EditorSettings.prefabApplyTargetRootIds = this.serializePrefabApplyTargetRootIds();
        this.saveLayout(false);
        this.hierarchyWindow.refresh();
        this.inspectorWindow.refresh();
    }

    public getPrefabApplyTargetOptions(gameObject: GameObject): Array<{
        id: string;
        label: string;
        sourcePath: string | null;
        depth: number;
        isNearest: boolean;
    }> {
        return PrefabManager.getPrefabOwnershipChain(gameObject).map((root, index) => ({
            id: root.id,
            label: root.sourceAssetPath
                ? PathUtils.basename(root.sourceAssetPath)
                : root.prefabSource
                    ? `${root.prefabSource}.prefab`
                    : root.name,
            sourcePath: root.sourceAssetPath ?? null,
            depth: index,
            isNearest: index === 0
        }));
    }

    public getPrefabContextInfo(gameObject: GameObject): {
        contextRoot: GameObject;
        applyTargetRoot: GameObject;
        sourcePath: string | null;
        assetLabel: string;
        nodePath: string | null;
        nodeLabel: string;
        contextRootLabel: string;
        selectionLabel: string;
        isContextRoot: boolean;
        isApplyTargetContextRoot: boolean;
        applyTargetOptions: Array<{
            id: string;
            label: string;
            sourcePath: string | null;
            depth: number;
            isNearest: boolean;
        }>;
    } | null {
        const contextRoot = PrefabManager.getPrefabOwningRoot(gameObject);
        if (!contextRoot) return null;
        const applyTargetRoot = this.getPrefabApplyTargetRoot(gameObject) ?? contextRoot;
        const applyTargetOptions = this.getPrefabApplyTargetOptions(gameObject);

        const sourcePath = applyTargetRoot.sourceAssetPath ?? null;
        const assetLabel = sourcePath
            ? PathUtils.basename(sourcePath)
            : applyTargetRoot.prefabSource
                ? `${applyTargetRoot.prefabSource}.prefab`
                : applyTargetRoot.name;
        const nodePath = PrefabManager.getPrefabNodePathForGameObject(gameObject, applyTargetRoot);
        const nodeLabel = nodePath ? nodePath.replace(/#\d+/g, '') : gameObject.name;

        return {
            contextRoot,
            applyTargetRoot,
            sourcePath,
            assetLabel,
            nodePath,
            nodeLabel,
            contextRootLabel: contextRoot.name,
            selectionLabel: gameObject.name,
            isContextRoot: contextRoot === gameObject,
            isApplyTargetContextRoot: applyTargetRoot === contextRoot,
            applyTargetOptions
        };
    }

    public async isPropertyOverridden(target: any, propertyKey: string): Promise<boolean> {
        const gameObject = target instanceof GameObject ? target : target?.gameObject;
        const prefabRoot = gameObject ? this.getPrefabApplyTargetRoot(gameObject) : null;
        if (!gameObject || !prefabRoot) return false;

        const prefabData = await this.getPrefabSourceData(gameObject, prefabRoot);
        if (!prefabData) return false;

        if (target === gameObject) {
            return this.areOverrideValuesDifferent((gameObject as any)[propertyKey], prefabData[propertyKey]);
        }

        if (target === gameObject.transform) {
            if (propertyKey === 'position' || propertyKey === 'scale') {
                return this.areOverrideValuesDifferent(target[propertyKey]?.toArray?.() ?? null, prefabData.transform?.[propertyKey]);
            }

            if (propertyKey === 'rotation') {
                return this.areOverrideValuesDifferent(
                    [target.rotation.x, target.rotation.y, target.rotation.z],
                    prefabData.transform?.rotation
                );
            }

            return false;
        }

        const componentData = await this.getPrefabComponentData(gameObject, target.constructor?.name, prefabRoot);
        if (!componentData) return true;

        const serializedTarget = target.serialize?.().data ?? {};
        return this.areOverrideValuesDifferent(serializedTarget[propertyKey], componentData.data?.[propertyKey]);
    }

    public async getPrefabComponentStatus(component: any): Promise<'default' | 'overridden' | 'added'> {
        const gameObject = component?.gameObject;
        const prefabRoot = gameObject ? this.getPrefabApplyTargetRoot(gameObject) : null;
        if (!gameObject || !prefabRoot) return 'default';

        const prefabData = await this.getPrefabSourceData(gameObject, prefabRoot);
        if (!prefabData) return 'default';

        if (component === gameObject.transform) {
            return ['position', 'rotation', 'scale'].some( async(key) => await this.isPropertyOverridden(component, key))
                ? 'overridden'
                : 'default';
        }

        const componentData = await this.getPrefabComponentData(gameObject, component.constructor?.name, prefabRoot);
        if (!componentData) return 'added';

        const serializedTarget = component.serialize?.().data ?? {};
        return this.areOverrideValuesDifferent(serializedTarget, componentData.data ?? {})
            ? 'overridden'
            : 'default';
    }

    public async getPrefabOverrideSummary(gameObject: GameObject): Promise<{ total: number; addedComponents: number; removedComponents: number }> {
        const prefabRoot = this.getPrefabApplyTargetRoot(gameObject);
        if (!prefabRoot) {
            return { total: 0, addedComponents: 0, removedComponents: 0 };
        }

        let total = 0;
        let addedComponents = 0;
        let removedComponents = 0;

        ['name', 'tag', 'layer', 'isStatic', 'enabled'].forEach( async(key) => {
            if (await this.isPropertyOverridden(gameObject, key)) total += 1;
        });

        ['position', 'rotation', 'scale'].forEach( async(key) => {
            if (await this.isPropertyOverridden(gameObject.transform, key)) total += 1;
        });

        gameObject.components.forEach( async(component) => {
            if (component === gameObject.transform) return;
            const status = await this.getPrefabComponentStatus(component);
            if (status === 'default') return;
            total += 1;
            if (status === 'added') addedComponents += 1;
        });

        const prefabData = await this.getPrefabSourceData(gameObject, prefabRoot);
        if (prefabData?.components) {
            prefabData.components.forEach((componentData: any) => {
                const exists = gameObject.components.some((component) => component.constructor.name === componentData.type);
                if (!exists) {
                    total += 1;
                    removedComponents += 1;
                }
            });
        }

        const childDiff = await this.getPrefabChildPathDiff(gameObject, prefabRoot);
        total += childDiff.added.length + childDiff.removed.length;

        return { total, addedComponents, removedComponents };
    }

    public async getPrefabOverrideEntries(gameObject: GameObject): Promise<Array<Record<string, any>>> {
        const prefabRoot = this.getPrefabApplyTargetRoot(gameObject);
        if (!prefabRoot) return [];

        const contextInfo = this.getPrefabContextInfo(gameObject);
        const entries: Array<Record<string, any>> = [];
        ['name', 'tag', 'layer', 'isStatic', 'enabled'].forEach( async(key) => {
            if (await this.isPropertyOverridden(gameObject, key)) {
                entries.push({
                    key: `go:${key}`,
                    label: `GameObject.${key}`,
                    kind: 'gameObject-property',
                    propertyKey: key,
                    targetAssetLabel: contextInfo?.assetLabel ?? null,
                    targetNodeLabel: contextInfo?.nodeLabel ?? gameObject.name
                });
            }
        });

        ['position', 'rotation', 'scale'].forEach( async(key) => {
            if (await this.isPropertyOverridden(gameObject.transform, key)) {
                entries.push({
                    key: `transform:${key}`,
                    label: `Transform.${key}`,
                    kind: 'transform-property',
                    propertyKey: key,
                    targetAssetLabel: contextInfo?.assetLabel ?? null,
                    targetNodeLabel: contextInfo?.nodeLabel ?? gameObject.name
                });
            }
        });

        gameObject.components.forEach( async(component) => {
            if (component === gameObject.transform) return;
            const status = await this.getPrefabComponentStatus(component);
            if (status === 'default') return;

            entries.push({
                key: `component:${component.id}`,
                label: component.constructor.name,
                kind: status === 'added' ? 'component-added' : 'component-overridden',
                component,
                targetAssetLabel: contextInfo?.assetLabel ?? null,
                targetNodeLabel: contextInfo?.nodeLabel ?? gameObject.name
            });
        });

        const prefabData = await this.getPrefabSourceData(gameObject, prefabRoot);
        if (prefabData?.components) {
            prefabData.components.forEach((componentData: any) => {
                const exists = gameObject.components.some((component) => component.constructor.name === componentData.type);
                if (!exists) {
                    entries.push({
                        key: `missing:${componentData.type}`,
                        label: componentData.type,
                        kind: 'component-removed',
                        componentType: componentData.type,
                        targetAssetLabel: contextInfo?.assetLabel ?? null,
                        targetNodeLabel: contextInfo?.nodeLabel ?? gameObject.name
                    });
                }
            });
        }

        const childDiff = await this.getPrefabChildPathDiff(gameObject, prefabRoot);
        childDiff.added.forEach((entry) => {
            entries.push({
                key: `child-added:${entry.path}`,
                label: entry.label,
                kind: 'child-added',
                childGameObject: entry.childGameObject,
                parentPath: entry.parentPath,
                targetAssetLabel: contextInfo?.assetLabel ?? null,
                targetNodeLabel: contextInfo?.nodeLabel ?? gameObject.name
            });
        });
        childDiff.removed.forEach((entry) => {
            entries.push({
                key: `child-removed:${entry.path}`,
                label: entry.label,
                kind: 'child-removed',
                childPath: entry.path,
                targetAssetLabel: contextInfo?.assetLabel ?? null,
                targetNodeLabel: contextInfo?.nodeLabel ?? gameObject.name
            });
        });

        return entries;
    }

    public async getBulkPrefabOverrideEntries(gameObject: GameObject, sourceEntries?: Array<Record<string, any>>): Promise<Array<Record<string, any>>> {
        const entries = sourceEntries ?? await this.getPrefabOverrideEntries(gameObject);
        const childAddedEntries = entries
            .filter((entry) => entry.kind === 'child-added' && typeof entry.childGameObject !== 'undefined')
            .sort((left, right) => this.getPrefabOverridePathDepth(left.childGameObject ? this.getPrefabChildPathForEntry(left) : left.childPath) - this.getPrefabOverridePathDepth(right.childGameObject ? this.getPrefabChildPathForEntry(right) : right.childPath));
        const childRemovedEntries = entries
            .filter((entry) => entry.kind === 'child-removed' && typeof entry.childPath === 'string')
            .sort((left, right) => this.getPrefabOverridePathDepth(left.childPath) - this.getPrefabOverridePathDepth(right.childPath));

        const retainedChildAdded = this.filterPrefabTopLevelChildEntries(childAddedEntries, (entry) => this.getPrefabChildPathForEntry(entry));
        const retainedChildRemoved = this.filterPrefabTopLevelChildEntries(childRemovedEntries, (entry) => entry.childPath);
        const retainedChildKeys = new Set([
            ...retainedChildAdded.map((entry) => entry.key),
            ...retainedChildRemoved.map((entry) => entry.key)
        ]);

        return entries.filter((entry) => {
            if (entry.kind !== 'child-added' && entry.kind !== 'child-removed') return true;
            return retainedChildKeys.has(entry.key);
        });
    }

    public async getPrefabOverrideGroups(gameObject: GameObject): Promise<Array<{ id: string; label: string; entries: Array<Record<string, any>> }>> {
        const entries = await this.getPrefabOverrideEntries(gameObject);
        const groups = [
            {
                id: 'properties',
                label: 'Properties',
                entries: entries.filter((entry) => entry.kind === 'gameObject-property' || entry.kind === 'transform-property')
            },
            {
                id: 'components',
                label: 'Components',
                entries: entries.filter((entry) =>
                    entry.kind === 'component-overridden' ||
                    entry.kind === 'component-added' ||
                    entry.kind === 'component-removed'
                )
            },
            {
                id: 'children',
                label: 'Children',
                entries: entries.filter((entry) => entry.kind === 'child-added' || entry.kind === 'child-removed')
            }
        ];

        groups.forEach((group) => {
            group.entries.sort((left, right) => left.label.localeCompare(right.label));
        });

        return groups.filter((group) => group.entries.length > 0);
    }

    public async applyPrefabOverrideAction(gameObject: GameObject, entry: Record<string, any>, mode: 'revert' | 'apply' = 'revert'): Promise<void> {
        if (mode === 'revert') {
            const label = typeof entry.label === 'string' ? entry.label : entry.kind;
            this.executeSceneMutationCommand(`Revert Prefab Override (${label})`,  async() => {
                const didMutate = await this.executePrefabOverrideAction(gameObject, entry, mode);
                await this.finalizePrefabOverrideMutation(gameObject, mode, didMutate);
                return didMutate;
            });
            return;
        }

        const prefabRoot = this.getPrefabApplyTargetRoot(gameObject);
        if (prefabRoot?.sourceAssetPath) {
            const label = typeof entry.label === 'string' ? entry.label : entry.kind;
            await this.executePrefabBackedSceneMutationCommand(`Apply Prefab Override (${label})`, prefabRoot.sourceAssetPath,  async() => {
                const didMutate = await this.executePrefabOverrideAction(gameObject, entry, mode);
                await this.finalizePrefabOverrideMutation(gameObject, mode, didMutate);
                return didMutate;
            });
            return;
        }

        const didMutate = await this.executePrefabOverrideAction(gameObject, entry, mode);
        await this.finalizePrefabOverrideMutation(gameObject, mode, didMutate);
    }

    public async applyAllPrefabOverrides(
        gameObject: GameObject,
        mode: 'revert' | 'apply' = 'revert',
        sourceEntries?: Array<Record<string, any>>
    ): Promise<void> {
        if (mode === 'revert') {
            this.executeSceneMutationCommand('Revert Prefab Overrides',  async() => {
                const entries = await this.getBulkPrefabOverrideEntries(gameObject, sourceEntries);
                let didMutate = false;

                entries.forEach( async(entry) => {
                    didMutate = await this.executePrefabOverrideAction(gameObject, entry, mode) || didMutate;
                });

                await this.finalizePrefabOverrideMutation(gameObject, mode, didMutate);
                return didMutate;
            });
            return;
        }

        const prefabRoot = this.getPrefabApplyTargetRoot(gameObject);
        if (prefabRoot?.sourceAssetPath) {
            await this.executePrefabBackedSceneMutationCommand('Apply Prefab Overrides', prefabRoot.sourceAssetPath,  async() => {
                const entries = await this.getBulkPrefabOverrideEntries(gameObject, sourceEntries);
                let didMutate = false;

                entries.forEach( async(entry) => {
                    didMutate = await this.executePrefabOverrideAction(gameObject, entry, mode) || didMutate;
                });

                await this.finalizePrefabOverrideMutation(gameObject, mode, didMutate);
                return didMutate;
            });
            return;
        }

        const entries = await this.getBulkPrefabOverrideEntries(gameObject, sourceEntries);
        let didMutate = false;

        entries.forEach( async(entry) => {
            didMutate = await this.executePrefabOverrideAction(gameObject, entry, mode) || didMutate;
        });

        await this.finalizePrefabOverrideMutation(gameObject, mode, didMutate);
    }

    private async executePrefabOverrideAction(gameObject: GameObject, entry: Record<string, any>, mode: 'revert' | 'apply'): Promise<boolean> {
        const prefabRoot = this.getPrefabApplyTargetRoot(gameObject);
        if (!prefabRoot) return false;

        if (mode === 'apply') {
            switch (entry.kind) {
                case 'gameObject-property':
                    await PrefabManager.applyGameObjectPropertyToPrefab(gameObject, entry.propertyKey, prefabRoot);
                    break;
                case 'transform-property':
                    await PrefabManager.applyTransformPropertyToPrefab(gameObject, entry.propertyKey, prefabRoot);
                    break;
                case 'component-overridden':
                    if (entry.component) {
                        await PrefabManager.applyComponentToPrefab(gameObject, entry.component, prefabRoot);
                    }
                    break;
                case 'component-added':
                    if (entry.component) {
                        await PrefabManager.applyComponentToPrefab(gameObject, entry.component, prefabRoot);
                    }
                    break;
                case 'component-removed':
                    if (entry.componentType) {
                        await PrefabManager.removeComponentFromPrefab(gameObject, entry.componentType, prefabRoot);
                    }
                    break;
            case 'child-added':
                if (entry.childGameObject) {
                    await PrefabManager.applyChildToPrefab(gameObject, entry.childGameObject, entry.parentPath ?? null, prefabRoot);
                }
                break;
            case 'child-removed':
                if (entry.childPath) {
                    await PrefabManager.removeChildFromPrefab(gameObject, entry.childPath, prefabRoot);
                }
                break;
                default:
                    return false;
            }
            return true;
        }

        switch (entry.kind) {
            case 'gameObject-property':
                await PrefabManager.revertGameObjectPropertyToPrefab(gameObject, entry.propertyKey, prefabRoot);
                break;
            case 'transform-property':
                await PrefabManager.revertTransformPropertyToPrefab(gameObject, entry.propertyKey, prefabRoot);
                break;
            case 'component-overridden':
                if (entry.component) {
                    await PrefabManager.revertComponentToPrefab(gameObject, entry.component, prefabRoot);
                }
                break;
            case 'component-added':
                if (entry.component) {
                    gameObject.removeComponent(entry.component);
                }
                break;
            case 'component-removed':
                if (entry.componentType) {
                    await PrefabManager.restoreRemovedComponent(gameObject, entry.componentType, prefabRoot);
                }
                break;
            case 'child-added':
                if (entry.childGameObject) {
                    if (entry.childGameObject.scene) {
                        entry.childGameObject.scene.removeGameObject(entry.childGameObject);
                    } else {
                        entry.childGameObject.onDestroy();
                    }
                }
                break;
            case 'child-removed':
                if (entry.childPath) {
                    await PrefabManager.restoreRemovedChild(gameObject, entry.childPath, prefabRoot);
                }
                break;
            default:
                return false;
        }
        return true;
    }

    public async applyPrefabInstanceToSource(gameObject: GameObject): Promise<void> {
        const prefabRoot = this.getPrefabApplyTargetRoot(gameObject);
        if (!prefabRoot) return;

        if (prefabRoot.sourceAssetPath) {
            await this.executePrefabBackedSceneMutationCommand(`Apply Prefab ${prefabRoot.name}`, prefabRoot.sourceAssetPath,  async() => {
                const targetPath = await this.projectWindow.savePrefabInstanceToSource(prefabRoot);
                if (!targetPath) return false;
                this.syncPrefabInstancesFromSource(targetPath);
                await this.projectWindow.refreshAssetRuntime(targetPath);
                this.hierarchyWindow.refresh();
                this.inspectorWindow.refresh();
                return true;
            });
            return;
        }

        const targetPath = await this.projectWindow.savePrefabInstanceToSource(prefabRoot);
        if (!targetPath) return;
        this.syncPrefabInstancesFromSource(targetPath);
        await this.projectWindow.refreshAssetRuntime(targetPath);
        this.hierarchyWindow.refresh();
        this.inspectorWindow.refresh();
    }

    public async applyPrefabSelectionToTarget(gameObject: GameObject): Promise<void> {
        const prefabRoot = this.getPrefabApplyTargetRoot(gameObject);
        if (!prefabRoot) return;

        if (prefabRoot === gameObject) {
            await this.applyPrefabInstanceToSource(gameObject);
            return;
        }

        await this.applyAllPrefabOverrides(gameObject, 'apply');
    }

    public revertPrefabSelectionToTarget(gameObject: GameObject): void {
        const prefabRoot = this.getPrefabApplyTargetRoot(gameObject);
        if (!prefabRoot) return;
        this.executeSceneMutationCommand(`Revert Prefab ${prefabRoot.name}`,  async() => {
            await PrefabManager.revertToPrefab(gameObject, prefabRoot);
            this.hierarchyWindow.refresh();
            this.inspectorWindow.refresh();
            return true;
        });
    }

    public setScene(newScene: Scene) {
        this.scene = newScene;
        this.hierarchyWindow.setScene(newScene);
        this.renderSettingsWindow.setScene(newScene);
        this.selectGameObject(null);
        this.hierarchyWindow.refresh();
        CommandHistory.clear();
        this.dirtyState.reset();
    }

    public async saveActiveScene(): Promise<boolean> {
        const path = SceneManager.getInstance().getActiveScenePath();
        try {
            if (path) {
                await SceneManager.getInstance().saveScene(path);
                this.dirtyState.markPersisted();
                await this.desktopBridge.discardRecovery(this.projectPath);
                return true;
            }
            return await this.showSaveSceneAsDialog();
        } catch (error) {
            console.error('Scene save failed:', error);
            if ((error as { code?: string })?.code === 'REVISION_CONFLICT') {
                const saveCopy = confirm(
                    'This scene changed on disk after you opened it. Your edits were not overwritten. Save your version as a new file?'
                );
                if (saveCopy) return await this.showSaveSceneAsDialog();
            }
            return false;
        }
    }

    private async resolveStartupScenePath(): Promise<string | null> {
        const projectFile = await this.desktopBridge.pathJoin(this.projectPath, 'project.json');
        const projectText = await this.desktopBridge.readTextFile(projectFile);
        if (projectText) {
            try {
                const project = JSON.parse(projectText) as {
                    scenes?: Array<{ path?: unknown }>;
                };
                const configuredPath = project.scenes?.find(
                    (entry) => typeof entry?.path === 'string' && entry.path.length > 0
                )?.path;
                if (typeof configuredPath === 'string') {
                    const normalized = configuredPath.replace(/\\/g, '/');
                    const segments = normalized.split('/');
                    if (
                        !normalized.startsWith('/')
                        && !/^[A-Za-z]:/.test(normalized)
                        && segments.every((segment) => segment !== '..' && segment !== '')
                    ) {
                        const candidate = await this.desktopBridge.pathJoin(this.projectPath, ...segments);
                        if (await this.desktopBridge.fileExists(candidate)) return candidate;
                    }
                }
            } catch (error) {
                console.warn('Project scene configuration could not be read:', error);
            }
        }

        const legacyPath = await this.desktopBridge.pathJoin(
            this.projectPath,
            'Assets',
            'Scenes',
            'SampleScene.json'
        );
        return await this.desktopBridge.fileExists(legacyPath) ? legacyPath : null;
    }

    private async restorePersistedSceneOnStartup(): Promise<void> {
        const defaultPath = await this.resolveStartupScenePath();
        if (!defaultPath) return;
        try {
            const scene = await SceneManager.getInstance().loadScene(defaultPath);
            this.setScene(scene);
        } catch (error) {
            console.error('The last saved scene could not be reopened:', error);
        }
    }

    private async offerRecovery(): Promise<void> {
        const scenePath = SceneManager.getInstance().getActiveScenePath();
        const recovery = await this.desktopBridge.readRecovery(this.projectPath, scenePath);
        if (!recovery) return;
        const harnessConfirm = (window as any).electronAPI?.launchArgs?.confirmResponse;
        const shouldRestore = harnessConfirm === 'true'
            ? true
            : harnessConfirm === 'false'
                ? false
                : confirm('A newer autosave recovery snapshot is available. Restore it?');
        if (shouldRestore) {
            try {
                this.scene.loadFromJSON(JSON.stringify(recovery.scene));
                this.hierarchyWindow.refresh();
                this.inspectorWindow.refresh();
                this.dirtyState.markChanged();
            } catch (error) {
                console.warn('Recovery snapshot could not be restored:', error);
            }
        } else {
            await this.desktopBridge.discardRecovery(this.projectPath);
        }
    }

    public getActiveUIHostElement(): HTMLElement | null {
        if (this.isGameView) {
            return document.getElementById('game-view') as HTMLElement | null;
        }
        return document.getElementById('scene-view') as HTMLElement | null;
    }

    public isRuntimeUIInputEnabled(): boolean {
        return this.isPlaying && this.isGameView;
    }

    public resolveCanvasRenderCamera(preferredGameObject?: GameObject | null): THREE.Camera | null {
        if (preferredGameObject) {
            const preferredCamera = preferredGameObject.getComponent(Camera);
            if (preferredCamera?.camera) {
                return preferredCamera.camera;
            }
        }

        if (!this.isGameView) {
            return this.camera;
        }

        const runtimeCameras = this.scene.gameObjects
            .map((go) => ({ go, component: go.getComponent(Camera) }))
            .filter((entry): entry is { go: GameObject; component: Camera } => Boolean(entry.component?.camera))
            .sort((left, right) => (right.component.depth ?? 0) - (left.component.depth ?? 0));

        return runtimeCameras[0]?.component.camera ?? this.camera;
    }

    private iconSprites: Map<GameObject, THREE.Sprite> = new Map();
    private sceneClickCycleState: {
        x: number;
        y: number;
        time: number;
        candidateIds: string[];
        index: number;
    } | null = null;
    private updateSceneIcons() {
        if (this.isGameView) {
            this.iconSprites.forEach(s => s.visible = false);
            return;
        }

        this.scene.gameObjects.forEach(go => {
            const hasLight = go.getComponent('Light' as any);
            const hasCamera = go.getComponent('Camera' as any);
            const hasAudio = go.getComponent('AudioSource' as any);

            if (hasLight || hasCamera || hasAudio) {
                let sprite = this.iconSprites.get(go);
                if (!sprite) {
                    const canvas = document.createElement('canvas');
                    canvas.width = 128; canvas.height = 128; // Higher res
                    const ctx = canvas.getContext('2d')!;

                    // Shadow circle
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowBlur = 10;
                    ctx.shadowOffsetY = 4;

                    // Background circle
                    let bgColor = '#3a79bb'; // Default blue
                    let icon = 'GO';
                    if (hasLight) { bgColor = '#f2c811'; icon = 'L'; }
                    else if (hasCamera) { bgColor = '#555555'; icon = 'C'; }
                    else if (hasAudio) { bgColor = '#44cc44'; icon = 'A'; }

                    ctx.fillStyle = bgColor;
                    ctx.beginPath(); ctx.arc(64, 64, 55, 0, Math.PI * 2); ctx.fill();

                    // Icon text
                    ctx.shadowBlur = 0; // Disable shadow for text
                    ctx.fillStyle = 'white';
                    ctx.font = 'bold 48px Segoe UI';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(icon, 64, 64);

                    const texture = new THREE.CanvasTexture(canvas);
                    const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, sizeAttenuation: true });
                    sprite = new THREE.Sprite(material);
                    sprite.scale.set(0.6, 0.6, 1);
                    this.scene.threeScene.add(sprite);
                    this.iconSprites.set(go, sprite);
                }

                // Keep sprite at object position, maybe add vertical offset
                sprite.position.copy(go.transform.position);
                sprite.visible = true;

                // Fade out based on distance (pseudo)
                const dist = this.camera.position.distanceTo(go.transform.position);
                const opacity = THREE.MathUtils.clamp(1.0 - (dist / 100), 0.2, 1.0);
                // @ts-ignore
                sprite.material.opacity = opacity;
            }
        });

        // Cleanup stale sprites
        this.iconSprites.forEach((sprite, go) => {
            const hasLight = go.getComponent('Light' as any);
            const hasCamera = go.getComponent('Camera' as any);
            const hasAudio = go.getComponent('AudioSource' as any);

            if (!this.scene.gameObjects.includes(go) || (!hasLight && !hasCamera && !hasAudio)) {
                this.scene.threeScene.remove(sprite);
                this.iconSprites.delete(go);
            }
        });
    }

    public setCameraOrientation(dir: THREE.Vector3) {
        const target = this.selectedGameObject
            ? this.selectedGameObject.object3D.position.clone()
            : new THREE.Vector3(0, 0, 0);

        const distance = Math.max(5, this.camera.position.distanceTo(target));
        this.camera.position.copy(target).add(dir.clone().multiplyScalar(distance));
        this.camera.lookAt(target);

        // Update Controller Orbit Target
        const controller = this.cameraGO.getComponent(EditorCameraController);
        if (controller) {
            controller.orbitTarget.copy(target);
            controller.orbitDistance = distance;

            // Sync yaw/pitch based on current rotation
            const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
            controller.yaw = euler.y;
            controller.pitch = euler.x;
        }
    }

    public focusOnSelection() {
        const targets = this.selectedGameObjects.length > 0 ? this.selectedGameObjects : (this.selectedGameObject ? [this.selectedGameObject] : []);
        if (targets.length === 0) return;

        const box = new THREE.Box3();
        targets.forEach(go => box.expandByObject(go.object3D));
        if (box.isEmpty()) return;

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 2.5;
        if (cameraZ < 2) cameraZ = 5;

        const direction = new THREE.Vector3().subVectors(this.camera.position, center);
        if (direction.lengthSq() < 0.000001) direction.set(0, 0, 1);
        else direction.normalize();
        this.camera.position.copy(center.clone().add(direction.multiplyScalar(cameraZ)));
        this.camera.lookAt(center);

        const controller = this.cameraGO.getComponent(EditorCameraController);
        if (controller) {
            const rot = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
            controller.pitch = rot.x;
            controller.yaw = rot.y;
        }
    }

    private shouldThrottleFrame(nowSeconds: number): boolean {
        const targetFrameRate = Number.isFinite(ProjectSettings.targetFrameRate)
            ? Math.max(0, Math.trunc(ProjectSettings.targetFrameRate))
            : 0;
        if (targetFrameRate <= 0) {
            this.frameGateLastTime = nowSeconds;
            return false;
        }

        if (this.frameGateLastTime <= 0) {
            this.frameGateLastTime = nowSeconds;
            return false;
        }

        const minFrameDuration = 1 / targetFrameRate;
        const elapsed = nowSeconds - this.frameGateLastTime;
        if (elapsed < minFrameDuration) {
            return true;
        }

        this.frameGateLastTime = nowSeconds;
        return false;
    }

    private renderGameView(): void {
        const renderPass = this.composer.passes[0] as RenderPass;
        const originalComposerCamera = renderPass.camera;
        const originalAutoClear = this.renderer.autoClear;
        const originalClearAlpha = this.renderer.getClearAlpha();
        const originalClearColor = this.renderer.getClearColor(new THREE.Color()).clone();
        const previousViewport = this.renderer.getViewport(new THREE.Vector4());
        const previousScissor = this.renderer.getScissor(new THREE.Vector4());
        const previousScissorTest = this.renderer.getScissorTest();

        const runtimeCameras = this.getRuntimeCamerasInStackOrder();
        if (runtimeCameras.length === 0) {
            this.composer.render();
            return;
        }

        this.syncRuntimeLayerAssignments();

        const renderSize = this.renderer.getSize(new THREE.Vector2());
        const singleRuntimeCamera = runtimeCameras.length === 1 ? runtimeCameras[0] : null;
        const canUseComposerSinglePass = singleRuntimeCamera !== null;

        try {
            if (canUseComposerSinglePass) {
                const baseCamera = singleRuntimeCamera!;
                const pixelRect = this.resolveCameraPixelRect(baseCamera, renderSize);
                if (pixelRect.width <= 0 || pixelRect.height <= 0) return;

                const cameraAspect = pixelRect.height > 0 ? pixelRect.width / pixelRect.height : this.camera.aspect;
                this.syncRuntimeCameraProjection(baseCamera, cameraAspect);
                const effectiveClearFlags = this.resolveEffectiveCameraClearFlags(baseCamera, true);
                this.applyCameraClearMode(effectiveClearFlags, baseCamera.clearColor, baseCamera.clearAlpha ?? 1);
                this.applyCameraCullingMask(baseCamera);
                renderPass.camera = baseCamera.camera;

                const cameraCoversFullViewport = this.isFullViewportCamera(baseCamera);
                this.renderer.setScissorTest(!cameraCoversFullViewport);
                this.renderer.setViewport(pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height);
                this.renderer.setScissor(pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height);
                const restoreSceneBackground = this.applyCameraBackgroundMode(effectiveClearFlags);
                if (baseCamera.usePostProcessing ?? true) {
                    this.composer.render();
                } else {
                    this.renderer.render(this.scene.threeScene, baseCamera.camera);
                }
                restoreSceneBackground();
                return;
            }

            this.renderer.setScissorTest(true);
            this.renderer.autoClear = false;
            const postProcessCamera = this.pickPostProcessCameraForMultiStack(runtimeCameras);
            runtimeCameras.forEach((cameraComponent, cameraIndex) => {
                const pixelRect = this.resolveCameraPixelRect(cameraComponent, renderSize);
                if (pixelRect.width <= 0 || pixelRect.height <= 0) return;

                const aspect = pixelRect.height > 0 ? pixelRect.width / pixelRect.height : this.camera.aspect;
                this.syncRuntimeCameraProjection(cameraComponent, aspect);
                this.applyCameraCullingMask(cameraComponent);
                this.renderer.setViewport(pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height);
                this.renderer.setScissor(pixelRect.x, pixelRect.y, pixelRect.width, pixelRect.height);
                const effectiveClearFlags = this.resolveEffectiveCameraClearFlags(cameraComponent, cameraIndex === 0);
                this.applyCameraClearMode(effectiveClearFlags, cameraComponent.clearColor, cameraComponent.clearAlpha ?? 1);
                const restoreSceneBackground = this.applyCameraBackgroundMode(effectiveClearFlags);
                if (postProcessCamera && cameraComponent === postProcessCamera) {
                    renderPass.camera = cameraComponent.camera;
                    this.composer.render();
                } else {
                    this.renderer.render(this.scene.threeScene, cameraComponent.camera);
                }
                restoreSceneBackground();
            });
        } finally {
            renderPass.camera = originalComposerCamera;
            this.renderer.autoClear = originalAutoClear;
            this.renderer.setClearColor(originalClearColor, originalClearAlpha);
            this.renderer.setScissorTest(previousScissorTest);
            this.renderer.setViewport(previousViewport);
            this.renderer.setScissor(previousScissor);
        }
    }

    private pickPostProcessCameraForMultiStack(cameras: Camera[]): Camera | null {
        if (cameras.length === 0) return null;
        // Prefer the final full-viewport camera so scene/game stacks keep expected composition.
        const eligible = cameras.filter((camera) => camera.usePostProcessing ?? true);
        if (eligible.length === 0) return null;

        for (let i = eligible.length - 1; i >= 0; i--) {
            if (this.isFullViewportCamera(eligible[i])) return eligible[i];
        }
        // Fallback to top-most camera in depth order.
        return eligible[eligible.length - 1] ?? null;
    }

    private getRuntimeCamerasInStackOrder(): Camera[] {
        const depthOrdered = this.getRuntimeCamerasInDepthOrder();
        const sortedEntries = depthOrdered
            .map((camera) => {
                const go = camera.gameObject;
                return {
                    go,
                    index: this.scene.gameObjects.indexOf(go),
                    camera
                };
            })
            .filter((entry) => entry.index >= 0);

        const baseEntries = sortedEntries.filter((entry) =>
            entry.camera.renderType !== 'Overlay'
            || !entry.camera.stackBaseCamera
            || !sortedEntries.some((candidate) => candidate.go === entry.camera.stackBaseCamera)
        );

        const overlaysByBaseId = new Map<string, Array<{ go: GameObject; index: number; camera: Camera }>>();
        sortedEntries.forEach((entry) => {
            if (entry.camera.renderType !== 'Overlay' || !entry.camera.stackBaseCamera) return;
            const baseId = entry.camera.stackBaseCamera.id;
            if (!overlaysByBaseId.has(baseId)) {
                overlaysByBaseId.set(baseId, []);
            }
            overlaysByBaseId.get(baseId)!.push(entry);
        });

        const ordered: Camera[] = [];
        baseEntries.forEach((baseEntry) => {
            ordered.push(baseEntry.camera);
            const overlays = overlaysByBaseId.get(baseEntry.go.id) ?? [];
            overlays
                .sort((left, right) => {
                    const depthDelta = (left.camera.depth ?? 0) - (right.camera.depth ?? 0);
                    if (depthDelta !== 0) return depthDelta;
                    return left.index - right.index;
                })
                .forEach((overlayEntry) => {
                    ordered.push(overlayEntry.camera);
                });
        });

        return ordered;
    }

    private getRuntimeCamerasInDepthOrder(): Camera[] {
        const runtimeEntries: Array<{ go: GameObject; index: number; camera: Camera }> = [];
        this.scene.gameObjects.forEach((go, index) => {
            const camera = go.getComponent(Camera);
            if (!camera || !camera.camera || !go.enabled || !camera.enabled) return;
            runtimeEntries.push({ go, index, camera });
        });

        return runtimeEntries
            .sort((left, right) => {
                const depthDelta = (left.camera.depth ?? 0) - (right.camera.depth ?? 0);
                if (depthDelta !== 0) return depthDelta;
                return left.index - right.index;
            })
            .map((entry) => entry.camera);
    }

    private syncRuntimeLayerAssignments(): void {
        this.scene.gameObjects.forEach((go) => {
            const normalizedLayer = Math.max(0, Math.min(31, go.layer | 0));
            go.object3D.traverse((object3D) => {
                const owner = object3D.userData?.gameObject as GameObject | undefined;
                const ownerLayer = owner ? Math.max(0, Math.min(31, owner.layer | 0)) : normalizedLayer;
                object3D.layers.set(ownerLayer);
            });
        });
    }

    private syncRuntimeCameraProjection(cameraComponent: Camera, aspect: number): void {
        const runtimeCamera = cameraComponent.camera;
        if (runtimeCamera instanceof THREE.PerspectiveCamera) {
            runtimeCamera.aspect = Math.max(0.0001, aspect);
            runtimeCamera.updateProjectionMatrix();
            return;
        }

        if (runtimeCamera instanceof THREE.OrthographicCamera) {
            const size = Math.max(0.0001, cameraComponent.orthographicSize || 5);
            runtimeCamera.left = -size * aspect;
            runtimeCamera.right = size * aspect;
            runtimeCamera.top = size;
            runtimeCamera.bottom = -size;
            runtimeCamera.updateProjectionMatrix();
        }
    }

    private isFullViewportCamera(cameraComponent: Camera): boolean {
        const rect = cameraComponent.viewportRect ?? { x: 0, y: 0, width: 1, height: 1 };
        return Math.abs(rect.x) <= 0.0001
            && Math.abs(rect.y) <= 0.0001
            && Math.abs(rect.width - 1) <= 0.0001
            && Math.abs(rect.height - 1) <= 0.0001;
    }

    private resolveCameraPixelRect(cameraComponent: Camera, size: THREE.Vector2): { x: number; y: number; width: number; height: number } {
        const rect = cameraComponent.viewportRect ?? { x: 0, y: 0, width: 1, height: 1 };
        const width = Math.max(0, Math.round(size.x * rect.width));
        const height = Math.max(0, Math.round(size.y * rect.height));
        const x = Math.round(size.x * rect.x);
        const y = Math.round(size.y * rect.y);
        return { x, y, width, height };
    }

    private applyCameraClearMode(clearFlags: CameraClearFlags, clearColor: THREE.Color, clearAlpha: number): void {
        const alpha = Number.isFinite(clearAlpha) ? Math.max(0, Math.min(1, clearAlpha)) : 1;
        switch (clearFlags) {
            case 'Skybox':
                this.renderer.autoClear = false;
                this.renderer.setClearColor(0x000000, alpha);
                this.renderer.clear(true, true, true);
                break;
            case 'Solid Color':
                this.renderer.autoClear = false;
                this.renderer.setClearColor(clearColor, alpha);
                this.renderer.clear(true, true, true);
                break;
            case 'Depth Only':
                this.renderer.autoClear = false;
                this.renderer.clearDepth();
                break;
            case "Don't Clear":
                this.renderer.autoClear = false;
                break;
        }
    }

    private applyCameraBackgroundMode(clearFlags: CameraClearFlags): () => void {
        const sceneRef = this.scene.threeScene;
        const previousBackground = sceneRef.background;

        // Solid/Depth/Don'tClear should not redraw scene background for camera parity.
        if (clearFlags === 'Solid Color' || clearFlags === 'Depth Only' || clearFlags === "Don't Clear") {
            sceneRef.background = null;
        }

        return () => {
            sceneRef.background = previousBackground;
        };
    }

    private resolveEffectiveCameraClearFlags(cameraComponent: Camera, isFirstCameraInPass: boolean): CameraClearFlags {
        if (cameraComponent.renderType !== 'Overlay') {
            return cameraComponent.clearFlags;
        }

        const hasBaseCamera = Boolean(cameraComponent.stackBaseCamera);
        if (!hasBaseCamera && isFirstCameraInPass) {
            return cameraComponent.clearFlags;
        }

        if (cameraComponent.clearFlags === 'Depth Only' || cameraComponent.clearFlags === "Don't Clear") {
            return cameraComponent.clearFlags;
        }

        // Overlay cameras should preserve the color buffer from the base camera unless
        // they explicitly opt into a depth-only/no-clear style behavior.
        return 'Depth Only';
    }

    private applyCameraCullingMask(cameraComponent: Camera): void {
        const mask = cameraComponent.cullingMask === -1
            ? 0xFFFFFFFF
            : (cameraComponent.cullingMask >>> 0);
        cameraComponent.camera.layers.mask = mask;
    }

    private focusOnSelectionOrScene() {
        const targets = this.selectedGameObjects.length > 0
            ? this.selectedGameObjects
            : (this.selectedGameObject ? [this.selectedGameObject] : []);
        if (targets.length > 0) {
            this.focusOnSelection();
            return;
        }
        this.focusOnSceneContents();
    }

    private focusOnSceneContents() {
        const sceneTargets = this.scene.gameObjects.filter((go) => go !== this.cameraGO);
        if (sceneTargets.length === 0) return;

        const box = new THREE.Box3();
        sceneTargets.forEach((go) => box.expandByObject(go.object3D));
        if (box.isEmpty()) return;

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        let cameraDistance = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 2.6;
        if (cameraDistance < 8) cameraDistance = 8;

        const direction = new THREE.Vector3().subVectors(this.camera.position, center);
        if (direction.lengthSq() < 0.000001) direction.set(0, 0, 1);
        else direction.normalize();
        this.camera.position.copy(center.clone().add(direction.multiplyScalar(cameraDistance)));
        this.camera.lookAt(center);

        const controller = this.cameraGO.getComponent(EditorCameraController);
        if (controller) {
            const rot = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
            controller.pitch = rot.x;
            controller.yaw = rot.y;
            controller.orbitTarget.copy(center);
            controller.orbitDistance = cameraDistance;
        }
    }

    private async getPrefabSourceData(gameObject: GameObject, prefabRootOverride: GameObject | null = null): Promise<any | null> {
        return await PrefabManager.getPrefabNodeDataForGameObject(gameObject, prefabRootOverride);
    }

    private async getPrefabComponentData(gameObject: GameObject, componentType: string, prefabRootOverride: GameObject | null = null): Promise<any | null> {
        const prefabData = await this.getPrefabSourceData(gameObject, prefabRootOverride);
        if (!prefabData?.components) return null;
        return prefabData.components.find((component: any) => component.type === componentType) ?? null;
    }

    private areOverrideValuesDifferent(a: any, b: any): boolean {
        return JSON.stringify(this.normalizeOverrideValue(a)) !== JSON.stringify(this.normalizeOverrideValue(b));
    }

    private normalizeOverrideValue(value: any): any {
        if (value === undefined || value === null) return null;
        if (Array.isArray(value)) return value.map((entry) => this.normalizeOverrideValue(entry));
        if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(6)) : value;
        if (typeof value !== 'object') return value;

        const normalizedEntries = Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entryValue]) => [key, this.normalizeOverrideValue(entryValue)]);

        return Object.fromEntries(normalizedEntries);
    }

    private async getPrefabChildPathDiff(gameObject: GameObject, prefabRootOverride: GameObject | null = null): Promise<{
        added: Array<{ path: string; label: string; parentPath: string | null; childGameObject: GameObject }>;
        removed: Array<{ path: string; label: string }>;
    }> {
        const prefabData = await this.getPrefabSourceData(gameObject, prefabRootOverride);
        if (!prefabData) {
            return { added: [], removed: [] };
        }

        const prefabRoot = prefabRootOverride ?? this.getPrefabApplyTargetRoot(gameObject);
        const contextSourcePath = prefabRoot?.sourceAssetPath ?? null;

        const currentEntries = this.collectCurrentChildEntries(gameObject, prefabRoot);
        const prefabEntries = this.collectPrefabChildEntries(prefabData, contextSourcePath);
        const currentPaths = new Set(currentEntries.map((entry) => entry.path));
        const prefabPaths = new Set(prefabEntries.map((entry) => entry.path));

        return {
            added: currentEntries.filter((entry) => !prefabPaths.has(entry.path)),
            removed: prefabEntries.filter((entry) => !currentPaths.has(entry.path))
        };
    }

    private collectCurrentChildEntries(
        root: GameObject,
        contextRoot: GameObject | null
    ): Array<{ path: string; label: string; parentPath: string | null; childGameObject: GameObject }> {
        const entries: Array<{ path: string; label: string; parentPath: string | null; childGameObject: GameObject }> = [];

        const visit = (parent: GameObject, parentPath: string | null) => {
            const siblingCounts = new Map<string, number>();
            parent.transform.children.forEach((childTransform) => {
                const child = childTransform.gameObject;
                const siblingIndex = siblingCounts.get(child.name) ?? 0;
                siblingCounts.set(child.name, siblingIndex + 1);
                const segment = `${child.name}#${siblingIndex}`;
                const path = parentPath ? `${parentPath}/${segment}` : segment;
                const label = path.replace(/#\d+/g, '');
                entries.push({ path, label, parentPath, childGameObject: child });
                const childContextRoot = PrefabManager.getPrefabOwningRoot(child);
                const isNestedPrefabBoundary =
                    !!contextRoot &&
                    !!childContextRoot &&
                    child !== root &&
                    childContextRoot === child &&
                    childContextRoot !== contextRoot;
                if (!isNestedPrefabBoundary) {
                    visit(child, path);
                }
            });
        };

        visit(root, null);
        return entries;
    }

    private async finalizePrefabOverrideMutation(gameObject: GameObject, mode: 'revert' | 'apply', didMutate: boolean): Promise<void> {
        if (!didMutate) return;

        if (mode === 'apply') {
            const prefabRoot = this.getPrefabApplyTargetRoot(gameObject);
            if (prefabRoot?.sourceAssetPath) {
                this.syncPrefabInstancesFromSource(prefabRoot.sourceAssetPath);
                await this.projectWindow.refreshAssetRuntime(prefabRoot.sourceAssetPath);
            }
        }

        this.hierarchyWindow.refresh();
        this.inspectorWindow.refresh();
    }

    private filterPrefabTopLevelChildEntries(
        entries: Array<Record<string, any>>,
        getPath: (entry: Record<string, any>) => string | null
    ): Array<Record<string, any>> {
        const retained: Array<Record<string, any>> = [];

        entries.forEach((entry) => {
            const entryPath = getPath(entry);
            if (!entryPath) return;
            const hasAncestor = retained.some((retainedEntry) => {
                const retainedPath = getPath(retainedEntry);
                return retainedPath ? this.isPrefabChildPathAncestor(retainedPath, entryPath) : false;
            });
            if (!hasAncestor) {
                retained.push(entry);
            }
        });

        return retained;
    }

    private getPrefabChildPathForEntry(entry: Record<string, any>): string | null {
        if (typeof entry.childPath === 'string') return entry.childPath;
        if (!entry.childGameObject) return null;

        const contextRoot = entry.childGameObject.transform.parent?.gameObject;
        if (!contextRoot) return null;

        const segment = `${entry.childGameObject.name}#${contextRoot.transform.children
            .map((child: any) => child.gameObject as GameObject)
            .filter((sibling: GameObject) => sibling.name === entry.childGameObject.name)
            .indexOf(entry.childGameObject)}`;
        return entry.parentPath ? `${entry.parentPath}/${segment}` : segment;
    }

    private getPrefabOverridePathDepth(path: string | null | undefined): number {
        if (!path) return Number.MAX_SAFE_INTEGER;
        return path.split('/').filter(Boolean).length;
    }

    private isPrefabChildPathAncestor(ancestorPath: string, childPath: string): boolean {
        return childPath.length > ancestorPath.length && childPath.startsWith(`${ancestorPath}/`);
    }

    private collectPrefabChildEntries(prefabData: any, contextSourcePath: string | null): Array<{ path: string; label: string }> {
        const entries: Array<{ path: string; label: string }> = [];

        const visit = (children: any[], parentPath: string | null) => {
            const siblingCounts = new Map<string, number>();
            children.forEach((childData: any) => {
                const childName = String(childData.name);
                const siblingIndex = siblingCounts.get(childName) ?? 0;
                siblingCounts.set(childName, siblingIndex + 1);
                const segment = `${childName}#${siblingIndex}`;
                const path = parentPath ? `${parentPath}/${segment}` : segment;
                const label = path.replace(/#\d+/g, '');
                entries.push({ path, label });
                const isNestedPrefabBoundary =
                    !!childData.sourceAssetPath &&
                    childData.sourceAssetType === 'prefab' &&
                    contextSourcePath !== null &&
                    childData.sourceAssetPath !== contextSourcePath;
                if (!isNestedPrefabBoundary) {
                    visit(childData.children ?? [], path);
                }
            });
        };

        visit(prefabData.children ?? [], null);
        return entries;
    }

    private syncPrefabInstancesFromSource(sourcePath: string) {
        this.scene.gameObjects.forEach( async(candidate) => {
            if (candidate.sourceAssetType !== 'prefab') return;
            if (!candidate.sourceAssetPath) return;
            if (candidate.sourceAssetPath !== sourcePath) return;
            await PrefabManager.revertToPrefab(candidate);
        });
    }

    private initializeThemeMenu() {
        const themeList = document.getElementById('theme-menu-list');
        if (!themeList) return;

        themeList.innerHTML = ''; // Clear
        const themes = ThemeManager.getThemes();
        const currentTheme = ThemeManager.getCurrentTheme();

        themes.forEach(themeName => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';

            const nameSpan = document.createElement('span');
            nameSpan.innerText = themeName;
            item.appendChild(nameSpan);

            if (themeName === currentTheme) {
                const check = document.createElement('span');
                check.innerText = '✓';
                check.style.color = 'var(--unity-accent)';
                check.style.fontSize = '12px';
                item.appendChild(check);
            }

            item.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                ThemeManager.applyTheme(themeName);
                this.initializeThemeMenu(); // Refresh checkmarks
            };

            themeList.appendChild(item);
        });
    }
}

