import { ProjectSettings } from '../engine/ProjectSettings';
import { PhysicsSystem } from '../engine/PhysicsSystem';
import { LayerManager } from '../engine/LayerManager';
import { EditorInspectors } from './EditorInspectors';

export class ProjectSettingsWindow {
    private static container: HTMLDivElement | null = null;
    private static inspectors: EditorInspectors;
    private static currentSection: string = 'Physics';
    private static mainPanel: HTMLElement | null = null;

    public static initialize(inspectors: EditorInspectors) {
        this.inspectors = inspectors;
    }

    public static show() {
        if (this.container) {
            this.container.style.display = 'flex';
            this.renderSection(this.currentSection, this.mainPanel!);
            return;
        }

        // Create Modal Overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6); display: flex; align-items: center;
            justify-content: center; z-index: 2000;
        `;
        this.container = overlay as any;

        const windowDiv = document.createElement('div');
        windowDiv.style.cssText = `
            width: 720px; height: 520px; background: var(--unity-bg-panel);
            border: 1px solid var(--unity-border); display: flex; flex-direction: column;
            border-radius: 4px; box-shadow: 0 10px 30px rgba(0,0,0,0.6);
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            background: var(--unity-bg-header); padding: 8px 12px;
            display: flex; justify-content: space-between; align-items: center;
            border-bottom: 1px solid var(--unity-border); flex-shrink: 0;
        `;
        const title = document.createElement('strong');
        title.innerText = 'Project Settings';
        title.style.fontSize = '13px';

        const closeBtn = document.createElement('span');
        closeBtn.innerText = '✕';
        closeBtn.style.cssText = 'cursor: pointer; font-size: 14px; opacity: 0.7;';
        closeBtn.onmouseenter = () => closeBtn.style.opacity = '1';
        closeBtn.onmouseleave = () => closeBtn.style.opacity = '0.7';
        closeBtn.onclick = () => this.hide();

        header.appendChild(title);
        header.appendChild(closeBtn);
        windowDiv.appendChild(header);

        // Content
        const content = document.createElement('div');
        content.style.cssText = 'display: flex; flex: 1; overflow: hidden;';
        windowDiv.appendChild(content);

        // Sidebar
        const sidebar = document.createElement('div');
        sidebar.style.cssText = `
            width: 160px; background: var(--unity-bg-dark);
            border-right: 1px solid var(--unity-border); padding: 8px 0; overflow-y: auto;
        `;
        content.appendChild(sidebar);

        // Main Panel
        const mainPanel = document.createElement('div');
        mainPanel.style.cssText = 'flex: 1; padding: 16px; overflow-y: auto;';
        this.mainPanel = mainPanel;
        content.appendChild(mainPanel);

        const sections = ['Physics', 'Tags & Layers', 'Collision Matrix', 'Quality', 'Time', 'Audio'];
        sections.forEach(s => {
            const item = document.createElement('div');
            item.innerText = s;
            item.style.cssText = `
                padding: 7px 16px; cursor: pointer; font-size: 12px;
                transition: background 0.1s; user-select: none;
            `;
            item.dataset['section'] = s;
            item.onmouseenter = () => {
                if (this.currentSection !== s) item.style.background = 'var(--unity-bg-hover)';
            };
            item.onmouseleave = () => {
                if (this.currentSection !== s) item.style.background = 'transparent';
            };
            item.onclick = () => {
                this.currentSection = s;
                // Update active state
                sidebar.querySelectorAll('[data-section]').forEach((el: any) => {
                    el.style.background = el.dataset['section'] === s
                        ? 'var(--unity-accent)'
                        : 'transparent';
                });
                this.renderSection(s, mainPanel);
            };
            sidebar.appendChild(item);
        });

        overlay.appendChild(windowDiv);
        document.body.appendChild(overlay);

        // Default Section
        this.renderSection('Physics', mainPanel);
        // Mark Physics as active
        const firstItem = sidebar.querySelector('[data-section="Physics"]') as HTMLElement;
        if (firstItem) firstItem.style.background = 'var(--unity-accent)';
    }

    public static showSection(section: string): void {
        this.currentSection = section;
        this.show();
    }

    private static renderSection(name: string, container: HTMLElement) {
        container.innerHTML = '';

        const sectionTitle = document.createElement('div');
        sectionTitle.innerText = name;
        sectionTitle.style.cssText = `
            font-size: 14px; font-weight: bold; margin-bottom: 14px;
            padding-bottom: 6px; border-bottom: 1px solid var(--unity-border);
        `;
        container.appendChild(sectionTitle);

        switch (name) {
            case 'Physics':
                this.renderPhysicsSection(container);
                break;
            case 'Tags & Layers':
                this.renderTagsAndLayersSection(container);
                break;
            case 'Collision Matrix':
                this.renderCollisionMatrixSection(container);
                break;
            case 'Quality':
                this.renderQualitySection(container);
                break;
            case 'Time':
                this.renderTimeSection(container);
                break;
            case 'Audio':
                this.renderAudioSection(container);
                break;
        }
    }

    // ─── Physics Section ───────────────────────────────────────────────────────

    private static renderPhysicsSection(container: HTMLElement): void {
        this.inspectors.createUnityField(container, 'Gravity Y', 'number', ProjectSettings.gravity, (v: any) => {
            ProjectSettings.gravity = parseFloat(v);
            PhysicsSystem.getInstance().syncProjectSettings(true);
        });
        this.inspectors.createUnityField(container, 'Solver Iterations', 'number', ProjectSettings.defaultSolverIterations, (v: any) => {
            ProjectSettings.defaultSolverIterations = parseInt(v);
            PhysicsSystem.getInstance().syncProjectSettings(true);
        });
        this.inspectors.createUnityField(container, 'Solver Velocity Iterations', 'number', ProjectSettings.defaultSolverVelocityIterations, (v: any) => {
            ProjectSettings.defaultSolverVelocityIterations = parseInt(v);
            PhysicsSystem.getInstance().syncProjectSettings(true);
        });
        this.inspectors.createUnityField(container, 'Bounce Threshold', 'number', ProjectSettings.bounceThreshold, (v: any) => {
            ProjectSettings.bounceThreshold = parseFloat(v);
            PhysicsSystem.getInstance().syncProjectSettings(true);
        });
        this.inspectors.createUnityField(container, 'Sleep Threshold', 'number', ProjectSettings.sleepThreshold, (v: any) => {
            ProjectSettings.sleepThreshold = parseFloat(v);
            PhysicsSystem.getInstance().syncProjectSettings(true);
        });
        this.inspectors.createUnityField(container, 'Default Contact Offset', 'number', ProjectSettings.defaultContactOffset, (v: any) => {
            ProjectSettings.defaultContactOffset = parseFloat(v);
            PhysicsSystem.getInstance().syncProjectSettings(true);
        });

        this.addSaveButton(container);
    }

    // ─── Tags & Layers Section ─────────────────────────────────────────────────

    private static renderTagsAndLayersSection(container: HTMLElement): void {
        const lm = LayerManager.getInstance();

        const tagsHeader = document.createElement('div');
        tagsHeader.innerText = 'Tags';
        tagsHeader.style.cssText = 'font-size: 12px; font-weight: bold; margin-bottom: 6px; color: var(--unity-text-dim);';
        container.appendChild(tagsHeader);

        const tagsList = document.createElement('div');
        tagsList.style.cssText = `
            background: var(--unity-bg-dark); border: 1px solid var(--unity-border);
            border-radius: 3px; padding: 6px; margin-bottom: 12px;
        `;
        container.appendChild(tagsList);

        const renderTags = () => {
            tagsList.innerHTML = '';
            ProjectSettings.tags.forEach((tag, i) => {
                const row = document.createElement('div');
                row.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-bottom: 4px;';

                const input = document.createElement('input');
                input.type = 'text';
                input.value = tag;
                input.style.cssText = `
                    flex: 1; background: var(--unity-bg-input); color: var(--unity-text);
                    border: 1px solid var(--unity-border-light); padding: 2px 4px; font-size: 11px;
                    border-radius: 2px;
                `;
                input.onchange = () => {
                    ProjectSettings.tags[i] = input.value;
                };

                const delBtn = document.createElement('button');
                delBtn.innerText = '-';
                delBtn.title = 'Remove tag';
                delBtn.style.cssText = `
                    width: 18px; height: 18px; background: var(--unity-bg-header);
                    border: 1px solid var(--unity-border); color: var(--unity-text);
                    cursor: pointer; font-size: 14px; line-height: 1; border-radius: 2px;
                    display: flex; align-items: center; justify-content: center;
                `;
                if (i < 7) {
                    delBtn.disabled = true;
                    delBtn.style.opacity = '0.3';
                } else {
                    delBtn.onclick = () => {
                        ProjectSettings.tags.splice(i, 1);
                        renderTags();
                    };
                }

                row.appendChild(input);
                row.appendChild(delBtn);
                tagsList.appendChild(row);
            });
        };
        renderTags();

        const addTagBtn = document.createElement('button');
        addTagBtn.innerText = '+ Add Tag';
        addTagBtn.style.cssText = `
            padding: 4px 10px; background: var(--unity-bg-header);
            border: 1px solid var(--unity-border); color: var(--unity-text);
            cursor: pointer; font-size: 11px; border-radius: 2px; margin-bottom: 16px;
        `;
        addTagBtn.onclick = () => {
            ProjectSettings.tags.push('NewTag');
            renderTags();
        };
        container.appendChild(addTagBtn);

        const layersHeader = document.createElement('div');
        layersHeader.innerText = 'Layers';
        layersHeader.style.cssText = 'font-size: 12px; font-weight: bold; margin-bottom: 6px; color: var(--unity-text-dim);';
        container.appendChild(layersHeader);

        const layersList = document.createElement('div');
        layersList.style.cssText = `
            background: var(--unity-bg-dark); border: 1px solid var(--unity-border);
            border-radius: 3px; padding: 6px;
        `;
        container.appendChild(layersList);

        const layerError = document.createElement('div');
        layerError.style.cssText = 'display:none; margin: 8px 0 6px 0; padding: 6px 8px; border: 1px solid #8f3d3d; border-radius: 3px; background: rgba(143,61,61,0.16); color: #ffb4b4; font-size: 11px;';
        layersList.appendChild(layerError);

        const showLayerError = (message: string) => {
            layerError.innerText = message;
            layerError.style.display = 'block';
        };

        const clearLayerError = () => {
            layerError.style.display = 'none';
            layerError.innerText = '';
        };

        const normalizeLayerNameForCompare = (name: string) => name.trim().toLowerCase();
        const hasDuplicateLayerName = (index: number, candidateName: string): boolean => {
            const normalizedCandidate = normalizeLayerNameForCompare(candidateName);
            if (!normalizedCandidate) return false;
            return lm.getLayers().some((layer) => {
                if (layer.index === index) return false;
                return normalizeLayerNameForCompare(layer.name) === normalizedCandidate;
            });
        };

        const createLayerRow = (index: number, editable: boolean, placeholder: string, useFallbackLabel: boolean) => {
            const row = document.createElement('div');
            row.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 3px;';

            const indexLabel = document.createElement('span');
            indexLabel.innerText = `${index}`;
            indexLabel.style.cssText = 'width: 20px; font-size: 10px; color: var(--unity-text-dim); text-align: right; flex-shrink: 0;';

            const input = document.createElement('input');
            input.type = 'text';
            input.style.cssText = `
                flex: 1; background: var(--unity-bg-input); color: var(--unity-text);
                border: 1px solid var(--unity-border-light); padding: 2px 4px; font-size: 11px;
                border-radius: 2px;
            `;

            if (!editable) {
                input.readOnly = true;
                input.style.opacity = '0.6';
            }

            const layerName = lm.getLayerName(index);
            const hasFallbackName = layerName === `Layer ${index}`;
            input.value = useFallbackLabel && hasFallbackName ? '' : layerName;
            input.placeholder = placeholder;

            input.onchange = () => {
                const previousValue = ProjectSettings.layerNames[index] ?? '';
                const nextValue = input.value.trim();
                if (hasDuplicateLayerName(index, nextValue)) {
                    input.value = previousValue;
                    showLayerError(`Layer name "${nextValue}" is already used. Layer names must be unique.`);
                    return;
                }

                clearLayerError();
                lm.setLayerName(index, nextValue);
                ProjectSettings.layerNames[index] = nextValue;
                ProjectSettings.captureRuntimeLayerSettings();
            };

            row.appendChild(indexLabel);
            row.appendChild(input);
            layersList.appendChild(row);
        };

        const builtInLayerHeader = document.createElement('div');
        builtInLayerHeader.innerText = 'Built-in Layers (0-7)';
        builtInLayerHeader.style.cssText = 'font-size: 11px; color: var(--unity-text-dim); margin: 2px 0 4px 0;';
        layersList.appendChild(builtInLayerHeader);
        for (let i = 0; i <= 7; i++) {
            createLayerRow(i, false, '(built-in)', false);
        }

        const userLayerHeader = document.createElement('div');
        userLayerHeader.innerText = 'User Layers (8-31)';
        userLayerHeader.style.cssText = 'font-size: 11px; color: var(--unity-text-dim); margin: 8px 0 4px 0;';
        layersList.appendChild(userLayerHeader);
        for (let i = 8; i < 32; i++) {
            createLayerRow(i, true, '(empty)', true);
        }

        this.addSaveButton(container);
    }
    private static renderCollisionMatrixSection(container: HTMLElement): void {
        const lm = LayerManager.getInstance();
        const namedLayers = lm.getNamedLayers();

        if (namedLayers.length === 0) {
            const msg = document.createElement('div');
            msg.innerText = 'No named layers defined. Add layers in the Tags & Layers section first.';
            msg.style.cssText = 'font-style: italic; font-size: 11px; color: var(--unity-text-dim);';
            container.appendChild(msg);
            return;
        }

        const info = document.createElement('div');
        info.innerText = 'Check a cell to allow collision between two layers. Uncheck to ignore.';
        info.style.cssText = 'font-size: 11px; color: var(--unity-text-dim); margin-bottom: 12px;';
        container.appendChild(info);

        // Scrollable matrix container
        const matrixWrapper = document.createElement('div');
        matrixWrapper.style.cssText = 'overflow: auto; max-height: 340px;';
        container.appendChild(matrixWrapper);

        const table = document.createElement('table');
        table.style.cssText = `
            border-collapse: collapse; font-size: 10px;
            background: var(--unity-bg-dark);
        `;
        matrixWrapper.appendChild(table);

        // Header row (rotated layer names)
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        // Empty top-left cell
        const cornerCell = document.createElement('th');
        cornerCell.style.cssText = 'width: 120px; min-width: 120px;';
        headerRow.appendChild(cornerCell);

        namedLayers.forEach(layer => {
            const th = document.createElement('th');
            th.style.cssText = `
                width: 28px; height: 80px; vertical-align: bottom;
                padding: 2px; text-align: center;
            `;
            const span = document.createElement('span');
            span.innerText = layer.name;
            span.style.cssText = `
                display: block; transform: rotate(-60deg) translateX(-8px);
                transform-origin: bottom center; white-space: nowrap;
                font-size: 10px; color: var(--unity-text-dim); font-weight: normal;
            `;
            th.appendChild(span);
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // Body rows
        const tbody = document.createElement('tbody');
        namedLayers.forEach(rowLayer => {
            const tr = document.createElement('tr');

            // Row label
            const td = document.createElement('td');
            td.innerText = rowLayer.name;
            td.style.cssText = `
                padding: 3px 8px; font-size: 11px; color: var(--unity-text-dim);
                text-align: right; white-space: nowrap; border-right: 1px solid var(--unity-border);
            `;
            tr.appendChild(td);

            namedLayers.forEach(colLayer => {
                const cell = document.createElement('td');
                cell.style.cssText = 'text-align: center; padding: 2px;';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = lm.getLayerCollision(rowLayer.index, colLayer.index);
                checkbox.style.cssText = 'cursor: pointer; margin: 0;';
                checkbox.title = `${rowLayer.name} ↔ ${colLayer.name}`;

                checkbox.onchange = () => {
                    lm.setLayerCollision(rowLayer.index, colLayer.index, checkbox.checked);
                    // Sync the mirror cell
                    const mirrorCheckbox = table.querySelector(
                        `input[data-a="${colLayer.index}"][data-b="${rowLayer.index}"]`
                    ) as HTMLInputElement;
                    if (mirrorCheckbox) mirrorCheckbox.checked = checkbox.checked;
                    ProjectSettings.captureRuntimeLayerSettings();
                    // Refresh physics bodies
                    PhysicsSystem.getInstance().refreshAllLayerFilters();
                };

                checkbox.dataset['a'] = rowLayer.index.toString();
                checkbox.dataset['b'] = colLayer.index.toString();

                cell.appendChild(checkbox);
                tr.appendChild(cell);
            });

            tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        // Refresh button
        const refreshBtn = document.createElement('button');
        refreshBtn.innerText = '↺ Apply to Physics';
        refreshBtn.style.cssText = `
            margin-top: 12px; padding: 5px 12px; background: var(--unity-accent);
            border: none; color: white; cursor: pointer; font-size: 11px; border-radius: 3px;
        `;
        refreshBtn.onclick = () => {
            PhysicsSystem.getInstance().refreshAllLayerFilters();
        };
        container.appendChild(refreshBtn);

        this.addSaveButton(container);
    }

    // ─── Quality Section ───────────────────────────────────────────────────────

    private static renderQualitySection(container: HTMLElement): void {
        this.inspectors.createUnityField(container, 'Target Frame Rate', 'number', ProjectSettings.targetFrameRate, (v: any) => {
            ProjectSettings.targetFrameRate = parseInt(v);
        });
        this.inspectors.createUnityField(container, 'Render Scale', 'number', ProjectSettings.renderScale, (v: any) => {
            ProjectSettings.renderScale = parseFloat(v);
        });
        this.addSaveButton(container);
    }

    // ─── Time Section ──────────────────────────────────────────────────────────

    private static renderTimeSection(container: HTMLElement): void {
        this.inspectors.createUnitySlider(container, 'Time Scale', ProjectSettings.timeScale, 0, 2, (v: any) => {
            ProjectSettings.timeScale = v;
        });
        this.inspectors.createUnityField(container, 'Fixed Delta Time', 'number', ProjectSettings.fixedDeltaTime, (v: any) => {
            ProjectSettings.fixedDeltaTime = parseFloat(v);
        });
        this.inspectors.createUnityField(container, 'Max Delta Time', 'number', ProjectSettings.maximumDeltaTime, (v: any) => {
            ProjectSettings.maximumDeltaTime = parseFloat(v);
        });
        this.addSaveButton(container);
    }

    // ─── Audio Section ─────────────────────────────────────────────────────────

    private static renderAudioSection(container: HTMLElement): void {
        this.inspectors.createUnitySlider(container, 'Master Volume', ProjectSettings.masterVolume, 0, 1, (v: any) => {
            ProjectSettings.masterVolume = v;
        });
        this.inspectors.createUnitySlider(container, 'Doppler Factor', ProjectSettings.dopplerFactor, 0, 5, (v: any) => {
            ProjectSettings.dopplerFactor = v;
        });
        this.addSaveButton(container);
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    private static addSaveButton(container: HTMLElement): void {
        const btn = document.createElement('button');
        btn.innerText = '💾 Save Settings';
        btn.style.cssText = `
            margin-top: 16px; padding: 5px 14px; background: var(--unity-accent);
            border: none; color: white; cursor: pointer; font-size: 11px; border-radius: 3px;
        `;
        btn.onclick = () => {
            ProjectSettings.save();
            btn.innerText = '✓ Saved!';
            setTimeout(() => btn.innerText = '💾 Save Settings', 1500);
        };
        container.appendChild(btn);
    }

    public static hide() {
        if (this.container) {
            (this.container as any).style.display = 'none';
        }
    }
}

