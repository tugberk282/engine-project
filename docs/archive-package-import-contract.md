# Confined Archive and Package Import Contract

- Contract version: 1
- Status: Security-reconciliation revision; implementation not authorized
- Owners: Engine/platform (Çekirdek), security review (Kalkan)
- Applies to: project asset archives and future package payloads

## Boundary and invariants

Archive bytes, entry names, metadata, package manifests, and extracted files are
untrusted. Import is a privileged main-process service reached only through a
versioned, schema-validated asynchronous command. The renderer never receives a
native path, archive library handle, writable staging path, or raw filesystem
primitive.

An import is one transaction:

```text
authorize source and destination grant
  -> snapshot source identity
  -> preflight every central-directory entry
  -> extract into a new private staging directory
  -> validate extracted tree and package manifest
  -> atomically publish into the granted project
  -> remove staging data
```

Before publish, no archive-controlled byte may appear in the project. On
rejection, cancellation, timeout, crash recovery, or shutdown, no partial
destination is visible and all run-owned staging data is removed or recorded
for startup cleanup. The service does not execute importers, scripts, package
hooks, native libraries, or generated commands.

Project and asset observation is transaction-aware. The host acquires an
import-notification suspension token before publication. The atomic rename
makes bytes visible while importer dispatch, package hooks, execution-broker
requests, and trust mutation remain suspended for that destination. It then
verifies the published identity and the zero-call security probes, commits the
transaction as data-only, releases the token, and emits one bounded
`archive-content-published` invalidation. That invalidation may schedule normal
metadata discovery only; it cannot dispatch an importer or execution path.
Failure before the data-only commit emits no notification. Watchers that cannot
honor the suspension token make import unavailable rather than observing an
intermediate or executable state.

## V1 typed capability

V1 accepts ZIP archives only. Other containers, multi-volume archives, nested
archives, encrypted entries, and password input fail closed. A source is an
opaque file capability returned by a native file picker; a destination is a
project grant plus a project-relative directory.

```ts
type ImportArchiveRequest = {
  protocolVersion: 1;
  requestId: string;             // 1..128 allowlisted ID characters
  sourceFileGrantId: string;     // exact selected file, read-only
  projectGrantId: string;
  destinationPath: string;       // normalized project-relative directory
  expectedSource?: {
    size: number;
    sha256: string;
  };
  conflictPolicy: "reject";      // only supported v1 policy
};

type ImportArchiveResult = {
  importId: string;
  archiveSha256: string;
  entryCount: number;
  fileCount: number;
  directoryCount: number;
  extractedBytes: number;
  publishedPath: string;         // project-relative
  manifest?: {
    formatVersion: number;
    packageId: string;
    packageVersion: string;
  };
};

type CancelImportRequest = {
  protocolVersion: 1;
  requestId: string;
  importId: string;
};
```

The implementation command names are reserved as `package.importArchive` and
`package.cancelImport`. Adding them to preload/main is a separate implementation
issue after TUG-50. Requests reject unknown or excess fields. Responses use the
existing protocol envelope and the stable error codes below; native paths,
library errors, stack traces, and archive-provided text are not returned.

## Fixed v1 resource limits

Limits are checked during preflight and continuously while streaming because
archive metadata is advisory.

| Limit | V1 value |
| --- | ---: |
| Source archive size | 512 MiB |
| Entries, including directories | 10,000 |
| Total extracted regular-file bytes | 2 GiB |
| Single extracted file | 512 MiB |
| Maximum path UTF-8 bytes | 1,024 |
| Maximum path segments | 128 |
| Maximum single-entry compression ratio | 100:1 |
| Maximum aggregate compression ratio | 50:1 |
| Maximum nested archive depth | 0 |
| Wall-clock duration | 5 minutes |
| Central directory bytes | 64 MiB |
| Retained parser metadata | 64 MiB |

Zero compressed bytes with non-zero declared or observed output is rejected.
Counters use overflow-safe integers and observed streamed bytes. The extractor
aborts as soon as any limit is crossed and never buffers an entire entry in
memory. Implementations must also reserve/check destination free space before
extraction and retain a safety margin of the greater of 256 MiB or 10% of the
volume; an estimate is not permission to exceed streamed limits.

All sizes, offsets, counts, and additions use checked unsigned 64-bit integers
before allocation or seek. Overflow, overlapping/aliased record ranges, records
outside the snapshotted source, or either metadata ceiling being exceeded is
`UNSUPPORTED_ARCHIVE`. Charge the entry ceiling before allocating its
name/extra/comment. Central-directory accounting includes complete records,
names, extras, and comments. Retained metadata includes decoded names,
collision keys, type evidence, offsets, and manifest bookkeeping. Streaming
buffers are fixed at no more than 1 MiB total, not per entry.

Declared limits are preflight checks; observed regular-file output, compressed
payload consumed, CRC-32, and wall time are checked while streaming. Ratios are
`observedOutput / max(1, observedCompressed)` per entry and over the aggregate.
The first byte exceeding a ceiling is not written. Trailing/premature payload,
CRC mismatch, or final declared/observed disagreement rejects the archive. All
phases share the single five-minute deadline.

## Entry-name and filesystem confinement

Each entry name is decoded strictly according to ZIP UTF-8 rules. Invalid text,
NUL/control characters, backslashes, absolute/UNC/device/drive paths, empty
segments, `.` or `..`, trailing dot/space segments, Windows reserved device
names, alternate data stream syntax (`:`), and names ending in a separator when
declared as a file are rejected.

The service converts `/`-separated names to an internal segment array; it does
not use string-prefix containment. Every segment is normalized to Unicode NFC.
The complete archive is rejected when two entries collide after NFC,
case-folding, or Windows trailing-dot/space normalization, when a file is also
an ancestor of another entry, or when the destination already exists. V1 never
renames or overwrites.

Only regular files and directories are permitted. Symlinks, junctions, hard
links, reparse points, device/FIFO/socket entries, sparse-file metadata, and
entries with platform-special type bits are rejected. ZIP extra fields may not
relax these rules.

### ZIP record and entry-type reconciliation

Locate one unambiguous EOCD/ZIP64 chain and parse the entire central directory.
For each central record open exactly its referenced local header from the same
source handle. Reject duplicate local offsets, overlapping
header/data/descriptor/central ranges, appended second archives, ambiguous EOCD
candidates, and bytes claimed by multiple entries.

For every entry:

1. Independently decode central and local raw name bytes under identical ZIP
   UTF-8/general-purpose-bit rules. Raw bytes and decoded scalars, flags,
   compression method, and security-relevant extras must agree. Reject
   encryption, patched-data, strong-encryption, and unknown critical flags.
2. Resolve ZIP64 sentinels from each record's own extra field. CRC-32 and sizes
   must agree. With data-descriptor bit 3, local CRC/sizes may only be all zero
   or exact central values; a signed descriptor is mandatory and must match.
   Without bit 3, a descriptor is forbidden.
3. Independently derive type from trailing `/`, DOS directory bit, and—when the
   creator makes Unix attributes meaningful—`S_IFMT`. Unix type must be
   `S_IFREG` or `S_IFDIR`; every other nonzero type is rejected.
4. Accept a directory only when slash and DOS directory signals both exist and
   Unix evidence is absent or `S_IFDIR`. Accept a file only when both directory
   signals are absent and Unix evidence is absent or `S_IFREG`. Any mismatch is
   `UNSUPPORTED_ENTRY_TYPE`; unknown creator attributes never grant a type.

Directories have zero CRC/sizes and no payload. Duplicate central names reject.

### Deterministic Windows/Unicode collision key

V1 pins Unicode 15.1 Default Case Folding and never uses locale-sensitive host
conversion:

```text
segmentKey = NFC(unicode15_1_full_default_casefold(NFC(segment)))
pathKey = UTF8(segmentKey[0]) || 0x2f || ... || UTF8(segmentKey[n])
```

Validation rejects trailing U+0020/U+002E, controls, colons, empty/dot segments,
and reserved DOS basenames after the same fold and before any extension. Reject
equal path keys, a file key that prefixes another at a segment boundary, or
explicit/implicit directory disagreement. Vendor the pinned table and fixture
digest; locale, host Unicode, NTFS case mode, and 8.3 aliases cannot alter it.
The required source is Unicode 15.1.0 `CaseFolding.txt`, exactly 84,870 bytes,
with SHA-256
`4e55acfdc32825a22e87670e9056a3bf94ad7c5400065778e9e10f8314372bcf`.
Only status C and F mappings form the full default fold; T mappings are
excluded.

Staging is on the destination volume, outside renderer/project control, beneath
a host-owned root whose ACL grants only the service identity and administrators.
Windows requires a reviewed native helper; path-based Node/Electron calls are
not a fallback. The helper holds root/parent directory handles. Every traversal
and exclusive create is NT handle-relative (`RootDirectory`) with no-follow
semantics (`OBJ_DONT_REPARSE`, `FILE_OPEN_REPARSE_POINT` as applicable). After
each open it checks `FileAttributeTagInfo`, file identity, and volume identity,
rejecting reparse tags or changes.

Immediately before publish, revalidate the live grant, destination-parent handle
chain, destination absence, staging and marker identity, and volume. Publish is
one handle-relative no-replace operation equivalent to `FileRenameInfoEx`.
Missing primitives/flags, invalid case mode, or copy/delete/path-rename fallback
is `ATOMIC_PUBLISH_UNAVAILABLE`. Hold the staging handle and verify destination
identity before reporting success.

The source file is opened once through its exact-file grant. Its handle identity,
size, and SHA-256 are captured; the same handle is used for preflight and
extraction. A changed/replaced source, or mismatch with `expectedSource`, fails
before publish.

## Package manifest policy

An archive without a package manifest is an asset bundle and remains subject to
all confinement rules. If `tugberk-package.json` exists it must be a unique,
top-level regular file, UTF-8 JSON no larger than 256 KiB, with duplicate JSON
keys rejected. Its schema is versioned and rejects unknown security-sensitive
fields.

V1 manifest metadata may describe package identity, version, content roots, and
engine compatibility. Any script, hook, executable, native-library,
postprocessor, external URL, absolute path, or dependency source outside the
archive is rejected. Import never implies project trust or execution approval;
future package activation must pass the separate trust-gated execution broker.

## State, cancellation, recovery, and diagnostics

The state machine is deterministic:

```text
queued -> preflighting -> extracting -> validating -> publishing -> succeeded
   \---------- cancel/failure/timeout ----------> cleaning -> terminal
```

Cancellation is cooperative before `publishing`. Once the atomic rename begins,
the operation completes and reports success; it is never reported cancelled
after content became visible. Exactly one terminal response is emitted.
Shutdown stops intake, cancels active work, closes handles, and cleans staging.
Before archive writes, exclusively create a marker with canonical CBOR payload:

```text
{ markerVersion: 1, contractVersion: 1, importId, runNonce[32],
  stagingVolumeId, stagingFileId, stagingRootFileId,
  destinationParentVolumeId, createdAtUnixMs, deadlineUnixMs }
```

Authenticate it as `HMAC-SHA-256(cleanupKey, canonicalCborPayload)`.
`cleanupKey` is a random 32-byte per-install secret protected by Windows DPAPI
for the service identity, never logged, sent over IPC, or stored in staging.
Import IDs are unique 128-bit values; nonces use the OS CSPRNG. Flush marker and
authenticated active-import journal before extraction.

Startup enumerates only direct children of the ACL-validated staging root by
handle. It opens no-follow, rejects reparse points, reads at most 4 KiB, checks
canonical encoding and HMAC in constant time, and matches live root/volume/file
identities. Expiry requires `now > deadlineUnixMs`, absence from the
authenticated active journal, and no live lease for `runNonce`. Clock rollback
or DPAPI/journal/lease uncertainty preserves the candidate and emits
`IMPORT_CLEANUP_FAILED`. Deletion is handle-relative, bottom-up, no-follow, and
aborts on identity change. Invalid/forged markers are preserved; age, prefix,
glob, or broad-root sweeping is forbidden.

Structured diagnostics include import/request ID, state transitions, durations,
counts, observed byte totals, archive digest, outcome, and stable error code.
They exclude source/destination native paths, entry names, manifest contents,
file contents, and credentials. Progress events are rate-limited and contain
only counts/bytes.

Stable v1 errors:

`IMPORT_UNAUTHORIZED`, `SOURCE_CHANGED`, `UNSUPPORTED_ARCHIVE`,
`ENCRYPTED_ARCHIVE`, `INVALID_ENTRY_NAME`, `UNSUPPORTED_ENTRY_TYPE`,
`ENTRY_COLLISION`, `LIMIT_ARCHIVE_BYTES`, `LIMIT_ENTRY_COUNT`,
`LIMIT_ENTRY_BYTES`, `LIMIT_TOTAL_BYTES`, `LIMIT_COMPRESSION_RATIO`,
`INSUFFICIENT_SPACE`, `INVALID_PACKAGE_MANIFEST`, `DESTINATION_CONFLICT`,
`PATH_OUTSIDE_GRANT`, `GRANT_REVOKED`, `IMPORT_CANCELLED`, `IMPORT_TIMEOUT`,
`ATOMIC_PUBLISH_UNAVAILABLE`, `IMPORT_IO_FAILED`, and `IMPORT_CLEANUP_FAILED`.

## Acceptance tests for the implementation issue

1. A valid ZIP imports byte-for-byte into a new project-relative directory and
   returns deterministic counts and SHA-256.
2. Absolute, drive, UNC, mixed-separator, NUL, dot-segment, reserved-device,
   trailing-dot/space, ADS, overlong, and invalid-Unicode names are rejected.
3. NFC/case-fold collisions, file/child conflicts, duplicate entries, and an
   existing destination reject the whole transaction without overwrite.
4. Symlink, junction/reparse, hard-link, device, FIFO, socket, and sparse entries
   are rejected on every supported host.
5. Forged size metadata, integer overflow, zero-compressed expansion,
   per-entry/aggregate ratio bombs, too many entries, oversized files, and
   aggregate expansion abort during streaming at the stated limits.
6. Source replacement between authorization and extraction, destination link
   swaps, grant revocation, and destination creation races cannot escape the
   grant or overwrite content.
7. Cancellation in preflight/extraction/validation, timeout, malformed ZIP,
   disk-full, permission failure, process crash, and shutdown leave no published
   partial tree; startup cleanup removes only authenticated stale staging.
8. Cancellation racing atomic publish yields exactly one truthful terminal
   outcome: cancelled before visibility or success after visibility.
9. Encrypted, nested, multi-volume, and non-ZIP inputs fail closed; archive and
   package contents never execute during import.
10. Manifest duplicate keys, oversize, unsupported schema, hooks/native code,
    external sources, and traversal references fail closed.
11. Renderer IPC rejects malformed/excess fields and never exposes native paths,
    stacks, raw filesystem access, or archive-library objects.
12. Logs and progress remain bounded and contain no entry names, paths, manifest
    content, or extracted bytes.
13. Header, ZIP64, descriptor, and type disagreements reject before writes.
14. Unicode 15.1 fold/NFC collision fixtures are host-independent.
15. Missing native primitives and reparse/identity swaps fail closed.
16. Forged/copied markers and uncertain state are preserved; only an
    authenticated expired orphan is deleted.

`test/fixtures/archive-import-contract-v1.json` is the versioned executable
fixture specification. Its builder operations are pure byte-level ZIP
construction/mutation recipes; integer fields are little-endian and scalar
lists are explicit Unicode code points. Each case supplies arrange, action, and
observable assertions. A conforming implementation test runner must implement
the named builder/helper operations without consulting host locale or Unicode
tables, verify the pinned corpus digest before running, and attach spies for
filesystem writes/publish, importer dispatch, package hooks, execution-broker
calls, trust mutation, and notifications. Unknown schema fields or operations
fail the fixture harness. The fixture IDs, recipes, phases, errors, counters,
and invariants are normative.

### Normative fixture builder and runner

Schema v2 is closed: a case has exactly `id`, `phase`, `arrange`, `action`,
`assert`, and `archiveSha256`; `arrange` has only `operations`; an operation has
only `op` and, except for the three argument-free operations, `args`; `action`
has only `op`. Unknown or missing fields fail before construction. JSON objects
used in a builder image are serialized with keys in ascending Unicode code
point order, no insignificant whitespace, UTF-8, and JSON scalar escaping.

`zip.create` starts an empty single-disk ZIP. Each `zip.addEntry` appends a
stored local record (`0x04034b50`, version 20), the UTF-8 name constructed from
`nameScalars`, and `payloadHex`, then a matching central record
(`0x02014b50`, version 20) with its exact local offset. `repeat` emits that many
records; `uniqueSuffix` appends ASCII `-<zero-based-index>`. CRC fields remain
zero because these images are adversarial parser inputs, not successful general
ZIP examples. The builder applies every ZIP mutation to the in-memory record
model, serializes the resulting local records, central directory, and one EOCD
(`0x06054b50`) with an empty comment, then computes `archiveSha256` over those
final bytes. Those exact hashed bytes, not a serialized mutation recipe, are
supplied to the implementation adapter. Platform, cleanup, clock, and observer
operations configure injected capabilities and are authenticated by the
version-controlled closed fixture document rather than embedded in the ZIP.

Mutation bytecode has these exact effects: `setCentral*`/`setLocal*` replace the
named fixed-width header field; scalar-name setters replace name bytes and
length; `setZip64Sizes` writes `0xffffffff` sentinels plus ZIP64 values;
`setDescriptor` appends the signed or unsigned descriptor with the supplied
CRC/sizes and sets bit 3; `aliasLocalOffset` copies the selected central local
offset; `overlapDataRange` subtracts `overlapBytes` from the selected offset;
DOS directory toggles external bit 4; Unix mode writes the supplied octal mode
to the high external-attribute word; declared sizes replace both size fields;
payload generators are bounded virtual streams and never allocate their
declared length. Platform, cleanup, clock, and observer operations configure
the runner and do not alter ZIP records. Decimal size strings are unsigned
64-bit integers; hex is lowercase, even-length bytes; entry indices are
zero-based; unknown enum values, overflow, or out-of-range indices fail the
fixture.

The contract runner must construct and hash every final mutated image, reject schema
mutations (unknown/missing fields, operation, argument, or wrong digest), then
invoke the implementation through injected capabilities. The success case
installs callbacks that throw if importer dispatch, package hooks,
execution-broker calls, or trust mutation occurs; observes watcher suspension,
publish, identity verification, data-only commit, release, and the single
notification in exact order; and reads the destination through the published
handle to compare exact bytes. A seeded run is repeated for each forbidden
callback so a missing spy cannot pass as a zero count.

The executable harness interface is
`adapter.importArchive({ archiveBytes, request, capabilities })`. The adapter is
the system under test: it must parse `archiveBytes` and perform publication only
through the supplied staging, watcher, publish, notification, importer, hook,
execution-broker, and trust capabilities. A harness must not append expected
events, write destination bytes, or invoke security probes on the adapter's
behalf. The contract suite may ship a deliberately small reference adapter to
validate the harness wiring before production exists; that adapter is test-only,
accepts only the valid stored-ZIP success corpus, parses the supplied bytes, and
uses the same injected boundaries. Production approval still requires running
the identical harness against the assigned implementation adapter.

## Security review gate

Kalkan must approve the entry-type detection, platform path normalization,
no-follow/handle-based containment, source/destination race defenses, cleanup
marker design, and adversarial fixture matrix before implementation is merged.
Any relaxation of a fixed limit, overwrite policy, supported format, entry type,
or atomic-publish invariant requires a contract revision and security review.
