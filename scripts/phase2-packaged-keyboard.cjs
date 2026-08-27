const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findExecutable, getScratchRoot, runExecutable } = require('./packaged-smoke.cjs');

async function main() {
  assert.equal(process.platform, 'win32', 'The Phase 2 packaged keyboard qualification is Windows-only');
  const packageDirectory = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'release', 'win-unpacked');
  const executable = findExecutable(packageDirectory);
  const runRoot = fs.mkdtempSync(path.join(getScratchRoot(), 'tug-112-packaged-keyboard-'));
  const project = path.join(runRoot, 'project');
  fs.cpSync(path.join(__dirname, '..', 'samples', 'vertical-slice'), project, { recursive: true });
  const executableHash = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
  const phases = [];

  for (const phase of ['author', 'reopen']) {
    const phaseRoot = path.join(runRoot, phase);
    const artifacts = path.join(phaseRoot, 'artifacts');
    const output = path.join(phaseRoot, 'result.json');
    fs.mkdirSync(artifacts, { recursive: true });
    await runExecutable(executable, {
      cwd: phaseRoot,
      env: {
        ELECTRON_RUN_AS_NODE: undefined,
        ENGINE_SMOKE_TEST: '1',
        ENGINE_SMOKE_TEST_OUTPUT: output,
        ENGINE_PHASE2_KEYBOARD_PHASE: phase,
        ENGINE_PHASE2_ARTIFACT_DIR: artifacts,
        ENGINE_AUTO_OPEN_PROJECT_PATH: project,
        ENGINE_USER_DATA_PATH: path.join(phaseRoot, 'user-data')
      },
      timeoutMs: 90_000
    });
    const result = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
    phases.push({ phase, result: path.relative(runRoot, output), checks: result.checks.length });
  }

  const summary = { ok: true, issue: 'TUG-112', executable, executableSha256: executableHash, runRoot, project, phases };
  fs.writeFileSync(path.join(runRoot, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`TUG-112 packaged keyboard qualification passed twice; retained at ${runRoot}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
