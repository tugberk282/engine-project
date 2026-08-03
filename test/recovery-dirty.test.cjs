const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeRecovery, readRecovery, discardRecovery, recoveryPath, MAX_RECOVERY_BYTES } = require('../electron/architecture/recovery');

test('recovery is atomic, newer-only, discardable, and separate from canonical scene', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-recovery-'));
    const canonical = path.join(root, 'Assets', 'Scenes', 'Main.json');
    fs.mkdirSync(path.dirname(canonical), { recursive: true });
    fs.writeFileSync(canonical, '{"canonical":true}');
    writeRecovery(root, canonical, '{"name":"Recovered"}', 200);
    assert.equal(fs.readFileSync(canonical, 'utf8'), '{"canonical":true}');
    assert.equal(readRecovery(root, 100).scene.name, 'Recovered');
    assert.equal(readRecovery(root, 200), null);
    assert.equal(discardRecovery(root), true);
    assert.equal(fs.existsSync(recoveryPath(root)), false);
});

test('malformed and oversized recovery data fail safely', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-recovery-'));
    const target = recoveryPath(root);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '{bad');
    assert.equal(readRecovery(root), null);
    assert.throws(() => writeRecovery(root, null, 'x'.repeat(MAX_RECOVERY_BYTES + 1)), /exceeds limit/);
});
