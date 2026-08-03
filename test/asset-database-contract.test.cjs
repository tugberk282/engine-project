const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const databaseSource = fs.readFileSync(path.join(root, 'src/engine/AssetDatabase.ts'), 'utf8');
const importerSource = fs.readFileSync(path.join(root, 'src/engine/AssetImporter.ts'), 'utf8');

test('asset metadata has a versioned, GUID-backed importer contract', () => {
  assert.match(databaseSource, /formatVersion:\s*number/);
  assert.match(databaseSource, /guid:\s*string/);
  assert.match(databaseSource, /interface AssetMetaImporter/);
  assert.match(databaseSource, /version:\s*number/);
  assert.match(databaseSource, /settings:\s*Record<string,\s*string \| number \| boolean>/);
  assert.match(databaseSource, /crypto\.randomUUID\(\)/);
  assert.match(databaseSource, /const metaPath = `\$\{assetPath\}\.meta`/);
  assert.match(databaseSource, /await this\.fs\.rename\(temporaryPath,\s*metaPath\)/);
});

test('refresh detects source and metadata invalidation and preserves moves by GUID', () => {
  assert.match(databaseSource, /assetMTimeMs/);
  assert.match(databaseSource, /metaSignature/);
  assert.match(databaseSource, /metaContentChanged/);
  assert.match(databaseSource, /previousGuidToPath\.forEach/);
  assert.match(databaseSource, /moved\.push\(\{\s*guid,\s*from:\s*oldPath,\s*to:\s*nextPath\s*\}\)/);
});

test('dependency graph supports direct and transitive invalidation queries', () => {
  assert.match(databaseSource, /rebuildDependencyGraph\(\)/);
  assert.match(databaseSource, /getDependencyPaths\(/);
  assert.match(databaseSource, /getReferencerPaths\(/);
  assert.match(databaseSource, /getDependencyClosurePaths\(/);
  assert.match(databaseSource, /getReferencerClosurePaths\(/);
  assert.match(databaseSource, /collectGuidClosure\(/);
});

test('minimal texture importer consumes deterministic metadata settings', () => {
  assert.match(databaseSource, /case 'texture':/);
  assert.match(databaseSource, /maxSize:\s*2048/);
  assert.match(importerSource, /getImporterSettings\(normalizedPath,\s*'texture'\)/);
  assert.match(importerSource, /texture\.wrapS\s*=/);
  assert.match(importerSource, /texture\.minFilter\s*=/);
  assert.match(importerSource, /texture\.userData\.importSettings\s*=/);
});
