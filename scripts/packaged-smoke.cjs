const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function getScratchRoot() {
  return process.env.PAPERCLIP_RUN_SCRATCH_DIR
    || process.env.PAPERCLIP_SCRATCH_DIR
    || os.tmpdir();
}

function findExecutable(directory) {
  const candidates = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.exe'))
    .map((entry) => path.join(directory, entry.name))
    .filter((file) => !/unins|uninstall/i.test(path.basename(file)));
  assert.equal(candidates.length, 1, `expected one application executable in ${directory}, found: ${candidates.join(', ')}`);
  return candidates[0];
}

function runExecutable(executable, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, options.args ?? [], {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out after ${timeoutMs}ms launching ${executable}\n${stdout}\n${stderr}`));
    }, timeoutMs);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${executable} exited with code ${code} signal ${signal}\n${stdout}\n${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function smokeExecutable(executable, options = {}) {
  const workDirectory = options.workDirectory
    ?? fs.mkdtempSync(path.join(getScratchRoot(), 'tugberk-packaged-smoke-'));
  fs.mkdirSync(workDirectory, { recursive: true });
  const output = path.join(workDirectory, 'smoke-test-result.json');
  const userData = path.join(workDirectory, 'user-data');
  const fixture = path.join(root, 'samples', 'vertical-slice');
  const project = path.join(workDirectory, 'project');
  assert.ok(fs.existsSync(fixture), `smoke fixture is missing: ${fixture}`);
  fs.cpSync(fixture, project, { recursive: true });
  const smokeAssetDirectory = path.join(project, 'Assets', 'Smoke');
  fs.mkdirSync(smokeAssetDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(smokeAssetDirectory, '__SmokeTransaction.asset'),
    '{"name":"Disposable packaged-smoke transaction asset"}\n',
    'utf8'
  );

  await runExecutable(executable, {
    cwd: workDirectory,
    env: {
      ELECTRON_RUN_AS_NODE: undefined,
      ENGINE_SMOKE_TEST: '1',
      ENGINE_SMOKE_TEST_OUTPUT: output,
      ENGINE_AUTO_OPEN_PROJECT_PATH: project,
      ENGINE_USER_DATA_PATH: userData,
    },
    timeoutMs: options.timeoutMs,
  });

  assert.ok(fs.existsSync(output), `packaged application did not write ${output}`);
  const result = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(result.ok, true, JSON.stringify(result.failures ?? result, null, 2));
  assert.ok(result.checks?.length >= 10, 'packaged smoke result did not contain the expected UI checks');
  console.log(`Packaged smoke passed (${result.checks.length} checks): ${executable}`);
  return result;
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('The packaged desktop smoke currently qualifies Windows only.');
  }
  const packageDirectory = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(root, 'release', 'win-unpacked');
  await smokeExecutable(findExecutable(packageDirectory));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { findExecutable, getScratchRoot, runExecutable, smokeExecutable };
