'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const DEFAULT_LIMITS = Object.freeze({
    timeoutMs: 10_000,
    cpuMs: 5_000,
    memoryBytes: 256 * 1024 * 1024,
    outputBytes: 64 * 1024
});

function sandboxError(code, message, cause) {
    return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

function boundedInteger(value, minimum, maximum, name) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw sandboxError('INVALID_LAUNCH_POLICY', `${name} is outside the supported sandbox policy range`);
    }
    return value;
}

function quoteWindowsArgument(value) {
    const input = String(value);
    if (input.length === 0) return '""';
    if (!/[\s"]/u.test(input)) return input;
    let result = '"';
    let slashes = 0;
    for (const character of input) {
        if (character === '\\') {
            slashes += 1;
        } else if (character === '"') {
            result += '\\'.repeat((slashes * 2) + 1) + '"';
            slashes = 0;
        } else {
            result += '\\'.repeat(slashes) + character;
            slashes = 0;
        }
    }
    return `${result}${'\\'.repeat(slashes * 2)}"`;
}

function resolveLauncherResources({ resourcesPath = process.resourcesPath, appPath = path.resolve(__dirname, '..', '..') } = {}) {
    const development = path.join(appPath, 'electron', 'resources', 'win32-x64');
    const packaged = path.join(resourcesPath || '', 'app.asar.unpacked', 'electron', 'resources', 'win32-x64');
    const directory = fs.existsSync(packaged) ? packaged : development;
    return Object.freeze({
        executable: path.join(directory, 'tugberk-play-sandbox.exe'),
        manifest: path.join(directory, 'tugberk-play-sandbox.manifest.json')
    });
}

async function verifyLauncher(resources) {
    let manifest;
    try {
        manifest = JSON.parse(await fsp.readFile(resources.manifest, 'utf8'));
    } catch (error) {
        throw sandboxError('PLAY_SANDBOX_UNAVAILABLE', 'The sandbox launcher manifest is missing or invalid', error);
    }
    if (manifest?.schemaVersion !== 1 || manifest.platform !== 'win32' || manifest.architecture !== 'x64'
        || manifest.file !== path.basename(resources.executable) || !/^[a-f0-9]{64}$/u.test(manifest.sha256)) {
        throw sandboxError('PLAY_SANDBOX_UNAVAILABLE', 'The sandbox launcher manifest does not match this platform');
    }
    let bytes;
    try {
        bytes = await fsp.readFile(resources.executable);
    } catch (error) {
        throw sandboxError('PLAY_SANDBOX_UNAVAILABLE', 'The sandbox launcher executable is missing', error);
    }
    const actual = crypto.createHash('sha256').update(bytes).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(manifest.sha256, 'hex'))) {
        throw sandboxError('PLAY_SANDBOX_UNAVAILABLE', 'The sandbox launcher failed its integrity check');
    }
    return Object.freeze({ ...resources, sha256: actual });
}

async function assertRegularFile(filePath, label) {
    let stat;
    try {
        stat = await fsp.lstat(filePath);
    } catch (error) {
        throw sandboxError('INVALID_LAUNCH_POLICY', `${label} is unavailable`, error);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw sandboxError('INVALID_LAUNCH_POLICY', `${label} must be a regular file`);
    }
    return path.resolve(filePath);
}

async function removeSessionRoot(sessionRoot, root) {
    const relative = path.relative(root, sessionRoot);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw sandboxError('PLAY_SANDBOX_CLEANUP_FAILED', 'Refusing to clean a sandbox path outside its session root');
    }
    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            await fsp.rm(sessionRoot, { recursive: true, force: true, maxRetries: 0 });
            return;
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        }
    }
    throw sandboxError('PLAY_SANDBOX_CLEANUP_FAILED', 'Sandbox staging cleanup did not complete', lastError);
}

async function readWorkerResult(sessionRoot, outputLimit) {
    const resultPath = path.join(sessionRoot, 'result.json');
    let stat;
    try {
        stat = await fsp.lstat(resultPath);
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw sandboxError('INVALID_SANDBOX_OUTPUT', 'Sandbox output metadata could not be inspected', error);
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > outputLimit) {
        throw sandboxError('INVALID_SANDBOX_OUTPUT', 'Sandbox output is not a bounded regular file');
    }
    try {
        return JSON.parse(await fsp.readFile(resultPath, 'utf8'));
    } catch (error) {
        throw sandboxError('INVALID_SANDBOX_OUTPUT', 'Sandbox output is not valid JSON', error);
    }
}

class WindowsPlaySandboxLauncher {
    constructor({
        sessionsRoot,
        resources = resolveLauncherResources(),
        spawnProcess = spawn,
        platform = process.platform
    } = {}) {
        if (!sessionsRoot || !path.isAbsolute(sessionsRoot)) {
            throw new TypeError('An absolute sandbox sessions root is required');
        }
        this.sessionsRoot = path.resolve(sessionsRoot);
        this.resources = resources;
        this.spawnProcess = spawnProcess;
        this.platform = platform;
    }

    async launch({ projectIdentity, trustEpoch, executable, adapter, args = [], limits = {}, signal } = {}) {
        if (this.platform !== 'win32' || process.arch !== 'x64') {
            throw sandboxError('PLAY_SANDBOX_UNAVAILABLE', 'The OS-enforced play sandbox is unavailable on this platform');
        }
        if (!/^[a-zA-Z0-9._-]{1,128}$/u.test(projectIdentity ?? '')
            || !/^[a-zA-Z0-9._-]{1,128}$/u.test(trustEpoch ?? '')) {
            throw sandboxError('INVALID_LAUNCH_POLICY', 'Project identity and trust epoch must be opaque bounded identifiers');
        }
        if (!Array.isArray(args) || args.length > 64 || args.some((item) => typeof item !== 'string' || item.length > 4096)) {
            throw sandboxError('INVALID_LAUNCH_POLICY', 'Sandbox arguments exceed the supported policy bounds');
        }
        const policy = Object.freeze({
            timeoutMs: boundedInteger(limits.timeoutMs ?? DEFAULT_LIMITS.timeoutMs, 100, 300_000, 'timeoutMs'),
            cpuMs: boundedInteger(limits.cpuMs ?? DEFAULT_LIMITS.cpuMs, 100, 300_000, 'cpuMs'),
            memoryBytes: boundedInteger(limits.memoryBytes ?? DEFAULT_LIMITS.memoryBytes, 16 * 1024 * 1024, 4 * 1024 * 1024 * 1024, 'memoryBytes'),
            outputBytes: boundedInteger(limits.outputBytes ?? DEFAULT_LIMITS.outputBytes, 1024, 1024 * 1024, 'outputBytes')
        });
        if (signal?.aborted) throw sandboxError('PLAY_SANDBOX_ABORTED', 'Sandbox launch was aborted');

        const verified = await verifyLauncher(this.resources);
        const sourceExecutable = await assertRegularFile(executable, 'Sandbox runtime executable');
        const sourceAdapter = await assertRegularFile(adapter, 'Sandbox runtime adapter');
        await fsp.mkdir(this.sessionsRoot, { recursive: true, mode: 0o700 });
        const sessionRoot = await fsp.mkdtemp(path.join(this.sessionsRoot, 'play-'));
        const stagedAdapter = path.join(sessionRoot, 'adapter' + path.extname(sourceAdapter));
        let child;
        let cleanupError;
        try {
            const target = path.join(sessionRoot, 'runtime' + path.extname(sourceExecutable));
            await fsp.copyFile(sourceAdapter, stagedAdapter, fs.constants.COPYFILE_EXCL);
            await fsp.copyFile(sourceExecutable, target, fs.constants.COPYFILE_EXCL);
            const profileHash = crypto.createHash('sha256')
                .update(`${projectIdentity}\0${trustEpoch}`, 'utf8').digest('hex').slice(0, 40);
            const commandLine = [target, stagedAdapter, path.join(sessionRoot, 'result.json'), ...args]
                .map(quoteWindowsArgument).join(' ');
            const helperArgs = [
                '--profile', `TugberkEngine.Play.${profileHash}`,
                '--staging', sessionRoot,
                '--executable', target,
                '--adapter', stagedAdapter,
                '--command-line', commandLine,
                '--timeout-ms', String(policy.timeoutMs),
                '--memory-bytes', String(policy.memoryBytes),
                '--cpu-ms', String(policy.cpuMs)
            ];
            child = this.spawnProcess(verified.executable, helperArgs, {
                cwd: sessionRoot,
                env: Object.freeze({
                    SystemRoot: process.env.SystemRoot || 'C:\\Windows',
                    LOCALAPPDATA: process.env.LOCALAPPDATA,
                    USERPROFILE: process.env.USERPROFILE
                }),
                windowsHide: true,
                shell: false,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            const result = await this.collect(child, signal, policy.outputBytes);
            if (!result.ok || result.exitCode !== 0) {
                throw sandboxError(result.code || (result.ok ? 'PLAY_SANDBOX_WORKER_FAILED' : 'PLAY_SANDBOX_LAUNCH_FAILED'),
                    `The OS-enforced sandbox rejected the play worker (detail ${String(result.detail ?? 'unavailable')})`);
            }
            const workerResult = await readWorkerResult(sessionRoot, policy.outputBytes);
            return Object.freeze({
                exitCode: result.exitCode,
                sandboxed: true,
                securityBoundary: 'windows-appcontainer-job',
                launcherSha256: verified.sha256,
                workerResult
            });
        } finally {
            if (child && child.exitCode === null && !child.killed) child.kill();
            try {
                await removeSessionRoot(sessionRoot, this.sessionsRoot);
            } catch (error) {
                cleanupError = error;
            }
            if (cleanupError) throw cleanupError;
        }
    }

    collect(child, signal, outputLimit) {
        return new Promise((resolve, reject) => {
            let stdout = Buffer.alloc(0);
            let stderr = Buffer.alloc(0);
            let settled = false;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener('abort', onAbort);
                callback(value);
            };
            const append = (current, chunk) => {
                const next = Buffer.concat([current, chunk]);
                if (next.length > outputLimit) {
                    child.kill();
                    finish(reject, sandboxError('PLAY_SANDBOX_OUTPUT_LIMIT', 'Sandbox launcher output exceeded its policy limit'));
                    return current;
                }
                return next;
            };
            const onAbort = () => {
                child.kill();
                finish(reject, sandboxError('PLAY_SANDBOX_ABORTED', 'Sandbox launch was aborted'));
            };
            child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk); });
            child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk); });
            child.once('error', (error) => finish(reject,
                sandboxError('PLAY_SANDBOX_UNAVAILABLE', 'The sandbox launcher could not be started', error)));
            child.once('close', () => {
                let parsed;
                for (const line of [stdout, stderr].map((value) => value.toString('utf8').trim()).filter(Boolean)) {
                    try { parsed = JSON.parse(line.split(/\r?\n/u).at(-1)); } catch { /* fail closed below */ }
                    if (parsed) break;
                }
                finish(resolve, parsed && typeof parsed.ok === 'boolean'
                    ? parsed
                    : { ok: false, code: 'INVALID_SANDBOX_ATTESTATION' });
            });
            signal?.addEventListener('abort', onAbort, { once: true });
        });
    }
}

module.exports = Object.freeze({
    DEFAULT_LIMITS,
    WindowsPlaySandboxLauncher,
    quoteWindowsArgument,
    resolveLauncherResources,
    verifyLauncher,
    readWorkerResult,
    sandboxError
});
