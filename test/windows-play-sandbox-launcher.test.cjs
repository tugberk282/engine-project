'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
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

function compileFixtures(root) {
    const compiler = process.env.TUGBERK_MINGW_CC || 'gcc.exe';
    const probe = path.join(root, 'probe.exe');
    const dll = path.join(root, 'outside-adversarial.dll');
    const common = ['-std=c11', '-O2', '-D_WIN32_WINNT=0x0A00'];
    const probeBuild = spawnSync(compiler, [
        ...common, '-municode', '-Wl,--subsystem,windows',
        path.resolve(__dirname, '..', 'native', 'play-sandbox-launcher', 'adversarial-probe.c'),
        '-o', probe, '-lws2_32'
    ], { stdio: 'pipe', windowsHide: true, encoding: 'utf8' });
    assert.equal(probeBuild.status, 0, probeBuild.stderr || probeBuild.error?.message);
    const dllBuild = spawnSync(compiler, [
        ...common, '-shared',
        path.resolve(__dirname, '..', 'native', 'play-sandbox-launcher', 'adversarial-dll.c'),
        '-o', dll
    ], { stdio: 'pipe', windowsHide: true, encoding: 'utf8' });
    assert.equal(dllBuild.status, 0, dllBuild.stderr || dllBuild.error?.message);
    return { probe, dll };
}

function adapterPath() {
    return path.resolve(__dirname, '..', 'native', 'play-sandbox-launcher', 'adversarial-probe.c');
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
    const { probe, dll } = compileFixtures(root);

    const outsideRead = path.join(root, 'outside-secret.txt');
    const outsideWrite = path.join(root, 'outside-write.txt');
    await fsp.writeFile(outsideRead, 'secret');
    process.env.TUGBERK_TEST_SECRET = 'must-not-cross';
    t.after(() => { delete process.env.TUGBERK_TEST_SECRET; });

    const sessionsRoot = path.join(root, 'sessions');
    const server = net.createServer((socket) => socket.end());
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
    t.after(() => server.close());
    const pipeName = `\\\\.\\pipe\\tugberk-sandbox-${process.pid}-${Date.now()}`;
    const pipeServer = net.createServer((socket) => socket.end());
    await new Promise((resolve, reject) => pipeServer.listen(pipeName, resolve).once('error', reject));
    t.after(() => pipeServer.close());
    const loopbackPort = server.address().port;
    const launcher = new WindowsPlaySandboxLauncher({ sessionsRoot, resources: resolveLauncherResources() });
    const outcome = await launcher.launch({
        projectIdentity: 'project-fixture',
        trustEpoch: 'epoch-fixture',
        executable: probe,
        adapter: adapterPath(),
        args: [outsideRead, outsideWrite, String(loopbackPort), String(process.pid), pipeName, dll],
        limits: { timeoutMs: 10_000, cpuMs: 5_000, memoryBytes: 64 * 1024 * 1024 }
    });
    assert.equal(outcome.sandboxed, true);
    for (const denial of [
        'outsideRead', 'outsideWrite', 'secretVisible', 'childSpawn', 'loopbackAuthority',
        'internetAuthority', 'lanAuthority', 'dnsAuthority', 'processHandle', 'namedPipe', 'externalDll'
    ]) assert.equal(outcome.workerResult?.[denial], false, `${denial}: ${JSON.stringify(outcome.workerResult)}`);
    assert.equal(fs.existsSync(outsideWrite), false);
    assert.deepEqual(await fsp.readdir(sessionsRoot), []);
});

test('wall-clock denial terminates the job and still removes staging', {
    skip: process.platform !== 'win32' || process.arch !== 'x64' ? 'Windows x64 launcher only' : false,
    timeout: 30_000
}, async (t) => {
    const root = scratch(t);
    const { probe } = compileFixtures(root);
    const sessionsRoot = path.join(root, 'sessions');
    const launcher = new WindowsPlaySandboxLauncher({ sessionsRoot, resources: resolveLauncherResources() });
    const timeoutLaunch = launcher.launch({
        projectIdentity: 'project-timeout',
        trustEpoch: 'epoch-timeout',
        executable: probe,
        adapter: adapterPath(),
        args: [path.join(root, 'missing'), path.join(root, 'outside'), '9', '0', '', '', 'sleep:2000'],
        limits: { timeoutMs: 100, cpuMs: 5_000, memoryBytes: 64 * 1024 * 1024 }
    });
    await assert.rejects(timeoutLaunch, (error) => error.code === 'PLAY_SANDBOX_TIMEOUT');
    assert.deepEqual(await fsp.readdir(sessionsRoot), []);
});

test('CPU, memory, output, crash, and abort violations fail closed with whole-tree cleanup', {
    skip: process.platform !== 'win32' || process.arch !== 'x64' ? 'Windows x64 launcher only' : false,
    timeout: 60_000
}, async (t) => {
    const root = scratch(t);
    const { probe } = compileFixtures(root);
    const sessionsRoot = path.join(root, 'sessions');
    const launcher = new WindowsPlaySandboxLauncher({ sessionsRoot, resources: resolveLauncherResources() });
    const launchMode = (mode, limits = {}) => {
        const { signal, ...policyLimits } = limits;
        return launcher.launch({
        projectIdentity: `project-${mode.replace(/[^a-z0-9]/giu, '-')}`,
        trustEpoch: `epoch-${mode.replace(/[^a-z0-9]/giu, '-')}`,
        executable: probe,
        adapter: adapterPath(),
        args: [path.join(root, 'missing'), path.join(root, 'outside'), '9', '0', '', '', mode],
        limits: { timeoutMs: 10_000, cpuMs: 250, memoryBytes: 24 * 1024 * 1024, ...policyLimits },
        signal
    });
    };

    await assert.rejects(launchMode('cpu'), (error) => error.code === 'PLAY_SANDBOX_WORKER_FAILED');
    assert.deepEqual(await fsp.readdir(sessionsRoot), []);
    await assert.rejects(launchMode('memory'), (error) => error.code === 'PLAY_SANDBOX_WORKER_FAILED');
    assert.deepEqual(await fsp.readdir(sessionsRoot), []);
    await assert.rejects(launchMode('output', { outputBytes: 1024 }),
        (error) => error.code === 'INVALID_SANDBOX_OUTPUT');
    assert.deepEqual(await fsp.readdir(sessionsRoot), []);
    await assert.rejects(launchMode('crash'), (error) => error.code === 'PLAY_SANDBOX_WORKER_FAILED');
    assert.deepEqual(await fsp.readdir(sessionsRoot), []);

    const controller = new AbortController();
    const aborted = launchMode('sleep:5000', { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(aborted, (error) => error.code === 'PLAY_SANDBOX_ABORTED');
    assert.deepEqual(await fsp.readdir(sessionsRoot), []);
});

test('reparse ancestors and helper crashes fail closed without retained staging', {
    skip: process.platform !== 'win32' || process.arch !== 'x64' ? 'Windows x64 launcher only' : false,
    timeout: 30_000
}, async (t) => {
    const root = scratch(t);
    const { probe } = compileFixtures(root);
    const outsideRoot = path.join(root, 'outside-sessions');
    const junctionRoot = path.join(root, 'junction-sessions');
    await fsp.mkdir(outsideRoot);
    await fsp.symlink(outsideRoot, junctionRoot, 'junction');
    const common = {
        projectIdentity: 'project-reparse',
        trustEpoch: 'epoch-reparse',
        executable: probe,
        adapter: adapterPath(),
        args: [path.join(root, 'missing'), path.join(root, 'outside'), '9', '0', '', '', 'base'],
        limits: { timeoutMs: 10_000, cpuMs: 5_000, memoryBytes: 64 * 1024 * 1024 }
    };
    const reparseLauncher = new WindowsPlaySandboxLauncher({
        sessionsRoot: junctionRoot,
        resources: resolveLauncherResources()
    });
    await assert.rejects(reparseLauncher.launch(common), (error) => error.code === 'INVALID_STAGING_ROOT');
    assert.deepEqual(await fsp.readdir(outsideRoot), []);

    let helper;
    const sessionsRoot = path.join(root, 'crash-sessions');
    const crashLauncher = new WindowsPlaySandboxLauncher({
        sessionsRoot,
        resources: resolveLauncherResources(),
        spawnProcess: (...args) => {
            helper = spawn(...args);
            setTimeout(() => helper.kill(), 250);
            return helper;
        }
    });
    await assert.rejects(crashLauncher.launch({
        ...common,
        projectIdentity: 'project-helper-crash',
        trustEpoch: 'epoch-helper-crash',
        args: [path.join(root, 'missing'), path.join(root, 'outside'), '9', '0', '', '', 'sleep:5000']
    }), (error) => error.code === 'INVALID_SANDBOX_ATTESTATION');
    assert.deepEqual(await fsp.readdir(sessionsRoot), []);
});
