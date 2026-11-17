'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const { BuildService } = require('../electron/build/build-service');
const { getScratchRoot, runExecutable } = require('./packaged-smoke.cjs');

function fixturePng() {
    const chunk = (type, data) => {
        const body = Buffer.concat([Buffer.from(type), data]);
        let crc = 0xffffffff;
        for (const byte of body) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
        const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
        return Buffer.concat([size, body, checksum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
        chunk('IDAT', require('node:zlib').deflateSync(Buffer.from([0, 255, 128, 32, 255]))), chunk('IEND', Buffer.alloc(0))]);
}

async function main() {
    assert.equal(process.platform, 'win32');
    const seconds = Number(process.argv[2] || 120);
    const gcDiagnostic = process.argv[4] === 'gc';
    assert.ok(!process.argv[4] || gcDiagnostic, 'optional diagnostic mode must be gc');
    assert.ok(Number.isInteger(seconds) && seconds >= 10 && seconds <= 3600, 'duration must be 10–3600 seconds');
    const work = fs.mkdtempSync(path.join(getScratchRoot(), 'tugberk-player-endurance-'));
    const project = path.join(work, 'project');
    fs.cpSync(path.join(__dirname, '..', 'samples', 'vertical-slice'), project, { recursive: true });
    const profile = process.argv[3] || 'baseline';
    assert.ok(['baseline', 'textured-models'].includes(profile));
    if (profile === 'textured-models') {
        const assets = path.join(project, 'Assets', 'Models');
        fs.mkdirSync(assets, { recursive: true });
        const binary = Buffer.concat([
            Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer),
            Buffer.from(new Uint16Array([0, 1, 2]).buffer), Buffer.alloc(2),
            Buffer.from(new Float32Array([0, 0, 1, 0, 0, 1]).buffer)
        ]);
        fs.writeFileSync(path.join(assets, 'Endurance.bin'), binary);
        fs.writeFileSync(path.join(assets, 'Endurance.png'), fixturePng());
        fs.writeFileSync(path.join(assets, 'Endurance.gltf'), JSON.stringify({
            asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
            meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 2 }, indices: 1, material: 0 }] }],
            buffers: [{ uri: 'Endurance.bin', byteLength: binary.length }],
            bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }, { buffer: 0, byteOffset: 44, byteLength: 24 }],
            accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
                { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }, { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' }],
            images: [{ uri: 'Endurance.png' }], textures: [{ source: 0 }],
            materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true }]
        }));
        const scenePath = path.join(project, 'Assets', 'Scenes', 'Main.scene.json');
        const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
        for (let index = 0; index < 24; index += 1) scene.gameObjects.push({
            id: `endurance-model-${index}`, name: `Textured model ${index}`, enabled: true,
            sourceAssetType: 'model', sourceAssetPath: 'Assets/Models/Endurance.gltf',
            transform: { position: [index % 6 - 3, 1 + Math.floor(index / 6), 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
            components: [], children: []
        });
        fs.writeFileSync(scenePath, JSON.stringify(scene));
    }
    const service = new BuildService();
    const published = path.join(work, 'published');
    try {
        await service.build({ version: 1, projectRoot: project,
            projectRevision: crypto.createHash('sha256').update(fs.readFileSync(path.join(project, 'project.json'), 'utf8')).digest('hex'),
            outputPath: published, target: 'win-x64' });
    } finally { service.shutdown(); }
    const player = path.join(work, 'relocated-player');
    fs.renameSync(published, player);
    fs.renameSync(project, path.join(work, 'source-offline'));
    const renderer = path.join(player, 'resources', 'app', 'player-renderer.js');
    const source = fs.readFileSync(renderer, 'utf8');
    const marker = '        await window.tugberkPlayer.smokeComplete({\n            ok: renderedScene';
    assert.equal(source.split(marker).length, 2, 'endurance instrumentation anchor changed');
    const probe = `
        const enduranceStart = performance.now();
        const initialFrame = lastState.frame;
        const baseline = { ...renderer.info.memory };
        const samples = [];
        if (${gcDiagnostic} && typeof window.gc !== 'function') throw new Error('GC diagnostic flag did not expose the collector');
        let nextSample = 0;
        let modelCycles = 0;
        while (performance.now() - enduranceStart < ${seconds * 1000}) {
            await sendTick({});
            const elapsedMs = performance.now() - enduranceStart;
            if (elapsedMs >= nextSample) {
                if (${JSON.stringify(profile)} === 'textured-models') {
                    const descriptor = authoredModels[0];
                    const bytes = await window.tugberkPlayer.readModelAsset(descriptor.path);
                    const imported = await parseModel(descriptor, bytes);
                    imported.scene.position.set(0, 2, 0);
                    view.scene.add(imported.scene);
                    await sendTick({});
                    view.scene.remove(imported.scene);
                    disposePlayerModel(imported.scene);
                    await sendTick({});
                    modelCycles += 1;
                }
                if (${gcDiagnostic}) window.gc();
                samples.push({ elapsedMs, frame: lastState.frame, geometries: renderer.info.memory.geometries,
                    textures: renderer.info.memory.textures, renderCalls: renderer.info.render.calls,
                    usedJSHeapBytes: performance.memory?.usedJSHeapSize ?? null });
                nextSample += 5000;
            }
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const endurance = { durationMs: performance.now() - enduranceStart, initialFrame,
            finalFrame: lastState.frame, baseline, samples, modelCycles };
`;
    const requiredChecks = ['renderedScene', 'shadowPipeline', 'authoredMaterial', 'authoredUiEvent',
        'authoredModel', 'authoredModelHierarchy', 'authoredParticleSystem', 'configuredInput',
        'configuredJump', 'movement', 'jump', 'look', 'collision', 'trigger', 'ui'];
    fs.writeFileSync(renderer, source.replace(marker, probe + marker)
        // The stock sample lacks build-service's injected layout fixtures.
        // Keep their individual results, but gate this profile on its authored features.
        .replace(/ok: renderedScene[^\n]+/, 'ok: renderedScene && shadowPipeline && authoredMaterial && authoredUiEvent && authoredModel && authoredModelHierarchy && authoredParticleSystem && configuredInput && configuredJump && jumped && looked && grounded && lastState.gameplay.player.position[0] > startX && observedTrigger,')
        .replace('sceneId: scene.sceneId,\n            objectCount:', 'endurance,\n            sceneId: scene.sceneId,\n            objectCount:'), 'utf8');
    const output = path.join(work, 'result.json');
    console.log(`Running ${seconds}s exported renderer/worker endurance: ${work}`);
    const executable = path.join(player, 'Tugberk Player.exe');
    const processMemory = [];
    const memoryErrors = [];
    let monitoring = true;
    const monitor = (async () => {
        while (monitoring) {
            try {
                const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
                    "$p=@(Get-Process -Name 'Tugberk Player' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $env:TUGBERK_ENDURANCE_EXE }); if($p.Count){ [pscustomobject]@{processes=$p.Count;privateBytes=($p | Measure-Object PrivateMemorySize64 -Sum).Sum;workingSetBytes=($p | Measure-Object WorkingSet64 -Sum).Sum} | ConvertTo-Json -Compress }"],
                { windowsHide: true, timeout: 10_000, env: { ...process.env, TUGBERK_ENDURANCE_EXE: executable } });
                if (stdout.trim()) processMemory.push({ observedAt: new Date().toISOString(), ...JSON.parse(stdout) });
            } catch (error) { memoryErrors.push(error.message); }
            if (monitoring) await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    })();
    try {
        await runExecutable(executable, {
            args: ['--enable-precise-memory-info', ...(gcDiagnostic ? ['--js-flags=--expose-gc'] : [])],
            cwd: work, timeoutMs: (seconds + 60) * 1000,
            env: { ELECTRON_RUN_AS_NODE: undefined, TUGBERK_PLAYER_SMOKE: '1', TUGBERK_PLAYER_SMOKE_OUTPUT: output }
        });
    } finally {
        monitoring = false;
        await monitor;
        fs.writeFileSync(path.join(work, 'process-memory.json'), JSON.stringify({ processMemory, memoryErrors }, null, 2));
    }
    assert.equal(memoryErrors.length, 0, memoryErrors.join('\n'));
    assert.ok(processMemory.length >= Math.floor(seconds / 10), 'insufficient process memory samples');
    const result = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(result.ok, true, JSON.stringify(result));
    for (const name of requiredChecks) assert.equal(result.checks[name], true, name);
    const evidence = result.endurance;
    if (profile === 'textured-models') {
        assert.equal(result.modelCount, 24);
        assert.ok(evidence.baseline.textures >= 24, 'textured fixture did not allocate textures');
        assert.ok(evidence.modelCycles >= Math.floor(seconds / 5), 'model churn did not execute');
    }
    assert.ok(evidence.durationMs >= seconds * 1000);
    assert.ok(evidence.finalFrame - evidence.initialFrame >= seconds * 10, 'worker made insufficient progress');
    assert.ok(evidence.samples.length >= Math.floor(seconds / 5));
    for (const sample of evidence.samples) {
        assert.ok(sample.renderCalls > 0, 'renderer stopped drawing');
        assert.ok(sample.geometries <= evidence.baseline.geometries + 8, 'geometry count grew beyond bound');
        assert.ok(sample.textures <= evidence.baseline.textures + 8, 'texture count grew beyond bound');
    }
    console.log(JSON.stringify({ ok: true, work, profile, seconds, gcDiagnostic, frames: evidence.finalFrame - evidence.initialFrame,
        baseline: evidence.baseline, finalSample: evidence.samples.at(-1), modelCycles: evidence.modelCycles,
        processMemory: { samples: processMemory.length, first: processMemory[0], last: processMemory.at(-1),
            peakPrivateBytes: Math.max(...processMemory.map((sample) => sample.privateBytes)) },
        requiredChecks, checks: result.checks }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
