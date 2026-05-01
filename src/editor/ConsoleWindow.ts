import { EditorWindow } from './EditorWindow';

export class ConsoleWindow extends EditorWindow {
    private logContainer: HTMLElement | null = null;
    public logs: { message: string, type: 'info' | 'warn' | 'error', time: string }[] = [];

    constructor(parent: HTMLElement) {
        super(parent, "Console");
        this.initializeInterception();
    }

    private initializeInterception() {
        // Intercept console methods if not already done
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;

        console.log = (...args: any[]) => {
            originalLog(...args);
            this.addLog(args.join(' '), 'info');
        };

        console.warn = (...args: any[]) => {
            originalWarn(...args);
            this.addLog(args.join(' '), 'warn');
        };

        console.error = (...args: any[]) => {
            originalError(...args);
            this.addLog(args.join(' '), 'error');
        };

        window.addEventListener('error', (event) => {
            this.addLog(`${event.message} (${event.filename}:${event.lineno}:${event.colno})`, 'error');
        });
    }

    public onGUI(): void {
        const content = this.getContentArea();
        content.innerHTML = '';
        content.className = 'console-window-content';

        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'console-toolbar';
        toolbar.innerHTML = `
            <button id="console-clear-btn" class="unity-button">Clear</button>
            <div class="console-filters">
                <label><input type="checkbox" checked id="filter-info"> Info</label>
                <label><input type="checkbox" checked id="filter-warn"> Warn</label>
                <label><input type="checkbox" checked id="filter-error"> Error</label>
            </div>
        `;
        content.appendChild(toolbar);

        const clearBtn = toolbar.querySelector('#console-clear-btn') as HTMLElement;
        clearBtn.onclick = () => this.clear();

        const filterInfo = toolbar.querySelector('#filter-info') as HTMLInputElement;
        const filterWarn = toolbar.querySelector('#filter-warn') as HTMLInputElement;
        const filterError = toolbar.querySelector('#filter-error') as HTMLInputElement;

        const updateFilters = () => this.refreshLogs();
        filterInfo.onchange = updateFilters;
        filterWarn.onchange = updateFilters;
        filterError.onchange = updateFilters;

        // Log Container
        this.logContainer = document.createElement('div');
        this.logContainer.className = 'console-log-container';
        content.appendChild(this.logContainer);

        this.refreshLogs();
    }

    private addLog(message: string, type: 'info' | 'warn' | 'error') {
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
        this.logs.push({ message, type, time: timeStr });

        if (this.logs.length > 500) this.logs.shift();

        if (this.isVisible()) {
            this.refreshLogs();
        }
    }

    private refreshLogs() {
        if (!this.logContainer) return;

        const content = this.getContentArea();
        const infoEnabled = (content.querySelector('#filter-info') as HTMLInputElement)?.checked ?? true;
        const warnEnabled = (content.querySelector('#filter-warn') as HTMLInputElement)?.checked ?? true;
        const errorEnabled = (content.querySelector('#filter-error') as HTMLInputElement)?.checked ?? true;

        this.logContainer.innerHTML = '';

        this.logs.forEach(log => {
            if (log.type === 'info' && !infoEnabled) return;
            if (log.type === 'warn' && !warnEnabled) return;
            if (log.type === 'error' && !errorEnabled) return;

            const item = document.createElement('div');
            item.className = `console-item console-item-${log.type}`;
            item.innerHTML = `
                <span class="console-icon">${log.type === 'info' ? 'i' : log.type === 'warn' ? '!' : 'x'}</span>
                <span class="console-message">${log.message}</span>
                <span class="console-time">${log.time}</span>
            `;
            this.logContainer!.appendChild(item);
        });

        this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }

    public clear() {
        this.logs = [];
        this.refreshLogs();
    }

    public refresh(): void {
        this.onGUI();
    }
}

