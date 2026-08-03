const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadEscapeHtml() {
    const sourcePath = path.join(__dirname, '..', 'src', 'editor', 'Security.ts');
    const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(`(function (module, exports) { ${output}\n})(module, module.exports);`, { module });
    return module.exports.escapeHtml;
}

test('encodes every character that can leave HTML text or attribute context', () => {
    const escapeHtml = loadEscapeHtml();
    const payloads = [
        `<img src=x onerror="window.electronAPI.writeFile('outside','pwned')">`,
        `<svg onload='window.electronAPI.openExternal("https://attacker.invalid")'></svg>`,
        `"></option></select><script>window.pwned=1</script>`,
        `closing </div> tag & quotes "'`
    ];
    for (const payload of payloads) {
        const encoded = escapeHtml(payload);
        assert.doesNotMatch(encoded, /<|>|"/);
        assert.match(encoded, /&(?:lt|gt|quot|#39|amp);/);
    }
    assert.equal(escapeHtml(null), '');
});

test('project-controlled editor HTML sinks use safe text or encoding', () => {
    const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', 'editor', file), 'utf8');
    const inspector = read('InspectorWindow.ts');

    assert.match(read('ConsoleWindow.ts'), /message\.textContent = log\.message/);
    assert.match(read('Launcher.ts'), /name\.textContent = p\.name/);
    assert.match(read('Launcher.ts'), /projectPath\.textContent = p\.path/);
    assert.match(read('HierarchyWindow.ts'), /escapeHtml\(searchQuery\)/);
    assert.match(read('ProjectWindow.ts'), /escapeHtml\(this\.searchQuery\)/);

    for (const expression of [
        'go.name',
        'prefabLabel',
        'prefabContext.nodeLabel',
        'prefabContext.contextRootLabel',
        'option.id',
        'option.label',
        'displayName',
        'asset.name',
        'asset.meta.assetType',
        'mat.name',
        'so.assetName',
        'so.typeName'
    ]) {
        assert.match(inspector, new RegExp(`escapeHtml\\(${expression.replaceAll('.', '\\.')}\\)`));
    }
});

test('editor entry document blocks inline script and unexpected network origins', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
    assert.ok(csp, 'Content-Security-Policy meta tag must exist');
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.match(csp, /connect-src 'self' http:\/\/localhost:5174 ws:\/\/localhost:5174/);
    assert.doesNotMatch(csp, /https:|wss:|\*/);
});
