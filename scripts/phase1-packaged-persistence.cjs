'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { findExecutable, runExecutable } = require('./packaged-smoke.cjs');
const { writeRecovery, recoveryPath } = require('../electron/architecture/recovery');

const root = path.resolve(__dirname, '..');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function fixture() {
  return {
    formatVersion: 1,
    sceneId: 'phase1-packaged-scene',
    name: 'Nested Persistence',
    unknownRoot: { retained: true },
    gameObjects: [{
      id: 'nested-parent', name: 'Nested Parent', enabled: true,
      unknownObject: 'preserve-me', components: [], children: [{
        id: 'nested-child', name: 'Nested Child', enabled: true,
        components: [{ type: 'FutureComponent', data: {}, customUnknown: 42 }],
        children: []
      }]
    }]
  };
}

async function launch(executable, work, project, scenePath, phase, extra = {}) {
  const output = path.join(work, `${phase}.json`);
  const screenshot = path.join(work, `${phase}.png`);
  await runExecutable(executable, {
    cwd: work,
    env: {
      ELECTRON_RUN_AS_NODE: undefined,
      ENGINE_SMOKE_TEST: '1',
      ENGINE_SMOKE_TEST_OUTPUT: output,
      ENGINE_AUTO_OPEN_PROJECT_PATH: project,
      ENGINE_USER_DATA_PATH: path.join(work, 'user-data'),
      ENGINE_PHASE1_HARNESS_PHASE: phase,
      ENGINE_PHASE1_SCENE_PATH: scenePath,
      ENGINE_PHASE1_SCREENSHOT_PATH: screenshot,
      ...extra
    },
    timeoutMs: 60_000
  });
  assert.ok(fs.existsSync(screenshot) && fs.statSync(screenshot).size > 1000, `${phase} screenshot missing`);
  return JSON.parse(fs.readFileSync(output, 'utf8'));
}

async function crashLaunch(executable, work, project, scenePath) {
  const output = path.join(work, 'crash.json');
  const screenshot = path.join(work, 'crash.png');
  const child = spawn(executable, [], {
    cwd: work, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ENGINE_SMOKE_TEST: '1',
      ENGINE_SMOKE_TEST_OUTPUT: output, ENGINE_AUTO_OPEN_PROJECT_PATH: project,
      ENGINE_USER_DATA_PATH: path.join(work, 'user-data'), ENGINE_PHASE1_HARNESS_PHASE: 'crash',
      ENGINE_PHASE1_SCENE_PATH: scenePath, ENGINE_PHASE1_SCREENSHOT_PATH: screenshot }
  });
  for (let i = 0; i < 600 && !fs.existsSync(output); i += 1) await new Promise((r) => setTimeout(r, 100));
  assert.ok(fs.existsSync(output), 'forced-termination phase did not produce evidence');
  for (let i = 0; i < 100 && !fs.existsSync(recoveryPath(project)); i += 1) await new Promise((r) => setTimeout(r, 100));
  assert.ok(fs.existsSync(recoveryPath(project)), 'forced-termination phase did not persist recovery');
  await new Promise((resolve, reject) => {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    killer.once('error', reject);
    killer.once('exit', resolve);
  });
  if (child.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('packaged process tree did not terminate')), 5000))
    ]);
  }
  return JSON.parse(fs.readFileSync(output, 'utf8'));
}

async function main() {
  assert.equal(process.platform, 'win32', 'packaged persistence qualification is Windows-only');
  const executable = findExecutable(path.join(root, 'release', 'win-unpacked'));
  const base = process.env.PAPERCLIP_RUN_SCRATCH_DIR || process.env.PAPERCLIP_SCRATCH_DIR || os.tmpdir();
  const work = fs.mkdtempSync(path.join(base, 'tug-79-packaged-persistence-'));
  const project = path.join(work, 'project');
  const scenePath = path.join(project, 'Assets', 'Scenes', 'Nested.scene.json');
  const saveAsPath = path.join(project, 'Assets', 'Scenes', 'NestedCopy.scene.json');
  fs.mkdirSync(path.dirname(scenePath), { recursive: true });
  fs.writeFileSync(path.join(project, 'project.json'), JSON.stringify({
    formatVersion: 1, name: 'Phase 1 Harness',
    scenes: [{ path: 'Assets/Scenes/Nested.scene.json', sceneId: 'phase1-packaged-scene' }]
  }, null, 2));
  fs.writeFileSync(scenePath, JSON.stringify(fixture(), null, 2) + '\n');

  const authored = await launch(executable, work, project, scenePath, 'author', {
    ENGINE_PHASE1_SAVE_AS_PATH: saveAsPath
  });
  assert.equal(authored.child.name, 'Nested Child Save As');
  assert.equal(authored.selected[0], 'nested-child');
  const canonicalAfterSave = fs.readFileSync(scenePath, 'utf8');
  const copy = JSON.parse(fs.readFileSync(saveAsPath, 'utf8'));
  assert.equal(copy.unknownRoot.retained, true);
  assert.equal(copy.gameObjects[0].children[0].id, 'nested-child');

  fs.writeFileSync(path.join(project, 'project.json'), JSON.stringify({
    formatVersion: 1, name: 'Phase 1 Harness',
    scenes: [{ path: 'Assets/Scenes/NestedCopy.scene.json', sceneId: 'phase1-packaged-scene' }]
  }, null, 2));
  const reopened = await launch(executable, work, project, saveAsPath, 'reopen');
  assert.deepEqual(stable(reopened.serialized), stable(copy));
  assert.equal(reopened.selected[0], 'nested-child');

  const conflict = await launch(executable, work, project, saveAsPath, 'conflict');
  const conflictBytes = fs.readFileSync(saveAsPath, 'utf8');
  assert.match(conflictBytes, /written-outside-editor/);
  assert.equal(conflict.child.name, 'Unsaved Stale Edit');
  assert.notEqual(conflictBytes, canonicalAfterSave);

  await crashLaunch(executable, work, project, saveAsPath);
  assert.ok(fs.existsSync(recoveryPath(project)));
  const restored = await launch(executable, work, project, saveAsPath, 'restore', {
    ENGINE_PHASE1_CONFIRM_RESPONSE: 'true'
  });
  assert.equal(restored.child.name, 'Recovered After Forced Termination');

  writeRecovery(project, saveAsPath, JSON.stringify({ ...copy,
    gameObjects: [{ ...copy.gameObjects[0], children: [{ ...copy.gameObjects[0].children[0], name: 'Must Be Discarded' }] }]
  }), Date.now() + 10_000);
  const discarded = await launch(executable, work, project, saveAsPath, 'discard', {
    ENGINE_PHASE1_CONFIRM_RESPONSE: 'false'
  });
  assert.notEqual(discarded.child.name, 'Must Be Discarded');
  assert.equal(fs.existsSync(recoveryPath(project)), false);

  const phases = ['author', 'reopen', 'conflict', 'crash', 'restore', 'discard'];
  const artifacts = Object.fromEntries(phases.map((phase) => [phase, {
    result: `${phase}.json`,
    screenshot: `${phase}.png`
  }]));
  for (const { result, screenshot } of Object.values(artifacts)) {
    assert.ok(fs.existsSync(path.join(work, result)), `retained result missing: ${result}`);
    assert.ok(fs.existsSync(path.join(work, screenshot)), `retained screenshot missing: ${screenshot}`);
  }
  const summary = { ok: true, work, phases, artifacts };
  fs.writeFileSync(path.join(work, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
