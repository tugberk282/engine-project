const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
const desktopFileSystemSource = fs.readFileSync(path.join(root, 'src/platform/DesktopFileSystem.ts'), 'utf8');
const databaseSource = fs.readFileSync(path.join(root, 'src/engine/AssetDatabase.ts'), 'utf8');
const importerSource = fs.readFileSync(path.join(root, 'src/engine/AssetImporter.ts'), 'utf8');

function loadAssetDatabase(fileSystem) {
  const transpiled = ts.transpileModule(databaseSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request.endsWith('/PathUtils')) {
      return { PathUtils: { join: path.join, extname: path.extname } };
    }
    if (request.endsWith('/DesktopFileSystem')) {
      return { DesktopFileSystem: class { constructor() { return fileSystem; } } };
    }
    return require(request);
  };
  new Function('require', 'module', 'exports', transpiled)(localRequire, module, module.exports);
  return module.exports.AssetDatabase;
}

function createNativeFileSystem() {
  return {
    async exists(targetPath) { return fs.existsSync(targetPath); },
    async mkdir(...args) { return fs.mkdirSync(...args); },
    async readdir(targetPath, options) {
      return fs.readdirSync(targetPath, options);
    },
    async stat(...args) { return fs.statSync(...args); },
    async readFile(...args) { return fs.readFileSync(...args); },
    async writeFile(...args) { return fs.writeFileSync(...args); },
    async copyFile(...args) { return fs.copyFileSync(...args); },
    async rename(...args) { return fs.renameSync(...args); },
    async rm(...args) { return fs.rmSync(...args); },
    async unlink(...args) { return fs.unlinkSync(...args); }
  };
}

test('directory entries preserve link identity and asset refresh never follows links', () => {
  assert.match(mainSource, /isSymbolicLink:\s*entry\.isSymbolicLink\(\)/);
  assert.match(desktopFileSystemSource, /isSymbolicLink:\s*\(\)\s*=>\s*entry\.isSymbolicLink\s*===\s*true/);
  assert.match(databaseSource, /safeEntries\s*=\s*entries\.filter[\s\S]*isSymbolicLink\?\.\(\)\s*!==\s*true/);
  assert.match(databaseSource, /for\s*\(const entry of safeEntries\)/);
});

test('refresh terminates on directory links and never writes metadata outside the asset root', async (t) => {
  const scratchRoot = fs.mkdtempSync(path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR || os.tmpdir(), 'tugberk-asset-links-'));
  t.after(() => fs.rmSync(scratchRoot, { recursive: true, force: true }));
  const assets = path.join(scratchRoot, 'Assets');
  const external = path.join(scratchRoot, 'external');
  fs.mkdirSync(assets);
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(assets, 'normal.txt'), 'normal');
  fs.writeFileSync(path.join(external, 'sentinel.txt'), 'outside');

  try {
    fs.symlinkSync(external, path.join(assets, 'external-link'), process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(assets, path.join(assets, 'cycle'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`directory links unavailable on this platform: ${error.code || error.message}`);
    return;
  }

  const AssetDatabase = loadAssetDatabase(createNativeFileSystem());
  const result = await AssetDatabase.getInstance().refresh(assets);
  assert.equal(result.scannedCount, 2);
  assert.equal(fs.existsSync(path.join(external, 'sentinel.txt.meta')), false);
  assert.equal(fs.existsSync(path.join(assets, 'external-link.meta')), false);
  assert.equal(fs.existsSync(path.join(assets, 'cycle.meta')), false);
});

test('asset traversal has deterministic depth and entry ceilings', () => {
  assert.match(databaseSource, /MAX_SCAN_DEPTH\s*=\s*64/);
  assert.match(databaseSource, /MAX_SCAN_ENTRIES\s*=\s*50_000/);
  assert.match(databaseSource, /Asset scan depth exceeds/);
  assert.match(databaseSource, /Asset scan exceeds/);
});

test('metadata reads are bounded and metadata replacement is atomic', () => {
  assert.match(databaseSource, /MAX_META_BYTES\s*=\s*1024\s*\*\s*1024/);
  assert.match(databaseSource, /stat\.size\s*>\s*AssetDatabase\.MAX_META_BYTES/);
  assert.match(databaseSource, /temporaryPath\s*=\s*`\$\{metaPath\}\.\$\{crypto\.randomUUID\(\)\}\.tmp`/);
  assert.match(databaseSource, /await this\.fs\.rename\(temporaryPath,\s*metaPath\)/);
  assert.match(databaseSource, /await this\.fs\.unlink\(temporaryPath\)/);
});

test('supported media importers reject oversized or non-file sources before decoding', () => {
  assert.match(importerSource, /MAX_MODEL_SOURCE_BYTES\s*=\s*256\s*\*\s*1024\s*\*\s*1024/);
  assert.match(importerSource, /MAX_TEXTURE_SOURCE_BYTES\s*=\s*128\s*\*\s*1024\s*\*\s*1024/);
  assert.match(importerSource, /MAX_AUDIO_SOURCE_BYTES\s*=\s*64\s*\*\s*1024\s*\*\s*1024/);
  assert.match(importerSource, /assertAssetWithinLimit\(normalizedPath,\s*AssetImporter\.MAX_MODEL_SOURCE_BYTES/);
  assert.match(importerSource, /assertAssetWithinLimit\(normalizedPath,\s*AssetImporter\.MAX_TEXTURE_SOURCE_BYTES/);
  assert.match(importerSource, /assertAssetWithinLimit\(filePath,\s*AssetImporter\.MAX_AUDIO_SOURCE_BYTES/);
  assert.match(importerSource, /asset exceeds the \$\{maxBytes\}-byte import limit/);
});
