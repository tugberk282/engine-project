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
