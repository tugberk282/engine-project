'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { RecentProjectService } = require('../electron/platform/recent-project-service');
const {
    COMMANDS,
    PROTOCOL_VERSION,
    validateRequest
} = require('../electron/architecture/contract');

function request(projects) {
    return {
        protocolVersion: PROTOCOL_VERSION,
        requestId: 'recent-test',
        command: COMMANDS.RECENT_PROJECTS_SAVE,
        payload: { projects }
    };
}

const validEntry = Object.freeze({
    name: 'Game',
    path: 'C:\\Projects\\Game',
    lastOpened: 1
});

test('bounded recent projects round-trip asynchronously', async (t) => {
    const scratch = await fs.promises.mkdtemp(path.join(
        process.env.PAPERCLIP_RUN_SCRATCH_DIR || os.tmpdir(),
        'tugberk-recents-'
    ));
    t.after(() => fs.promises.rm(scratch, { recursive: true, force: true }));
    const service = new RecentProjectService(path.join(scratch, 'recent-projects.json'));

    await service.save([validEntry]);
    assert.deepEqual(await service.load(), [validEntry]);
});

test('strict schema rejects abusive payloads with a stable error before changing the store', async (t) => {
    const scratch = await fs.promises.mkdtemp(path.join(
        process.env.PAPERCLIP_RUN_SCRATCH_DIR || os.tmpdir(),
        'tugberk-recents-reject-'
    ));
    t.after(() => fs.promises.rm(scratch, { recursive: true, force: true }));
    const storePath = path.join(scratch, 'recent-projects.json');
    const service = new RecentProjectService(storePath);
    await service.save([validEntry]);
    const original = await fs.promises.readFile(storePath);

    const invalidPayloads = [
        Array.from({ length: 11 }, () => validEntry),
        [{ ...validEntry, name: 'x'.repeat(257) }],
        [{ ...validEntry, path: 'x'.repeat(4097) }],
        Array.from({ length: 10 }, (_, index) => ({
            name: `Game ${index}`,
            path: `C:\\${'x'.repeat(4000)}${index}`,
            lastOpened: index
        })),
        [{ ...validEntry, extra: true }],
        [['nested']],
        [{ name: { nested: { deeply: true } }, path: 'C:\\Game', lastOpened: 1 }],
        [{ ...validEntry, path: 'https://attacker.invalid/game' }]
    ];

    for (const projects of invalidPayloads) {
        assert.equal(validateRequest(request(projects)).code, 'INVALID_PAYLOAD');
        await assert.rejects(
            service.save(projects),
            (error) => error.code === 'INVALID_PAYLOAD'
                && error.message === 'Recent projects payload rejected'
                && !error.message.includes(validEntry.path)
        );
        assert.deepEqual(await fs.promises.readFile(storePath), original);
    }
});
