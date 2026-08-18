'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const {
    WindowsPlaySandboxLauncher,
    quoteWindowsArgument,
    resolveLauncherResources,
    verifyLauncher
} = require('../electron/security/windows-play-sandbox-launcher');

function scratch(t) {
    const root = fs.mkdtempSync(path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || os.tmpdir(), 'tugberk-play-sandbox-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}

test('Windows command-line quoting preserves spaces, quotes, and trailing slashes', () => {
    assert.equal(quoteWindowsArgument('plain'), 'plain');
    assert.equal(quoteWindowsArgument('two words'), '"two words"');
    assert.equal(quoteWindowsArgument('a"b'), '"a\\"b"');
    assert.equal(quoteWindowsArgument('C:\\path with space\\'), '"C:\\path with space\\\\"');
});

test('launcher integrity verification fails closed for a changed helper', async (t) => {
    const root = scratch(t);
    const executable = path.join(root, 'helper.exe');
    const manifest = path.join(root, 'manifest.json');
    await fsp.writeFile(executable, 'changed');
    await fsp.writeFile(manifest, JSON.stringify({
        schemaVersion: 1,
        platform: 'win32',
        architecture: 'x64',
        file: 'helper.exe',
        sha256: '0'.repeat(64)
    }));
    await assert.rejects(verifyLauncher({ executable, manifest }), (error) => error.code === 'PLAY_SANDBOX_UNAVAILABLE');
});

test('AppContainer denies ambient authority and removes the whole staging tree', {
    skip: process.platform !== 'win32' || process.arch !== 'x64' ? 'Windows x64 launcher only' : false,
    timeout: 30_000
}, async (t) => {
    const root = scratch(t);
    const probe = path.join(root, 'probe.exe');
    const compiler = process.env.TUGBERK_MINGW_CC || 'gcc.exe';
    const compiled = spawnSync(compiler, [
        '-std=c11', '-O2', '-D_WIN32_WINNT=0x0A00', '-municode', '-Wl,--subsystem,windows',
        path.resolve(__dirname, '..', 'native', 'play-sandbox-launcher', 'adversarial-probe.c'),
        '-o', probe, '-lws2_32'
    ], { stdio: 'pipe', windowsHide: true, encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.error?.message);

    const outsideRead = path.join(root, 'outside-secret.txt');
    const outsideWrite = path.join(root, 'outside-write.txt');
    await fsp.writeFile(outsideRead, 'secret');
    process.env.TUGBERK_TEST_SECRET = 'must-not-cross';
    t.after(() => { delete process.env.TUGBERK_TEST_SECRET; });

    const sessionsRoot = path.join(root, 'sessions');
    const server = net.createServer((socket) => socket.end());
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
    t.after(() => server.close());
    const loopbackPort = server.address().port;
    const launcher = new WindowsPlaySandboxLauncher({ sessionsRoot, resources: resolveLauncherResources() });
    const outcome = await launcher.launch({
        projectIdentity: 'project-fixture',
        trustEpoch: 'epoch-fixture',
        executable: probe,
        adapter: path.resolve(__dirname, '..', 'native', 'play-sandbox-launcher', 'adversarial-probe.c'),
        args: [outsideRead, outsideWrite, String(loopbackPort)],
        limits: { timeoutMs: 10_000, cpuMs: 5_000, memoryBytes: 64 * 1024 * 1024 }
    });
    assert.equal(outcome.sandboxed, true);
    assert.deepEqual({ ...outcome.workerResult, networkError: undefined }, {
        outsideRead: false,
        outsideWrite: false,
        secretVisible: false,
        childSpawn: false,
        networkAuthority: false,
        networkError: undefined
    }, JSON.stringify(outcome));
    assert.ok([10013, 10060].includes(outcome.workerResult.networkError), JSON.stringify(outcome.workerResult));
    assert.equal(fs.existsSync(outsideWrite), false);
    assert.deepEqual(await fsp.readdir(sessionsRoot), []);
});

test('wall-clock denial terminates the job and still removes staging', {
    skip: process.platform !== 'win32' || process.arch !== 'x64' ? 'Windows x64 launcher only' : false,
    timeout: 30_000
}, async (t) => {
    const root = scratch(t);
    const probe = path.join(root, 'probe.exe');
    const compiled = spawnSync(process.env.TUGBERK_MINGW_CC || 'gcc.exe', [
        '-std=c11', '-O2', '-D_WIN32_WINNT=0x0A00', '-municode', '-Wl,--subsystem,windows',
        path.resolve(__dirname, '..', 'native', 'play-sandbox-launcher', 'adversarial-probe.c'),
        '-o', probe, '-lws2_32'
    ], { stdio: 'pipe', windowsHide: true, encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.error?.message);
    const sessionsRoot = path.join(root, 'sessions');
    const launcher = new WindowsPlaySandboxLauncher({ sessionsRoot, resources: resolveLauncherResources() });
    const timeoutLaunch = launcher.launch({
        projectIdentity: 'project-timeout',
        trustEpoch: 'epoch-timeout',
        executable: probe,
        adapter: path.resolve(__dirname, '..', 'native', 'play-sandbox-launcher', 'adversarial-probe.c'),
        args: [path.join(root, 'missing'), path.join(root, 'outside'), '9', '2000'],
        limits: { timeoutMs: 100, cpuMs: 5_000, memoryBytes: 64 * 1024 * 1024 }
    });
    await assert.rejects(timeoutLaunch, (error) => error.code === 'PLAY_SANDBOX_TIMEOUT');
    assert.deepEqual(await fsp.readdir(sessionsRoot), []);
});
