/**
 * Play Mode Controls - UI Toolbar
 * Play, Pause, Stop, Step buttons and controls
 */

import { PlayModeManager } from '../engine/PlayModeManager';

export class PlayModeControls {
    private playModeManager: PlayModeManager;
    private container: HTMLElement;
    private isInitialized = false;

    constructor(container: HTMLElement) {
        this.container = container;
        this.playModeManager = PlayModeManager.getInstance();
    }

    /**
     * Initialize UI controls
     */
    public initialize(): void {
        if (this.isInitialized) return;

        const controlsDiv = document.createElement('div');
        controlsDiv.id = 'play-mode-controls';
        controlsDiv.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 12px;
            background: rgba(255,255,255,0.05);
            border-right: 1px solid rgba(255,255,255,0.1);
            flex-shrink: 0;
        `;

        // Play Button
        const playBtn = document.createElement('button');
        playBtn.className = 'unity-button play-mode-btn';
        playBtn.innerHTML = '▶ Play';
        playBtn.title = 'Enter Play Mode (Ctrl+P)';
        playBtn.style.cssText = `
            padding: 4px 12px;
            background: #2a5f2a;
            border: 1px solid #4a9f4a;
            color: #fff;
            cursor: pointer;
            border-radius: 2px;
            font-weight: bold;
        `;
        playBtn.onclick = () => this.playModeManager.enterPlayMode();
        controlsDiv.appendChild(playBtn);

        // Pause Button
        const pauseBtn = document.createElement('button');
        pauseBtn.className = 'unity-button play-mode-btn';
        pauseBtn.innerHTML = '⏸ Pause';
        pauseBtn.title = 'Pause Play Mode (Ctrl+Shift+P)';
        pauseBtn.style.cssText = `
            padding: 4px 12px;
            background: #5f5f2a;
            border: 1px solid #9f9f4a;
            color: #fff;
            cursor: pointer;
            border-radius: 2px;
            opacity: 0.5;
        `;
        pauseBtn.disabled = true;
        pauseBtn.onclick = () => {
            if (this.playModeManager.isPausedMode()) {
                this.playModeManager.resumePlayMode();
            } else {
                this.playModeManager.pausePlayMode();
            }
        };
        controlsDiv.appendChild(pauseBtn);

        // Stop Button
        const stopBtn = document.createElement('button');
        stopBtn.className = 'unity-button play-mode-btn';
        stopBtn.innerHTML = '⏹ Stop';
        stopBtn.title = 'Exit Play Mode (Ctrl+Shift+P)';
        stopBtn.style.cssText = `
            padding: 4px 12px;
            background: #5f2a2a;
            border: 1px solid #9f4a4a;
            color: #fff;
            cursor: pointer;
            border-radius: 2px;
            opacity: 0.5;
        `;
        stopBtn.disabled = true;
        stopBtn.onclick = () => this.playModeManager.exitPlayMode();
        controlsDiv.appendChild(stopBtn);

        // Step Button
        const stepBtn = document.createElement('button');
        stepBtn.className = 'unity-button play-mode-btn';
        stepBtn.innerHTML = '⊳ Step';
        stepBtn.title = 'Step One Frame (Ctrl+Alt+S)';
        stepBtn.style.cssText = `
            padding: 4px 12px;
            background: #2a5f5f;
            border: 1px solid #4a9f9f;
            color: #fff;
            cursor: pointer;
            border-radius: 2px;
            opacity: 0.5;
        `;
        stepBtn.disabled = true;
        stepBtn.onclick = () => this.playModeManager.stepFrame();
        controlsDiv.appendChild(stepBtn);

        // Separator
        const sep = document.createElement('div');
        sep.style.cssText = `
            width: 1px;
            height: 20px;
            background: rgba(255,255,255,0.1);
            margin: 0 4px;
        `;
        controlsDiv.appendChild(sep);

        // Time Scale Slider
        const scaleLabel = document.createElement('label');
        scaleLabel.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: #aaa;
        `;
        scaleLabel.innerText = 'Time Scale:';
        controlsDiv.appendChild(scaleLabel);

        const scaleInput = document.createElement('input');
        scaleInput.type = 'range';
        scaleInput.min = '0';
        scaleInput.max = '2';
        scaleInput.step = '0.1';
        scaleInput.value = '1';
        scaleInput.style.cssText = `
            width: 80px;
            opacity: 0.5;
        `;
        scaleInput.disabled = true;
        scaleInput.onchange = (e) => {
            const scale = parseFloat((e.target as HTMLInputElement).value);
            this.playModeManager.setTimeScale(scale);
        };
        controlsDiv.appendChild(scaleInput);

        // Stats Display
        const statsDiv = document.createElement('div');
        statsDiv.style.cssText = `
            display: flex;
            gap: 16px;
            margin-left: auto;
            font-size: 11px;
            color: #aaa;
            opacity: 0.5;
        `;

        const frameInfo = document.createElement('span');
        const timeInfo = document.createElement('span');
        const fpsInfo = document.createElement('span');

        statsDiv.appendChild(frameInfo);
        statsDiv.appendChild(timeInfo);
        statsDiv.appendChild(fpsInfo);

        controlsDiv.appendChild(statsDiv);

        // Update stats display
        this.playModeManager.onFrame((delta) => {
            frameInfo.innerText = `Frame: ${this.playModeManager.getFrame()}`;
            timeInfo.innerText = `Time: ${this.playModeManager.getTime().toFixed(2)}s`;
            const fps = (1 / delta).toFixed(1);
            fpsInfo.innerText = `FPS: ${fps}`;
        });

        // Update button states based on play mode
        this.playModeManager.onPlay(() => {
            playBtn.disabled = true;
            pauseBtn.disabled = false;
            stopBtn.disabled = false;
            stepBtn.disabled = false;
            scaleInput.disabled = false;
        });

        this.playModeManager.onStop(() => {
            playBtn.disabled = false;
            pauseBtn.disabled = true;
            stopBtn.disabled = true;
            stepBtn.disabled = true;
            scaleInput.disabled = true;
            statsDiv.style.opacity = '0.3';
        });

        this.playModeManager.onPause(() => {
            pauseBtn.innerHTML = '▶ Resume';
            stepBtn.disabled = false;
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'p') {
                e.preventDefault();
                if (!this.playModeManager.isPlaying()) {
                    this.playModeManager.enterPlayMode();
                } else {
                    this.playModeManager.exitPlayMode();
                }
            }
            if (e.ctrlKey && e.shiftKey && e.key === 'P') {
                e.preventDefault();
                if (this.playModeManager.isPlaying()) {
                    if (this.playModeManager.isPausedMode()) {
                        this.playModeManager.resumePlayMode();
                    } else {
                        this.playModeManager.pausePlayMode();
                    }
                }
            }
            if (e.ctrlKey && e.altKey && e.key === 's') {
                e.preventDefault();
                if (this.playModeManager.isPlaying() && this.playModeManager.isPausedMode()) {
                    this.playModeManager.stepFrame();
                }
            }
        });

        this.container.appendChild(controlsDiv);
        this.isInitialized = true;

        console.log('[PlayMode] UI Controls initialized');
    }
}
