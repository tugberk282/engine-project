# ADR-0002: Confined archive and package import

- Status: Revised after TUG-65 change request; awaiting independent approval
- Date: 2026-07-28
- Owners: Engine/platform (Çekirdek), security approval (Kalkan)
- Related: TUG-47, TUG-50, TUG-65, TUG-68 (superseded by TUG-72), ADR-0001

## Context

Asset and package archives combine attacker-controlled paths, metadata, sizes,
compression, and optional executable content. Extracting directly into a
project would let traversal, link entries, path aliasing, decompression bombs,
source/destination races, partial failure, or package hooks cross the project
grant and renderer trust boundaries established by ADR-0001.

TUG-50 currently owns overlapping Electron/filesystem implementation. This ADR
therefore defines the non-overlapping contract and leaves code changes to a
separately assigned implementation issue.

## Decision

Adopt the v1 contract in
`docs/archive-package-import-contract.md`.

The trusted host exposes one typed asynchronous import capability. V1 supports
ZIP only, reads an exact-file capability, performs complete preflight, streams
into a private same-volume staging directory under fixed byte/count/ratio/time
limits, rejects links and filesystem-special entries, validates the final tree
and optional declarative manifest, then atomically renames to a new
grant-relative destination.

Import never overwrites, merges, executes content, grants trust, or activates a
package. Cancellation and failure clean staging and cannot produce a partial
project tree. Source and destination identities are revalidated using open
handles/canonical grants to close time-of-check/time-of-use races.

Publication is ordered behind a host-owned transaction suspension token.
Project/asset watchers cannot dispatch importers, hooks, execution-broker
requests, or trust changes while the rename and identity verification occur.
After zero-call probes pass, the host commits a data-only transaction, releases
the token, and emits one bounded discovery invalidation. A watcher stack that
cannot provide this boundary disables archive import fail-closed.

Four controls are normative: algorithmic central/local ZIP header and type
reconciliation; collision keys using pinned Unicode 15.1 full default folding
plus NFC; native Windows handle-relative, reparse-safe staging and no-replace
atomic publish; and an identity-bound canonical cleanup marker authenticated by
a DPAPI-protected per-install HMAC key. Checked parser/stream counters enforce
fixed metadata, memory, byte, ratio, count, and time ceilings.

## Consequences

The first version intentionally rejects archives Unity or common ZIP tools may
otherwise accept: encrypted/multi-volume/non-ZIP archives, nested archives,
links, case or Unicode aliases, overwrite/merge imports, executable manifests,
and destinations without atomic same-volume publication. Users must resolve
conflicts explicitly outside the importer.

This narrower feature is predictable, testable, portable to the current Windows
target, and compatible with later macOS/Linux qualification. ZIP parsing and
filesystem work remain privileged and reviewable; renderer compromise does not
gain an extraction primitive.

If the native helper or secure key/journal facilities are unavailable, import
remains unavailable with a stable error. There is no weaker compatibility path,
and cleanup favors preservation over unsafe deletion.

Imports need temporary disk space up to the expanded payload plus safety margin.
A successful import may still require later asset-database validation; such
validation does not retroactively execute package content or broaden trust.

## Alternatives rejected

- **Extract directly into `Assets`.** Partial failure and traversal/race bugs
  become visible project mutations.
- **Sanitize or rename unsafe entries.** Aliases and collisions become
  platform-dependent and can silently change package meaning.
- **Trust library path checks alone.** Archive libraries do not enforce the
  engine's grant, Unicode, Windows alias, link, quota, or publish invariants.
- **Allow symlinks confined by lexical resolution.** Link targets and directory
  swaps create a second mutable namespace and TOCTOU escape surface.
- **Use renderer-side extraction.** This grants untrusted UI code filesystem
  authority and weakens IPC isolation.
- **Treat package import as consent to execute.** Provenance and storage are not
  project trust; execution belongs to the separate trust-gated broker.

## Compatibility and evolution

The archive contract has an independent integer version. Additive optional
response telemetry may remain v1; accepting a new container, entry type,
conflict mode, executable manifest field, or weaker limit requires a new
reviewed contract version. Implementations may tighten emergency limits
fail-closed, provided the effective limits are exposed in diagnostics and the
contract is promptly revised.

The implementation sequence is: Kalkan approval of the reconciled TUG-72
revision and its executable fixture schema;
focused service and
adversarial-fixture issue after TUG-50 no longer overlaps; typed IPC exposure;
platform qualification; then any UI workflow. No Electron, preload, filesystem,
or archive-library implementation is part of this ADR issue.

Fixture schema v2 uses a closed JSON schema, a deterministic stored-ZIP
envelope with mutations applied to the final bytes and a per-case SHA-256. Its
instrumented runner must observe the publish boundary and exact destination
bytes and must seed every forbidden security callback. Declarative expected
counters or an expected-event synthesizer do not satisfy this decision. The
same injected adapter interface is used first with the test-only reference
adapter to prove harness wiring and later with the production importer; only
the latter can authorize production implementation.

## Acceptance

ADR acceptance requires Kalkan to review the six security gates named in the
contract and confirm the fixed limits and adversarial acceptance-test matrix.
Approval must explicitly close all four TUG-65 change requests.
Implementation is not production-approved until every contract test passes on
the supported packaged Windows target and cleanup/failure-path evidence is
attached to its issue.
