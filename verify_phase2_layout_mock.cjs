#!/usr/bin/env node

/**
 * Phase 2: Layout and Windowing - Comprehensive Test Suite
 * 
 * Tests for docking system, window management, layout persistence without
 * requiring TypeScript compilation. Uses mock objects to validate logic.
 */

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

let testsPassed = 0;
let testsFailed = 0;
const failedTests = [];

function log(color, message) {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function test(condition, testName) {
    if (condition) {
        testsPassed++;
        log('green', `✓ ${testName}`);
    } else {
        testsFailed++;
        failedTests.push(testName);
        log('red', `✗ ${testName}`);
    }
}

// Mock Window/Panel system
class MockPanel {
    constructor(id, title, type) {
        this.id = id;
        this.title = title;
        this.type = type;
        this.visible = true;
        this.floating = false;
        this.locked = false;
        this.dockHost = null;
    }

    setDockHost(host) {
        this.dockHost = host;
    }

    setFloating(floating) {
        this.floating = floating;
    }
}

class MockDockHost {
    constructor(id) {
        this.id = id;
        this.panels = [];
        this.children = [];
        this.parent = null;
        this.split = 'horizontal'; // 'horizontal' or 'vertical'
        this.ratio = 0.5; // split ratio
    }

    addPanel(panel) {
        this.panels.push(panel);
        panel.setDockHost(this);
    }

    removePanel(panel) {
        const idx = this.panels.indexOf(panel);
        if (idx > -1) this.panels.splice(idx, 1);
    }

    splitHost(direction, newHost) {
        this.split = direction;
        this.children.push(newHost);
        newHost.parent = this;
    }

    mergeWith(other) {
        other.panels.forEach(p => this.addPanel(p));
        const idx = this.children.indexOf(other);
        if (idx > -1) this.children.splice(idx, 1);
    }
}

class MockLayoutManager {
    constructor() {
        this.hosts = [];
        this.panels = [];
        this.layout = {
            presets: ['Default', 'Wide', 'Tall', 'Debug'],
            current: 'Default'
        };
        this.history = [];
    }

    createPanel(id, title, type) {
        const panel = new MockPanel(id, title, type);
        this.panels.push(panel);
        return panel;
    }

    createHost(id) {
        const host = new MockDockHost(id);
        this.hosts.push(host);
        return host;
    }

    dockPanel(panel, host) {
        host.addPanel(panel);
        this.recordAction('dock', { panel: panel.id, host: host.id });
    }

    floatPanel(panel) {
        panel.setFloating(true);
        this.recordAction('float', { panel: panel.id });
    }

    recordAction(action, data) {
        this.history.push({ action, data, timestamp: Date.now() });
    }

    saveLayout(name) {
        this.layout.presets.push(name);
        this.layout.current = name;
        return { name, panels: this.panels.length, hosts: this.hosts.length };
    }

    loadLayout(name) {
        if (this.layout.presets.includes(name)) {
            this.layout.current = name;
            return true;
        }
        return false;
    }

    resetLayout() {
        this.layout.current = 'Default';
        // Preserve history but record the reset action for auditability
        this.recordAction('reset', { previousPreset: this.layout.current });
        return true;
    }

    getLayoutState() {
        return {
            current: this.layout.current,
            panels: this.panels.map(p => ({
                id: p.id,
                title: p.title,
                type: p.type,
                visible: p.visible,
                floating: p.floating,
                host: p.dockHost ? p.dockHost.id : null
            })),
            hosts: this.hosts.map(h => ({
                id: h.id,
                panels: h.panels.map(p => p.id),
                split: h.split,
                ratio: h.ratio
            }))
        };
    }
}

log('cyan', '\n╔═══════════════════════════════════════════════════════════════╗');
log('cyan', '║         PHASE 2: LAYOUT AND WINDOWING TEST SUITE              ║');
log('cyan', '║      Docking, Floating, Layout Persistence, Window Management ║');
log('cyan', '╚═══════════════════════════════════════════════════════════════╝\n');

// Initialize mock layout system
const layoutMgr = new MockLayoutManager();

// ============================================================================
// TEST SUITE 1: Panel and Host Creation
log('blue', '\n━━━ TEST SUITE 1: Panel and Host Creation ━━━');

const hierarchyPanel = layoutMgr.createPanel('hierarchy', 'Hierarchy', 'tree');
const inspectorPanel = layoutMgr.createPanel('inspector', 'Inspector', 'properties');
const projectPanel = layoutMgr.createPanel('project', 'Project', 'folder');
const consolePanel = layoutMgr.createPanel('console', 'Console', 'output');

test(hierarchyPanel.id === 'hierarchy', 'Hierarchy panel created');
test(inspectorPanel.id === 'inspector', 'Inspector panel created');
test(projectPanel.id === 'project', 'Project panel created');
test(consolePanel.id === 'console', 'Console panel created');

const host1 = layoutMgr.createHost('host-1');
const host2 = layoutMgr.createHost('host-2');

test(host1.id === 'host-1', 'Host 1 created');
test(host2.id === 'host-2', 'Host 2 created');
test(layoutMgr.hosts.length === 2, 'Both hosts tracked in manager');

// ============================================================================
// TEST SUITE 2: Docking System
log('blue', '\n━━━ TEST SUITE 2: Docking System ━━━');

layoutMgr.dockPanel(hierarchyPanel, host1);
layoutMgr.dockPanel(inspectorPanel, host1);

test(host1.panels.length === 2, 'Multiple panels docked in host');
test(hierarchyPanel.dockHost === host1, 'Panel references dock host');
test(host1.panels[0] === hierarchyPanel, 'First panel docked correctly');

layoutMgr.dockPanel(projectPanel, host2);
test(host2.panels.length === 1, 'Panel docked in second host');
test(projectPanel.dockHost === host2, 'Panel references correct host');

// ============================================================================
// TEST SUITE 3: Floating Windows
log('blue', '\n━━━ TEST SUITE 3: Floating Windows ━━━');

layoutMgr.floatPanel(consolePanel);
test(consolePanel.floating === true, 'Panel marked as floating');
test(consolePanel.dockHost === null, 'Floating panel has no dock host');

const floatingState = layoutMgr.getLayoutState();
const floatingPanel = floatingState.panels.find(p => p.id === 'console');
test(floatingPanel.floating === true, 'Floating state persisted in layout state');

// ============================================================================
// TEST SUITE 4: Panel Visibility and Lock
log('blue', '\n━━━ TEST SUITE 4: Panel Visibility and Lock ━━━');

hierarchyPanel.visible = false;
test(hierarchyPanel.visible === false, 'Panel visibility toggle');

hierarchyPanel.locked = true;
test(hierarchyPanel.locked === true, 'Panel lock state');

hierarchyPanel.visible = true;
hierarchyPanel.locked = false;
test(hierarchyPanel.visible === true && hierarchyPanel.locked === false, 'Panel state reset');

// ============================================================================
// TEST SUITE 5: Dock Host Splitting
log('blue', '\n━━━ TEST SUITE 5: Dock Host Splitting ━━━');

const host3 = layoutMgr.createHost('host-3');
host1.splitHost('vertical', host3);

test(host1.children.length === 1, 'Child host added via split');
test(host3.parent === host1, 'Parent relationship established');
test(host1.split === 'vertical', 'Split direction set to vertical');

// ============================================================================
// TEST SUITE 6: Dock Host Merging
log('blue', '\n━━━ TEST SUITE 6: Dock Host Merging ━━━');

layoutMgr.dockPanel(consolePanel, host3);
const beforeMerge = host1.panels.length + host3.panels.length;

host1.mergeWith(host3);
test(host1.panels.length === beforeMerge, 'All panels merged to host1');
test(host1.children.indexOf(host3) === -1, 'Host3 removed from children');

// ============================================================================
// TEST SUITE 7: Layout State Serialization
log('blue', '\n━━━ TEST SUITE 7: Layout State Serialization ━━━');

const layoutState = layoutMgr.getLayoutState();
test(layoutState.current === 'Default', 'Current layout name captured');
test(layoutState.panels.length === 4, 'All panels in state');
test(layoutState.hosts.length > 0, 'All hosts in state');

const serialized = JSON.stringify(layoutState);
const deserialized = JSON.parse(serialized);
test(deserialized.panels.length === 4, 'Layout state can be serialized');
test(deserialized.current === 'Default', 'Layout name preserved in serialization');

// ============================================================================
// TEST SUITE 8: Layout Presets
log('blue', '\n━━━ TEST SUITE 8: Layout Presets ━━━');

test(layoutMgr.layout.presets.includes('Default'), 'Default preset exists');
test(layoutMgr.layout.presets.length === 4, 'Standard presets available');

layoutMgr.saveLayout('CustomLayout');
test(layoutMgr.layout.presets.includes('CustomLayout'), 'Custom layout saved');
test(layoutMgr.layout.current === 'CustomLayout', 'Custom layout set as current');

const loaded = layoutMgr.loadLayout('Default');
test(loaded === true, 'Layout loaded successfully');
test(layoutMgr.layout.current === 'Default', 'Current layout switched');

// ============================================================================
// TEST SUITE 9: Layout Reset
log('blue', '\n━━━ TEST SUITE 9: Layout Reset ━━━');

const beforeReset = layoutMgr.history.length;
const reset = layoutMgr.resetLayout();

test(reset === true, 'Layout reset successful');
test(layoutMgr.layout.current === 'Default', 'Layout reset to Default');

// ============================================================================
// TEST SUITE 10: Action History Tracking
log('blue', '\n━━━ TEST SUITE 10: Action History Tracking ━━━');

test(layoutMgr.history.length > 0, 'Action history recorded');

const dockActions = layoutMgr.history.filter(h => h.action === 'dock');
test(dockActions.length > 0, 'Dock actions in history');

const floatActions = layoutMgr.history.filter(h => h.action === 'float');
test(floatActions.length > 0, 'Float actions in history');

// ============================================================================
// Summary
log('blue', '\n━━━ TEST SUMMARY ━━━');
log('yellow', `Total Tests: ${testsPassed + testsFailed}`);
log('green', `Passed: ${testsPassed}`);
testsFailed > 0 && log('red', `Failed: ${testsFailed}`);

if (failedTests.length > 0) {
    log('red', '\nFailed tests:');
    failedTests.forEach(t => log('red', `  • ${t}`));
}

log(testsFailed === 0 ? 'green' : 'yellow',
    `\n${testsFailed === 0 ? '✓ ALL TESTS PASSED' : '⚠ SOME TESTS FAILED'} - PHASE 2\n`);

const passPercentage = testsFailed === 0 ? 100 : Math.round((testsPassed / (testsPassed + testsFailed)) * 100);
log('cyan', `Pass rate: ${passPercentage}%\n`);

process.exit(testsFailed > 0 ? 1 : 0);
