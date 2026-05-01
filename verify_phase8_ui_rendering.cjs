#!/usr/bin/env node

/**
 * Phase 8: Rendering, Physics, UI Parity Verification Suite
 *
 * Source-backed validation for the currently implemented Phase 8 systems.
 * This suite verifies that key runtime + inspector parity pieces exist
 * in the codebase so Phase 8 can move toward a real closure gate.
 */

const fs = require('fs');
const path = require('path');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m'
};

let testsPassed = 0;
let testsFailed = 0;
const failedTests = [];

function log(color, message) {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function test(condition, testName, details = '') {
    if (condition) {
        testsPassed++;
        log('green', `✓ ${testName}`);
        if (details) log('gray', `  ${details}`);
    } else {
        testsFailed++;
        failedTests.push(testName);
        log('red', `✗ ${testName}`);
        if (details) log('gray', `  Expected: ${details}`);
    }
}

function suite(name) {
    log('blue', `\n━━━ ${name} ━━━`);
}

function read(relPath) {
    return fs.readFileSync(path.join(__dirname, relPath), 'utf8');
}

function hasAll(content, snippets) {
    return snippets.every((snippet) => content.includes(snippet));
}

log('cyan', '\n╔═══════════════════════════════════════════════════════════════╗');
log('cyan', '║      PHASE 8: RENDERING, PHYSICS, UI PARITY TEST SUITE      ║');
log('cyan', '║   Source-backed validation for runtime + inspector parity   ║');
log('cyan', '╚═══════════════════════════════════════════════════════════════╝\n');

const cameraSource = read('src/engine/components/Camera.ts');
const editorSource = read('src/editor/Editor.ts');
const inspectorsSource = read('src/editor/EditorInspectors.ts');
const materialSource = read('src/engine/Material.ts');
const meshRendererSource = read('src/engine/components/MeshRenderer.ts');
const inputFieldSource = read('src/engine/components/UIInputField.ts');
const dropdownSource = read('src/engine/components/UIDropdown.ts');
const toggleSource = read('src/engine/components/UIToggle.ts');
const sliderSource = read('src/engine/components/UISlider.ts');
const scrollbarSource = read('src/engine/components/UIScrollbar.ts');
const scrollRectSource = read('src/engine/components/UIScrollRect.ts');
const rigidBodySource = read('src/engine/components/RigidBody.ts');
const lightSource = read('src/engine/components/Light.ts');
const timeSource = read('src/engine/Time.ts');
const sceneSource = read('src/engine/Scene.ts');
const coroutineSource = read('src/engine/CoroutineManager.ts');
const inspectorWindowSource = read('src/editor/InspectorWindow.ts');
const projectSettingsWindowSource = read('src/editor/ProjectSettingsWindow.ts');

suite('Camera & Rendering');

test(
    hasAll(materialSource, [
        'public depthWrite: boolean = true;',
        'public depthTest: boolean = true;',
        'public renderOrder: number = 0;',
        'public surfaceOpacity: number = 1;',
        'public setDepthWrite(enabled: boolean): void {',
        'public setDepthTest(enabled: boolean): void {',
        'public setRenderOrder(order: number): void {',
        'public setSurfaceOpacity(opacity: number): void {',
        'mat.depthWrite = this.depthWrite;',
        'mat.depthTest = this.depthTest;',
        "mat.opacity = this.alphaMode === 'Fade' || this.alphaMode === 'Transparent' ? this.surfaceOpacity : 1;",
        "if (this.alphaMode === 'Transparent') {",
        'mat.depthWrite = false;'
    ]) && hasAll(meshRendererSource, [
        'this.syncMaterialRenderSettings();',
        'this.mesh.renderOrder = (this._material?.renderOrder ?? 0) + (this.sortingPriority ?? 0);',
        'private syncMaterialRenderSettings(): void {'
    ]) && hasAll(inspectorsSource, [
        "this.createUnitySlider(shaderGroup, 'Opacity'",
        "this.createUnityCheckbox(shaderGroup, 'Depth Write'",
        "this.createUnityCheckbox(shaderGroup, 'Depth Test'",
        "this.createUnityField(shaderGroup, 'Render Order'"
    ]),
    'Material pipeline exposes opacity, depth write/test and render order authoring with runtime mesh sync parity'
);

test(
    hasAll(cameraSource, [
        'public clearAlpha: number = 1;',
        'public setClearAlpha(alpha: number): void {',
        'clearAlpha: this.clearAlpha,',
        'this.clearAlpha = Number.isFinite(data.clearAlpha)'
    ]) && hasAll(editorSource, [
        'const effectiveClearFlags = this.resolveEffectiveCameraClearFlags(baseCamera, true);',
        'this.applyCameraClearMode(effectiveClearFlags, baseCamera.clearColor, baseCamera.clearAlpha ?? 1);',
        'const effectiveClearFlags = this.resolveEffectiveCameraClearFlags(cameraComponent, cameraIndex === 0);',
        'this.applyCameraClearMode(effectiveClearFlags, cameraComponent.clearColor, cameraComponent.clearAlpha ?? 1);',
        'private applyCameraClearMode(clearFlags: CameraClearFlags, clearColor: THREE.Color, clearAlpha: number): void {',
        'private resolveEffectiveCameraClearFlags(cameraComponent: Camera, isFirstCameraInPass: boolean): CameraClearFlags {',
        "return 'Depth Only';",
        'this.renderer.setClearColor(clearColor, alpha);'
    ]) && hasAll(inspectorsSource, [
        "this.createUnitySlider(parent, 'Clear Alpha'"
    ]),
    'Camera output pipeline exposes clear alpha authoring and preserves base color buffer for overlay clear edge-cases'
);

test(
    hasAll(meshRendererSource, [
        'public sortingPriority: number = 0;',
        'sortingPriority: this.sortingPriority,',
        'this.sortingPriority = Number.isFinite(data.sortingPriority)',
        'this.mesh.renderOrder = (this._material?.renderOrder ?? 0) + (this.sortingPriority ?? 0);'
    ]) && hasAll(inspectorsSource, [
        "this.createUnityField(parent, 'Sorting Priority'"
    ]),
    'MeshRenderer exposes per-instance sorting priority on top of material render order'
);

test(
    hasAll(cameraSource, [
        "export type CameraClearFlags = 'Skybox' | 'Solid Color' | 'Depth Only' | \"Don't Clear\";",
        "export type CameraRenderType = 'Base' | 'Overlay';",
        'public viewportRect: CameraViewportRect',
        'public depth: number = 0',
        'public usePostProcessing: boolean = true',
        "public renderType: CameraRenderType = 'Base';",
        'public stackBaseCamera: GameObject | null = null;',
        'public cullingMask: number = -1'
    ]),
    'Camera component exposes clear flags, alpha, viewport, depth, post FX, stack role and culling mask parity'
);

test(
    hasAll(cameraSource, [
        'public setViewportRect(nextRect: Partial<CameraViewportRect>): void',
        'this.viewportRect = { x, y, width, height };',
        'private clamp01(value: number): number'
    ]),
    'Camera viewport rect authoring is clamped and serialized through component API'
);

test(
    hasAll(editorSource, [
        'const runtimeCameras = this.getRuntimeCamerasInStackOrder();',
        'private getRuntimeCamerasInStackOrder(): Camera[] {',
        "entry.camera.renderType !== 'Overlay'",
        'const overlaysByBaseId = new Map<string, Array<{ go: GameObject; index: number; camera: Camera }>>();',
        'private getRuntimeCamerasInDepthOrder(): Camera[]',
        'private resolveCameraPixelRect(cameraComponent: Camera, size: THREE.Vector2)',
        'private applyCameraClearMode(clearFlags: CameraClearFlags, clearColor: THREE.Color, clearAlpha: number): void',
        'private applyCameraCullingMask(cameraComponent: Camera): void'
    ]),
    'Editor render pipeline includes camera stack ordering, depth sort, viewport resolution, clear mode and culling mask hooks'
);

test(
    hasAll(editorSource, [
        'if (baseCamera.usePostProcessing ?? true) {',
        'private pickPostProcessCameraForMultiStack(cameras: Camera[]): Camera | null {',
        'const eligible = cameras.filter((camera) => camera.usePostProcessing ?? true);'
    ]),
    'Editor render pipeline supports camera-level post processing and multi-camera selection'
);

test(
    hasAll(inspectorsSource, [
        "this.createUnityDropdown(parent, 'Clear Flags'",
        "this.createUnitySlider(parent, 'Clear Alpha'",
        "this.createUnityCheckbox(parent, 'Post Processing'",
        "this.createUnityDropdown(parent, 'Render Type'",
        "this.createUnityObjectField(parent, 'Base Camera'",
        "viewportPresetLabel.innerText = 'Viewport Presets';",
        "makeViewportPresetButton('Full', 'Full'",
        "makeViewportPresetButton('Left', 'Left Half'",
        "makeViewportPresetButton('Quad BR', 'Bottom Right Quad'",
        "btnRow.appendChild(makeQuickBtn('Default Only', () => (1 << 0)));",
        "btnRow.appendChild(makeQuickBtn('UI Only', () => {",
        "applyMaskCommand(`Set Camera Culling Mask ${label}`, nextMaskFactory());",
        "this.createUnityField(parent, 'Viewport X'",
        "this.createUnityField(parent, 'Viewport Y'",
        "this.createUnityField(parent, 'Viewport W'",
        "this.createUnityField(parent, 'Viewport H'"
    ]),
    'Camera inspector exposes clear flags, clear alpha, render type, base camera, viewport presets and command-backed culling mask controls'
);

test(
    hasAll(lightSource, [
        '@serialize public cullingMask: number = -1;',
        'this.light.layers.mask = this.cullingMask === -1 ? 0xFFFFFFFF : (this.cullingMask >>> 0);',
        'public setCullingMask(mask: number): void {',
        'cullingMask: this.cullingMask,',
        'this.cullingMask = data.cullingMask !== undefined ? data.cullingMask : -1;'
    ]) && hasAll(inspectorsSource, [
        "this.createLightCullingMaskField(parent, light);",
        "header.innerText = 'Light Culling Mask';",
        "applyMaskCommand(`Set Light Culling Mask ${label}`, nextMaskFactory());",
        "applyMaskCommand(`Toggle Light Culling Layer ${layer.name}`, nextMask);"
    ]),
    'Light component exposes layer-based culling mask authoring and applies it to runtime light layers'
);

suite('UI Controls');

test(
    hasAll(inputFieldSource, [
        '@serialize public selectAllOnFocus: boolean = false;',
        '@serialize public restoreTextOnEscape: boolean = true;',
        "lineType: 'SingleLine' | 'MultiLineSubmit' | 'MultiLineNewline'",
        "@serialize public textAlignment: 'Left' | 'Center' | 'Right' = 'Left';",
        "@serialize public characterValidation: 'None' | 'Alphanumeric' | 'Name' | 'EmailAddress' = 'None';",
        'private selectionStart: number = 0;',
        'private selectionEnd: number = 0;',
        "if (event.code === 'Escape' && this.restoreTextOnEscape) {",
        "case 'EmailAddress':",
        'private resolveTextAlign(): \'left\' | \'center\' | \'right\' {',
        'private applyFocusSelectionPolicy(): void',
        'this.inputElement.setSelectionRange(start, end);'
    ]),
    'UIInputField includes validation, alignment, selection preservation and escape-revert support'
);

test(
    hasAll(inspectorsSource, [
        "this.createUnityCheckbox(parent, 'Select All On Focus'",
        "this.createUnityCheckbox(parent, 'Restore On Escape'",
        "this.createUnityDropdown(parent, 'Character Validation'",
        "this.createUnityDropdown(parent, 'Text Alignment'",
        "this.createUnityDropdown(parent, 'Line Type'",
        "this.createUnityDropdown(parent, 'Content Type'"
    ]),
    'UIInputField inspector exposes focus selection, validation, alignment and escape restore authoring'
);

test(
    hasAll(toggleSource, [
        'this.element.tabIndex = -1;',
        "this.checkmarkElement.textContent = String.fromCharCode(10003);",
        "this.element?.addEventListener('keydown', (rawEvent) => {",
        "event.code !== 'Space'",
        "event.code !== 'Enter'",
        'private focused: boolean = false;'
    ]),
    'UIToggle includes keyboard submit/space parity, focus visuals and deterministic checkmark rendering'
);

test(
    hasAll(dropdownSource, [
        '@serialize public disabledOptionIndices: number[] = [];',
        "@serialize public popupDirection: 'Auto' | 'Down' | 'Up' = 'Auto';",
        '@serialize public maxVisibleItems: number = 6;',
        'public onScroll(eventData: PointerEventData): void',
        "if (event.code === 'Home' && this.expanded)",
        "if (event.code === 'End' && this.expanded)",
        "if (event.code === 'PageDown' && this.expanded) {",
        "if (event.code === 'PageUp' && this.expanded) {",
        'document.addEventListener(\'pointerdown\', this.handleDocumentPointerDown, true);',
        'private isOptionDisabled(index: number): boolean {',
        'private findSelectableOption(startIndex: number, direction: 1 | -1): number {',
        'private applyPopupDirection(headerHeight: number): void {',
        'private syncPopupScrollPosition(): void {',
        'private readonly optionItemHeight: number = 30;',
        'this.popupElement.style.maxHeight = `${Math.max(1, this.maxVisibleItems) * this.optionItemHeight}px`;',
        'this.popupElement.style.overflowY = this.options.length > this.maxVisibleItems ? \'auto\' : \'hidden\';'
    ]),
    'UIDropdown supports popup direction, disabled options and deeper keyboard/wheel parity'
);

test(
    hasAll(inspectorsSource, [
        "this.createUnityField(parent, 'Disabled Indices'",
        "this.createUnityDropdown(parent, 'Popup Direction'",
        "this.createUnityField(parent, 'Max Visible'"
    ]),
    'UIDropdown inspector exposes disabled indices, popup direction and visible item authoring'
);

test(
    hasAll(scrollRectSource, [
        "type MovementType = 'Unrestricted' | 'Elastic' | 'Clamped';",
        "type ScrollbarVisibility = 'Permanent' | 'AutoHide' | 'AutoHideAndExpandViewport';",
        '@serialize public inertia: boolean = true;',
        '@serialize public decelerationRate: number = 0.135;',
        '@serialize public elasticity: number = 0.1;',
        '@serialize public keyboardScrollStep: number = 0;',
        '@serialize public keyboardPageStep: number = 0;',
        "private focused: boolean = false;",
        "this.element.style.cursor = 'grab';",
        "this.horizontalVelocity = 0;",
        "this.verticalVelocity = 0;",
        "this.element.addEventListener('focus', () => {",
        "this.element.addEventListener('blur', () => {",
        "this.element.style.cursor = this.isInteractable() ? (this.dragging ? 'grabbing' : 'grab') : 'default';",
        '@serialize public horizontalScrollbarVisibility: ScrollbarVisibility = \'Permanent\';',
        '@serialize public verticalScrollbarVisibility: ScrollbarVisibility = \'Permanent\';',
        "this.element.addEventListener('keydown', (rawEvent) => {",
        "case 'ArrowUp':",
        "case 'ArrowDown':",
        "case 'PageUp':",
        "case 'PageDown':",
        'private stepInertiaAndElasticity(deltaTime: number): void',
        'this.boundHorizontalScrollbar.setRuntimeVisible(visibilityState.horizontalVisible);',
        'this.boundVerticalScrollbar.setRuntimeVisible(visibilityState.verticalVisible);',
        "if (!this.dragging && this.movementType === 'Elastic') {"
    ]),
    'UIScrollRect supports movement type, inertia, keyboard scrolling, focus polish and scrollbar visibility runtime parity'
);

test(
    hasAll(inspectorsSource, [
        "this.createUnityDropdown(parent, 'Movement Type'",
        "this.createUnitySlider(parent, 'Deceleration Rate'",
        "this.createUnitySlider(parent, 'Elasticity'",
        "this.createUnityField(parent, 'Keyboard Step'",
        "this.createUnityField(parent, 'Keyboard Page Step'",
        "this.createUnityDropdown(parent, 'Horizontal Visibility'",
        "this.createUnityDropdown(parent, 'Vertical Visibility'"
    ]),
    'UIScrollRect inspector exposes movement type, elasticity, keyboard step and scrollbar visibility controls'
);

test(
    hasAll(sliderSource, [
        '@serialize public keyboardStep: number = 0;',
        '@serialize public keyboardPageStep: number = 0;',
        "if (event.code === 'Home') {",
        "if (event.code === 'End') {",
        "case 'ArrowLeft':",
        "case 'ArrowRight':",
        "case 'ArrowUp':",
        "case 'ArrowDown':",
        "case 'PageUp':",
        "case 'PageDown':",
        'private getResolvedKeyboardStep(): number {',
        'private getResolvedKeyboardPageStep(): number {'
    ]) && hasAll(inspectorsSource, [
        "this.createUnityField(parent, 'Keyboard Step'",
        "this.createUnityField(parent, 'Keyboard Page Step'"
    ]),
    'UISlider supports keyboard step/page authoring with arrow, page and home/end parity'
);

test(
    hasAll(scrollbarSource, [
        '@serialize public keyboardStep: number = 0;',
        '@serialize public keyboardPageStep: number = 0;',
        'const direction = pointerAxis < handleStartPx ? -1 : 1;',
        'this.setValue(this.value + (direction * this.getResolvedKeyboardPageStep()), true);',
        "if (event.code === 'Home') {",
        "if (event.code === 'End') {",
        "case 'ArrowLeft':",
        "case 'ArrowRight':",
        "case 'ArrowUp':",
        "case 'ArrowDown':",
        "case 'PageUp':",
        "case 'PageDown':",
        'private getResolvedKeyboardStep(): number {',
        'private getResolvedKeyboardPageStep(): number {'
    ]) && hasAll(inspectorsSource, [
        "this.createUnityField(parent, 'Keyboard Step'",
        "this.createUnityField(parent, 'Keyboard Page Step'"
    ]),
    'UIScrollbar supports keyboard step/page authoring and track click page-step parity'
);

test(
    hasAll(inspectorsSource, [
        "presetLabel.innerText = 'Anchor Presets';",
        "makePresetOption('Preserve Position'",
        "makePresetOption('Preserve Pivot'"
    ]),
    'RectTransform inspector includes anchor presets and preserve options'
);

suite('Physics & Time');

test(
    hasAll(rigidBodySource, [
        "export type RigidbodyInterpolation = 'None' | 'Interpolate' | 'Extrapolate';",
        'public interpolation: RigidbodyInterpolation = \'None\';',
        'public collisionDetectionMode: CollisionDetectionMode = \'Discrete\';',
        'this.body.linearFactor.set(',
        'this.body.angularFactor.set('
    ]),
    'RigidBody runtime includes interpolation, collision detection and axis constraint application'
);

test(
    hasAll(inspectorsSource, [
        "'Interpolation'",
        "'Collision Detection'",
        "'Freeze Pos X'",
        "'Freeze Pos Y'",
        "'Freeze Pos Z'"
    ]),
    'RigidBody inspector exposes interpolation, collision detection and freeze position controls'
);

test(
    hasAll(timeSource, [
        'public static get unscaledTime(): number {',
        'public static get fixedDeltaTime(): number {',
        'public static get maximumDeltaTime(): number {'
    ]) && hasAll(sceneSource, [
        'const configuredFixedDelta = Math.max(0.0001, Number.isFinite(ProjectSettings.fixedDeltaTime) ? ProjectSettings.fixedDeltaTime : 0.02);',
        'const configuredMaxDelta = Math.max(configuredFixedDelta, Number.isFinite(ProjectSettings.maximumDeltaTime) ? ProjectSettings.maximumDeltaTime : 0.33);',
        'while (this.accumulator >= this.fixedDeltaTime && fixedStepCount < maxFixedSteps) {'
    ]),
    'Time and Scene fixed-step loop use fixedDeltaTime, maximumDeltaTime and unscaled time parity'
);

test(
    hasAll(coroutineSource, [
        'export class WaitForEndOfFrame {',
        'export class WaitForFixedUpdate {',
        'state.waiting instanceof WaitForFixedUpdate',
        'state.waiting instanceof WaitForEndOfFrame'
    ]),
    'Coroutine manager supports fixed update and end-of-frame wait phases'
);

test(
    hasAll(editorSource, [
        'const targetFrameRate = Number.isFinite(ProjectSettings.targetFrameRate)',
        'const minFrameDuration = 1 / targetFrameRate;'
    ]) && hasAll(projectSettingsWindowSource, [
        "'Target Frame Rate'",
        "'Fixed Delta Time'",
        "'Max Delta Time'"
    ]),
    'Target frame rate and fixed timestep project settings are wired into runtime and settings UI'
);

suite('Layers, Tags & Inspector Feedback');

test(
    hasAll(inspectorWindowSource, [
        "title.innerText = 'Layer Impact';",
        "'__mixed__'",
        'Add Layer...',
        'Add Tag...'
    ]),
    'Inspector window includes Layer Impact summary and mixed/add actions for layers and tags'
);

test(
    hasAll(projectSettingsWindowSource, [
        '+ Add Tag',
        'Built-in Layers',
        'User Layers'
    ]),
    'Project Settings includes dedicated tag creation and built-in/user layer sections'
);

test(
    hasAll(inspectorsSource, [
        "this.createUnityCheckbox(parent, 'Post Processing'",
        "this.createUnityCheckbox(parent, 'Send Navigation'",
        "this.createUnityField(parent, 'Drag Threshold'"
    ]),
    'Inspector parity continues to expose key Phase 8 camera and event-system authoring controls'
);

log('blue', '\n━━━ TEST SUMMARY ━━━');
log('yellow', `Total Tests: ${testsPassed + testsFailed}`);
log(testsFailed === 0 ? 'green' : 'red', `Passed: ${testsPassed}`);
log(testsFailed === 0 ? 'green' : 'red', `Failed: ${testsFailed}`);

if (testsFailed === 0) {
    log('green', '\n✓ ALL TESTS PASSED - PHASE 8');
} else {
    log('red', '\n✗ SOME TESTS FAILED - PHASE 8');
    failedTests.forEach((name) => log('red', `  - ${name}`));
    process.exitCode = 1;
}
