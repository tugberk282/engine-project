import { EditorWindow } from './EditorWindow';
import { GameObject } from '../engine/GameObject';
import { EditorInspectors } from './EditorInspectors';
import { TagManager } from '../engine/TagManager';
import { LayerManager } from '../engine/LayerManager';
import { ProjectSettings } from '../engine/ProjectSettings';
import { PhysicsSystem } from '../engine/PhysicsSystem';
import { Camera } from '../engine/components/Camera';
import { RigidBody } from '../engine/components/RigidBody';
import { PrefabManager } from '../engine/Prefab';
import { ScriptableObject } from '../engine/ScriptableObject';
import { ScriptRegistry } from '../engine/ScriptRegistry';
import { CommandHistory } from './Command';
import { AddComponentCommand, RemoveComponentCommand, ReorderComponentCommand, SetPropertyCommand } from './LifecycleCommands';
import { ProjectSettingsWindow } from './ProjectSettingsWindow';
import type { AssetDeleteImpactSummary, AssetReferenceAuditIssue, AssetReferenceAuditResult, ProjectAssetSelection } from './ProjectWindow';
import type { AssetMeta } from '../engine/AssetDatabase';
import { PathUtils } from '../platform/PathUtils';

export class InspectorWindow extends EditorWindow {
    private selection: any = null;
    private inspectors: EditorInspectors;
    private collapsedComponents: Set<string> = new Set();
    private copiedComponentData: any = null;
    private copiedComponentType: string | null = null;

    constructor(parent: HTMLElement, inspectors: EditorInspectors) {
        super(parent, "Inspector");
        this.inspectors = inspectors;
        this.inspectors.refreshSelected = () => this.refresh();
    }

    private loadCollapsedStateForGameObject(goId: string): void {
        const { EditorSettings } = require('./EditorSettings');
        const collapsedList = EditorSettings.collapsedComponentsPerGameObject[goId] || [];
        this.collapsedComponents = new Set(collapsedList);
    }

    private saveCollapsedStateForGameObject(goId: string): void {
        const { EditorSettings } = require('./EditorSettings');
        EditorSettings.collapsedComponentsPerGameObject[goId] = Array.from(this.collapsedComponents);
        EditorSettings.save();
    }

    public selectGameObject(go: GameObject | null): void {
        this.selection = go;
        if (go) {
            this.loadCollapsedStateForGameObject(go.id);
        } else {
            this.collapsedComponents.clear();
        }
        this.refresh();
    }

    public selectAsset(asset: any): void {
        this.selection = asset;
        this.refresh();
    }

    public onGUI(): void {
        const content = this.getContentArea();
        content.innerHTML = '';

        if (!this.selection) {
            // @ts-ignore
            const scene = window.Editor?.instance?.scene;
            if (scene) {
                this.renderSceneInspector(content, scene);
            }
            return;
        }

        if (this.selection instanceof GameObject) {
            this.renderGameObjectInspector(content, this.selection);
        } else if (this.selection?.kind === 'asset') {
            this.renderAssetInspector(content, this.selection as ProjectAssetSelection);
        } else if (this.selection instanceof ScriptableObject) {
            this.renderScriptableObjectInspector(content, this.selection);
        } else if (this.selection.constructor.name === 'Material') {
            this.renderMaterialInspector(content, this.selection);
        }
    }

    private renderSceneInspector(content: HTMLElement, scene: any): void {
        const header = document.createElement('div');
        header.className = 'inspector-header';
        header.innerHTML = `<div style="font-weight: bold; padding: 5px;">Scene Settings</div>`;
        content.appendChild(header);

        const section = document.createElement('div');
        section.className = 'inspector-section';
        const sectionContent = document.createElement('div');
        sectionContent.className = 'section-content';
        section.appendChild(sectionContent);
        content.appendChild(section);

        this.inspectors.createSceneEnvironmentInspector(sectionContent, scene);
    }

    private renderGameObjectInspector(content: HTMLElement, go: GameObject): void {
        // GameObject Header
        const header = document.createElement('div');
        header.className = 'inspector-header';

        this.syncProjectTagsIntoTagManager();
        const tags = this.getAllAvailableTags();
        const layers = LayerManager.getInstance().getLayers();
        const tagTargets = this.getTagChangeBaseTargets(go);
        const uniqueSelectedTags = new Set(tagTargets.map((target) => target.tag || 'Untagged'));
        const isTagMixed = uniqueSelectedTags.size > 1;
        const tagOptionsHtml = this.buildTagOptionsHtml(tags, go.tag, isTagMixed);
        const layerTargets = this.getLayerChangeBaseTargets(go);
        const uniqueSelectedLayers = new Set(layerTargets.map((target) => Math.max(0, Math.min(31, target.layer | 0))));
        const isLayerMixed = uniqueSelectedLayers.size > 1;
        const layerOptionsHtml = this.buildLayerOptionsHtml(layers, go.layer, isLayerMixed);
        const enabledTargets = this.getEnabledChangeBaseTargets(go);
        const uniqueEnabledValues = new Set(enabledTargets.map((target) => Boolean(target.enabled)));
        const isEnabledMixed = uniqueEnabledValues.size > 1;
        const staticTargets = this.getStaticChangeBaseTargets(go);
        const uniqueStaticValues = new Set(staticTargets.map((target) => Boolean(target.isStatic)));
        const isStaticMixed = uniqueStaticValues.size > 1;

        header.innerHTML = `
            <div class="inspector-go-top">
                <input type="checkbox" ${!isEnabledMixed && go.enabled ? 'checked' : ''} id="go-enabled">
                <input type="text" value="${go.name}" class="unity-input" id="go-name" style="flex:1; margin: 0 5px;">
                <label style="font-size: 10px;"><input type="checkbox" id="go-static" ${!isStaticMixed && go.isStatic ? 'checked' : ''}> Static</label>
            </div>
            <div class="inspector-go-metadata" style="display: flex; gap: 4px; margin-top: 5px;">
                <div style="flex: 1; display: flex; align-items: center; gap: 4px;">
                    <span style="font-size: 10px; color: var(--unity-text-dim);">Tag</span>
                    <select id="go-tag" class="unity-select" style="font-size: 10px; height: 18px; padding: 0 4px;">
                        ${tagOptionsHtml}
                    </select>
                </div>
                <div style="flex: 1; display: flex; align-items: center; gap: 4px;">
                    <span style="font-size: 10px; color: var(--unity-text-dim);">Layer</span>
                    <select id="go-layer" class="unity-select" style="font-size: 10px; height: 18px; padding: 0 4px;">
                        ${layerOptionsHtml}
                    </select>
                </div>
            </div>
        `;
        const layerImpactRow = document.createElement('div');
        layerImpactRow.style.cssText = `
            margin-top: 6px; padding: 4px 6px;
            border: 1px solid var(--unity-border);
            border-radius: 3px;
            background: rgba(255,255,255,0.02);
        `;
        header.appendChild(layerImpactRow);
        this.renderLayerImpactSummary(go, layerImpactRow);
        content.appendChild(header);

        // Prefab Bar
        // @ts-ignore
        const editor = window.Editor?.instance;
        const prefabContext = editor?.getPrefabContextInfo?.(go) ?? null;
        const prefabContextRoot = prefabContext?.contextRoot ?? null;
        if (prefabContextRoot && prefabContext) {
            // @ts-ignore
            const overrideSummary = editor?.getPrefabOverrideSummary?.(go) ?? { total: 0, addedComponents: 0, removedComponents: 0 };
            const statusText = overrideSummary.total > 0
                ? `${overrideSummary.total} override${overrideSummary.total === 1 ? '' : 's'}`
                : 'No overrides';
            const isContextRoot = prefabContext.isContextRoot;
            const isApplyTargetSelection = prefabContext.applyTargetRoot === go;
            const prefabLabel = prefabContext.assetLabel;
            const topApplyLabel = isApplyTargetSelection ? 'Apply' : 'Apply Target';
            const topRevertLabel = isApplyTargetSelection ? 'Revert' : 'Revert Target';
            const prefabBar = document.createElement('div');
            prefabBar.className = 'inspector-prefab-bar';
            prefabBar.style.display = 'flex';
            prefabBar.style.justifyContent = 'space-between';
            prefabBar.style.alignItems = 'center';
            prefabBar.style.padding = '4px 10px';
            prefabBar.style.backgroundColor = 'rgba(79, 164, 255, 0.1)';
            prefabBar.style.borderBottom = '1px solid rgba(79, 164, 255, 0.2)';
            prefabBar.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 1px;">
                    <span style="font-size: 10px; color: #4fa4ff; font-weight: bold;">Prefab: ${prefabLabel}</span>
                    <span style="font-size: 9px; color: var(--unity-text-dim);">Target Node: ${prefabContext.nodeLabel}</span>
                    <span style="font-size: 9px; color: var(--unity-text-dim);">Context Root: ${prefabContext.contextRootLabel}</span>
                    <span style="font-size: 9px; color: var(--unity-text-dim);">${statusText}</span>
                    ${isContextRoot ? '' : `<span style="font-size: 9px; color: #d8c07a;">Child selection in ${prefabContext.contextRootLabel}. Use item-level Apply or jump to the root.</span>`}
                    ${prefabContext.isApplyTargetContextRoot ? '' : `<span style="font-size: 9px; color: #d8c07a;">Apply target switched to outer owner.</span>`}
                </div>
                <div style="display: flex; gap: 4px;">
                    <button class="unity-button" style="font-size: 9px; padding: 1px 6px;" id="prefab-open">Select</button>
                    ${isContextRoot ? '' : `<button class="unity-button" style="font-size: 9px; padding: 1px 6px;" id="prefab-root">Root</button>`}
                    <button class="unity-button" style="font-size: 9px; padding: 1px 6px;" id="prefab-apply">${topApplyLabel}</button>
                    <button class="unity-button" style="font-size: 9px; padding: 1px 6px;" id="prefab-revert">${topRevertLabel}</button>
                </div>
            `;
            content.insertBefore(prefabBar, header);

            const openBtn = prefabBar.querySelector('#prefab-open') as HTMLButtonElement;
            openBtn.onclick = () => {
                if (prefabContext.applyTargetRoot.sourceAssetPath) {
                    (window as any).Editor?.instance?.projectWindow?.highlightAsset(PathUtils.basename(prefabContext.applyTargetRoot.sourceAssetPath));
                } else if (prefabContext.applyTargetRoot.prefabSource) {
                    (window as any).Editor?.instance?.projectWindow?.highlightAsset(prefabContext.applyTargetRoot.prefabSource + '.prefab');
                }
            };

            const rootBtn = prefabBar.querySelector('#prefab-root') as HTMLButtonElement | null;
            if (rootBtn) {
                rootBtn.onclick = () => {
                    // @ts-ignore
                    window.Editor?.instance?.selectGameObject?.(prefabContextRoot);
                };
            }

            const applyBtn = prefabBar.querySelector('#prefab-apply') as HTMLButtonElement;
            applyBtn.onclick = () => {
                // @ts-ignore
                window.Editor?.instance?.applyPrefabSelectionToTarget?.(go);
                this.refresh(); // Refresh
                console.log(`Applied changes to target prefab: ${prefabLabel}`);
            };
            applyBtn.title = isApplyTargetSelection
                ? 'Save the selected prefab root back to its source'
                : 'Apply the selected subtree overrides to the chosen target prefab';

            const revertBtn = prefabBar.querySelector('#prefab-revert') as HTMLButtonElement;
            revertBtn.onclick = () => {
                // @ts-ignore
                window.Editor?.instance?.revertPrefabSelectionToTarget?.(go);
                this.refresh(); // Refresh
                console.log(`Reverted changes for prefab selection: ${go.name}`);
            };
            revertBtn.title = isApplyTargetSelection
                ? 'Revert this prefab root from its source'
                : 'Revert the selected subtree from the chosen target prefab';

            const targetSelectorRow = document.createElement('div');
            targetSelectorRow.style.display = 'flex';
            targetSelectorRow.style.alignItems = 'center';
            targetSelectorRow.style.gap = '6px';
            targetSelectorRow.style.padding = '5px 10px';
            targetSelectorRow.style.backgroundColor = 'rgba(255,255,255,0.02)';
            targetSelectorRow.style.borderBottom = '1px solid rgba(79, 164, 255, 0.12)';

            const targetLabel = document.createElement('span');
            targetLabel.style.fontSize = '9px';
            targetLabel.style.color = 'var(--unity-text-dim)';
            targetLabel.innerText = 'Apply Target';
            targetSelectorRow.appendChild(targetLabel);

            const targetSelect = document.createElement('select');
            targetSelect.className = 'unity-select';
            targetSelect.style.flex = '1';
            targetSelect.style.fontSize = '10px';
            targetSelect.style.height = '20px';
            targetSelect.style.padding = '0 4px';
            targetSelect.innerHTML = prefabContext.applyTargetOptions
                .map((option: Record<string, any>) =>
                    `<option value="${option.id}" ${option.id === prefabContext.applyTargetRoot.id ? 'selected' : ''}>${option.depth === 0 ? 'Nearest' : `Outer ${option.depth}`} - ${option.label}</option>`
                )
                .join('');
            targetSelect.onchange = () => {
                editor?.setPrefabApplyTargetRoot?.(go, targetSelect.value);
            };
            targetSelectorRow.appendChild(targetSelect);
            content.insertBefore(targetSelectorRow, header);

            if (prefabContext.applyTargetOptions.length > 1) {
                const chainRow = document.createElement('div');
                chainRow.style.display = 'flex';
                chainRow.style.alignItems = 'flex-start';
                chainRow.style.gap = '6px';
                chainRow.style.padding = '5px 10px';
                chainRow.style.backgroundColor = 'rgba(255,255,255,0.015)';
                chainRow.style.borderBottom = '1px solid rgba(79, 164, 255, 0.08)';

                const chainLabel = document.createElement('span');
                chainLabel.style.fontSize = '9px';
                chainLabel.style.color = 'var(--unity-text-dim)';
                chainLabel.style.marginTop = '2px';
                chainLabel.innerText = 'Owners';
                chainRow.appendChild(chainLabel);

                const chainButtons = document.createElement('div');
                chainButtons.style.display = 'flex';
                chainButtons.style.flexWrap = 'wrap';
                chainButtons.style.gap = '4px';
                chainButtons.style.flex = '1';

                prefabContext.applyTargetOptions.forEach((option: Record<string, any>) => {
                    const pill = document.createElement('button');
                    pill.className = 'unity-button';
                    pill.style.fontSize = '9px';
                    pill.style.padding = '1px 6px';
                    pill.style.opacity = option.id === prefabContext.applyTargetRoot.id ? '1' : '0.8';
                    pill.style.borderColor = option.id === prefabContext.applyTargetRoot.id ? 'rgba(79, 164, 255, 0.7)' : '';
                    pill.innerText = option.depth === 0 ? `Nearest: ${option.label}` : `Outer ${option.depth}: ${option.label}`;
                    pill.title = option.id === prefabContext.applyTargetRoot.id
                        ? 'Current apply target'
                        : 'Switch apply target to this owner';
                    pill.onclick = () => {
                        editor?.setPrefabApplyTargetRoot?.(go, option.id);
                    };
                    chainButtons.appendChild(pill);
                });

                chainRow.appendChild(chainButtons);
                content.insertBefore(chainRow, header);
            }

            if (overrideSummary.total > 0) {
                const overrideSection = document.createElement('div');
                overrideSection.className = 'inspector-section';
                const overrideContent = document.createElement('div');
                overrideContent.className = 'section-content';
                overrideContent.style.padding = '8px';
                overrideSection.appendChild(overrideContent);
                content.insertBefore(overrideSection, header);

                const heading = document.createElement('div');
                heading.style.fontWeight = 'bold';
                heading.style.fontSize = '12px';
                heading.style.marginBottom = '4px';
                heading.innerText = 'Prefab Overrides';
                overrideContent.appendChild(heading);

                const scope = document.createElement('div');
                scope.style.fontSize = '9px';
                scope.style.color = 'var(--unity-text-dim)';
                scope.style.marginBottom = '8px';
                scope.innerText = isContextRoot
                    ? `Apply target: ${prefabContext.assetLabel}`
                    : `Apply target: ${prefabContext.assetLabel} > ${prefabContext.nodeLabel}${isApplyTargetSelection ? '' : ' | Top bar now applies the selected subtree to this target'}`;
                overrideContent.appendChild(scope);

                const groupedEntries = editor?.getPrefabOverrideGroups?.(go) ?? [];
                const allEntries = groupedEntries.flatMap((group: Record<string, any>) => group.entries ?? []);
                const bulkEntries = editor?.getBulkPrefabOverrideEntries?.(go, allEntries) ?? allEntries;

                const bulkToolbar = document.createElement('div');
                bulkToolbar.style.display = 'flex';
                bulkToolbar.style.alignItems = 'center';
                bulkToolbar.style.justifyContent = 'space-between';
                bulkToolbar.style.gap = '8px';
                bulkToolbar.style.padding = '4px 0 8px';
                bulkToolbar.style.borderBottom = '1px solid rgba(255,255,255,0.05)';

                const bulkSummary = document.createElement('div');
                bulkSummary.style.fontSize = '9px';
                bulkSummary.style.color = 'var(--unity-text-dim)';
                bulkSummary.innerText = bulkEntries.length === allEntries.length
                    ? `${allEntries.length} listed override${allEntries.length === 1 ? '' : 's'}`
                    : `${allEntries.length} listed, ${bulkEntries.length} bulk action${bulkEntries.length === 1 ? '' : 's'}`;
                bulkToolbar.appendChild(bulkSummary);

                const bulkButtons = document.createElement('div');
                bulkButtons.style.display = 'flex';
                bulkButtons.style.gap = '4px';

                const applyAllBtn = document.createElement('button');
                applyAllBtn.className = 'unity-button';
                applyAllBtn.style.fontSize = '9px';
                applyAllBtn.style.padding = '1px 6px';
                applyAllBtn.innerText = 'Apply Listed';
                applyAllBtn.onclick = () => {
                    editor?.applyAllPrefabOverrides?.(go, 'apply', allEntries);
                };

                const revertAllBtn = document.createElement('button');
                revertAllBtn.className = 'unity-button';
                revertAllBtn.style.fontSize = '9px';
                revertAllBtn.style.padding = '1px 6px';
                revertAllBtn.innerText = 'Revert Listed';
                revertAllBtn.onclick = () => {
                    editor?.applyAllPrefabOverrides?.(go, 'revert', allEntries);
                };

                bulkButtons.appendChild(applyAllBtn);
                bulkButtons.appendChild(revertAllBtn);
                bulkToolbar.appendChild(bulkButtons);
                overrideContent.appendChild(bulkToolbar);

                groupedEntries.forEach((group: Record<string, any>) => {
                    const section = document.createElement('div');
                    section.style.paddingTop = '8px';

                    const sectionHeader = document.createElement('div');
                    sectionHeader.style.display = 'flex';
                    sectionHeader.style.alignItems = 'center';
                    sectionHeader.style.justifyContent = 'space-between';
                    sectionHeader.style.gap = '8px';
                    sectionHeader.style.marginBottom = '4px';

                    const sectionTitle = document.createElement('div');
                    sectionTitle.style.fontSize = '10px';
                    sectionTitle.style.fontWeight = 'bold';
                    sectionTitle.style.color = 'var(--unity-text-dim)';
                    sectionTitle.innerText = `${group.label} (${group.entries.length})`;
                    sectionHeader.appendChild(sectionTitle);

                    const sectionButtons = document.createElement('div');
                    sectionButtons.style.display = 'flex';
                    sectionButtons.style.gap = '4px';

                    const applyGroupBtn = document.createElement('button');
                    applyGroupBtn.className = 'unity-button';
                    applyGroupBtn.style.fontSize = '9px';
                    applyGroupBtn.style.padding = '1px 6px';
                    applyGroupBtn.innerText = 'Apply All';
                    applyGroupBtn.onclick = () => {
                        editor?.applyAllPrefabOverrides?.(go, 'apply', group.entries);
                    };

                    const revertGroupBtn = document.createElement('button');
                    revertGroupBtn.className = 'unity-button';
                    revertGroupBtn.style.fontSize = '9px';
                    revertGroupBtn.style.padding = '1px 6px';
                    revertGroupBtn.innerText = 'Revert All';
                    revertGroupBtn.onclick = () => {
                        editor?.applyAllPrefabOverrides?.(go, 'revert', group.entries);
                    };

                    sectionButtons.appendChild(applyGroupBtn);
                    sectionButtons.appendChild(revertGroupBtn);
                    sectionHeader.appendChild(sectionButtons);
                    section.appendChild(sectionHeader);

                    group.entries.forEach((entry: Record<string, any>) => {
                        const row = document.createElement('div');
                        row.style.display = 'flex';
                        row.style.alignItems = 'center';
                        row.style.justifyContent = 'space-between';
                        row.style.gap = '8px';
                        row.style.padding = '4px 0';
                        row.style.borderTop = '1px solid rgba(255,255,255,0.04)';

                        const labelWrap = document.createElement('div');
                        labelWrap.style.display = 'flex';
                        labelWrap.style.flexDirection = 'column';
                        labelWrap.style.gap = '1px';
                        labelWrap.style.minWidth = '0';

                        const primary = document.createElement('div');
                        primary.style.fontSize = '11px';
                        primary.style.color = 'var(--unity-text)';
                        primary.innerText = entry.label;
                        labelWrap.appendChild(primary);

                        const secondary = document.createElement('div');
                        secondary.style.fontSize = '9px';
                        secondary.style.color = 'var(--unity-text-dim)';
                        const changeText =
                            entry.kind === 'component-added'
                                ? 'Added on instance'
                                : entry.kind === 'component-removed'
                                    ? 'Missing from instance'
                                    : entry.kind === 'child-added'
                                        ? 'Child added on instance'
                                        : entry.kind === 'child-removed'
                                            ? 'Child missing from instance'
                                            : 'Differs from prefab source';
                        const targetText = entry.targetAssetLabel
                            ? `Apply to ${entry.targetAssetLabel}${entry.targetNodeLabel ? ` > ${entry.targetNodeLabel}` : ''}`
                            : null;
                        secondary.innerText = targetText ? `${changeText} | ${targetText}` : changeText;
                        labelWrap.appendChild(secondary);

                        const buttonWrap = document.createElement('div');
                        buttonWrap.style.display = 'flex';
                        buttonWrap.style.gap = '4px';

                        const applyBtn = document.createElement('button');
                        applyBtn.className = 'unity-button';
                        applyBtn.style.fontSize = '9px';
                        applyBtn.style.padding = '1px 6px';
                        applyBtn.innerText = 'Apply';
                        applyBtn.onclick = () => {
                            editor?.applyPrefabOverrideAction?.(go, entry, 'apply');
                        };

                        const actionBtn = document.createElement('button');
                        actionBtn.className = 'unity-button';
                        actionBtn.style.fontSize = '9px';
                        actionBtn.style.padding = '1px 6px';
                        actionBtn.innerText =
                            entry.kind === 'component-added'
                                ? 'Remove'
                                : entry.kind === 'component-removed'
                                    ? 'Restore'
                                    : entry.kind === 'child-added'
                                        ? 'Remove'
                                        : entry.kind === 'child-removed'
                                            ? 'Restore'
                                            : 'Revert';
                        actionBtn.onclick = () => {
                            editor?.applyPrefabOverrideAction?.(go, entry, 'revert');
                        };

                        row.appendChild(labelWrap);
                        buttonWrap.appendChild(applyBtn);
                        buttonWrap.appendChild(actionBtn);
                        row.appendChild(buttonWrap);
                        section.appendChild(row);
                    });

                    overrideContent.appendChild(section);
                });
            }
        }

        const nameInput = header.querySelector('#go-name') as HTMLInputElement;
        nameInput.onchange = () => {
            CommandHistory.execute(new SetPropertyCommand(go, 'name', nameInput.value, `Rename ${go.name}`, () => this.refresh()));
        };

        const enabledCheck = header.querySelector('#go-enabled') as HTMLInputElement;
        enabledCheck.indeterminate = isEnabledMixed;
        enabledCheck.onchange = () => {
            this.executeEnabledChangeForSelection(go, enabledCheck.checked);
        };
        const staticCheck = header.querySelector('#go-static') as HTMLInputElement;
        staticCheck.indeterminate = isStaticMixed;
        staticCheck.onchange = () => {
            this.executeStaticChangeForSelection(go, staticCheck.checked);
        };

        const tagSelect = header.querySelector('#go-tag') as HTMLSelectElement;
        tagSelect.dataset.prevValue = isTagMixed ? '__mixed__' : (go.tag || 'Untagged');
        tagSelect.onchange = () => {
            const selectedValue = tagSelect.value;
            if (selectedValue === '__mixed__') return;
            if (selectedValue === '__add_tag__') {
                ProjectSettingsWindow.showSection('Tags & Layers');
                this.refresh();
                return;
            }
            this.executeTagChangeForSelection(go, selectedValue);
        };

        const layerSelect = header.querySelector('#go-layer') as HTMLSelectElement;
        layerSelect.dataset.prevValue = isLayerMixed ? '__mixed__' : String(Math.max(0, Math.min(31, go.layer | 0)));
        layerSelect.onchange = () => {
            const selectedValue = layerSelect.value;
            if (selectedValue === '__mixed__') return;
            if (selectedValue === '__add_layer__') {
                ProjectSettingsWindow.showSection('Tags & Layers');
                this.refresh();
                return;
            }

            const nextLayer = parseInt(selectedValue, 10);
            if (!Number.isFinite(nextLayer)) return;
            this.executeLayerChangeWithHierarchyOption(go, nextLayer);
        };

        // Components
        go.components.forEach(comp => {
            const compId = comp.id;
            const isCollapsed = this.collapsedComponents.has(compId);
            // @ts-ignore
            const componentOverrideStatus = window.Editor?.instance?.getPrefabComponentStatus?.(comp) ?? 'default';

            const compContainer = document.createElement('div');
            compContainer.className = 'unity-component-container';
            compContainer.style.marginBottom = '2px';
            content.appendChild(compContainer);

            // Header
            const header = document.createElement('div');
            header.className = 'unity-component-header';
            header.style.display = 'flex';
            header.style.alignItems = 'center';
            header.style.padding = '2px 4px';
            header.style.background = 'var(--unity-component-header)';
            header.style.border = '1px solid var(--unity-border)';
            header.style.cursor = 'grab';
            header.style.fontSize = '11px';
            header.style.fontWeight = 'bold';
            header.draggable = comp.constructor.name !== 'Transform' && comp.constructor.name !== 'RectTransform';

            header.ondragstart = (e) => {
                header.style.opacity = '0.5';
                const compIdx = go.components.indexOf(comp);
                e.dataTransfer!.setData('text/plain', JSON.stringify({ type: 'component-reorder', index: compIdx }));
            };

            header.ondragend = () => {
                header.style.opacity = '1';
                this.refresh();
            };

            compContainer.ondragover = (e) => {
                e.preventDefault();
                compContainer.style.borderTop = '2px solid var(--unity-accent)';
            };

            compContainer.ondragleave = () => {
                compContainer.style.borderTop = 'none';
            };

            compContainer.ondrop = (e) => {
                e.preventDefault();
                compContainer.style.borderTop = 'none';
                try {
                    const data = JSON.parse(e.dataTransfer!.getData('text/plain'));
                    if (data.type === 'component-reorder') {
                        const fromIdx = data.index;
                        const toIdx = go.components.indexOf(comp);
                        if (fromIdx !== toIdx) {
                            CommandHistory.execute(new ReorderComponentCommand(go, fromIdx, toIdx));
                            this.refresh();
                        }
                    }
                } catch (err) { }
            };

            const foldout = document.createElement('span');
            foldout.innerText = isCollapsed ? '►' : '▼';
            foldout.style.width = '12px';
            foldout.style.fontSize = '8px';
            foldout.style.opacity = '0.5';
            header.appendChild(foldout);

            const enabledCheck = document.createElement('input');
            enabledCheck.type = 'checkbox';
            enabledCheck.checked = comp.enabled;
            enabledCheck.style.marginRight = '6px';
            enabledCheck.onclick = (e) => {
                e.stopPropagation();
                CommandHistory.execute(new SetPropertyCommand(comp, 'enabled', enabledCheck.checked, `Toggle ${comp.constructor.name}`, () => {
                    if (comp.enabled) comp.onEnable(); else comp.onDisable();
                    this.refresh();
                }));
            };
            header.appendChild(enabledCheck);

            const name = document.createElement('span');
            name.innerText = comp.constructor.name;
            header.appendChild(name);

            if (componentOverrideStatus !== 'default') {
                const badge = document.createElement('span');
                const isAddedBadge = componentOverrideStatus === 'added';
                badge.innerText = isAddedBadge ? 'Added' : 'Override';
                badge.dataset.overrideStatus = componentOverrideStatus;
                badge.style.marginLeft = '6px';
                badge.style.padding = '0 5px';
                badge.style.fontSize = '9px';
                badge.style.lineHeight = '14px';
                badge.style.borderRadius = '2px';
                badge.style.fontWeight = '700';
                badge.style.letterSpacing = '0.02em';
                badge.style.textTransform = 'uppercase';
                badge.style.color = isAddedBadge ? '#c6f6d5' : '#d6ebff';
                badge.style.background = isAddedBadge
                    ? 'rgba(56, 161, 105, 0.28)'
                    : 'rgba(79, 164, 255, 0.22)';
                badge.style.border = isAddedBadge
                    ? '1px dashed rgba(56, 161, 105, 0.55)'
                    : '1px solid rgba(79, 164, 255, 0.45)';
                header.appendChild(badge);
            }

            const spacer = document.createElement('div');
            spacer.style.flex = '1';
            header.appendChild(spacer);

            // Component action buttons
            const buttonsContainer = document.createElement('div');
            buttonsContainer.style.cssText = 'display: flex; gap: 2px; margin-right: 4px;';

            // Move Up button
            const moveUpBtn = document.createElement('button');
            moveUpBtn.innerText = '▲';
            moveUpBtn.title = 'Move component up';
            moveUpBtn.style.cssText = 'background: none; border: none; color: #aaa; cursor: pointer; font-size: 10px; padding: 0 2px; opacity: 0.6;';
            moveUpBtn.onmouseenter = () => moveUpBtn.style.opacity = '1';
            moveUpBtn.onmouseleave = () => moveUpBtn.style.opacity = '0.6';
            moveUpBtn.onclick = (e) => {
                e.stopPropagation();
                const idx = go.components.indexOf(comp);
                if (idx > 1) { // 0 is usually Transform
                    CommandHistory.execute(new ReorderComponentCommand(go, idx, idx - 1));
                    this.refresh();
                }
            };
            buttonsContainer.appendChild(moveUpBtn);

            // Move Down button
            const moveDownBtn = document.createElement('button');
            moveDownBtn.innerText = '▼';
            moveDownBtn.title = 'Move component down';
            moveDownBtn.style.cssText = 'background: none; border: none; color: #aaa; cursor: pointer; font-size: 10px; padding: 0 2px; opacity: 0.6;';
            moveDownBtn.onmouseenter = () => moveDownBtn.style.opacity = '1';
            moveDownBtn.onmouseleave = () => moveDownBtn.style.opacity = '0.6';
            moveDownBtn.onclick = (e) => {
                e.stopPropagation();
                const idx = go.components.indexOf(comp);
                if (idx < go.components.length - 1) {
                    CommandHistory.execute(new ReorderComponentCommand(go, idx, idx + 1));
                    this.refresh();
                }
            };
            buttonsContainer.appendChild(moveDownBtn);

            // Copy button
            const copyBtn = document.createElement('button');
            copyBtn.innerText = '📋';
            copyBtn.title = 'Copy component';
            copyBtn.style.cssText = 'background: none; border: none; color: #aaa; cursor: pointer; font-size: 12px; padding: 0 2px; opacity: 0.6;';
            copyBtn.onmouseenter = () => copyBtn.style.opacity = '1';
            copyBtn.onmouseleave = () => copyBtn.style.opacity = '0.6';
            copyBtn.onclick = (e) => {
                e.stopPropagation();
                this.copiedComponentData = comp.serialize?.() || {};
                this.copiedComponentType = comp.constructor.name;
                copyBtn.style.opacity = '1';
                copyBtn.style.color = '#4fa3ff';
                setTimeout(() => {
                    copyBtn.style.color = '#aaa';
                    copyBtn.style.opacity = '0.6';
                }, 1000);
            };
            buttonsContainer.appendChild(copyBtn);

            // Paste button
            const pasteBtn = document.createElement('button');
            pasteBtn.innerText = '📌';
            pasteBtn.title = 'Paste component';
            pasteBtn.style.cssText = 'background: none; border: none; color: #aaa; cursor: pointer; font-size: 12px; padding: 0 2px; opacity: 0.6;';
            pasteBtn.onmouseenter = () => pasteBtn.style.opacity = this.copiedComponentType ? '1' : '0.3';
            pasteBtn.onmouseleave = () => pasteBtn.style.opacity = this.copiedComponentType ? '0.6' : '0.3';
            pasteBtn.onclick = (e) => {
                e.stopPropagation();
                if (this.copiedComponentType && this.copiedComponentData) {
                    const ComponentClass = ScriptRegistry.getComponentClass(this.copiedComponentType);
                    if (ComponentClass && !go.components.find(c => c.constructor.name === this.copiedComponentType)) {
                        const newComp = go.addComponent(ComponentClass);
                        if (newComp.deserialize) {
                            newComp.deserialize(this.copiedComponentData.data || {});
                        }
                        CommandHistory.execute(new AddComponentCommand(go, ComponentClass));
                        this.refresh();
                    }
                }
            };
            if (!this.copiedComponentType) pasteBtn.style.opacity = '0.3';
            buttonsContainer.appendChild(pasteBtn);

            header.appendChild(buttonsContainer);

            const menuBtn = document.createElement('span');
            menuBtn.innerText = '⋮';
            menuBtn.style.padding = '0 4px';
            menuBtn.style.cursor = 'pointer';
            menuBtn.style.opacity = '0.5';
            menuBtn.onclick = (e) => {
                e.stopPropagation();
                this.showComponentContextMenu(menuBtn, go, comp);
            };
            header.appendChild(menuBtn);

            header.onclick = () => {
                if (isCollapsed) this.collapsedComponents.delete(compId);
                else this.collapsedComponents.add(compId);
                this.saveCollapsedStateForGameObject(go.id);
                this.refresh();
            };

            compContainer.appendChild(header);

            if (!isCollapsed) {
                const sectionContent = document.createElement('div');
                sectionContent.className = 'unity-component-content';
                sectionContent.style.padding = '8px';
                sectionContent.style.background = 'var(--unity-bg-panel)';
                sectionContent.style.border = '1px solid var(--unity-border)';
                sectionContent.style.borderTop = 'none';
                compContainer.appendChild(sectionContent);

                // Render specialized or auto inspector
                const compName = comp.constructor.name;
                if (compName === 'Transform') {
                    this.inspectors.createTransformInspector(sectionContent, comp);
                    // Hide checkbox and menu for Transform
                    enabledCheck.style.display = 'none';
                    menuBtn.style.display = 'none';
                } else if (compName === 'RectTransform') {
                    this.inspectors.createRectTransformInspector(sectionContent, comp);
                    enabledCheck.style.display = 'none';
                    menuBtn.style.display = 'none';
                } else if (compName === 'Canvas') {
                    this.inspectors.createCanvasInspector(sectionContent, comp);
                } else if (compName === 'CanvasGroup') {
                    this.inspectors.createCanvasGroupInspector(sectionContent, comp);
                } else if (compName === 'GraphicRaycaster') {
                    this.inspectors.createGraphicRaycasterInspector(sectionContent, comp);
                } else if (compName === 'EventSystem') {
                    this.inspectors.createEventSystemInspector(sectionContent, comp);
                } else if (compName === 'UIImage') {
                    this.inspectors.createUIImageInspector(sectionContent, comp);
                } else if (compName === 'UIButton') {
                    this.inspectors.createUIButtonInspector(sectionContent, comp);
                } else if (compName === 'UIInputField') {
                    this.inspectors.createUIInputFieldInspector(sectionContent, comp);
                } else if (compName === 'UIDropdown') {
                    this.inspectors.createUIDropdownInspector(sectionContent, comp);
                } else if (compName === 'ToggleGroup') {
                    this.inspectors.createToggleGroupInspector(sectionContent, comp);
                } else if (compName === 'UIToggle') {
                    this.inspectors.createUIToggleInspector(sectionContent, comp);
                } else if (compName === 'UISlider') {
                    this.inspectors.createUISliderInspector(sectionContent, comp);
                } else if (compName === 'UIScrollbar') {
                    this.inspectors.createUIScrollbarInspector(sectionContent, comp);
                } else if (compName === 'UIScrollRect') {
                    this.inspectors.createUIScrollRectInspector(sectionContent, comp);
                } else if (compName === 'UIText') {
                    this.inspectors.createUITextInspector(sectionContent, comp);
                } else if (compName === 'VerticalLayoutGroup') {
                    this.inspectors.createVerticalLayoutGroupInspector(sectionContent, comp);
                } else if (compName === 'HorizontalLayoutGroup') {
                    this.inspectors.createHorizontalLayoutGroupInspector(sectionContent, comp);
                } else if (compName === 'ContentSizeFitter') {
                    this.inspectors.createContentSizeFitterInspector(sectionContent, comp);
                } else if (compName === 'Camera') {
                    this.inspectors.createCameraInspector(sectionContent, comp);
                } else if (compName === 'Light') {
                    this.inspectors.createLightInspector(sectionContent, comp);
                } else if (compName === 'ParticleSystem') {
                    this.inspectors.createParticleSystemInspector(sectionContent, comp);
                } else if (compName === 'AudioSource') {
                    this.inspectors.createAudioSourceInspector(sectionContent, comp);
                } else if (compName === 'AudioListener') {
                    this.inspectors.createAudioListenerInspector(sectionContent, comp);
                } else if (compName === 'Animator') {
                    this.inspectors.createAnimatorInspector(sectionContent, comp);
                } else if (compName === 'MeshFilter') {
                    this.inspectors.createMeshFilterInspector(sectionContent, comp);
                } else if (compName === 'MeshRenderer') {
                    this.inspectors.createMeshRendererInspector(sectionContent, comp);
                } else if (compName === 'RigidBody') {
                    this.inspectors.createRigidBodyInspector(sectionContent, comp);
                } else if (compName === 'BoxCollider' || compName === 'SphereCollider') {
                    this.inspectors.createColliderInspector(sectionContent, comp);
                } else {
                    this.inspectors.createAutoInspector(sectionContent, comp);
                }
            }
        });

        // Add Component Button
        const addComponentBtnContainer = document.createElement('div');
        addComponentBtnContainer.style.cssText = 'padding: 20px 40px; display: flex; justify-content: center;';

        const addComponentBtn = document.createElement('button');
        addComponentBtn.innerText = 'Add Component';
        addComponentBtn.className = 'unity-button';
        addComponentBtn.style.cssText = 'padding: 6px 20px; font-size: 13px; width: 100%; max-width: 200px;';

        addComponentBtn.onclick = (e) => {
            e.stopPropagation();
            this.showAddComponentMenu(addComponentBtn, go);
        };

        addComponentBtnContainer.appendChild(addComponentBtn);
        content.appendChild(addComponentBtnContainer);
    }

    private renderLayerImpactSummary(go: GameObject, container: HTMLElement): void {
        const summary = this.getLayerImpactSummary(go);
        container.innerHTML = '';

        const title = document.createElement('div');
        title.style.cssText = 'font-size: 10px; font-weight: bold; color: var(--unity-text-dim); margin-bottom: 3px;';
        title.innerText = 'Layer Impact';
        container.appendChild(title);

        const statRow = document.createElement('div');
        statRow.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';

        const renderPill = document.createElement('span');
        renderPill.style.cssText = `
            font-size: 9px; padding: 1px 6px; border-radius: 999px;
            border: 1px solid ${summary.visibleCameraCount > 0 ? 'rgba(95,186,117,0.6)' : 'rgba(186,122,95,0.6)'};
            color: ${summary.visibleCameraCount > 0 ? '#8fd8a0' : '#f0b59b'};
            background: ${summary.visibleCameraCount > 0 ? 'rgba(95,186,117,0.12)' : 'rgba(186,122,95,0.12)'};
        `;
        renderPill.innerText = `Render: ${summary.visibleCameraCount}/${summary.totalCameraCount} camera`;
        statRow.appendChild(renderPill);

        const physicsPill = document.createElement('span');
        physicsPill.style.cssText = `
            font-size: 9px; padding: 1px 6px; border-radius: 999px;
            border: 1px solid ${summary.hasRigidBody ? 'rgba(95,150,230,0.6)' : 'rgba(140,140,140,0.6)'};
            color: ${summary.hasRigidBody ? '#a5c6ff' : 'var(--unity-text-dim)'};
            background: ${summary.hasRigidBody ? 'rgba(95,150,230,0.12)' : 'rgba(140,140,140,0.12)'};
        `;
        physicsPill.innerText = summary.hasRigidBody
            ? `Physics: ${summary.compatibleRigidBodyCount} RB candidate / ${summary.collidingLayerCount} layer`
            : 'Physics: no Rigidbody';
        statRow.appendChild(physicsPill);

        container.appendChild(statRow);

        const detail = document.createElement('div');
        detail.style.cssText = 'margin-top: 4px; font-size: 9px; color: var(--unity-text-dim); line-height: 1.35;';
        const cameraNames = summary.visibleCameraNames.length > 0
            ? summary.visibleCameraNames.slice(0, 3).join(', ')
            : 'none';
        const cameraSuffix = summary.visibleCameraNames.length > 3 ? ` +${summary.visibleCameraNames.length - 3}` : '';
        detail.innerText = `Cameras: ${cameraNames}${cameraSuffix} | Colliding Layers: ${summary.collidingLayerNames.length > 0 ? summary.collidingLayerNames.slice(0, 5).join(', ') : 'none'}`;
        container.appendChild(detail);
    }

    private getLayerImpactSummary(go: GameObject): {
        totalCameraCount: number;
        visibleCameraCount: number;
        visibleCameraNames: string[];
        hasRigidBody: boolean;
        compatibleRigidBodyCount: number;
        collidingLayerCount: number;
        collidingLayerNames: string[];
    } {
        const editor = (window as any).Editor?.instance;
        const scene = editor?.scene;
        const gameObjects: GameObject[] = Array.isArray(scene?.gameObjects) ? scene.gameObjects : [];
        const currentLayer = Math.max(0, Math.min(31, go.layer | 0));
        const layerManager = LayerManager.getInstance();

        const cameraEntries = gameObjects
            .map((sceneGO) => ({ go: sceneGO, camera: sceneGO.getComponent(Camera) }))
            .filter((entry) => Boolean(entry.camera && entry.go.enabled && entry.camera.enabled)) as Array<{ go: GameObject; camera: Camera }>;
        const visibleCameraNames = cameraEntries
            .filter((entry) => entry.camera.isLayerVisible(currentLayer))
            .map((entry) => entry.go.name);

        const collidingLayerNames = layerManager
            .getNamedLayers()
            .filter((layer) => layerManager.getLayerCollision(currentLayer, layer.index))
            .map((layer) => layer.name);

        const selfRigidBody = go.getComponent(RigidBody);
        const compatibleRigidBodyCount = selfRigidBody
            ? gameObjects
                .filter((sceneGO) => sceneGO !== go && sceneGO.enabled)
                .map((sceneGO) => ({ go: sceneGO, rb: sceneGO.getComponent(RigidBody) }))
                .filter((entry) => Boolean(entry.rb && entry.rb.enabled))
                .filter((entry) => layerManager.getLayerCollision(currentLayer, Math.max(0, Math.min(31, entry.go.layer | 0))))
                .length
            : 0;

        return {
            totalCameraCount: cameraEntries.length,
            visibleCameraCount: visibleCameraNames.length,
            visibleCameraNames,
            hasRigidBody: Boolean(selfRigidBody),
            compatibleRigidBodyCount,
            collidingLayerCount: collidingLayerNames.length,
            collidingLayerNames
        };
    }

    private applyGameObjectLayerRuntime(go: GameObject): void {
        const normalizedLayer = Math.max(0, Math.min(31, go.layer | 0));
        go.object3D.traverse((object3D: any) => {
            const owner = object3D?.userData?.gameObject as GameObject | undefined;
            const ownerLayer = owner ? Math.max(0, Math.min(31, owner.layer | 0)) : normalizedLayer;
            object3D.layers.set(ownerLayer);
        });

        const rigidBody = go.getComponent(RigidBody);
        if (rigidBody?.body) {
            PhysicsSystem.getInstance().applyLayerFilter(rigidBody);
        }
    }

    private executeLayerChangeWithHierarchyOption(go: GameObject, nextLayerRaw: number): void {
        const nextLayer = Math.max(0, Math.min(31, nextLayerRaw | 0));
        const baseTargets = this.getLayerChangeBaseTargets(go);
        const descendants = this.getDescendantGameObjectsForMany(baseTargets);
        const applyToChildren = descendants.length > 0
            ? window.confirm(`Apply layer "${LayerManager.getInstance().getLayerName(nextLayer)}" to ${descendants.length} child object(s) as well?`)
            : false;

        const targets: GameObject[] = applyToChildren
            ? this.uniqueGameObjects([...baseTargets, ...descendants])
            : this.uniqueGameObjects(baseTargets);
        const oldLayers = targets.map((target) => target.layer);
        const selectedCount = baseTargets.length;
        const commandName = applyToChildren
            ? `Change Layer ${go.name} (${selectedCount} selected + children)`
            : `Change Layer ${go.name} (${selectedCount} selected)`;

        CommandHistory.execute({
            name: commandName,
            execute: () => {
                targets.forEach((target) => {
                    target.layer = nextLayer;
                    this.applyGameObjectLayerRuntime(target);
                });
                this.refresh();
            },
            undo: () => {
                targets.forEach((target, index) => {
                    target.layer = oldLayers[index];
                    this.applyGameObjectLayerRuntime(target);
                });
                this.refresh();
            }
        });
    }

    private getDescendantGameObjects(root: GameObject): GameObject[] {
        const descendants: GameObject[] = [];
        const stack = [...root.transform.children];
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) continue;
            descendants.push(current.gameObject);
            for (const child of current.children) {
                stack.push(child);
            }
        }
        return descendants;
    }

    private getLayerChangeBaseTargets(primary: GameObject): GameObject[] {
        const selectedFromEditor = (window as any).Editor?.instance?.getSelectedGameObjects?.() as GameObject[] | undefined;
        if (!Array.isArray(selectedFromEditor) || selectedFromEditor.length === 0) {
            return [primary];
        }
        if (!selectedFromEditor.some((item) => item?.id === primary.id)) {
            return [primary];
        }
        return this.uniqueGameObjects(selectedFromEditor.filter((item) => item && item.scene));
    }

    private getTagChangeBaseTargets(primary: GameObject): GameObject[] {
        return this.getLayerChangeBaseTargets(primary);
    }

    private getStaticChangeBaseTargets(primary: GameObject): GameObject[] {
        return this.getLayerChangeBaseTargets(primary);
    }

    private getEnabledChangeBaseTargets(primary: GameObject): GameObject[] {
        return this.getLayerChangeBaseTargets(primary);
    }

    private getDescendantGameObjectsForMany(roots: GameObject[]): GameObject[] {
        const descendants: GameObject[] = [];
        roots.forEach((root) => {
            descendants.push(...this.getDescendantGameObjects(root));
        });
        return this.uniqueGameObjects(descendants);
    }

    private uniqueGameObjects(items: GameObject[]): GameObject[] {
        const byId = new Map<string, GameObject>();
        items.forEach((item) => {
            if (!item?.id) return;
            if (!byId.has(item.id)) byId.set(item.id, item);
        });
        return Array.from(byId.values());
    }

    private buildLayerOptionsHtml(layers: Array<{ index: number; name: string }>, selectedLayer: number, mixed: boolean = false): string {
        const layerMap = new Map<number, string>();
        layers.forEach((entry) => layerMap.set(entry.index, entry.name ?? ''));
        const normalizedSelected = Math.max(0, Math.min(31, selectedLayer | 0));

        let html = '';
        if (mixed) {
            html += '<option value="__mixed__" selected>-- Mixed --</option>';
        }
        for (let i = 0; i < 32; i++) {
            const rawName = layerMap.get(i) ?? '';
            const displayName = rawName.trim().length > 0 ? rawName : `Layer ${i}`;
            const selectedAttr = !mixed && i === normalizedSelected ? 'selected' : '';
            html += `<option value="${i}" ${selectedAttr}>${i}: ${displayName}</option>`;
        }
        html += '<option value="__add_layer__">Add Layer...</option>';
        return html;
    }

    private buildTagOptionsHtml(tags: string[], selectedTag: string, mixed: boolean = false): string {
        const normalizedSelected = selectedTag || 'Untagged';
        const uniqueTags = Array.from(new Set(tags.map((tag) => (tag || '').trim()).filter((tag) => tag.length > 0)));
        if (!uniqueTags.includes('Untagged')) {
            uniqueTags.unshift('Untagged');
        }

        let html = '';
        if (mixed) {
            html += '<option value="__mixed__" selected>-- Mixed --</option>';
        }
        uniqueTags.forEach((tag) => {
            const selectedAttr = !mixed && tag === normalizedSelected ? 'selected' : '';
            html += `<option value="${tag}" ${selectedAttr}>${tag}</option>`;
        });
        html += '<option value="__add_tag__">Add Tag...</option>';
        return html;
    }

    private executeTagChangeForSelection(primary: GameObject, nextTagRaw: string): void {
        const nextTag = (nextTagRaw || '').trim();
        if (!nextTag) return;
        const targets = this.getTagChangeBaseTargets(primary);
        const oldTags = targets.map((target) => target.tag);
        const selectedCount = targets.length;
        TagManager.getInstance().addTag(nextTag);

        CommandHistory.execute({
            name: `Change Tag ${primary.name} (${selectedCount} selected)`,
            execute: () => {
                targets.forEach((target) => {
                    target.tag = nextTag;
                });
                this.refresh();
            },
            undo: () => {
                targets.forEach((target, index) => {
                    target.tag = oldTags[index];
                });
                this.refresh();
            }
        });
    }

    private executeStaticChangeForSelection(primary: GameObject, nextStatic: boolean): void {
        const targets = this.getStaticChangeBaseTargets(primary);
        const oldValues = targets.map((target) => Boolean(target.isStatic));
        const selectedCount = targets.length;

        CommandHistory.execute({
            name: `Change Static ${primary.name} (${selectedCount} selected)`,
            execute: () => {
                targets.forEach((target) => {
                    target.isStatic = nextStatic;
                });
                this.refresh();
            },
            undo: () => {
                targets.forEach((target, index) => {
                    target.isStatic = oldValues[index];
                });
                this.refresh();
            }
        });
    }

    private executeEnabledChangeForSelection(primary: GameObject, nextEnabled: boolean): void {
        const targets = this.getEnabledChangeBaseTargets(primary);
        const oldValues = targets.map((target) => Boolean(target.enabled));
        const selectedCount = targets.length;

        CommandHistory.execute({
            name: `Toggle Active ${primary.name} (${selectedCount} selected)`,
            execute: () => {
                targets.forEach((target) => {
                    target.setActive(nextEnabled);
                });
                this.refresh();
            },
            undo: () => {
                targets.forEach((target, index) => {
                    target.setActive(oldValues[index]);
                });
                this.refresh();
            }
        });
    }

    private syncProjectTagsIntoTagManager(): void {
        const tm = TagManager.getInstance();
        const projectTags = Array.isArray(ProjectSettings.tags) ? ProjectSettings.tags : [];
        projectTags.forEach((tag) => {
            const normalized = (tag || '').trim();
            if (!normalized) return;
            tm.addTag(normalized);
        });
    }

    private getAllAvailableTags(): string[] {
        const managerTags = TagManager.getInstance().getTags();
        const projectTags = Array.isArray(ProjectSettings.tags) ? ProjectSettings.tags : [];
        const merged = [...managerTags, ...projectTags];
        const unique = Array.from(new Set(merged.map((tag) => (tag || '').trim()).filter((tag) => tag.length > 0)));
        if (!unique.includes('Untagged')) unique.unshift('Untagged');
        return unique;
    }

    private showAddComponentMenu(anchor: HTMLElement, go: GameObject): void {
        const rect = anchor.getBoundingClientRect();

        const menu = document.createElement('div');
        menu.id = 'add-component-menu';
        menu.style.cssText = `
            position: fixed; left: ${rect.left}px; top: ${rect.bottom + 2}px;
            width: 320px; background: #2d2d2d; border: 1px solid #555;
            z-index: 10000; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            border-radius: 3px; display: flex; flex-direction: column;
            max-height: 500px; overflow: hidden;
        `;

        // Header with categories and search
        const headerContainer = document.createElement('div');
        headerContainer.style.cssText = 'border-bottom: 1px solid #555; flex-shrink: 0;';
        menu.appendChild(headerContainer);

        // Category tabs
        const { ScriptRegistry: SR } = require('../engine/ScriptRegistry');
        const categoryTabs = document.createElement('div');
        categoryTabs.style.cssText = 'display: flex; gap: 2px; padding: 4px; background: #1a1a1a; overflow-x: auto;';
        headerContainer.appendChild(categoryTabs);

        const categories = ['All', ...Object.keys(SR.getComponentsByCategory()).filter(c => SR.getComponentsByCategory()[c].length > 0)] as const;
        let selectedCategory: string = 'All';

        categories.forEach(cat => {
            const tab = document.createElement('button');
            tab.innerText = cat;
            tab.style.cssText = `
                padding: 4px 8px; font-size: 11px; cursor: pointer; border: none;
                background: ${cat === 'All' ? '#555' : '#333'}; color: #eee;
                border-radius: 2px; white-space: nowrap;
            `;
            tab.onclick = () => {
                selectedCategory = cat;
                // Update tab styles
                Array.from(categoryTabs.children).forEach((t: any) => {
                    t.style.background = t === tab ? '#555' : '#333';
                });
                // Re-render list
                renderList(searchInput.value);
            };
            categoryTabs.appendChild(tab);
        });

        // Search input
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search components...';
        searchInput.style.cssText = `
            background: var(--unity-bg-input); color: var(--unity-text);
            border: none; padding: 6px 8px; font-size: 12px; outline: none;
        `;
        searchInput.oninput = () => renderList(searchInput.value);
        headerContainer.appendChild(searchInput);

        // Component list
        const listContainer = document.createElement('div');
        listContainer.style.cssText = 'overflow-y: auto; flex: 1;';
        menu.appendChild(listContainer);

        const existingComponents = go.components.map(c => c.constructor.name);

        const renderList = (filter: string) => {
            listContainer.innerHTML = '';

            if (selectedCategory === 'All') {
                const allComponents = SR.getAddableComponentNames().sort();
                const filtered = allComponents.filter((name: string) =>
                    name.toLowerCase().includes(filter.toLowerCase()) &&
                    name !== 'Transform' && name !== 'RectTransform'
                );
                this.renderComponentItems(listContainer, filtered, existingComponents, go);
            } else {
                const byCategory = SR.getComponentsByCategory();
                const components = byCategory[selectedCategory] || [];
                const filtered = components.filter((name: string) =>
                    name.toLowerCase().includes(filter.toLowerCase()) &&
                    name !== 'Transform' && name !== 'RectTransform'
                );
                this.renderComponentItems(listContainer, filtered, existingComponents, go);
            }
        };

        renderList('');

        document.body.appendChild(menu);
        searchInput.focus();

        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', handleDocClick);
        };

        const handleDocClick = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node) && e.target !== anchor) {
                closeMenu();
            }
        };

        setTimeout(() => document.addEventListener('click', handleDocClick), 0);
    }

    private renderComponentItems(container: HTMLElement, componentNames: string[], existingComponents: string[], go: GameObject): void {
        componentNames.forEach(name => {
            const item = document.createElement('div');
            item.innerText = name;
            item.style.cssText = `
                padding: 5px 12px; font-size: 12px; cursor: pointer; color: #eee;
                display: flex; justify-content: space-between; align-items: center;
            `;

            const isAlreadyPresent = existingComponents.includes(name);
            if (isAlreadyPresent) {
                item.style.opacity = '0.5';
                const check = document.createElement('span');
                check.innerText = '✓';
                check.style.fontSize = '10px';
                item.appendChild(check);
            }

            item.onmouseenter = () => { if (!isAlreadyPresent) item.style.background = '#3267ab'; };
            item.onmouseleave = () => item.style.background = 'transparent';

            item.onclick = () => {
                if (isAlreadyPresent) return;
                const compClass = ScriptRegistry.getComponentClass(name);
                if (compClass) {
                    CommandHistory.execute(new AddComponentCommand(go, compClass));
                    this.refresh();
                    const menu = document.getElementById('add-component-menu');
                    if (menu) menu.remove();
                }
            };

            container.appendChild(item);
        });

        if (componentNames.length === 0) {
            const msg = document.createElement('div');
            msg.innerText = 'No components found';
            msg.style.cssText = 'padding: 10px; font-size: 11px; color: #888; text-align: center;';
            container.appendChild(msg);
        }
    }

    private showComponentContextMenu(anchor: HTMLElement, go: GameObject, comp: any): void {
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.style.cssText = `
            position: fixed; left: ${rect.left - 120}px; top: ${rect.bottom}px;
            width: 150px; background: #2d2d2d; border: 1px solid #555;
            z-index: 10001; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            border-radius: 3px; padding: 4px 0;
        `;

    const addItem = (label: string, onClick: () => void) => {
        const item = document.createElement('div');
        item.innerText = label;
        item.style.cssText = 'padding: 5px 12px; font-size: 11px; cursor: pointer; color: #eee;';
        item.onmouseenter = () => item.style.background = '#3267ab';
        item.onmouseleave = () => item.style.background = 'transparent';
        item.onclick = () => {
            onClick();
            menu.remove();
        };
        menu.appendChild(item);
    };

    addItem('Reset', () => {
    if (comp.reset) comp.reset();
    this.refresh();
    console.log(`Reset component: ${comp.constructor.name}`);
});

addItem('Remove Component', () => {
    CommandHistory.execute(new RemoveComponentCommand(go, comp));
    this.refresh();
});

addItem('Move Up', () => {
    const idx = go.components.indexOf(comp);
    if (idx > 1) { // 0 is usually Transform
        CommandHistory.execute(new ReorderComponentCommand(go, idx, idx - 1));
        this.refresh();
    }
});

addItem('Move Down', () => {
    const idx = go.components.indexOf(comp);
    if (idx < go.components.length - 1) {
        CommandHistory.execute(new ReorderComponentCommand(go, idx, idx + 1));
        this.refresh();
    }
});

addItem('Copy Component', () => {
    (window as any).copiedComponentData = comp.serialize();
    console.log("Component copied");
});

addItem('Paste Component Values', () => {
    const data = (window as any).copiedComponentData;
    if (data && data.type === comp.constructor.name) {
        comp.deserialize(data.data);
        this.refresh();
    }
});

if (go.prefabSource) {
    this.addMenuSeparator(menu);
    addItem('Revert to Prefab', () => {
        PrefabManager.revertComponentToPrefab(go, comp);
        this.refresh();
        console.log(`Reverted component ${comp.constructor.name} to prefab`);
    });
}

document.body.appendChild(menu);
const close = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener('mousedown', close);
    }
};
setTimeout(() => document.addEventListener('mousedown', close), 0);
    }

    private addMenuSeparator(menu: HTMLElement) {
    const sep = document.createElement('div');
    sep.style.height = '1px';
    sep.style.background = 'var(--unity-border)';
    sep.style.margin = '4px 0';
    menu.appendChild(sep);
}

    private renderAssetInspector(content: HTMLElement, asset: ProjectAssetSelection): void {
    const header = document.createElement('div');
    header.className = 'inspector-header';
    header.innerHTML = `<div style="font-weight: bold; padding: 5px;">${asset.name} (${asset.meta.assetType})</div>`;
    content.appendChild(header);

    const infoSection = document.createElement('div');
    infoSection.className = 'inspector-section';
    const infoContent = document.createElement('div');
    infoContent.className = 'section-content';
    infoContent.style.padding = '8px';
    infoSection.appendChild(infoContent);
    content.appendChild(infoSection);

    this.appendReadonlyInfo(infoContent, 'Path', asset.path);
    this.appendReadonlyInfo(infoContent, 'GUID', asset.meta.guid);
    this.appendReadonlyInfo(infoContent, 'Importer', asset.meta.importer.name);

    this.inspectors.createUnityField(infoContent, 'Labels', 'text', asset.meta.labels.join(', '), (value) => {
        this.updateSelectedAssetMeta(asset, (meta) => {
            meta.labels = String(value)
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean);
        });
    });

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '6px';
    actions.style.marginTop = '10px';
    infoContent.appendChild(actions);

    const reimportBtn = document.createElement('button');
    reimportBtn.className = 'unity-button';
    reimportBtn.innerText = 'Reimport';
    reimportBtn.onclick = () => {
        // @ts-ignore
        const refreshed = window.Editor?.instance?.projectWindow?.reimportAsset(asset.path);
        if (refreshed) {
            this.selection = refreshed;
            this.refresh();
        }
    };
    actions.appendChild(reimportBtn);

    const reimportGraphBtn = document.createElement('button');
    reimportGraphBtn.className = 'unity-button';
    reimportGraphBtn.innerText = 'Reimport Graph';
    reimportGraphBtn.onclick = () => {
        // @ts-ignore
        const refreshed = window.Editor?.instance?.projectWindow?.reimportAssetWithDependents(asset.path);
        if (refreshed) {
            this.selection = refreshed;
            this.refresh();
        }
    };
    actions.appendChild(reimportGraphBtn);

    const validateRefsBtn = document.createElement('button');
    validateRefsBtn.className = 'unity-button';
    validateRefsBtn.innerText = 'Validate Refs';
    validateRefsBtn.onclick = () => {
        const result = (window as any).Editor?.instance?.projectWindow?.auditAssetReferences?.(asset.path) as AssetReferenceAuditResult | null;
        if (!result) {
            alert('No auditable references were found for this asset.');
            return;
        }
        alert(this.formatReferenceAuditSummary(result, 'Reference Validation'));
    };
    actions.appendChild(validateRefsBtn);

    const repairRefsBtn = document.createElement('button');
    repairRefsBtn.className = 'unity-button';
    repairRefsBtn.innerText = 'Auto Repair Refs';
    repairRefsBtn.onclick = () => {
        const result = (window as any).Editor?.instance?.projectWindow?.repairAssetReferences?.(asset.path) as AssetReferenceAuditResult | null;
        if (!result) {
            alert('No auditable references were found for this asset.');
            return;
        }
        alert(this.formatReferenceAuditSummary(result, 'Reference Auto Repair'));
        // @ts-ignore
        const refreshed = window.Editor?.instance?.projectWindow?.focusAssetByPath?.(asset.path);
        if (refreshed) {
            this.selection = refreshed;
            this.refresh();
        }
    };
    actions.appendChild(repairRefsBtn);

    const impactBtn = document.createElement('button');
    impactBtn.className = 'unity-button';
    impactBtn.innerText = 'Delete Impact';
    impactBtn.onclick = () => {
        const summary = (window as any).Editor?.instance?.projectWindow?.getDeleteImpactSummary?.(asset.path) as AssetDeleteImpactSummary | null;
        if (!summary) {
            alert('Impact summary is not available for this asset.');
            return;
        }
        alert(this.formatDeleteImpactSummary(summary, 'Delete Impact'));
    };
    actions.appendChild(impactBtn);

    const revealBtn = document.createElement('button');
    revealBtn.className = 'unity-button';
    revealBtn.innerText = 'Reveal';
    revealBtn.onclick = () => {
        (window as any).electronAPI?.revealInFolder?.(asset.path);
    };
    actions.appendChild(revealBtn);

    const projectWindow = (window as any).Editor?.instance?.projectWindow;
    const usedByPaths = projectWindow?.getAssetReferencerPaths
        ? projectWindow.getAssetReferencerPaths(asset.path)
        : [];
    const dependencyPaths = projectWindow?.getAssetDependencyPaths
        ? projectWindow.getAssetDependencyPaths(asset.path)
        : [];
    const referenceHealth = projectWindow?.auditAssetReferences
        ? projectWindow.auditAssetReferences(asset.path)
        : null;
    const deleteImpact = projectWindow?.getDeleteImpactSummary
        ? projectWindow.getDeleteImpactSummary(asset.path) as AssetDeleteImpactSummary | null
        : null;
    if(referenceHealth) {
        this.appendAssetReferenceHealthSection(content, referenceHealth);
    }
        if(deleteImpact) {
        this.appendAssetDeleteImpactSection(content, deleteImpact);
    }
        this.appendAssetReferenceSection(content, usedByPaths, dependencyPaths);

    const importSection = document.createElement('div');
    importSection.className = 'inspector-section';
    const importContent = document.createElement('div');
    importContent.className = 'section-content';
    importContent.style.padding = '8px';
    importSection.appendChild(importContent);
    content.appendChild(importSection);

    const importTitle = document.createElement('div');
    importTitle.style.fontWeight = 'bold';
    importTitle.style.fontSize = '12px';
    importTitle.style.marginBottom = '8px';
    importTitle.innerText = 'Import Settings';
    importContent.appendChild(importTitle);

    Object.entries(asset.meta.importer.settings).forEach(([key, value]) => {
        this.renderAssetImportSettingField(importContent, asset, key, value);
    });

    if(asset.payload?.constructor?.name === 'Material') {
    this.appendEmbeddedSection(content, 'Material Asset', (sectionContent) => {
        this.inspectors.createMaterialInspector(sectionContent, asset.payload);
    });
} else if (asset.payload instanceof ScriptableObject) {
    this.appendEmbeddedSection(content, `${asset.payload.typeName} Asset`, (sectionContent) => {
        this.inspectors.createScriptableObjectInspector(sectionContent, asset.payload);
    });
}
    }

    private updateSelectedAssetMeta(asset: ProjectAssetSelection, updater: (meta: AssetMeta) => void) {
    // @ts-ignore
    const nextMeta = window.Editor?.instance?.projectWindow?.updateAssetMeta(asset.path, updater);
    if (!nextMeta) return;
    asset.meta = nextMeta;
    this.selection = asset;
    this.refresh();
}

    private appendReadonlyInfo(parent: HTMLElement, label: string, value: string) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'flex-start';
    row.style.gap = '8px';
    row.style.marginBottom = '6px';

    const labelEl = document.createElement('div');
    labelEl.style.width = '70px';
    labelEl.style.fontSize = '11px';
    labelEl.style.color = 'var(--unity-text-dim)';
    labelEl.innerText = label;

    const valueEl = document.createElement('div');
    valueEl.style.flex = '1';
    valueEl.style.fontSize = '11px';
    valueEl.style.wordBreak = 'break-all';
    valueEl.innerText = value;

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    parent.appendChild(row);
}

    private appendEmbeddedSection(parent: HTMLElement, title: string, render: (content: HTMLElement) => void) {
    const section = document.createElement('div');
    section.className = 'inspector-section';
    const sectionContent = document.createElement('div');
    sectionContent.className = 'section-content';
    sectionContent.style.padding = '8px';
    section.appendChild(sectionContent);
    parent.appendChild(section);

    const heading = document.createElement('div');
    heading.style.fontWeight = 'bold';
    heading.style.fontSize = '12px';
    heading.style.marginBottom = '8px';
    heading.innerText = title;
    sectionContent.appendChild(heading);

    render(sectionContent);
}

    private appendAssetReferenceHealthSection(parent: HTMLElement, result: AssetReferenceAuditResult) {
    const section = document.createElement('div');
    section.className = 'inspector-section';
    const sectionContent = document.createElement('div');
    sectionContent.className = 'section-content';
    sectionContent.style.padding = '8px';
    section.appendChild(sectionContent);
    parent.appendChild(section);

    const heading = document.createElement('div');
    heading.style.fontWeight = 'bold';
    heading.style.fontSize = '12px';
    heading.style.marginBottom = '8px';
    heading.innerText = 'Reference Health';
    sectionContent.appendChild(heading);

    this.appendReadonlyInfo(sectionContent, 'Scanned', `${result.scannedPairs} refs / ${result.scannedAssets} assets`);
    this.appendReadonlyInfo(sectionContent, 'Issues', String(result.issues));
    this.appendReadonlyInfo(sectionContent, 'Fixable', String(result.fixable));
    this.appendReadonlyInfo(sectionContent, 'Unresolved', String(result.unresolved));

    if (result.sampleIssues.length > 0) {
        const samplesTitle = document.createElement('div');
        samplesTitle.style.fontSize = '11px';
        samplesTitle.style.fontWeight = 'bold';
        samplesTitle.style.color = 'var(--unity-text-dim)';
        samplesTitle.style.marginTop = '4px';
        samplesTitle.style.marginBottom = '4px';
        samplesTitle.innerText = 'Sample Issues';
        sectionContent.appendChild(samplesTitle);

        result.sampleIssues.slice(0, 6).forEach((issue) => {
            const issueRow = document.createElement('div');
            issueRow.style.fontSize = '10px';
            issueRow.style.marginBottom = '4px';
            issueRow.style.wordBreak = 'break-all';
            issueRow.style.color = issue.fixable ? '#d8c07a' : '#ff7f7f';
            issueRow.innerText = `${this.formatIssuePath(issue)} [${issue.reason}]`;
            sectionContent.appendChild(issueRow);
        });
    }
}

    private formatIssuePath(issue: AssetReferenceAuditIssue): string {
    return `${this.getPathFileName(issue.assetPath)} :: ${issue.jsonPath}`;
}

    private formatReferenceAuditSummary(result: AssetReferenceAuditResult, label: string): string {
    return `${label}\nScanned Assets: ${result.scannedAssets}\nScanned References: ${result.scannedPairs}\nIssues: ${result.issues}\nFixable: ${result.fixable}\nFixed: ${result.fixed}\nUnresolved: ${result.unresolved}\nChanged Files: ${result.filesChanged}`;
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

    private appendAssetDeleteImpactSection(parent: HTMLElement, summary: AssetDeleteImpactSummary) {
    const section = document.createElement('div');
    section.className = 'inspector-section';
    const sectionContent = document.createElement('div');
    sectionContent.className = 'section-content';
    sectionContent.style.padding = '8px';
    section.appendChild(sectionContent);
    parent.appendChild(section);

    const heading = document.createElement('div');
    heading.style.fontWeight = 'bold';
    heading.style.fontSize = '12px';
    heading.style.marginBottom = '8px';
    heading.innerText = 'Delete Impact';
    sectionContent.appendChild(heading);

    this.appendReadonlyInfo(sectionContent, 'Target Assets', String(summary.targetAssetCount));
    this.appendReadonlyInfo(sectionContent, 'External Refs', String(summary.externalReferencerCount));

    if (summary.externalReferencerPaths.length > 0) {
        const samplesTitle = document.createElement('div');
        samplesTitle.style.fontSize = '11px';
        samplesTitle.style.fontWeight = 'bold';
        samplesTitle.style.color = 'var(--unity-text-dim)';
        samplesTitle.style.marginTop = '4px';
        samplesTitle.style.marginBottom = '4px';
        samplesTitle.innerText = 'Affected Assets';
        sectionContent.appendChild(samplesTitle);

        summary.externalReferencerPaths.slice(0, 6).forEach((assetPath) => {
            const item = document.createElement('div');
            item.style.fontSize = '10px';
            item.style.cursor = 'pointer';
            item.style.padding = '2px 0';
            item.style.wordBreak = 'break-all';
            item.style.color = '#ff9a6a';
            item.innerText = `${this.getPathFileName(assetPath)} (${this.getPathFolderName(assetPath)})`;
            item.onclick = () => {
                const selection = (window as any).Editor?.instance?.projectWindow?.focusAssetByPath?.(assetPath);
                if (selection) {
                    this.selection = selection;
                    this.refresh();
                }
            };
            sectionContent.appendChild(item);
        });
    }
}

    private appendAssetReferenceSection(parent: HTMLElement, usedByPaths: string[], dependencyPaths: string[]) {
    const section = document.createElement('div');
    section.className = 'inspector-section';
    const sectionContent = document.createElement('div');
    sectionContent.className = 'section-content';
    sectionContent.style.padding = '8px';
    section.appendChild(sectionContent);
    parent.appendChild(section);

    const heading = document.createElement('div');
    heading.style.fontWeight = 'bold';
    heading.style.fontSize = '12px';
    heading.style.marginBottom = '8px';
    heading.innerText = 'Reference Graph';
    sectionContent.appendChild(heading);

    this.appendAssetReferenceList(sectionContent, 'Used By', usedByPaths);
    this.appendAssetReferenceList(sectionContent, 'Depends On', dependencyPaths);
}

    private appendAssetReferenceList(parent: HTMLElement, label: string, assetPaths: string[]) {
    const row = document.createElement('div');
    row.style.marginBottom = '8px';
    parent.appendChild(row);

    const title = document.createElement('div');
    title.style.fontSize = '11px';
    title.style.fontWeight = 'bold';
    title.style.color = 'var(--unity-text-dim)';
    title.style.marginBottom = '4px';
    title.innerText = `${label} (${assetPaths.length})`;
    row.appendChild(title);

    if (assetPaths.length === 0) {
        const empty = document.createElement('div');
        empty.style.fontSize = '11px';
        empty.style.color = 'var(--unity-text-dim)';
        empty.innerText = 'None';
        row.appendChild(empty);
        return;
    }

    assetPaths.forEach((assetPath) => {
        const item = document.createElement('div');
        item.style.fontSize = '11px';
        item.style.cursor = 'pointer';
        item.style.padding = '2px 0';
        item.style.wordBreak = 'break-all';
        item.style.color = 'var(--unity-accent)';
        item.innerText = `${this.getPathFileName(assetPath)} (${this.getPathFolderName(assetPath)})`;
        item.onmouseenter = () => {
            item.style.textDecoration = 'underline';
        };
        item.onmouseleave = () => {
            item.style.textDecoration = 'none';
        };
        item.onclick = () => {
            const selection = (window as any).Editor?.instance?.projectWindow?.focusAssetByPath?.(assetPath);
            if (selection) {
                this.selection = selection;
                this.refresh();
            }
        };
        row.appendChild(item);
    });
}

    private getPathFileName(assetPath: string): string {
    const normalized = assetPath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || assetPath;
}

    private getPathFolderName(assetPath: string): string {
    const normalized = assetPath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length < 2) return '.';
    return parts[parts.length - 2];
}

    private renderAssetImportSettingField(
    parent: HTMLElement,
    asset: ProjectAssetSelection,
    key: string,
    value: string | number | boolean
) {
    const label = this.formatAssetSettingLabel(key);
    const options = this.getAssetSettingOptions(asset.meta, key);

    if (options) {
        this.appendSelectField(parent, label, options, String(value), (nextValue) => {
            this.updateSelectedAssetMeta(asset, (meta) => {
                meta.importer.settings[key] = nextValue;
            });
        });
        return;
    }

    if (typeof value === 'boolean') {
        this.inspectors.createUnityCheckbox(parent, label, value, (checked) => {
            this.updateSelectedAssetMeta(asset, (meta) => {
                meta.importer.settings[key] = checked;
            });
        });
        return;
    }

    if (typeof value === 'number') {
        this.inspectors.createUnityField(parent, label, 'number', value, (nextValue) => {
            const parsed = Number(nextValue);
            this.updateSelectedAssetMeta(asset, (meta) => {
                meta.importer.settings[key] = Number.isFinite(parsed) ? parsed : value;
            });
        });
        return;
    }

    this.inspectors.createUnityField(parent, label, 'text', value, (nextValue) => {
        this.updateSelectedAssetMeta(asset, (meta) => {
            meta.importer.settings[key] = String(nextValue);
        });
    });
}

    private getAssetSettingOptions(meta: AssetMeta, key: string): string[] | null {
    if (meta.assetType === 'material' && key === 'shader') {
        return ['Standard', 'Unlit', 'Transparent'];
    }

    if (meta.assetType === 'texture' && key === 'wrapMode') {
        return ['repeat', 'clamp', 'mirror'];
    }

    if (meta.assetType === 'texture' && key === 'filterMode') {
        return ['point', 'bilinear', 'trilinear'];
    }

    if (meta.assetType === 'audio' && key === 'loadType') {
        return ['decompressOnLoad', 'compressedInMemory', 'streaming'];
    }

    return null;
}

    private appendSelectField(
    parent: HTMLElement,
    label: string,
    options: string[],
    value: string,
    onChange: (value: string) => void
    ) {
    const field = document.createElement('div');
    field.className = 'unity-field';
    field.style.marginBottom = '2px';
    field.style.display = 'flex';
    field.style.alignItems = 'center';
    field.style.minHeight = '18px';

    const labelEl = document.createElement('label');
    labelEl.innerText = label;
    labelEl.style.fontSize = '12px';
    labelEl.style.width = '120px';
    labelEl.style.paddingLeft = '4px';
    labelEl.style.color = 'var(--unity-text-dim)';

    const select = document.createElement('select');
    select.className = 'unity-select';
    select.style.flex = '1';
    select.style.height = '18px';
    select.style.fontSize = '11px';
    select.style.minWidth = '0';

    options.forEach((option) => {
        const optionEl = document.createElement('option');
        optionEl.value = option;
        optionEl.innerText = option;
        optionEl.selected = option === value;
        select.appendChild(optionEl);
    });

    select.onchange = () => onChange(select.value);

    field.appendChild(labelEl);
    field.appendChild(select);
    parent.appendChild(field);
}

    private formatAssetSettingLabel(key: string): string {
    return key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (char) => char.toUpperCase());
}

    private renderMaterialInspector(content: HTMLElement, mat: any): void {
    const header = document.createElement('div');
    header.className = 'inspector-header';
    header.innerHTML = `<div style="font-weight: bold; padding: 5px;">${mat.name} (Material)</div>`;
    content.appendChild(header);

    const section = document.createElement('div');
    section.className = 'inspector-section';
    const sectionContent = document.createElement('div');
    sectionContent.className = 'section-content';
    section.appendChild(sectionContent);
    content.appendChild(section);

    this.inspectors.createMaterialInspector(sectionContent, mat);
}

    private renderScriptableObjectInspector(content: HTMLElement, so: ScriptableObject): void {
    const header = document.createElement('div');
    header.className = 'inspector-header';
    header.innerHTML = `<div style="font-weight: bold; padding: 5px;">${so.assetName} (${so.typeName})</div>`;
    content.appendChild(header);

    const section = document.createElement('div');
    section.className = 'inspector-section';
    const sectionContent = document.createElement('div');
    sectionContent.className = 'section-content';
    section.appendChild(sectionContent);
    content.appendChild(section);

    this.inspectors.createScriptableObjectInspector(sectionContent, so);
}

    public refresh(): void {
    this.onGUI();
}
}
