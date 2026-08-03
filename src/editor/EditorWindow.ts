export abstract class EditorWindow {
    protected container: HTMLElement;
    protected contentArea: HTMLElement;
    public title: string;
    private readonly ownsContainer: boolean;

    constructor(parent: HTMLElement, title: string) {
        this.title = title;

        const existingPanelContent = parent.classList.contains('panel')
            ? parent.querySelector(':scope > .panel-content') as HTMLElement | null
            : null;

        if (existingPanelContent) {
            this.container = parent;
            this.contentArea = existingPanelContent;
            this.ownsContainer = false;
            return;
        }

        if (parent.classList.contains('panel-content')) {
            this.container = parent;
            this.contentArea = parent;
            this.ownsContainer = false;
            return;
        }

        this.container = document.createElement('div');
        this.container.className = 'editor-window';
        this.container.innerHTML = `
            <div class="window-header">
                <span class="window-title">${title}</span>
                <div class="window-controls">
                    <button class="window-close">x</button>
                </div>
            </div>
            <div class="window-content"></div>
        `;
        parent.appendChild(this.container);

        this.contentArea = this.container.querySelector('.window-content') as HTMLElement;
        this.ownsContainer = true;

        const closeBtn = this.container.querySelector('.window-close') as HTMLButtonElement;
        closeBtn.onclick = () => this.destroy();
    }

    public abstract onGUI(): void;

    public update(): void {
        // Optional override for real-time updates
    }

    public destroy(): void {
        if (this.ownsContainer) {
            this.container.remove();
            return;
        }
        this.contentArea.innerHTML = '';
    }

    protected getContentArea(): HTMLElement {
        return this.contentArea;
    }

    public isVisible(): boolean {
        return this.contentArea.offsetParent !== null;
    }

    public abstract refresh(): void;
}
