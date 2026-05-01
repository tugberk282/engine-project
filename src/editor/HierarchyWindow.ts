import { EditorWindow } from './EditorWindow';
import { GameObject } from '../engine/GameObject';
import { Scene } from '../engine/Scene';
import { Camera } from '../engine/components/Camera';
import { Light, LightType } from '../engine/components/Light';
import { MeshRenderer } from '../engine/components/MeshRenderer';
import { MeshFilter } from '../engine/components/MeshFilter';
import { ParticleSystem } from '../engine/components/ParticleSystem';
import { AudioSource } from '../engine/components/AudioSource';
import { Canvas } from '../engine/components/Canvas';
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
import { PathUtils } from '../platform/PathUtils';
import { CommandHistory, GroupCommand } from './Command';
import { ScriptRegistry } from '../engine/ScriptRegistry';
import { CreateGameObjectCommand, DeleteGameObjectCommand, RenameGameObjectCommand, ReparentGameObjectCommand } from './LifecycleCommands';

export class HierarchyWindow extends EditorWindow {
    private scene: Scene;
    private onSelect: (go: GameObject) => void;
    private collapsedNodes: Set<string> = new Set(); // IDs of collapsed GOs
    private lastClickedNodeId: string | null = null;
    private keyboardRangeAnchorId: string | null = null;

    constructor(parent: HTMLElement, scene: Scene, onSelect: (go: GameObject) => void) {
        super(parent, "Hierarchy");
        this.scene = scene;
        this.onSelect = onSelect;
        this.refresh();
    }

    public onGUI(): void {
        const content = this.getContentArea();
        content.innerHTML = `
            <div class="hierarchy-toolbar">
                <input type="text" id="hierarchy-search" placeholder="Search..." class="unity-input">
                <button id="hierarchy-add-btn" class="unity-button" title="Create GameObject">+</button>
            </div>
            <div id="hierarchy-content" class="hierarchy-list"></div>
        `;

        const searchInput = content.querySelector('#hierarchy-search') as HTMLInputElement;
        searchInput.oninput = () => this.refreshList();

        const addBtn = content.querySelector('#hierarchy-add-btn') as HTMLElement;
        addBtn.onclick = (e) => {
            e.stopPropagation();
            this.showCreateMenu(e.clientX, e.clientY, null);
        };

        // Right-click on empty space = create at root
        const listEl = content.querySelector('#hierarchy-content') as HTMLElement;
        listEl.tabIndex = 0;
        listEl.onkeydown = (e) => this.handleListKeyDown(e);
        listEl.oncontextmenu = (e) => {
            if (e.target === listEl) {
                e.preventDefault();
                this.showCreateMenu(e.clientX, e.clientY, null);
            }
        };

        // Click on empty space = deselect
        listEl.onclick = (e) => {
            if (e.target === listEl) {
                // @ts-ignore
                window.Editor?.instance?.selectGameObjectPublic?.(null);
                this.lastClickedNodeId = null;
                this.keyboardRangeAnchorId = null;
                this.refreshList();
            }
        };

        // Drag-drop onto empty hierarchy area => move to scene root (unparent)
        listEl.ondragover = (e) => {
            e.preventDefault();
            if (e.target !== listEl) return;
            listEl.style.background = 'rgba(50, 103, 171, 0.12)';
        };
        listEl.ondragleave = () => {
            listEl.style.background = 'transparent';
        };
        listEl.ondrop = (e) => {
            e.preventDefault();
            listEl.style.background = 'transparent';
            if (e.target !== listEl) return;
            try {
                const payload = JSON.parse(e.dataTransfer?.getData('text/plain') ?? '{}');
                if (payload.type !== 'gameobject') return;
                const sourceIds = Array.isArray(payload.ids)
                    ? payload.ids.filter((id: unknown): id is string => typeof id === 'string')
                    : (typeof payload.id === 'string' ? [payload.id] : []);
                const dragged = sourceIds
                    .map((id: string) => this.scene.gameObjects.find((entry: GameObject) => entry.id === id))
                    .filter((entry: GameObject | undefined): entry is GameObject => !!entry);
                const topLevelDragged = this.getTopLevelDraggedSources(dragged);

                const reparentCommands = topLevelDragged
                    .filter((sourceGO) => sourceGO.transform.parent !== null)
                    .map((sourceGO) => new ReparentGameObjectCommand(sourceGO, null));
                if (reparentCommands.length === 0) return;

                if (reparentCommands.length === 1) {
                    CommandHistory.execute(reparentCommands[0]);
                } else {
                    CommandHistory.execute(new GroupCommand(`Unparent ${reparentCommands.length} objects`, reparentCommands));
                }
                this.refreshList();
            } catch {
                // no-op: ignore invalid drag payload
            }
        };

        this.refreshList();
    }

    public setScene(scene: any): void {
        this.scene = scene;
        this.collapsedNodes.clear();
        this.refresh();
    }

    public refresh(): void {
        this.onGUI();
    }

    public beginRenameForSelection(): void {
        // @ts-ignore
        const editor = window.Editor?.instance;
        if (!editor) return;

        const selected = (editor.getSelectedGameObjects?.() as GameObject[] | undefined) ?? [];
        const target = selected[selected.length - 1] ?? null;
        if (!target) return;

        const nameSpan = this.container.querySelector(`[data-id="${target.id}"] span:nth-child(3)`) as HTMLElement | null;
        if (!nameSpan) return;
        this.startInlineRename(nameSpan, target);
    }

    private refreshList(): void {
        const list = this.container.querySelector('#hierarchy-content');
        if (!list) return;
        list.innerHTML = '';

        const searchInput = this.container.querySelector('#hierarchy-search') as HTMLInputElement;
        const searchQuery = searchInput?.value.toLowerCase() || '';

        // Only render root-level GOs (no parent), skip Editor Camera
        this.scene.gameObjects.forEach(go => {
            if (go.transform.parent === null && go.name !== 'Editor Camera') {
                this.renderNode(list as HTMLElement, go, 0, searchQuery);
            }
        });
    }

    private renderNode(parent: HTMLElement, go: GameObject, depth: number, searchQuery: string): void {
        const hasChildren = go.transform.childCount > 0;
        const isCollapsed = this.collapsedNodes.has(go.id);
        const matches = go.name.toLowerCase().includes(searchQuery.toLowerCase()) || searchQuery === '';

        // If searching and this node doesn't match, check if any descendant matches
        if (searchQuery && !this.anyDescendantMatches(go, searchQuery.toLowerCase())) return;

        // @ts-ignore
        const editor = window.Editor?.instance;
        const prefabChain = editor?.getPrefabApplyTargetOptions?.(go) ?? [];
        const isPrefab = prefabChain.length > 0 || !!go.prefabSource;
        const isNestedPrefab = prefabChain.length > 1;
        const isPrefabRoot = isPrefab && !!go.sourceAssetPath;
        const prefabContext = isPrefab ? (editor?.getPrefabContextInfo?.(go) ?? null) : null;
        const overrideSummary = isPrefab
            ? (editor?.getPrefabOverrideSummary?.(go) ?? { total: 0, addedComponents: 0, removedComponents: 0 })
            : { total: 0, addedComponents: 0, removedComponents: 0 };

        // Container
        const container = document.createElement('div');
        // Actually we should use the Editor instance state
        // @ts-ignore
        const currentSelection = window.Editor?.instance?.getSelectedGameObjects() || [];
        const isActuallySelected = currentSelection.includes(go);

        container.classList.add('hierarchy-item');
        container.dataset.id = go.id;
        if (isActuallySelected) container.classList.add('selected');
        container.style.paddingLeft = `${depth * 14 + 4}px`;
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.height = '20px';
        container.style.cursor = 'pointer';
        container.style.userSelect = 'none';
        container.style.fontSize = '12px';
        container.style.color = isPrefab ? '#7ab3ff' : 'var(--unity-text)';
        container.draggable = true;

        // Drag Source
        container.ondragstart = (e) => {
            e.stopPropagation();
            const selected = (editor?.getSelectedGameObjects?.() as GameObject[] | undefined) ?? [];
            const selectedIds = selected.map((entry) => entry.id);
            const dragIds = selectedIds.includes(go.id) && selectedIds.length > 1
                ? selectedIds
                : [go.id];
            e.dataTransfer!.setData('text/plain', JSON.stringify({ type: 'gameobject', id: go.id, ids: dragIds }));
            container.style.opacity = '0.5';
        };
        container.ondragend = () => {
            container.style.opacity = '1';
        };

        // Collapse/Expand Arrow
        const arrow = document.createElement('span');
        arrow.style.width = '14px';
        arrow.style.textAlign = 'center';
        arrow.style.fontSize = '9px';
        arrow.style.color = '#aaa';
        arrow.style.flexShrink = '0';
        arrow.style.cursor = hasChildren ? 'pointer' : 'default';
        arrow.innerText = hasChildren ? (isCollapsed ? '>' : 'v') : '';
        arrow.onclick = (e) => {
            e.stopPropagation();
            if (!hasChildren) return;
            if (isCollapsed) this.collapsedNodes.delete(go.id);
            else this.collapsedNodes.add(go.id);
            this.refreshList();
        };

        // Icon
        const icon = document.createElement('span');
        icon.style.marginRight = '4px';
        icon.style.fontSize = '11px';
        icon.innerText = this.getIcon(go);

        // Name
        const nameSpan = document.createElement('span');
        nameSpan.innerText = go.name;
        nameSpan.style.flex = '1';
        nameSpan.style.color = isPrefab ? '#3498db' : 'inherit';
        nameSpan.style.overflow = 'hidden';
        nameSpan.style.textOverflow = 'ellipsis';
        nameSpan.style.whiteSpace = 'nowrap';
        if (!matches && searchQuery) nameSpan.style.opacity = '0.4';

        container.appendChild(arrow);
        container.appendChild(icon);
        container.appendChild(nameSpan);

        if (isPrefabRoot || isNestedPrefab) {
            const prefabBadge = document.createElement('span');
            prefabBadge.innerText = isNestedPrefab ? 'N' : 'P';
            prefabBadge.title = isNestedPrefab
                ? 'Nested prefab owner chain'
                : 'Prefab root';
            prefabBadge.style.cssText = `
                font-size: 9px;
                background: rgba(79, 164, 255, 0.16);
                color: #7ab3ff;
                border: 1px solid rgba(79, 164, 255, 0.32);
                padding: 0 4px;
                border-radius: 4px;
                margin-left: 4px;
                line-height: 14px;
                height: 14px;
                display: inline-flex;
                align-items: center;
            `;
            container.appendChild(prefabBadge);
        }

        if (isPrefab && overrideSummary.total > 0) {
            const overridesBadge = document.createElement('span');
            overridesBadge.innerText = `O${overrideSummary.total}`;
            const targetLabel = prefabContext?.assetLabel ?? 'Prefab';
            const targetNode = prefabContext?.nodeLabel ?? go.name;
            overridesBadge.title = `Prefab overrides: ${overrideSummary.total} | Target: ${targetLabel} > ${targetNode}`;
            overridesBadge.style.cssText = `
                font-size: 9px;
                background: rgba(247, 177, 67, 0.16);
                color: #f7b143;
                border: 1px solid rgba(247, 177, 67, 0.34);
                padding: 0 4px;
                border-radius: 4px;
                margin-left: 4px;
                line-height: 14px;
                height: 14px;
                display: inline-flex;
                align-items: center;
                flex-shrink: 0;
            `;
            container.appendChild(overridesBadge);
        }

        // Child count badge
        if (hasChildren) {
            const badge = document.createElement('span');
            badge.innerText = go.transform.childCount.toString();
            badge.style.cssText = `
                font-size: 9px;
                background: #444;
                color: #aaa;
                padding: 1px 4px;
                border-radius: 4px;
                margin-left: 5px;
                min-width: 10px;
                text-align: center;
                opacity: 0.7;
            `;
            container.appendChild(badge);
        }

        // Open Prefab Button
        if (isPrefab) {
            const openBtn = document.createElement('span');
            openBtn.innerText = '>';
            openBtn.title = 'Highlight Prefab Asset';
            openBtn.style.fontSize = '10px';
            openBtn.style.marginLeft = '4px';
            openBtn.style.opacity = '0.3';
            openBtn.style.cursor = 'pointer';
            openBtn.onmouseenter = () => openBtn.style.opacity = '1';
            openBtn.onmouseleave = () => openBtn.style.opacity = '0.3';
            openBtn.onclick = (e) => {
                e.stopPropagation();
                // @ts-ignore
                if (prefabContext?.sourcePath) {
                    // @ts-ignore
                    window.Editor?.instance?.projectWindow?.highlightAsset?.(PathUtils.basename(prefabContext.sourcePath));
                    return;
                }
                // @ts-ignore
                window.Editor?.instance?.projectWindow?.selectAssetByName?.(go.prefabSource);
            };
            container.appendChild(openBtn);
        }

        // Interaction
        container.onclick = (e) => {
            e.stopPropagation();
            const listEl = this.container.querySelector('#hierarchy-content') as HTMLElement | null;
            listEl?.focus();
            const additive = e.ctrlKey || e.metaKey;
            const shiftRange = e.shiftKey;
            if (editor) {
                if (shiftRange) {
                    const orderedNodes = this.getVisibleGameObjects(searchQuery.toLowerCase());
                    const selected = (editor.getSelectedGameObjects?.() as GameObject[] | undefined) ?? [];
                    const anchorId = this.lastClickedNodeId ?? selected[selected.length - 1]?.id ?? go.id;
                    const anchorIndex = orderedNodes.findIndex((node) => node.id === anchorId);
                    const targetIndex = orderedNodes.findIndex((node) => node.id === go.id);

                    if (anchorIndex > -1 && targetIndex > -1) {
                        const start = Math.min(anchorIndex, targetIndex);
                        const end = Math.max(anchorIndex, targetIndex);
                        editor.selectGameObjectRange(orderedNodes.slice(start, end + 1), additive);
                    } else {
                        editor.selectGameObject(go, additive);
                    }
                } else {
                    editor.selectGameObject(go, additive);
                }
            } else {
                this.onSelect(go);
            }
            this.lastClickedNodeId = go.id;
            this.keyboardRangeAnchorId = go.id;
            this.refreshList();
        };

        container.ondblclick = (e) => {
            e.stopPropagation();
            this.startInlineRename(nameSpan, go);
        };

        container.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showItemContextMenu(e.clientX, e.clientY, go);
        };

        // Drag Target (Parenting)
        container.ondragover = (e) => {
            e.preventDefault();
            e.stopPropagation();
            container.style.background = 'rgba(50, 103, 171, 0.3)';
        };

        container.ondragleave = () => {
            container.style.background = 'transparent';
        };

        container.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            container.style.background = 'transparent';
            try {
                const payload = JSON.parse(e.dataTransfer!.getData('text/plain'));
                if (payload.type === 'gameobject') {
                    const sourceIds = Array.isArray(payload.ids)
                        ? payload.ids.filter((id: unknown): id is string => typeof id === 'string')
                        : (typeof payload.id === 'string' ? [payload.id] : []);
                    const dragged = sourceIds
                        .map((id: string) => this.scene.gameObjects.find((entry: GameObject) => entry.id === id))
                        .filter((entry: GameObject | undefined): entry is GameObject => !!entry);
                    const topLevelDragged = this.getTopLevelDraggedSources(dragged);

                    const reparentCommands = topLevelDragged
                        .filter((sourceGO) => sourceGO !== go && !this.isDescendant(sourceGO, go))
                        .map((sourceGO) => new ReparentGameObjectCommand(sourceGO, go.transform));
                    if (reparentCommands.length === 0) return;

                    if (reparentCommands.length === 1) {
                        CommandHistory.execute(reparentCommands[0]);
                    } else {
                        CommandHistory.execute(new GroupCommand(`Reparent ${reparentCommands.length} objects`, reparentCommands));
                    }
                    this.refreshList();
                } else if (payload.type === 'file') {
                    // Logic for dropping scripts onto GameObjects
                    const filename = payload.filename || payload.name;
                    const ext = filename.split('.').pop()?.toLowerCase();
                    if (ext === 'ts' || ext === 'cs') {
                        const scriptName = filename.split('.')[0];
                        if (!ScriptRegistry.isAutoReferenced(scriptName)) {
                            console.warn(`Script ${scriptName} is not auto-referenced and cannot be added from drag-drop.`);
                            return;
                        }
                        const ComponentClass = ScriptRegistry.getComponentClass(scriptName);
                        if (ComponentClass) {
                            go.addComponent(ComponentClass);
                            // @ts-ignore
                            window.Editor?.instance?.inspectorWindow?.refresh();
                            console.log(`Added component ${scriptName} to ${go.name}`);
                        }
                    }
                }
            } catch (err) { }
        };

        parent.appendChild(container);

        // Render children
        if (!isCollapsed) {
            go.transform.children.forEach(child => {
                this.renderNode(parent, child.gameObject, depth + 1, searchQuery);
            });
        }
    }

    private isDescendant(parent: GameObject, potDescendant: GameObject): boolean {
        let curr: any = potDescendant.transform.parent;
        while (curr) {
            if (curr.gameObject === parent) return true;
            curr = curr.parent;
        }
        return false;
    }

    private anyDescendantMatches(go: GameObject, query: string): boolean {
        if (go.name.toLowerCase().includes(query)) return true;
        for (const child of go.transform.children) {
            if (this.anyDescendantMatches(child.gameObject, query)) return true;
        }
        return false;
    }

    private getTopLevelDraggedSources(sources: GameObject[]): GameObject[] {
        const sourceSet = new Set(sources);
        return sources.filter((source) => !this.hasAncestorInSet(source, sourceSet));
    }

    private hasAncestorInSet(source: GameObject, sourceSet: Set<GameObject>): boolean {
        let current = source.transform.parent;
        while (current) {
            if (sourceSet.has(current.gameObject)) return true;
            current = current.parent;
        }
        return false;
    }

    private getVisibleGameObjects(searchQuery: string): GameObject[] {
        const visible: GameObject[] = [];
        const query = searchQuery.toLowerCase();
        this.scene.gameObjects.forEach((go) => {
            if (go.transform.parent !== null || go.name === 'Editor Camera') return;
            this.collectVisibleNodeOrder(go, query, visible);
        });
        return visible;
    }

    private collectVisibleNodeOrder(go: GameObject, query: string, visible: GameObject[]): void {
        if (query && !this.anyDescendantMatches(go, query)) return;

        visible.push(go);
        if (this.collapsedNodes.has(go.id)) return;

        go.transform.children.forEach((child) => {
            this.collectVisibleNodeOrder(child.gameObject, query, visible);
        });
    }

    private handleListKeyDown(event: KeyboardEvent): void {
        // @ts-ignore
        const editor = window.Editor?.instance;
        if (!editor) return;
        const commandKey = event.ctrlKey || event.metaKey;
        const consume = () => {
            event.preventDefault();
            event.stopPropagation();
        };

        const searchInput = this.container.querySelector('#hierarchy-search') as HTMLInputElement | null;
        const query = searchInput?.value.toLowerCase() ?? '';
        const orderedNodes = this.getVisibleGameObjects(query);
        if (orderedNodes.length === 0) return;

        const selected = (editor.getSelectedGameObjects?.() as GameObject[] | undefined) ?? [];
        const activeId = this.lastClickedNodeId ?? selected[selected.length - 1]?.id ?? orderedNodes[0].id;
        const activeIndex = Math.max(0, orderedNodes.findIndex((node) => node.id === activeId));
        const activeNode = orderedNodes[activeIndex] ?? orderedNodes[0];

        const selectNode = (target: GameObject, shiftRange: boolean = false) => {
            if (shiftRange) {
                const anchorId = this.keyboardRangeAnchorId ?? activeNode.id;
                const anchorIndex = orderedNodes.findIndex((node) => node.id === anchorId);
                const targetIndex = orderedNodes.findIndex((node) => node.id === target.id);
                if (anchorIndex > -1 && targetIndex > -1) {
                    const start = Math.min(anchorIndex, targetIndex);
                    const end = Math.max(anchorIndex, targetIndex);
                    editor.selectGameObjectRange?.(orderedNodes.slice(start, end + 1), false);
                } else {
                    editor.selectGameObject?.(target, false);
                }
            } else {
                editor.selectGameObject?.(target, false);
                this.keyboardRangeAnchorId = target.id;
            }
            this.lastClickedNodeId = target.id;
            this.refreshList();
        };

        switch (event.key) {
            case 'ArrowDown': {
                if (event.altKey && commandKey) {
                    consume();
                    editor.moveSelectionSibling?.(1);
                    this.refreshList();
                    break;
                }
                if (event.altKey && !commandKey) {
                    consume();
                    editor.selectFirstChildOfSelection?.();
                    this.refreshList();
                    break;
                }
                consume();
                const nextIndex = Math.min(orderedNodes.length - 1, activeIndex + 1);
                selectNode(orderedNodes[nextIndex], event.shiftKey);
                break;
            }
            case 'ArrowUp': {
                if (event.altKey && commandKey) {
                    consume();
                    editor.moveSelectionSibling?.(-1);
                    this.refreshList();
                    break;
                }
                if (event.altKey && !commandKey) {
                    consume();
                    editor.selectParentOfSelection?.();
                    this.refreshList();
                    break;
                }
                consume();
                const nextIndex = Math.max(0, activeIndex - 1);
                selectNode(orderedNodes[nextIndex], event.shiftKey);
                break;
            }
            case 'ArrowLeft': {
                if (event.altKey && !commandKey) {
                    consume();
                    editor.selectSiblingOfSelection?.(-1);
                    this.refreshList();
                    break;
                }
                consume();
                if (activeNode.transform.childCount > 0 && !this.collapsedNodes.has(activeNode.id)) {
                    this.collapsedNodes.add(activeNode.id);
                    this.refreshList();
                    return;
                }
                const parent = activeNode.transform.parent?.gameObject ?? null;
                if (parent) selectNode(parent, event.shiftKey);
                break;
            }
            case 'ArrowRight': {
                if (event.altKey && !commandKey) {
                    consume();
                    editor.selectSiblingOfSelection?.(1);
                    this.refreshList();
                    break;
                }
                consume();
                if (activeNode.transform.childCount > 0 && this.collapsedNodes.has(activeNode.id)) {
                    this.collapsedNodes.delete(activeNode.id);
                    this.refreshList();
                    return;
                }
                const firstChild = activeNode.transform.children[0]?.gameObject ?? null;
                if (firstChild) selectNode(firstChild, event.shiftKey);
                break;
            }
            case 'Home': {
                if (event.altKey && commandKey) {
                    consume();
                    editor.setSelectionSiblingPosition?.('first');
                    this.refreshList();
                }
                break;
            }
            case 'End': {
                if (event.altKey && commandKey) {
                    consume();
                    editor.setSelectionSiblingPosition?.('last');
                    this.refreshList();
                }
                break;
            }
            case 'F2': {
                consume();
                this.beginRenameForSelection();
                break;
            }
            case 'Delete': {
                consume();
                editor.deleteSelected?.();
                this.refreshList();
                break;
            }
            case 'Enter': {
                consume();
                editor.focusOnSelectionOrScene?.();
                break;
            }
            case 'c': {
                if (!commandKey) break;
                consume();
                editor.copySelected?.();
                break;
            }
            case 'v': {
                if (!commandKey) break;
                consume();
                if (event.shiftKey) {
                    editor.pasteAsChildOfSelection?.();
                } else {
                    editor.pasteSelected?.();
                }
                this.refreshList();
                break;
            }
            case 'x': {
                if (!commandKey) break;
                consume();
                editor.cutSelected?.();
                this.refreshList();
                break;
            }
            case 'd': {
                if (!commandKey) break;
                consume();
                editor.duplicateSelected?.();
                this.refreshList();
                break;
            }
            case 'g': {
                if (!commandKey || !event.shiftKey) break;
                consume();
                editor.createEmptyParentForSelection?.();
                this.refreshList();
                break;
            }
            case 'n': {
                if (!commandKey || !event.shiftKey || !event.altKey) break;
                consume();
                editor.createEmptyChildForSelection?.();
                this.refreshList();
                break;
            }
            case 'f': {
                if (!commandKey || !searchInput) break;
                consume();
                searchInput.focus();
                searchInput.select();
                break;
            }
            default:
                break;
        }
    }

    private startInlineRename(nameSpan: HTMLElement, go: GameObject): void {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = go.name;
        input.style.cssText = `
            background: var(--unity-bg-input); color: var(--unity-text);
            border: 1px solid var(--unity-accent); font-size: 12px;
            padding: 0 2px; width: 100%; outline: none;
        `;
        nameSpan.replaceWith(input);
        input.focus();
        input.select();

        const commit = () => {
            const newName = input.value.trim();
            if (newName && newName !== go.name) {
                CommandHistory.execute(new RenameGameObjectCommand(go, newName));
            }
            nameSpan.innerText = go.name;
            input.replaceWith(nameSpan);
            this.refreshList();
        };
        input.onblur = commit;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { input.value = go.name; commit(); }
        };
    }

    /** Right-click context menu on a hierarchy item */
    private showItemContextMenu(x: number, y: number, go: GameObject): void {
        this.removeExistingMenus();
        const menu = this.createMenu(x, y);
        // @ts-ignore
        const editor = window.Editor?.instance;
        const selected = (editor?.getSelectedGameObjects?.() as GameObject[] | undefined) ?? [];
        const clickedInSelection = selected.includes(go);
        const selectionScope = clickedInSelection && selected.length > 0 ? selected : [go];
        const primarySelection = selectionScope[selectionScope.length - 1] ?? go;
        const parentTransform = primarySelection.transform.parent;
        const hasParentSelection = !!parentTransform;
        const hasChildSelection = primarySelection.transform.childCount > 0;
        const siblingIndex = parentTransform ? parentTransform.children.indexOf(primarySelection.transform) : -1;
        const siblingCount = parentTransform?.children.length ?? 0;
        const hasPrevSiblingSelection = siblingCount > 1 && siblingIndex > 0;
        const hasNextSiblingSelection = siblingCount > 1 && siblingIndex >= 0 && siblingIndex < (siblingCount - 1);
        const canUnparent = selectionScope.some((entry) => !!entry.transform.parent);
        const hasClipboard = (editor?.getClipboardSize?.() ?? 0) > 0;
        const canMoveSiblingUp = editor?.canMoveSelectionSibling?.(-1, selectionScope) ?? false;
        const canMoveSiblingDown = editor?.canMoveSelectionSibling?.(1, selectionScope) ?? false;
        const canSetFirstSibling = editor?.canSetSelectionSiblingPosition?.('first', selectionScope) ?? false;
        const canSetLastSibling = editor?.canSetSelectionSiblingPosition?.('last', selectionScope) ?? false;
        const ensureSelection = () => {
            if (!editor) return;
            if (!clickedInSelection) {
                editor.selectGameObject(go, false);
            }
        };

        this.addMenuItem(menu, 'Copy', () => {
            ensureSelection();
            // @ts-ignore
            window.Editor?.instance?.copySelected?.();
        });

        this.addMenuItem(menu, 'Cut', () => {
            ensureSelection();
            // @ts-ignore
            window.Editor?.instance?.cutSelected?.();
        });

        this.addMenuItem(menu, 'Paste', () => {
            // @ts-ignore
            window.Editor?.instance?.pasteSelected?.();
        }, undefined, !hasClipboard);
        this.addMenuItem(menu, 'Paste As Child (Ctrl/Cmd+Shift+V)', () => {
            ensureSelection();
            editor?.pasteAsChildOfSelection?.();
        }, undefined, !hasClipboard);

        this.addMenuItem(menu, 'Duplicate', () => {
            ensureSelection();
            // @ts-ignore
            const editor = window.Editor?.instance;
            if (editor) {
                editor.duplicateSelected();
            } else {
                const json = go.serialize();
                const copy = this.deserializeGO(json);
                if (copy) {
                    copy.name = go.name + ' (Copy)';
                    CommandHistory.execute(new CreateGameObjectCommand(copy, this.scene, go.transform.parent));
                    this.onSelect(copy);
                    this.refresh();
                }
            }
        });

        this.addMenuItem(menu, 'Rename', () => {
            const nameSpan = this.container.querySelector(`[data-id="${go.id}"] span:nth-child(3)`) as HTMLElement;
            if (nameSpan) this.startInlineRename(nameSpan, go);
        });

        this.addMenuItem(menu, 'Frame Selected', () => {
            if (!editor) return;
            ensureSelection();
            editor.focusOnSelection?.();
        });
        this.addMenuItem(menu, 'Select Parent (Alt+Up)', () => {
            ensureSelection();
            editor?.selectParentOfSelection?.();
        }, undefined, !hasParentSelection);
        this.addMenuItem(menu, 'Select First Child (Alt+Down)', () => {
            ensureSelection();
            editor?.selectFirstChildOfSelection?.();
        }, undefined, !hasChildSelection);
        this.addMenuItem(menu, 'Select Previous Sibling (Alt+Left)', () => {
            ensureSelection();
            editor?.selectSiblingOfSelection?.(-1);
        }, undefined, !hasPrevSiblingSelection);
        this.addMenuItem(menu, 'Select Next Sibling (Alt+Right)', () => {
            ensureSelection();
            editor?.selectSiblingOfSelection?.(1);
        }, undefined, !hasNextSiblingSelection);
        this.addMenuItem(menu, 'Move Up Sibling (Ctrl/Cmd+Alt+Up)', () => {
            ensureSelection();
            editor?.moveSelectionSibling?.(-1);
            this.refreshList();
        }, undefined, !canMoveSiblingUp);
        this.addMenuItem(menu, 'Move Down Sibling (Ctrl/Cmd+Alt+Down)', () => {
            ensureSelection();
            editor?.moveSelectionSibling?.(1);
            this.refreshList();
        }, undefined, !canMoveSiblingDown);
        this.addMenuItem(menu, 'Set As First Sibling (Ctrl/Cmd+Alt+Home)', () => {
            ensureSelection();
            editor?.setSelectionSiblingPosition?.('first');
            this.refreshList();
        }, undefined, !canSetFirstSibling);
        this.addMenuItem(menu, 'Set As Last Sibling (Ctrl/Cmd+Alt+End)', () => {
            ensureSelection();
            editor?.setSelectionSiblingPosition?.('last');
            this.refreshList();
        }, undefined, !canSetLastSibling);
        this.addMenuItem(menu, 'Select Children', () => {
            ensureSelection();
            editor?.selectChildrenOfSelection?.(false);
        }, undefined, !hasChildSelection);
        this.addMenuItem(menu, 'Select Descendants', () => {
            ensureSelection();
            editor?.selectChildrenOfSelection?.(true);
        }, undefined, !hasChildSelection);

        const prefabContext = editor?.getPrefabContextInfo?.(go) ?? null;
        if (prefabContext) {
            this.addMenuSeparator(menu);

            this.addMenuItem(menu, 'Prefab Apply Target', () => {
                editor?.applyPrefabSelectionToTarget?.(go);
                this.refreshList();
                editor?.inspectorWindow?.refresh?.();
            });

            this.addMenuItem(menu, 'Prefab Revert Target', () => {
                editor?.revertPrefabSelectionToTarget?.(go);
                this.refreshList();
                editor?.inspectorWindow?.refresh?.();
            });
        }

        this.addMenuSeparator(menu);

        this.addMenuItem(menu, 'Create Empty Parent (Ctrl/Cmd+Shift+G)', () => {
            if (!editor) return;
            ensureSelection();
            editor.createEmptyParentForSelection?.();
        });

        this.addMenuItem(menu, 'Create Empty Child (Ctrl/Cmd+Alt+Shift+N)', () => {
            if (editor?.createEmptyChildForSelection) {
                ensureSelection();
                editor.createEmptyChildForSelection();
                this.collapsedNodes.delete(go.id);
                this.refreshList();
                return;
            }

            const child = new GameObject('GameObject');
            CommandHistory.execute(new CreateGameObjectCommand(child, this.scene, go.transform));
            this.collapsedNodes.delete(go.id);
            this.refreshList();
        });

        this.addMenuSeparator(menu);

        this.addMenuItem(menu, 'Unparent', () => {
            if (editor?.unparentTopLevelSelection) {
                ensureSelection();
                editor.unparentTopLevelSelection();
                this.refreshList();
                return;
            }
            CommandHistory.execute(new ReparentGameObjectCommand(go, null));
            this.refreshList();
        }, undefined, !canUnparent);

        this.addMenuSeparator(menu);

        this.addMenuItem(menu, 'Delete', () => {
            ensureSelection();
            if (editor) {
                editor.deleteSelected();
            } else {
                CommandHistory.execute(new DeleteGameObjectCommand(go, this.scene));
                this.refreshList();
            }
        }, '#ff6b6b');

        document.body.appendChild(menu);
        setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
    }

    /** "+" button / right-click on empty space Create menu */
    public showCreateMenu(x: number, y: number, parentGO: GameObject | null): void {
        this.removeExistingMenus();
        const menu = this.createMenu(x, y);

        this.addMenuItem(menu, 'Create Empty', () => {
            const go = new GameObject('GameObject');
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        this.addMenuSeparator(menu);

        // 3D Objects submenu
        const primitives: Array<[string, string]> = [
            ['Cube', 'Cube'],
            ['Sphere', 'Sphere'],
            ['Capsule', 'Capsule'],
            ['Cylinder', 'Cylinder'],
            ['Plane', 'Plane'],
            ['Quad', 'Quad'],
        ];

        primitives.forEach(([label, type]) => {
            this.addMenuItem(menu, label, () => {
                const go = this.createPrimitive(type);
                CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
                this.onSelect(go);
                this.refreshList();
            });
        });

        this.addMenuSeparator(menu);

        this.addMenuItem(menu, 'Camera', () => {
            const go = new GameObject('Camera');
            go.addComponent(Camera);
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        this.addMenuItem(menu, 'Directional Light', () => {
            const go = new GameObject('Directional Light');
            const light = go.addComponent(Light);
            light.setLightType(LightType.Directional);
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        this.addMenuItem(menu, 'Point Light', () => {
            const go = new GameObject('Point Light');
            const light = go.addComponent(Light);
            light.setLightType(LightType.Point);
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        this.addMenuItem(menu, 'Spot Light', () => {
            const go = new GameObject('Spot Light');
            const light = go.addComponent(Light);
            light.setLightType(LightType.Spot);
            light.setSpotAngle(30);
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        this.addMenuItem(menu, 'Audio Source', () => {
            const go = new GameObject('Audio Source');
            go.addComponent(AudioSource);
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        this.addMenuSeparator(menu);

        // UI submenu
        this.addMenuItem(menu, 'UI Canvas', () => {
            // @ts-ignore
            const editor = window.Editor?.instance;
            if (editor?.createUICanvas) {
                editor.createUICanvas();
                this.refreshList();
                return;
            }
            const go = new GameObject('Canvas');
            go.addComponent(Canvas);
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        this.addMenuItem(menu, 'UI Image', () => {
            // @ts-ignore
            const editor = window.Editor?.instance;
            if (editor?.createUIElement) {
                if (parentGO) editor.selectGameObject(parentGO, false);
                editor.createUIElement('Image');
                this.refreshList();
                return;
            }
            const go = new GameObject('Image');
            go.addComponent(RectTransform);
            go.addComponent(UIImage);
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        this.addMenuItem(menu, 'UI Text', () => {
            // @ts-ignore
            const editor = window.Editor?.instance;
            if (editor?.createUIElement) {
                if (parentGO) editor.selectGameObject(parentGO, false);
                editor.createUIElement('Text');
                this.refreshList();
                return;
            }
            const go = new GameObject('Text');
            go.addComponent(RectTransform);
            go.addComponent(UIText);
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        this.addMenuItem(menu, 'UI Button', () => {
            // @ts-ignore
            const editor = window.Editor?.instance;
            if (editor?.createUIElement) {
                if (parentGO) editor.selectGameObject(parentGO, false);
                editor.createUIElement('Button');
                this.refreshList();
                return;
            }
            const go = new GameObject('Button');
            go.addComponent(RectTransform);
            go.addComponent(UIButton);
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        this.addMenuItem(menu, 'UI Input Field', () => {
            // @ts-ignore
            const editor = window.Editor?.instance;
            if (editor?.createUIElement) {
                if (parentGO) editor.selectGameObject(parentGO, false);
                editor.createUIElement('InputField');
                this.refreshList();
                return;
            }
            const go = new GameObject('Input Field');
            go.addComponent(RectTransform);
            go.addComponent(UIInputField);
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        this.addMenuItem(menu, 'UI Dropdown', () => {
            // @ts-ignore
            const editor = window.Editor?.instance;
            if (editor?.createUIElement) {
                if (parentGO) editor.selectGameObject(parentGO, false);
                editor.createUIElement('Dropdown');
                this.refreshList();
                return;
            }
            const go = new GameObject('Dropdown');
            go.addComponent(RectTransform);
            go.addComponent(UIDropdown);
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        this.addMenuItem(menu, 'UI Toggle', () => {
            // @ts-ignore
            const editor = window.Editor?.instance;
            if (editor?.createUIElement) {
                if (parentGO) editor.selectGameObject(parentGO, false);
                editor.createUIElement('Toggle');
                this.refreshList();
                return;
            }
            const go = new GameObject('Toggle');
            go.addComponent(RectTransform);
            go.addComponent(UIToggle);
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        this.addMenuItem(menu, 'UI Slider', () => {
            // @ts-ignore
            const editor = window.Editor?.instance;
            if (editor?.createUIElement) {
                if (parentGO) editor.selectGameObject(parentGO, false);
                editor.createUIElement('Slider');
                this.refreshList();
                return;
            }
            const go = new GameObject('Slider');
            go.addComponent(RectTransform);
            go.addComponent(UISlider);
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        this.addMenuItem(menu, 'UI Scrollbar', () => {
            // @ts-ignore
            const editor = window.Editor?.instance;
            if (editor?.createUIElement) {
                if (parentGO) editor.selectGameObject(parentGO, false);
                editor.createUIElement('Scrollbar');
                this.refreshList();
                return;
            }
            const go = new GameObject('Scrollbar');
            go.addComponent(RectTransform);
            go.addComponent(UIScrollbar);
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        this.addMenuItem(menu, 'UI Scroll View', () => {
            // @ts-ignore
            const editor = window.Editor?.instance;
            if (editor?.createUIElement) {
                if (parentGO) editor.selectGameObject(parentGO, false);
                editor.createUIElement('ScrollView');
                this.refreshList();
                return;
            }
            const go = new GameObject('Scroll View');
            go.addComponent(RectTransform);
            go.addComponent(UIScrollRect);
            CommandHistory.execute(new CreateGameObjectCommand(go, this.scene, parentGO?.transform));
            this.onSelect(go);
            this.refreshList();
        });

        document.body.appendChild(menu);
        setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
    }

    private createPrimitive(type: string): GameObject {
        const go = new GameObject(type);
        const mf = go.addComponent(MeshFilter);
        go.addComponent(MeshRenderer);

        if (type === 'Cube') mf.setPrimitiveType('Cube');
        else if (type === 'Sphere') mf.setPrimitiveType('Sphere');
        else if (type === 'Capsule') mf.setPrimitiveType('Capsule');
        else if (type === 'Cylinder') mf.setPrimitiveType('Cylinder');
        else if (type === 'Plane') mf.setPrimitiveType('Plane');
        else if (type === 'Quad') mf.setPrimitiveType('Quad');

        return go;
    }

    private deserializeGO(data: any): GameObject | null {
        try {
            const go = new GameObject(data.name);
            go.tag = data.tag || 'Untagged';
            go.layer = data.layer || 0;
            if (data.transform) {
                if (data.transform.position) go.transform.position.fromArray(data.transform.position);
                if (data.transform.scale) go.transform.scale.fromArray(data.transform.scale);
            }
            return go;
        } catch { return null; }
    }

    // --- Menu Helpers ---
    private createMenu(x: number, y: number): HTMLElement {
        const menu = document.createElement('div');
        menu.id = 'hierarchy-context-menu';
        menu.style.cssText = `
            position: fixed; left: ${x}px; top: ${y}px;
            background: #2d2d2d; border: 1px solid #555;
            padding: 4px 0; z-index: 9999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            min-width: 180px; border-radius: 3px;
            font-family: 'Segoe UI', sans-serif;
        `;
        return menu;
    }

    private addMenuItem(menu: HTMLElement, label: string, cb: () => void, color?: string, disabled: boolean = false): void {
        const item = document.createElement('div');
        item.innerText = label;
        item.style.cssText = `
            padding: 5px 14px; font-size: 12px; cursor: pointer;
            color: ${color || '#eee'}; white-space: nowrap;
            opacity: ${disabled ? '0.45' : '1'};
        `;
        item.onmouseenter = () => item.style.background = disabled ? 'transparent' : '#3267ab';
        item.onmouseleave = () => item.style.background = 'transparent';
        item.onclick = (e) => {
            e.stopPropagation();
            if (disabled) return;
            cb();
            menu.remove();
        };
        menu.appendChild(item);
    }

    private addMenuSeparator(menu: HTMLElement): void {
        const sep = document.createElement('div');
        sep.style.cssText = 'height: 1px; background: #555; margin: 3px 0;';
        menu.appendChild(sep);
    }

    private removeExistingMenus(): void {
        document.getElementById('hierarchy-context-menu')?.remove();
    }

    private getIcon(go: GameObject): string {
        if (go.getComponent(Camera)) return '[Cam]';
        if (go.getComponent(Light)) return '[Lit]';
        if (go.getComponent(MeshRenderer)) return '[Mesh]';
        if (go.getComponent(ParticleSystem)) return '[FX]';
        if (go.getComponent(AudioSource)) return '[Aud]';
        if (go.getComponent(Canvas)) return '[UI]';
        if (go.getComponent(UIImage)) return '[Img]';
        if (go.getComponent(UIText)) return '[Txt]';
        if (go.getComponent(UIButton)) return '[Btn]';
        if (go.getComponent(UIInputField)) return '[Inp]';
        if (go.getComponent(UIDropdown)) return '[Drp]';
        if (go.getComponent(UIToggle)) return '[Tgl]';
        if (go.getComponent(UISlider)) return '[Sld]';
        if (go.getComponent(UIScrollbar)) return '[Scr]';
        if (go.getComponent(UIScrollRect)) return '[View]';
        return '[GO]';
    }
}

