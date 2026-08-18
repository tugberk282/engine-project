'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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
    const compiled = spawnSync(process.env.TUGBERK_MINGW_CC || 'gcc.exe', [
        '-std=c11', '-O2', '-D_WIN32_WINNT=0x0A00', '-municode', '-Wl,--subsystem,windows',
        path.join(root, 'native', 'play-sandbox-launcher', 'adversarial-probe.c'),
        '-o', probe, '-lws2_32'
    ], { stdio: 'pipe', windowsHide: true, encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.error?.message);

    const outsideRead = path.join(workDirectory, 'outside-secret.txt');
    const outsideWrite = path.join(workDirectory, 'outside-write.txt');
    await fsp.writeFile(outsideRead, 'packaged-secret');
    const server = net.createServer((socket) => socket.end());
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
    try {
        const sessionsRoot = path.join(workDirectory, 'sessions');
        const launcher = new WindowsPlaySandboxLauncher({ sessionsRoot, resources });
        const outcome = await launcher.launch({
            projectIdentity: 'packaged-project',
            trustEpoch: 'packaged-epoch',
            executable: probe,
            adapter: path.join(root, 'native', 'play-sandbox-launcher', 'adversarial-probe.c'),
            args: [outsideRead, outsideWrite, String(server.address().port)],
            limits: { timeoutMs: 10_000, cpuMs: 5_000, memoryBytes: 64 * 1024 * 1024 }
        });
        assert.equal(outcome.sandboxed, true);
        for (const denial of ['outsideRead', 'outsideWrite', 'secretVisible', 'childSpawn', 'networkAuthority']) {
            assert.equal(outcome.workerResult?.[denial], false, `${denial} was not denied by installed helper`);
        }
        assert.equal(fs.existsSync(outsideWrite), false, 'installed helper allowed an outside-root write');
        assert.deepEqual(await fsp.readdir(sessionsRoot), [], 'installed helper left a staging tree behind');

        await assert.rejects(launcher.launch({
            projectIdentity: 'packaged-timeout',
            trustEpoch: 'packaged-timeout-epoch',
            executable: probe,
            adapter: path.join(root, 'native', 'play-sandbox-launcher', 'adversarial-probe.c'),
            args: [outsideRead, outsideWrite, '9', '2000'],
            limits: { timeoutMs: 100, cpuMs: 5_000, memoryBytes: 64 * 1024 * 1024 }
        }), (error) => error.code === 'PLAY_SANDBOX_TIMEOUT');
        assert.deepEqual(await fsp.readdir(sessionsRoot), [], 'timeout left a packaged sandbox staging tree behind');
        console.log(`Packaged AppContainer adversarial matrix passed: ${resources.executable}`);
    } finally {
        server.close();
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
