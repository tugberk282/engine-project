'use strict';

const path = require('node:path');

const BUILD_REQUEST_VERSION = 1;
const BUILD_MANIFEST_VERSION = 1;
const SUPPORTED_TARGETS = new Set(['win-x64', 'linux-x64', 'darwin-x64', 'darwin-arm64']);
const STAGES = Object.freeze(['validate', 'resolve', 'import', 'bundle', 'package']);

class BuildError extends Error {
    constructor(code, message, details) {
        super(message);
        this.name = 'BuildError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

function assertBuildRequest(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw new BuildError('INVALID_REQUEST', 'Build request must be an object');
    }
    if (request.version !== BUILD_REQUEST_VERSION) {
        throw new BuildError('VERSION_UNSUPPORTED', `Build request version ${request.version} is unsupported`);
    }
    if (typeof request.projectRoot !== 'string' || !path.isAbsolute(request.projectRoot)) {
        throw new BuildError('INVALID_PROJECT_ROOT', 'projectRoot must be an absolute path');
    }
    if (typeof request.outputPath !== 'string' || !path.isAbsolute(request.outputPath)) {
        throw new BuildError('INVALID_OUTPUT_PATH', 'outputPath must be an absolute path');
    }
    if (!/^[a-f0-9]{64}$/.test(request.projectRevision || '')) {
        throw new BuildError('INVALID_REVISION', 'projectRevision must be a SHA-256 digest');
    }
    if (!SUPPORTED_TARGETS.has(request.target)) {
        throw new BuildError('TARGET_UNSUPPORTED', `Unsupported build target: ${request.target}`);
    }
    if (request.hooks !== undefined || request.nativeTools !== undefined) {
        throw new BuildError('EXECUTION_DISABLED', 'Build hooks and native tools are disabled by policy');
    }
    if (request.scenes !== undefined && (!Array.isArray(request.scenes) || request.scenes.length === 0
        || request.scenes.length > 1024 || request.scenes.some((entry) => typeof entry !== 'string'))) {
        throw new BuildError('INVALID_SCENES', 'scenes must be a non-empty list of project-relative paths');
    }
    const relative = path.relative(request.projectRoot, request.outputPath);
    if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
        throw new BuildError('INVALID_OUTPUT_PATH', 'Build output must be outside the project root');
    }
    return Object.freeze({ ...request, ...(request.scenes === undefined ? {} : { scenes: Object.freeze([...request.scenes]) }) });
}

function serializeError(error) {
    return {
        code: typeof error?.code === 'string' ? error.code : 'BUILD_FAILED',
        message: typeof error?.message === 'string' ? error.message : 'Build failed',
        ...(error?.details === undefined ? {} : { details: error.details })
    };
}

module.exports = {
    BUILD_REQUEST_VERSION,
    BUILD_MANIFEST_VERSION,
    SUPPORTED_TARGETS,
    STAGES,
    BuildError,
    assertBuildRequest,
    serializeError
};
