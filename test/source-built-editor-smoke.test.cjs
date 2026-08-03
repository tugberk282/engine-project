'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  BUILD_TIMEOUT_MS,
  LAUNCH_TIMEOUT_MS,
  RUN_COUNT,
  hashFiles,
  listFiles,
  runBounded,
  sourceIdentity,
} = require('../scripts/source-built-editor-smoke.cjs');

test('source-built smoke has explicit finite build and launch bounds and runs twice', () => {
  assert.equal(BUILD_TIMEOUT_MS, 120_000);
  assert.equal(LAUNCH_TIMEOUT_MS, 45_000);
  assert.equal(RUN_COUNT, 2);
});

test('artifact hashing is deterministic and includes relative file identity', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'source-smoke-hash-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'a.txt'), 'same');
  fs.writeFileSync(path.join(directory, 'b.txt'), 'same');
  const files = listFiles(directory);
  const first = hashFiles(files, directory);
  const second = hashFiles([...files].reverse(), directory);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, second);
  fs.renameSync(path.join(directory, 'b.txt'), path.join(directory, 'c.txt'));
  assert.notEqual(first, hashFiles(listFiles(directory), directory));
});

test('source identity retains revision, dirty state, and content hash', () => {
  const identity = sourceIdentity();
  assert.match(identity.revision, /^[a-f0-9]{40}$/);
  assert.equal(typeof identity.dirty, 'boolean');
  assert.match(identity.sourceSha256, /^[a-f0-9]{64}$/);
});

test('bounded runner rejects a hung process within its deadline', async () => {
  const started = Date.now();
  await assert.rejects(
    runBounded(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 100 }),
    /exceeded the 100ms bound/
  );
  assert.ok(Date.now() - started < 5_000, 'hung child was not terminated promptly');
});
