'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { BuildService } = require('../electron/build/build-service');
const { assertBuildRequest } = require('../electron/build/build-contract');
const { runPackagedPlayer } = require('../electron/build/player-runtime');

function revision(projectRoot) {
    return crypto.createHash('sha256').update(
        fs.readFileSync(path.join(projectRoot, 'project.json'), 'utf8')
    ).digest('hex');
}

function request(projectRoot, outputPath) {
    return Object.freeze({
        version: 1, projectRoot, projectRevision: revision(projectRoot),
        outputPath, target: 'win-x64'
    });
}

test('canonical sample builds reproducibly and player runs deterministic frames', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tugberk-build-test-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const projectRoot = path.join(root, 'project');
    await fs.promises.cp(path.join(__dirname, '..', 'samples', 'vertical-slice'), projectRoot, { recursive: true });
    const service = new BuildService();
    t.after(() => service.shutdown());
    const stages = [];
    const first = await service.build(request(projectRoot, path.join(root, 'first')), {
        onProgress: ({ stage }) => stages.push(stage)
    });
    const second = await service.build(request(projectRoot, path.join(root, 'second')));
    assert.deepEqual(stages, ['validate', 'resolve', 'import', 'bundle', 'package']);
    assert.equal(first.manifest.manifestHash, second.manifest.manifestHash);
    assert.deepEqual(
        fs.readFileSync(path.join(root, 'first', 'manifest.json')),
        fs.readFileSync(path.join(root, 'second', 'manifest.json'))
    );
    const runA = await runPackagedPlayer(path.join(root, 'first'), { frames: 120 });
    const runB = await runPackagedPlayer(path.join(root, 'second'), { frames: 120 });
    assert.deepEqual(runA, runB);
    assert.equal(runA.frame, 120);
    assert.equal(runA.sceneId, 'scene-vertical-slice-main');
});

test('stale revision and malicious output fail without partial publication', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tugberk-build-failure-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const projectRoot = path.join(root, 'project');
    await fs.promises.cp(path.join(__dirname, '..', 'samples', 'vertical-slice'), projectRoot, { recursive: true });
    const service = new BuildService();
    t.after(() => service.shutdown());
    const output = path.join(root, 'output');
    const stale = request(projectRoot, output);
    await fs.promises.appendFile(path.join(projectRoot, 'project.json'), ' ');
    await assert.rejects(service.build(stale), { code: 'REVISION_STALE' });
    assert.equal(fs.existsSync(output), false);
    assert.throws(() => assertBuildRequest(request(projectRoot, path.join(projectRoot, 'Build'))),
        { code: 'INVALID_OUTPUT_PATH' });
});

test('cancelled build terminates worker and does not publish', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tugberk-build-cancel-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const projectRoot = path.join(root, 'project');
    await fs.promises.cp(path.join(__dirname, '..', 'samples', 'vertical-slice'), projectRoot, { recursive: true });
    const output = path.join(root, 'output');
    const service = new BuildService();
    t.after(() => service.shutdown());
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(service.build(request(projectRoot, output), { signal: controller.signal }),
        { code: 'BUILD_CANCELLED' });
    assert.equal(fs.existsSync(output), false);
    assert.equal(service.active.size, 0);
});

test('worker crash and hang are typed and leave no output', async (t) => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tugberk-build-worker-'));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const projectRoot = path.join(root, 'project');
    await fs.promises.cp(path.join(__dirname, '..', 'samples', 'vertical-slice'), projectRoot, { recursive: true });
    const output = path.join(root, 'output');
    const crash = new BuildService({ workerPath: path.join(__dirname, 'fixtures', 'build-worker-crash.cjs') });
    await assert.rejects(crash.build(request(projectRoot, output)), { code: 'WORKER_CRASHED' });
    assert.equal(fs.existsSync(output), false);
    const hang = new BuildService({
        workerPath: path.join(__dirname, 'fixtures', 'build-worker-hang.cjs'),
        timeoutMs: 25
    });
    await assert.rejects(hang.build(request(projectRoot, output)), { code: 'WORKER_TIMEOUT' });
    assert.equal(fs.existsSync(output), false);
    assert.equal(crash.active.size, 0);
    assert.equal(hang.active.size, 0);
});
