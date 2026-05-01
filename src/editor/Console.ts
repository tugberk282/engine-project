export class Console {
    private static logContainer: HTMLElement | null = null;
    private static originalLog = console.log;
    private static originalWarn = console.warn;
    private static originalError = console.error;

    public static initialize() {
        this.logContainer = document.getElementById('console-logs');
        const clearBtn = document.getElementById('console-clear-btn');
        if (clearBtn) {
            clearBtn.onclick = () => this.clear();
        }

        // Intercept console methods
        console.log = (...args) => {
            this.originalLog(...args);
            this.addLog(args.join(' '), 'info');
        };

        console.warn = (...args) => {
            this.originalWarn(...args);
            this.addLog(args.join(' '), 'warn');
        };

        console.error = (...args) => {
            this.originalError(...args);
            this.addLog(args.join(' '), 'error');
        };

        // Global error handler
        window.onerror = (message, source, lineno, colno) => {
            this.addLog(`${message} (${source}:${lineno}:${colno})`, 'error');
        };

        // Filter Checkboxes Logic
        const filters = ['info', 'warn', 'error'];
        filters.forEach(type => {
            const check = document.getElementById(`log-${type}-check`) as HTMLInputElement;
            if (check) {
                check.onclick = () => this.updateFilters();
            }
        });
    }

    private static updateFilters() {
        if (!this.logContainer) return;
        const info = (document.getElementById('log-info-check') as HTMLInputElement).checked;
        const warn = (document.getElementById('log-warn-check') as HTMLInputElement).checked;
        const error = (document.getElementById('log-error-check') as HTMLInputElement).checked;

        Array.from(this.logContainer.children).forEach((child: any) => {
            if (child.classList.contains('console-log-info')) child.style.display = info ? 'flex' : 'none';
            if (child.classList.contains('console-log-warn')) child.style.display = warn ? 'flex' : 'none';
            if (child.classList.contains('console-log-error')) child.style.display = error ? 'flex' : 'none';
        });
    }

    private static addLog(message: string, type: 'info' | 'warn' | 'error') {
        if (!this.logContainer) return;

        const logItem = document.createElement('div');
        logItem.className = `console-log-${type}`;
        logItem.style.padding = '4px 8px';
        logItem.style.borderBottom = '1px solid #222';
        logItem.style.display = 'flex';
        logItem.style.gap = '8px';
        logItem.style.alignItems = 'flex-start';

        // Check current filter
        const check = document.getElementById(`log-${type}-check`) as HTMLInputElement;
        if (check && !check.checked) {
            logItem.style.display = 'none';
        }

        const icon = document.createElement('span');
        icon.innerText = type === 'info' ? 'ℹ' : type === 'warn' ? '⚠' : '❌';
        icon.style.color = type === 'info' ? '#aaa' : type === 'warn' ? '#ffcc00' : '#ff4444';

        const text = document.createElement('span');
        text.innerText = message;
        text.style.color = type === 'info' ? '#ccc' : type === 'warn' ? '#eebb33' : '#ff6666';
        text.style.wordBreak = 'break-all';

        const time = document.createElement('span');
        const now = new Date();
        time.innerText = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
        time.style.color = '#555';
        time.style.fontSize = '9px';
        time.style.marginLeft = 'auto';
        time.style.minWidth = '50px';

        logItem.appendChild(icon);
        logItem.appendChild(text);
        logItem.appendChild(time);

        this.logContainer.appendChild(logItem);
        this.logContainer.scrollTop = this.logContainer.scrollHeight;

        if (this.logContainer.children.length > 200) {
            this.logContainer.removeChild(this.logContainer.firstChild!);
        }
    }

    public static clear() {
        if (this.logContainer) {
            this.logContainer.innerHTML = '';
        }
    }
}
