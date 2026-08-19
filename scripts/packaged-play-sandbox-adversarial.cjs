'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { WindowsPlaySandboxLauncher } = require('../electron/security/windows-play-sandbox-launcher');

const root = path.resolve(__dirname, '..');

async function runPackagedSandboxMatrix(installDirectory, suppliedWorkDirectory) {
    assert.equal(process.platform, 'win32', 'The packaged sandbox matrix qualifies Windows only');
    const resourcesDirectory = path.join(installDirectory, 'resources', 'app.asar.unpacked',
        'electron', 'resources', 'win32-x64');
    const resources = {
        executable: path.join(resourcesDirectory, 'tugberk-play-sandbox.exe'),
        manifest: path.join(resourcesDirectory, 'tugberk-play-sandbox.manifest.json')
    };
    assert.ok(fs.existsSync(resources.executable), `installed sandbox helper is missing: ${resources.executable}`);
    assert.ok(fs.existsSync(resources.manifest), `installed sandbox manifest is missing: ${resources.manifest}`);

    const workDirectory = suppliedWorkDirectory
        || fs.mkdtempSync(path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || os.tmpdir(), 'tugberk-packaged-sandbox-'));
    await fsp.mkdir(workDirectory, { recursive: true });
    const probe = path.join(workDirectory, 'adversarial-probe.exe');
    const dll = path.join(workDirectory, 'outside-adversarial.dll');
    const compiled = spawnSync(process.env.TUGBERK_MINGW_CC || 'gcc.exe', [
        '-std=c11', '-O2', '-D_WIN32_WINNT=0x0A00', '-municode', '-Wl,--subsystem,windows',
        path.join(root, 'native', 'play-sandbox-launcher', 'adversarial-probe.c'),
        '-o', probe, '-lws2_32'
    ], { stdio: 'pipe', windowsHide: true, encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.error?.message);
    const compiledDll = spawnSync(process.env.TUGBERK_MINGW_CC || 'gcc.exe', [
        '-std=c11', '-O2', '-D_WIN32_WINNT=0x0A00', '-shared',
        path.join(root, 'native', 'play-sandbox-launcher', 'adversarial-dll.c'),
        '-o', dll
    ], { stdio: 'pipe', windowsHide: true, encoding: 'utf8' });
    assert.equal(compiledDll.status, 0, compiledDll.stderr || compiledDll.error?.message);

    const outsideRead = path.join(workDirectory, 'outside-secret.txt');
    const outsideWrite = path.join(workDirectory, 'outside-write.txt');
    await fsp.writeFile(outsideRead, 'packaged-secret');
    const server = net.createServer((socket) => socket.end());
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
    const pipeName = `\\\\.\\pipe\\tugberk-packaged-sandbox-${process.pid}-${Date.now()}`;
    const pipeServer = net.createServer((socket) => socket.end());
    await new Promise((resolve, reject) => pipeServer.listen(pipeName, resolve).once('error', reject));
    try {
        const sessionsRoot = path.join(workDirectory, 'sessions');
        const launcher = new WindowsPlaySandboxLauncher({ sessionsRoot, resources });
        const adapter = path.join(root, 'native', 'play-sandbox-launcher', 'adversarial-probe.c');
        const outcome = await launcher.launch({
            projectIdentity: 'packaged-project',
            trustEpoch: 'packaged-epoch',
            executable: probe,
            adapter,
            args: [outsideRead, outsideWrite, String(server.address().port), String(process.pid), pipeName, dll],
            limits: { timeoutMs: 10_000, cpuMs: 5_000, memoryBytes: 64 * 1024 * 1024 }
        });
        assert.equal(outcome.sandboxed, true);
        for (const denial of [
            'outsideRead', 'outsideWrite', 'secretVisible', 'childSpawn', 'loopbackAuthority',
            'internetAuthority', 'lanAuthority', 'dnsAuthority', 'processHandle', 'namedPipe', 'externalDll'
        ]) {
            assert.equal(outcome.workerResult?.[denial], false, `${denial} was not denied by installed helper`);
        }
        assert.equal(fs.existsSync(outsideWrite), false, 'installed helper allowed an outside-root write');
        assert.deepEqual(await fsp.readdir(sessionsRoot), [], 'installed helper left a staging tree behind');

        await assert.rejects(launcher.launch({
            projectIdentity: 'packaged-timeout',
            trustEpoch: 'packaged-timeout-epoch',
            executable: probe,
            adapter,
            args: [outsideRead, outsideWrite, '9', '0', '', '', 'sleep:2000'],
            limits: { timeoutMs: 100, cpuMs: 5_000, memoryBytes: 64 * 1024 * 1024 }
        }), (error) => error.code === 'PLAY_SANDBOX_TIMEOUT');
        assert.deepEqual(await fsp.readdir(sessionsRoot), [], 'timeout left a packaged sandbox staging tree behind');

        const launchMode = (mode, extraLimits = {}, signal) => launcher.launch({
            projectIdentity: `packaged-${mode.replace(/[^a-z0-9]/giu, '-')}`,
            trustEpoch: `packaged-epoch-${mode.replace(/[^a-z0-9]/giu, '-')}`,
            executable: probe,
            adapter,
            args: [outsideRead, outsideWrite, '9', '0', '', '', mode],
            limits: {
                timeoutMs: 10_000,
                cpuMs: 250,
                memoryBytes: 24 * 1024 * 1024,
                ...extraLimits
            },
            signal
        });
        for (const mode of ['cpu', 'memory', 'crash']) {
            await assert.rejects(launchMode(mode), (error) => error.code === 'PLAY_SANDBOX_WORKER_FAILED');
            assert.deepEqual(await fsp.readdir(sessionsRoot), [], `${mode} left packaged staging behind`);
        }
        await assert.rejects(launchMode('output', { outputBytes: 1024 }),
            (error) => error.code === 'INVALID_SANDBOX_OUTPUT');
        assert.deepEqual(await fsp.readdir(sessionsRoot), [], 'output violation left packaged staging behind');

        const controller = new AbortController();
        const aborted = launchMode('sleep:5000', {}, controller.signal);
        setTimeout(() => controller.abort(), 100);
        await assert.rejects(aborted, (error) => error.code === 'PLAY_SANDBOX_ABORTED');
        assert.deepEqual(await fsp.readdir(sessionsRoot), [], 'abort left packaged staging behind');

        const outsideSessions = path.join(workDirectory, 'outside-sessions');
        const junctionSessions = path.join(workDirectory, 'junction-sessions');
        await fsp.mkdir(outsideSessions, { recursive: true });
        await fsp.symlink(outsideSessions, junctionSessions, 'junction');
        const junctionLauncher = new WindowsPlaySandboxLauncher({ sessionsRoot: junctionSessions, resources });
        await assert.rejects(junctionLauncher.launch({
            projectIdentity: 'packaged-reparse', trustEpoch: 'packaged-reparse-epoch', executable: probe, adapter,
            args: [outsideRead, outsideWrite, '9', '0', '', '', 'base']
        }), (error) => error.code === 'INVALID_STAGING_ROOT');
        assert.deepEqual(await fsp.readdir(outsideSessions), [], 'reparse ancestor retained packaged staging');

        let helper;
        const crashSessions = path.join(workDirectory, 'helper-crash-sessions');
        const crashLauncher = new WindowsPlaySandboxLauncher({
            sessionsRoot: crashSessions,
            resources,
            spawnProcess: (...args) => {
                helper = spawn(...args);
                setTimeout(() => helper.kill(), 250);
                return helper;
            }
        });
        await assert.rejects(crashLauncher.launch({
            projectIdentity: 'packaged-helper-crash', trustEpoch: 'packaged-helper-crash-epoch', executable: probe, adapter,
            args: [outsideRead, outsideWrite, '9', '0', '', '', 'sleep:5000']
        }), (error) => error.code === 'INVALID_SANDBOX_ATTESTATION');
        assert.deepEqual(await fsp.readdir(crashSessions), [], 'helper crash retained packaged staging');
        console.log(`Packaged AppContainer adversarial matrix passed: ${resources.executable}`);
    } finally {
        server.close();
        pipeServer.close();
    }
}

async function main() {
    const installDirectory = process.argv[2] ? path.resolve(process.argv[2]) : null;
    assert.ok(installDirectory, 'usage: node scripts/packaged-play-sandbox-adversarial.cjs <installed-directory>');
    await runPackagedSandboxMatrix(installDirectory);
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { runPackagedSandboxMatrix };
