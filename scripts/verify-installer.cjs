const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findExecutable, getScratchRoot, runExecutable, smokeExecutable } = require('./packaged-smoke.cjs');

const root = path.resolve(__dirname, '..');

function findInstaller(directory) {
  const candidates = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.exe$/i.test(entry.name) && /setup/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name));
  assert.equal(candidates.length, 1, `expected one NSIS setup executable in ${directory}, found: ${candidates.join(', ')}`);
  assert.ok(fs.statSync(candidates[0]).size > 1_000_000, 'installer is unexpectedly small');
  return candidates[0];
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('Installer verification currently qualifies Windows NSIS only.');
  }
  const artifactDirectory = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'release');
  const installer = findInstaller(artifactDirectory);
  const workDirectory = fs.mkdtempSync(path.join(getScratchRoot(), 'tugberk-installer-'));
  const installDirectory = path.join(workDirectory, 'installed');

  console.log(`Installing ${installer} into ${installDirectory}`);
  await runExecutable(installer, {
    args: ['/S', `/D=${installDirectory}`],
    cwd: workDirectory,
    timeoutMs: 120_000,
  });

  const executable = findExecutable(installDirectory);
  await smokeExecutable(executable, {
    workDirectory: path.join(workDirectory, 'smoke'),
    timeoutMs: 90_000,
  });

  const uninstaller = fs.readdirSync(installDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /unins|uninstall/i.test(entry.name) && /\.exe$/i.test(entry.name))
    .map((entry) => path.join(installDirectory, entry.name))[0];
  assert.ok(uninstaller, 'installed application did not include an uninstaller');
  await runExecutable(uninstaller, {
    args: ['/S'],
    cwd: workDirectory,
    timeoutMs: 120_000,
  });
  console.log('Installer install, packaged launch, and uninstall verification passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
