import { DesktopFileSystem } from '../platform/DesktopFileSystem';
import { PathUtils } from '../platform/PathUtils';
import { EditorWindow } from './EditorWindow';

export class BuildSettingsWindow extends EditorWindow {
    private scenes: { path: string, included: boolean }[] = [];
    private fs: DesktopFileSystem;

    constructor(parent: HTMLElement) {
        super(parent, "Build Settings");
        this.fs = new DesktopFileSystem();
        this.refreshScenes();
    }

    public refresh(): void {
        this.onGUI();
    }

    public refreshScenes(): void {
        const rootPath = (window as any).Editor?.instance?.rootPath ?? 'Assets';
        const assetsPath = rootPath;
        if (!this.fs.existsSync(assetsPath)) {
            this.scenes = [];
            return;
        }

        const findScenes = (dir: string) => {
            let results: string[] = [];
            const list = this.fs.readdirSync(dir);
            list.forEach((file: string) => {
                file = PathUtils.join(dir, file);
                const stat = this.fs.statSync(file);
                if (stat && stat.isDirectory()) {
                    results = results.concat(findScenes(file));
                } else {
                    if (file.endsWith('.scene')) results.push(file);
                }
            });
            return results;
        };

        const sceneFiles = findScenes(assetsPath);
        const projectRoot = PathUtils.dirname(rootPath);

        this.scenes = sceneFiles.map(fullPath => {
            const relativePath = PathUtils.relative(projectRoot, fullPath);
            return { path: relativePath, included: true };
        });

        this.refresh();
    }

    public onGUI(): void {
        const content = this.getContentArea();
        content.innerHTML = '';
        content.style.padding = '10px';
        content.style.display = 'flex';
        content.style.flexDirection = 'column';
        content.style.gap = '10px';

        const title = document.createElement('div');
        title.innerText = 'Scenes In Build';
        title.style.fontWeight = 'bold';
        title.style.fontSize = '12px';
        content.appendChild(title);

        const listContainer = document.createElement('div');
        listContainer.style.flex = '1';
        listContainer.style.background = 'var(--unity-bg-input)';
        listContainer.style.border = '1px solid var(--unity-border)';
        listContainer.style.overflowY = 'auto';
        listContainer.style.padding = '5px';
        content.appendChild(listContainer);

        this.scenes.forEach((scene, index) => {
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.gap = '8px';
            item.style.padding = '2px 5px';
            item.style.fontSize = '11px';
            item.style.borderBottom = '1px solid var(--unity-border-light)';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = scene.included;
            checkbox.onchange = () => scene.included = checkbox.checked;

            const name = document.createElement('span');
            name.innerText = scene.path;
            name.style.flex = '1';

            const indexLbl = document.createElement('span');
            indexLbl.innerText = index.toString();
            indexLbl.style.color = 'var(--unity-text-dim)';
            indexLbl.style.width = '20px';

            item.appendChild(checkbox);
            item.appendChild(name);
            item.appendChild(indexLbl);
            listContainer.appendChild(item);
        });

        const footer = document.createElement('div');
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        footer.style.gap = '8px';
        content.appendChild(footer);

        const refreshBtn = document.createElement('button');
        refreshBtn.innerText = 'Refresh';
        refreshBtn.className = 'unity-button';
        refreshBtn.onclick = () => this.refreshScenes();
        footer.appendChild(refreshBtn);

        const buildBtn = document.createElement('button');
        buildBtn.innerText = 'Build (Mock)';
        buildBtn.className = 'unity-button';
        buildBtn.style.padding = '5px 20px';
        buildBtn.style.background = '#4CAF50';
        buildBtn.style.color = 'white';
        buildBtn.onclick = () => {
            console.log("Building game with scenes:", this.scenes.filter(s => s.included));
            alert("Build complete (mock). Check console for details.");
        };
        footer.appendChild(buildBtn);
    }
}
