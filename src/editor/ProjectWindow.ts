import { AssetIcons } from './AssetIcons';
import { Prefab, PrefabManager } from '../engine/Prefab';
import { Material, MaterialManager } from '../engine/Material';
import { Scene } from '../engine/Scene';
import { ScriptableObjectRegistry } from '../engine/ScriptableObject';
import { GameObject } from '../engine/GameObject';
import { ScriptRegistry } from '../engine/ScriptRegistry';
import { AssetDatabase, type AssetEntry, type AssetMeta, type AssetRefreshMove, type AssetRefreshResult } from '../engine/AssetDatabase';
import { AssetImporter } from '../engine/AssetImporter';
import { AudioSource } from '../engine/components/AudioSource';
import { DesktopFileSystem } from '../platform/DesktopFileSystem';
import { PathUtils } from '../platform/PathUtils';
import { escapeHtml } from './Security';
import { CommandHistory } from './Command';
import { ProjectAssetCommand } from './ProjectAssetCommand';
import type { ProjectAssetReferencePatch } from '../platform/DesktopBridge';

export interface ProjectAssetSelection {
    kind: 'asset';
    name: string;
    path: string;
    extension: string;
    meta: AssetMeta;
    payload: any | null;
}

export interface AssetReferenceAuditIssue {
    assetPath: string;
    jsonPath: string;
    pathKey: string;
    guidKey: string;
    pathValue: string | null;
    guidValue: string | null;
    suggestedPath: string | null;
    suggestedGuid: string | null;
    reason: string;
    fixable: boolean;
}

export interface AssetReferenceAuditResult {
    scannedAssets: number;
    scannedPairs: number;
    issues: number;
    fixable: number;
    fixed: number;
    unresolved: number;
    filesChanged: number;
    issuesByAsset: Record<string, number>;
    fixedByAsset: Record<string, number>;
    issuesByReason: Record<string, number>;
    changedAssetPaths: string[];
    sampleIssues: AssetReferenceAuditIssue[];
}

export interface AssetDeleteImpactSummary {
    targetPath: string;
    targetIsDirectory: boolean;
    targetAssetCount: number;
    externalReferencerCount: number;
    externalReferencerPaths: string[];
    externalReferencerTypeCounts: Record<string, number>;
    autoPatchableReferencerCount: number;
    manualReviewReferencerCount: number;
}

interface AssetRepairHistoryEntry {
    timestamp: string;
    scopePath: string;
    scopeLabel: string;
    issues: number;
    fixable: number;
    fixed: number;
    unresolved: number;
    filesChanged: number;
    topReasons: Array<{ reason: string; count: number }>;
    changedAssetPaths: string[];
}

const RECENT_REPAIR_HISTORY_STORAGE_KEY = 'engine-project.recentAssetRepairHistory';

interface Phase3ReadinessReport {
    scopePath: string;
    scopeAssetCount: number;
    runtimeCandidateCount: number;
    dependencyEdgeCount: number;
    reimportDiagnostics: {
        directRuntimeReimportCount: number;
        dependentGraphExpandableCount: number;
        totalDependentRuntimeReloads: number;
        maxDependentRuntimeReloads: number;
    };
    healthDiagnostics: {
        unusedAssetCount: number;
        circularDependencyCount: number;
        missingTargetIssueCount: number;
        orphanGuidIssueCount: number;
        ambiguousReferenceCount: number;
    };
    scriptCount: number;
    scriptsWithCustomExecutionOrder: number;
    scriptsAutoReferencedDisabled: number;
    referenceAudit: AssetReferenceAuditResult;
    refreshSummary: {
        scannedCount: number;
        added: number;
        removed: number;
        changed: number;
        metaChanged: number;
        metaRepaired: number;
        duplicateGuidRepaired: number;
        orphanMetaFiles: number;
        moved: number;
    };
    assetTypeCounts: Record<string, number>;
    ready: boolean;
    blockers: string[];
}

interface PrefabOverrideComponentSnapshot {
    type: string;
    overrideKeys: string[];
    data: Record<string, unknown>;
}

interface PrefabOverrideNodeSnapshot {
    path: string | null;
    gameObjectOverrideKeys: string[];
    gameObjectValues: Partial<Pick<GameObject, 'name' | 'tag' | 'layer' | 'enabled'>>;
    transformOverrideKeys: string[];
    transformValues: {
        position: [number, number, number];
        rotation: [number, number, number];
        scale: [number, number, number];
    };
    componentSnapshots: PrefabOverrideComponentSnapshot[];
}

interface PrefabStructuralOverrideSnapshot {
    kind: 'component-added' | 'component-removed' | 'child-added' | 'child-removed';
    targetPath?: string | null;
    componentType?: string;
    componentData?: Record<string, unknown>;
    childPath?: string | null;
    parentPath?: string | null;
    childData?: any;
}

export class ProjectWindow {
    private fs: DesktopFileSystem;
    private rootPath: string = "";
    private currentPath: string = "";
    private editor: any; // Keeping generic to avoid circular dependency for now
    private expandedPaths: Set<string> = new Set();
    private searchQuery: string = "";
    private activeFilter: string = "All";
    private selectedAssetPath: string | null = null;
    private focusedAssetPath: string | null = null;
    private focusedFolderPath: string | null = null;
    private recentRepairHistory: AssetRepairHistoryEntry[] = [];
    private assetMutationBusy = false;

    constructor(editor: any) {
        this.editor = editor;
        this.fs = new DesktopFileSystem();
        this.loadRecentRepairHistory();
    }

    public async initialize() {
        if (!this.fs) return;

        this.rootPath = this.editor.rootPath;

        if (!await this.fs.exists(this.rootPath)) {
            await this.fs.mkdir(this.rootPath, { recursive: true });
        }

        this.currentPath = this.rootPath;
        this.expandedPaths.add(this.rootPath); // Always expand root
        await this.refreshAssetDatabaseAndView();
    }

    public async refresh() {
        if (!this.rootPath) {
            await this.initialize();
            return;
        }

        const content = document.getElementById('assets-content');
        if (!content) return;
        const restoreSearchFocus = (document.activeElement as HTMLElement | null)?.dataset.projectSearch === 'true';
        const searchSelectionStart = restoreSearchFocus && document.activeElement instanceof HTMLInputElement
            ? document.activeElement.selectionStart
            : null;
        const searchSelectionEnd = restoreSearchFocus && document.activeElement instanceof HTMLInputElement
            ? document.activeElement.selectionEnd
            : null;
        content.innerHTML = '';

        const splitContainer = document.createElement('div');
        splitContainer.style.display = 'flex';
        splitContainer.style.height = '100%';
        splitContainer.style.width = '100%';

        // Left Pane (Folder Tree)
        const leftPane = document.createElement('div');
        leftPane.className = 'project-folder-tree';
        leftPane.setAttribute('role', 'tree');
        leftPane.setAttribute('aria-label', 'Project folders');
        leftPane.style.width = '200px';
        leftPane.style.minWidth = '150px';
        leftPane.style.borderRight = '1px solid var(--unity-border)';
        leftPane.style.background = 'var(--unity-bg-panel)';
        leftPane.style.display = 'flex';
        leftPane.style.flexDirection = 'column';
        leftPane.style.overflowY = 'auto';

        // Tree Content
        await this.drawFolderTree(leftPane, this.rootPath, 0);

        // Right Pane (Grid)
        const rightPane = document.createElement('div');
        rightPane.style.flex = '1';
        rightPane.style.position = 'relative';
        rightPane.style.display = 'flex';
        rightPane.style.flexDirection = 'column';
        rightPane.style.background = 'var(--unity-bg-dark)'; // Darker background for assets

        splitContainer.appendChild(leftPane);
        splitContainer.appendChild(rightPane);
        content.appendChild(splitContainer);

        const toolbar = document.createElement('div');
        toolbar.style.width = '100%';
        toolbar.style.display = 'flex';
        toolbar.style.gap = '8px';
        toolbar.style.padding = '4px 8px';
        toolbar.style.background = 'var(--unity-bg-header)';
        toolbar.style.borderBottom = '1px solid var(--unity-border)';
        toolbar.style.alignItems = 'center';
        toolbar.style.minHeight = '28px';

        const upBtn = document.createElement('button');
        upBtn.innerText = 'Up';
        upBtn.title = "Go Up";
        upBtn.style.padding = '2px 4px';
        upBtn.style.background = 'transparent';
        upBtn.style.border = '1px solid transparent';
        upBtn.style.color = 'var(--unity-text)';
        upBtn.style.cursor = 'pointer';
        upBtn.onmouseenter = () => upBtn.style.background = 'var(--unity-bg-hover)';
        upBtn.onmouseleave = () => upBtn.style.background = 'transparent';
        upBtn.onclick =  async() => {
            if (this.currentPath !== this.rootPath) {
                this.currentPath = PathUtils.dirname(this.currentPath);
                await this.refresh();
            }
        };
        upBtn.disabled = this.currentPath === this.rootPath;
        if (upBtn.disabled) upBtn.style.opacity = '0.3';
        toolbar.appendChild(upBtn);

        // Filter Dropdown
        const filterSelect = document.createElement('select');
        filterSelect.style.background = 'var(--unity-bg-input)';
        filterSelect.style.color = 'var(--unity-text)';
        filterSelect.style.border = '1px solid var(--unity-border-light)';
        filterSelect.style.fontSize = '11px';
        filterSelect.style.padding = '0 4px';
        filterSelect.style.height = '18px';
        filterSelect.style.borderRadius = '2px';

        const filterOptions = ["All", "Prefab", "Material", "Texture", "Script", "Scene"];
        filterOptions.forEach(opt => {
            const o = document.createElement('option');
            o.value = opt;
            o.innerText = opt;
            if (opt === this.activeFilter) o.selected = true;
            filterSelect.appendChild(o);
        });
        filterSelect.onchange =  async() => {
            this.activeFilter = filterSelect.value;
            await this.refresh();
        };
        toolbar.appendChild(filterSelect);

        // Search Input
        const searchContainer = document.createElement('div');
        searchContainer.style.flex = '1';
        searchContainer.style.position = 'relative';
        searchContainer.style.display = 'flex';
        searchContainer.style.alignItems = 'center';

        const searchInput = document.createElement('input');
        searchInput.dataset.projectSearch = 'true';
        searchInput.setAttribute('aria-label', 'Search project assets');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search Assets...';
        searchInput.value = this.searchQuery;
        searchInput.style.width = '100%';
        searchInput.style.height = '18px';
        searchInput.style.background = 'var(--unity-bg-input)';
        searchInput.style.color = 'var(--unity-text)';
        searchInput.style.border = '1px solid var(--unity-border-light)';
        searchInput.style.padding = '0 20px 0 6px';
        searchInput.style.fontSize = '11px';
        searchInput.style.borderRadius = '10px'; // Rounded like Unity search

        searchInput.oninput =  async() => {
            this.searchQuery = searchInput.value.toLowerCase();
            await this.refresh();
        };
        searchContainer.appendChild(searchInput);

        const searchIcon = document.createElement('div');
        searchIcon.innerText = 'S';
        searchIcon.style.position = 'absolute';
        searchIcon.style.left = '6px';
        searchIcon.style.fontSize = '10px';
        searchIcon.style.pointerEvents = 'none';
        searchIcon.style.opacity = '0.5';
        searchContainer.appendChild(searchIcon);

        if (this.searchQuery) {
            const clearBtn = document.createElement('div');
            clearBtn.innerText = 'x';
            clearBtn.style.position = 'absolute';
            clearBtn.style.right = '8px';
            clearBtn.style.fontSize = '10px';
            clearBtn.style.cursor = 'pointer';
            clearBtn.style.color = 'var(--unity-text-dim)';
            clearBtn.onclick =  async() => {
                this.searchQuery = "";
                await this.refresh();
            };
            searchContainer.appendChild(clearBtn);
            searchInput.style.paddingRight = '20px';
        }
        searchInput.style.paddingLeft = '20px';

        toolbar.appendChild(searchContainer);
        if (restoreSearchFocus) {
            requestAnimationFrame(() => {
                searchInput.focus();
                if (searchSelectionStart !== null && searchSelectionEnd !== null) {
                    searchInput.setSelectionRange(searchSelectionStart, searchSelectionEnd);
                }
            });
        }

        rightPane.appendChild(toolbar);

        // Grid Container
        const grid = document.createElement('div');
        grid.className = 'project-asset-grid';
        grid.setAttribute('role', 'grid');
        grid.setAttribute('aria-label', 'Project assets');
        grid.tabIndex = -1;
        grid.style.display = 'flex';
        grid.style.flexWrap = 'wrap';
        grid.style.gap = '2px'; // Unity grid is tight
        grid.style.padding = '10px';
        grid.style.width = '100%';
        grid.style.flex = '1';
        grid.style.alignContent = 'flex-start'; // Align items to top
        grid.style.overflowY = 'auto'; // Scrollable

        grid.oncontextmenu = (e) => {
            if (e.target === grid) {
                e.preventDefault();
                this.showContextMenu(e.clientX, e.clientY);
            }
        };

        rightPane.appendChild(grid);

        // Drop Logic (Hierarchy -> Project for Prefab Creation)
        grid.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer!.dropEffect = 'copy';
        };

        grid.ondrop =  async(e) => {
            e.preventDefault();
            try {
                const data = e.dataTransfer!.getData('text/plain');
                if (!data) return;
                const payload = JSON.parse(data);

                if (payload.type === 'gameobject') {
                    const goId = payload.id;
                    const go = this.editor.scene.gameObjects.find((g: any) => g.id === goId);
                    if (go) {
                        // Create Prefab
                        console.log(`Creating prefab from ${go.name}...`);
                        await PrefabManager.savePrefab(go.name, go);

                        // Notify user and refresh
                        console.log(`Prefab ${go.name} created successfully.`);
                        await this.refresh();
                    }
                }
            } catch (err) {
                console.error("Drop to Project failed:", err);
            }
        };

        // Footer (Path Display)
        const footer = document.createElement('div');
        footer.style.width = '100%';
        footer.style.padding = '2px 8px';
        footer.style.background = 'var(--unity-bg-panel)';
        footer.style.borderTop = '1px solid var(--unity-border)';
        footer.style.color = 'var(--unity-text-dim)';
        footer.style.fontSize = '10px';
        footer.style.height = '18px';
        footer.style.display = 'flex';
        footer.style.alignItems = 'center';
        footer.innerText = PathUtils.relative(PathUtils.dirname(this.rootPath), this.currentPath).replace(/\\/g, '/');
        rightPane.appendChild(footer);

        // Read Directory
        try {
            let files: any[] = [];
            if (this.searchQuery) {
                // Recursive search from root
                files = await this.getAllFilesRecursive(this.rootPath);
            } else {
                // Standard view of current folder
                files = (await this.fs.readdir(this.currentPath, { withFileTypes: true })).map((f: any) => ({
                    name: f.name,
                    isDirectory: () => f.isDirectory(),
                    fullPath: PathUtils.join(this.currentPath, f.name)
                }));
            }

            const createItem = (name: string, icon: string, isFolder: boolean, onDblClick: () => void, fullPath: string) => {
                const item = document.createElement('div');
                item.className = 'asset-item';
                item.dataset.assetPath = fullPath;
                item.setAttribute('role', 'gridcell');
                item.setAttribute('aria-label', `${isFolder ? 'Folder' : 'Asset'} ${name}`);
                item.setAttribute('aria-selected', 'false');
                item.tabIndex = -1;
                item.style.width = '70px'; // Slightly wider
                item.style.height = '80px';
                item.style.textAlign = 'center';
                item.style.cursor = 'pointer';
                item.style.margin = '4px';
                item.title = name;
                item.style.display = 'flex';
                item.style.flexDirection = 'column';
                item.style.alignItems = 'center';

                const iconDiv = document.createElement('div');
                iconDiv.style.fontSize = '32px'; // Big icon
                iconDiv.style.marginBottom = '4px';
                iconDiv.innerHTML = icon;

                // SVG handling if needed
                if (icon.indexOf('<svg') > -1) {
                    const svg = iconDiv.querySelector('svg');
                    if (svg) {
                        svg.setAttribute('width', '32');
                        svg.setAttribute('height', '32');
                    }
                } else {
                    // Text icon logic
                    iconDiv.innerText = icon;
                }

                const label = document.createElement('div');
                label.innerText = name;
                label.style.fontSize = '11px';
                label.style.overflow = 'hidden';
                label.style.textOverflow = 'ellipsis';
                label.style.whiteSpace = 'nowrap'; // Should verify if Unity wraps text. Usually it wraps 2 lines.
                label.style.width = '100%'; // Full width of item reference
                label.style.color = 'var(--unity-text)';

                item.appendChild(iconDiv);
                item.appendChild(label);

                if (this.selectedAssetPath && this.pathsEqual(this.selectedAssetPath, fullPath)) {
                    item.style.background = 'var(--unity-bg-selected)';
                    label.style.color = 'white';
                    item.setAttribute('aria-selected', 'true');
                }

                item.ondblclick = onDblClick;

                // Selection logic
                const selectItem = async (focusItem: boolean) => {
                    // Deselect others
                    grid.querySelectorAll<HTMLElement>('.asset-item').forEach((el) => {
                        el.style.background = 'transparent';
                        el.setAttribute('aria-selected', 'false');
                        el.tabIndex = -1;
                    });
                    item.style.background = 'var(--unity-bg-selected)';
                    label.style.color = 'white';
                    item.setAttribute('aria-selected', 'true');
                    item.tabIndex = 0;
                    footer.innerText = PathUtils.relative(PathUtils.dirname(this.rootPath), fullPath).replace(/\\/g, '/');
                    this.selectedAssetPath = fullPath;
                    this.focusedAssetPath = fullPath;
                    this.editor.inspectorWindow.selectAsset(await this.buildAssetSelection(fullPath, name, isFolder));
                    if (focusItem) item.focus();
                };

                item.onclick = async (e) => {
                    e.stopPropagation();
                    await selectItem(true);
                };

                item.oncontextmenu =  async(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await selectItem(true);
                    await this.showItemContextMenu(e.clientX, e.clientY, name, fullPath, label);
                };

                item.onfocus = () => {
                    this.focusedAssetPath = fullPath;
                };

                item.onkeydown = async (e) => {
                    const items = Array.from(grid.querySelectorAll<HTMLElement>('.asset-item'));
                    const currentIndex = items.indexOf(item);
                    const columnCount = this.getGridColumnCount(items);
                    let nextIndex = currentIndex;
                    if (e.key === 'ArrowLeft') nextIndex = Math.max(0, currentIndex - 1);
                    else if (e.key === 'ArrowRight') nextIndex = Math.min(items.length - 1, currentIndex + 1);
                    else if (e.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - columnCount);
                    else if (e.key === 'ArrowDown') nextIndex = Math.min(items.length - 1, currentIndex + columnCount);
                    else if (e.key === 'Home') nextIndex = 0;
                    else if (e.key === 'End') nextIndex = items.length - 1;
                    else if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        onDblClick();
                        return;
                    } else if (e.key === 'F2') {
                        e.preventDefault();
                        e.stopPropagation();
                        this.startInlineRename(label, fullPath);
                        return;
                    } else if (e.key === 'Delete') {
                        e.preventDefault();
                        e.stopPropagation();
                        await this.deleteAssetFromKeyboard(name, fullPath, isFolder);
                        return;
                    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                        e.preventDefault();
                        e.stopPropagation();
                        const rect = item.getBoundingClientRect();
                        await this.showItemContextMenu(rect.left + 12, rect.top + 12, name, fullPath, label);
                        return;
                    } else {
                        return;
                    }

                    e.preventDefault();
                    e.stopPropagation();
                    if (nextIndex !== currentIndex) items[nextIndex].click();
                };

                // Drag Logic
                item.draggable = true;
                item.ondragstart = (e) => {
                    let type = 'file';
                    const ext = name.split('.').pop()?.toLowerCase();
                    if (ext === 'prefab') type = 'prefab';
                    else if (['png', 'jpg', 'jpeg', 'tga'].includes(ext || '')) type = 'texture';
                    else if (ext === 'mat') type = 'material';
                    else if (['mp3', 'wav', 'ogg'].includes(ext || '')) type = 'audio';
                    else if (ext === 'asset') type = 'scriptableobject';

                    e.dataTransfer!.setData("text/plain", JSON.stringify({
                        type: type,
                        source: 'project',
                        name: name.split('.')[0],
                        filename: name,
                        fullPath: fullPath
                    }));
                    e.dataTransfer!.effectAllowed = 'copyMove';
                };

                if (isFolder) {
                    item.ondragover = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer!.dropEffect = 'move';
                    };
                    item.ondrop = async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                            const payload = JSON.parse(e.dataTransfer!.getData('text/plain'));
                            if (payload?.source !== 'project' || typeof payload.fullPath !== 'string' || typeof payload.filename !== 'string') return;
                            const sourcePath = payload.fullPath;
                            const targetPath = PathUtils.join(fullPath, payload.filename);
                            if (this.pathsEqual(sourcePath, targetPath) || this.pathsEqual(sourcePath, fullPath)
                                || this.isPathInsideScope(fullPath, sourcePath)) {
                                this.announceAssetMutation('Asset cannot be moved to that folder');
                                return;
                            }
                            const stat = await this.fs.stat(sourcePath);
                            await this.executeAssetMutation('Move Asset', {
                                operation: 'move', sourcePath, targetPath,
                                assetKind: stat.isDirectory() ? 'directory' : 'file',
                                contentBase64: null, metadataBase64: null,
                                referencePatches: await this.buildMoveReferencePatches(sourcePath, targetPath)
                            });
                        } catch (error) {
                            this.announceAssetMutation(`Move Asset failed: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    };
                }

                return item;
            };

            // 1. Folders (Only show if no search/filter is active)
            files.filter((f: any) => f.isDirectory()).forEach((f: any) => {
                if (this.searchQuery) return; // Hide folders during global search
                if (this.activeFilter !== "All") return;

                const item = createItem(f.name, AssetIcons.Folder, true,  async() => {
                    this.currentPath = f.fullPath;
                    this.selectedAssetPath = f.fullPath;
                    this.editor.inspectorWindow.selectAsset(await this.buildAssetSelection(f.fullPath, f.name, true));
                    await this.refresh();
                }, f.fullPath);
                grid.appendChild(item);
            });

            const renderedItems = Array.from(grid.querySelectorAll<HTMLElement>('.asset-item'));
            if (renderedItems.length > 0) {
                const focusCandidate = renderedItems.find((item) =>
                    !!item.dataset.assetPath
                    && !!this.focusedAssetPath
                    && this.pathsEqual(item.dataset.assetPath, this.focusedAssetPath)
                ) ?? renderedItems.find((item) => item.getAttribute('aria-selected') === 'true')
                    ?? renderedItems[0];
                focusCandidate.tabIndex = 0;
            }

            // 2. Files
            files.filter((f: any) => !f.isDirectory()).forEach((f: any) => {
                const ext = PathUtils.extname(f.name).toLowerCase();
                if (ext === '.meta') return; // Hide meta files

                // Search Filter (Redundant if recursively gathered but good for consistency)
                if (this.searchQuery && !f.name.toLowerCase().includes(this.searchQuery)) return;

                // Type Filter
                if (this.activeFilter !== "All") {
                    const filter = this.activeFilter.toLowerCase();
                    if (filter === "prefab" && ext !== ".prefab") return;
                    if (filter === "material" && ext !== ".mat") return;
                    if (filter === "texture" && !['.png', '.jpg', '.jpeg', '.tga'].includes(ext)) return;
                    if (filter === "script" && !['.cs', '.ts'].includes(ext)) return;
                    if (filter === "scene" && ext !== ".scene") return;
                }

                let icon = AssetIcons.File || '📄';
                if (ext === '.cs') icon = AssetIcons.Script;
                if (ext === '.ts') icon = AssetIcons.Script;
                if (ext === '.prefab') icon = AssetIcons.Prefab;
                if (['.png', '.jpg', '.jpeg'].includes(ext)) icon = AssetIcons.Image;

                const fullPath = f.fullPath;

                const item = createItem(f.name, icon, false,  async() => {
                    if (ext === '.cs' || ext === '.ts') {
                        // Open in VSCode or script editor
                        console.log("Opening script:", fullPath);
                    } else if (ext === '.json' || ext === '.scene') {
                        await this.editor.openScene(fullPath);
                    } else if (ext === '.prefab') {
                        const prefab = await PrefabManager.loadPrefabFromPath(fullPath);
                        if (prefab) {
                            const go = prefab.instantiate();
                            if (this.editor.scene) {
                                this.editor.scene.addGameObject(go);
                                this.editor.hierarchyWindow.refresh();
                            }
                        }
                    } else if (ext === '.mat') {
                        const mat = await this.loadMaterialAsset(fullPath);
                        if (mat) {
                            this.editor.inspectorWindow.selectAsset(mat);
                        }
                    } else if (ext === '.asset') {
                        const asset = await this.loadScriptableObjectAsset(fullPath);
                        if (asset) {
                            this.editor.inspectorWindow.selectAsset(asset);
                        }
                    }
                }, fullPath);

                // Thumbnail for images
                if (['.png', '.jpg'].includes(ext)) {
                    const imgIcon = item.querySelector('div') as HTMLElement;
                    imgIcon.innerText = ''; // Clear icon
                    imgIcon.innerHTML = '';
                    imgIcon.style.backgroundImage = `url('file://${fullPath.replace(/\\/g, '/')}')`;
                    imgIcon.style.backgroundSize = 'contain';
                    imgIcon.style.backgroundRepeat = 'no-repeat';
                    imgIcon.style.backgroundPosition = 'center';
                }

                grid.appendChild(item);
            });

            if (!grid.querySelector('.asset-item')) {
                const empty = document.createElement('div');
                empty.className = 'editor-empty-state';
                empty.style.width = '100%';
                empty.innerHTML = this.searchQuery
                    ? `
                        <div class="editor-empty-state-title">No assets matched "${escapeHtml(this.searchQuery)}"</div>
                        <div class="editor-empty-state-hint">Try a shorter search term or switch the asset filter back to All.</div>
                    `
                    : this.activeFilter !== 'All'
                        ? `
                            <div class="editor-empty-state-title">No ${this.activeFilter.toLowerCase()} assets in this folder</div>
                            <div class="editor-empty-state-hint">Change the filter or create/import assets into the current folder.</div>
                        `
                        : `
                            <div class="editor-empty-state-title">This folder is empty</div>
                            <div class="editor-empty-state-hint">Create assets, import files or drag GameObjects here to save them as prefabs.</div>
                        `;
                grid.appendChild(empty);
            }

        } catch (e) {
            console.error("Failed to read directory", e);
            rightPane.innerText = "Error reading assets: " + e;
        }

        content.oncontextmenu = (e) => {
            if (e.target !== content && e.target !== grid && e.target !== rightPane) return;
            e.preventDefault();
            this.showContextMenu(e.clientX, e.clientY);
        };

        // Drop GameObject to create Prefab
        content.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer!.dropEffect = 'copy';
            content.style.background = 'rgba(50, 103, 171, 0.1)';
        };

        content.ondragleave = () => {
            content.style.background = 'transparent';
        };

        content.ondrop =  async(e) => {
            e.preventDefault();
            content.style.background = 'transparent';
            try {
                const data = JSON.parse(e.dataTransfer!.getData('text/plain'));
                if (data.type === 'gameobject') {
                    // @ts-ignore
                    const editor = window.Editor?.instance;
                    const go = editor?.scene?.gameObjects.find((g: any) => g.id === data.id);
                    if (go) {
                        const name = prompt("Prefab Name", go.name);
                        if (name) {
                            await this.savePrefabToFile(name, go);
                        }
                    }
                }
            } catch (err) { }
        };
    }

    public async savePrefabToFile(name: string, go: GameObject) {
        await PrefabManager.savePrefab(name, go);
        const prefab = await PrefabManager.loadPrefab(name);
        if (prefab) {
            // Find if file already exists in Assets to overwrite same path
            let targetPath = await this.findFileRecursive(this.rootPath, `${name}.prefab`);
            if (!targetPath) {
                targetPath = PathUtils.join(this.currentPath, `${name}.prefab`);
            }
            await this.fs.writeFile(targetPath, prefab.toJSON(), 'utf8');
            await this.refreshAssetDatabaseAndView({ focusAssetPath: targetPath });
            console.log(`Saved prefab to file: ${targetPath}`);
        }
    }

    public async savePrefabInstanceToSource(go: GameObject): Promise<string | null> {
        const targetPath = await PrefabManager.savePrefabInstance(go);
        if (!targetPath) return null;
        await this.refreshAssetDatabaseAndView({ focusAssetPath: targetPath });
        return targetPath;
    }

    public async saveMaterialToFile(mat: Material) {
        if (!mat.assetPath) return;
        try {
            const data = JSON.stringify(mat.serialize(), null, 4);
            await this.fs.writeFile(mat.assetPath, data, 'utf8');
            await this.refreshAssetDatabaseAndView({ focusAssetPath: mat.assetPath });
        } catch (e) {
            console.error("Failed to save material to file:", e);
        }
    }

    public async saveScriptableObject(so: any) {
        const targetPath = await this.findFileRecursive(this.rootPath, `${so.assetName}.asset`);
        if (!targetPath) return;

        try {
            await this.fs.writeFile(targetPath, so.toAssetJSON(), 'utf8');
            await this.refreshAssetDatabaseAndView({ focusAssetPath: targetPath });
        } catch (e) {
            console.error('Failed to save ScriptableObject to file:', e);
        }
    }

    public async updateAssetMeta(assetPath: string, updater: (meta: AssetMeta) => void): Promise<AssetMeta | null> {
        const meta = await AssetDatabase.getInstance().updateMeta(assetPath, (draft) => {
            updater(draft);
        });
        if (meta) {
            const runtimeAssetPaths = await this.getRuntimeReimportPathsForAsset(assetPath, true);
            await this.refreshAssetDatabaseAndView({ focusAssetPath: assetPath, runtimeAssetPaths });
        }
        return meta;
    }

    public async reimportAsset(assetPath: string): Promise<ProjectAssetSelection | null> {
        if ((await this.fs.exists(assetPath) && await this.fs.stat(assetPath)).isDirectory()) {
            return await this.reimportAssetScope(assetPath, false);
        }
        const runtimeAssetPaths = await this.getRuntimeReimportPathsForAsset(assetPath, false);
        await this.refreshAssetDatabaseAndView({ focusAssetPath: assetPath, runtimeAssetPaths });
        const selection = await this.buildAssetSelection(assetPath, PathUtils.basename(assetPath), (await this.fs.stat(assetPath)).isDirectory());
        this.editor.inspectorWindow.selectAsset(selection);
        return selection;
    }

    public async reimportAssetWithDependents(assetPath: string): Promise<ProjectAssetSelection | null> {
        if ((await this.fs.exists(assetPath) && await this.fs.stat(assetPath)).isDirectory()) {
            return await this.reimportAssetScope(assetPath, true);
        }
        const runtimeAssetPaths = await this.getRuntimeReimportPathsForAsset(assetPath, true);
        await this.refreshAssetDatabaseAndView({ focusAssetPath: assetPath, runtimeAssetPaths });
        if (!await this.fs.exists(assetPath)) return null;

        const selection = await this.buildAssetSelection(assetPath, PathUtils.basename(assetPath), (await this.fs.stat(assetPath)).isDirectory());
        this.editor.inspectorWindow.selectAsset(selection);
        return selection;
    }

    public async reimportAssetScope(scopePath: string, includeDependents: boolean): Promise<ProjectAssetSelection | null> {
        if (!scopePath || !await this.fs.exists(scopePath)) return null;

        const scopeAssets = (await this.collectAssetPathsWithinScope(scopePath))
            .filter((assetPath) => this.isFileAssetPath(assetPath));
        const runtimePaths = new Set<string>();

        for (const assetPath of scopeAssets) {
            (await this.getRuntimeReimportPathsForAsset(assetPath, includeDependents))
                .forEach((pathValue) => runtimePaths.add(pathValue));
        }

        await this.refreshAssetDatabaseAndView({
            focusAssetPath: scopePath,
            runtimeAssetPaths: Array.from(runtimePaths)
        });

        if (!await this.fs.exists(scopePath)) return null;
        const isDirectory = (await this.fs.stat(scopePath)).isDirectory();
        const selection = await this.buildAssetSelection(scopePath, PathUtils.basename(scopePath), isDirectory);
        this.editor.inspectorWindow.selectAsset(selection);
        return selection;
    }

    private async getRuntimeReimportPathsForAsset(assetPath: string, includeDependents: boolean): Promise<string[]> {
        if (!assetPath || !await this.fs.exists(assetPath) || (await this.fs.stat(assetPath)).isDirectory()) return [];

        const runtimePaths = new Set<string>();
        if (await this.isRuntimeRefreshCandidate(assetPath)) {
            runtimePaths.add(assetPath);
        }

        if (includeDependents) {
            AssetDatabase.getInstance().getReferencerClosurePaths(assetPath, false)
                .filter( async(pathValue) => await this.isRuntimeRefreshCandidate(pathValue))
                .forEach((pathValue) => runtimePaths.add(pathValue));
        }

        return Array.from(runtimePaths);
    }

    public async refreshAssetRuntime(assetPath: string) {
        await this.refreshAssetDatabaseAndView({ preserveSelection: true, runtimeAssetPaths: [assetPath] });
    }

    public async auditAssetReferences(assetPath: string): Promise<AssetReferenceAuditResult | null> {
        const candidates = await this.getReferenceAuditCandidatePaths(assetPath);
        if (candidates.length === 0) return null;
        return this.auditAndRepairReferenceFiles(candidates, false);
    }

    public async repairAssetReferences(assetPath: string): Promise<AssetReferenceAuditResult | null> {
        const candidates = await this.getReferenceAuditCandidatePaths(assetPath);
        if (candidates.length === 0) return null;

        const result = this.auditAndRepairReferenceFiles(candidates, true);
        this.recordRepairHistory(assetPath, result);
        if (result.filesChanged > 0) {
            await this.refreshAssetDatabaseAndView({
                focusAssetPath: await this.fs.exists(assetPath) ? assetPath : null,
                preserveSelection: true
            });
        }
        return result;
    }

    public async auditAllAssetReferences(): Promise<AssetReferenceAuditResult> {
        return this.auditAndRepairReferenceFiles(await this.getReferenceAuditCandidatePaths(), false);
    }

    public async repairAllAssetReferences(): Promise<AssetReferenceAuditResult> {
        const result = this.auditAndRepairReferenceFiles(await this.getReferenceAuditCandidatePaths(), true);
        this.recordRepairHistory(this.rootPath, result);
        if (result.filesChanged > 0) {
            await this.refreshAssetDatabaseAndView({ preserveSelection: true });
        }
        return result;
    }

    public async runPhase3ReadinessCheck(scopePath?: string): Promise<Phase3ReadinessReport> {
        const effectiveScopePath = scopePath && scopePath.length > 0 && await this.fs.exists(scopePath)
            ? scopePath
            : this.rootPath;
        const refreshResult = await this.refreshAssetDatabaseAndView({ preserveSelection: true });
        const scopeEntries = AssetDatabase.getInstance()
            .getAllEntries()
            .filter( async(entry) => this.isPathInsideScope(entry.path, effectiveScopePath) && await this.isFileAssetPath(entry.path));
        const scopeAssetPaths = scopeEntries.map((entry) => entry.path);
        const referenceAudit = this.auditAndRepairReferenceFiles(await this.getReferenceAuditCandidatePaths(effectiveScopePath), false);

        const scriptEntries = scopeEntries.filter((entry) => entry.meta.assetType === 'script');
        const scriptsWithCustomExecutionOrder = scriptEntries.filter((entry) => {
            const value = entry.meta.importer.settings.executionOrder;
            return typeof value === 'number' && Number.isFinite(value) && value !== 0;
        }).length;
        const scriptsAutoReferencedDisabled = scriptEntries.filter((entry) => entry.meta.importer.settings.autoReferenced === false).length;

        const runtimeCandidateCount = scopeAssetPaths.filter( async(assetPath) => await this.isRuntimeRefreshCandidate(assetPath)).length;
        const dependencyEdgeCount = scopeAssetPaths.reduce((sum, assetPath) => sum + AssetDatabase.getInstance().getDependencyPaths(assetPath).length, 0);
        const reimportDiagnostics = this.collectReimportDiagnostics(scopeAssetPaths);
        const healthDiagnostics = this.collectHealthDiagnostics(scopeEntries, referenceAudit, effectiveScopePath);
        const assetTypeCounts = this.collectAssetTypeCounts(scopeEntries);

        const blockers: string[] = [];
        if (scopeAssetPaths.length === 0) {
            blockers.push('No file assets found in scope');
        }
        if (referenceAudit.unresolved > 0) {
            blockers.push(`Unresolved reference issues: ${referenceAudit.unresolved}`);
        }
        if (refreshResult.orphanMetaFiles.length > 0) {
            blockers.push(`Orphan meta files detected: ${refreshResult.orphanMetaFiles.length}`);
        }
        if (healthDiagnostics.circularDependencyCount > 0) {
            blockers.push(`Circular dependency chains detected: ${healthDiagnostics.circularDependencyCount}`);
        }
        if (healthDiagnostics.missingTargetIssueCount > 0) {
            blockers.push(`Missing target issues detected: ${healthDiagnostics.missingTargetIssueCount}`);
        }
        if (healthDiagnostics.orphanGuidIssueCount > 0) {
            blockers.push(`Orphan GUID issues detected: ${healthDiagnostics.orphanGuidIssueCount}`);
        }
        if (healthDiagnostics.ambiguousReferenceCount > 0) {
            blockers.push(`Ambiguous name-based references detected: ${healthDiagnostics.ambiguousReferenceCount}`);
        }

        return {
            scopePath: effectiveScopePath,
            scopeAssetCount: scopeAssetPaths.length,
            runtimeCandidateCount,
            dependencyEdgeCount,
            reimportDiagnostics,
            healthDiagnostics,
            scriptCount: scriptEntries.length,
            scriptsWithCustomExecutionOrder,
            scriptsAutoReferencedDisabled,
            referenceAudit,
            refreshSummary: {
                scannedCount: refreshResult.scannedCount,
                added: refreshResult.added.length,
                removed: refreshResult.removed.length,
                changed: refreshResult.changed.length,
                metaChanged: refreshResult.metaChanged.length,
                metaRepaired: refreshResult.metaRepaired.length,
                duplicateGuidRepaired: refreshResult.duplicateGuidRepaired.length,
                orphanMetaFiles: refreshResult.orphanMetaFiles.length,
                moved: refreshResult.moved.length
            },
            assetTypeCounts,
            ready: blockers.length === 0,
            blockers
        };
    }

    public async getDeleteImpactSummary(assetPath: string): Promise<AssetDeleteImpactSummary | null> {
        if (!assetPath || !await this.fs.exists(assetPath)) return null;

        const targetIsDirectory = (await this.fs.stat(assetPath)).isDirectory();
        const targetPaths = await this.collectAssetPathsWithinScope(assetPath);
        if (targetPaths.length === 0) {
            return {
                targetPath: assetPath,
                targetIsDirectory,
                targetAssetCount: 0,
                externalReferencerCount: 0,
                externalReferencerPaths: [],
                externalReferencerTypeCounts: {},
                autoPatchableReferencerCount: 0,
                manualReviewReferencerCount: 0
            };
        }

        const referencerSet = new Set<string>();
        targetPaths.forEach((targetPath) => {
            AssetDatabase.getInstance().getReferencerPaths(targetPath).forEach((referencerPath) => {
                if (!this.isPathInsideScope(referencerPath, assetPath)) {
                    referencerSet.add(referencerPath);
                }
            });
        });

        const externalReferencerPaths = Array.from(referencerSet).sort((left, right) => left.localeCompare(right));
        const externalReferencerEntries = externalReferencerPaths
            .map((referencerPath) => AssetDatabase.getInstance().getEntry(referencerPath))
            .filter((entry): entry is AssetEntry => !!entry);
        const externalReferencerTypeCounts = this.collectAssetTypeCounts(externalReferencerEntries);
        const autoPatchableReferencerCount = externalReferencerEntries
            .filter((entry) => this.isMovedReferenceAutoPatchableAssetType(entry.meta.assetType))
            .length;
        const manualReviewReferencerCount = externalReferencerPaths.length - autoPatchableReferencerCount;
        return {
            targetPath: assetPath,
            targetIsDirectory,
            targetAssetCount: targetPaths.length,
            externalReferencerCount: externalReferencerPaths.length,
            externalReferencerPaths,
            externalReferencerTypeCounts,
            autoPatchableReferencerCount,
            manualReviewReferencerCount
        };
    }

    public getAssetDependencyPaths(assetPath: string): string[] {
        return AssetDatabase.getInstance().getDependencyPaths(assetPath);
    }

    public getAssetReferencerPaths(assetPath: string): string[] {
        return AssetDatabase.getInstance().getReferencerPaths(assetPath);
    }

    public async focusAssetByPath(assetPath: string): Promise<ProjectAssetSelection | null> {
        if (!assetPath || !await this.fs.exists(assetPath)) return null;

        const isDirectory = (await this.fs.stat(assetPath)).isDirectory();
        await this.refreshAssetDatabaseAndView({ focusAssetPath: assetPath });
        const selection = await this.buildAssetSelection(assetPath, PathUtils.basename(assetPath), isDirectory);
        this.editor.inspectorWindow.selectAsset(selection);
        return selection;
    }

    public async highlightAsset(filename: string) {
        // 1. Find the file recursively
        const foundPath = await this.findFileRecursive(this.rootPath, filename);

        if (foundPath) {
            // 2. Navigate to folder
            this.currentPath = PathUtils.dirname(foundPath);
            this.selectedAssetPath = foundPath;
            await this.refresh();

            // 3. Highlight item
            setTimeout(() => {
                const items = document.querySelectorAll('.asset-item');
                items.forEach((item: any) => {
                    const label = item.querySelector('div:last-child');
                    if (label && label.innerText === filename) {
                        item.click();
                        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        // Add a temporary flash effect
                        item.style.transition = 'background 0.2s';
                        item.style.background = 'var(--unity-accent)';
                        setTimeout(() => {
                            if (item.style.background === 'var(--unity-accent)') {
                                item.style.background = 'var(--unity-bg-selected)';
                            }
                        }, 500);
                    }
                });
            }, 50); // Small delay to allow DOM update
        } else {
            console.warn(`Asset not found: ${filename}`);
        }
    }

    private async findFileRecursive(dir: string, filename: string): Promise<string | null> {
        try {
            const files = await this.fs.readdir(dir, { withFileTypes: true });
            for (const file of files) {
                const fullPath = PathUtils.join(dir, file.name);
                if (file.isDirectory()) {
                    const found = await this.findFileRecursive(fullPath, filename);
                    if (found) return found;
                } else if (file.name === filename) {
                    return fullPath;
                }
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    public async selectAssetByName(name: string) {
        await this.highlightAsset(name);
    }

    private async refreshAssetDatabaseAndView(options?: {
        focusAssetPath?: string | null;
        preserveSelection?: boolean;
        runtimeAssetPaths?: string[];
    }): Promise<AssetRefreshResult> {
        const refreshResult = await AssetDatabase.getInstance().refresh(this.rootPath);
        ScriptRegistry.refreshScriptExecutionOrderFromAssetDatabase();
        if (refreshResult.moved.length > 0) {
            this.applyMovedAssetReferenceEffects(refreshResult.moved);
        }
        const nextSelectionPath = await this.resolveSelectionPathAfterRefresh(refreshResult, options?.focusAssetPath, options?.preserveSelection);

        if (nextSelectionPath && await this.fs.exists(nextSelectionPath)) {
            this.selectedAssetPath = nextSelectionPath;
            const isDirectory = (await this.fs.stat(nextSelectionPath)).isDirectory();
            this.currentPath = isDirectory ? nextSelectionPath : PathUtils.dirname(nextSelectionPath);
        } else if (options?.focusAssetPath === null || (this.selectedAssetPath && !await this.fs.exists(this.selectedAssetPath))) {
            this.selectedAssetPath = null;
        }

        await this.refresh();
        if (options?.runtimeAssetPaths?.length) {
            Array.from(new Set(options.runtimeAssetPaths))
                .filter((assetPath) => typeof assetPath === 'string' && assetPath.length > 0)
                .forEach( async(assetPath) => await this.applyRuntimeReimportEffects(assetPath));
        }

        if (this.selectedAssetPath && await this.fs.exists(this.selectedAssetPath)) {
            const assetName = PathUtils.basename(this.selectedAssetPath);
            const isFolder = (await this.fs.stat(this.selectedAssetPath)).isDirectory();
            this.editor.inspectorWindow.selectAsset(await this.buildAssetSelection(this.selectedAssetPath, assetName, isFolder));
        }

        return refreshResult;
    }

    private async resolveSelectionPathAfterRefresh(
        refreshResult: AssetRefreshResult,
        focusAssetPath?: string | null,
        preserveSelection: boolean = true
    ): Promise<string | null> {
        if (typeof focusAssetPath === 'string' && focusAssetPath.length > 0) {
            return focusAssetPath;
        }
        if (!preserveSelection || !this.selectedAssetPath) {
            return null;
        }

        const movedSelection = refreshResult.moved.find((entry) => this.pathsEqual(entry.from, this.selectedAssetPath!));
        if (movedSelection) {
            return movedSelection.to;
        }

        const entry = AssetDatabase.getInstance().getEntry(this.selectedAssetPath);
        if (entry || await this.fs.exists(this.selectedAssetPath)) {
            return this.selectedAssetPath;
        }

        return null;
    }

    private getAssetEntry(assetPath: string): AssetEntry | null {
        return AssetDatabase.getInstance().getEntry(assetPath) ?? null;
    }

    private async buildAssetSelection(assetPath: string, assetName: string, isFolder: boolean): Promise<ProjectAssetSelection> {
        const entry = this.getAssetEntry(assetPath);
        const extension = isFolder ? '' : PathUtils.extname(assetPath).toLowerCase();

        return {
            kind: 'asset',
            name: assetName,
            path: assetPath,
            extension,
            meta: entry?.meta ?? AssetDatabase.getInstance().getMeta(assetPath)!,
            payload: isFolder ? null : await this.loadAssetPayload(assetPath, extension)
        };
    }

    private async loadAssetPayload(fullPath: string, extension: string): Promise<any | null> {
        if (extension === '.mat') {
            return await this.loadMaterialAsset(fullPath);
        }

        if (extension === '.asset') {
            return await this.loadScriptableObjectAsset(fullPath);
        }

        return null;
    }

    private async loadMaterialAsset(fullPath: string): Promise<Material | null> {
        const cached = MaterialManager.getMaterial(fullPath);

        try {
            const data = JSON.parse(await this.fs.readFile(fullPath, 'utf8'));
            const material = cached ?? Material.deserialize(data);
            await this.applyMaterialAssetData(material, data, fullPath);
            if (!cached) {
                MaterialManager.registerMaterial(material);
            }
            return material;
        } catch (e) {
            console.warn('Failed to load material asset:', e);
            return null;
        }
    }

    private async loadScriptableObjectAsset(fullPath: string): Promise<any | null> {
        try {
            const json = await this.fs.readFile(fullPath, 'utf8');
            const data = JSON.parse(json);
            const ScriptableCtor = ScriptableObjectRegistry.get(data.type);
            if (!ScriptableCtor) return null;
            const instance = new ScriptableCtor();
            instance.deserialize(data);
            return instance;
        } catch (e) {
            console.warn('Failed to load ScriptableObject asset:', e);
            return null;
        }
    }

    private getImporterSettings(assetPath: string, expectedType: AssetMeta['assetType']): Record<string, string | number | boolean> {
        const meta = AssetDatabase.getInstance().getMeta(assetPath);
        if (!meta || meta.assetType !== expectedType) return {};
        return meta.importer.settings ?? {};
    }

    private normalizeMaterialShader(value: string | number | boolean | undefined): 'Standard' | 'Unlit' | 'Transparent' | null {
        if (typeof value !== 'string') return null;
        const normalized = value.trim().toLowerCase();
        if (normalized === 'standard') return 'Standard';
        if (normalized === 'unlit') return 'Unlit';
        if (normalized === 'transparent') return 'Transparent';
        return null;
    }

    private async applyRuntimeReimportEffects(assetPath: string) {
        const meta = AssetDatabase.getInstance().getMeta(assetPath);
        if (!meta) return;

        if (meta.assetType === 'texture') {
            AssetImporter.invalidateTextureCache(assetPath);
            this.reloadMaterialTextureReferences(assetPath);
        } else if (meta.assetType === 'material') {
            await this.loadMaterialAsset(assetPath);
        } else if (meta.assetType === 'audio') {
            AssetImporter.invalidateAudioCache(assetPath);
            this.reloadAudioSourcesForAsset(assetPath);
        } else if (meta.assetType === 'prefab') {
            await this.reloadPrefabInstancesForAsset(assetPath);
        } else if (meta.assetType === 'model') {
            AssetImporter.invalidateModelCache(assetPath);
            this.reloadModelInstancesForAsset(assetPath);
            this.reloadAnimatorClipsForAsset(assetPath);
        }

        this.editor.hierarchyWindow.refresh();
        this.editor.inspectorWindow.refresh();
    }

    private async applyMaterialAssetData(material: Material, data: any, fullPath: string) {
        const importerSettings = this.getImporterSettings(fullPath, 'material');
        const shaderOverride = this.normalizeMaterialShader(importerSettings.shader);
        const mergedData = {
            ...data,
            shader: shaderOverride ?? data.shader,
            doubleSidedGI: typeof importerSettings.doubleSidedGI === 'boolean'
                ? importerSettings.doubleSidedGI
                : data.doubleSidedGI
        };
        material.applyAssetData(mergedData);

        material.assetPath = fullPath;

        await this.loadTextureReference(data.mainTexturePath, data.mainTextureGuid, (texture) => material.setTextureSilently('mainTexture', texture));
        await this.loadTextureReference(data.normalMapPath, data.normalMapGuid, (texture) => material.setTextureSilently('normalMap', texture));
        await this.loadTextureReference(data.metallicMapPath, data.metallicMapGuid, (texture) => material.setTextureSilently('metallicMap', texture));
        await this.loadTextureReference(data.roughnessMapPath, data.roughnessMapGuid, (texture) => material.setTextureSilently('roughnessMap', texture));
    }

    private async loadTextureReference(
        reference: string | null | undefined,
        guid: string | null | undefined,
        assign: (texture: any | null) => void
    ) {
        const resolvedPath = await this.resolveTextureReference(reference, guid);
        if (!resolvedPath) {
            assign(null);
            return;
        }

        await AssetImporter.importTexture(resolvedPath, (texture) => {
            assign(texture);
        });
    }

    private async resolveTextureReference(reference: string | null | undefined, guid?: string | null): Promise<string | null> {
        if (guid) {
            const guidPath = AssetDatabase.getInstance().getPath(guid);
            if (guidPath) return guidPath;
        }
        if (!reference || typeof reference !== 'string') return null;
        if (await this.fs.exists(reference)) return reference;

        const directMatch = await this.findFileRecursive(this.rootPath, PathUtils.basename(reference));
        if (directMatch) return directMatch;

        const ext = PathUtils.extname(reference);
        const baseName = PathUtils.basename(reference, ext || undefined).toLowerCase();
        if (!baseName) return null;

        const match = AssetDatabase.getInstance().getAllEntries().find((entry) => {
            if (entry.meta.assetType !== 'texture') return false;
            const entryBaseName = PathUtils.basename(entry.path, PathUtils.extname(entry.path)).toLowerCase();
            return entryBaseName === baseName;
        });
        return match?.path ?? null;
    }

    private reloadMaterialTextureReferences(assetPath: string) {
        MaterialManager.getAllMaterials().forEach( async(material) => {
            await this.reloadMaterialTextureSlot(material, 'mainTexture', assetPath, (texture) => material.setMainTexture(texture));
            await this.reloadMaterialTextureSlot(material, 'normalMap', assetPath, (texture) => material.setNormalMap(texture));
            await this.reloadMaterialTextureSlot(material, 'metallicMap', assetPath, (texture) => material.setMetallicMap(texture));
            await this.reloadMaterialTextureSlot(material, 'roughnessMap', assetPath, (texture) => material.setRoughnessMap(texture));
        });
    }

    private async reloadMaterialTextureSlot(
        material: Material,
        key: 'mainTexture' | 'normalMap' | 'metallicMap' | 'roughnessMap',
        assetPath: string,
        assign: (texture: any) => void
    ) {
        const texture = material[key];
        const currentAssetPath = texture?.userData?.assetPath;
        const currentAssetGuid = texture?.userData?.assetGuid as string | undefined;
        const assetGuid = AssetDatabase.getInstance().getGuid(assetPath);
        const matchesByGuid = !!currentAssetGuid && !!assetGuid && currentAssetGuid === assetGuid;
        if ((!currentAssetPath || !this.pathsEqual(currentAssetPath, assetPath)) && !matchesByGuid) return;

        await AssetImporter.importTexture(assetPath, (reimportedTexture) => {
            assign(reimportedTexture);
        });
    }

    private reloadAudioSourcesForAsset(assetPath: string) {
        const normalizedAssetPath = this.normalizeAssetPath(assetPath);
        const assetGuid = AssetDatabase.getInstance().getGuid(assetPath) ?? null;
        this.editor.scene.gameObjects.forEach((go: GameObject) => {
            go.getComponents(AudioSource).forEach( async(source) => {
                const matchesByPath = !!source.clipPath && this.pathsEqual(source.clipPath, normalizedAssetPath);
                const matchesByGuid = !!assetGuid && source.clipGuid === assetGuid;
                if (!matchesByPath && !matchesByGuid) return;
                await source.loadClip(normalizedAssetPath);
            });
        });
    }

    private async reloadPrefabInstancesForAsset(assetPath: string) {
        const prefab = await PrefabManager.loadPrefabFromPath(assetPath);
        if (!prefab) return;
        const assetGuid = AssetDatabase.getInstance().getGuid(assetPath) ?? null;
        const importerSettings = this.getImporterSettings(assetPath, 'prefab');
        const autoReconnect = importerSettings.autoReconnect !== false;
        const preserveOverrides = importerSettings.preserveOverrides !== false;
        if (!autoReconnect) return;
        const prefabName = PathUtils.basename(assetPath, PathUtils.extname(assetPath));

        this.editor.scene.gameObjects.forEach( async(go: GameObject) => {
            const matchesByPath = !!go.sourceAssetPath && this.pathsEqual(go.sourceAssetPath, assetPath);
            const matchesByGuid = !!assetGuid && go.sourceAssetGuid === assetGuid;
            if (go.sourceAssetType !== 'prefab' || (!matchesByPath && !matchesByGuid)) return;
            if (preserveOverrides) {
                const overrideSnapshot = this.capturePrefabOverrideSnapshot(go);
                const structuralOverrideSnapshot = this.capturePrefabStructuralOverrideSnapshot(go);
                await PrefabManager.revertToPrefab(go);
                this.restorePrefabOverrideSnapshot(go, overrideSnapshot);
                this.restorePrefabStructuralOverrideSnapshot(go, structuralOverrideSnapshot);
                go.sourceAssetPath = assetPath;
                go.sourceAssetGuid = assetGuid;
                go.sourceAssetType = 'prefab';
                go.prefabSource = prefabName;
                return;
            }

            await PrefabManager.revertToPrefab(go);
        });
    }

    private capturePrefabOverrideSnapshot(prefabRoot: GameObject): PrefabOverrideNodeSnapshot[] {
        const snapshots: PrefabOverrideNodeSnapshot[] = [];

        const walk = (current: GameObject) => {
            const path = PrefabManager.getPrefabNodePathForGameObject(current, prefabRoot);
            const gameObjectOverrideKeys = Array.from(current.overrides.values());
            const transformOverrideKeys = Array.from(current.transform.overrides.values());
            const componentSnapshots = current.components
                .filter((component) => component.constructor.name !== 'Transform' && component.overrides.size > 0)
                .map((component) => {
                    const serialized = component.serialize();
                    return {
                        type: component.constructor.name,
                        overrideKeys: Array.from(component.overrides.values()),
                        data: (serialized?.data && typeof serialized.data === 'object' && !Array.isArray(serialized.data))
                            ? serialized.data as Record<string, unknown>
                            : {}
                    };
                });

            if (gameObjectOverrideKeys.length > 0 || transformOverrideKeys.length > 0 || componentSnapshots.length > 0) {
                snapshots.push({
                    path,
                    gameObjectOverrideKeys,
                    gameObjectValues: {
                        name: current.name,
                        tag: current.tag,
                        layer: current.layer,
                        enabled: current.enabled
                    },
                    transformOverrideKeys,
                    transformValues: {
                        position: current.transform.position.toArray() as [number, number, number],
                        rotation: [
                            current.transform.rotation.x,
                            current.transform.rotation.y,
                            current.transform.rotation.z
                        ],
                        scale: current.transform.scale.toArray() as [number, number, number]
                    },
                    componentSnapshots
                });
            }

            current.transform.children.forEach((child) => walk(child.gameObject));
        };

        walk(prefabRoot);
        return snapshots;
    }

    private capturePrefabStructuralOverrideSnapshot(prefabRoot: GameObject): PrefabStructuralOverrideSnapshot[] {
        const snapshots: PrefabStructuralOverrideSnapshot[] = [];

        const walk = (current: GameObject) => {
            const targetPath = PrefabManager.getPrefabNodePathForGameObject(current, prefabRoot);
            const entries = this.editor.getPrefabOverrideEntries?.(current) ?? [];
            entries.forEach((entry: Record<string, any>) => {
                switch (entry.kind) {
                    case 'component-added': {
                        if (!entry.component?.serialize) return;
                        const serialized = entry.component.serialize();
                        snapshots.push({
                            kind: 'component-added',
                            targetPath,
                            componentType: entry.component.constructor?.name,
                            componentData: (serialized?.data && typeof serialized.data === 'object' && !Array.isArray(serialized.data))
                                ? serialized.data as Record<string, unknown>
                                : {}
                        });
                        break;
                    }
                    case 'component-removed':
                        snapshots.push({
                            kind: 'component-removed',
                            targetPath,
                            componentType: entry.componentType
                        });
                        break;
                    case 'child-added':
                        if (!entry.childGameObject?.serialize) return;
                        snapshots.push({
                            kind: 'child-added',
                            targetPath,
                            childPath: PrefabManager.getPrefabNodePathForGameObject(entry.childGameObject, prefabRoot),
                            parentPath: entry.parentPath ?? null,
                            childData: entry.childGameObject.serialize()
                        });
                        break;
                    case 'child-removed':
                        snapshots.push({
                            kind: 'child-removed',
                            targetPath,
                            childPath: entry.childPath ?? null
                        });
                        break;
                    default:
                        break;
                }
            });
            current.transform.children.forEach((child) => walk(child.gameObject));
        };

        walk(prefabRoot);
        return snapshots;
    }

    private restorePrefabOverrideSnapshot(prefabRoot: GameObject, snapshots: PrefabOverrideNodeSnapshot[]) {
        snapshots.forEach((snapshot) => {
            const target = PrefabManager.findPrefabInstanceNodeByPath(prefabRoot, snapshot.path);
            if (!target) return;

            snapshot.gameObjectOverrideKeys.forEach((key) => {
                if (key === 'name') {
                    target.name = snapshot.gameObjectValues.name ?? target.name;
                } else if (key === 'tag') {
                    target.tag = snapshot.gameObjectValues.tag ?? target.tag;
                } else if (key === 'layer') {
                    target.layer = snapshot.gameObjectValues.layer ?? target.layer;
                } else if (key === 'enabled') {
                    target.setActive(snapshot.gameObjectValues.enabled ?? target.enabled);
                }
            });
            target.overrides = new Set(snapshot.gameObjectOverrideKeys);

            snapshot.transformOverrideKeys.forEach((key) => {
                if (key === 'position') {
                    target.transform.position.fromArray(snapshot.transformValues.position);
                } else if (key === 'rotation') {
                    target.transform.rotation.set(
                        snapshot.transformValues.rotation[0],
                        snapshot.transformValues.rotation[1],
                        snapshot.transformValues.rotation[2]
                    );
                } else if (key === 'scale') {
                    target.transform.scale.fromArray(snapshot.transformValues.scale);
                }
            });
            target.transform.overrides = new Set(snapshot.transformOverrideKeys);

            snapshot.componentSnapshots.forEach((componentSnapshot) => {
                const component = target.components.find((entry) => entry.constructor.name === componentSnapshot.type);
                if (!component) return;
                if (component.deserialize) {
                    component.deserialize(componentSnapshot.data);
                } else {
                    Object.entries(componentSnapshot.data).forEach(([key, value]) => {
                        (component as any)[key] = value;
                    });
                }
                component.overrides = new Set(componentSnapshot.overrideKeys);
            });
        });
    }

    private restorePrefabStructuralOverrideSnapshot(prefabRoot: GameObject, snapshots: PrefabStructuralOverrideSnapshot[]) {
        snapshots.forEach((snapshot) => {
            const target = PrefabManager.findPrefabInstanceNodeByPath(prefabRoot, snapshot.targetPath ?? null);
            if (!target) return;

            if (snapshot.kind === 'component-added') {
                if (!snapshot.componentType) return;
                const existing = target.components.find((component) => component.constructor.name === snapshot.componentType);
                if (existing) return;
                const ComponentClass = ScriptRegistry.getComponentClass(snapshot.componentType);
                if (!ComponentClass) return;
                const component = target.addComponent(ComponentClass, { invokeLifecycle: false });
                if (component.deserialize && snapshot.componentData) {
                    component.deserialize(snapshot.componentData);
                }
                component.overrides = new Set(Object.keys(snapshot.componentData ?? {}));
                target.flushPendingLifecycle(false);
                return;
            }

            if (snapshot.kind === 'component-removed') {
                if (!snapshot.componentType) return;
                const existing = target.components.find((component) => component.constructor.name === snapshot.componentType);
                if (!existing || existing === target.transform) return;
                target.removeComponent(existing);
                return;
            }

            if (snapshot.kind === 'child-added') {
                if (!snapshot.childData) return;
                if (snapshot.childPath && PrefabManager.findPrefabInstanceNodeByPath(prefabRoot, snapshot.childPath)) return;
                const parent = snapshot.parentPath
                    ? PrefabManager.findPrefabInstanceNodeByPath(prefabRoot, snapshot.parentPath)
                    : target;
                if (!parent) return;
                const child = Prefab.instantiateData(snapshot.childData);
                if (prefabRoot.scene) {
                    prefabRoot.scene.addGameObject(child);
                }
                child.transform.setParent(parent.transform, false);
                return;
            }

            if (snapshot.kind === 'child-removed') {
                if (!snapshot.childPath) return;
                const child = PrefabManager.findPrefabInstanceNodeByPath(prefabRoot, snapshot.childPath);
                if (!child) return;
                if (child.scene) {
                    child.scene.removeGameObject(child);
                } else {
                    child.onDestroy();
                }
            }
        });
    }

    private reloadModelInstancesForAsset(assetPath: string) {
        const assetGuid = AssetDatabase.getInstance().getGuid(assetPath) ?? null;
        const targets = this.editor.scene.gameObjects.filter((go: GameObject) =>
            go.sourceAssetType === 'model' &&
            (
                (!!go.sourceAssetPath && this.pathsEqual(go.sourceAssetPath, assetPath)) ||
                (!!assetGuid && go.sourceAssetGuid === assetGuid)
            )
        );

        targets.forEach( async(target: GameObject) => {
            await AssetImporter.importModel(assetPath, (importedGO) => {
                PrefabManager.applySerializedData(target, importedGO.serialize(), {
                    preserveTransform: true,
                    preserveSourceLink: true
                });
                target.sourceAssetPath = assetPath;
                target.sourceAssetGuid = assetGuid;
                target.sourceAssetType = 'model';
            });
        });
    }

    private reloadAnimatorClipsForAsset(assetPath: string) {
        const normalizedAssetPath = this.normalizeAssetPath(assetPath);
        const assetGuid = AssetDatabase.getInstance().getGuid(assetPath) ?? null;
        const shouldImportAnimations = AssetImporter.shouldImportModelAnimations(normalizedAssetPath);
        this.editor.scene.gameObjects.forEach((go: GameObject) => {
            go.components.forEach((component: any) => {
                if (component.constructor?.name !== 'Animator') return;
                const matchesByPath = !!component.modelPath && this.pathsEqual(component.modelPath, normalizedAssetPath);
                const matchesByGuid = !!assetGuid && component.modelGuid === assetGuid;
                if (!matchesByPath && !matchesByGuid) return;
                component.clearAnimations?.(!shouldImportAnimations);
                if (shouldImportAnimations) {
                    component.loadModelClips(normalizedAssetPath);
                }
            });
        });
    }

    private applyMovedAssetReferenceEffects(movedEntries: AssetRefreshMove[]) {
        if (movedEntries.length === 0) return;

        const movedByGuid = new Map(movedEntries.map((entry) => [entry.guid, entry]));

        MaterialManager.getAllMaterials().forEach((material) => {
            (['mainTexture', 'normalMap', 'metallicMap', 'roughnessMap'] as const).forEach((slot) => {
                const texture = material[slot];
                if (!texture) return;
                const textureGuid = texture?.userData?.assetGuid as string | undefined;
                if (!textureGuid) return;
                const moved = movedByGuid.get(textureGuid);
                if (!moved) return;
                texture.userData.assetPath = moved.to;
            });

            const movedMaterialByPath = material.assetPath
                ? movedEntries.find((entry) => this.pathsEqual(entry.from, material.assetPath!))
                : null;
            if (movedMaterialByPath) {
                material.assetPath = movedMaterialByPath.to;
            }
        });

        this.editor.scene.gameObjects.forEach((go: GameObject) => {
            const sourceMoved = go.sourceAssetGuid ? movedByGuid.get(go.sourceAssetGuid) : null;
            if (sourceMoved) {
                go.sourceAssetPath = sourceMoved.to;
            }

            go.getComponents(AudioSource).forEach((source) => {
                const movedAudio = source.clipGuid ? movedByGuid.get(source.clipGuid) : null;
                if (movedAudio) {
                    source.clipPath = movedAudio.to;
                }
            });

            go.components.forEach((component: any) => {
                if (component.constructor?.name !== 'Animator') return;
                const movedModel = component.modelGuid ? movedByGuid.get(component.modelGuid) : null;
                if (movedModel) {
                    component.modelPath = movedModel.to;
                }
            });
        });

        this.patchSerializedMovedReferencesOnDisk(movedEntries, movedByGuid);
    }

    private patchSerializedMovedReferencesOnDisk(
        movedEntries: AssetRefreshMove[],
        movedByGuid: Map<string, AssetRefreshMove>
    ) {
        if (!this.fs || movedEntries.length === 0) return;

        const allEntries = AssetDatabase.getInstance().getAllEntries();
        const materialPaths = allEntries
            .filter((entry) => entry.meta.assetType === 'material')
            .map((entry) => entry.path);
        const scenePaths = allEntries
            .filter((entry) => entry.meta.assetType === 'scene')
            .map((entry) => entry.path);
        const prefabPaths = allEntries
            .filter((entry) => entry.meta.assetType === 'prefab')
            .map((entry) => entry.path);
        const scriptableObjectPaths = allEntries
            .filter((entry) => entry.meta.assetType === 'scriptableObject')
            .map((entry) => entry.path);

        materialPaths.forEach( async(assetPath) => {
            await this.patchJsonAssetFile(assetPath, (data) => this.patchMaterialAssetDataReferences(data, movedEntries, movedByGuid));
        });

        scenePaths.forEach( async(assetPath) => {
            await this.patchJsonAssetFile(assetPath, (data) => this.patchSceneAssetDataReferences(data, movedEntries, movedByGuid));
        });

        prefabPaths.forEach( async(assetPath) => {
            await this.patchJsonAssetFile(assetPath, (data) => this.patchPrefabAssetDataReferences(data, movedEntries, movedByGuid));
        });

        scriptableObjectPaths.forEach( async(assetPath) => {
            await this.patchJsonAssetFile(assetPath, (data) => this.patchGenericAssetDataReferences(data, movedEntries, movedByGuid));
        });
    }

    private async patchJsonAssetFile(assetPath: string, patcher: (data: any) => boolean): Promise<void> {
        if (!this.fs || !await this.fs.exists(assetPath)) return;

        try {
            const raw = await this.fs.readFile(assetPath, 'utf8');
            const data = JSON.parse(raw);
            const changed = patcher(data);
            if (!changed) return;
            await this.fs.writeFile(assetPath, JSON.stringify(data, null, 2), 'utf8');
        } catch (e) {
            console.warn(`Failed to patch moved references in ${assetPath}:`, e);
        }
    }

    private patchMaterialAssetDataReferences(
        data: any,
        movedEntries: AssetRefreshMove[],
        movedByGuid: Map<string, AssetRefreshMove>
    ): boolean {
        if (!data || typeof data !== 'object') return false;

        let changed = false;
        changed = this.patchReferencePair(data, 'mainTexturePath', 'mainTextureGuid', movedEntries, movedByGuid) || changed;
        changed = this.patchReferencePair(data, 'normalMapPath', 'normalMapGuid', movedEntries, movedByGuid) || changed;
        changed = this.patchReferencePair(data, 'metallicMapPath', 'metallicMapGuid', movedEntries, movedByGuid) || changed;
        changed = this.patchReferencePair(data, 'roughnessMapPath', 'roughnessMapGuid', movedEntries, movedByGuid) || changed;
        changed = this.patchGenericAssetDataReferences(data, movedEntries, movedByGuid) || changed;
        return changed;
    }

    private patchSceneAssetDataReferences(
        data: any,
        movedEntries: AssetRefreshMove[],
        movedByGuid: Map<string, AssetRefreshMove>
    ): boolean {
        if (!data || !Array.isArray(data.gameObjects)) return false;

        let changed = false;
        data.gameObjects.forEach((goData: any) => {
            changed = this.patchSerializedGameObjectMovedReferences(goData, movedEntries, movedByGuid) || changed;
        });
        changed = this.patchGenericAssetDataReferences(data, movedEntries, movedByGuid) || changed;
        return changed;
    }

    private patchPrefabAssetDataReferences(
        data: any,
        movedEntries: AssetRefreshMove[],
        movedByGuid: Map<string, AssetRefreshMove>
    ): boolean {
        if (!data || typeof data !== 'object' || !data.data) return false;

        let changed = false;
        changed = this.patchSerializedGameObjectMovedReferences(data.data, movedEntries, movedByGuid) || changed;
        changed = this.patchGenericAssetDataReferences(data, movedEntries, movedByGuid) || changed;
        return changed;
    }

    private patchSerializedGameObjectMovedReferences(
        goData: any,
        movedEntries: AssetRefreshMove[],
        movedByGuid: Map<string, AssetRefreshMove>
    ): boolean {
        if (!goData || typeof goData !== 'object') return false;

        let changed = false;
        changed = this.patchReferencePair(goData, 'sourceAssetPath', 'sourceAssetGuid', movedEntries, movedByGuid) || changed;

        if (Array.isArray(goData.components)) {
            goData.components.forEach((componentData: any) => {
                if (!componentData || typeof componentData !== 'object') return;
                const data = componentData.data;
                if (!data || typeof data !== 'object') return;
                changed = this.patchReferencePair(data, 'clipPath', 'clipGuid', movedEntries, movedByGuid) || changed;
                changed = this.patchReferencePair(data, 'modelPath', 'modelGuid', movedEntries, movedByGuid) || changed;
            });
        }

        if (Array.isArray(goData.children)) {
            goData.children.forEach((child: any) => {
                changed = this.patchSerializedGameObjectMovedReferences(child, movedEntries, movedByGuid) || changed;
            });
        }

        return changed;
    }

    private patchReferencePair(
        target: any,
        pathKey: string,
        guidKey: string,
        movedEntries: AssetRefreshMove[],
        movedByGuid: Map<string, AssetRefreshMove>
    ): boolean {
        if (!target || typeof target !== 'object') return false;

        const currentPath = typeof target[pathKey] === 'string' ? target[pathKey] as string : null;
        const currentGuid = typeof target[guidKey] === 'string' ? target[guidKey] as string : null;
        const resolved = this.resolveMovedReference(currentPath, currentGuid, movedEntries, movedByGuid);
        if (!resolved) return false;

        let changed = false;
        if (currentPath !== resolved.path) {
            target[pathKey] = resolved.path;
            changed = true;
        }
        if (target[guidKey] !== resolved.guid) {
            target[guidKey] = resolved.guid;
            changed = true;
        }
        return changed;
    }

    private resolveMovedReference(
        pathValue: string | null,
        guidValue: string | null,
        movedEntries: AssetRefreshMove[],
        movedByGuid: Map<string, AssetRefreshMove>
    ): { path: string; guid: string } | null {
        if (guidValue) {
            const movedByKnownGuid = movedByGuid.get(guidValue);
            if (movedByKnownGuid) {
                return { path: movedByKnownGuid.to, guid: movedByKnownGuid.guid };
            }
        }

        if (!pathValue) return null;
        const movedByPath = movedEntries.find((entry) => this.pathsEqual(entry.from, pathValue));
        if (!movedByPath) return null;
        return { path: movedByPath.to, guid: movedByPath.guid };
    }

    private patchGenericAssetDataReferences(
        data: any,
        movedEntries: AssetRefreshMove[],
        movedByGuid: Map<string, AssetRefreshMove>
    ): boolean {
        return this.patchGenericAssetDataReferencesRecursive(data, movedEntries, movedByGuid);
    }

    private patchGenericAssetDataReferencesRecursive(
        value: any,
        movedEntries: AssetRefreshMove[],
        movedByGuid: Map<string, AssetRefreshMove>
    ): boolean {
        if (!value || typeof value !== 'object') return false;

        let changed = false;
        if (Array.isArray(value)) {
            value.forEach((entry) => {
                changed = this.patchGenericAssetDataReferencesRecursive(entry, movedEntries, movedByGuid) || changed;
            });
            return changed;
        }

        Object.keys(value).forEach((key) => {
            const entryValue = value[key];

            if (typeof entryValue === 'string' && key.endsWith('Path')) {
                const guidKey = `${key.substring(0, key.length - 4)}Guid`;
                const guidValue = typeof value[guidKey] === 'string' ? value[guidKey] as string : null;
                const resolved = this.resolveMovedReference(entryValue, guidValue, movedEntries, movedByGuid);
                if (resolved) {
                    if (entryValue !== resolved.path) {
                        value[key] = resolved.path;
                        changed = true;
                    }
                    if (typeof value[guidKey] === 'string' && value[guidKey] !== resolved.guid) {
                        value[guidKey] = resolved.guid;
                        changed = true;
                    }
                }
            }

            changed = this.patchGenericAssetDataReferencesRecursive(entryValue, movedEntries, movedByGuid) || changed;
        });

        return changed;
    }

    private normalizeAssetPath(assetPath: string): string {
        if (!assetPath.startsWith('file://')) return assetPath;

        try {
            return decodeURIComponent(assetPath.replace(/^file:\/\//, ''));
        } catch {
            return assetPath.replace(/^file:\/\//, '');
        }
    }

    private pathsEqual(a: string, b: string): boolean {
        return this.normalizeAssetPath(a).replace(/\//g, '\\').toLowerCase() === this.normalizeAssetPath(b).replace(/\//g, '\\').toLowerCase();
    }

    private async getDuplicateTargetPath(fullPath: string): Promise<string> {
        const isDirectory = (await this.fs.stat(fullPath)).isDirectory();
        const dir = PathUtils.dirname(fullPath);
        const ext = isDirectory ? '' : PathUtils.extname(fullPath);
        const baseName = isDirectory ? PathUtils.basename(fullPath) : PathUtils.basename(fullPath, ext);
        let index = 1;

        while (true) {
            const suffix = index === 1 ? ' (Copy)' : ` (Copy ${index})`;
            const candidate = PathUtils.join(dir, `${baseName}${suffix}${ext}`);
            if (!await this.fs.exists(candidate)) {
                return candidate;
            }
            index += 1;
        }
    }

    private async createAsset(targetPath: string, assetKind: 'file' | 'directory', content: Uint8Array): Promise<void> {
        await this.executeAssetMutation(`Create ${assetKind === 'directory' ? 'Folder' : 'Asset'}`, {
            operation: 'create', sourcePath: null, targetPath, assetKind,
            contentBase64: this.bytesToBase64(content),
            metadataBase64: this.bytesToBase64(new TextEncoder().encode(`${JSON.stringify(
                this.createAssetMetadata(targetPath, assetKind === 'directory'), null, 2
            )}\n`)),
            referencePatches: []
        });
    }

    private createAssetMetadata(assetPath: string, isDirectory: boolean): AssetMeta {
        const extension = isDirectory ? '' : PathUtils.extname(assetPath).toLowerCase().replace('.', '');
        const assetType = isDirectory ? 'folder'
            : extension === 'ts' || extension === 'js' ? 'script'
                : extension === 'scene' || extension === 'json' ? 'scene'
                    : extension === 'prefab' ? 'prefab'
                        : extension === 'mat' ? 'material'
                            : extension === 'asset' ? 'scriptableObject'
                                : 'unknown';
        return {
            formatVersion: 1, guid: crypto.randomUUID(), assetType, fileExtension: extension,
            timeCreated: Date.now(), labels: [], userData: {},
            importer: { name: 'DefaultImporter', version: 1, settings: {} }
        };
    }

    private async executeAssetMutation(
        name: string,
        intent: {
            operation: 'create' | 'move' | 'duplicate' | 'delete';
            sourcePath: string | null;
            targetPath: string | null;
            assetKind: 'file' | 'directory';
            contentBase64: string | null;
            metadataBase64: string | null;
            referencePatches: ProjectAssetReferencePatch[];
        }
    ): Promise<void> {
        if (this.assetMutationBusy) throw new Error('Another Project asset mutation is still in progress');
        const project = (window as any).__projectSecurity as { grantId?: string; root?: string } | undefined;
        if (!project?.grantId || !project.root) throw new Error('Project asset transactions require an active project grant');
        this.setAssetMutationBusy(true, `${name} in progress`);
        const selectedBefore = this.selectedAssetPath;
        const command = new ProjectAssetCommand(name, {
            contractVersion: 1,
            grantId: project.grantId,
            transactionId: crypto.randomUUID(),
            action: 'apply',
            ...intent,
            sourcePath: intent.sourcePath ? this.toProjectRelativePath(intent.sourcePath, project.root) : null,
            targetPath: intent.targetPath ? this.toProjectRelativePath(intent.targetPath, project.root) : null
        }, async (state) => {
            try {
                const focusPath = state === 'applied'
                    ? (intent.operation === 'delete' ? null : intent.targetPath)
                    : (intent.operation === 'create' || intent.operation === 'duplicate' ? selectedBefore : intent.sourcePath);
                this.selectedAssetPath = focusPath;
                this.focusedAssetPath = focusPath;
                await this.refreshAssetDatabaseAndView({ focusAssetPath: focusPath, preserveSelection: true });
                this.announceAssetMutation(`${name} ${state === 'applied' ? 'complete' : 'undone'}`);
            } catch (error) {
                console.error('Project asset view refresh failed after a committed transaction', error instanceof Error ? error.stack : error);
                this.announceAssetMutation(`${name} committed; Project view refresh failed`);
            }
        });
        try {
            await Promise.resolve(CommandHistory.execute(command));
        } catch (error) {
            this.announceAssetMutation(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        } finally {
            this.setAssetMutationBusy(false);
        }
    }

    private async buildMoveReferencePatches(sourcePath: string, targetPath: string): Promise<ProjectAssetReferencePatch[]> {
        const project = (window as any).__projectSecurity as { root?: string } | undefined;
        if (!project?.root) return [];
        const patches: ProjectAssetReferencePatch[] = [];
        const candidates = AssetDatabase.getInstance().getAllEntries()
            .filter((entry) => this.isReferenceAuditAssetType(entry.meta.assetType))
            .map((entry) => entry.path)
            .sort((left, right) => left.localeCompare(right));
        for (const candidate of candidates) {
            if (this.pathsEqual(candidate, sourcePath) || this.isPathInsideScope(candidate, sourcePath)) continue;
            try {
                const beforeText = await this.fs.readFile(candidate, 'utf8');
                const documentValue = JSON.parse(beforeText);
                if (!this.patchMovedReferencePaths(documentValue, sourcePath, targetPath)) continue;
                patches.push({
                    path: this.toProjectRelativePath(candidate, project.root),
                    beforeBase64: this.bytesToBase64(new TextEncoder().encode(beforeText)),
                    afterBase64: this.bytesToBase64(new TextEncoder().encode(`${JSON.stringify(documentValue, null, 2)}\n`))
                });
            } catch { /* Unsupported reference document. */ }
        }
        return patches;
    }

    private patchMovedReferencePaths(node: unknown, sourcePath: string, targetPath: string): boolean {
        if (!node || typeof node !== 'object') return false;
        let changed = false;
        if (Array.isArray(node)) {
            node.forEach((value) => { changed = this.patchMovedReferencePaths(value, sourcePath, targetPath) || changed; });
            return changed;
        }
        Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
            if (key.endsWith('Path') && typeof value === 'string') {
                if (this.pathsEqual(value, sourcePath)) {
                    (node as Record<string, unknown>)[key] = targetPath;
                    changed = true;
                } else if (this.isPathInsideScope(value, sourcePath)) {
                    const suffix = this.normalizeAssetPath(value).slice(this.normalizeAssetPath(sourcePath).length);
                    (node as Record<string, unknown>)[key] = `${targetPath}${suffix}`;
                    changed = true;
                }
            }
            changed = this.patchMovedReferencePaths(value, sourcePath, targetPath) || changed;
        });
        return changed;
    }

    private toProjectRelativePath(absolutePath: string, projectRoot: string): string {
        const relative = PathUtils.relative(projectRoot, absolutePath).replace(/\\/g, '/');
        if (!relative || relative === '.' || relative === '..' || relative.startsWith('../')) {
            throw new Error('Asset path is outside the active project');
        }
        return relative;
    }

    private bytesToBase64(bytes: Uint8Array): string {
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        return btoa(binary);
    }

    private setAssetMutationBusy(busy: boolean, message?: string): void {
        this.assetMutationBusy = busy;
        document.getElementById('assets-content')?.setAttribute('aria-busy', String(busy));
        if (message) this.announceAssetMutation(message);
    }

    private announceAssetMutation(message: string): void {
        const content = document.getElementById('assets-content');
        if (!content) return;
        let liveRegion = content.querySelector<HTMLElement>('[data-project-mutation-status]');
        if (!liveRegion) {
            liveRegion = document.createElement('div');
            liveRegion.dataset.projectMutationStatus = 'true';
            liveRegion.setAttribute('role', 'status');
            liveRegion.setAttribute('aria-live', 'polite');
            Object.assign(liveRegion.style, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)' });
            content.appendChild(liveRegion);
        }
        liveRegion.textContent = message;
    }

    private async duplicateAsset(fullPath: string) {
        const targetPath = await this.getDuplicateTargetPath(fullPath);
        const stat = await this.fs.stat(fullPath);
        await this.executeAssetMutation('Duplicate Asset', {
            operation: 'duplicate',
            sourcePath: fullPath,
            targetPath,
            assetKind: stat.isDirectory() ? 'directory' : 'file',
            contentBase64: null,
            metadataBase64: null,
            referencePatches: []
        });
    }

    private async drawFolderTree(parent: HTMLElement, path: string, indent: number) {
        // Read directory safely
        let entries: any[] = [];
        try {
            entries = await this.fs.readdir(path, { withFileTypes: true });
        } catch (e) {
            return;
        }

        const folders = entries.filter(e => e.isDirectory());
        const name = PathUtils.basename(path) || 'Assets';

        // Tree Item Interaction
        const item = document.createElement('div');
        item.className = 'project-folder-item';
        item.dataset.folderPath = path;
        item.setAttribute('role', 'treeitem');
        item.setAttribute('aria-level', String(indent + 1));
        item.setAttribute('aria-selected', String(this.pathsEqual(path, this.currentPath)));
        item.setAttribute('aria-expanded', folders.length > 0 ? String(this.expandedPaths.has(path)) : 'false');
        item.tabIndex = this.focusedFolderPath
            ? (this.pathsEqual(this.focusedFolderPath, path) ? 0 : -1)
            : (this.pathsEqual(path, this.currentPath) ? 0 : -1);
        item.style.paddingLeft = `${indent * 12 + 4}px`;
        item.style.cursor = 'pointer';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.height = '20px';
        item.style.color = 'var(--unity-text)';
        item.style.fontSize = '12px';

        // Selected?
        if (path === this.currentPath) {
            item.style.background = 'var(--unity-bg-selected)';
            item.style.color = 'white';
        } else {
            item.onmouseenter = () => item.style.background = 'var(--unity-bg-hover)';
            item.onmouseleave = () => item.style.background = 'transparent';
        }

        // Arrow
        const arrow = document.createElement('span');
        arrow.style.width = '12px';
        arrow.style.textAlign = 'center';
        arrow.style.fontSize = '10px';
        arrow.innerText = folders.length > 0 ? (this.expandedPaths.has(path) ? 'v' : '>') : '';
        arrow.style.color = '#999';
        arrow.style.marginRight = '2px';
        arrow.onclick =  async(e) => {
            e.stopPropagation();
            if (folders.length > 0) {
                if (this.expandedPaths.has(path)) this.expandedPaths.delete(path);
                else this.expandedPaths.add(path);
                await this.refresh();
            }
        };

        // Icon
        const icon = document.createElement('span');
        icon.innerHTML = AssetIcons.Folder; icon.style.marginRight = '4px'; icon.style.width = '16px'; icon.style.height = '16px'; icon.style.display = 'inline-flex'; icon.style.alignItems = 'center';


        // Name
        const label = document.createElement('span');
        label.innerText = name;
        label.style.whiteSpace = 'nowrap';

        item.appendChild(arrow);
        item.appendChild(icon);
        item.appendChild(label);

        item.onclick =  async() => {
            this.focusedFolderPath = path;
            this.currentPath = path;
            this.editor.inspectorWindow.selectAsset(await this.buildAssetSelection(path, name, true));
            await this.refresh();
            this.focusFolderAfterRefresh(path);
        };

        item.onfocus = () => {
            this.focusedFolderPath = path;
        };

        item.onkeydown = async (e) => {
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (folders.length > 0 && !this.expandedPaths.has(path)) {
                    this.expandedPaths.add(path);
                    await this.refresh();
                    this.focusFolderAfterRefresh(path);
                } else {
                    this.focusAdjacentFolder(path, 1);
                }
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (this.expandedPaths.has(path) && folders.length > 0) {
                    this.expandedPaths.delete(path);
                    await this.refresh();
                    this.focusFolderAfterRefresh(path);
                } else {
                    this.focusParentFolder(path);
                }
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.focusAdjacentFolder(path, e.key === 'ArrowDown' ? 1 : -1);
            } else if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault();
                this.focusFolderBoundary(e.key === 'End');
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                item.click();
            } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                e.preventDefault();
                const rect = item.getBoundingClientRect();
                await this.showItemContextMenu(rect.left + 12, rect.top + 12, name, path, label);
            }
        };

        item.oncontextmenu =  async(e) => {
            e.preventDefault();
            e.stopPropagation();
            await this.showItemContextMenu(e.clientX, e.clientY, name, path, label);
        };

        parent.appendChild(item);

        // Recursive Children
        if (this.expandedPaths.has(path)) {
            for (const folder of folders) {
                await this.drawFolderTree(parent, PathUtils.join(path, folder.name), indent + 1);
            }
        }
    }

    private getGridColumnCount(items: HTMLElement[]): number {
        if (items.length < 2) return 1;
        const firstTop = items[0].offsetTop;
        const firstDifferentRow = items.findIndex((item) => item.offsetTop > firstTop);
        return firstDifferentRow > 0 ? firstDifferentRow : items.length;
    }

    private getVisibleFolderItems(): HTMLElement[] {
        return Array.from(document.querySelectorAll<HTMLElement>('#assets-content .project-folder-item'));
    }

    private focusFolderAfterRefresh(path: string): void {
        requestAnimationFrame(() => {
            const target = this.getVisibleFolderItems().find((item) =>
                !!item.dataset.folderPath && this.pathsEqual(item.dataset.folderPath, path)
            );
            target?.focus();
        });
    }

    private focusAdjacentFolder(path: string, offset: number): void {
        const items = this.getVisibleFolderItems();
        const currentIndex = items.findIndex((item) =>
            !!item.dataset.folderPath && this.pathsEqual(item.dataset.folderPath, path)
        );
        if (currentIndex < 0) return;
        items[Math.max(0, Math.min(items.length - 1, currentIndex + offset))]?.focus();
    }

    private focusFolderBoundary(end: boolean): void {
        const items = this.getVisibleFolderItems();
        items[end ? items.length - 1 : 0]?.focus();
    }

    private focusParentFolder(path: string): void {
        if (this.pathsEqual(path, this.rootPath)) return;
        this.focusFolderAfterRefresh(PathUtils.dirname(path));
    }

    private async deleteAssetFromKeyboard(name: string, fullPath: string, isDirectory: boolean): Promise<void> {
        const impactSummary = await this.getDeleteImpactSummary(fullPath);
        if (!confirm(this.buildDeleteConfirmationMessage(name, impactSummary))) return;

        await this.executeAssetMutation('Delete Asset', {
            operation: 'delete',
            sourcePath: fullPath,
            targetPath: null,
            assetKind: isDirectory ? 'directory' : 'file',
            contentBase64: null,
            metadataBase64: null,
            referencePatches: []
        });
    }

    private showContextMenu(x: number, y: number) {
        this.removeExistingMenus();
        const menu = this.createMenu(x, y);

        this.addMenuItem(menu, 'Create Folder',  async() => {
            const name = prompt("Folder Name", "New Folder");
            if (name) {
                const p = PathUtils.join(this.currentPath, name);
                if (!await this.fs.exists(p)) await this.createAsset(p, 'directory', new Uint8Array());
            }
        });

        this.addMenuItem(menu, 'Create Script',  async() => {
            const name = prompt("Script Name", "NewScript");
            if (name) {
                await this.createFileFromTemplate(name, 'ts');
            }
        });

        this.addMenuItem(menu, 'Create Material',  async() => {
            const name = prompt("Material Name", "NewMaterial");
            if (name) {
                const mat = new Material(name);
                const p = PathUtils.join(this.currentPath, `${name}.mat`);
                await this.createAsset(p, 'file', new TextEncoder().encode(JSON.stringify(mat.serialize(), null, 4)));
            }
        });

        this.addMenuItem(menu, 'Create Scene',  async() => {
            const name = prompt("Scene Name", "NewScene");
            if (name) {
                const scene = new Scene();
                const p = PathUtils.join(this.currentPath, `${name}.scene`);
                await this.createAsset(p, 'file', new TextEncoder().encode(scene.toJSON()));
            }
        });

        // ScriptableObject submenu
        const soTypes = ScriptableObjectRegistry.getTypeNames();
        if (soTypes.length > 0) {
            this.addMenuSeparator(menu);
            soTypes.forEach(typeName => {
                this.addMenuItem(menu, `Create ${typeName}`,  async() => {
                    const name = prompt(`${typeName} Name`, typeName);
                    if (!name) return;
                    const Ctor = ScriptableObjectRegistry.get(typeName)!;
                    const instance = new Ctor();
                    instance.assetName = name;
                    const p = PathUtils.join(this.currentPath, `${name}.asset`);
                    await this.createAsset(p, 'file', new TextEncoder().encode(instance.toAssetJSON()));
                });
            });
        }

        this.addMenuSeparator(menu);
        this.addMenuItem(menu, 'Validate References (All)',  async() => {
            const result = await this.auditAllAssetReferences();
            alert(this.formatReferenceAuditSummary(result, 'Reference Validation (All)'));
        });
        this.addMenuItem(menu, 'Auto Repair References (All)',  async() => {
            const result = await this.repairAllAssetReferences();
            alert(this.formatReferenceAuditSummary(result, 'Reference Auto Repair (All)'));
        });
        this.addMenuItem(menu, 'Recent Repair History', () => {
            alert(this.formatRecentRepairHistorySummary('Recent Repair History (Project)'));
        });
        this.addMenuItem(menu, 'Clear Repair History', () => {
            this.clearRecentRepairHistory();
            alert('Recent repair history cleared.');
        });
        this.addMenuItem(menu, 'Phase 3 Readiness (Project)',  async() => {
            const report = await this.runPhase3ReadinessCheck(this.rootPath);
            alert(this.formatPhase3ReadinessSummary(report, 'Phase 3 Readiness (Project)'));
        });
        this.addMenuItem(menu, 'Phase 3 Readiness (Current Folder)',  async() => {
            const report = await this.runPhase3ReadinessCheck(this.currentPath);
            alert(this.formatPhase3ReadinessSummary(report, 'Phase 3 Readiness (Current Folder)'));
        });
        this.addMenuItem(menu, 'Reimport Current Folder',  async() => {
            await this.reimportAssetScope(this.currentPath, false);
        });
        this.addMenuItem(menu, 'Reimport Current Folder + Dependents',  async() => {
            await this.reimportAssetScope(this.currentPath, true);
        });
        this.addMenuItem(menu, 'Show Current Folder Impact',  async() => {
            const summary = await this.getDeleteImpactSummary(this.currentPath);
            if (!summary) {
                alert('Impact summary is not available for current folder.');
                return;
            }
            alert(this.formatDeleteImpactSummary(summary, 'Delete Impact (Current Folder)'));
        });

        this.addMenuSeparator(menu);
        this.addMenuItem(menu, 'Refresh',  async() => await this.refreshAssetDatabaseAndView());

        document.body.appendChild(menu);
        setTimeout(() => document.addEventListener('click', () => this.removeExistingMenus(), { once: true }), 0);
    }

    private async showItemContextMenu(x: number, y: number, name: string, fullPath: string, labelElement: HTMLElement) {
        this.removeExistingMenus();
        const menu = this.createMenu(x, y);
        const isDirectory = (await this.fs.stat(fullPath)).isDirectory();

        if (!isDirectory) {
            this.addMenuItem(menu, 'Reimport',  async() => {
                await this.reimportAsset(fullPath);
            });
            this.addMenuItem(menu, 'Reimport + Dependents',  async() => {
                await this.reimportAssetWithDependents(fullPath);
            });
            this.addMenuSeparator(menu);
        } else {
            this.addMenuItem(menu, 'Reimport Folder',  async() => {
                await this.reimportAssetScope(fullPath, false);
            });
            this.addMenuItem(menu, 'Reimport Folder + Dependents',  async() => {
                await this.reimportAssetScope(fullPath, true);
            });
            this.addMenuSeparator(menu);
        }

        this.addMenuItem(menu, isDirectory ? 'Validate References in Folder' : 'Validate References',  async() => {
            const result = await this.auditAssetReferences(fullPath);
            if (!result) {
                alert('No auditable assets were found in this scope.');
                return;
            }
            alert(this.formatReferenceAuditSummary(result, 'Reference Validation'));
        });
        this.addMenuItem(menu, isDirectory ? 'Auto Repair References in Folder' : 'Auto Repair References',  async() => {
            const result = await this.repairAssetReferences(fullPath);
            if (!result) {
                alert('No auditable assets were found in this scope.');
                return;
            }
            alert(this.formatReferenceAuditSummary(result, 'Reference Auto Repair'));
        });
        this.addMenuItem(menu, 'Recent Repair History', () => {
            alert(this.formatRecentRepairHistorySummary('Recent Repair History'));
        });
        this.addMenuItem(menu, 'Clear Repair History', () => {
            this.clearRecentRepairHistory();
            alert('Recent repair history cleared.');
        });
        this.addMenuItem(menu, isDirectory ? 'Phase 3 Readiness in Folder' : 'Phase 3 Readiness for Asset',  async() => {
            const report = await this.runPhase3ReadinessCheck(fullPath);
            alert(this.formatPhase3ReadinessSummary(report, 'Phase 3 Readiness'));
        });
        this.addMenuItem(menu, 'Show Dependency Impact',  async() => {
            const summary = await this.getDeleteImpactSummary(fullPath);
            if (!summary) {
                alert('Impact summary is not available for this selection.');
                return;
            }
            alert(this.formatDeleteImpactSummary(summary, 'Delete Impact'));
        });
        this.addMenuSeparator(menu);

        this.addMenuItem(menu, 'Duplicate',  async() => {
            await this.duplicateAsset(fullPath);
        });

        this.addMenuItem(menu, 'Rename', () => {
            this.startInlineRename(labelElement, fullPath);
        });

        this.addMenuSeparator(menu);

        this.addMenuItem(menu, 'Reveal in Explorer', () => {
            (window as any).electronAPI?.revealInFolder?.(fullPath);
        });

        if (!isDirectory) {
            this.addMenuSeparator(menu);

            const usedByPaths = this.getAssetReferencerPaths(fullPath);
            const dependencyPaths = this.getAssetDependencyPaths(fullPath);
            this.appendReferenceMenuSection(menu, `Used By (${usedByPaths.length})`, usedByPaths);
            this.appendReferenceMenuSection(menu, `Depends On (${dependencyPaths.length})`, dependencyPaths);
        }

        this.addMenuSeparator(menu);

        this.addMenuItem(menu, 'Delete',  async() => {
            const impactSummary = await this.getDeleteImpactSummary(fullPath);
            if (confirm(this.buildDeleteConfirmationMessage(name, impactSummary))) {
                await this.executeAssetMutation('Delete Asset', {
                    operation: 'delete', sourcePath: fullPath, targetPath: null,
                    assetKind: isDirectory ? 'directory' : 'file', contentBase64: null,
                    metadataBase64: null, referencePatches: []
                });
            }
        }, '#ff6b6b');

        document.body.appendChild(menu);
        setTimeout(() => document.addEventListener('click', () => this.removeExistingMenus(), { once: true }), 0);
    }

    private async isRuntimeRefreshCandidate(assetPath: string): Promise<boolean> {
        if (!assetPath || typeof assetPath !== 'string') return false;
        if (!await this.fs.exists(assetPath)) return false;

        try {
            if ((await this.fs.stat(assetPath)).isDirectory()) return false;
        } catch {
            return false;
        }

        const assetType = AssetDatabase.getInstance().getMeta(assetPath)?.assetType ?? null;
        return assetType === 'texture'
            || assetType === 'material'
            || assetType === 'audio'
            || assetType === 'prefab'
            || assetType === 'model';
    }

    private async isFileAssetPath(assetPath: string): Promise<boolean> {
        if (!assetPath || !await this.fs.exists(assetPath)) return false;
        try {
            return !(await this.fs.stat(assetPath)).isDirectory();
        } catch {
            return false;
        }
    }

    private async getReferenceAuditCandidatePaths(scopePath?: string): Promise<string[]> {
        const allAuditable = AssetDatabase.getInstance()
            .getAllEntries()
            .filter((entry) => this.isReferenceAuditAssetType(entry.meta.assetType))
            .map((entry) => entry.path)
            .sort((left, right) => left.localeCompare(right));

        if (!scopePath || scopePath.length === 0) {
            return allAuditable;
        }

        if (!await this.fs.exists(scopePath)) {
            return [];
        }

        const stat = await this.fs.stat(scopePath);
        if (!stat.isDirectory()) {
            const metaType = AssetDatabase.getInstance().getMeta(scopePath)?.assetType ?? null;
            return this.isReferenceAuditAssetType(metaType) ? [scopePath] : [];
        }

        const normalizedRoot = this.normalizeAssetPath(scopePath).replace(/\//g, '\\').toLowerCase();
        const rootPrefix = normalizedRoot.endsWith('\\') ? normalizedRoot : `${normalizedRoot}\\`;
        return allAuditable.filter((candidatePath) => {
            const normalizedCandidate = this.normalizeAssetPath(candidatePath).replace(/\//g, '\\').toLowerCase();
            return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(rootPrefix);
        });
    }

    private isReferenceAuditAssetType(assetType: string | null | undefined): boolean {
        return assetType === 'scene'
            || assetType === 'prefab'
            || assetType === 'material'
            || assetType === 'scriptableObject';
    }

    private createEmptyReferenceAuditResult(): AssetReferenceAuditResult {
        return {
            scannedAssets: 0,
            scannedPairs: 0,
            issues: 0,
            fixable: 0,
            fixed: 0,
            unresolved: 0,
            filesChanged: 0,
            issuesByAsset: {},
            fixedByAsset: {},
            issuesByReason: {},
            changedAssetPaths: [],
            sampleIssues: []
        };
    }

    private auditAndRepairReferenceFiles(assetPaths: string[], applyFixes: boolean): AssetReferenceAuditResult {
        const result = this.createEmptyReferenceAuditResult();
        if (!this.fs || assetPaths.length === 0) return result;

        assetPaths.forEach( async(assetPath) => {
            await this.auditAndRepairReferenceFile(assetPath, applyFixes, result);
        });
        return result;
    }

    private async auditAndRepairReferenceFile(assetPath: string, applyFixes: boolean, result: AssetReferenceAuditResult): Promise<void> {
        if (!this.fs || !await this.fs.exists(assetPath) || (await this.fs.stat(assetPath)).isDirectory()) return;

        try {
            const raw = await this.fs.readFile(assetPath, 'utf8');
            const data = JSON.parse(raw);
            result.scannedAssets += 1;

            const changed = this.auditAndRepairReferenceNode(data, assetPath, '$', applyFixes, result);
            if (changed) {
                await this.fs.writeFile(assetPath, JSON.stringify(data, null, 2), 'utf8');
                result.filesChanged += 1;
                result.changedAssetPaths.push(assetPath);
            }
        } catch {
            // Ignore malformed/unparseable files in audit flow.
        }
    }

    private auditAndRepairReferenceNode(
        node: any,
        assetPath: string,
        jsonPath: string,
        applyFixes: boolean,
        result: AssetReferenceAuditResult
    ): boolean {
        if (!node || typeof node !== 'object') return false;

        let changed = false;
        if (Array.isArray(node)) {
            node.forEach((entry, index) => {
                changed = this.auditAndRepairReferenceNode(entry, assetPath, `${jsonPath}[${index}]`, applyFixes, result) || changed;
            });
            return changed;
        }

        Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
            if (key.endsWith('Path') && (typeof value === 'string' || value === null)) {
                const guidKey = `${key.substring(0, key.length - 4)}Guid`;
                const rawPath = typeof value === 'string' ? value : null;
                const rawGuid = typeof node[guidKey] === 'string' ? node[guidKey] as string : null;

                if (rawPath || rawGuid) {
                    result.scannedPairs += 1;
                    const evalResult = this.evaluateReferencePair(rawPath, rawGuid);
                    if (evalResult.reason) {
                        const issue: AssetReferenceAuditIssue = {
                            assetPath,
                            jsonPath: `${jsonPath}.${key}`,
                            pathKey: key,
                            guidKey,
                            pathValue: rawPath,
                            guidValue: rawGuid,
                            suggestedPath: evalResult.suggestedPath,
                            suggestedGuid: evalResult.suggestedGuid,
                            reason: evalResult.reason,
                            fixable: evalResult.fixable
                        };

                        result.issues += 1;
                        result.issuesByAsset[assetPath] = (result.issuesByAsset[assetPath] ?? 0) + 1;
                        result.issuesByReason[evalResult.reason] = (result.issuesByReason[evalResult.reason] ?? 0) + 1;
                        if (evalResult.fixable) {
                            result.fixable += 1;
                        } else {
                            result.unresolved += 1;
                        }
                        if (result.sampleIssues.length < 25) {
                            result.sampleIssues.push(issue);
                        }

                        if (applyFixes && evalResult.fixable) {
                            let issueFixed = false;
                            if (evalResult.suggestedPath && (!rawPath || !this.pathsEqual(rawPath, evalResult.suggestedPath))) {
                                node[key] = evalResult.suggestedPath;
                                issueFixed = true;
                            }
                            if (evalResult.suggestedGuid && rawGuid !== evalResult.suggestedGuid) {
                                node[guidKey] = evalResult.suggestedGuid;
                                issueFixed = true;
                            }
                            if (issueFixed) {
                                result.fixed += 1;
                                result.fixedByAsset[assetPath] = (result.fixedByAsset[assetPath] ?? 0) + 1;
                                changed = true;
                            }
                        }
                    }
                }
            }

            changed = this.auditAndRepairReferenceNode(value, assetPath, `${jsonPath}.${key}`, applyFixes, result) || changed;
        });

        return changed;
    }

    private evaluateReferencePair(
        pathValue: string | null,
        guidValue: string | null
    ): {
        reason: string | null;
        fixable: boolean;
        suggestedPath: string | null;
        suggestedGuid: string | null;
    } {
        const normalizedPath = pathValue ? this.normalizeAssetPath(pathValue) : null;
        const guidPath = guidValue ? (AssetDatabase.getInstance().getPath(guidValue) ?? null) : null;
        const pathGuid = normalizedPath ? (AssetDatabase.getInstance().getGuid(normalizedPath) ?? null) : null;

        if (guidPath) {
            if (!normalizedPath || !this.pathsEqual(normalizedPath, guidPath)) {
                return {
                    reason: 'path-out-of-sync',
                    fixable: true,
                    suggestedPath: guidPath,
                    suggestedGuid: guidValue
                };
            }

            if (pathGuid && pathGuid !== guidValue) {
                return {
                    reason: 'guid-mismatch',
                    fixable: true,
                    suggestedPath: guidPath,
                    suggestedGuid: pathGuid
                };
            }

            return { reason: null, fixable: false, suggestedPath: null, suggestedGuid: null };
        }

        if (normalizedPath && pathGuid) {
            if (guidValue !== pathGuid) {
                return {
                    reason: guidValue ? 'guid-mismatch' : 'guid-missing',
                    fixable: true,
                    suggestedPath: normalizedPath,
                    suggestedGuid: pathGuid
                };
            }
            return { reason: null, fixable: false, suggestedPath: null, suggestedGuid: null };
        }

        if (normalizedPath && !pathGuid) {
            const inferredPaths = this.findAssetPathsByBaseName(normalizedPath);
            const inferredPath = inferredPaths.length === 1 ? inferredPaths[0] : null;
            const inferredGuid = inferredPath ? (AssetDatabase.getInstance().getGuid(inferredPath) ?? null) : null;
            if (inferredPath && inferredGuid) {
                return {
                    reason: 'inferred-by-name',
                    fixable: true,
                    suggestedPath: inferredPath,
                    suggestedGuid: inferredGuid
                };
            }
            if (inferredPaths.length > 1) {
                return {
                    reason: 'ambiguous-by-name',
                    fixable: false,
                    suggestedPath: null,
                    suggestedGuid: null
                };
            }
            return {
                reason: 'missing-target',
                fixable: false,
                suggestedPath: null,
                suggestedGuid: null
            };
        }

        if (guidValue && !guidPath) {
            return {
                reason: 'orphan-guid',
                fixable: false,
                suggestedPath: null,
                suggestedGuid: null
            };
        }

        return { reason: null, fixable: false, suggestedPath: null, suggestedGuid: null };
    }

    private findAssetPathsByBaseName(referencePath: string): string[] {
        const refExt = PathUtils.extname(referencePath).toLowerCase();
        const refBase = PathUtils.basename(referencePath, refExt || undefined).toLowerCase();
        if (!refBase) return [];

        const candidates = AssetDatabase.getInstance()
            .getAllEntries()
            .filter((entry) => {
                const entryExt = PathUtils.extname(entry.path).toLowerCase();
                if (refExt && entryExt !== refExt) return false;
                const entryBase = PathUtils.basename(entry.path, entryExt || undefined).toLowerCase();
                return entryBase === refBase;
            })
            .map((entry) => entry.path);

        return candidates;
    }

    private collectAssetTypeCounts(entries: AssetEntry[]): Record<string, number> {
        const counts: Record<string, number> = {};
        entries.forEach((entry) => {
            const key = entry.meta.assetType;
            counts[key] = (counts[key] ?? 0) + 1;
        });
        return counts;
    }

    private collectHealthDiagnostics(
        scopeEntries: AssetEntry[],
        referenceAudit: AssetReferenceAuditResult,
        scopePath: string
    ): Phase3ReadinessReport['healthDiagnostics'] {
        const fileEntries = scopeEntries.filter( async(entry) => await this.isFileAssetPath(entry.path));
        const unusedAssetCount = fileEntries.filter((entry) => {
            if (!this.isUnusedAssetCandidate(entry.meta.assetType)) return false;
            return AssetDatabase.getInstance()
                .getReferencerPaths(entry.path)
                .filter((referencerPath) => !this.pathsEqual(referencerPath, entry.path) && this.isPathInsideScope(referencerPath, scopePath))
                .length === 0;
        }).length;

        const circularDependencyCount = this.countCircularDependencies(fileEntries.map((entry) => entry.path), scopePath);
        const missingTargetIssueCount = referenceAudit.issuesByReason['missing-target'] ?? 0;
        const orphanGuidIssueCount = referenceAudit.issuesByReason['orphan-guid'] ?? 0;
        const ambiguousReferenceCount = referenceAudit.issuesByReason['ambiguous-by-name'] ?? 0;

        return {
            unusedAssetCount,
            circularDependencyCount,
            missingTargetIssueCount,
            orphanGuidIssueCount,
            ambiguousReferenceCount
        };
    }

    private isUnusedAssetCandidate(assetType: string | null | undefined): boolean {
        return assetType === 'material'
            || assetType === 'texture'
            || assetType === 'audio'
            || assetType === 'model'
            || assetType === 'prefab'
            || assetType === 'scriptableObject';
    }

    private countCircularDependencies(scopeAssetPaths: string[], scopePath: string): number {
        const relevantPaths = new Set(scopeAssetPaths);
        const visiting = new Set<string>();
        const visited = new Set<string>();
        let cycles = 0;

        const visit = (assetPath: string, trail: Set<string>) => {
            if (trail.has(assetPath)) {
                cycles += 1;
                return;
            }
            if (visited.has(assetPath)) return;

            visiting.add(assetPath);
            trail.add(assetPath);

            AssetDatabase.getInstance()
                .getDependencyPaths(assetPath)
                .filter((dependencyPath) => relevantPaths.has(dependencyPath) && this.isPathInsideScope(dependencyPath, scopePath))
                .forEach((dependencyPath) => visit(dependencyPath, trail));

            trail.delete(assetPath);
            visiting.delete(assetPath);
            visited.add(assetPath);
        };

        scopeAssetPaths.forEach((assetPath) => {
            if (!visiting.has(assetPath) && !visited.has(assetPath)) {
                visit(assetPath, new Set<string>());
            }
        });

        return cycles;
    }

    private formatPhase3ReadinessSummary(report: Phase3ReadinessReport, label: string): string {
        const typeLines = Object.entries(report.assetTypeCounts)
            .sort((left, right) => left[0].localeCompare(right[0]))
            .map(([assetType, count]) => `${assetType}: ${count}`)
            .join('\n');
        const blockers = report.blockers.length > 0
            ? report.blockers.join('\n')
            : 'None';

        return `${label}\nScope: ${report.scopePath}\nReady: ${report.ready ? 'YES' : 'NO'}\n\nScope Assets: ${report.scopeAssetCount}\nRuntime Candidates: ${report.runtimeCandidateCount}\nDependency Edges: ${report.dependencyEdgeCount}\nReimport Direct Runtime Paths: ${report.reimportDiagnostics.directRuntimeReimportCount}\nReimport Dependent Graph Assets: ${report.reimportDiagnostics.dependentGraphExpandableCount}\nReimport Dependent Runtime Reloads: ${report.reimportDiagnostics.totalDependentRuntimeReloads}\nReimport Max Runtime Reload Fanout: ${report.reimportDiagnostics.maxDependentRuntimeReloads}\nUnused Asset Candidates: ${report.healthDiagnostics.unusedAssetCount}\nCircular Dependency Chains: ${report.healthDiagnostics.circularDependencyCount}\nMissing Target Issues: ${report.healthDiagnostics.missingTargetIssueCount}\nOrphan GUID Issues: ${report.healthDiagnostics.orphanGuidIssueCount}\nAmbiguous Name References: ${report.healthDiagnostics.ambiguousReferenceCount}\nScripts: ${report.scriptCount}\nScripts with custom executionOrder: ${report.scriptsWithCustomExecutionOrder}\nScripts with autoReferenced=false: ${report.scriptsAutoReferencedDisabled}\n\nRefresh Scan: ${report.refreshSummary.scannedCount}\nRefresh Added: ${report.refreshSummary.added}\nRefresh Removed: ${report.refreshSummary.removed}\nRefresh Changed: ${report.refreshSummary.changed}\nRefresh Meta Changed: ${report.refreshSummary.metaChanged}\nRefresh Meta Repaired: ${report.refreshSummary.metaRepaired}\nRefresh Duplicate GUID Repaired: ${report.refreshSummary.duplicateGuidRepaired}\nRefresh Orphan Meta Files: ${report.refreshSummary.orphanMetaFiles}\nRefresh Moved: ${report.refreshSummary.moved}\n\nReference Issues: ${report.referenceAudit.issues}\nReference Fixable: ${report.referenceAudit.fixable}\nReference Unresolved: ${report.referenceAudit.unresolved}\n\nAsset Types:\n${typeLines || 'None'}\n\nBlockers:\n${blockers}`;
    }

    private collectReimportDiagnostics(scopeAssetPaths: string[]): Phase3ReadinessReport['reimportDiagnostics'] {
        let directRuntimeReimportCount = 0;
        let dependentGraphExpandableCount = 0;
        let totalDependentRuntimeReloads = 0;
        let maxDependentRuntimeReloads = 0;

        scopeAssetPaths.forEach( async(assetPath) => {
            if (await this.isRuntimeRefreshCandidate(assetPath)) {
                directRuntimeReimportCount++;
            }

            const dependentRuntimePaths = (await this.getRuntimeReimportPathsForAsset(assetPath, true))
                .filter((candidatePath) => !this.pathsEqual(candidatePath, assetPath));

            if (dependentRuntimePaths.length > 0) {
                dependentGraphExpandableCount++;
                totalDependentRuntimeReloads += dependentRuntimePaths.length;
                maxDependentRuntimeReloads = Math.max(maxDependentRuntimeReloads, dependentRuntimePaths.length);
            }
        });

        return {
            directRuntimeReimportCount,
            dependentGraphExpandableCount,
            totalDependentRuntimeReloads,
            maxDependentRuntimeReloads
        };
    }

    private formatReferenceAuditSummary(result: AssetReferenceAuditResult, label: string): string {
        const topAssets = Object.entries(result.issuesByAsset)
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 5)
            .map(([assetPath, issueCount]) => `${PathUtils.basename(assetPath)}: ${issueCount}`);
        const topAssetsSection = topAssets.length > 0
            ? `\nTop Affected Assets:\n${topAssets.join('\n')}`
            : '';

        const sampleIssues = result.sampleIssues
            .slice(0, 5)
            .map((issue) => `${PathUtils.basename(issue.assetPath)} @ ${issue.jsonPath} -> ${issue.reason}`);
        const sampleIssuesSection = sampleIssues.length > 0
            ? `\nSample Issues:\n${sampleIssues.join('\n')}`
            : '';

        const topReasons = Object.entries(result.issuesByReason)
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 5)
            .map(([reason, count]) => `${reason}: ${count}`);
        const topReasonsSection = topReasons.length > 0
            ? `\nTop Reasons:\n${topReasons.join('\n')}`
            : '';

        const topFixedAssets = Object.entries(result.fixedByAsset)
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 5)
            .map(([assetPath, fixedCount]) => `${PathUtils.basename(assetPath)}: ${fixedCount}`);
        const topFixedAssetsSection = topFixedAssets.length > 0
            ? `\nTop Fixed Assets:\n${topFixedAssets.join('\n')}`
            : '';

        const changedAssets = result.changedAssetPaths
            .slice(0, 5)
            .map((assetPath) => PathUtils.basename(assetPath));
        const changedAssetsSection = changedAssets.length > 0
            ? `\nChanged Asset Files:\n${changedAssets.join('\n')}${result.changedAssetPaths.length > changedAssets.length ? `\n(+${result.changedAssetPaths.length - changedAssets.length} more)` : ''}`
            : '';

        return `${label}\nScanned Assets: ${result.scannedAssets}\nScanned References: ${result.scannedPairs}\nIssues: ${result.issues}\nFixable: ${result.fixable}\nFixed: ${result.fixed}\nUnresolved: ${result.unresolved}\nChanged Files: ${result.filesChanged}${topAssetsSection}${topReasonsSection}${topFixedAssetsSection}${changedAssetsSection}${sampleIssuesSection}`;
    }

    private recordRepairHistory(scopePath: string, result: AssetReferenceAuditResult): void {
        const topReasons = Object.entries(result.issuesByReason)
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 5)
            .map(([reason, count]) => ({ reason, count }));

        const entry: AssetRepairHistoryEntry = {
            timestamp: new Date().toISOString(),
            scopePath,
            scopeLabel: PathUtils.basename(scopePath) || scopePath,
            issues: result.issues,
            fixable: result.fixable,
            fixed: result.fixed,
            unresolved: result.unresolved,
            filesChanged: result.filesChanged,
            topReasons,
            changedAssetPaths: [...result.changedAssetPaths]
        };

        this.recentRepairHistory.unshift(entry);
        if (this.recentRepairHistory.length > 12) {
            this.recentRepairHistory.length = 12;
        }
        this.persistRecentRepairHistory();
    }

    private formatRecentRepairHistorySummary(label: string): string {
        if (this.recentRepairHistory.length === 0) {
            return `${label}\nNo repair history recorded yet.`;
        }

        const lines = this.recentRepairHistory.map((entry, index) => {
            const topReasons = entry.topReasons
                .map((reasonEntry) => `${reasonEntry.reason}: ${reasonEntry.count}`)
                .join(', ');
            const changedAssets = entry.changedAssetPaths
                .slice(0, 3)
                .map((assetPath) => PathUtils.basename(assetPath))
                .join(', ');
            const changedSuffix = entry.changedAssetPaths.length > 3
                ? ` (+${entry.changedAssetPaths.length - 3} more)`
                : '';
            return `${index + 1}. ${entry.timestamp}\n   Scope: ${entry.scopeLabel}\n   Issues/Fixed/Unresolved: ${entry.issues}/${entry.fixed}/${entry.unresolved}\n   Changed Files: ${entry.filesChanged}${changedAssets ? ` (${changedAssets}${changedSuffix})` : ''}\n   Top Reasons: ${topReasons || 'none'}`;
        });

        return `${label}\n${lines.join('\n\n')}`;
    }

    private loadRecentRepairHistory(): void {
        try {
            const raw = window.localStorage.getItem(RECENT_REPAIR_HISTORY_STORAGE_KEY);
            if (!raw) return;

            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return;

            this.recentRepairHistory = parsed
                .filter((entry) => entry && typeof entry === 'object')
                .map((entry) => ({
                    timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString(),
                    scopePath: typeof entry.scopePath === 'string' ? entry.scopePath : '',
                    scopeLabel: typeof entry.scopeLabel === 'string' ? entry.scopeLabel : '',
                    issues: typeof entry.issues === 'number' ? entry.issues : 0,
                    fixable: typeof entry.fixable === 'number' ? entry.fixable : 0,
                    fixed: typeof entry.fixed === 'number' ? entry.fixed : 0,
                    unresolved: typeof entry.unresolved === 'number' ? entry.unresolved : 0,
                    filesChanged: typeof entry.filesChanged === 'number' ? entry.filesChanged : 0,
                    topReasons: Array.isArray(entry.topReasons)
                        ? entry.topReasons
                            .filter((reasonEntry: any) => reasonEntry && typeof reasonEntry.reason === 'string' && typeof reasonEntry.count === 'number')
                            .slice(0, 5)
                        : [],
                    changedAssetPaths: Array.isArray(entry.changedAssetPaths)
                        ? entry.changedAssetPaths.filter((assetPath: any) => typeof assetPath === 'string').slice(0, 25)
                        : []
                }))
                .slice(0, 12);
        } catch {
            this.recentRepairHistory = [];
        }
    }

    private persistRecentRepairHistory(): void {
        try {
            window.localStorage.setItem(
                RECENT_REPAIR_HISTORY_STORAGE_KEY,
                JSON.stringify(this.recentRepairHistory)
            );
        } catch {
            // Ignore storage persistence issues; in-memory history still works.
        }
    }

    private clearRecentRepairHistory(): void {
        this.recentRepairHistory = [];
        try {
            window.localStorage.removeItem(RECENT_REPAIR_HISTORY_STORAGE_KEY);
        } catch {
            // Ignore storage cleanup issues.
        }
    }

    private async collectAssetPathsWithinScope(scopePath: string): Promise<string[]> {
        if (!scopePath || !await this.fs.exists(scopePath)) return [];

        const stat = await this.fs.stat(scopePath);
        if (!stat.isDirectory()) {
            return await this.fs.exists(scopePath) ? [scopePath] : [];
        }

        return AssetDatabase.getInstance()
            .getAllEntries()
            .map((entry) => entry.path)
            .filter((entryPath) => this.isPathInsideScope(entryPath, scopePath))
            .sort((left, right) => left.localeCompare(right));
    }

    private isPathInsideScope(candidatePath: string, scopePath: string): boolean {
        const normalizedScope = this.normalizeAssetPath(scopePath).replace(/\//g, '\\').toLowerCase();
        const normalizedCandidate = this.normalizeAssetPath(candidatePath).replace(/\//g, '\\').toLowerCase();
        if (normalizedCandidate === normalizedScope) return true;
        const prefix = normalizedScope.endsWith('\\') ? normalizedScope : `${normalizedScope}\\`;
        return normalizedCandidate.startsWith(prefix);
    }

    private formatDeleteImpactSummary(summary: AssetDeleteImpactSummary, label: string): string {
        const sample = summary.externalReferencerPaths.slice(0, 8);
        const sampleLines = sample.length > 0
            ? `\nSample Referencers:\n${sample.join('\n')}`
            : '';
        const moreCount = summary.externalReferencerCount - sample.length;
        const moreLine = moreCount > 0 ? `\n(+${moreCount} more)` : '';
        const typeLines = Object.entries(summary.externalReferencerTypeCounts)
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .map(([assetType, count]) => `${assetType}: ${count}`)
            .join('\n');
        const typeSection = typeLines ? `\nReferencer Types:\n${typeLines}` : '';
        return `${label}\nTarget Assets: ${summary.targetAssetCount}\nExternal Referencers: ${summary.externalReferencerCount}\nAuto-patchable on move/rename: ${summary.autoPatchableReferencerCount}\nManual review likely: ${summary.manualReviewReferencerCount}${typeSection}${sampleLines}${moreLine}`;
    }

    private buildDeleteConfirmationMessage(name: string, summary: AssetDeleteImpactSummary | null): string {
        if (!summary) {
            return `Are you sure you want to delete '${name}'?`;
        }

        if (summary.externalReferencerCount === 0) {
            return `Delete '${name}'?\nTarget Assets: ${summary.targetAssetCount}\nNo external references detected.`;
        }

        const typeLines = Object.entries(summary.externalReferencerTypeCounts)
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 4)
            .map(([assetType, count]) => `${assetType}: ${count}`)
            .join('\n');
        const typeSection = typeLines ? `\nReferencer Types:\n${typeLines}` : '';
        const sample = summary.externalReferencerPaths.slice(0, 6);
        const sampleLines = sample.length > 0
            ? `\nAffected:\n${sample.join('\n')}`
            : '';
        const moreCount = summary.externalReferencerCount - sample.length;
        const moreLine = moreCount > 0 ? `\n(+${moreCount} more)` : '';
        return `Delete '${name}'?\nWARNING: ${summary.externalReferencerCount} external asset(s) reference this scope.\nAuto-patchable on move/rename: ${summary.autoPatchableReferencerCount}\nManual review likely after delete: ${summary.manualReviewReferencerCount}${typeSection}${sampleLines}${moreLine}`;
    }

    private buildRenameConfirmationMessage(oldName: string, newName: string, summary: AssetDeleteImpactSummary | null): string | null {
        if (!summary || summary.externalReferencerCount === 0) {
            return null;
        }

        const typeLines = Object.entries(summary.externalReferencerTypeCounts)
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .slice(0, 4)
            .map(([assetType, count]) => `${assetType}: ${count}`)
            .join('\n');
        const typeSection = typeLines ? `\nReferencer Types:\n${typeLines}` : '';
        const sample = summary.externalReferencerPaths.slice(0, 6);
        const sampleLines = sample.length > 0
            ? `\nAffected:\n${sample.join('\n')}`
            : '';
        const moreCount = summary.externalReferencerCount - sample.length;
        const moreLine = moreCount > 0 ? `\n(+${moreCount} more)` : '';
        return `Rename '${oldName}' to '${newName}'?\nExternal referencers: ${summary.externalReferencerCount}\nAuto-patchable after refresh: ${summary.autoPatchableReferencerCount}\nManual review likely: ${summary.manualReviewReferencerCount}${typeSection}${sampleLines}${moreLine}`;
    }

    private isMovedReferenceAutoPatchableAssetType(assetType: string): boolean {
        return assetType === 'material'
            || assetType === 'scene'
            || assetType === 'prefab'
            || assetType === 'scriptableObject';
    }

    private appendReferenceMenuSection(menu: HTMLElement, title: string, assetPaths: string[]) {
        this.addMenuLabel(menu, title, 'var(--unity-text-dim)');

        const maxVisible = 8;
        const visible = assetPaths.slice(0, maxVisible);
        if (visible.length === 0) {
            this.addMenuLabel(menu, '  (none)', 'var(--unity-text-dim)');
            return;
        }

        visible.forEach((assetPath) => {
            const fileName = PathUtils.basename(assetPath);
            const folderName = PathUtils.basename(PathUtils.dirname(assetPath));
            this.addMenuItem(menu, `  ${fileName} - ${folderName}`,  async() => {
                await this.focusAssetByPath(assetPath);
            });
        });

        if (assetPaths.length > maxVisible) {
            this.addMenuLabel(menu, `  +${assetPaths.length - maxVisible} more in Inspector`, 'var(--unity-text-dim)');
        }
    }

    private startInlineRename(label: HTMLElement, fullPath: string) {
        const oldName = label.innerText;
        let settled = false;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = oldName;
        input.style.width = '100%';
        input.style.fontSize = '11px';
        input.style.textAlign = 'center';
        input.style.background = 'var(--unity-bg-input)';
        input.style.color = 'white';
        input.style.border = '1px solid var(--unity-accent)';
        input.style.padding = '0';
        input.style.margin = '0';

        const finish =  async() => {
            if (settled) return;
            settled = true;
            const newName = input.value.trim();
            if (newName && newName !== oldName) {
                const newPath = PathUtils.join(PathUtils.dirname(fullPath), newName);
                if (!await this.fs.exists(newPath)) {
                    try {
                        const renameImpactSummary = await this.getDeleteImpactSummary(fullPath);
                        const renameMessage = this.buildRenameConfirmationMessage(oldName, newName, renameImpactSummary);
                        if (renameMessage && !confirm(renameMessage)) {
                            await this.refresh();
                            return;
                        }
                        const referencePatches = await this.buildMoveReferencePatches(fullPath, newPath);
                        const isDirectory = (await this.fs.stat(fullPath)).isDirectory();
                        await this.executeAssetMutation('Rename Asset', {
                            operation: 'move', sourcePath: fullPath, targetPath: newPath,
                            assetKind: isDirectory ? 'directory' : 'file', contentBase64: null,
                            metadataBase64: null, referencePatches
                        });
                    } catch (err) {
                        console.error("Rename failed", err);
                    }
                }
            }
            await this.refreshAssetDatabaseAndView();
        };

        input.onblur = finish;
        input.onkeydown =  async(e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                await finish();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                settled = true;
                await this.refresh();
                requestAnimationFrame(() => {
                    const target = Array.from(document.querySelectorAll<HTMLElement>('.asset-item'))
                        .find((item) => item.dataset.assetPath && this.pathsEqual(item.dataset.assetPath, fullPath));
                    target?.focus();
                });
            }
        };

        label.innerHTML = '';
        label.appendChild(input);
        input.select();
        input.focus();
    }

    private createMenu(x: number, y: number): HTMLElement {
        const menu = document.createElement('div');
        menu.className = 'unity-context-menu';
        menu.style.position = 'fixed';
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.style.background = 'var(--unity-bg-panel)';
        menu.style.border = '1px solid var(--unity-border)';
        menu.style.boxShadow = '0 2px 10px rgba(0,0,0,0.3)';
        menu.style.zIndex = '10000';
        menu.style.minWidth = '160px';
        menu.style.padding = '2px 0';
        return menu;
    }

    private addMenuItem(menu: HTMLElement, label: string, onClick: () => void, color: string = 'var(--unity-text)') {
        const item = document.createElement('div');
        item.style.padding = '4px 12px';
        item.style.fontSize = '12px';
        item.style.color = color;
        item.style.cursor = 'pointer';
        item.innerText = label;
        item.onmouseenter = () => item.style.background = 'var(--unity-bg-selected)';
        item.onmouseleave = () => item.style.background = 'transparent';
        item.onclick = (e) => {
            e.stopPropagation();
            onClick();
            this.removeExistingMenus();
        };
        menu.appendChild(item);
    }

    private addMenuSeparator(menu: HTMLElement) {
        const sep = document.createElement('div');
        sep.style.height = '1px';
        sep.style.background = 'var(--unity-border)';
        sep.style.margin = '4px 0';
        menu.appendChild(sep);
    }

    private addMenuLabel(menu: HTMLElement, label: string, color: string = 'var(--unity-text-dim)') {
        const item = document.createElement('div');
        item.style.padding = '4px 12px';
        item.style.fontSize = '11px';
        item.style.color = color;
        item.style.cursor = 'default';
        item.style.pointerEvents = 'none';
        item.innerText = label;
        menu.appendChild(item);
    }

    private removeExistingMenus() {
        document.querySelectorAll('.unity-context-menu').forEach(m => m.remove());
    }

    private async createFileFromTemplate(name: string, ext: string) {
        let filename = name;
        if (!filename.endsWith('.' + ext)) filename += '.' + ext;

        let template = "";
        if (ext === 'ts') {
            template = `import { Component } from '../engine/Component';
import { serialize } from '../engine/Decorators';

export default class ${name} extends Component {
    @serialize
    public myNumber: number = 0;

    start() {
        console.log("${name} started!");
    }

    update(deltaTime: number) {
        // Update logic here
    }
}
`;
        }

        let target = PathUtils.join(this.currentPath, filename);
        if (await this.fs.exists(target)) {
            const base = PathUtils.basename(filename, '.' + ext);
            target = PathUtils.join(this.currentPath, `${base}_1.${ext}`);
        }

        await this.createAsset(target, 'file', new TextEncoder().encode(template));
    }

    private async getAllFilesRecursive(dir: string): Promise<any[]> {
        let results: any[] = [];
        const list = await this.fs.readdir(dir, { withFileTypes: true });
        for (const file of list) {
            const fullPath = PathUtils.join(dir, file.name);
            results.push({
                name: file.name,
                isDirectory: () => file.isDirectory(),
                fullPath: fullPath
            });
            if (file.isDirectory()) {
                results = results.concat(await this.getAllFilesRecursive(fullPath));
            }
        }
        return results;
    }
}

