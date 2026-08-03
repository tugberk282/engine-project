# Editor scene workflow baseline

The first editor workflow is functional across the launcher, hierarchy, inspector,
command history, and canonical scene persistence.

## Supported baseline

- Create or open a project from the launcher and work in its `Assets` scene files.
- Create, rename, duplicate, delete, parent, and unparent GameObjects in the
  hierarchy.
- Keep one active selection (plus an ordered multi-selection) synchronized across
  the hierarchy, inspector, scene outline, and transform gizmo.
- Undo and redo hierarchy mutations through `CommandHistory`. Destructive undo is
  non-destructive in memory so object identity, children, components, and ordering
  can be restored.
- Save and reopen the same versioned scene representation. Scene and GameObject
  identifiers remain stable across the round trip.

## Unity-parity boundary

The interaction model intentionally follows Unity's core scene workflow: the
Hierarchy owns tree navigation, the Inspector follows the active object, and
structural edits participate in a shared undo history.

This baseline does not claim full Unity parity. Prefab-stage isolation, multi-scene
editing, serialized undo across editor restarts, and every Unity hierarchy edge
case remain later roadmap work. The current guarantee is the smallest complete
create/edit/undo/save/reopen loop for one project and one canonical scene.

## Verification

Run:

```powershell
npm run test:editor-workflow
npm run test:persistence
npm run build
```

The workflow contract checks command routing, centralized selection synchronization,
and versioned scene persistence. The persistence suite exercises deterministic
round trips, stable IDs, migration, atomic save, and recovery.
