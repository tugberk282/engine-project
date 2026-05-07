import { AssetIcons } from './AssetIcons';
import { PrefabManager } from '../engine/Prefab';
import { Material, MaterialManager } from '../engine/Material';
import { SceneManager } from '../engine/SceneManager';
import { Scene } from '../engine/Scene';
import { ScriptableObjectRegistry } from '../engine/ScriptableObject';
import { GameObject } from '../engine/GameObject';
import { ScriptRegistry } from '../engine/ScriptRegistry';
import { AssetDatabase, type AssetEntry, type AssetMeta, type AssetRefreshMove, type AssetRefreshResult } from '../engine/AssetDatabase';
import { AssetImporter } from '../engine/AssetImporter';
import { AudioSource } from '../engine/components/AudioSource';
import { DesktopFileSystem } from '../platform/DesktopFileSystem';
import { PathUtils } from '../platform/PathUtils';

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
    sampleIssues: AssetReferenceAuditIssue[];
}

export interface AssetDeleteImpactSummary {
    targetPath: string;
    targetIsDirectory: boolean;
    targetAssetCount: number;
    externalReferencerCount: number;
    externalReferencerPaths: string[];
}

interface Phase3ReadinessReport {
    scopePath: string;
    scopeAssetCount: number;
    runtimeCandidateCount: number;
    dependencyEdgeCount: number;
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
        moved: number;
    };
    assetTypeCounts: Record<string, number>;
    ready: boolean;
    blockers: string[];
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

    constructor(editor: any) {
        this.editor = editor;
        this.fs = new DesktopFileSystem();
    }

    public initialize() {
        if (!this.fs) return;

        this.rootPath = this.editor.rootPath;

        if (!this.fs.existsSync(this.rootPath)) {
            this.fs.mkdirSync(this.rootPath, { recursive: true });
        }

        this.currentPath = this.rootPath;
        this.expandedPaths.add(this.rootPath); // Always expand root
        this.refreshAssetDatabaseAndView();
    }

    public refresh() {
        if (!this.rootPath) {
            this.initialize();
            return;
        }

        const content = document.getElementById('assets-content');
        if (!content) return;
        content.innerHTML = '';

        const splitContainer = document.createElement('div');
        splitContainer.style.display = 'flex';
        splitContainer.style.height = '100%';
        splitContainer.style.width = '100%';

        // Left Pane (Folder Tree)
        const leftPane = document.createElement('div');
        leftPane.style.width = '200px';
        leftPane.style.minWidth = '150px';
        leftPane.style.borderRight = '1px solid var(--unity-border)';
        leftPane.style.background = 'var(--unity-bg-panel)';
        leftPane.style.display = 'flex';
        leftPane.style.flexDirection = 'column';
        leftPane.style.overflowY = 'auto';

        // Tree Content
        this.drawFolderTree(leftPane, this.rootPath, 0);

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
        upBtn.onclick = () => {
            if (this.currentPath !== this.rootPath) {
                this.currentPath = PathUtils.dirname(this.currentPath);
                this.refresh();
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
        filterSelect.onchange = () => {
            this.activeFilter = filterSelect.value;
            this.refresh();
        };
        toolbar.appendChild(filterSelect);

        // Search Input
        const searchContainer = document.createElement('div');
        searchContainer.style.flex = '1';
        searchContainer.style.position = 'relative';
        searchContainer.style.display = 'flex';
        searchContainer.style.alignItems = 'center';

        const searchInput = document.createElement('input');
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

        searchInput.oninput = () => {
            this.searchQuery = searchInput.value.toLowerCase();
            this.refresh();
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
            clearBtn.onclick = () => {
                this.searchQuery = "";
                this.refresh();
            };
            searchContainer.appendChild(clearBtn);
            searchInput.style.paddingRight = '20px';
        }
        searchInput.style.paddingLeft = '20px';

        toolbar.appendChild(searchContainer);

        rightPane.appendChild(toolbar);

        // Grid Container
        const grid = document.createElement('div');
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

        grid.ondrop = (e) => {
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
                        PrefabManager.savePrefab(go.name, go);

                        // Notify user and refresh
                        console.log(`Prefab ${go.name} created successfully.`);
                        this.refresh();
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
                files = this.getAllFilesRecursive(this.rootPath);
            } else {
                // Standard view of current folder
                files = this.fs.readdirSync(this.currentPath, { withFileTypes: true }).map((f: any) => ({
                    name: f.name,
                    isDirectory: () => f.isDirectory(),
                    fullPath: PathUtils.join(this.currentPath, f.name)
                }));
            }

            const createItem = (name: string, icon: string, isFolder: boolean, onDblClick: () => void, fullPath: string) => {
                const item = document.createElement('div');
                item.className = 'asset-item';
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
                }

                item.ondblclick = onDblClick;

                // Selection logic
                item.onclick = (e) => {
                    e.stopPropagation();
                    // Deselect others
                    grid.querySelectorAll('.asset-item').forEach((el: any) => el.style.background = 'transparent');
                    item.style.background = 'var(--unity-bg-selected)';
                    label.style.color = 'white';
                    footer.innerText = PathUtils.relative(PathUtils.dirname(this.rootPath), fullPath).replace(/\\/g, '/');
                    this.selectedAssetPath = fullPath;
                    this.editor.inspectorWindow.selectAsset(this.buildAssetSelection(fullPath, name, isFolder));
                };

                item.oncontextmenu = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.showItemContextMenu(e.clientX, e.clientY, name, fullPath, label);
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
                        name: name.split('.')[0],
                        filename: name,
                        fullPath: fullPath
                    }));
                    e.dataTransfer!.effectAllowed = 'copy';
                };

                return item;
            };

            // 1. Folders (Only show if no search/filter is active)
            files.filter((f: any) => f.isDirectory()).forEach((f: any) => {
                if (this.searchQuery) return; // Hide folders during global search
                if (this.activeFilter !== "All") return;

                const item = createItem(f.name, AssetIcons.Folder, true, () => {
                    this.currentPath = f.fullPath;
                    this.selectedAssetPath = f.fullPath;
                    this.editor.inspectorWindow.selectAsset(this.buildAssetSelection(f.fullPath, f.name, true));
                    this.refresh();
                }, f.fullPath);
                grid.appendChild(item);
            });

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

                const item = createItem(f.name, icon, false, () => {
                    if (ext === '.cs' || ext === '.ts') {
                        // Open in VSCode or script editor
                        console.log("Opening script:", fullPath);
                    } else if (ext === '.json' || ext === '.scene') {
                        SceneManager.getInstance().loadScene(fullPath).then((newScene) => {
                            this.editor.setScene(newScene);
                        });
                    } else if (ext === '.prefab') {
                        const prefab = PrefabManager.loadPrefabFromPath(fullPath);
                        if (prefab) {
                            const go = prefab.instantiate();
                            if (this.editor.scene) {
                                this.editor.scene.addGameObject(go);
                                this.editor.hierarchyWindow.refresh();
                            }
                        }
                    } else if (ext === '.mat') {
                        const mat = this.loadMaterialAsset(fullPath);
                        if (mat) {
                            this.editor.inspectorWindow.selectAsset(mat);
                        }
                    } else if (ext === '.scene') {
                        SceneManager.getInstance().loadScene(fullPath).then((newScene) => {
                            this.editor.setScene(newScene);
                        });
                    } else if (ext === '.asset') {
                        const asset = this.loadScriptableObjectAsset(fullPath);
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
                        <div class="editor-empty-state-title">No assets matched "${this.searchQuery}"</div>
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

        content.ondrop = (e) => {
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
                            this.savePrefabToFile(name, go);
                        }
                    }
                }
            } catch (err) { }
        };
    }

    public savePrefabToFile(name: string, go: GameObject) {
        PrefabManager.savePrefab(name, go);
        const prefab = PrefabManager.loadPrefab(name);
        if (prefab) {
            // Find if file already exists in Assets to overwrite same path
            let targetPath = this.findFileRecursive(this.rootPath, `${name}.prefab`);
            if (!targetPath) {
                targetPath = PathUtils.join(this.currentPath, `${name}.prefab`);
            }
            this.fs.writeFileSync(targetPath, prefab.toJSON(), 'utf8');
            this.refreshAssetDatabaseAndView({ focusAssetPath: targetPath });
            console.log(`Saved prefab to file: ${targetPath}`);
        }
    }

    public savePrefabInstanceToSource(go: GameObject): string | null {
        const targetPath = PrefabManager.savePrefabInstance(go);
        if (!targetPath) return null;
        this.refreshAssetDatabaseAndView({ focusAssetPath: targetPath });
        return targetPath;
    }

    public saveMaterialToFile(mat: Material) {
        if (!mat.assetPath) return;
        try {
            const data = JSON.stringify(mat.serialize(), null, 4);
            this.fs.writeFileSync(mat.assetPath, data, 'utf8');
            this.refreshAssetDatabaseAndView({ focusAssetPath: mat.assetPath });
        } catch (e) {
            console.error("Failed to save material to file:", e);
        }
    }

    public saveScriptableObject(so: any) {
        const targetPath = this.findFileRecursive(this.rootPath, `${so.assetName}.asset`);
        if (!targetPath) return;

        try {
            this.fs.writeFileSync(targetPath, so.toAssetJSON(), 'utf8');
            this.refreshAssetDatabaseAndView({ focusAssetPath: targetPath });
        } catch (e) {
            console.error('Failed to save ScriptableObject to file:', e);
        }
    }

    public updateAssetMeta(assetPath: string, updater: (meta: AssetMeta) => void): AssetMeta | null {
        const meta = AssetDatabase.getInstance().updateMeta(assetPath, (draft) => {
            updater(draft);
        });
        if (meta) {
            const runtimeAssetPaths = this.getRuntimeReimportPathsForAsset(assetPath, true);
            this.refreshAssetDatabaseAndView({ focusAssetPath: assetPath, runtimeAssetPaths });
        }
        return meta;
    }

    public reimportAsset(assetPath: string): ProjectAssetSelection | null {
        if (this.fs.existsSync(assetPath) && this.fs.statSync(assetPath).isDirectory()) {
            return this.reimportAssetScope(assetPath, false);
        }
        const runtimeAssetPaths = this.getRuntimeReimportPathsForAsset(assetPath, false);
        this.refreshAssetDatabaseAndView({ focusAssetPath: assetPath, runtimeAssetPaths });
        const selection = this.buildAssetSelection(assetPath, PathUtils.basename(assetPath), this.fs.statSync(assetPath).isDirectory());
        this.editor.inspectorWindow.selectAsset(selection);
        return selection;
    }

    public reimportAssetWithDependents(assetPath: string): ProjectAssetSelection | null {
        if (this.fs.existsSync(assetPath) && this.fs.statSync(assetPath).isDirectory()) {
            return this.reimportAssetScope(assetPath, true);
        }
        const runtimeAssetPaths = this.getRuntimeReimportPathsForAsset(assetPath, true);
        this.refreshAssetDatabaseAndView({ focusAssetPath: assetPath, runtimeAssetPaths });
        if (!this.fs.existsSync(assetPath)) return null;

        const selection = this.buildAssetSelection(assetPath, PathUtils.basename(assetPath), this.fs.statSync(assetPath).isDirectory());
        this.editor.inspectorWindow.selectAsset(selection);
        return selection;
    }

    public reimportAssetScope(scopePath: string, includeDependents: boolean): ProjectAssetSelection | null {
        if (!scopePath || !this.fs.existsSync(scopePath)) return null;

        const scopeAssets = this.collectAssetPathsWithinScope(scopePath).filter((assetPath) => this.isFileAssetPath(assetPath));
        const runtimePaths = new Set<string>();

        scopeAssets.forEach((assetPath) => {
            this.getRuntimeReimportPathsForAsset(assetPath, includeDependents)
                .forEach((pathValue) => runtimePaths.add(pathValue));
        });

        this.refreshAssetDatabaseAndView({
            focusAssetPath: scopePath,
            runtimeAssetPaths: Array.from(runtimePaths)
        });

        if (!this.fs.existsSync(scopePath)) return null;
        const isDirectory = this.fs.statSync(scopePath).isDirectory();
        const selection = this.buildAssetSelection(scopePath, PathUtils.basename(scopePath), isDirectory);
        this.editor.inspectorWindow.selectAsset(selection);
        return selection;
    }

    private getRuntimeReimportPathsForAsset(assetPath: string, includeDependents: boolean): string[] {
        if (!assetPath || !this.fs.existsSync(assetPath) || this.fs.statSync(assetPath).isDirectory()) return [];

        const runtimePaths = new Set<string>();
        if (this.isRuntimeRefreshCandidate(assetPath)) {
            runtimePaths.add(assetPath);
        }

        if (includeDependents) {
            AssetDatabase.getInstance().getReferencerClosurePaths(assetPath, false)
                .filter((pathValue) => this.isRuntimeRefreshCandidate(pathValue))
                .forEach((pathValue) => runtimePaths.add(pathValue));
        }

        return Array.from(runtimePaths);
    }

    public refreshAssetRuntime(assetPath: string) {
        this.refreshAssetDatabaseAndView({ preserveSelection: true, runtimeAssetPaths: [assetPath] });
    }

    public auditAssetReferences(assetPath: string): AssetReferenceAuditResult | null {
        const candidates = this.getReferenceAuditCandidatePaths(assetPath);
        if (candidates.length === 0) return null;
        return this.auditAndRepairReferenceFiles(candidates, false);
    }

    public repairAssetReferences(assetPath: string): AssetReferenceAuditResult | null {
        const candidates = this.getReferenceAuditCandidatePaths(assetPath);
        if (candidates.length === 0) return null;

        const result = this.auditAndRepairReferenceFiles(candidates, true);
        if (result.filesChanged > 0) {
            this.refreshAssetDatabaseAndView({
                focusAssetPath: this.fs.existsSync(assetPath) ? assetPath : null,
                preserveSelection: true
            });
        }
        return result;
    }

    public auditAllAssetReferences(): AssetReferenceAuditResult {
        return this.auditAndRepairReferenceFiles(this.getReferenceAuditCandidatePaths(), false);
    }

    public repairAllAssetReferences(): AssetReferenceAuditResult {
        const result = this.auditAndRepairReferenceFiles(this.getReferenceAuditCandidatePaths(), true);
        if (result.filesChanged > 0) {
            this.refreshAssetDatabaseAndView({ preserveSelection: true });
        }
        return result;
    }

    public runPhase3ReadinessCheck(scopePath?: string): Phase3ReadinessReport {
        const effectiveScopePath = scopePath && scopePath.length > 0 && this.fs.existsSync(scopePath)
            ? scopePath
            : this.rootPath;
        const refreshResult = this.refreshAssetDatabaseAndView({ preserveSelection: true });
        const scopeEntries = AssetDatabase.getInstance()
            .getAllEntries()
            .filter((entry) => this.isPathInsideScope(entry.path, effectiveScopePath) && this.isFileAssetPath(entry.path));
        const scopeAssetPaths = scopeEntries.map((entry) => entry.path);
        const referenceAudit = this.auditAndRepairReferenceFiles(this.getReferenceAuditCandidatePaths(effectiveScopePath), false);

        const scriptEntries = scopeEntries.filter((entry) => entry.meta.assetType === 'script');
        const scriptsWithCustomExecutionOrder = scriptEntries.filter((entry) => {
            const value = entry.meta.importer.settings.executionOrder;
            return typeof value === 'number' && Number.isFinite(value) && value !== 0;
        }).length;
        const scriptsAutoReferencedDisabled = scriptEntries.filter((entry) => entry.meta.importer.settings.autoReferenced === false).length;

        const runtimeCandidateCount = scopeAssetPaths.filter((assetPath) => this.isRuntimeRefreshCandidate(assetPath)).length;
        const dependencyEdgeCount = scopeAssetPaths.reduce((sum, assetPath) => sum + AssetDatabase.getInstance().getDependencyPaths(assetPath).length, 0);
        const assetTypeCounts = this.collectAssetTypeCounts(scopeEntries);

        const blockers: string[] = [];
        if (scopeAssetPaths.length === 0) {
            blockers.push('No file assets found in scope');
        }
        if (referenceAudit.unresolved > 0) {
            blockers.push(`Unresolved reference issues: ${referenceAudit.unresolved}`);
        }

        return {
            scopePath: effectiveScopePath,
            scopeAssetCount: scopeAssetPaths.length,
            runtimeCandidateCount,
            dependencyEdgeCount,
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
                moved: refreshResult.moved.length
            },
            assetTypeCounts,
            ready: blockers.length === 0,
            blockers
        };
    }

    public getDeleteImpactSummary(assetPath: string): AssetDeleteImpactSummary | null {
        if (!assetPath || !this.fs.existsSync(assetPath)) return null;

        const targetIsDirectory = this.fs.statSync(assetPath).isDirectory();
        const targetPaths = this.collectAssetPathsWithinScope(assetPath);
        if (targetPaths.length === 0) {
            return {
                targetPath: assetPath,
                targetIsDirectory,
                targetAssetCount: 0,
                externalReferencerCount: 0,
                externalReferencerPaths: []
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
        return {
            targetPath: assetPath,
            targetIsDirectory,
            targetAssetCount: targetPaths.length,
            externalReferencerCount: externalReferencerPaths.length,
            externalReferencerPaths
        };
    }

    public getAssetDependencyPaths(assetPath: string): string[] {
        return AssetDatabase.getInstance().getDependencyPaths(assetPath);
    }

    public getAssetReferencerPaths(assetPath: string): string[] {
        return AssetDatabase.getInstance().getReferencerPaths(assetPath);
    }

    public focusAssetByPath(assetPath: string): ProjectAssetSelection | null {
        if (!assetPath || !this.fs.existsSync(assetPath)) return null;

        const isDirectory = this.fs.statSync(assetPath).isDirectory();
        this.refreshAssetDatabaseAndView({ focusAssetPath: assetPath });
        const selection = this.buildAssetSelection(assetPath, PathUtils.basename(assetPath), isDirectory);
        this.editor.inspectorWindow.selectAsset(selection);
        return selection;
    }

    public highlightAsset(filename: string) {
        // 1. Find the file recursively
        const foundPath = this.findFileRecursive(this.rootPath, filename);

        if (foundPath) {
            // 2. Navigate to folder
            this.currentPath = PathUtils.dirname(foundPath);
            this.selectedAssetPath = foundPath;
            this.refresh();

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

    private findFileRecursive(dir: string, filename: string): string | null {
        try {
            const files = this.fs.readdirSync(dir, { withFileTypes: true });
            for (const file of files) {
                const fullPath = PathUtils.join(dir, file.name);
                if (file.isDirectory()) {
                    const found = this.findFileRecursive(fullPath, filename);
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

    public selectAssetByName(name: string) {
        this.highlightAsset(name);
    }

    private refreshAssetDatabaseAndView(options?: {
        focusAssetPath?: string | null;
        preserveSelection?: boolean;
        runtimeAssetPaths?: string[];
    }): AssetRefreshResult {
        const refreshResult = AssetDatabase.getInstance().refresh(this.rootPath);
        ScriptRegistry.refreshScriptExecutionOrderFromAssetDatabase();
        if (refreshResult.moved.length > 0) {
            this.applyMovedAssetReferenceEffects(refreshResult.moved);
        }
        const nextSelectionPath = this.resolveSelectionPathAfterRefresh(refreshResult, options?.focusAssetPath, options?.preserveSelection);

        if (nextSelectionPath && this.fs.existsSync(nextSelectionPath)) {
            this.selectedAssetPath = nextSelectionPath;
            const isDirectory = this.fs.statSync(nextSelectionPath).isDirectory();
            this.currentPath = isDirectory ? nextSelectionPath : PathUtils.dirname(nextSelectionPath);
        } else if (options?.focusAssetPath === null || (this.selectedAssetPath && !this.fs.existsSync(this.selectedAssetPath))) {
            this.selectedAssetPath = null;
        }

        this.refresh();
        if (options?.runtimeAssetPaths?.length) {
            Array.from(new Set(options.runtimeAssetPaths))
                .filter((assetPath) => typeof assetPath === 'string' && assetPath.length > 0)
                .forEach((assetPath) => this.applyRuntimeReimportEffects(assetPath));
        }

        if (this.selectedAssetPath && this.fs.existsSync(this.selectedAssetPath)) {
            const assetName = PathUtils.basename(this.selectedAssetPath);
            const isFolder = this.fs.statSync(this.selectedAssetPath).isDirectory();
            this.editor.inspectorWindow.selectAsset(this.buildAssetSelection(this.selectedAssetPath, assetName, isFolder));
        }

        return refreshResult;
    }

    private resolveSelectionPathAfterRefresh(
        refreshResult: AssetRefreshResult,
        focusAssetPath?: string | null,
        preserveSelection: boolean = true
    ): string | null {
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
        if (entry || this.fs.existsSync(this.selectedAssetPath)) {
            return this.selectedAssetPath;
        }

        return null;
    }

    private getAssetEntry(assetPath: string): AssetEntry | null {
        return AssetDatabase.getInstance().getEntry(assetPath) ?? null;
    }

    private buildAssetSelection(assetPath: string, assetName: string, isFolder: boolean): ProjectAssetSelection {
        const entry = this.getAssetEntry(assetPath);
        const extension = isFolder ? '' : PathUtils.extname(assetPath).toLowerCase();

        return {
            kind: 'asset',
            name: assetName,
            path: assetPath,
            extension,
            meta: entry?.meta ?? AssetDatabase.getInstance().getMeta(assetPath)!,
            payload: isFolder ? null : this.loadAssetPayload(assetPath, extension)
        };
    }

    private loadAssetPayload(fullPath: string, extension: string): any | null {
        if (extension === '.mat') {
            return this.loadMaterialAsset(fullPath);
        }

        if (extension === '.asset') {
            return this.loadScriptableObjectAsset(fullPath);
        }

        return null;
    }

    private loadMaterialAsset(fullPath: string): Material | null {
        const nameKey = PathUtils.basename(fullPath, PathUtils.extname(fullPath));
        const cached = MaterialManager.getMaterial(nameKey);

        try {
            const data = JSON.parse(this.fs.readFileSync(fullPath, 'utf8'));
            const material = cached ?? Material.deserialize(data);
            this.applyMaterialAssetData(material, data, fullPath);
            if (!cached) {
                MaterialManager.registerMaterial(material);
            }
            return material;
        } catch (e) {
            console.warn('Failed to load material asset:', e);
            return null;
        }
    }

    private loadScriptableObjectAsset(fullPath: string): any | null {
        try {
            const json = this.fs.readFileSync(fullPath, 'utf8');
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

    private applyRuntimeReimportEffects(assetPath: string) {
        const meta = AssetDatabase.getInstance().getMeta(assetPath);
        if (!meta) return;

        if (meta.assetType === 'texture') {
            this.reloadMaterialTextureReferences(assetPath);
        } else if (meta.assetType === 'material') {
            this.loadMaterialAsset(assetPath);
        } else if (meta.assetType === 'audio') {
            AssetImporter.invalidateAudioCache(assetPath);
            this.reloadAudioSourcesForAsset(assetPath);
        } else if (meta.assetType === 'prefab') {
            this.reloadPrefabInstancesForAsset(assetPath);
        } else if (meta.assetType === 'model') {
            this.reloadModelInstancesForAsset(assetPath);
            this.reloadAnimatorClipsForAsset(assetPath);
        }

        this.editor.hierarchyWindow.refresh();
        this.editor.inspectorWindow.refresh();
    }

    private applyMaterialAssetData(material: Material, data: any, fullPath: string) {
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

        this.loadTextureReference(data.mainTexturePath, data.mainTextureGuid, (texture) => material.setTextureSilently('mainTexture', texture));
        this.loadTextureReference(data.normalMapPath, data.normalMapGuid, (texture) => material.setTextureSilently('normalMap', texture));
        this.loadTextureReference(data.metallicMapPath, data.metallicMapGuid, (texture) => material.setTextureSilently('metallicMap', texture));
        this.loadTextureReference(data.roughnessMapPath, data.roughnessMapGuid, (texture) => material.setTextureSilently('roughnessMap', texture));
    }

    private loadTextureReference(
        reference: string | null | undefined,
        guid: string | null | undefined,
        assign: (texture: any | null) => void
    ) {
        const resolvedPath = this.resolveTextureReference(reference, guid);
        if (!resolvedPath) {
            assign(null);
            return;
        }

        AssetImporter.importTexture(resolvedPath, (texture) => {
            assign(texture);
        });
    }

    private resolveTextureReference(reference: string | null | undefined, guid?: string | null): string | null {
        if (guid) {
            const guidPath = AssetDatabase.getInstance().getPath(guid);
            if (guidPath) return guidPath;
        }
        if (!reference || typeof reference !== 'string') return null;
        if (this.fs.existsSync(reference)) return reference;

        const directMatch = this.findFileRecursive(this.rootPath, PathUtils.basename(reference));
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
        MaterialManager.getAllMaterials().forEach((material) => {
            this.reloadMaterialTextureSlot(material, 'mainTexture', assetPath, (texture) => material.setMainTexture(texture));
            this.reloadMaterialTextureSlot(material, 'normalMap', assetPath, (texture) => material.setNormalMap(texture));
            this.reloadMaterialTextureSlot(material, 'metallicMap', assetPath, (texture) => material.setMetallicMap(texture));
            this.reloadMaterialTextureSlot(material, 'roughnessMap', assetPath, (texture) => material.setRoughnessMap(texture));
        });
    }

    private reloadMaterialTextureSlot(
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

        AssetImporter.importTexture(assetPath, (reimportedTexture) => {
            assign(reimportedTexture);
        });
    }

    private reloadAudioSourcesForAsset(assetPath: string) {
        const normalizedAssetPath = this.normalizeAssetPath(assetPath);
        const assetGuid = AssetDatabase.getInstance().getGuid(assetPath) ?? null;
        this.editor.scene.gameObjects.forEach((go: GameObject) => {
            go.getComponents(AudioSource).forEach((source) => {
                const matchesByPath = !!source.clipPath && this.pathsEqual(source.clipPath, normalizedAssetPath);
                const matchesByGuid = !!assetGuid && source.clipGuid === assetGuid;
                if (!matchesByPath && !matchesByGuid) return;
                source.loadClip(normalizedAssetPath);
            });
        });
    }

    private reloadPrefabInstancesForAsset(assetPath: string) {
        const prefab = PrefabManager.loadPrefabFromPath(assetPath);
        if (!prefab) return;
        const assetGuid = AssetDatabase.getInstance().getGuid(assetPath) ?? null;
        const importerSettings = this.getImporterSettings(assetPath, 'prefab');
        const autoReconnect = importerSettings.autoReconnect !== false;
        const preserveOverrides = importerSettings.preserveOverrides !== false;
        if (!autoReconnect) return;
        const prefabName = PathUtils.basename(assetPath, PathUtils.extname(assetPath));

        this.editor.scene.gameObjects.forEach((go: GameObject) => {
            const matchesByPath = !!go.sourceAssetPath && this.pathsEqual(go.sourceAssetPath, assetPath);
            const matchesByGuid = !!assetGuid && go.sourceAssetGuid === assetGuid;
            if (go.sourceAssetType !== 'prefab' || (!matchesByPath && !matchesByGuid)) return;
            if (preserveOverrides) {
                go.sourceAssetPath = assetPath;
                go.sourceAssetGuid = assetGuid;
                go.sourceAssetType = 'prefab';
                go.prefabSource = prefabName;
                return;
            }

            PrefabManager.revertToPrefab(go);
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

        targets.forEach((target: GameObject) => {
            AssetImporter.importModel(assetPath, (importedGO) => {
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
        this.editor.scene.gameObjects.forEach((go: GameObject) => {
            go.components.forEach((component: any) => {
                if (component.constructor?.name !== 'Animator') return;
                const matchesByPath = !!component.modelPath && this.pathsEqual(component.modelPath, normalizedAssetPath);
                const matchesByGuid = !!assetGuid && component.modelGuid === assetGuid;
                if (!matchesByPath && !matchesByGuid) return;
                component.animations.clear();
                component.loadModelClips(normalizedAssetPath);
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

        materialPaths.forEach((assetPath) => {
            this.patchJsonAssetFile(assetPath, (data) => this.patchMaterialAssetDataReferences(data, movedEntries, movedByGuid));
        });

        scenePaths.forEach((assetPath) => {
            this.patchJsonAssetFile(assetPath, (data) => this.patchSceneAssetDataReferences(data, movedEntries, movedByGuid));
        });

        prefabPaths.forEach((assetPath) => {
            this.patchJsonAssetFile(assetPath, (data) => this.patchPrefabAssetDataReferences(data, movedEntries, movedByGuid));
        });

        scriptableObjectPaths.forEach((assetPath) => {
            this.patchJsonAssetFile(assetPath, (data) => this.patchGenericAssetDataReferences(data, movedEntries, movedByGuid));
        });
    }

    private patchJsonAssetFile(assetPath: string, patcher: (data: any) => boolean): void {
        if (!this.fs || !this.fs.existsSync(assetPath)) return;

        try {
            const raw = this.fs.readFileSync(assetPath, 'utf8');
            const data = JSON.parse(raw);
            const changed = patcher(data);
            if (!changed) return;
            this.fs.writeFileSync(assetPath, JSON.stringify(data, null, 2), 'utf8');
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

    private getDuplicateTargetPath(fullPath: string): string {
        const isDirectory = this.fs.statSync(fullPath).isDirectory();
        const dir = PathUtils.dirname(fullPath);
        const ext = isDirectory ? '' : PathUtils.extname(fullPath);
        const baseName = isDirectory ? PathUtils.basename(fullPath) : PathUtils.basename(fullPath, ext);
        let index = 1;

        while (true) {
            const suffix = index === 1 ? ' (Copy)' : ` (Copy ${index})`;
            const candidate = PathUtils.join(dir, `${baseName}${suffix}${ext}`);
            if (!this.fs.existsSync(candidate)) {
                return candidate;
            }
            index += 1;
        }
    }

    private copyDirectoryWithoutMeta(sourcePath: string, targetPath: string) {
        this.fs.mkdirSync(targetPath, { recursive: true });
        const entries = this.fs.readdirSync(sourcePath, { withFileTypes: true });

        for (const entry of entries) {
            if (entry.name.endsWith('.meta')) continue;

            const sourceEntryPath = PathUtils.join(sourcePath, entry.name);
            const targetEntryPath = PathUtils.join(targetPath, entry.name);

            if (entry.isDirectory()) {
                this.copyDirectoryWithoutMeta(sourceEntryPath, targetEntryPath);
            } else {
                this.fs.copyFileSync(sourceEntryPath, targetEntryPath);
            }
        }
    }

    private duplicateAsset(fullPath: string) {
        const targetPath = this.getDuplicateTargetPath(fullPath);
        const stat = this.fs.statSync(fullPath);

        if (stat.isDirectory()) {
            this.copyDirectoryWithoutMeta(fullPath, targetPath);
        } else {
            this.fs.copyFileSync(fullPath, targetPath);
        }

        this.refreshAssetDatabaseAndView();
    }

    private drawFolderTree(parent: HTMLElement, path: string, indent: number) {
        // Read directory safely
        let entries: any[] = [];
        try {
            entries = this.fs.readdirSync(path, { withFileTypes: true });
        } catch (e) {
            return;
        }

        const folders = entries.filter(e => e.isDirectory());
        const name = PathUtils.basename(path) || 'Assets';

        // Tree Item Interaction
        const item = document.createElement('div');
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
        arrow.onclick = (e) => {
            e.stopPropagation();
            if (folders.length > 0) {
                if (this.expandedPaths.has(path)) this.expandedPaths.delete(path);
                else this.expandedPaths.add(path);
                this.refresh();
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

        item.onclick = () => {
            this.currentPath = path;
            this.editor.inspectorWindow.selectAsset(this.buildAssetSelection(path, name, true));
            this.refresh();
        };

        item.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showItemContextMenu(e.clientX, e.clientY, name, path, label);
        };

        parent.appendChild(item);

        // Recursive Children
        if (this.expandedPaths.has(path)) {
            folders.forEach(f => {
                this.drawFolderTree(parent, PathUtils.join(path, f.name), indent + 1);
            });
        }
    }

    private showContextMenu(x: number, y: number) {
        this.removeExistingMenus();
        const menu = this.createMenu(x, y);

        this.addMenuItem(menu, 'Create Folder', () => {
            const name = prompt("Folder Name", "New Folder");
            if (name) {
                const p = PathUtils.join(this.currentPath, name);
                if (!this.fs.existsSync(p)) this.fs.mkdirSync(p);
                this.refreshAssetDatabaseAndView();
            }
        });

        this.addMenuItem(menu, 'Create Script', () => {
            const name = prompt("Script Name", "NewScript");
            if (name) {
                this.createFileFromTemplate(name, 'ts');
            }
        });

        this.addMenuItem(menu, 'Create Material', () => {
            const name = prompt("Material Name", "NewMaterial");
            if (name) {
                const mat = new Material(name);
                const p = PathUtils.join(this.currentPath, `${name}.mat`);
                this.fs.writeFileSync(p, JSON.stringify(mat.serialize(), null, 4));
                this.refreshAssetDatabaseAndView();
            }
        });

        this.addMenuItem(menu, 'Create Scene', () => {
            const name = prompt("Scene Name", "NewScene");
            if (name) {
                const scene = new Scene();
                const p = PathUtils.join(this.currentPath, `${name}.scene`);
                this.fs.writeFileSync(p, scene.toJSON(), 'utf8');
                this.refreshAssetDatabaseAndView();
            }
        });

        // ScriptableObject submenu
        const soTypes = ScriptableObjectRegistry.getTypeNames();
        if (soTypes.length > 0) {
            this.addMenuSeparator(menu);
            soTypes.forEach(typeName => {
                this.addMenuItem(menu, `Create ${typeName}`, () => {
                    const name = prompt(`${typeName} Name`, typeName);
                    if (!name) return;
                    const Ctor = ScriptableObjectRegistry.get(typeName)!;
                    const instance = new Ctor();
                    instance.assetName = name;
                    const p = PathUtils.join(this.currentPath, `${name}.asset`);
                    this.fs.writeFileSync(p, instance.toAssetJSON(), 'utf8');
                    this.refreshAssetDatabaseAndView();
                });
            });
        }

        this.addMenuSeparator(menu);
        this.addMenuItem(menu, 'Validate References (All)', () => {
            const result = this.auditAllAssetReferences();
            alert(this.formatReferenceAuditSummary(result, 'Reference Validation (All)'));
        });
        this.addMenuItem(menu, 'Auto Repair References (All)', () => {
            const result = this.repairAllAssetReferences();
            alert(this.formatReferenceAuditSummary(result, 'Reference Auto Repair (All)'));
        });
        this.addMenuItem(menu, 'Phase 3 Readiness (Project)', () => {
            const report = this.runPhase3ReadinessCheck(this.rootPath);
            alert(this.formatPhase3ReadinessSummary(report, 'Phase 3 Readiness (Project)'));
        });
        this.addMenuItem(menu, 'Phase 3 Readiness (Current Folder)', () => {
            const report = this.runPhase3ReadinessCheck(this.currentPath);
            alert(this.formatPhase3ReadinessSummary(report, 'Phase 3 Readiness (Current Folder)'));
        });
        this.addMenuItem(menu, 'Reimport Current Folder', () => {
            this.reimportAssetScope(this.currentPath, false);
        });
        this.addMenuItem(menu, 'Reimport Current Folder + Dependents', () => {
            this.reimportAssetScope(this.currentPath, true);
        });
        this.addMenuItem(menu, 'Show Current Folder Impact', () => {
            const summary = this.getDeleteImpactSummary(this.currentPath);
            if (!summary) {
                alert('Impact summary is not available for current folder.');
                return;
            }
            alert(this.formatDeleteImpactSummary(summary, 'Delete Impact (Current Folder)'));
        });

        this.addMenuSeparator(menu);
        this.addMenuItem(menu, 'Refresh', () => this.refreshAssetDatabaseAndView());

        document.body.appendChild(menu);
        setTimeout(() => document.addEventListener('click', () => this.removeExistingMenus(), { once: true }), 0);
    }

    private showItemContextMenu(x: number, y: number, name: string, fullPath: string, labelElement: HTMLElement) {
        this.removeExistingMenus();
        const menu = this.createMenu(x, y);
        const isDirectory = this.fs.statSync(fullPath).isDirectory();

        if (!isDirectory) {
            this.addMenuItem(menu, 'Reimport', () => {
                this.reimportAsset(fullPath);
            });
            this.addMenuItem(menu, 'Reimport + Dependents', () => {
                this.reimportAssetWithDependents(fullPath);
            });
            this.addMenuSeparator(menu);
        } else {
            this.addMenuItem(menu, 'Reimport Folder', () => {
                this.reimportAssetScope(fullPath, false);
            });
            this.addMenuItem(menu, 'Reimport Folder + Dependents', () => {
                this.reimportAssetScope(fullPath, true);
            });
            this.addMenuSeparator(menu);
        }

        this.addMenuItem(menu, isDirectory ? 'Validate References in Folder' : 'Validate References', () => {
            const result = this.auditAssetReferences(fullPath);
            if (!result) {
                alert('No auditable assets were found in this scope.');
                return;
            }
            alert(this.formatReferenceAuditSummary(result, 'Reference Validation'));
        });
        this.addMenuItem(menu, isDirectory ? 'Auto Repair References in Folder' : 'Auto Repair References', () => {
            const result = this.repairAssetReferences(fullPath);
            if (!result) {
                alert('No auditable assets were found in this scope.');
                return;
            }
            alert(this.formatReferenceAuditSummary(result, 'Reference Auto Repair'));
        });
        this.addMenuItem(menu, isDirectory ? 'Phase 3 Readiness in Folder' : 'Phase 3 Readiness for Asset', () => {
            const report = this.runPhase3ReadinessCheck(fullPath);
            alert(this.formatPhase3ReadinessSummary(report, 'Phase 3 Readiness'));
        });
        this.addMenuItem(menu, 'Show Dependency Impact', () => {
            const summary = this.getDeleteImpactSummary(fullPath);
            if (!summary) {
                alert('Impact summary is not available for this selection.');
                return;
            }
            alert(this.formatDeleteImpactSummary(summary, 'Delete Impact'));
        });
        this.addMenuSeparator(menu);

        this.addMenuItem(menu, 'Duplicate', () => {
            this.duplicateAsset(fullPath);
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

        this.addMenuItem(menu, 'Delete', () => {
            const impactSummary = this.getDeleteImpactSummary(fullPath);
            if (confirm(this.buildDeleteConfirmationMessage(name, impactSummary))) {
                if (isDirectory) {
                    this.fs.rmSync(fullPath, { recursive: true, force: true });
                    const metaPath = fullPath + '.meta';
                    if (this.fs.existsSync(metaPath)) this.fs.unlinkSync(metaPath);
                } else {
                    this.fs.unlinkSync(fullPath);
                    const metaPath = fullPath + '.meta';
                    if (this.fs.existsSync(metaPath)) this.fs.unlinkSync(metaPath);
                }
                this.refreshAssetDatabaseAndView();
            }
        }, '#ff6b6b');

        document.body.appendChild(menu);
        setTimeout(() => document.addEventListener('click', () => this.removeExistingMenus(), { once: true }), 0);
    }

    private isRuntimeRefreshCandidate(assetPath: string): boolean {
        if (!assetPath || typeof assetPath !== 'string') return false;
        if (!this.fs.existsSync(assetPath)) return false;

        try {
            if (this.fs.statSync(assetPath).isDirectory()) return false;
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

    private isFileAssetPath(assetPath: string): boolean {
        if (!assetPath || !this.fs.existsSync(assetPath)) return false;
        try {
            return !this.fs.statSync(assetPath).isDirectory();
        } catch {
            return false;
        }
    }

    private getReferenceAuditCandidatePaths(scopePath?: string): string[] {
        const allAuditable = AssetDatabase.getInstance()
            .getAllEntries()
            .filter((entry) => this.isReferenceAuditAssetType(entry.meta.assetType))
            .map((entry) => entry.path)
            .sort((left, right) => left.localeCompare(right));

        if (!scopePath || scopePath.length === 0) {
            return allAuditable;
        }

        if (!this.fs.existsSync(scopePath)) {
            return [];
        }

        const stat = this.fs.statSync(scopePath);
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
            sampleIssues: []
        };
    }

    private auditAndRepairReferenceFiles(assetPaths: string[], applyFixes: boolean): AssetReferenceAuditResult {
        const result = this.createEmptyReferenceAuditResult();
        if (!this.fs || assetPaths.length === 0) return result;

        assetPaths.forEach((assetPath) => {
            this.auditAndRepairReferenceFile(assetPath, applyFixes, result);
        });
        return result;
    }

    private auditAndRepairReferenceFile(assetPath: string, applyFixes: boolean, result: AssetReferenceAuditResult): void {
        if (!this.fs || !this.fs.existsSync(assetPath) || this.fs.statSync(assetPath).isDirectory()) return;

        try {
            const raw = this.fs.readFileSync(assetPath, 'utf8');
            const data = JSON.parse(raw);
            result.scannedAssets += 1;

            const changed = this.auditAndRepairReferenceNode(data, assetPath, '$', applyFixes, result);
            if (changed) {
                this.fs.writeFileSync(assetPath, JSON.stringify(data, null, 2), 'utf8');
                result.filesChanged += 1;
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
            const inferredPath = this.findUniqueAssetPathByBaseName(normalizedPath);
            const inferredGuid = inferredPath ? (AssetDatabase.getInstance().getGuid(inferredPath) ?? null) : null;
            if (inferredPath && inferredGuid) {
                return {
                    reason: 'inferred-by-name',
                    fixable: true,
                    suggestedPath: inferredPath,
                    suggestedGuid: inferredGuid
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

    private findUniqueAssetPathByBaseName(referencePath: string): string | null {
        const refExt = PathUtils.extname(referencePath).toLowerCase();
        const refBase = PathUtils.basename(referencePath, refExt || undefined).toLowerCase();
        if (!refBase) return null;

        const candidates = AssetDatabase.getInstance()
            .getAllEntries()
            .filter((entry) => {
                const entryExt = PathUtils.extname(entry.path).toLowerCase();
                if (refExt && entryExt !== refExt) return false;
                const entryBase = PathUtils.basename(entry.path, entryExt || undefined).toLowerCase();
                return entryBase === refBase;
            })
            .map((entry) => entry.path);

        return candidates.length === 1 ? candidates[0] : null;
    }

    private collectAssetTypeCounts(entries: AssetEntry[]): Record<string, number> {
        const counts: Record<string, number> = {};
        entries.forEach((entry) => {
            const key = entry.meta.assetType;
            counts[key] = (counts[key] ?? 0) + 1;
        });
        return counts;
    }

    private formatPhase3ReadinessSummary(report: Phase3ReadinessReport, label: string): string {
        const typeLines = Object.entries(report.assetTypeCounts)
            .sort((left, right) => left[0].localeCompare(right[0]))
            .map(([assetType, count]) => `${assetType}: ${count}`)
            .join('\n');
        const blockers = report.blockers.length > 0
            ? report.blockers.join('\n')
            : 'None';

        return `${label}\nScope: ${report.scopePath}\nReady: ${report.ready ? 'YES' : 'NO'}\n\nScope Assets: ${report.scopeAssetCount}\nRuntime Candidates: ${report.runtimeCandidateCount}\nDependency Edges: ${report.dependencyEdgeCount}\nScripts: ${report.scriptCount}\nScripts with custom executionOrder: ${report.scriptsWithCustomExecutionOrder}\nScripts with autoReferenced=false: ${report.scriptsAutoReferencedDisabled}\n\nRefresh Scan: ${report.refreshSummary.scannedCount}\nRefresh Added: ${report.refreshSummary.added}\nRefresh Removed: ${report.refreshSummary.removed}\nRefresh Changed: ${report.refreshSummary.changed}\nRefresh Meta Changed: ${report.refreshSummary.metaChanged}\nRefresh Moved: ${report.refreshSummary.moved}\n\nReference Issues: ${report.referenceAudit.issues}\nReference Fixable: ${report.referenceAudit.fixable}\nReference Unresolved: ${report.referenceAudit.unresolved}\n\nAsset Types:\n${typeLines || 'None'}\n\nBlockers:\n${blockers}`;
    }

    private formatReferenceAuditSummary(result: AssetReferenceAuditResult, label: string): string {
        return `${label}\nScanned Assets: ${result.scannedAssets}\nScanned References: ${result.scannedPairs}\nIssues: ${result.issues}\nFixable: ${result.fixable}\nFixed: ${result.fixed}\nUnresolved: ${result.unresolved}\nChanged Files: ${result.filesChanged}`;
    }

    private collectAssetPathsWithinScope(scopePath: string): string[] {
        if (!scopePath || !this.fs.existsSync(scopePath)) return [];

        const stat = this.fs.statSync(scopePath);
        if (!stat.isDirectory()) {
            return this.fs.existsSync(scopePath) ? [scopePath] : [];
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
        return `${label}\nTarget Assets: ${summary.targetAssetCount}\nExternal Referencers: ${summary.externalReferencerCount}${sampleLines}${moreLine}`;
    }

    private buildDeleteConfirmationMessage(name: string, summary: AssetDeleteImpactSummary | null): string {
        if (!summary) {
            return `Are you sure you want to delete '${name}'?`;
        }

        if (summary.externalReferencerCount === 0) {
            return `Delete '${name}'?\nTarget Assets: ${summary.targetAssetCount}\nNo external references detected.`;
        }

        const sample = summary.externalReferencerPaths.slice(0, 6);
        const sampleLines = sample.length > 0
            ? `\nAffected:\n${sample.join('\n')}`
            : '';
        const moreCount = summary.externalReferencerCount - sample.length;
        const moreLine = moreCount > 0 ? `\n(+${moreCount} more)` : '';
        return `Delete '${name}'?\nWARNING: ${summary.externalReferencerCount} external asset(s) reference this scope.${sampleLines}${moreLine}`;
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
            this.addMenuItem(menu, `  ${fileName} - ${folderName}`, () => {
                this.focusAssetByPath(assetPath);
            });
        });

        if (assetPaths.length > maxVisible) {
            this.addMenuLabel(menu, `  +${assetPaths.length - maxVisible} more in Inspector`, 'var(--unity-text-dim)');
        }
    }

    private startInlineRename(label: HTMLElement, fullPath: string) {
        const oldName = label.innerText;
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

        const finish = () => {
            const newName = input.value.trim();
            if (newName && newName !== oldName) {
                const newPath = PathUtils.join(PathUtils.dirname(fullPath), newName);
                if (!this.fs.existsSync(newPath)) {
                    try {
                        this.fs.renameSync(fullPath, newPath);
                        const oldMeta = fullPath + '.meta';
                        const newMeta = newPath + '.meta';
                        if (this.fs.existsSync(oldMeta)) this.fs.renameSync(oldMeta, newMeta);
                    } catch (err) {
                        console.error("Rename failed", err);
                    }
                }
            }
            this.refreshAssetDatabaseAndView();
        };

        input.onblur = finish;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') finish();
            if (e.key === 'Escape') this.refresh();
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

    private createFileFromTemplate(name: string, ext: string) {
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
        if (this.fs.existsSync(target)) {
            const base = PathUtils.basename(filename, '.' + ext);
            target = PathUtils.join(this.currentPath, `${base}_1.${ext}`);
        }

        this.fs.writeFileSync(target, template);
        this.refreshAssetDatabaseAndView();
    }

    private getAllFilesRecursive(dir: string): any[] {
        let results: any[] = [];
        const list = this.fs.readdirSync(dir, { withFileTypes: true });
        for (const file of list) {
            const fullPath = PathUtils.join(dir, file.name);
            results.push({
                name: file.name,
                isDirectory: () => file.isDirectory(),
                fullPath: fullPath
            });
            if (file.isDirectory()) {
                results = results.concat(this.getAllFilesRecursive(fullPath));
            }
        }
        return results;
    }
}

