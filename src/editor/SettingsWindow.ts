import { ProjectSettings } from '../engine/ProjectSettings';
import { BuildSettings } from '../engine/BuildSettings';

/**
 * SettingsWindow - Unity-style settings panel
 */
export class SettingsWindow {
    private windowElement: HTMLDivElement | null = null;
    private currentTab: 'project' | 'build' = 'project';

    public show(): void {
        if (this.windowElement) {
            this.windowElement.style.display = 'block';
            return;
        }

        this.createWindow();
    }

    public hide(): void {
        if (this.windowElement) {
            this.windowElement.style.display = 'none';
        }
    }

    private createWindow(): void {
        // Overlay
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.background = 'rgba(0, 0, 0, 0.5)';
        overlay.style.zIndex = '1000';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';

        // Window
        const window = document.createElement('div');
        window.style.width = '800px';
        window.style.height = '600px';
        window.style.background = 'var(--unity-bg-panel)';
        window.style.border = '1px solid var(--unity-border)';
        window.style.borderRadius = '4px';
        window.style.display = 'flex';
        window.style.flexDirection = 'column';
        window.style.overflow = 'hidden';

        // Header
        const header = document.createElement('div');
        header.style.background = 'var(--unity-bg-header)';
        header.style.padding = '12px';
        header.style.borderBottom = '1px solid var(--unity-border)';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';

        const title = document.createElement('div');
        title.innerText = 'Settings';
        title.style.fontWeight = 'bold';
        title.style.fontSize = '14px';

        const closeBtn = document.createElement('button');
        closeBtn.innerText = '✕';
        closeBtn.style.background = 'transparent';
        closeBtn.style.border = 'none';
        closeBtn.style.color = 'var(--unity-text)';
        closeBtn.style.fontSize = '18px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = () => this.hide();

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Tabs
        const tabs = document.createElement('div');
        tabs.style.display = 'flex';
        tabs.style.background = 'var(--unity-bg-dark)';
        tabs.style.borderBottom = '1px solid var(--unity-border)';

        const projectTab = this.createTab('Project Settings', 'project');
        const buildTab = this.createTab('Build Settings', 'build');

        tabs.appendChild(projectTab);
        tabs.appendChild(buildTab);

        // Content
        const content = document.createElement('div');
        content.id = 'settings-content';
        content.style.flex = '1';
        content.style.padding = '16px';
        content.style.overflowY = 'auto';

        window.appendChild(header);
        window.appendChild(tabs);
        window.appendChild(content);
        overlay.appendChild(window);
        document.body.appendChild(overlay);

        this.windowElement = overlay;
        this.renderContent();

        // Close on overlay click
        overlay.onclick = (e) => {
            if (e.target === overlay) this.hide();
        };
    }

    private createTab(label: string, tab: 'project' | 'build'): HTMLElement {
        const tabBtn = document.createElement('button');
        tabBtn.innerText = label;
        tabBtn.style.padding = '8px 16px';
        tabBtn.style.background = this.currentTab === tab ? 'var(--unity-bg-panel)' : 'transparent';
        tabBtn.style.border = 'none';
        tabBtn.style.borderBottom = this.currentTab === tab ? '2px solid var(--unity-accent)' : '2px solid transparent';
        tabBtn.style.color = 'var(--unity-text)';
        tabBtn.style.cursor = 'pointer';
        tabBtn.style.fontSize = '12px';

        tabBtn.onclick = () => {
            this.currentTab = tab;
            this.renderContent();
            // Update all tabs
            const parent = tabBtn.parentElement;
            if (parent) {
                Array.from(parent.children).forEach((child, i) => {
                    const btn = child as HTMLButtonElement;
                    const isActive = (i === 0 && tab === 'project') || (i === 1 && tab === 'build');
                    btn.style.background = isActive ? 'var(--unity-bg-panel)' : 'transparent';
                    btn.style.borderBottom = isActive ? '2px solid var(--unity-accent)' : '2px solid transparent';
                });
            }
        };

        return tabBtn;
    }

    private renderContent(): void {
        const content = document.getElementById('settings-content');
        if (!content) return;

        content.innerHTML = '';

        if (this.currentTab === 'project') {
            this.renderProjectSettings(content);
        } else {
            this.renderBuildSettings(content);
        }
    }

    private renderProjectSettings(parent: HTMLElement): void {
        // Quality Settings
        this.createSection(parent, 'Quality Settings');
        this.createSlider(parent, 'Quality Level', ProjectSettings.qualityLevel, 0, 3, (v) => {
            ProjectSettings.qualityLevel = Math.round(v);
        }, ['Low', 'Medium', 'High', 'Ultra']);
        this.createSlider(parent, 'V-Sync Count', ProjectSettings.vSyncCount, 0, 2, (v) => {
            ProjectSettings.vSyncCount = Math.round(v);
        });

        // Physics Settings
        this.createSection(parent, 'Physics Settings');
        this.createNumberField(parent, 'Gravity', ProjectSettings.gravity, (v) => {
            ProjectSettings.gravity = v;
        });
        this.createNumberField(parent, 'Fixed Delta Time', ProjectSettings.fixedDeltaTime, (v) => {
            ProjectSettings.fixedDeltaTime = v;
        });

        // Graphics Settings
        this.createSection(parent, 'Graphics Settings');
        this.createNumberField(parent, 'Target Frame Rate', ProjectSettings.targetFrameRate, (v) => {
            ProjectSettings.targetFrameRate = Math.round(v);
        });

        // Save Button
        const saveBtn = document.createElement('button');
        saveBtn.innerText = 'Save Settings';
        saveBtn.style.marginTop = '20px';
        saveBtn.style.padding = '8px 16px';
        saveBtn.style.background = 'var(--unity-accent)';
        saveBtn.style.color = 'white';
        saveBtn.style.border = 'none';
        saveBtn.style.borderRadius = '2px';
        saveBtn.style.cursor = 'pointer';
        saveBtn.onclick = () => {
            ProjectSettings.save();
            alert('Project settings saved!');
        };
        parent.appendChild(saveBtn);
    }

    private renderBuildSettings(parent: HTMLElement): void {
        // Platform
        this.createSection(parent, 'Platform');
        this.createDropdown(parent, 'Target Platform',
            ['WebGL', 'Windows', 'Mac', 'Linux'],
            BuildSettings.platform,
            (v) => BuildSettings.platform = v as any
        );

        // Product Info
        this.createSection(parent, 'Product Information');
        this.createTextField(parent, 'Product Name', BuildSettings.productName, (v) => {
            BuildSettings.productName = v;
        });
        this.createTextField(parent, 'Company Name', BuildSettings.companyName, (v) => {
            BuildSettings.companyName = v;
        });
        this.createTextField(parent, 'Version', BuildSettings.version, (v) => {
            BuildSettings.version = v;
        });

        // Build Button
        const buildBtn = document.createElement('button');
        buildBtn.innerText = '🔨 Build';
        buildBtn.style.marginTop = '20px';
        buildBtn.style.padding = '12px 24px';
        buildBtn.style.background = 'var(--unity-accent)';
        buildBtn.style.color = 'white';
        buildBtn.style.border = 'none';
        buildBtn.style.borderRadius = '2px';
        buildBtn.style.cursor = 'pointer';
        buildBtn.style.fontSize = '14px';
        buildBtn.style.fontWeight = 'bold';
        buildBtn.onclick = () => {
            BuildSettings.save();
            BuildSettings.build();
        };
        parent.appendChild(buildBtn);
    }

    private createSection(parent: HTMLElement, title: string): void {
        const section = document.createElement('div');
        section.style.marginTop = '20px';
        section.style.marginBottom = '12px';
        section.style.fontWeight = 'bold';
        section.style.fontSize = '13px';
        section.style.color = 'var(--unity-text)';
        section.style.borderBottom = '1px solid var(--unity-border)';
        section.style.paddingBottom = '4px';
        section.innerText = title;
        parent.appendChild(section);
    }

    private createSlider(parent: HTMLElement, label: string, value: number, min: number, max: number, onChange: (v: number) => void, labels?: string[]): void {
        const field = document.createElement('div');
        field.style.marginBottom = '12px';
        field.style.display = 'flex';
        field.style.alignItems = 'center';
        field.style.gap = '12px';

        const lbl = document.createElement('label');
        lbl.innerText = label;
        lbl.style.minWidth = '150px';
        lbl.style.fontSize = '12px';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min.toString();
        slider.max = max.toString();
        slider.value = value.toString();
        slider.style.flex = '1';

        const valueDisplay = document.createElement('span');
        valueDisplay.style.minWidth = '60px';
        valueDisplay.style.fontSize = '12px';
        valueDisplay.innerText = labels ? labels[value] : value.toString();

        slider.oninput = () => {
            const val = parseFloat(slider.value);
            onChange(val);
            valueDisplay.innerText = labels ? labels[Math.round(val)] : val.toString();
        };

        field.appendChild(lbl);
        field.appendChild(slider);
        field.appendChild(valueDisplay);
        parent.appendChild(field);
    }

    private createNumberField(parent: HTMLElement, label: string, value: number, onChange: (v: number) => void): void {
        const field = document.createElement('div');
        field.style.marginBottom = '12px';
        field.style.display = 'flex';
        field.style.alignItems = 'center';
        field.style.gap = '12px';

        const lbl = document.createElement('label');
        lbl.innerText = label;
        lbl.style.minWidth = '150px';
        lbl.style.fontSize = '12px';

        const input = document.createElement('input');
        input.type = 'number';
        input.value = value.toString();
        input.style.flex = '1';
        input.style.background = 'var(--unity-bg-dark)';
        input.style.color = 'var(--unity-text)';
        input.style.border = '1px solid var(--unity-border)';
        input.style.padding = '4px 8px';
        input.onchange = () => onChange(parseFloat(input.value));

        field.appendChild(lbl);
        field.appendChild(input);
        parent.appendChild(field);
    }

    private createTextField(parent: HTMLElement, label: string, value: string, onChange: (v: string) => void): void {
        const field = document.createElement('div');
        field.style.marginBottom = '12px';
        field.style.display = 'flex';
        field.style.alignItems = 'center';
        field.style.gap = '12px';

        const lbl = document.createElement('label');
        lbl.innerText = label;
        lbl.style.minWidth = '150px';
        lbl.style.fontSize = '12px';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = value;
        input.style.flex = '1';
        input.style.background = 'var(--unity-bg-dark)';
        input.style.color = 'var(--unity-text)';
        input.style.border = '1px solid var(--unity-border)';
        input.style.padding = '4px 8px';
        input.onchange = () => onChange(input.value);

        field.appendChild(lbl);
        field.appendChild(input);
        parent.appendChild(field);
    }

    private createDropdown(parent: HTMLElement, label: string, options: string[], value: string, onChange: (v: string) => void): void {
        const field = document.createElement('div');
        field.style.marginBottom = '12px';
        field.style.display = 'flex';
        field.style.alignItems = 'center';
        field.style.gap = '12px';

        const lbl = document.createElement('label');
        lbl.innerText = label;
        lbl.style.minWidth = '150px';
        lbl.style.fontSize = '12px';

        const select = document.createElement('select');
        select.style.flex = '1';
        select.style.background = 'var(--unity-bg-dark)';
        select.style.color = 'var(--unity-text)';
        select.style.border = '1px solid var(--unity-border)';
        select.style.padding = '4px 8px';

        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt;
            option.innerText = opt;
            if (opt === value) option.selected = true;
            select.appendChild(option);
        });

        select.onchange = () => onChange(select.value);

        field.appendChild(lbl);
        field.appendChild(select);
        parent.appendChild(field);
    }
}
