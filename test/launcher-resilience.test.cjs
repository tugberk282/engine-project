const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('launcher exposes live state and recent projects as keyboard-operable controls', () => {
    const html = read('index.html');
    const source = read('src/editor/Launcher.ts');
    assert.match(html, /id="launcher-status"[^>]+role="status"[^>]+aria-live="polite"/);
    assert.match(html, /id="launcher-project-list"[^>]+aria-label="Recent projects"[^>]+aria-busy="true"/);
    assert.match(source, /document\.createElement\('button'\)/);
    assert.match(source, /item\.type = 'button'/);
    assert.match(source, /item\.setAttribute\('aria-label'/);
});

test('launcher keeps recovery UI visible and reports load, trust, and launch failures', () => {
    const source = read('src/editor/Launcher.ts');
    assert.match(source, /Recent projects could not be loaded\./);
    assert.match(source, /requestProjectTrust\(projectPath\)/);
    assert.match(source, /if \(launcher\) launcher\.style\.display = 'flex'/);
    assert.match(source, /`Could not open .+\$\{projectName\}.+Check that the project is valid and try again\.`/);
    assert.ok(source.indexOf('new Editor(projectPath)') < source.indexOf("launcher.style.display = 'none'"));
});

test('launcher prevents duplicate actions and provides visible focus and responsive states', () => {
    const source = read('src/editor/Launcher.ts');
    const css = read('src/style.css');
    assert.match(source, /if \(this\.busy\) return/);
    assert.match(source, /button\.disabled = busy/);
    assert.match(css, /\.project-item:focus-visible/);
    assert.match(css, /@media \(max-width: 520px\)/);
});

test('launcher offers retry and named removal actions with managed focus', () => {
    const source = read('src/editor/Launcher.ts');
    assert.match(source, /retryButton\.textContent = 'Retry'/);
    assert.match(source, /Remove \$\{p\.name\} from recent projects/);
    assert.match(source, /private async removeRecentProject/);
    assert.match(source, /if \(isError\) status\.focus\(\)/);
    assert.match(source, /Project launcher requires the Tugberk Engine desktop app/i);
});
