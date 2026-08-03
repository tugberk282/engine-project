# Asset database foundation

`AssetDatabase` is the editor-owned index for project assets. Each asset and
folder receives a sibling `<name>.meta` JSON file. The metadata format is
versioned independently from importer versions:

- `formatVersion` describes the metadata envelope (currently `1`).
- `guid` is the stable identity used by scenes, prefabs, materials, and runtime
  components. Moving an asset together with its `.meta` file preserves identity.
- `assetType` and `fileExtension` are normalized from the source.
- `importer.name`, `importer.version`, and primitive `importer.settings` form the
  deterministic import contract.

## Refresh and invalidation

`refresh(rootPath)` scans assets in a stable lexical order, repairs malformed or
duplicate metadata, and rebuilds both GUID maps and the dependency graph. Source
mtime/size plus the normalized metadata signature form the cache fingerprint.
The refresh result reports added, removed, changed, metadata-changed, repaired,
orphaned, and GUID-preserving moved assets.

JSON-backed scenes, prefabs, materials, and scriptable objects contribute
dependencies through `*Guid` and `*Path` properties. Callers can query direct or
transitive dependencies and reverse referencers. This lets a changed source
invalidate its imported artifact and every dependent without rebuilding
unrelated assets.

## Minimal deterministic importer

The texture importer is the canonical first importer. Its behavior is controlled
by normalized metadata settings (`sRGB`, alpha handling, wrap mode, filter mode,
and maximum size), and records the applied settings on the imported texture.
Given the same source bytes, importer version, and normalized settings, it
produces the same runtime configuration.

Changing importer output semantics requires incrementing `importer.version`.
Changing the metadata envelope requires incrementing `formatVersion` and adding
an explicit migration before old metadata is rewritten.

## Verification

Run:

```powershell
node --test test/asset-database-contract.test.cjs
```

The contract test guards stable GUID metadata, refresh invalidation, dependency
closure APIs, and the texture importer's settings application.
