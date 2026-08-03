'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ConfinedFileSystem } = require('../electron/security/confined-filesystem');

function fixture(t) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-confined-'));
    const root = path.join(base, 'project');
    const nested = path.join(root, 'Assets', 'Nested');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'outside');
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, root, nested, outside };
}

function context(root, target, options) {
    return { root, path: target, options };
}

function replaceWithDirectoryLink(directory, outside) {
    const parked = `${directory}-parked`;
    fs.renameSync(directory, parked);
    fs.symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
    return parked;
}

test('atomic writes detect a deterministic parent junction/symlink swap and preserve outside data', async (t) => {
    const f = fixture(t);
    const target = path.join(f.nested, 'sentinel.txt');
    let parked;
    const confined = new ConfinedFileSystem({
        beforeCommit: async (operation) => {
            if (operation === 'atomicWrite') parked = replaceWithDirectoryLink(f.nested, f.outside);
        }
    });

    await assert.rejects(
        confined.atomicWrite(context(f.root, target), 'attacker-controlled'),
        (error) => error.code === 'UNSAFE_FILESYSTEM_PATH'
    );
    assert.equal(fs.readFileSync(path.join(f.outside, 'sentinel.txt'), 'utf8'), 'outside');
    assert.ok(fs.readdirSync(parked).some((name) => name.includes('.tugberk-')));
});

test('destructive and rename operations detect deterministic parent swaps', async (t) => {
    for (const operation of ['rm', 'unlink', 'rename', 'copyRead']) {
        await t.test(operation, async (t) => {
            const f = fixture(t);
            const victim = path.join(f.nested, 'sentinel.txt');
            fs.writeFileSync(victim, 'inside');
            const confined = new ConfinedFileSystem({
                beforeCommit: async (current) => {
                    if (current === operation) replaceWithDirectoryLink(f.nested, f.outside);
                }
            });
            const source = context(f.root, victim);
            const action = operation === 'rm'
                ? confined.rm(source, { recursive: true, force: true })
                : operation === 'unlink'
                    ? confined.unlink(source)
                    : operation === 'rename'
                        ? confined.rename(source, context(f.root, path.join(f.root, 'moved.txt')))
                        : confined.copy(source, context(f.root, path.join(f.root, 'copied.txt')));
            await assert.rejects(action, (error) => error.code === 'UNSAFE_FILESYSTEM_PATH');
            assert.equal(fs.readFileSync(path.join(f.outside, 'sentinel.txt'), 'utf8'), 'outside');
            assert.equal(fs.existsSync(path.join(f.root, 'copied.txt')), false);
        });
    }
});

test('nested mkdir and atomic temp/rename stay confined and leave no temp files', async (t) => {
    const f = fixture(t);
    const confined = new ConfinedFileSystem();
    const directory = path.join(f.nested, 'Deep', 'Tree');
    const target = path.join(directory, 'scene.json');
    await confined.mkdir(context(f.root, directory), { recursive: true });
    await confined.atomicWrite(context(f.root, target), '{"safe":true}', 'utf8');
    assert.equal(fs.readFileSync(target, 'utf8'), '{"safe":true}');
    assert.deepEqual(fs.readdirSync(directory), ['scene.json']);
    assert.equal(fs.readFileSync(path.join(f.outside, 'sentinel.txt'), 'utf8'), 'outside');
});

test('mutation destinations reject links and destructive operations reject the capability root', async (t) => {
    const f = fixture(t);
    const link = path.join(f.root, 'destination');
    fs.symlinkSync(f.outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    const confined = new ConfinedFileSystem();

    await assert.rejects(
        confined.atomicWrite(context(f.root, path.join(link, 'sentinel.txt')), 'changed'),
        (error) => error.code === 'UNSAFE_FILESYSTEM_PATH'
    );
    await assert.rejects(
        confined.rm(context(f.root, f.root), { recursive: true }),
        (error) => error.code === 'CAPABILITY_ROOT_DENIED'
    );
    assert.equal(fs.readFileSync(path.join(f.outside, 'sentinel.txt'), 'utf8'), 'outside');
});

test('a swapped capability root identity is rejected before mutation', async (t) => {
    const f = fixture(t);
    const identity = fs.statSync(f.root);
    const replacement = path.join(f.base, 'replacement');
    fs.mkdirSync(path.join(replacement, 'Assets'), { recursive: true });
    fs.writeFileSync(path.join(replacement, 'Assets', 'sentinel.txt'), 'replacement');
    const confined = new ConfinedFileSystem({
        beforeCommit: async () => {
            fs.renameSync(f.root, `${f.root}-parked`);
            fs.renameSync(replacement, f.root);
        }
    });
    await assert.rejects(
        confined.unlink({
            root: f.root,
            path: path.join(f.root, 'Assets', 'sentinel.txt'),
            rootIdentity: { device: identity.dev, inode: identity.ino }
        }),
        (error) => error.code === 'CAPABILITY_ROOT_CHANGED'
    );
    assert.equal(fs.readFileSync(path.join(f.root, 'Assets', 'sentinel.txt'), 'utf8'), 'replacement');
});
