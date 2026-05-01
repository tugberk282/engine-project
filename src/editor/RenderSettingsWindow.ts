import { Scene } from '../engine/Scene';
import { EditorSettings } from './EditorSettings';


/**
 * RenderSettingsWindow — Editor panel for post-processing and environment settings.
 * Controls Bloom, SSAO, Fog, and Environment properties for the active scene.
 */
export class RenderSettingsWindow {
    private container: HTMLElement;
    private scene: Scene;
    private onUpdate: () => void;

    constructor(parent: HTMLElement, scene: Scene, onUpdate: () => void) {
        this.container = parent;
        this.scene = scene;
        this.onUpdate = onUpdate;
    }

    public setScene(scene: Scene) {
        this.scene = scene;
        this.refresh();
    }

    public refresh() {
        this.render();
    }

    private render(): void {
        this.container.innerHTML = '';
        this.container.style.overflowY = 'auto';
        this.container.style.padding = '8px';
        this.container.style.fontSize = '12px';
        this.container.style.color = 'var(--unity-text)';

        // ─── Environment Section ──────────────────────────────────────
        this.addSection('🌍 Environment', () => {
            const group = document.createElement('div');

            this.addColorField(group, 'Background Color', this.scene.backgroundColor, (v) => {
                this.scene.backgroundColor = v;
                this.scene.updateEnvironment();
            });

            this.addColorField(group, 'Ambient Color', this.scene.ambientColor, (v) => {
                this.scene.ambientColor = v;
                this.scene.updateEnvironment();
            });

            this.addSlider(group, 'Ambient Intensity', this.scene.ambientIntensity, 0, 3, 0.01, (v) => {
                this.scene.ambientIntensity = v;
                this.scene.updateEnvironment();
            });

            return group;
        });

        // ─── Editor Section (Grid & Snapping) ─────────────────────────
        this.addSection('⚙️ Editor Preferences', () => {
            const group = document.createElement('div');

            // Grid
            const gridLabel = document.createElement('div');
            gridLabel.innerText = 'Grid Settings';
            gridLabel.style.cssText = 'font-size: 11px; font-weight: bold; margin: 8px 0 4px 0; color: #888;';
            group.appendChild(gridLabel);

            this.addToggle(group, 'Show Grid', EditorSettings.gridEnabled, (v) => {
                EditorSettings.gridEnabled = v;
                this.onUpdate(); // Triggers grid update in Editor
            });

            this.addSlider(group, 'Grid Size', EditorSettings.gridSize, 10, 500, 10, (v) => {
                EditorSettings.gridSize = v;
                this.onUpdate();
            });

            this.addColorField(group, 'Grid Color 1', EditorSettings.gridColor1, (v) => {
                EditorSettings.gridColor1 = v;
                this.onUpdate();
            });

            // Snapping
            const snapLabel = document.createElement('div');
            snapLabel.innerText = 'Snapping Increments';
            snapLabel.style.cssText = 'font-size: 11px; font-weight: bold; margin: 12px 0 4px 0; color: #888;';
            group.appendChild(snapLabel);

            this.addSlider(group, 'Move Snap', EditorSettings.snapTranslation, 0.1, 10, 0.1, (v) => {
                EditorSettings.snapTranslation = v;
                EditorSettings.save();
                this.onUpdate();
            });

            this.addSlider(group, 'Rotate Snap', EditorSettings.snapRotation, 1, 90, 1, (v) => {
                EditorSettings.snapRotation = v;
                EditorSettings.save();
                this.onUpdate();
            });

            return group;
        });

        // ─── Bloom Section ────────────────────────────────────────────
        this.addSection('✨ Bloom', () => {
            const group = document.createElement('div');

            this.addToggle(group, 'Enabled', this.scene.enableBloom, (v) => {
                this.scene.enableBloom = v;
                this.onUpdate();
            });

            this.addSlider(group, 'Strength', this.scene.bloomStrength, 0, 5, 0.1, (v) => {
                this.scene.bloomStrength = v;
                this.onUpdate();
            });

            this.addSlider(group, 'Threshold', this.scene.bloomThreshold, 0, 1, 0.01, (v) => {
                this.scene.bloomThreshold = v;
                this.onUpdate();
            });

            this.addSlider(group, 'Radius', this.scene.bloomRadius, 0, 2, 0.01, (v) => {
                this.scene.bloomRadius = v;
                this.onUpdate();
            });

            return group;
        });

        // ─── SSAO Section ─────────────────────────────────────────────
        this.addSection('🔳 SSAO (Ambient Occlusion)', () => {
            const group = document.createElement('div');

            this.addToggle(group, 'Enabled', this.scene.enableSSAO, (v) => {
                this.scene.enableSSAO = v;
                this.onUpdate();
            });

            this.addSlider(group, 'Radius', this.scene.ssaoRadius, 1, 64, 1, (v) => {
                this.scene.ssaoRadius = v;
                this.onUpdate();
            });

            this.addSlider(group, 'Min Distance', this.scene.ssaoMinDistance, 0.001, 0.1, 0.001, (v) => {
                this.scene.ssaoMinDistance = v;
                this.onUpdate();
            });

            this.addSlider(group, 'Max Distance', this.scene.ssaoMaxDistance, 0.01, 1, 0.01, (v) => {
                this.scene.ssaoMaxDistance = v;
                this.onUpdate();
            });

            return group;
        });

        // ─── Fog Section ──────────────────────────────────────────────
        this.addSection('🌫️ Fog', () => {
            const group = document.createElement('div');

            this.addToggle(group, 'Enabled', this.scene.enableFog, (v) => {
                this.scene.enableFog = v;
                this.scene.updateEnvironment();
            });

            this.addDropdown(group, 'Mode', ['Linear', 'Exp2'], this.scene.fogMode, (v) => {
                this.scene.fogMode = v as 'Linear' | 'Exp2';
                this.scene.updateEnvironment();
                this.refresh(); // Refresh to show/hide relevant fields
            });

            this.addColorField(group, 'Color', this.scene.fogColor, (v) => {
                this.scene.fogColor = v;
                this.scene.updateEnvironment();
            });

            if (this.scene.fogMode === 'Linear') {
                this.addSlider(group, 'Near', this.scene.fogNear, 0, 100, 0.5, (v) => {
                    this.scene.fogNear = v;
                    this.scene.updateEnvironment();
                });

                this.addSlider(group, 'Far', this.scene.fogFar, 1, 500, 1, (v) => {
                    this.scene.fogFar = v;
                    this.scene.updateEnvironment();
                });
            } else {
                this.addSlider(group, 'Density', this.scene.fogDensity, 0.001, 0.5, 0.001, (v) => {
                    this.scene.fogDensity = v;
                    this.scene.updateEnvironment();
                });
            }

            return group;
        });

        // ─── Tone Mapping Section ─────────────────────────────────────
        this.addSection('🎨 Tone Mapping', () => {
            const group = document.createElement('div');

            this.addDropdown(group, 'Mode', ['None', 'Linear', 'Reinhard', 'Cineon', 'ACES Filmic'], this.scene.toneMapping, (v) => {
                this.scene.toneMapping = v;
                this.onUpdate();
            });

            this.addSlider(group, 'Exposure', this.scene.toneMappingExposure, 0.1, 5, 0.05, (v) => {
                this.scene.toneMappingExposure = v;
                this.onUpdate();
            });

            return group;
        });

        // ─── Vignette Section ─────────────────────────────────────────
        this.addSection('🎬 Vignette', () => {
            const group = document.createElement('div');

            this.addToggle(group, 'Enabled', this.scene.enableVignette, (v) => {
                this.scene.enableVignette = v;
                this.onUpdate();
            });

            this.addSlider(group, 'Intensity', this.scene.vignetteIntensity, 0, 5, 0.1, (v) => {
                this.scene.vignetteIntensity = v;
                this.onUpdate();
            });

            this.addSlider(group, 'Offset', this.scene.vignetteOffset, 0, 5, 0.1, (v) => {
                this.scene.vignetteOffset = v;
                this.onUpdate();
            });

            return group;
        });

        // ─── Chromatic Aberration Section ─────────────────────────────
        this.addSection('🌈 Chromatic Aberration', () => {
            const group = document.createElement('div');

            this.addToggle(group, 'Enabled', this.scene.enableChromaticAberration, (v) => {
                this.scene.enableChromaticAberration = v;
                this.onUpdate();
            });

            this.addSlider(group, 'Intensity', this.scene.chromaticIntensity, 0, 10, 0.1, (v) => {
                this.scene.chromaticIntensity = v;
                this.onUpdate();
            });

            return group;
        });

        // ─── Film Grain Section ───────────────────────────────────────
        this.addSection('🎞️ Film Grain', () => {
            const group = document.createElement('div');

            this.addToggle(group, 'Enabled', this.scene.enableFilmGrain, (v) => {
                this.scene.enableFilmGrain = v;
                this.onUpdate();
            });

            this.addSlider(group, 'Intensity', this.scene.filmGrainIntensity, 0, 5, 0.1, (v) => {
                this.scene.filmGrainIntensity = v;
                this.onUpdate();
            });

            return group;
        });
    }

    // ─── UI Helpers ───────────────────────────────────────────────────

    private addSection(title: string, buildContent: () => HTMLElement): void {
        const section = document.createElement('div');
        section.style.marginBottom = '12px';

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex; align-items: center; gap: 6px;
            padding: 4px 8px; background: #3c3c3c;
            border-radius: 4px; cursor: pointer; user-select: none;
            margin-bottom: 6px; font-size: 12px; font-weight: 600;
            color: #eee;
        `;

        const arrow = document.createElement('span');
        arrow.innerText = '▼';
        arrow.style.fontSize = '9px';
        arrow.style.color = '#aaa';

        const titleEl = document.createElement('span');
        titleEl.innerText = title;

        header.appendChild(arrow);
        header.appendChild(titleEl);

        const content = buildContent();
        content.style.paddingLeft = '12px';

        let collapsed = false;
        header.onclick = () => {
            collapsed = !collapsed;
            content.style.display = collapsed ? 'none' : 'block';
            arrow.innerText = collapsed ? '►' : '▼';
        };

        section.appendChild(header);
        section.appendChild(content);
        this.container.appendChild(section);
    }

    private addToggle(parent: HTMLElement, label: string, value: boolean, onChange: (v: boolean) => void): void {
        const row = this.createRow(label);
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = value;
        checkbox.style.cursor = 'pointer';
        checkbox.style.accentColor = 'var(--unity-accent)';
        checkbox.onchange = () => onChange(checkbox.checked);
        row.appendChild(checkbox);
        parent.appendChild(row);
    }

    private addSlider(parent: HTMLElement, label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void): void {
        const row = this.createRow(label);

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = String(min);
        slider.max = String(max);
        slider.step = String(step);
        slider.value = String(value);
        slider.style.flex = '1';
        slider.style.minWidth = '80px';
        slider.style.accentColor = 'var(--unity-accent)';

        const numInput = document.createElement('input');
        numInput.type = 'number';
        numInput.min = String(min);
        numInput.max = String(max);
        numInput.step = String(step);
        numInput.value = String(parseFloat(value.toFixed(4)));
        numInput.style.cssText = `
            width: 55px; background: var(--unity-bg-input);
            color: var(--unity-text); border: 1px solid var(--unity-border-light);
            font-size: 11px; padding: 1px 4px; text-align: center;
            border-radius: 2px;
        `;

        slider.oninput = () => {
            numInput.value = parseFloat(slider.value).toFixed(4);
            onChange(parseFloat(slider.value));
        };

        numInput.onchange = () => {
            slider.value = numInput.value;
            onChange(parseFloat(numInput.value));
        };

        row.appendChild(slider);
        row.appendChild(numInput);
        parent.appendChild(row);
    }

    private addColorField(parent: HTMLElement, label: string, value: string, onChange: (v: string) => void): void {
        const row = this.createRow(label);

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = value;
        colorInput.style.cssText = `
            width: 60px; height: 20px; border: 1px solid var(--unity-border);
            background: transparent; cursor: pointer; border-radius: 2px;
        `;

        const hexLabel = document.createElement('span');
        hexLabel.innerText = value;
        hexLabel.style.cssText = 'font-size: 10px; color: #aaa; margin-left: 4px;';

        colorInput.oninput = () => {
            hexLabel.innerText = colorInput.value;
            onChange(colorInput.value);
        };

        row.appendChild(colorInput);
        row.appendChild(hexLabel);
        parent.appendChild(row);
    }

    private addDropdown(parent: HTMLElement, label: string, options: string[], value: string, onChange: (v: string) => void): void {
        const row = this.createRow(label);
        const select = document.createElement('select');
        select.style.cssText = `
            background: var(--unity-bg-input); color: var(--unity-text);
            border: 1px solid var(--unity-border-light); font-size: 11px;
            padding: 2px 4px; border-radius: 2px; flex: 1;
        `;

        options.forEach(opt => {
            const o = document.createElement('option');
            o.value = opt;
            o.innerText = opt;
            if (opt === value) o.selected = true;
            select.appendChild(o);
        });

        select.onchange = () => onChange(select.value);
        row.appendChild(select);
        parent.appendChild(row);
    }

    private createRow(label: string): HTMLElement {
        const row = document.createElement('div');
        row.style.cssText = `
            display: flex; align-items: center; gap: 8px;
            margin-bottom: 4px; min-height: 22px;
        `;

        const labelEl = document.createElement('span');
        labelEl.innerText = label;
        labelEl.style.cssText = 'width: 110px; flex-shrink: 0; color: #bbb; font-size: 11px;';
        row.appendChild(labelEl);

        return row;
    }
}
