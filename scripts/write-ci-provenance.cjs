'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function collectFiles(inputs) {
  const files = [];
  for (const input of inputs) {
    const resolved = path.resolve(input);
    if (!fs.existsSync(resolved)) {
      throw new Error(`provenance input does not exist: ${resolved}`);
    }
    if (fs.statSync(resolved).isFile()) {
      files.push(resolved);
      continue;
    }
    for (const entry of fs.readdirSync(resolved, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) {
        files.push(path.join(entry.parentPath ?? entry.path, entry.name));
      }
    }
  }
  return [...new Set(files)].sort();
}

function commandVersion(command, args) {
  if (process.platform === 'win32') {
    return execFileSync(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', [
      '/d', '/s', '/c', `${command} ${args.join(' ')}`,
    ], { encoding: 'utf8', windowsHide: true }).trim();
  }
  return execFileSync(command, args, { encoding: 'utf8', windowsHide: true }).trim();
}

function createProvenance(inputs, environment = process.env) {
  const workspace = path.resolve(environment.GITHUB_WORKSPACE || process.cwd());
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: {
      repository: environment.GITHUB_REPOSITORY || null,
      commit: environment.GITHUB_SHA || null,
      ref: environment.GITHUB_REF || null,
      dirty: false,
    },
    workflow: {
      name: environment.GITHUB_WORKFLOW || null,
      runId: environment.GITHUB_RUN_ID || null,
      runAttempt: environment.GITHUB_RUN_ATTEMPT || null,
      job: environment.GITHUB_JOB || null,
      serverUrl: environment.GITHUB_SERVER_URL || null,
    },
    runner: {
      os: environment.RUNNER_OS || process.platform,
      arch: environment.RUNNER_ARCH || process.arch,
      node: process.version,
      npm: commandVersion(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version']),
    },
    artifacts: collectFiles(inputs).map((file) => ({
      path: path.relative(workspace, file).replaceAll(path.sep, '/'),
      bytes: fs.statSync(file).size,
      sha256: sha256(file),
    })),
  };
}

function main() {
  const [output, ...inputs] = process.argv.slice(2);
  if (!output || inputs.length === 0) {
    throw new Error('usage: node scripts/write-ci-provenance.cjs <output.json> <artifact>...');
  }
  const resolvedOutput = path.resolve(output);
  const provenance = createProvenance(inputs);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(resolvedOutput, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  console.log(`Wrote provenance for ${provenance.artifacts.length} files to ${resolvedOutput}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = { collectFiles, createProvenance, sha256 };
