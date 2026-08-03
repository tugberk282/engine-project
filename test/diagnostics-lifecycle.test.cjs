'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DiagnosticStore, redact } = require('../electron/diagnostics/diagnostic-store');
const { percentile, evaluatePerformance } = require('../electron/diagnostics/performance-budgets');
const { ShutdownCoordinator } = require('../electron/lifecycle/shutdown-coordinator');
const { StartupRecovery } = require('../electron/lifecycle/startup-recovery');

test('diagnostics redact secrets, paths, and oversized values', () => {
    const safe = redact({ token: 'secret', projectPath: 'C:\\private\\game', message: 'x'.repeat(600) });
    assert.equal(safe.token, '[REDACTED]');
    assert.equal(safe.projectPath, '[PATH]');
    assert.equal(safe.message.length, 512);
});

test('diagnostic retention is bounded and an unwritable target fails closed', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-diag-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const store = new DiagnosticStore({ directory, maxBytes: 180, maxFiles: 3 });
    for (let index = 0; index < 20; index += 1) {
        store.record({ requestId: `r-${index}`, operation: 'project.readText', outcome: 'success' });
    }
    assert.ok(fs.readdirSync(directory).length <= 3);
    const invalid = new DiagnosticStore({ directory: path.join(directory, 'not-a-dir') });
    fs.writeFileSync(invalid.directory, 'occupied');
    assert.equal(invalid.record({ operation: 'test' }), false);
    assert.equal(invalid.record({ operation: 'test-again' }), false);
});

test('request correlation records a bounded host outcome', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-correlation-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const store = new DiagnosticStore({ directory });
    store.record({ processRole: 'main', requestId: 'renderer-1', operation: 'project.readText', durationMs: 4, outcome: 'success' });
    const event = JSON.parse(fs.readFileSync(path.join(directory, 'events.ndjson'), 'utf8').trim());
    assert.equal(event.requestId, 'renderer-1');
    assert.equal(event.operation, 'project.readText');
    assert.equal(event.outcome, 'success');
});

test('shutdown rejects new work, is idempotent, and bounds stalled services', async () => {
    let calls = 0;
    const coordinator = new ShutdownCoordinator({ deadlineMs: 10 });
    coordinator.register('clean', async () => { calls += 1; });
    coordinator.register('stalled', () => new Promise(() => {}));
    const first = coordinator.shutdown();
    assert.equal(first, coordinator.shutdown());
    assert.throws(() => coordinator.assertAcceptingWork(), { code: 'SERVICE_SHUTTING_DOWN' });
    const result = await first;
    assert.equal(calls, 1);
    assert.equal(result.outcome, 'degraded');
    assert.equal(result.services[1].errorCode, 'SHUTDOWN_TIMEOUT');
});

test('repeated unclean startups enter safe mode and a clean stop resets the streak', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-startup-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'startup.json');
    assert.equal(new StartupRecovery(file, { safeModeThreshold: 2 }).begin().safeMode, false);
    assert.equal(new StartupRecovery(file, { safeModeThreshold: 2 }).begin().safeMode, false);
    const third = new StartupRecovery(file, { safeModeThreshold: 2 });
    assert.equal(third.begin().safeMode, true);
    assert.equal(third.markClean(), true);
    assert.equal(new StartupRecovery(file, { safeModeThreshold: 2 }).begin().consecutiveUnclean, 0);
});

test('performance harness reports p95 and hard memory budget outcomes', () => {
    assert.equal(percentile([1, 2, 3, 4, 100]), 100);
    const result = evaluatePerformance({
        coldLaunchMs: [4000],
        enterPlayMs: [400],
        frameMs: [17],
        idleMemoryBytes: [400 * 1024 * 1024],
        assetScanMs: [900]
    });
    assert.equal(result.coldLaunchMs.pass, true);
    assert.equal(result.frameMs.pass, false);
});
