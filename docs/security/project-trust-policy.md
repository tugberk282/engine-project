# Project Trust and Code Execution Policy

## Security boundary

A project directory, every asset below it, package metadata, imported archive, C# source,
generated code, native library, editor extension, and build hook is untrusted until the
user explicitly trusts the canonical project identity.

Project identity is the operating system's canonical real path:

- relative segments and directory aliases are resolved before lookup;
- symlink/junction aliases cannot create a second trust identity;
- Windows identities are compared case-insensitively;
- trust is stored outside the project under Electron `userData`, so project contents
  cannot grant themselves trust.

Selecting or reopening a project does not itself grant trust. Legacy stored path arrays
are migrated through canonicalization.

## Safe mode (default for unknown or revoked projects)

Safe mode permits bounded reads inside the selected canonical root so the editor can
inspect scenes and assets. The main process denies project-root writes, creates,
renames, and deletes. Exact files independently selected through native import/export
dialogs retain only their one-file capability.

Safe mode must not execute project-controlled code. This includes C#/TypeScript scripts,
packages and package lifecycle hooks, editor plugins, native libraries, asset importer
executables, post-processors, build hooks, or generated commands. The current engine
does not dynamically load those classes from an opened project; future execution
features must check the main-process trust state immediately before execution and must
have a regression test proving denial in safe mode.

Data-only parsing and built-in engine components remain available. Parsers must retain
size limits, schema validation, canonical output paths, and no-follow filesystem checks.

## Consent, revocation, and re-consent

The native trust prompt describes the write and code-execution consequences and defaults
to **Open in Safe Mode**. Trust changes are keyed to canonical identity and persisted
atomically. A trusted project may write inside its canonical root and may use separately
implemented execution features.

Revocation immediately downgrades the live root capability to read-only safe mode and
persists that decision. The main-process trust-gated execution broker aborts matching
script, plugin, importer, and build operations and waits for executor cleanup before
revocation is acknowledged. Re-enabling write or execution requires the native trust
prompt again.

## Execution broker contract

All project-controlled execution enters through `TrustGatedExecutionBroker`; renderers
must never spawn a worker or process directly. Requests contain exactly a canonicalizable
project path, one of `script | plugin | importer | build`, a project-relative entrypoint,
and a bounded string argument array. Absolute paths, traversal, unknown fields, oversized
arguments, unknown execution kinds, and untrusted projects fail before executor dispatch.

Executors are main-process-owned adapters. They receive an immutable canonical project
root, resolved entrypoint, operation identity, arguments, and an `AbortSignal`. They must
confine any worker/process filesystem access to the supplied root, terminate their whole
process tree on abort, and settle only after cleanup. Missing adapters fail closed with
`EXECUTOR_UNAVAILABLE`; registration is not inferred from project contents.

Moving or replacing a project so that its canonical path changes produces an unknown,
safe-mode identity. Path identity does not detect in-place content replacement; release
integrity and package lock verification are separate controls and must not be represented
as project trust.

## Verification requirements

Security regression coverage must prove:

1. canonical aliases resolve to one identity;
2. unknown and revoked projects enter safe mode;
3. safe mode reads work while writes fail in the main-process capability layer;
4. explicit consent enables writes and persists atomically;
5. revocation persists and downgrades the active capability;
6. each future script, plugin, package, importer, build, and native-code execution entry
   point fails closed when the project is not trusted.
