const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const workflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'quality-gates.yml'),
  'utf8',
);

test('security-sensitive build dependencies are exact and lockfile-backed', () => {
  for (const name of ['electron', 'electron-builder', 'vite']) {
    const declared = manifest.devDependencies[name];
    assert.match(declared, /^\d+\.\d+\.\d+$/, `${name} must use an exact version`);
    assert.equal(lock.packages[''].devDependencies[name], declared);

    const locked = lock.packages[`node_modules/${name}`];
    assert.ok(locked, `${name} must be present in package-lock.json`);
    assert.match(locked.integrity, /^sha512-/, `${name} must have an integrity hash`);
  }
});

test('CI actions are immutable and installs use the lockfile', () => {
  const actionRefs = [...workflow.matchAll(/uses:\s*[^@\s]+@([^\s#]+)/g)].map(
    (match) => match[1],
  );
  assert.ok(actionRefs.length > 0, 'expected at least one GitHub Action');
  for (const ref of actionRefs) {
    assert.match(ref, /^[0-9a-f]{40}$/, `mutable action reference: ${ref}`);
  }
  assert.match(workflow, /\brun:\s*npm ci\b/);
  assert.match(workflow, /\brun:\s*npm run audit:release\b/);
});

test('CI launches both the packaged app and the installed app', () => {
  assert.equal(manifest.scripts['test:packaged-smoke'], 'node scripts/packaged-smoke.cjs');
  assert.equal(manifest.scripts['test:installer'], 'node scripts/verify-installer.cjs');
  assert.equal(manifest.build.directories.output, 'release');
  assert.equal(manifest.build.win.target[0], 'nsis');
  assert.equal(manifest.build.nsis.oneClick, false);
  assert.equal(manifest.build.nsis.perMachine, false);
  assert.match(workflow, /\bnpm run test:packaged-smoke\b/);
  assert.match(workflow, /\bnpm run test:installer\b/);
});

test('CI retains commit-bound baseline provenance and artifacts', () => {
  assert.match(workflow, /ENGINE_SOURCE_SMOKE_RESULT:/);
  assert.match(workflow, /write-ci-provenance\.cjs/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /name:\s*source-build-baseline-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /name:\s*windows-package-baseline-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.equal((workflow.match(/retention-days:\s*30/g) || []).length, 2);
  assert.equal((workflow.match(/if-no-files-found:\s*error/g) || []).length, 2);
});
