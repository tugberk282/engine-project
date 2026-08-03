# Project and scene persistence

Project, scene, and prefab documents have independent integer `formatVersion`
fields and are registered by document kind in one schema registry.
Version 1 project documents contain a stable `projectId`, display `name`, and
scene index. Version 1 scene documents contain a stable `sceneId`, display
`name`, the existing engine schema `version`, environment, and game objects.
Game-object IDs remain authoritative and are never regenerated on load or edit.

Serialization recursively sorts object keys, preserves array order, uses
two-space JSON indentation, and ends with one newline. Writes create and fsync a
sibling `.tmp`, retain the previous generation as `.bak`, then rename the
temporary file over the target. A corrupt or missing primary is restored from a
validated backup; an abandoned `.tmp` is never treated as committed.

Migrations are pure, forward-only, one-version-at-a-time functions in
`electron/architecture/persistence.js`. Unknown additive fields are retained.
A legacy document without
`formatVersion` is treated as version 0, migrated to version 1, validated, and
atomically rewritten while retaining the pre-migration source as a backup.
Documents newer than the supported version are rejected rather than guessed.

All persistence failures expose a stable `PersistenceError.code`. Canonicalization
rejects cycles and non-finite numbers, normalizes negative zero, and normalizes
project scene paths to `/` independent of the host platform. Durable writes
return a SHA-256 revision and may require an expected revision to prevent stale
writers. Runtime snapshots remove top-level `editorState` and carry a stable
replay hash derived from canonical bytes.
