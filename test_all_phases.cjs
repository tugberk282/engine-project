#!/usr/bin/env node

/**
 * Master Test Runner - All Phases (1-9)
 * Runs all tests sequentially and prints a compact summary.
 */

const path = require('path');
const { execSync } = require('child_process');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
    bold: '\x1b[1m'
};

let totalTests = 0;
let totalPassed = 0;
let totalFailed = 0;
const phaseResults = [];

function log(color, message) {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

const testFiles = [
    { phase: 1, file: 'verify_phase1_editor_chrome.cjs', name: 'Editor Chrome Parity' },
    { phase: 2, file: 'verify_phase2_layout_mock.cjs', name: 'Layout and Windowing' },
    { phase: 3, file: 'verify_phase3_asset_pipeline.cjs', name: 'Asset Pipeline' },
    { phase: 4, file: 'verify_phase4_scene_workflow.cjs', name: 'Scene & GameObject Workflow' },
    { phase: 5, file: 'verify_phase5_regression.cjs', name: 'Serialization - Regression' },
    { phase: 5, file: 'verify_phase5_edge_cases.cjs', name: 'Serialization - Edge Cases' },
    { phase: 5, file: 'verify_phase5_performance.cjs', name: 'Serialization - Performance' },
    { phase: 5, file: 'verify_phase5_closure.cjs', name: 'Serialization - Closure' },
    { phase: 6, file: 'verify_phase6_inspector.cjs', name: 'Inspector Parity - Core' },
    { phase: 6, file: 'verify_phase6_unity_parity.cjs', name: 'Inspector Parity - Unity' },
    { phase: 7, file: 'verify_phase7_runtime.cjs', name: 'Runtime & Play Mode' },
    { phase: 8, file: 'verify_phase8_ui_rendering.cjs', name: 'Rendering, Physics & UI Parity' },
    { phase: 9, file: 'verify_phase9_desktop_productization.cjs', name: 'Desktop App Productization' }
];

function parseTestOutput(output) {
    let passed = 0;
    let total = 0;

    const totalPassedMatch = output.match(/Total Tests:\s*(\d+)\/(\d+)\s*passed/i);
    if (totalPassedMatch) {
        return {
            passed: parseInt(totalPassedMatch[1], 10),
            total: parseInt(totalPassedMatch[2], 10)
        };
    }

    const passedFailedMatch = output.match(/Passed:\s*(\d+).*?Failed:\s*(\d+)/is);
    if (passedFailedMatch) {
        passed = parseInt(passedFailedMatch[1], 10);
        total = passed + parseInt(passedFailedMatch[2], 10);
        return { passed, total };
    }

    const totalThenPassedMatch = output.match(/Total Tests:\s*(\d+).*?Passed:\s*(\d+)/is);
    if (totalThenPassedMatch) {
        return {
            total: parseInt(totalThenPassedMatch[1], 10),
            passed: parseInt(totalThenPassedMatch[2], 10)
        };
    }

    const passMatch = output.match(/(\d+)\/(\d+)\s+passed/i);
    if (passMatch) {
        return {
            passed: parseInt(passMatch[1], 10),
            total: parseInt(passMatch[2], 10)
        };
    }

    if (/ALL TESTS PASSED/i.test(output)) {
        const checkmarks = (output.match(/âœ“/g) || []).length;
        if (checkmarks > 0) {
            return { passed: checkmarks, total: checkmarks };
        }
    }

    return { passed, total };
}

function runTestSync(testFile) {
    try {
        const testPath = path.join(__dirname, testFile);
        const output = execSync(`node "${testPath}"`, {
            cwd: __dirname,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        });

        return { output, success: true, error: null };
    } catch (error) {
        return {
            output: `${error.stdout || ''}${error.stderr || ''}`,
            success: false,
            error: error.message
        };
    }
}

function main() {
    log('bold', '\n==============================================================');
    log('bold', ' Engine Project - Phase 1-9 Test Report');
    log('bold', '==============================================================\n');

    for (const testInfo of testFiles) {
        const { phase, file, name } = testInfo;

        log('cyan', `${'-'.repeat(62)}`);
        log('cyan', `Phase ${phase}: ${name}`);
        log('cyan', `File: ${file}`);
        log('cyan', `${'-'.repeat(62)}`);

        const result = runTestSync(file);
        const parsed = parseTestOutput(result.output);
        const success = result.success && parsed.total > 0 && parsed.passed === parsed.total;

        totalTests += parsed.total;
        totalPassed += parsed.passed;
        totalFailed += Math.max(0, parsed.total - parsed.passed);

        phaseResults.push({
            phase,
            file,
            name,
            passed: parsed.passed,
            total: parsed.total,
            success
        });

        if (!result.success) {
            log('yellow', 'Test execution returned non-zero exit code.');
        }

        const tailLines = result.output
            .split('\n')
            .filter((line) =>
                line.includes('Passed') ||
                line.includes('Failed') ||
                line.includes('Total Tests') ||
                line.includes('ALL TESTS PASSED') ||
                line.includes('tests failed')
            )
            .slice(-8);

        if (tailLines.length === 0 && result.error) {
            log('gray', result.error);
        } else {
            tailLines.forEach((line) => log('gray', line));
        }

        log(success ? 'green' : 'yellow', `Result: ${parsed.passed}/${parsed.total}\n`);
    }

    log('bold', '==============================================================');
    log('bold', ' Summary');
    log('bold', '==============================================================');

    for (let phase = 1; phase <= 9; phase++) {
        const items = phaseResults.filter((entry) => entry.phase === phase);
        if (items.length === 0) continue;

        const phasePassed = items.reduce((sum, item) => sum + item.passed, 0);
        const phaseTotal = items.reduce((sum, item) => sum + item.total, 0);
        const phaseOk = items.every((item) => item.success);
        log(phaseOk ? 'green' : 'yellow', `Phase ${phase}: ${phasePassed}/${phaseTotal}`);
    }

    const passRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : '0.0';
    log('cyan', `\nOverall: ${totalPassed}/${totalTests} (${passRate}%)`);
    log(totalFailed === 0 ? 'green' : 'yellow', `Failed tests: ${totalFailed}`);
}

main();

