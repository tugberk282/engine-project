'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createProvenance } = require('../scripts/write-ci-provenance.cjs');

test('CI provenance identifies the immutable run and hashes retained files deterministically', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-ci-provenance-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const evidence = path.join(workspace, 'evidence');
  fs.mkdirSync(evidence);
  const artifact = path.join(evidence, 'baseline.txt');
  fs.writeFileSync(artifact, 'qualified baseline\n');

  const provenance = createProvenance([evidence], {
    GITHUB_WORKSPACE: workspace,
    GITHUB_REPOSITORY: 'example/tugberk-engine',
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKFLOW: 'Quality gates',
    GITHUB_RUN_ID: '1234',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_JOB: 'build',
    GITHUB_SERVER_URL: 'https://github.com',
    RUNNER_OS: 'Windows',
    RUNNER_ARCH: 'X64',
  });

  assert.deepEqual(provenance.source, {
    repository: 'example/tugberk-engine',
    commit: 'a'.repeat(40),
    ref: 'refs/heads/main',
    dirty: false,
  });
  assert.equal(provenance.workflow.runId, '1234');
  assert.equal(provenance.workflow.runAttempt, '2');
  assert.deepEqual(provenance.artifacts, [{
    path: 'evidence/baseline.txt',
    bytes: 19,
    sha256: crypto.createHash('sha256').update('qualified baseline\n').digest('hex'),
  }]);
});
