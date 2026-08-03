import { EditorWindow } from './EditorWindow';

type ConsoleLogType = 'info' | 'warn' | 'error';

export interface ConsoleLocation {
    file: string;
    line: number;
    column: number;
}

export interface ConsoleLogEntry {
    id: number;
    message: string;
    type: ConsoleLogType;
    time: string;
    stack: string;
    location: ConsoleLocation | null;
}

interface VisibleConsoleEntry {
    entry: ConsoleLogEntry;
    count: number;
}

const MAX_LOGS = 500;

export class ConsoleWindow extends EditorWindow {
    private logContainer: HTMLElement | null = null;
    private details: HTMLElement | null = null;
    private searchInput: HTMLInputElement | null = null;
    private selectedId: number | null = null;
    private nextLogId = 1;
    private collapse = false;
    private filter: Record<ConsoleLogType, boolean> = { info: true, warn: true, error: true };
    public logs: ConsoleLogEntry[] = [];

    constructor(parent: HTMLElement) {
        super(parent, 'Console');
        this.initializeInterception();
    }

    private initializeInterception(): void {
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;

        console.log = (...args: any[]) => {
            originalLog(...args);
            this.addLog(args.map(formatArgument).join(' '), 'info', captureStack());
        };
        console.warn = (...args: any[]) => {
            originalWarn(...args);
            this.addLog(args.map(formatArgument).join(' '), 'warn', captureStack());
        };
        console.error = (...args: any[]) => {
            originalError(...args);
            this.addLog(args.map(formatArgument).join(' '), 'error', captureStack());
        };

        window.addEventListener('error', (event) => {
            const location = event.filename
                ? `${event.filename}:${event.lineno || 1}:${event.colno || 1}`
                : '';
            this.addLog(event.message, 'error', event.error?.stack || location);
        });
    }

    public onGUI(): void {
        const content = this.getContentArea();
        content.replaceChildren();
        content.className = 'console-window-content';

        const toolbar = document.createElement('div');
        toolbar.className = 'console-toolbar';
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-label', 'Console controls');

        const clearButton = createButton('Clear', 'Clear all console messages');
        clearButton.addEventListener('click', () => this.clear());
        toolbar.append(clearButton);

        const collapseButton = createButton('Collapse', 'Group identical messages');
        collapseButton.classList.add('console-toggle');
        collapseButton.setAttribute('aria-pressed', String(this.collapse));
        collapseButton.addEventListener('click', () => {
            this.collapse = !this.collapse;
            collapseButton.setAttribute('aria-pressed', String(this.collapse));
            this.refreshLogs();
        });
        toolbar.append(collapseButton);

        this.searchInput = document.createElement('input');
        this.searchInput.type = 'search';
        this.searchInput.className = 'console-search';
        this.searchInput.placeholder = 'Search';
        this.searchInput.setAttribute('aria-label', 'Search console messages');
        this.searchInput.addEventListener('input', () => this.refreshLogs());
        toolbar.append(this.searchInput);

        const filters = document.createElement('div');
        filters.className = 'console-filters';
        for (const type of ['info', 'warn', 'error'] as ConsoleLogType[]) {
            const button = createButton('', `Toggle ${type} messages`);
            button.className = `console-filter console-filter-${type}`;
            button.dataset.type = type;
            button.setAttribute('aria-pressed', String(this.filter[type]));
            button.addEventListener('click', () => {
                this.filter[type] = !this.filter[type];
                button.setAttribute('aria-pressed', String(this.filter[type]));
                this.refreshLogs();
            });
            filters.append(button);
        }
        toolbar.append(filters);
        content.append(toolbar);

        const body = document.createElement('div');
        body.className = 'console-body';
        this.logContainer = document.createElement('div');
        this.logContainer.className = 'console-log-container';
        this.logContainer.tabIndex = 0;
        this.logContainer.setAttribute('role', 'listbox');
        this.logContainer.setAttribute('aria-label', 'Console messages');
        this.logContainer.addEventListener('keydown', (event) => this.handleKeyDown(event));
        this.logContainer.addEventListener('contextmenu', (event) => this.openContextMenu(event));

        this.details = document.createElement('section');
        this.details.className = 'console-details';
        this.details.setAttribute('aria-label', 'Selected message details');
        this.details.setAttribute('aria-live', 'polite');
        body.append(this.logContainer, this.details);
        content.append(body);
        this.refreshLogs();
    }

    private addLog(message: string, type: ConsoleLogType, stack = ''): void {
        const now = new Date();
        const entry: ConsoleLogEntry = {
            id: this.nextLogId++,
            message,
            type,
            time: now.toLocaleTimeString([], { hour12: false }),
            stack,
            location: parseFirstLocation(stack)
        };
        this.logs.push(entry);
        if (this.logs.length > MAX_LOGS) {
            const removed = this.logs.shift();
            if (removed?.id === this.selectedId) this.selectedId = null;
        }
        if (this.isVisible()) this.refreshLogs(true);
    }

    private getVisibleEntries(): VisibleConsoleEntry[] {
        const query = this.searchInput?.value.trim().toLocaleLowerCase() ?? '';
        const visible = this.logs.filter((entry) => {
            if (!this.filter[entry.type]) return false;
            return !query || `${entry.message}\n${entry.stack}`.toLocaleLowerCase().includes(query);
        });
        if (!this.collapse) return visible.map((entry) => ({ entry, count: 1 }));

        const grouped = new Map<string, VisibleConsoleEntry>();
        for (const entry of visible) {
            const key = `${entry.type}\0${entry.message}\0${entry.stack}`;
            const existing = grouped.get(key);
            if (existing) {
                existing.count += 1;
                existing.entry = entry;
            } else {
                grouped.set(key, { entry, count: 1 });
            }
        }
        return [...grouped.values()];
    }

    private refreshLogs(followNewest = false): void {
        if (!this.logContainer) return;
        const entries = this.getVisibleEntries();
        const selectedVisible = entries.some(({ entry }) => entry.id === this.selectedId);
        if (!selectedVisible && this.selectedId !== null) this.selectedId = null;

        this.logContainer.replaceChildren();
        for (const visible of entries) this.logContainer.append(this.createLogRow(visible));

        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'editor-empty-state';
            const title = document.createElement('div');
            title.className = 'editor-empty-state-title';
            title.textContent = this.logs.length === 0 ? 'Console is clear' : 'No logs match the current filters';
            const hint = document.createElement('div');
            hint.className = 'editor-empty-state-hint';
            hint.textContent = this.logs.length === 0
                ? 'Runtime logs, warnings and errors will appear here.'
                : 'Change the search or enable a message type to show hidden entries.';
            empty.append(title, hint);
            this.logContainer.append(empty);
        }

        this.updateFilterCounts();
        this.renderDetails();
        if (followNewest) this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }

    private createLogRow({ entry, count }: VisibleConsoleEntry): HTMLElement {
        const log = entry;
        const item = document.createElement('div');
        item.className = `console-item console-item-${log.type}`;
        item.dataset.logId = String(log.id);
        item.id = `console-log-${log.id}`;
        item.tabIndex = -1;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(log.id === this.selectedId));
        item.title = 'Double-click to open the first stack location';

        const icon = document.createElement('span');
        icon.className = 'console-icon';
        icon.textContent = log.type === 'info' ? 'i' : log.type === 'warn' ? '!' : '×';
        icon.setAttribute('aria-hidden', 'true');
        const message = document.createElement('span');
        message.className = 'console-message';
        message.textContent = log.message;
        const time = document.createElement('time');
        time.className = 'console-time';
        time.textContent = log.time;
        item.append(icon, message);
        if (count > 1) {
            const badge = document.createElement('span');
            badge.className = 'console-count';
            badge.textContent = String(count);
            badge.setAttribute('aria-label', `${count} identical messages`);
            item.append(badge);
        }
        item.append(time);
        item.addEventListener('click', () => this.selectEntry(log.id));
        item.addEventListener('dblclick', () => this.openLocation(log));
        return item;
    }

    private selectEntry(id: number, focus = false): void {
        this.selectedId = id;
        for (const row of this.logContainer?.querySelectorAll<HTMLElement>('.console-item') ?? []) {
            const selected = row.dataset.logId === String(id);
            row.setAttribute('aria-selected', String(selected));
            if (selected && focus) row.focus();
        }
        this.logContainer?.setAttribute('aria-activedescendant', `console-log-${id}`);
        this.renderDetails();
    }

    private renderDetails(): void {
        if (!this.details) return;
        this.details.replaceChildren();
        const entry = this.logs.find((log) => log.id === this.selectedId);
        this.details.hidden = !entry;
        if (!entry) return;

        const message = document.createElement('div');
        message.className = `console-details-message console-item-${entry.type}`;
        message.textContent = entry.message;
        const stack = document.createElement('pre');
        stack.className = 'console-stack';
        stack.textContent = entry.stack || 'No stack trace is available for this message.';
        this.details.append(message, stack);
        if (entry.location) {
            const openButton = createButton(
                `Open ${shortenPath(entry.location.file)}:${entry.location.line}`,
                'Open the first stack location'
            );
            openButton.classList.add('console-open-location');
            openButton.addEventListener('click', () => this.openLocation(entry));
            this.details.append(openButton);
        }
    }

    private handleKeyDown(event: KeyboardEvent): void {
        const entries = this.getVisibleEntries();
        if (entries.length === 0) return;
        const selectedIndex = entries.findIndex(({ entry }) => entry.id === this.selectedId);
        let nextIndex = selectedIndex;
        if (event.key === 'ArrowDown') nextIndex = Math.min(entries.length - 1, selectedIndex + 1);
        else if (event.key === 'ArrowUp') nextIndex = Math.max(0, selectedIndex < 0 ? entries.length - 1 : selectedIndex - 1);
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = entries.length - 1;
        else if (event.key === 'Enter' && selectedIndex >= 0) this.openLocation(entries[selectedIndex].entry);
        else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selectedIndex >= 0) {
            void navigator.clipboard?.writeText(entries[selectedIndex].entry.message);
        } else if (event.key === 'Escape') {
            this.selectedId = null;
            this.refreshLogs();
        } else return;
        event.preventDefault();
        if (nextIndex >= 0) this.selectEntry(entries[nextIndex].entry.id, true);
    }

    private openContextMenu(event: MouseEvent): void {
        const row = (event.target as Element).closest<HTMLElement>('.console-item');
        if (!row) return;
        event.preventDefault();
        const id = Number(row.dataset.logId);
        const entry = this.logs.find((log) => log.id === id);
        if (!entry) return;
        this.selectEntry(id);
        document.querySelector('.console-context-menu')?.remove();

        const menu = document.createElement('div');
        menu.className = 'console-context-menu';
        menu.setAttribute('role', 'menu');
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
        const addAction = (label: string, action: () => void, disabled = false) => {
            const button = createButton(label, label);
            button.setAttribute('role', 'menuitem');
            button.disabled = disabled;
            button.addEventListener('click', () => {
                action();
                menu.remove();
            });
            menu.append(button);
        };
        addAction('Copy', () => void navigator.clipboard?.writeText(`${entry.message}\n${entry.stack}`.trim()));
        addAction('Open Stack Location', () => this.openLocation(entry), !entry.location);
        addAction('Clear', () => this.clear());
        document.body.append(menu);
        menu.querySelector<HTMLElement>('button:not(:disabled)')?.focus();

        const dismiss = (dismissEvent: Event) => {
            if (!menu.contains(dismissEvent.target as Node)) menu.remove();
        };
        requestAnimationFrame(() => document.addEventListener('pointerdown', dismiss, { once: true }));
        menu.addEventListener('keydown', (keyEvent) => {
            if (keyEvent.key === 'Escape') {
                menu.remove();
                this.logContainer?.focus();
            }
        });
    }

    private openLocation(entry: ConsoleLogEntry): void {
        if (!entry.location) return;
        this.getContentArea().dispatchEvent(new CustomEvent<ConsoleLocation>('tugberk:console-open-location', {
            bubbles: true,
            detail: entry.location
        }));
    }

    private updateFilterCounts(): void {
        const content = this.getContentArea();
        for (const type of ['info', 'warn', 'error'] as ConsoleLogType[]) {
            const button = content.querySelector<HTMLButtonElement>(`.console-filter-${type}`);
            const count = this.logs.filter((log) => log.type === type).length;
            if (button) button.textContent = `${filterSymbol(type)} ${count}`;
        }
    }

    public clear(): void {
        this.logs = [];
        this.selectedId = null;
        this.refreshLogs();
        this.logContainer?.focus();
    }

    public refresh(): void {
        this.onGUI();
    }
}

function createButton(label: string, title: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'unity-button';
    button.textContent = label;
    button.title = title;
    return button;
}

function formatArgument(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function captureStack(): string {
    return new Error().stack?.split('\n').slice(3).join('\n') ?? '';
}

export function parseFirstLocation(stack: string): ConsoleLocation | null {
    for (const line of stack.split('\n')) {
        const match = line.match(/(?:\(|at\s+)?((?:[a-zA-Z]:)?[^()\s]+):(\d+):(\d+)\)?$/);
        if (!match) continue;
        return { file: match[1], line: Number(match[2]), column: Number(match[3]) };
    }
    return null;
}

function filterSymbol(type: ConsoleLogType): string {
    return type === 'info' ? '●' : type === 'warn' ? '▲' : '⛔';
}

function shortenPath(file: string): string {
    return file.split(/[\\/]/).pop() || file;
}
