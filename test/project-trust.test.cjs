const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ProjectTrustStore, canonicalProjectIdentity } = require('../electron/security/project-trust');

test('trust is keyed by canonical project identity and survives reload', (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-trust-'));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const project = path.join(base, 'project');
    fs.mkdirSync(project);
    const storePath = path.join(base, 'state', 'trusted-projects.json');

    const store = new ProjectTrustStore(storePath);
    assert.equal(store.get(path.join(project, '.')).mode, 'safe');
    store.trust(project);
    assert.equal(store.get(path.join(project, '.')).mode, 'trusted');
    assert.equal(new ProjectTrustStore(storePath).get(project).trusted, true);
});

test('revocation returns a project to safe mode and persists', (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-trust-'));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const project = path.join(base, 'project');
    fs.mkdirSync(project);
    const storePath = path.join(base, 'trusted-projects.json');
    const store = new ProjectTrustStore(storePath);

    store.trust(project);
    assert.equal(store.revoke(project).revoked, true);
    assert.equal(new ProjectTrustStore(storePath).get(project).mode, 'safe');
});

test('canonical identity collapses symlink aliases', { skip: process.platform === 'win32' }, (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tugberk-trust-'));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const project = path.join(base, 'project');
    const alias = path.join(base, 'alias');
    fs.mkdirSync(project);
    fs.symlinkSync(project, alias, 'dir');
    assert.equal(canonicalProjectIdentity(project).identity, canonicalProjectIdentity(alias).identity);
});

test('Electron boundary exposes consent and revocation while writes require trust', () => {
    const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
    const preload = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8');
    assert.match(main, /ipcMain\.handle\('request-project-trust'/);
    assert.match(main, /ipcMain\.handle\('revoke-project-trust'/);
    assert.match(main, /buttons: \['Open in Safe Mode', 'Trust Project'\]/);
    assert.match(main, /authorize\(filePath, \{ write: true \}\)/);
    assert.match(main, /authorize\(targetPath, \{[^}]*write: true[^}]*\}\)/);
    assert.match(main, /case COMMANDS\.PROJECT_REQUEST_TRUST/);
    assert.match(main, /case COMMANDS\.PROJECT_REVOKE_TRUST/);
    assert.doesNotMatch(preload, /requestProjectTrust:|revokeProjectTrust:/);
});
