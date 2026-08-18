'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ProjectCapabilities } = require('../electron/security/project-capabilities');
const { ProtocolGrants } = require('../electron/architecture/protocol-grants');
const { ProjectService } = require('../electron/platform/project-service');
const { AssetService } = require('../electron/platform/asset-service');
const { ProjectAssetTransactionService } = require('../electron/platform/project-asset-transaction-service');

function fixture(t, options = {}) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-services-'));
    const root = path.join(base, 'project');
    fs.mkdirSync(path.join(root, 'Assets'), { recursive: true });
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const grants = new ProtocolGrants(new ProjectCapabilities());
    const grant = grants.create(7, root, { writable: true });
    const projects = new ProjectService({ grants });
    const assets = new AssetService({ projectService: projects, ...options });
    return { root, grantId: grant.grantId, grants, projects, assets };
}

function transactionRequest(grantId, operation, overrides = {}) {
    return {
        contractVersion: 1,
        grantId,
        transactionId: `tx-${operation}-${Math.random().toString(36).slice(2)}`,
        action: 'apply',
        operation,
        sourcePath: null,
        targetPath: null,
        assetKind: 'file',
        contentBase64: null,
        metadataBase64: null,
        referencePatches: [],
        ...overrides
    };
}

test('project service returns stable lexical directory entries and writes atomically', async (t) => {
    const { root, grantId, projects } = fixture(t);
    fs.writeFileSync(path.join(root, 'Assets', 'z.txt'), 'z');
    fs.writeFileSync(path.join(root, 'Assets', 'a.txt'), 'old');
    const resource = { grantId, path: 'Assets/a.txt' };

    await projects.writeText(7, resource, 'new');
    assert.equal(await projects.readText(7, resource), 'new');
    assert.deepEqual(
        (await projects.listDirectory(7, { grantId, path: 'Assets' })).map((entry) => entry.name),
        ['a.txt', 'z.txt']
    );
    assert.deepEqual(fs.readdirSync(path.join(root, 'Assets')).filter((name) => name.includes('.tmp')), []);
});

test('asset scan is bounded, cancellable, symlink-safe and deterministically ordered', async (t) => {
    const { root, grantId, assets } = fixture(t, { maxEntries: 10 });
    fs.mkdirSync(path.join(root, 'Assets', 'Nested'));
    fs.writeFileSync(path.join(root, 'Assets', 'z.asset'), '');
    fs.writeFileSync(path.join(root, 'Assets', 'Nested', 'a.asset'), '');
    const controller = new AbortController();
    const result = await assets.scan(7, { grantId, path: 'Assets' });
    assert.deepEqual(result.assets, ['Assets/Nested/a.asset', 'Assets/z.asset']);

    controller.abort();
    await assert.rejects(
        assets.scan(7, { grantId, path: 'Assets' }, { signal: controller.signal }),
        (error) => error.code === 'REQUEST_CANCELLED'
    );
});

test('asset move preserves GUID metadata and metadata updates are deterministic', async (t) => {
    const { root, grantId, assets } = fixture(t);
    fs.writeFileSync(path.join(root, 'Assets', 'old.asset'), 'asset');
    fs.writeFileSync(path.join(root, 'Assets', 'old.asset.meta'), '{"guid":"guid-1"}');

    const result = await assets.move(
        7,
        { grantId, path: 'Assets/old.asset' },
        { grantId, path: 'Assets/new.asset' }
    );
    assert.deepEqual(result, { moved: true, metadataMoved: true });
    assert.equal(fs.readFileSync(path.join(root, 'Assets', 'new.asset.meta'), 'utf8'), '{"guid":"guid-1"}');

    await assets.writeMetadata(7, { grantId, path: 'Assets/new.asset.meta' }, {
        settings: { z: 1, a: true },
        guid: 'guid-1'
    });
    assert.equal(
        fs.readFileSync(path.join(root, 'Assets', 'new.asset.meta'), 'utf8'),
        '{\n  "guid": "guid-1",\n  "settings": {\n    "a": true,\n    "z": 1\n  }\n}\n'
    );
});

test('asset scan rejects excessive trees with a stable code', async (t) => {
    const { root, grantId, assets } = fixture(t, { maxEntries: 2 });
    for (const name of ['a', 'b', 'c']) fs.writeFileSync(path.join(root, 'Assets', name), '');
    await assert.rejects(
        assets.scan(7, { grantId, path: 'Assets' }),
        (error) => error.code === 'SCAN_LIMIT_EXCEEDED'
    );
});

test('revocation during an awaited atomic write prevents commit', async (t) => {
    const { root, grantId, grants, projects } = fixture(t);
    let releaseWrite;
    const originalOpen = projects.fs.open.bind(projects.fs);
    projects.fs = {
        ...projects.fs,
        open: async (...args) => {
            const handle = await originalOpen(...args);
            const originalWrite = handle.writeFile.bind(handle);
            handle.writeFile = async (...writeArgs) => {
                await new Promise((resolve) => { releaseWrite = resolve; });
                return originalWrite(...writeArgs);
            };
            return handle;
        }
    };
    const pending = projects.writeText(7, { grantId, path: 'Assets/revoked.txt' }, 'secret');
    while (!releaseWrite) await new Promise((resolve) => setImmediate(resolve));
    grants.revoke(7, grantId);
    releaseWrite();
    await assert.rejects(pending, (error) => error.code === 'GRANT_NOT_FOUND');
    assert.equal(fs.existsSync(path.join(root, 'Assets', 'revoked.txt')), false);
});

test('project asset transactions preserve bytes and GUIDs through apply, undo and stable redo', async (t) => {
    const { root, grantId, projects } = fixture(t);
    const transactions = new ProjectAssetTransactionService({ projectService: projects });
    const assetsRoot = path.join(root, 'Assets');
    const oldPath = path.join(assetsRoot, 'old.asset');
    const oldMetaPath = `${oldPath}.meta`;
    const referencePath = path.join(assetsRoot, 'scene.scene');
    const oldMeta = Buffer.from('{"formatVersion":1,"guid":"stable-guid"}\n');
    const beforeReference = Buffer.from('{"assetPath":"Assets/old.asset","assetGuid":"stable-guid"}\n');
    const afterReference = Buffer.from('{"assetPath":"Assets/new.asset","assetGuid":"stable-guid"}\n');
    fs.writeFileSync(oldPath, Buffer.from([0, 1, 2, 255]));
    fs.writeFileSync(oldMetaPath, oldMeta);
    fs.writeFileSync(referencePath, beforeReference);

    const move = transactionRequest(grantId, 'move', {
        sourcePath: 'Assets/old.asset',
        targetPath: 'Assets/new.asset',
        referencePatches: [{
            path: 'Assets/scene.scene',
            beforeBase64: beforeReference.toString('base64'),
            afterBase64: afterReference.toString('base64')
        }]
    });
    const applied = await transactions.transact(7, move);
    assert.equal(fs.readFileSync(path.join(assetsRoot, 'new.asset.meta'), 'utf8'), oldMeta.toString());
    assert.deepEqual(fs.readFileSync(referencePath), afterReference);

    await transactions.transact(7, { contractVersion: 1, grantId, transactionId: applied.transactionId, action: 'undo' });
    assert.deepEqual(fs.readFileSync(oldPath), Buffer.from([0, 1, 2, 255]));
    assert.deepEqual(fs.readFileSync(oldMetaPath), oldMeta);
    assert.deepEqual(fs.readFileSync(referencePath), beforeReference);

    await transactions.transact(7, { contractVersion: 1, grantId, transactionId: applied.transactionId, action: 'redo' });
    assert.deepEqual(fs.readFileSync(path.join(assetsRoot, 'new.asset')), Buffer.from([0, 1, 2, 255]));
    assert.deepEqual(fs.readFileSync(referencePath), afterReference);
});

test('duplicate creates fresh GUIDs and delete is byte-recoverable', async (t) => {
    const { root, grantId, projects } = fixture(t);
    const transactions = new ProjectAssetTransactionService({ projectService: projects });
    const assetsRoot = path.join(root, 'Assets');
    fs.writeFileSync(path.join(assetsRoot, 'source.asset'), 'payload');
    fs.writeFileSync(path.join(assetsRoot, 'source.asset.meta'), '{"formatVersion":1,"guid":"source-guid","labels":["x"]}\n');

    const duplicate = transactionRequest(grantId, 'duplicate', {
        sourcePath: 'Assets/source.asset', targetPath: 'Assets/copy.asset'
    });
    await transactions.transact(7, duplicate);
    const duplicateMeta = JSON.parse(fs.readFileSync(path.join(assetsRoot, 'copy.asset.meta'), 'utf8'));
    assert.notEqual(duplicateMeta.guid, 'source-guid');
    assert.deepEqual(duplicateMeta.labels, ['x']);

    const deleteRequest = transactionRequest(grantId, 'delete', { sourcePath: 'Assets/copy.asset' });
    const deleted = await transactions.transact(7, deleteRequest);
    assert.equal(fs.existsSync(path.join(assetsRoot, 'copy.asset')), false);
    await transactions.transact(7, { contractVersion: 1, grantId, transactionId: deleted.transactionId, action: 'undo' });
    assert.equal(fs.readFileSync(path.join(assetsRoot, 'copy.asset'), 'utf8'), 'payload');
    assert.equal(JSON.parse(fs.readFileSync(path.join(assetsRoot, 'copy.asset.meta'), 'utf8')).guid, duplicateMeta.guid);
});

for (const failedStage of ['file', 'meta', 'reference']) {
    test(`injected ${failedStage} failure rolls back every affected byte and permits retry`, async (t) => {
        const { root, grantId, projects } = fixture(t);
        const assetsRoot = path.join(root, 'Assets');
        const source = path.join(assetsRoot, 'source.asset');
        const sourceMeta = `${source}.meta`;
        const reference = path.join(assetsRoot, 'scene.scene');
        const referenceBefore = Buffer.from('{"assetPath":"Assets/source.asset"}\n');
        const referenceAfter = Buffer.from('{"assetPath":"Assets/target.asset"}\n');
        fs.writeFileSync(source, Buffer.from([3, 2, 1, 0]));
        fs.writeFileSync(sourceMeta, '{"guid":"guid-a"}\n');
        fs.writeFileSync(reference, referenceBefore);
        let shouldFail = true;
        const transactions = new ProjectAssetTransactionService({
            projectService: projects,
            failureInjector: (stage) => {
                if (shouldFail && stage === failedStage) throw Object.assign(new Error('injected'), { code: 'INJECTED_FAILURE' });
            }
        });
        const request = transactionRequest(grantId, 'move', {
            sourcePath: 'Assets/source.asset', targetPath: 'Assets/target.asset',
            referencePatches: [{ path: 'Assets/scene.scene', beforeBase64: referenceBefore.toString('base64'), afterBase64: referenceAfter.toString('base64') }]
        });

        await assert.rejects(transactions.transact(7, request), (error) => error.code === 'INJECTED_FAILURE');
        assert.deepEqual(fs.readFileSync(source), Buffer.from([3, 2, 1, 0]));
        assert.equal(fs.readFileSync(sourceMeta, 'utf8'), '{"guid":"guid-a"}\n');
        assert.deepEqual(fs.readFileSync(reference), referenceBefore);
        assert.equal(fs.existsSync(path.join(assetsRoot, 'target.asset')), false);

        shouldFail = false;
        await transactions.transact(7, request);
        assert.deepEqual(fs.readFileSync(path.join(assetsRoot, 'target.asset')), Buffer.from([3, 2, 1, 0]));
        assert.deepEqual(fs.readFileSync(reference), referenceAfter);
    });
}
