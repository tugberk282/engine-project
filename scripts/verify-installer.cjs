const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findExecutable, getScratchRoot, runExecutable, smokeExecutable } = require('./packaged-smoke.cjs');
const { runPackagedSandboxMatrix } = require('./packaged-play-sandbox-adversarial.cjs');

const root = path.resolve(__dirname, '..');

function verifyAuthenticode(file) {
  if (process.env.TUGBERK_REQUIRE_AUTHENTICODE !== '1') return;
  const escaped = file.replaceAll("'", "''");
  const result = require('node:child_process').spawnSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    `$signature = Get-AuthenticodeSignature -LiteralPath '${escaped}'; if ($signature.Status -ne 'Valid') { throw ('Invalid Authenticode signature for {0}: {1} {2}' -f $signature.Path, $signature.Status, $signature.StatusMessage) }; if (-not $signature.SignerCertificate) { throw 'Authenticode signer certificate is missing' }; Write-Output ('Valid Authenticode: {0}' -f $signature.Path)`,
  ], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout || `Authenticode verification failed for ${file}`);
  process.stdout.write(result.stdout);
}

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
  verifyAuthenticode(installer);
  const workDirectory = fs.mkdtempSync(path.join(getScratchRoot(), 'tugberk-installer-'));
  const installDirectory = path.join(workDirectory, 'installed');

  console.log(`Installing ${installer} into ${installDirectory}`);
  await runExecutable(installer, {
    args: ['/S', `/D=${installDirectory}`],
    cwd: workDirectory,
    timeoutMs: 120_000,
  });

  const executable = findExecutable(installDirectory);
  verifyAuthenticode(path.join(installDirectory, 'resources', 'app.asar.unpacked', 'electron', 'resources', 'win32-x64', 'tugberk-play-sandbox.exe'));
  await smokeExecutable(executable, {
    workDirectory: path.join(workDirectory, 'smoke'),
    timeoutMs: 90_000,
  });
  await runPackagedSandboxMatrix(installDirectory, path.join(workDirectory, 'sandbox-matrix'));

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
