const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const contract = fs.readFileSync(path.join(root, 'docs/archive-package-import-contract.md'), 'utf8');
const adr = fs.readFileSync(path.join(root, 'docs/architecture/ADR-0002-confined-archive-import.md'), 'utf8');
const fixturePath = path.join(__dirname, 'fixtures/archive-import-contract-v1.json');
const matrix = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const errors = new Set([...contract.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((match) => match[1]));

const CASE_FIELDS = ['action', 'archiveSha256', 'arrange', 'assert', 'id', 'phase'];
const ASSERT_FIELDS = new Set([
  'candidateExists', 'collisionKeyScalars', 'deletedCandidateCount', 'deletedSiblingCount',
  'destinationSentinelHex', 'error', 'eventOrder', 'maxBufferBytes', 'maxRetainedBytes',
  'maxWrittenRegularBytes', 'notificationPayload', 'publishedFile', 'spyCounters', 'terminalState'
]);
const ARG_FIELDS = {
  'zip.addEntry': ['centralCommentGenerator', 'nameScalars', 'payloadHex', 'repeat', 'uniqueSuffix'],
  'zip.setCentralNameScalars': ['entry', 'scalars'],
  'zip.setLocalNameScalars': ['entry', 'scalars'],
  'zip.setCentralFlags': ['entry', 'value'],
  'zip.setLocalFlags': ['entry', 'value'],
  'zip.setCentralMethod': ['entry', 'value'],
  'zip.setLocalMethod': ['entry', 'value'],
  'zip.setZip64Sizes': ['central', 'entry', 'local'],
  'zip.setDescriptor': ['compressed', 'crc32Hex', 'entry', 'signed', 'uncompressed'],
  'zip.aliasLocalOffset': ['entry', 'sourceEntry'],
  'zip.overlapDataRange': ['entry', 'overlapBytes', 'withEntry'],
  'zip.setDosDirectory': ['entry', 'value'],
  'zip.setUnixMode': ['entry', 'valueOctal'],
  'zip.setDeclaredSizes': ['compressed', 'entry', 'uncompressed'],
  'zip.setPayloadGenerator': ['byteHex', 'entry', 'observedOutput'],
  'platform.scheduleIdentitySwap': ['at', 'replacement', 'target'],
  'platform.scheduleDestinationCreate': ['at', 'sentinelHex'],
  'cleanup.createCandidate': ['expired', 'journal', 'lease'],
  'cleanup.mutateMac': ['xorByteIndex', 'xorHex'],
  'cleanup.copyMarker': ['toDifferentFileId'],
  'cleanup.setJournalState': ['state'],
  'cleanup.setLeaseState': ['nonceMatches', 'state'],
  'clock.setSequence': ['unixMs'],
  'observer.requireSuspensionToken': ['from', 'through']
};
const ARG_FREE = new Set(['zip.create', 'platform.disableNativeHelper', 'observer.installSecuritySpies']);

function exactKeys(value, expected, label) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), label);
}

function scalars(values) {
  return Buffer.from(values.map((value) => String.fromCodePoint(Number.parseInt(value.slice(2), 16))).join(''), 'utf8');
}

function u32(value, label) {
  const parsed = BigInt(value);
  assert.ok(parsed >= 0n && parsed <= 0xffffffffn, `${label}: uint32`);
  return Number(parsed);
}

function u64(value, label) {
  const parsed = BigInt(value);
  assert.ok(parsed >= 0n && parsed <= 0xffffffffffffffffn, `${label}: uint64`);
  return parsed;
}

function zip64Extra(compressed, uncompressed) {
  const extra = Buffer.alloc(20);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(16, 2);
  extra.writeBigUInt64LE(u64(uncompressed, 'ZIP64 uncompressed'), 4);
  extra.writeBigUInt64LE(u64(compressed, 'ZIP64 compressed'), 12);
  return extra;
}

function parseHex(value, bytes, label) {
  assert.match(value, /^[a-f0-9]+$/, `${label}: lowercase hex`);
  assert.equal(value.length, bytes * 2, `${label}: width`);
  return Number.parseInt(value, 16);
}

function createModel(fixture) {
  assert.ok(fixture.arrange.operations.some((operation) => operation.op === 'zip.create'), fixture.id);
  const entries = [];
  for (const operation of fixture.arrange.operations) {
    if (operation.op !== 'zip.addEntry') continue;
    const repeat = operation.args.repeat || 1;
    for (let index = 0; index < repeat; index += 1) {
      const suffix = operation.args.uniqueSuffix ? Buffer.from(`-${index}`, 'ascii') : Buffer.alloc(0);
      const name = Buffer.concat([scalars(operation.args.nameScalars), suffix]);
      entries.push({
        localName: name, centralName: name, payload: Buffer.from(operation.args.payloadHex || '', 'hex'),
        localFlags: 0, centralFlags: 0, localMethod: 0, centralMethod: 0,
        localCompressed: null, localUncompressed: null, centralCompressed: null, centralUncompressed: null,
        localExtra: Buffer.alloc(0), centralExtra: Buffer.alloc(0), descriptor: null,
        externalAttributes: 0, offsetMode: null, payloadGenerator: null,
        centralComment: operation.args.centralCommentGenerator
          ? Buffer.alloc(operation.args.centralCommentGenerator.length,
            parseHex(operation.args.centralCommentGenerator.byteHex, 1, 'central comment byte'))
          : Buffer.alloc(0)
      });
    }
  }
  return entries;
}

function entryAt(entries, args, label) {
  assert.ok(Number.isInteger(args.entry) && args.entry >= 0 && args.entry < entries.length, `${label}: entry`);
  return entries[args.entry];
}

function applyMutation(entries, operation) {
  const args = operation.args;
  if (!operation.op.startsWith('zip.') || operation.op === 'zip.create' || operation.op === 'zip.addEntry') return;
  const entry = entryAt(entries, args, operation.op);
  switch (operation.op) {
    case 'zip.setCentralNameScalars': entry.centralName = scalars(args.scalars); break;
    case 'zip.setLocalNameScalars': entry.localName = scalars(args.scalars); break;
    case 'zip.setCentralFlags': entry.centralFlags = args.value; break;
    case 'zip.setLocalFlags': entry.localFlags = args.value; break;
    case 'zip.setCentralMethod': entry.centralMethod = args.value; break;
    case 'zip.setLocalMethod': entry.localMethod = args.value; break;
    case 'zip.setZip64Sizes':
      entry.centralCompressed = 0xffffffff; entry.centralUncompressed = 0xffffffff;
      entry.localCompressed = 0xffffffff; entry.localUncompressed = 0xffffffff;
      entry.centralExtra = zip64Extra(args.central.compressed, args.central.uncompressed);
      entry.localExtra = zip64Extra(args.local.compressed, args.local.uncompressed);
      break;
    case 'zip.setDescriptor': {
      entry.localFlags |= 8; entry.centralFlags |= 8;
      const descriptor = Buffer.alloc(args.signed ? 16 : 12);
      let cursor = 0;
      if (args.signed) { descriptor.writeUInt32LE(0x08074b50, cursor); cursor += 4; }
      descriptor.writeUInt32LE(parseHex(args.crc32Hex, 4, 'descriptor CRC'), cursor);
      descriptor.writeUInt32LE(u32(args.compressed, 'descriptor compressed'), cursor + 4);
      descriptor.writeUInt32LE(u32(args.uncompressed, 'descriptor uncompressed'), cursor + 8);
      entry.descriptor = descriptor;
      break;
    }
    case 'zip.aliasLocalOffset':
      assert.ok(Number.isInteger(args.sourceEntry) && entries[args.sourceEntry], 'alias sourceEntry');
      entry.offsetMode = {type: 'alias', sourceEntry: args.sourceEntry};
      break;
    case 'zip.overlapDataRange':
      assert.ok(Number.isInteger(args.withEntry) && entries[args.withEntry], 'overlap withEntry');
      assert.ok(Number.isInteger(args.overlapBytes) && args.overlapBytes > 0, 'overlap bytes');
      entry.offsetMode = {type: 'overlap', withEntry: args.withEntry, overlapBytes: args.overlapBytes};
      break;
    case 'zip.setDosDirectory':
      entry.externalAttributes = args.value
        ? entry.externalAttributes | 0x10
        : entry.externalAttributes & ~0x10;
      break;
    case 'zip.setUnixMode':
      entry.externalAttributes = ((Number.parseInt(args.valueOctal, 8) & 0xffff) << 16) |
        (entry.externalAttributes & 0xffff);
      break;
    case 'zip.setDeclaredSizes':
      entry.localCompressed = entry.centralCompressed = u32(args.compressed, 'declared compressed');
      entry.localUncompressed = entry.centralUncompressed = u32(args.uncompressed, 'declared uncompressed');
      break;
    case 'zip.setPayloadGenerator':
      parseHex(args.byteHex, 1, 'generator byte');
      entry.payloadGenerator = {byteHex: args.byteHex, observedOutput: u64(args.observedOutput, 'observed output')};
      break;
    default: throw new Error(`unimplemented ZIP operation: ${operation.op}`);
  }
}

function buildArchive(fixture) {
  if (!fixture.arrange.operations.some((operation) => operation.op === 'zip.create')) return null;
  const entries = createModel(fixture);
  fixture.arrange.operations.forEach((operation) => applyMutation(entries, operation));
  const locals = [];
  const layouts = [];
  let offset = 0;
  for (const entry of entries) {
    const compressed = entry.localCompressed ?? entry.payload.length;
    const uncompressed = entry.localUncompressed ?? entry.payload.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.localFlags, 6); local.writeUInt16LE(entry.localMethod, 8);
    local.writeUInt32LE(compressed, 18); local.writeUInt32LE(uncompressed, 22);
    local.writeUInt16LE(entry.localName.length, 26); local.writeUInt16LE(entry.localExtra.length, 28);
    const bytes = Buffer.concat([local, entry.localName, entry.localExtra, entry.payload,
      entry.descriptor || Buffer.alloc(0)]);
    layouts.push({offset, dataStart: offset + 30 + entry.localName.length + entry.localExtra.length,
      dataEnd: offset + 30 + entry.localName.length + entry.localExtra.length + entry.payload.length});
    locals.push(bytes); offset += bytes.length;
  }
  const centrals = entries.map((entry, index) => {
    const compressed = entry.centralCompressed ?? entry.payload.length;
    const uncompressed = entry.centralUncompressed ?? entry.payload.length;
    let localOffset = layouts[index].offset;
    if (entry.offsetMode?.type === 'alias') localOffset = layouts[entry.offsetMode.sourceEntry].offset;
    if (entry.offsetMode?.type === 'overlap') {
      localOffset = layouts[entry.offsetMode.withEntry].dataEnd - entry.offsetMode.overlapBytes;
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.centralFlags, 8); central.writeUInt16LE(entry.centralMethod, 10);
    central.writeUInt32LE(compressed, 20); central.writeUInt32LE(uncompressed, 24);
    central.writeUInt16LE(entry.centralName.length, 28); central.writeUInt16LE(entry.centralExtra.length, 30);
    central.writeUInt16LE(Math.min(entry.centralComment.length, 0xffff), 32);
    central.writeUInt32LE(entry.externalAttributes >>> 0, 38); central.writeUInt32LE(localOffset, 42);
    return Buffer.concat([central, entry.centralName, entry.centralExtra, entry.centralComment]);
  });
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, eocd]);
}

function validateClosedShape(fixture) {
  exactKeys(fixture, CASE_FIELDS, `${fixture.id}: case fields`);
  exactKeys(fixture.arrange, ['operations'], `${fixture.id}: arrange fields`);
  exactKeys(fixture.action, ['op'], `${fixture.id}: action fields`);
  for (const key of Object.keys(fixture.assert)) assert.ok(ASSERT_FIELDS.has(key), `${fixture.id}: assertion field ${key}`);
  for (const operation of fixture.arrange.operations) {
    exactKeys(operation, ARG_FREE.has(operation.op) ? ['op'] : ['args', 'op'], `${fixture.id}: operation fields`);
    if (!ARG_FREE.has(operation.op)) {
      assert.ok(ARG_FIELDS[operation.op], `${fixture.id}: argument schema for ${operation.op}`);
      const allowed = new Set(ARG_FIELDS[operation.op]);
      for (const key of Object.keys(operation.args)) assert.ok(allowed.has(key), `${fixture.id}: ${operation.op}.${key}`);
    }
  }
}

function parseSingleStoredZip(archiveBytes) {
  assert.equal(archiveBytes.readUInt32LE(0), 0x04034b50, 'reference adapter: local signature');
  assert.equal(archiveBytes.readUInt16LE(8), 0, 'reference adapter: stored only');
  const nameLength = archiveBytes.readUInt16LE(26);
  const extraLength = archiveBytes.readUInt16LE(28);
  const size = archiveBytes.readUInt32LE(18);
  const nameStart = 30;
  const dataStart = nameStart + nameLength + extraLength;
  return {
    name: archiveBytes.subarray(nameStart, dataStart).toString('utf8'),
    payload: Buffer.from(archiveBytes.subarray(dataStart, dataStart + size))
  };
}

// Test-only contract adapter. It parses the supplied archive and can act only
// through injected capabilities, so the harness cannot manufacture observations.
const referenceAdapter = {
  async importArchive({archiveBytes, capabilities}) {
    const entry = parseSingleStoredZip(archiveBytes);
    const suspension = capabilities.watcher.acquireSuspension();
    const published = capabilities.publish.atomicPublish(entry.name, entry.payload, suspension);
    capabilities.publish.verifyIdentity(published, suspension);
    capabilities.security.assertZero();
    capabilities.publish.commitDataOnly(published, suspension);
    capabilities.watcher.releaseSuspension(suspension);
    capabilities.notification.archiveContentPublished({path: published.path, entryCount: 1});
    return published;
  }
};

async function runAdapter(adapter, fixture, seededBoundary) {
  const events = [];
  const counters = Object.fromEntries(Object.keys(matrix.defaults.spyCounters).map((key) => [key, 0]));
  const destination = new Map();
  let activeToken = null;
  const forbidden = (name) => () => {
    counters[name] += 1;
    if (seededBoundary === name) throw new Error(`seeded forbidden boundary: ${name}`);
  };
  const forbiddenCapabilities = {
    importerDispatch: forbidden('importerDispatch'),
    packageHook: forbidden('packageHook'),
    executionBroker: forbidden('executionBroker'),
    trustMutation: forbidden('trustMutation')
  };
  const capabilities = {
    watcher: {
      acquireSuspension() { activeToken = Object.freeze({id: 'fixture-token'}); events.push('suspension-acquired'); return activeToken; },
      releaseSuspension(token) { assert.equal(token, activeToken); events.push('suspension-released'); activeToken = null; }
    },
    publish: {
      atomicPublish(name, payload, token) {
        assert.equal(token, activeToken); counters.publish += 1; events.push('atomic-publish');
        destination.set(name, Buffer.from(payload)); return {path: matrix.defaults.destinationPath, name};
      },
      verifyIdentity(_published, token) { assert.equal(token, activeToken); events.push('identity-verified'); },
      commitDataOnly(_published, token) { assert.equal(token, activeToken); events.push('data-only-commit'); }
    },
    security: {
      assertZero() {
        if (seededBoundary) forbiddenCapabilities[seededBoundary]();
        for (const name of matrix.schema.requiredSpyCounters) assert.equal(counters[name], 0, name);
        events.push('security-spies-zero');
      },
      ...forbiddenCapabilities
    },
    notification: {
      archiveContentPublished(payload) {
        assert.equal(activeToken, null); counters.notification += 1;
        events.push('archive-content-published'); return payload;
      }
    }
  };
  const archiveBytes = buildArchive(fixture);
  const result = await adapter.importArchive({archiveBytes, request: fixture.action, capabilities});
  return {archiveBytes, counters, destination, events, result};
}

if (process.env.UPDATE_ARCHIVE_FIXTURE_HASHES === '1') {
  for (const fixture of matrix.cases) {
    const archive = buildArchive(fixture);
    fixture.archiveSha256 = archive ? crypto.createHash('sha256').update(archive).digest('hex') : null;
  }
  fs.writeFileSync(fixturePath, `${JSON.stringify(matrix, null, 2)}\n`);
}

test('closed fixture schema and final mutated archive corpus are deterministic', () => {
  assert.equal(matrix.schemaVersion, 2);
  assert.deepEqual([...matrix.schema.requiredCaseFields].sort(), CASE_FIELDS);
  assert.equal(matrix.unicode.version, '15.1.0');
  assert.equal(matrix.unicode.caseFoldingBytes, 84870);
  assert.equal(matrix.unicode.caseFoldingSha256, '4e55acfdc32825a22e87670e9056a3bf94ad7c5400065778e9e10f8314372bcf');
  assert.deepEqual(matrix.unicode.includedStatuses, ['C', 'F']);
  assert.deepEqual(matrix.unicode.excludedStatuses, ['T']);
  assert.ok(contract.includes(matrix.unicode.caseFoldingSha256));
  assert.ok(matrix.cases.length >= 25);
  assert.equal(new Set(matrix.cases.map((fixture) => fixture.id)).size, matrix.cases.length);
  const operations = new Set(matrix.schema.allowedOperations);
  const actions = new Set(matrix.schema.allowedActions);
  for (const fixture of matrix.cases) {
    validateClosedShape(fixture);
    assert.match(fixture.id, /^[a-z0-9.-]+$/);
    assert.ok(actions.has(fixture.action.op), fixture.id);
    assert.ok(fixture.assert.error === null || errors.has(fixture.assert.error), fixture.id);
    for (const operation of fixture.arrange.operations) assert.ok(operations.has(operation.op), `${fixture.id}: ${operation.op}`);
    for (const scalar of JSON.stringify(fixture).match(/U\+[0-9A-F]{4,6}/g) || []) {
      const value = Number.parseInt(scalar.slice(2), 16);
      assert.ok(value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff), `${fixture.id}: ${scalar}`);
    }
    const archive = buildArchive(fixture);
    assert.equal(archive ? crypto.createHash('sha256').update(archive).digest('hex') : null,
      fixture.archiveSha256, `${fixture.id}: final archive digest`);
  }
});

test('every ZIP mutation has an observable exact byte effect', () => {
  const base = {id: 'meta', arrange: {operations: [
    {op: 'zip.create'}, {op: 'zip.addEntry', args: {nameScalars: ['U+0061'], payloadHex: '78'}},
    {op: 'zip.addEntry', args: {nameScalars: ['U+0062'], payloadHex: '79'}}
  ]}};
  const recipes = {
    'zip.setCentralNameScalars': {entry: 0, scalars: ['U+0063']},
    'zip.setLocalNameScalars': {entry: 0, scalars: ['U+0063']},
    'zip.setCentralFlags': {entry: 0, value: 2048},
    'zip.setLocalFlags': {entry: 0, value: 2048},
    'zip.setCentralMethod': {entry: 0, value: 8},
    'zip.setLocalMethod': {entry: 0, value: 8},
    'zip.setZip64Sizes': {entry: 0, central: {compressed: '1', uncompressed: '1'}, local: {compressed: '1', uncompressed: '2'}},
    'zip.setDescriptor': {entry: 0, signed: true, crc32Hex: '00000000', compressed: '1', uncompressed: '1'},
    'zip.aliasLocalOffset': {entry: 1, sourceEntry: 0},
    'zip.overlapDataRange': {entry: 1, withEntry: 0, overlapBytes: 1},
    'zip.setDosDirectory': {entry: 0, value: true},
    'zip.setUnixMode': {entry: 0, valueOctal: '0120777'},
    'zip.setDeclaredSizes': {entry: 0, compressed: '2', uncompressed: '3'}
  };
  const baseline = buildArchive(base);
  for (const [op, args] of Object.entries(recipes)) {
    const fixture = structuredClone(base);
    fixture.arrange.operations.push({op, args});
    assert.notDeepEqual(buildArchive(fixture), baseline, op);
  }
  const generator = createModel(base);
  applyMutation(generator, {op: 'zip.setPayloadGenerator', args: {entry: 0, byteHex: '00', observedOutput: '2147483649'}});
  assert.deepEqual(generator[0].payloadGenerator, {byteHex: '00', observedOutput: 2147483649n});
});

test('schema mutations and wrong final-byte digests fail closed', () => {
  const original = matrix.cases.find((item) => item.id === 'zip.local-name-mismatch');
  for (const field of CASE_FIELDS) {
    const fixture = structuredClone(original); delete fixture[field];
    assert.throws(() => validateClosedShape(fixture), new RegExp('case fields'));
  }
  const unknownCase = structuredClone(original); unknownCase.unknown = true;
  assert.throws(() => validateClosedShape(unknownCase));
  const unknownOperation = structuredClone(original); unknownOperation.arrange.operations[2].op = 'zip.unknownMutation';
  assert.equal(matrix.schema.allowedOperations.includes(unknownOperation.arrange.operations[2].op), false);
  const missingArgument = structuredClone(original); delete missingArgument.arrange.operations[2].args.entry;
  assert.throws(() => entryAt(createModel(missingArgument), missingArgument.arrange.operations[2].args, 'missing'));
  const unknownArgument = structuredClone(original); unknownArgument.arrange.operations[2].args.unknown = true;
  assert.throws(() => validateClosedShape(unknownArgument));
  const unknownAssertion = structuredClone(original); unknownAssertion.assert.unknown = true;
  assert.throws(() => validateClosedShape(unknownAssertion));
  const changed = structuredClone(original); changed.arrange.operations[1].args.payloadHex = '79';
  assert.notEqual(crypto.createHash('sha256').update(buildArchive(changed)).digest('hex'), original.archiveSha256);
  assert.notEqual('0'.repeat(64), original.archiveSha256, 'wrong declared digest rejected');
});

test('injected adapter observes real publish boundaries and exact destination bytes', async () => {
  const fixture = matrix.cases.find((item) => item.id === 'trust.script-file-is-data');
  const expectedPayload = Buffer.from(fixture.arrange.operations.find((operation) => operation.op === 'zip.addEntry').args.payloadHex, 'hex');
  assert.equal(crypto.createHash('sha256').update(expectedPayload).digest('hex'), fixture.assert.publishedFile.sha256);
  for (const boundary of matrix.schema.requiredSpyCounters) {
    await assert.rejects(runAdapter(referenceAdapter, fixture, boundary),
      new RegExp(`seeded forbidden boundary: ${boundary}`));
  }
  const observed = await runAdapter(referenceAdapter, fixture);
  assert.deepEqual(observed.events, fixture.assert.eventOrder);
  assert.deepEqual(
    Object.fromEntries(Object.keys(fixture.assert.spyCounters).map((key) => [key, observed.counters[key]])),
    fixture.assert.spyCounters
  );
  assert.deepEqual(observed.destination.get('Assets/evil.js'), expectedPayload);
  assert.equal(crypto.createHash('sha256').update(observed.archiveBytes).digest('hex'), fixture.archiveSha256);
});

test('TUG-65 controls and non-execution invariant remain explicit', () => {
  for (const rule of ['ZIP record and entry-type reconciliation',
    'Deterministic Windows/Unicode collision key', 'RootDirectory',
    'HMAC-SHA-256', 'Retained parser metadata']) assert.ok(contract.includes(rule), rule);
  assert.match(adr, /TUG-68 \(superseded by TUG-72\)/);
  assert.match(adr, /awaiting independent approval/);
  assert.match(contract, /does not execute importers, scripts, package\s+hooks/);
  assert.match(contract, /import-notification suspension token/);
});
