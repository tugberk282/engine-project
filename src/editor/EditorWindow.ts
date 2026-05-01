export abstract class EditorWindow {
    protected container: HTMLElement;
    public title: string;

    constructor(parent: HTMLElement, title: string) {
        this.title = title;
        this.container = document.createElement('div');
        this.container.className = 'editor-window';
        this.container.innerHTML = `
            <div class="window-header">
                <span class="window-title">${title}</span>
                <div class="window-controls">
                    <button class="window-close">×</button>
                </div>
            </div>
            <div class="window-content"></div>
        `;
        parent.appendChild(this.container);

        const closeBtn = this.container.querySelector('.window-close') as HTMLButtonElement;
        closeBtn.onclick = () => this.destroy();
    }

    public abstract onGUI(): void;

    public update(): void {
        // Optional override for real-time updates
    }

    public destroy(): void {
        this.container.remove();
    }

    protected getContentArea(): HTMLElement {
        return this.container.querySelector('.window-content') as HTMLElement;
    }

    public isVisible(): boolean {
        return this.container.offsetParent !== null;
    }

    public abstract refresh(): void;
}
