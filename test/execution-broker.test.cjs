'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ProjectTrustStore } = require('../electron/security/project-trust');
const { TrustGatedExecutionBroker } = require('../electron/security/execution-broker');
const {
    EXECUTION_KINDS,
    validateExecutionRequest
} = require('../electron/security/execution-contract');

function fixture(t) {
    const base = fs.mkdtempSync(path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || os.tmpdir(), 'tugberk-broker-'));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const project = path.join(base, 'project');
    fs.mkdirSync(path.join(project, 'Assets'), { recursive: true });
    return {
        project,
        trustStore: new ProjectTrustStore(path.join(base, 'state', 'trust.json'))
    };
}

test('all project-controlled execution kinds fail closed in safe mode', async (t) => {
    const { project, trustStore } = fixture(t);
    let dispatches = 0;
    const runner = async () => { dispatches += 1; };
    const broker = new TrustGatedExecutionBroker({
        trustStore,
        runners: Object.fromEntries(EXECUTION_KINDS.map((kind) => [kind, runner]))
    });

    for (const kind of EXECUTION_KINDS) {
        await assert.rejects(
            broker.execute({ projectPath: project, kind, entrypoint: 'Assets/task.js', arguments: [] }),
            (error) => error.code === 'PROJECT_TRUST_REQUIRED'
        );
    }
    assert.equal(dispatches, 0);
});

test('trusted requests dispatch canonical, bounded execution context', async (t) => {
    const { project, trustStore } = fixture(t);
    trustStore.trust(project);
    let observed;
    const broker = new TrustGatedExecutionBroker({
        trustStore,
        createOperationId: () => 'operation-1',
        runners: { script: async (context) => { observed = context; return { exitCode: 0 }; } }
    });

    const result = await broker.execute({
        projectPath: path.join(project, '.'),
        kind: 'script',
        entrypoint: 'Assets/main.js',
        arguments: ['--mode', 'test']
    });

    assert.equal(result.operationId, 'operation-1');
    assert.deepEqual(result.value, { exitCode: 0 });
    assert.equal(observed.projectRoot, fs.realpathSync.native(project));
    assert.equal(observed.entrypoint, path.join(fs.realpathSync.native(project), 'Assets', 'main.js'));
    assert.deepEqual([...observed.arguments], ['--mode', 'test']);
    assert.equal(broker.activeCount, 0);
});

test('contract rejects traversal, absolute entrypoints, unknown fields, and oversized arguments', () => {
    const base = { projectPath: 'C:\\project', kind: 'plugin', entrypoint: 'Assets/plugin.js', arguments: [] };
    for (const entrypoint of ['../escape.js', '/absolute.js', 'C:\\absolute.js', 'Assets//plugin.js']) {
        assert.equal(validateExecutionRequest({ ...base, entrypoint }).ok, false);
    }
    assert.equal(validateExecutionRequest({ ...base, unexpected: true }).ok, false);
    assert.equal(validateExecutionRequest({ ...base, arguments: ['x'.repeat(17 * 1024)] }).ok, false);
});

test('revocation aborts matching active work and waits for executor cleanup', async (t) => {
    const { project, trustStore } = fixture(t);
    trustStore.trust(project);
    let cleanupFinished = false;
    let started;
    const didStart = new Promise((resolve) => { started = resolve; });
    const broker = new TrustGatedExecutionBroker({
        trustStore,
        runners: {
            importer: ({ signal }) => new Promise((resolve) => {
                started();
                signal.addEventListener('abort', () => {
                    setImmediate(() => {
                        cleanupFinished = true;
                        resolve('cleaned');
                    });
                }, { once: true });
            })
        }
    });

    const running = broker.execute({
        projectPath: project,
        kind: 'importer',
        entrypoint: 'Assets/importer.js',
        arguments: []
    });
    await didStart;
    trustStore.revoke(project);
    await broker.revokeProject(project);
    assert.equal(cleanupFinished, true);
    await assert.rejects(running, (error) => error.code === 'EXECUTION_CANCELLED');
    assert.equal(broker.activeCount, 0);
});

test('shutdown aborts every operation and rejects future dispatch', async (t) => {
    const { project, trustStore } = fixture(t);
    trustStore.trust(project);
    const runner = ({ signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
    });
    const broker = new TrustGatedExecutionBroker({
        trustStore,
        runners: Object.fromEntries(EXECUTION_KINDS.map((kind) => [kind, runner]))
    });
    const running = broker.execute({
        projectPath: project,
        kind: 'build',
        entrypoint: 'ProjectSettings/Build.json',
        arguments: []
    });
    await new Promise((resolve) => setImmediate(resolve));
    await broker.shutdown();
    await assert.rejects(running, (error) => error.code === 'EXECUTION_CANCELLED');
    await assert.rejects(
        broker.execute({ projectPath: project, kind: 'build', entrypoint: 'ProjectSettings/Build.json', arguments: [] }),
        (error) => error.code === 'BROKER_SHUTDOWN'
    );
});

test('Electron lifecycle routes trust revocation and shutdown through the broker', () => {
    const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
    assert.match(main, /new TrustGatedExecutionBroker\(/);
    assert.match(main, /register\('project-execution', async \(\) => executionBroker\.shutdown\(\)\)/);
    assert.match(
        main,
        /getProjectTrustStore\(\)\.revoke\(projectPath\);\s*await executionBroker\.revokeProject\(status\.root\);/
    );
});
