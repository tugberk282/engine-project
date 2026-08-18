'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const BUILD_TIMEOUT_MS = 120_000;
const LAUNCH_TIMEOUT_MS = 45_000;
const RUN_COUNT = 2;

function hashFiles(files, baseDirectory = root) {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort()) {
    const relative = path.relative(baseDirectory, file).replaceAll(path.sep, '/');
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name));
}

function sourceIdentity() {
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  const status = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(revision.status, 0, revision.stderr || 'git rev-parse failed');
  assert.equal(status.status, 0, status.stderr || 'git status failed');

  const sourceFiles = [
    ...listFiles(path.join(root, 'src')),
    ...listFiles(path.join(root, 'electron')),
    path.join(root, 'index.html'),
    path.join(root, 'package.json'),
    path.join(root, 'package-lock.json'),
    path.join(root, 'tsconfig.json'),
    path.join(root, 'vite.config.mts'),
  ].filter(fs.existsSync);

  return {
    revision: revision.stdout.trim(),
    dirty: status.stdout.length > 0,
    lockSha256: hashFiles([path.join(root, 'package-lock.json')]),
    sourceSha256: hashFiles(sourceFiles),
  };
}

function resolveElectronExecutable() {
  const electronPackage = require.resolve('electron', { paths: [root] });
  // Electron 43 intentionally downloads its binary on first module/bin use.
  // Loading the pinned local package is its supported on-demand bootstrap path.
  const executable = require(electronPackage);
  assert.ok(fs.existsSync(executable), `Electron executable is missing after on-demand bootstrap: ${executable}`);
  return executable;
}

function countGlobalElectronProcesses() {
  if (process.platform !== 'win32') return null;
  const result = spawnSync('tasklist', ['/FI', 'IMAGENAME eq electron.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || 'tasklist failed');
  return result.stdout.split(/\r?\n/).filter((line) => /^"electron\.exe",/i.test(line.trim())).length;
}

function npmCommand() {
  const npmCli = process.env.npm_execpath
    || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  assert.ok(fs.existsSync(npmCli), `npm CLI is missing: ${npmCli}`);
  return { command: process.execPath, args: [npmCli] };
}

function killProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {}
}

function runBounded(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? BUILD_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...options.env },
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killProcessTree(child.pid);
      if (error) reject(error);
      else resolve(result);
    };
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => finish(error));
    child.once('exit', (code, signal) => {
      if (code === 0) finish(null, { stdout, stderr });
      else finish(new Error(`${command} exited with code ${code} signal ${signal}\n${stdout}\n${stderr}`));
    });
    const timer = setTimeout(() => {
      finish(new Error(`${command} exceeded the ${timeoutMs}ms bound\n${stdout}\n${stderr}`));
    }, timeoutMs);
  });
}

async function runEditorOnce(electronExecutable, scratchRoot, runNumber) {
  const workDirectory = fs.mkdtempSync(path.join(scratchRoot, `source-smoke-${runNumber}-`));
  const output = path.join(workDirectory, 'renderer-result.json');
  const project = path.join(workDirectory, 'project');
  fs.cpSync(path.join(root, 'samples', 'vertical-slice'), project, { recursive: true });

  try {
    await runBounded(electronExecutable, ['.'], {
      cwd: root,
      env: {
        ELECTRON_RUN_AS_NODE: undefined,
        ENGINE_LOAD_DIST: '1',
        ENGINE_SMOKE_TEST: '1',
        ENGINE_SMOKE_TEST_OUTPUT: output,
        ENGINE_AUTO_OPEN_PROJECT_PATH: project,
        ENGINE_USER_DATA_PATH: path.join(workDirectory, 'user-data'),
      },
      timeoutMs: LAUNCH_TIMEOUT_MS,
    });
    assert.ok(fs.existsSync(output), `source-built editor did not write run ${runNumber} result`);
    const result = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(result.ok, true, JSON.stringify(result.failures ?? result, null, 2));
    return { run: runNumber, checks: result.checks.length, result };
  } finally {
    try {
      fs.rmSync(workDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (error) {
      if (error?.code !== 'EPERM') throw error;
      // Chromium may retain a Windows directory handle briefly after the process
      // tree exits. The run-owned Paperclip scratch root performs final cleanup.
      process.stderr.write(`Deferred smoke scratch cleanup: ${workDirectory}\n`);
    }
  }
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('The source-built editor smoke gate currently qualifies Windows only.');
  }
  const scratchRoot = process.env.PAPERCLIP_RUN_SCRATCH_DIR
    || process.env.PAPERCLIP_SCRATCH_DIR
    || os.tmpdir();
  const resultPath = process.env.ENGINE_SOURCE_SMOKE_RESULT
    ? path.resolve(process.env.ENGINE_SOURCE_SMOKE_RESULT)
    : path.join(scratchRoot, 'source-built-editor-smoke.json');
  const distDirectory = path.join(root, 'dist');
  const identity = sourceIdentity();
  const startedAt = new Date().toISOString();
  const globalElectronProcessesBefore = countGlobalElectronProcesses();

  fs.rmSync(distDirectory, { recursive: true, force: true });
  const npm = npmCommand();
  await runBounded(npm.command, [...npm.args, 'run', 'build']);
  assert.ok(fs.existsSync(path.join(distDirectory, 'index.html')), 'fresh build did not produce dist/index.html');

  const bundleFiles = listFiles(distDirectory);
  assert.ok(bundleFiles.length > 0, 'fresh build produced no files');
  const electronExecutable = resolveElectronExecutable();

  const runs = [];
  for (let runNumber = 1; runNumber <= RUN_COUNT; runNumber += 1) {
    runs.push(await runEditorOnce(electronExecutable, scratchRoot, runNumber));
  }
  const globalElectronProcessesAfter = countGlobalElectronProcesses();
  assert.equal(
    globalElectronProcessesAfter,
    globalElectronProcessesBefore,
    'source-built smoke left global Electron processes behind'
  );

  const result = {
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    bounds: {
      buildMs: BUILD_TIMEOUT_MS,
      editorLaunchMs: LAUNCH_TIMEOUT_MS,
      editorRuns: RUN_COUNT,
    },
    source: identity,
    build: {
      bundleSha256: hashFiles(bundleFiles, distDirectory),
      files: bundleFiles.length,
    },
    processes: {
      qualificationOwnedBefore: 0,
      qualificationOwnedAfter: 0,
      globalBefore: globalElectronProcessesBefore,
      globalAfter: globalElectronProcessesAfter,
    },
    runs: runs.map(({ run, checks }) => ({ run, checks, ok: true })),
  };
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  BUILD_TIMEOUT_MS,
  LAUNCH_TIMEOUT_MS,
  RUN_COUNT,
  hashFiles,
  killProcessTree,
  listFiles,
  npmCommand,
  countGlobalElectronProcesses,
  resolveElectronExecutable,
  runBounded,
  sourceIdentity,
};
