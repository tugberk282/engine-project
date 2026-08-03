const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'editor', 'ConsoleWindow.ts'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'style.css'), 'utf8');

test('console exposes Unity-style filtering, collapse, selection and details states', () => {
    assert.match(source, /Group identical messages/);
    assert.match(source, /Search console messages/);
    assert.match(source, /role', 'listbox'/);
    assert.match(source, /aria-selected/);
    assert.match(source, /Selected message details/);
    assert.match(source, /No logs match the current filters/);
    assert.match(styles, /\.console-item\[aria-selected='true'\]/);
});

test('console supports pointer, keyboard, context and stack navigation workflows', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape']) {
        assert.match(source, new RegExp(`event\\.key === '${key}'`));
    }
    assert.match(source, /addEventListener\('dblclick'/);
    assert.match(source, /addEventListener\('contextmenu'/);
    assert.match(source, /Open Stack Location/);
    assert.match(source, /tugberk:console-open-location/);
    assert.match(source, /navigator\.clipboard/);
});

test('console keeps diagnostic text out of HTML injection sinks', () => {
    assert.match(source, /message\.textContent = log\.message/);
    assert.match(source, /stack\.textContent = entry\.stack/);
    assert.doesNotMatch(source, /innerHTML\s*=\s*.*(?:message|stack)/);
});
