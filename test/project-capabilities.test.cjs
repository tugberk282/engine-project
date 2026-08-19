const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ProjectCapabilities, normalizeWriteData } = require('../electron/security/project-capabilities');

function fixture() {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-capability-')));
    const project = path.join(base, 'project');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(project);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(project, 'inside.txt'), 'inside');
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    return { base, project, outside };
}

test('confines existing and prospective paths to a granted project', (t) => {
    const f = fixture();
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    const capabilities = new ProjectCapabilities();
    capabilities.grant(f.project);

    assert.equal(capabilities.authorize(path.join(f.project, 'inside.txt'), { mustExist: true }), path.join(f.project, 'inside.txt'));
    assert.equal(capabilities.authorize(path.join(f.project, 'Assets', 'new.txt')), path.join(f.project, 'Assets', 'new.txt'));
    assert.throws(() => capabilities.authorize(path.join(f.project, '..', 'outside', 'secret.txt'), { mustExist: true }), /outside an approved/);
});

test('only main-granted roots can be used for project trust decisions', (t) => {
    const f = fixture(t);
    const capabilities = new ProjectCapabilities();

    assert.throws(() => capabilities.requireRoot(f.project), /has not been granted by the main process/);
    capabilities.grant(f.project, { writable: false });
    assert.equal(capabilities.requireRoot(path.join(f.project, '.')), fs.realpathSync.native(f.project));
    assert.throws(
        () => capabilities.requireRoot(path.join(f.project, 'inside.txt')),
        /has not been granted by the main process/
    );
});

test('rejects symlink or junction escapes and deleting the capability root', (t) => {
    const f = fixture();
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    const capabilities = new ProjectCapabilities();
    capabilities.grant(f.project);
    const link = path.join(f.project, 'escape');
    fs.symlinkSync(f.outside, link, process.platform === 'win32' ? 'junction' : 'dir');

    assert.throws(() => capabilities.authorize(path.join(link, 'secret.txt'), { mustExist: true }), /outside an approved/);
    assert.throws(() => capabilities.authorize(path.join(link, 'new.txt')), /outside an approved/);
    assert.throws(() => capabilities.authorize(f.project, { mustExist: true, allowRoot: false }), /project root/);
});

test('validates renderer write payload shape and size', () => {
    assert.equal(normalizeWriteData('hello'), 'hello');
    assert.deepEqual(normalizeWriteData({ __binary: true, data: [0, 127, 255] }), Buffer.from([0, 127, 255]));
    assert.throws(() => normalizeWriteData({ __binary: true, data: [-1] }), /Invalid binary/);
    assert.throws(() => normalizeWriteData({ arbitrary: true }), /must be text or a byte array/);
});

test('open-dialog file grants are read-only and exact-path confined', (t) => {
    const f = fixture();
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    const capabilities = new ProjectCapabilities();
    const selectedFile = path.join(f.outside, 'secret.txt');
    capabilities.grantFile(selectedFile);

    assert.equal(capabilities.authorize(selectedFile, { mustExist: true }), selectedFile);
    assert.throws(() => capabilities.authorize(selectedFile, { write: true }), /read-only/);
    assert.throws(() => capabilities.authorizeRename(selectedFile, path.join(f.outside, 'renamed.txt')), /read-only/);
    assert.throws(() => capabilities.authorize(selectedFile, { mustExist: true, allowRoot: false, write: true }), /read-only/);
    assert.throws(() => capabilities.authorize(path.join(f.outside, 'other.json')), /outside an approved/);
});

test('save-dialog file grants allow writes only at the exact selected path', (t) => {
    const f = fixture();
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    const capabilities = new ProjectCapabilities();
    const selectedFile = path.join(f.outside, 'export.json');
    capabilities.grantFile(selectedFile, { writable: true });

    assert.equal(capabilities.authorize(selectedFile, { write: true }), selectedFile);
    assert.throws(
        () => capabilities.authorize(path.join(f.outside, 'other.json'), { write: true }),
        /outside an approved/
    );
});

test('safe-mode project grants allow reads but reject writes until trusted', (t) => {
    const f = fixture();
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    const capabilities = new ProjectCapabilities();
    capabilities.grant(f.project, { writable: false });

    assert.equal(capabilities.authorize(path.join(f.project, 'inside.txt'), { mustExist: true }), path.join(f.project, 'inside.txt'));
    assert.throws(() => capabilities.authorize(path.join(f.project, 'new.txt'), { write: true }), /safe mode/);
    capabilities.setWritable(f.project, true);
    assert.equal(capabilities.authorize(path.join(f.project, 'new.txt'), { write: true }), path.join(f.project, 'new.txt'));
});

test('rename requires write permission for both source and target capabilities', (t) => {
    const f = fixture();
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    const capabilities = new ProjectCapabilities();
    const source = path.join(f.project, 'inside.txt');
    const target = path.join(f.outside, 'renamed.txt');
    capabilities.grant(f.project, { writable: false });
    capabilities.grantFile(target, { writable: true });

    assert.throws(() => capabilities.authorizeRename(source, target), /safe mode/);
    assert.deepEqual(capabilities.authorizeMove(source, target), { source, target });

    capabilities.setWritable(f.project, true);
    assert.deepEqual(capabilities.authorizeRename(source, target), { source, target });
});

test('activating another project revokes the prior root and exact-file grants', (t) => {
    const f = fixture();
    t.after(() => fs.rmSync(f.base, { recursive: true, force: true }));
    const capabilities = new ProjectCapabilities();
    const exportPath = path.join(f.base, 'export.json');
    capabilities.grant(f.project);
    capabilities.grantFile(exportPath, { writable: true });
    const oldLease = capabilities.lease();

    capabilities.grant(f.outside, { writable: false });

    assert.throws(
        () => capabilities.authorize(path.join(f.project, 'inside.txt'), { mustExist: true }),
        (error) => error.code === 'PROJECT_NOT_GRANTED'
    );
    assert.throws(
        () => capabilities.authorize(exportPath, { write: true }),
        (error) => error.code === 'PROJECT_NOT_GRANTED'
    );
    assert.throws(
        () => capabilities.assertLease(oldLease),
        (error) => error.code === 'STALE_PROJECT_SESSION'
    );
});
