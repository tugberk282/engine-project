import { CommandHistory } from './Command';
import { LayerManager } from '../engine/LayerManager';
import { MaterialManager } from '../engine/Material';
import { AssetImporter } from '../engine/AssetImporter';

export class EditorInspectors {
    public refreshSelected: (() => void) | null = null;

    public createTransformInspector(parent: HTMLElement, transform: any): void {
        this.createVector3Field(parent, 'Position', transform.position, (axis, val) => {
            const oldVal = transform.position[axis];
            CommandHistory.execute({
                name: `Move ${axis}`,
                execute: () => {
                    transform.position[axis] = val;
                    this.recordOverride(transform, 'position');
                    this.notifyChange(transform);
                },
                undo: () => {
                    transform.position[axis] = oldVal;
                    this.notifyChange(transform);
                }
            });
        }, transform, 'position');
        this.createVector3Field(parent, 'Rotation', transform.rotation, (axis, val) => {
            const oldVal = transform.rotation[axis];
            CommandHistory.execute({
                name: `Rotate ${axis}`,
                execute: () => {
                    transform.rotation[axis] = val;
                    this.recordOverride(transform, 'rotation');
                    this.notifyChange(transform);
                },
                undo: () => {
                    transform.rotation[axis] = oldVal;
                    this.notifyChange(transform);
                }
            });
        }, transform, 'rotation');
        this.createVector3Field(parent, 'Scale', transform.scale, (axis, val) => {
            const oldVal = transform.scale[axis];
            CommandHistory.execute({
                name: `Scale ${axis}`,
                execute: () => {
                    transform.scale[axis] = val;
                    this.recordOverride(transform, 'scale');
                    this.notifyChange(transform);
                },
                undo: () => {
                    transform.scale[axis] = oldVal;
                    this.notifyChange(transform);
                }
            });
        }, transform, 'scale');
    }
    public createSceneEnvironmentInspector(parent: HTMLElement, scene: any): void {
        this.createUnityColorField(parent, 'Background Color', scene.backgroundColor, (c) => {
            const oldVal = scene.backgroundColor;
            CommandHistory.execute({
                name: 'Change Background Color',
                execute: () => {
                    scene.backgroundColor = c;
                    scene.updateEnvironment();
                    this.recordOverride(scene, 'backgroundColor');
                    this.notifyChange(scene);
                },
                undo: () => {
                    scene.backgroundColor = oldVal;
                    scene.updateEnvironment();
                    this.notifyChange(scene);
                }
            });
        }, scene, 'backgroundColor');

        this.createUnityColorField(parent, 'Ambient Color', scene.ambientColor, (c) => {
            const oldVal = scene.ambientColor;
            CommandHistory.execute({
                name: 'Change Ambient Color',
                execute: () => {
                    scene.ambientColor = c;
                    scene.updateEnvironment();
                    this.recordOverride(scene, 'ambientColor');
                    this.notifyChange(scene);
                },
                undo: () => {
                    scene.ambientColor = oldVal;
                    scene.updateEnvironment();
                    this.notifyChange(scene);
                }
            });
        }, scene, 'ambientColor');

        this.createUnitySlider(parent, 'Ambient Intensity', scene.ambientIntensity, 0, 2, (v) => {
            const oldVal = scene.ambientIntensity;
            CommandHistory.execute({
                name: 'Change Ambient Intensity',
                execute: () => {
                    scene.ambientIntensity = v;
                    scene.updateEnvironment();
                    this.recordOverride(scene, 'ambientIntensity');
                },
                undo: () => { scene.ambientIntensity = oldVal; scene.updateEnvironment(); this.notifyChange(scene); }
            });
        }, scene, 'ambientIntensity');

        this.createUnityField(parent, 'Skybox Path (Folder)', 'text', scene.skyboxPath || '', (v) => {
            const oldVal = scene.skyboxPath;
            CommandHistory.execute({
                name: 'Change Skybox Path',
                execute: () => {
                    scene.skyboxPath = v;
                    scene.updateEnvironment();
                    this.recordOverride(scene, 'skyboxPath');
                },
                undo: () => { scene.skyboxPath = oldVal; scene.updateEnvironment(); this.notifyChange(scene); }
            });
        }, scene, 'skyboxPath');

        const hr = document.createElement('hr');
        hr.style.border = '0';
        hr.style.borderTop = '1px solid var(--unity-border)';
        hr.style.margin = '10px 0';
        parent.appendChild(hr);

        const bloomHeader = document.createElement('div');
        bloomHeader.innerText = 'Bloom (Post-Processing)';
        bloomHeader.style.fontSize = '12px';
        bloomHeader.style.fontWeight = 'bold';
        bloomHeader.style.marginBottom = '5px';
        parent.appendChild(bloomHeader);

        this.createUnityCheckbox(parent, 'Enable Bloom', scene.enableBloom, (checked: boolean) => {
            const oldVal = scene.enableBloom;
            CommandHistory.execute({
                name: 'Toggle Bloom',
                execute: () => {
                    scene.enableBloom = checked;
                    scene.updateEnvironment();
                    this.recordOverride(scene, 'enableBloom');
                },
                undo: () => { scene.enableBloom = oldVal; scene.updateEnvironment(); this.notifyChange(scene); }
            });
        }, scene, 'enableBloom');

        this.createUnitySlider(parent, 'Intensity', scene.bloomStrength, 0, 5, (v) => {
            const oldVal = scene.bloomStrength;
            CommandHistory.execute({
                name: 'Change Bloom Strength',
                execute: () => {
                    scene.bloomStrength = v;
                    scene.updateEnvironment();
                    this.recordOverride(scene, 'bloomStrength');
                },
                undo: () => { scene.bloomStrength = oldVal; scene.updateEnvironment(); this.notifyChange(scene); }
            });
        }, scene, 'bloomStrength');

        this.createUnitySlider(parent, 'Threshold', scene.bloomThreshold, 0, 1, (v) => {
            const oldVal = scene.bloomThreshold;
            CommandHistory.execute({
                name: 'Change Bloom Threshold',
                execute: () => {
                    scene.bloomThreshold = v;
                    scene.updateEnvironment();
                    this.recordOverride(scene, 'bloomThreshold');
                },
                undo: () => { scene.bloomThreshold = oldVal; scene.updateEnvironment(); this.notifyChange(scene); }
            });
        }, scene, 'bloomThreshold');

        this.createUnitySlider(parent, 'Radius', scene.bloomRadius, 0, 2, (v) => {
            const oldVal = scene.bloomRadius;
            CommandHistory.execute({
                name: 'Change Bloom Radius',
                execute: () => {
                    scene.bloomRadius = v;
                    scene.updateEnvironment();
                    this.recordOverride(scene, 'bloomRadius');
                },
                undo: () => { scene.bloomRadius = oldVal; scene.updateEnvironment(); this.notifyChange(scene); }
            });
        }, scene, 'bloomRadius');

        const hr2 = document.createElement('hr');
        hr2.style.border = '0';
        hr2.style.borderTop = '1px solid var(--unity-border)';
        hr2.style.margin = '10px 0';
        parent.appendChild(hr2);

        const ssaoHeader = document.createElement('div');
        ssaoHeader.innerText = 'SSAO (Ambient Occlusion)';
        ssaoHeader.style.fontSize = '12px';
        ssaoHeader.style.fontWeight = 'bold';
        ssaoHeader.style.marginBottom = '5px';
        parent.appendChild(ssaoHeader);

        this.createUnityCheckbox(parent, 'Enable SSAO', scene.enableSSAO, (checked: boolean) => {
            const oldVal = scene.enableSSAO;
            CommandHistory.execute({
                name: 'Toggle SSAO',
                execute: () => {
                    scene.enableSSAO = checked;
                    scene.updateEnvironment();
                    this.recordOverride(scene, 'enableSSAO');
                },
                undo: () => { scene.enableSSAO = oldVal; scene.updateEnvironment(); this.notifyChange(scene); }
            });
        }, scene, 'enableSSAO');

        this.createUnitySlider(parent, 'Kernel Radius', scene.ssaoRadius, 0, 32, (v) => {
            const oldVal = scene.ssaoRadius;
            CommandHistory.execute({
                name: 'Change SSAO Radius',
                execute: () => {
                    scene.ssaoRadius = v;
                    scene.updateEnvironment();
                    this.recordOverride(scene, 'ssaoRadius');
                },
                undo: () => { scene.ssaoRadius = oldVal; scene.updateEnvironment(); this.notifyChange(scene); }
            });
        }, scene, 'ssaoRadius');

        this.createUnitySlider(parent, 'Min Distance', scene.ssaoMinDistance, 0, 0.1, (v) => {
            const oldVal = scene.ssaoMinDistance;
            CommandHistory.execute({
                name: 'Change SSAO Min Distance',
                execute: () => {
                    scene.ssaoMinDistance = v;
                    scene.updateEnvironment();
                    this.recordOverride(scene, 'ssaoMinDistance');
                },
                undo: () => { scene.ssaoMinDistance = oldVal; scene.updateEnvironment(); this.notifyChange(scene); }
            });
        }, scene, 'ssaoMinDistance');

        this.createUnitySlider(parent, 'Max Distance', scene.ssaoMaxDistance, 0, 0.5, (v) => {
            const oldVal = scene.ssaoMaxDistance;
            CommandHistory.execute({
                name: 'Change SSAO Max Distance',
                execute: () => {
                    scene.ssaoMaxDistance = v;
                    scene.updateEnvironment();
                    this.recordOverride(scene, 'ssaoMaxDistance');
                },
                undo: () => { scene.ssaoMaxDistance = oldVal; scene.updateEnvironment(); this.notifyChange(scene); }
            });
        }, scene, 'ssaoMaxDistance');

        this.createUnitySlider(parent, 'Lum Influence', scene.ssaoLumInfluence, 0, 1, (v) => {
            const oldVal = scene.ssaoLumInfluence;
            CommandHistory.execute({
                name: 'Change SSAO Lum Influence',
                execute: () => {
                    scene.ssaoLumInfluence = v;
                    scene.updateEnvironment();
                    this.recordOverride(scene, 'ssaoLumInfluence');
                },
                undo: () => { scene.ssaoLumInfluence = oldVal; scene.updateEnvironment(); this.notifyChange(scene); }
            });
        }, scene, 'ssaoLumInfluence');

        const hr3 = document.createElement('hr');
        hr3.style.border = '0';
        hr3.style.borderTop = '1px solid var(--unity-border)';
        hr3.style.margin = '10px 0';
        parent.appendChild(hr3);

        const fogHeader = document.createElement('div');
        fogHeader.innerText = 'Fog';
        fogHeader.style.fontSize = '12px';
        fogHeader.style.fontWeight = 'bold';
        fogHeader.style.marginBottom = '5px';
        parent.appendChild(fogHeader);

        this.createUnityCheckbox(parent, 'Enable Fog', scene.enableFog, (checked: boolean) => {
            const oldVal = scene.enableFog;
            CommandHistory.execute({
                name: 'Toggle Fog',
                execute: () => {
                    scene.enableFog = checked;
                    scene.updateEnvironment();
                    this.recordOverride(scene, 'enableFog');
                    this.refreshSelected?.();
                },
                undo: () => { scene.enableFog = oldVal; scene.updateEnvironment(); this.refreshSelected?.(); }
            });
        }, scene, 'enableFog');

        if (scene.enableFog) {
            this.createUnityDropdown(parent, 'Fog Mode', ['Linear', 'Exp2'], scene.fogMode, (v) => {
                const oldVal = scene.fogMode;
                CommandHistory.execute({
                    name: 'Change Fog Mode',
                    execute: () => {
                        scene.fogMode = v;
                        scene.updateEnvironment();
                        this.recordOverride(scene, 'fogMode');
                        this.refreshSelected?.();
                    },
                    undo: () => { scene.fogMode = oldVal; scene.updateEnvironment(); this.refreshSelected?.(); }
                });
            }, scene, 'fogMode');

            this.createUnityColorField(parent, 'Fog Color', scene.fogColor, (c) => {
                const oldVal = scene.fogColor;
                CommandHistory.execute({
                    name: 'Change Fog Color',
                    execute: () => {
                        scene.fogColor = c;
                        scene.updateEnvironment();
                        this.recordOverride(scene, 'fogColor');
                    },
                    undo: () => { scene.fogColor = oldVal; scene.updateEnvironment(); this.notifyChange(scene); }
                });
            }, scene, 'fogColor');

            if (scene.fogMode === 'Linear') {
                this.createUnitySlider(parent, 'Near', scene.fogNear, 0, 100, (v) => {
                    const oldVal = scene.fogNear;
                    CommandHistory.execute({
                        name: 'Change Fog Near',
                        execute: () => {
                            scene.fogNear = v;
                            scene.updateEnvironment();
                            this.recordOverride(scene, 'fogNear');
                        },
                        undo: () => { scene.fogNear = oldVal; scene.updateEnvironment(); this.notifyChange(scene); }
                    });
                }, scene, 'fogNear');
                this.createUnitySlider(parent, 'Far', scene.fogFar, 0, 1000, (v) => {
                    const oldVal = scene.fogFar;
                    CommandHistory.execute({
                        name: 'Change Fog Far',
                        execute: () => {
                            scene.fogFar = v;
                            scene.updateEnvironment();
                            this.recordOverride(scene, 'fogFar');
                        },
                        undo: () => { scene.fogFar = oldVal; scene.updateEnvironment(); this.notifyChange(scene); }
                    });
                }, scene, 'fogFar');
            } else {
                this.createUnitySlider(parent, 'Density', scene.fogDensity, 0, 0.1, (v) => {
                    const oldVal = scene.fogDensity;
                    CommandHistory.execute({
                        name: 'Change Fog Density',
                        execute: () => {
                            scene.fogDensity = v;
                            scene.updateEnvironment();
                            this.recordOverride(scene, 'fogDensity');
                        },
                        undo: () => { scene.fogDensity = oldVal; scene.updateEnvironment(); this.notifyChange(scene); }
                    });
                }, scene, 'fogDensity');
            }
        }

        const hr4 = document.createElement('hr');
        hr4.style.border = '0';
        hr4.style.borderTop = '1px solid var(--unity-border)';
        hr4.style.margin = '10px 0';
        parent.appendChild(hr4);

        const tmHeader = document.createElement('div');
        tmHeader.innerText = 'Tone Mapping';
        tmHeader.style.fontSize = '12px';
        tmHeader.style.fontWeight = 'bold';
        tmHeader.style.marginBottom = '5px';
        parent.appendChild(tmHeader);

        this.createUnityDropdown(parent, 'Mode', ['None', 'Linear', 'Reinhard', 'Cineon', 'ACES Filmic'], scene.toneMapping, (v) => {
            const oldVal = scene.toneMapping;
            CommandHistory.execute({
                name: 'Change Tone Mapping',
                execute: () => {
                    scene.toneMapping = v;
                    this.recordOverride(scene, 'toneMapping');
                },
                undo: () => { scene.toneMapping = oldVal; this.notifyChange(scene); }
            });
        }, scene, 'toneMapping');

        this.createUnitySlider(parent, 'Exposure', scene.toneMappingExposure, 0.1, 5, (v) => {
            const oldVal = scene.toneMappingExposure;
            CommandHistory.execute({
                name: 'Change TM Exposure',
                execute: () => {
                    scene.toneMappingExposure = v;
                    this.recordOverride(scene, 'toneMappingExposure');
                },
                undo: () => { scene.toneMappingExposure = oldVal; this.notifyChange(scene); }
            });
        }, scene, 'toneMappingExposure');
    }

    public createAudioSourceInspector(parent: HTMLElement, source: any): void {
        this.createUnityField(parent, 'Audio Clip', 'text', source.clipPath || '', (v) => {
            const oldVal = source.clipPath;
            CommandHistory.execute({
                name: 'Change Audio Clip',
                execute: () => {
                    source.loadClip(v);
                    this.recordOverride(source, 'clipPath');
                    this.notifyChange(source);
                },
                undo: () => {
                    source.loadClip(oldVal);
                    this.notifyChange(source);
                }
            });
        }, source, 'clipPath');

        this.createUnitySlider(parent, 'Volume', source.volume, 0, 1, (v) => {
            const oldVal = source.volume;
            CommandHistory.execute({
                name: 'Change Volume',
                execute: () => {
                    source.volume = v;
                    this.recordOverride(source, 'volume');
                    this.notifyChange(source);
                },
                undo: () => {
                    source.volume = oldVal;
                    this.notifyChange(source);
                }
            });
        }, source, 'volume');

        this.createUnitySlider(parent, 'Pitch', source.pitch, 0.5, 2, (v) => {
            const oldVal = source.pitch;
            CommandHistory.execute({
                name: 'Change Pitch',
                execute: () => {
                    source.pitch = v;
                    this.recordOverride(source, 'pitch');
                    this.notifyChange(source);
                },
                undo: () => {
                    source.pitch = oldVal;
                    this.notifyChange(source);
                }
            });
        }, source, 'pitch');

        this.createUnityCheckbox(parent, 'Spatial (3D)', source.spatial, (checked: boolean) => {
            const oldVal = source.spatial;
            CommandHistory.execute({
                name: 'Toggle Spatial Audio',
                execute: () => {
                    source.spatial = checked;
                    if (source.clipPath) source.loadClip(source.clipPath);
                    this.recordOverride(source, 'spatial');
                    this.notifyChange(source);
                },
                undo: () => {
                    source.spatial = oldVal;
                    if (source.clipPath) source.loadClip(source.clipPath);
                    this.notifyChange(source);
                }
            });
        }, source, 'spatial');

        this.createUnityCheckbox(parent, 'Loop', source.loop, (checked: boolean) => {
            const oldVal = source.loop;
            CommandHistory.execute({
                name: 'Toggle Audio Loop',
                execute: () => {
                    source.loop = checked;
                    this.recordOverride(source, 'loop');
                    this.notifyChange(source);
                },
                undo: () => {
                    source.loop = oldVal;
                    this.notifyChange(source);
                }
            });
        }, source, 'loop');

        const btnContainer = document.createElement('div');
        btnContainer.style.display = 'flex';
        btnContainer.style.gap = '5px';
        btnContainer.style.marginTop = '10px';
        parent.appendChild(btnContainer);

        const playBtn = document.createElement('button');
        playBtn.innerText = 'Play';
        playBtn.className = 'unity-button';
        this.styleUnityButton(playBtn);
        playBtn.onclick = () => source.play();
        btnContainer.appendChild(playBtn);

        const stopBtn = document.createElement('button');
        stopBtn.innerText = 'Stop';
        stopBtn.className = 'unity-button';
        this.styleUnityButton(stopBtn);
        stopBtn.onclick = () => source.stop();
        btnContainer.appendChild(stopBtn);
    }

    public createAudioListenerInspector(parent: HTMLElement, _listener: any): void {
        const info = document.createElement('div');
        info.innerText = "This object acts as the 'ears' of the scene.";
        info.style.fontStyle = 'italic';
        info.style.fontSize = '11px';
        info.style.padding = '5px';
        parent.appendChild(info);
    }

    public createParticleSystemInspector(parent: HTMLElement, ps: any): void {
        this.createUnityField(parent, 'Emission Rate', 'number', ps.emissionRate, (v) => {
            const oldVal = ps.emissionRate;
            const newVal = parseFloat(v);
            CommandHistory.execute({
                name: 'Change Emission Rate',
                execute: () => {
                    ps.emissionRate = newVal;
                    this.recordOverride(ps, 'emissionRate');
                    this.notifyChange(ps);
                },
                undo: () => {
                    ps.emissionRate = oldVal;
                    this.notifyChange(ps);
                }
            });
        }, ps, 'emissionRate');

        this.createUnityField(parent, 'Start Lifetime', 'number', ps.startLifetime, (v) => {
            const oldVal = ps.startLifetime;
            const newVal = parseFloat(v);
            CommandHistory.execute({
                name: 'Change Start Lifetime',
                execute: () => {
                    ps.startLifetime = newVal;
                    this.recordOverride(ps, 'startLifetime');
                    this.notifyChange(ps);
                },
                undo: () => {
                    ps.startLifetime = oldVal;
                    this.notifyChange(ps);
                }
            });
        }, ps, 'startLifetime');

        this.createUnitySlider(parent, 'Start Size', ps.startSize, 0.01, 2, (v) => {
            const oldVal = ps.startSize;
            CommandHistory.execute({
                name: 'Change Start Size',
                execute: () => {
                    ps.startSize = v;
                    this.recordOverride(ps, 'startSize');
                    this.notifyChange(ps);
                },
                undo: () => {
                    ps.startSize = oldVal;
                    this.notifyChange(ps);
                }
            });
        }, ps, 'startSize');

        this.createUnityField(parent, 'Texture Path', 'text', ps.texturePath || '', (v) => {
            const oldVal = ps.texturePath;
            CommandHistory.execute({
                name: 'Change Particle Texture',
                execute: () => {
                    ps.texturePath = v;
                    this.recordOverride(ps, 'texturePath');
                    this.notifyChange(ps);
                },
                undo: () => {
                    ps.texturePath = oldVal;
                    this.notifyChange(ps);
                }
            });
        }, ps, 'texturePath');

        this.createUnityCheckbox(parent, 'Loop', ps.loop, (checked: boolean) => {
            const oldVal = ps.loop;
            CommandHistory.execute({
                name: 'Toggle Particle Loop',
                execute: () => {
                    ps.loop = checked;
                    this.recordOverride(ps, 'loop');
                    this.notifyChange(ps);
                },
                undo: () => {
                    ps.loop = oldVal;
                    this.notifyChange(ps);
                }
            });
        }, ps, 'loop');

        const btnContainer = document.createElement('div');
        btnContainer.style.display = 'flex';
        btnContainer.style.gap = '5px';
        btnContainer.style.marginTop = '10px';
        parent.appendChild(btnContainer);

        const playBtn = document.createElement('button');
        playBtn.innerText = 'Play';
        playBtn.className = 'unity-button';
        this.styleUnityButton(playBtn);
        playBtn.onclick = () => ps.play();
        btnContainer.appendChild(playBtn);

        const stopBtn = document.createElement('button');
        stopBtn.innerText = 'Stop';
        stopBtn.className = 'unity-button';
        this.styleUnityButton(stopBtn);
        stopBtn.onclick = () => ps.stop();
        btnContainer.appendChild(stopBtn);
    }

    public createAnimatorInspector(parent: HTMLElement, animator: any): void {
        this.createUnityField(parent, 'Model Path (clips)', 'text', animator.modelPath || '', (v) => {
            const oldVal = animator.modelPath;
            CommandHistory.execute({
                name: 'Change Model Path',
                execute: () => {
                    animator.loadModelClips(v);
                    this.recordOverride(animator, 'modelPath');
                    this.notifyChange(animator);
                },
                undo: () => {
                    animator.loadModelClips(oldVal);
                    this.notifyChange(animator);
                }
            });
        }, animator, 'modelPath');

        this.createUnitySlider(parent, 'Speed', animator.speed, 0, 3, (v) => {
            const oldVal = animator.speed;
            CommandHistory.execute({
                name: 'Change Animation Speed',
                execute: () => {
                    animator.setSpeed(v);
                    this.recordOverride(animator, 'speed');
                    this.notifyChange(animator);
                },
                undo: () => {
                    animator.setSpeed(oldVal);
                    this.notifyChange(animator);
                }
            });
        }, animator, 'speed');

        this.createUnityCheckbox(parent, 'Loop', animator.loop, (checked: boolean) => {
            const oldVal = animator.loop;
            CommandHistory.execute({
                name: 'Toggle Animation Loop',
                execute: () => {
                    animator.loop = checked;
                    this.recordOverride(animator, 'loop');
                    this.notifyChange(animator);
                },
                undo: () => {
                    animator.loop = oldVal;
                    this.notifyChange(animator);
                }
            });
        }, animator, 'loop');

        this.createUnityCheckbox(parent, 'Play on Awake', animator.playOnAwake, (checked: boolean) => {
            const oldVal = animator.playOnAwake;
            CommandHistory.execute({
                name: 'Toggle Play on Awake',
                execute: () => {
                    animator.playOnAwake = checked;
                    this.recordOverride(animator, 'playOnAwake');
                    this.notifyChange(animator);
                },
                undo: () => {
                    animator.playOnAwake = oldVal;
                    this.notifyChange(animator);
                }
            });
        }, animator, 'playOnAwake');

        // List Animations
        const animList = document.createElement('div');
        animList.style.marginTop = '10px';
        animList.style.background = 'var(--unity-bg-dark)';
        animList.style.padding = '5px';
        animList.style.borderRadius = '3px';
        parent.appendChild(animList);

        const label = document.createElement('div');
        label.innerText = 'Animations:';
        label.style.fontSize = '11px';
        label.style.marginBottom = '5px';
        animList.appendChild(label);

        if (animator.animations.size === 0) {
            const none = document.createElement('div');
            none.innerText = 'No animations loaded';
            none.style.fontStyle = 'italic';
            none.style.fontSize = '10px';
            animList.appendChild(none);
        } else {
            animator.animations.forEach((_clip: any, name: string) => {
                const item = document.createElement('div');
                item.style.display = 'flex';
                item.style.justifyContent = 'space-between';
                item.style.alignItems = 'center';
                item.style.marginBottom = '2px';
                item.style.padding = '2px 4px';
                item.style.background = animator.currentAnimation === name ? 'var(--unity-accent)' : 'transparent';
                item.style.cursor = 'pointer';
                item.innerText = name;
                item.style.fontSize = '11px';

                item.onclick = () => {
                    animator.play(name);
                    this.refreshSelected ? this.refreshSelected() : null;
                };

                animList.appendChild(item);
            });
        }
    }

    private notifyChange(comp: any) {
        if (comp.updateVisuals) comp.updateVisuals();
        if (this.refreshSelected) this.refreshSelected();
    }

    private recordOverride(target: any, propertyName: string) {
        const go = target.gameObject || target;
        if (go && go.prefabSource && target.overrides) {
            target.overrides.add(propertyName);
        }
    }

    private setLabelOverrideStyle(labelElement: HTMLElement, target: any, propertyKey: string): void {
        if (!target) return;

        // Old system check
        let isOverridden = target.overrides && target.overrides.has(propertyKey);

        // New system check (if exists)
        // @ts-ignore
        const editor = window.Editor?.instance;
        if (editor && editor.isPropertyOverridden) {
            isOverridden = isOverridden || editor.isPropertyOverridden(target, propertyKey);
        }

        if (isOverridden) {
            labelElement.style.fontWeight = 'bold';
            labelElement.style.color = 'var(--unity-accent-light, #5cacee)';
        } else {
            labelElement.style.fontWeight = 'normal';
            labelElement.style.color = 'var(--unity-text-dim)';
        }
    }

    public createMaterialInspector(parent: HTMLElement, mat: any): void {
        const titleStyle = 'font-size: 11px; font-weight: bold; margin-bottom: 8px; color: #ccc; border-bottom: 1px solid #444; padding-bottom: 4px;';

        // --- Shader & Alpha ---
        const shaderGroup = document.createElement('div');
        shaderGroup.style.marginBottom = '10px';
        parent.appendChild(shaderGroup);

        this.createUnityDropdown(shaderGroup, 'Shader', ['Standard', 'Unlit', 'Transparent'], mat.shader, (v) => {
            const oldVal = mat.shader;
            CommandHistory.execute({
                name: 'Change Shader',
                execute: () => { mat.setShader(v as any); },
                undo: () => { mat.setShader(oldVal as any); }
            });
        }, mat);

        this.createUnityDropdown(shaderGroup, 'Alpha Mode', ['Opaque', 'Cutout', 'Fade', 'Transparent'], mat.alphaMode, (v) => {
            const oldVal = mat.alphaMode;
            CommandHistory.execute({
                name: 'Change Alpha Mode',
                execute: () => { mat.alphaMode = v; mat.updateThreeMaterial(); this.notifyChange(mat); },
                undo: () => { mat.alphaMode = oldVal; mat.updateThreeMaterial(); this.notifyChange(mat); }
            });
        }, mat);

        if (mat.alphaMode === 'Cutout') {
            this.createUnitySlider(shaderGroup, 'Alpha Cutoff', mat.alphaCutoff, 0, 1, (v) => {
                mat.alphaCutoff = v;
                mat.updateThreeMaterial();
                this.notifyChange(mat);
            }, mat);
        }

        if (mat.alphaMode === 'Fade' || mat.alphaMode === 'Transparent') {
            this.createUnitySlider(shaderGroup, 'Opacity', mat.surfaceOpacity ?? 1, 0, 1, (v) => {
                const oldVal = mat.surfaceOpacity ?? 1;
                CommandHistory.execute({
                    name: 'Change Material Opacity',
                    execute: () => { mat.setSurfaceOpacity?.(v); },
                    undo: () => { mat.setSurfaceOpacity?.(oldVal); }
                });
            }, mat);
        }

        this.createUnityCheckbox(shaderGroup, 'Depth Write', mat.depthWrite ?? true, (checked: boolean) => {
            const oldVal = mat.depthWrite ?? true;
            CommandHistory.execute({
                name: 'Toggle Material Depth Write',
                execute: () => { mat.setDepthWrite?.(checked); },
                undo: () => { mat.setDepthWrite?.(oldVal); }
            });
        }, mat);

        this.createUnityCheckbox(shaderGroup, 'Depth Test', mat.depthTest ?? true, (checked: boolean) => {
            const oldVal = mat.depthTest ?? true;
            CommandHistory.execute({
                name: 'Toggle Material Depth Test',
                execute: () => { mat.setDepthTest?.(checked); },
                undo: () => { mat.setDepthTest?.(oldVal); }
            });
        }, mat);

        this.createUnityField(shaderGroup, 'Render Order', 'number', mat.renderOrder ?? 0, (v) => {
            const oldVal = mat.renderOrder ?? 0;
            const nextVal = parseInt(v, 10);
            CommandHistory.execute({
                name: 'Change Material Render Order',
                execute: () => { mat.setRenderOrder?.(Number.isFinite(nextVal) ? nextVal : oldVal); },
                undo: () => { mat.setRenderOrder?.(oldVal); }
            });
        }, mat);

        const mainHeader = document.createElement('div');
        mainHeader.innerText = 'Main Maps';
        mainHeader.style.cssText = titleStyle + ' margin-top: 15px;';
        parent.appendChild(mainHeader);

        // Albedo / Color
        this.createUnityColorField(parent, 'Albedo', '#' + mat.color.getHexString(), (c) => {
            mat.setColor(new (window as any).THREE.Color(c));
        }, mat);
        this.createTextureSlot(parent, 'Albedo Map', mat.mainTexture, (tex) => {
            mat.setMainTexture(tex);
        }, mat);

        if (mat.shader === 'Standard' || mat.shader === 'Transparent') {
            // Metallic
            this.createUnitySlider(parent, 'Metallic', mat.metallic, 0, 1, (v) => {
                mat.setMetallic(v);
            }, mat);
            this.createTextureSlot(parent, 'Metallic Map', mat.metallicMap, (tex) => {
                mat.setMetallicMap(tex);
            }, mat);

            // Smoothness
            this.createUnitySlider(parent, 'Smoothness', mat.smoothness, 0, 1, (v) => {
                mat.setSmoothness(v);
            }, mat);
            this.createTextureSlot(parent, 'Roughness Map', mat.roughnessMap, (tex) => {
                mat.setRoughnessMap(tex);
            }, mat);

            // Normal Map
            this.createTextureSlot(parent, 'Normal Map', mat.normalMap, (tex) => {
                mat.setNormalMap(tex);
            }, mat);

            // Emission
            const emissionHeader = document.createElement('div');
            emissionHeader.innerText = 'Emission';
            emissionHeader.style.cssText = titleStyle + ' margin-top: 15px;';
            parent.appendChild(emissionHeader);

            this.createUnityColorField(parent, 'Color', '#' + mat.emission.getHexString(), (c) => {
                mat.emission.setHex(parseInt(c.replace('#', ''), 16));
                mat.updateThreeMaterial();
                this.notifyChange(mat);
            }, mat);
            this.createUnitySlider(parent, 'Intensity', mat.emissionIntensity, 0, 10, (v) => {
                mat.emissionIntensity = v;
                mat.updateThreeMaterial();
                this.notifyChange(mat);
            }, mat);
        }
    }

    // MeshRenderer Inspector
    public createMeshRendererInspector(parent: HTMLElement, renderer: any): void {
        // Material Slot
        this.createUnityObjectField(parent, 'Material', renderer.material, (mat) => {
            const oldVal = renderer.material;
            CommandHistory.execute({
                name: 'Change Material',
                execute: () => {
                    renderer.material = mat;
                    this.recordOverride(renderer, 'material');
                    this.notifyChange(renderer);
                },
                undo: () => {
                    renderer.material = oldVal;
                    this.notifyChange(renderer);
                }
            });
        }, renderer, 'material');

        this.createUnityField(parent, 'Sorting Priority', 'number', renderer.sortingPriority ?? 0, (v) => {
            const oldVal = renderer.sortingPriority ?? 0;
            const nextVal = parseInt(v, 10);
            CommandHistory.execute({
                name: 'Change Sorting Priority',
                execute: () => {
                    renderer.sortingPriority = Number.isFinite(nextVal) ? nextVal : oldVal;
                    renderer['syncMaterialRenderSettings']?.();
                    this.recordOverride(renderer, 'sortingPriority');
                    this.notifyChange(renderer);
                },
                undo: () => {
                    renderer.sortingPriority = oldVal;
                    renderer['syncMaterialRenderSettings']?.();
                    this.notifyChange(renderer);
                }
            });
        }, renderer, 'sortingPriority');

        // Shadows
        const shadowGroup = document.createElement('div');
        shadowGroup.style.display = 'flex';
        shadowGroup.style.gap = '10px';
        parent.appendChild(shadowGroup);

        this.createUnityCheckbox(shadowGroup, 'Cast Shadows', renderer.castShadow, (checked: boolean) => {
            const oldVal = renderer.castShadow;
            CommandHistory.execute({
                name: 'Toggle Cast Shadows',
                execute: () => {
                    renderer.castShadow = checked;
                    this.recordOverride(renderer, 'castShadow');
                    this.notifyChange(renderer);
                },
                undo: () => {
                    renderer.castShadow = oldVal;
                    this.notifyChange(renderer);
                }
            });
        }, renderer, 'castShadow');

        this.createUnityCheckbox(shadowGroup, 'Receive Shadows', renderer.receiveShadow, (checked: boolean) => {
            const oldVal = renderer.receiveShadow;
            CommandHistory.execute({
                name: 'Toggle Receive Shadows',
                execute: () => {
                    renderer.receiveShadow = checked;
                    this.recordOverride(renderer, 'receiveShadow');
                    this.notifyChange(renderer);
                },
                undo: () => {
                    renderer.receiveShadow = oldVal;
                    this.notifyChange(renderer);
                }
            });
        }, renderer, 'receiveShadow');
    }

    public createMeshFilterInspector(parent: HTMLElement, filter: any): void {
        const primitives = ['Cube', 'Sphere', 'Capsule', 'Cylinder', 'Plane', 'Quad', 'None'];
        this.createUnityDropdown(parent, 'Mesh', primitives, filter.primitiveType, (v) => {
            const oldVal = filter.primitiveType;
            CommandHistory.execute({
                name: 'Change Mesh Filter',
                execute: () => {
                    filter.setPrimitiveType(v as any);
                    this.recordOverride(filter, 'primitiveType');
                    this.notifyChange(filter);
                },
                undo: () => {
                    filter.setPrimitiveType(oldVal as any);
                    this.notifyChange(filter);
                }
            });
        }, filter, 'primitiveType');
    }

    // Camera Inspector
    public createCameraInspector(parent: HTMLElement, camera: any): void {
        // Clear Flags
        this.createUnityDropdown(parent, 'Clear Flags',
            ['Skybox', 'Solid Color', 'Depth Only', 'Don\'t Clear'],
            camera.clearFlags || 'Solid Color',
            (value) => {
                const oldVal = camera.clearFlags || 'Solid Color';
                CommandHistory.execute({
                    name: 'Change Camera Clear Flags',
                    execute: () => {
                        camera.setClearFlags?.(value);
                        this.recordOverride(camera, 'clearFlags');
                        this.notifyChange(camera);
                        this.refreshSelected?.();
                    },
                    undo: () => {
                        camera.setClearFlags?.(oldVal);
                        this.notifyChange(camera);
                        this.refreshSelected?.();
                    }
                });
            },
            camera, 'clearFlags'
        );

        // Background Color
        const shouldShowBackground = (camera.clearFlags || 'Solid Color') !== 'Depth Only'
            && (camera.clearFlags || 'Solid Color') !== "Don't Clear";
        if (shouldShowBackground) {
            const backgroundColor = camera.getClearColorHex?.() || '#4999cc';
            this.createUnityColorField(parent, 'Background', backgroundColor, (color) => {
                if (camera.clearColor) {
                    const oldVal = camera.clearColor.getStyle();
                    CommandHistory.execute({
                        name: 'Change Camera Color',
                        execute: () => {
                            camera.clearColor.set(color);
                            this.recordOverride(camera, 'clearColor');
                            this.notifyChange(camera);
                        },
                        undo: () => {
                            camera.clearColor.set(oldVal);
                            this.notifyChange(camera);
                        }
                    });
                }
            }, camera, 'clearColor');

            this.createUnitySlider(parent, 'Clear Alpha', camera.clearAlpha ?? 1, 0, 1, (v) => {
                const oldVal = camera.clearAlpha ?? 1;
                CommandHistory.execute({
                    name: 'Change Camera Clear Alpha',
                    execute: () => {
                        camera.setClearAlpha?.(v);
                        this.recordOverride(camera, 'clearAlpha');
                        this.notifyChange(camera);
                    },
                    undo: () => {
                        camera.setClearAlpha?.(oldVal);
                        this.notifyChange(camera);
                    }
                });
            }, camera, 'clearAlpha');
        }

        // Projection
        this.createUnityDropdown(parent, 'Projection',
            ['Perspective', 'Orthographic'],
            camera.orthographic ? 'Orthographic' : 'Perspective',
            (value) => {
                const oldVal = camera.orthographic;
                const newVal = value === 'Orthographic';
                CommandHistory.execute({
                    name: 'Change Projection',
                    execute: () => {
                        camera.setOrthographic(newVal);
                        this.recordOverride(camera, 'orthographic');
                        this.notifyChange(camera);
                    },
                    undo: () => {
                        camera.setOrthographic(oldVal);
                        this.notifyChange(camera);
                    }
                });
            },
            camera, 'orthographic'
        );

        // Field of View (Perspective only)
        if (!camera.orthographic) {
            this.createUnitySlider(parent, 'Field of View', camera.fieldOfView || 60, 1, 179, (v) => {
                const oldVal = camera.fieldOfView;
                CommandHistory.execute({
                    name: 'Change FOV',
                    execute: () => {
                        camera.setFieldOfView(v);
                        this.recordOverride(camera, 'fieldOfView');
                        this.notifyChange(camera);
                    },
                    undo: () => {
                        camera.setFieldOfView(oldVal);
                        this.notifyChange(camera);
                    }
                });
            }, camera, 'fieldOfView');
        } else {
            this.createUnityField(parent, 'Size', 'number', camera.orthographicSize || 5, (v) => {
                const oldVal = camera.orthographicSize;
                const newVal = parseFloat(v);
                CommandHistory.execute({
                    name: 'Change Camera Size',
                    execute: () => {
                        camera.setOrthographicSize(newVal);
                        this.recordOverride(camera, 'orthographicSize');
                        this.notifyChange(camera);
                    },
                    undo: () => {
                        camera.setOrthographicSize(oldVal);
                        this.notifyChange(camera);
                    }
                });
            }, camera, 'orthographicSize');
        }

        // Clipping Planes
        this.createUnityField(parent, 'Near', 'number', camera.nearClipPlane || 0.1, (v) => {
            const oldNear = camera.nearClipPlane;
            const newNear = parseFloat(v);
            CommandHistory.execute({
                name: 'Change Near Plane',
                execute: () => {
                    camera.setClippingPlanes(newNear, camera.farClipPlane);
                    this.recordOverride(camera, 'nearClipPlane');
                    this.notifyChange(camera);
                },
                undo: () => {
                    camera.setClippingPlanes(oldNear, camera.farClipPlane);
                    this.notifyChange(camera);
                }
            });
        }, camera, 'nearClipPlane');
        this.createUnityField(parent, 'Far', 'number', camera.farClipPlane || 1000, (v) => {
            const oldFar = camera.farClipPlane;
            const newFar = parseFloat(v);
            CommandHistory.execute({
                name: 'Change Far Plane',
                execute: () => {
                    camera.setClippingPlanes(camera.nearClipPlane, newFar);
                    this.recordOverride(camera, 'farClipPlane');
                    this.notifyChange(camera);
                },
                undo: () => {
                    camera.setClippingPlanes(camera.nearClipPlane, oldFar);
                    this.notifyChange(camera);
                }
            });
        }, camera, 'farClipPlane');

        // Depth
        this.createUnityField(parent, 'Depth', 'number', camera.depth || 0, (v) => {
            const oldVal = camera.depth;
            const newVal = parseInt(v);
            CommandHistory.execute({
                name: 'Change Camera Depth',
                execute: () => {
                    camera.depth = newVal;
                    this.recordOverride(camera, 'depth');
                    this.notifyChange(camera);
                },
                undo: () => {
                    camera.depth = oldVal;
                    this.notifyChange(camera);
                }
            });
        }, camera, 'depth');

        this.createUnityCheckbox(parent, 'Post Processing', camera.usePostProcessing ?? true, (checked: boolean) => {
            const oldVal = camera.usePostProcessing ?? true;
            CommandHistory.execute({
                name: 'Toggle Camera Post Processing',
                execute: () => {
                    camera.usePostProcessing = checked;
                    this.recordOverride(camera, 'usePostProcessing');
                    this.notifyChange(camera);
                },
                undo: () => {
                    camera.usePostProcessing = oldVal;
                    this.notifyChange(camera);
                }
            });
        }, camera, 'usePostProcessing');

        this.createUnityDropdown(parent, 'Render Type', ['Base', 'Overlay'], camera.renderType || 'Base', (value) => {
            const oldType = camera.renderType || 'Base';
            const oldBaseCamera = camera.stackBaseCamera || null;
            CommandHistory.execute({
                name: 'Change Camera Render Type',
                execute: () => {
                    camera.setRenderType?.(value);
                    if (value !== 'Overlay') {
                        camera.stackBaseCamera = null;
                    }
                    this.recordOverride(camera, 'renderType');
                    this.recordOverride(camera, 'stackBaseCamera');
                    this.notifyChange(camera);
                    this.refreshSelected?.();
                },
                undo: () => {
                    camera.setRenderType?.(oldType);
                    camera.stackBaseCamera = oldBaseCamera;
                    this.notifyChange(camera);
                    this.refreshSelected?.();
                }
            });
        }, camera, 'renderType');

        if ((camera.renderType || 'Base') === 'Overlay') {
            this.createUnityObjectField(parent, 'Base Camera', camera.stackBaseCamera || null, (value) => {
                const oldVal = camera.stackBaseCamera || null;
                CommandHistory.execute({
                    name: 'Change Overlay Base Camera',
                    execute: () => {
                        camera.stackBaseCamera = value || null;
                        camera.renderType = 'Overlay';
                        this.recordOverride(camera, 'stackBaseCamera');
                        this.recordOverride(camera, 'renderType');
                        this.notifyChange(camera);
                    },
                    undo: () => {
                        camera.stackBaseCamera = oldVal;
                        this.notifyChange(camera);
                    }
                });
            }, camera, 'stackBaseCamera');
        }

        const viewportPresetLabel = document.createElement('div');
        viewportPresetLabel.innerText = 'Viewport Presets';
        viewportPresetLabel.style.cssText = 'font-size: 11px; color: var(--unity-text-dim); margin: 6px 0 4px 4px;';
        parent.appendChild(viewportPresetLabel);

        const viewportPresetRow = document.createElement('div');
        viewportPresetRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 6px 0;';
        parent.appendChild(viewportPresetRow);

        const makeViewportPresetButton = (
            label: string,
            title: string,
            rect: { x: number; y: number; width: number; height: number }
        ) => {
            const btn = document.createElement('button');
            btn.innerText = label;
            btn.title = title;
            btn.style.cssText = `
                padding: 2px 6px;
                background: var(--unity-bg-header);
                border: 1px solid var(--unity-border);
                color: var(--unity-text);
                cursor: pointer;
                font-size: 10px;
                border-radius: 2px;
            `;
            btn.onclick = () => {
                const oldRect = { ...(camera.viewportRect || { x: 0, y: 0, width: 1, height: 1 }) };
                CommandHistory.execute({
                    name: `Camera Viewport Preset ${title}`,
                    execute: () => {
                        camera.setViewportRect?.(rect);
                        this.recordOverride(camera, 'viewportRect');
                        this.notifyChange(camera);
                        this.refreshSelected?.();
                    },
                    undo: () => {
                        camera.setViewportRect?.(oldRect);
                        this.notifyChange(camera);
                        this.refreshSelected?.();
                    }
                });
            };
            viewportPresetRow.appendChild(btn);
        };

        makeViewportPresetButton('Full', 'Full', { x: 0, y: 0, width: 1, height: 1 });
        makeViewportPresetButton('Left', 'Left Half', { x: 0, y: 0, width: 0.5, height: 1 });
        makeViewportPresetButton('Right', 'Right Half', { x: 0.5, y: 0, width: 0.5, height: 1 });
        makeViewportPresetButton('Top', 'Top Half', { x: 0, y: 0.5, width: 1, height: 0.5 });
        makeViewportPresetButton('Bottom', 'Bottom Half', { x: 0, y: 0, width: 1, height: 0.5 });
        makeViewportPresetButton('Quad TL', 'Top Left Quad', { x: 0, y: 0.5, width: 0.5, height: 0.5 });
        makeViewportPresetButton('Quad TR', 'Top Right Quad', { x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
        makeViewportPresetButton('Quad BL', 'Bottom Left Quad', { x: 0, y: 0, width: 0.5, height: 0.5 });
        makeViewportPresetButton('Quad BR', 'Bottom Right Quad', { x: 0.5, y: 0, width: 0.5, height: 0.5 });

        const viewportRect = camera.viewportRect || { x: 0, y: 0, width: 1, height: 1 };
        this.createUnityField(parent, 'Viewport X', 'number', viewportRect.x, (v) => {
            const oldVal = camera.viewportRect?.x ?? 0;
            const nextVal = Math.max(0, Math.min(1, Number.isFinite(v) ? v : oldVal));
            CommandHistory.execute({
                name: 'Change Camera Viewport X',
                execute: () => {
                    camera.setViewportRect?.({ x: nextVal });
                    this.recordOverride(camera, 'viewportRect');
                    this.notifyChange(camera);
                },
                undo: () => {
                    camera.setViewportRect?.({ x: oldVal });
                    this.notifyChange(camera);
                }
            });
        }, camera, 'viewportRect');

        this.createUnityField(parent, 'Viewport Y', 'number', viewportRect.y, (v) => {
            const oldVal = camera.viewportRect?.y ?? 0;
            const nextVal = Math.max(0, Math.min(1, Number.isFinite(v) ? v : oldVal));
            CommandHistory.execute({
                name: 'Change Camera Viewport Y',
                execute: () => {
                    camera.setViewportRect?.({ y: nextVal });
                    this.recordOverride(camera, 'viewportRect');
                    this.notifyChange(camera);
                },
                undo: () => {
                    camera.setViewportRect?.({ y: oldVal });
                    this.notifyChange(camera);
                }
            });
        }, camera, 'viewportRect');

        this.createUnityField(parent, 'Viewport W', 'number', viewportRect.width, (v) => {
            const oldVal = camera.viewportRect?.width ?? 1;
            const nextVal = Math.max(0, Math.min(1, Number.isFinite(v) ? v : oldVal));
            CommandHistory.execute({
                name: 'Change Camera Viewport Width',
                execute: () => {
                    camera.setViewportRect?.({ width: nextVal });
                    this.recordOverride(camera, 'viewportRect');
                    this.notifyChange(camera);
                },
                undo: () => {
                    camera.setViewportRect?.({ width: oldVal });
                    this.notifyChange(camera);
                }
            });
        }, camera, 'viewportRect');

        this.createUnityField(parent, 'Viewport H', 'number', viewportRect.height, (v) => {
            const oldVal = camera.viewportRect?.height ?? 1;
            const nextVal = Math.max(0, Math.min(1, Number.isFinite(v) ? v : oldVal));
            CommandHistory.execute({
                name: 'Change Camera Viewport Height',
                execute: () => {
                    camera.setViewportRect?.({ height: nextVal });
                    this.recordOverride(camera, 'viewportRect');
                    this.notifyChange(camera);
                },
                undo: () => {
                    camera.setViewportRect?.({ height: oldVal });
                    this.notifyChange(camera);
                }
            });
        }, camera, 'viewportRect');

        // Culling Mask
        this.createCullingMaskField(parent, camera);
    }

    /** Renders a culling mask UI (layer checkboxes) for a Camera component. */
    public createCullingMaskField(parent: HTMLElement, camera: any): void {
        const lm = LayerManager.getInstance();
        const namedLayers = lm.getNamedLayers();
        const applyMaskCommand = (label: string, nextMask: number) => {
            const oldMask = camera.cullingMask ?? -1;
            if (oldMask === nextMask) return;
            CommandHistory.execute({
                name: label,
                execute: () => {
                    camera.cullingMask = nextMask;
                    this.recordOverride(camera, 'cullingMask');
                    this.notifyChange(camera);
                },
                undo: () => {
                    camera.cullingMask = oldMask;
                    this.notifyChange(camera);
                }
            });
        };

        const section = document.createElement('div');
        section.style.cssText = 'margin-top: 8px;';

        const header = document.createElement('div');
        header.style.cssText = `
            font-size: 11px; font-weight: bold; color: var(--unity-text-dim);
            margin-bottom: 4px; padding-top: 6px;
            border-top: 1px solid var(--unity-border);
        `;
        header.innerText = 'Culling Mask';
        section.appendChild(header);

        // Quick buttons
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 4px; margin-bottom: 6px;';

        const makeQuickBtn = (label: string, nextMaskFactory: () => number) => {
            const btn = document.createElement('button');
            btn.innerText = label;
            btn.style.cssText = `
                padding: 2px 6px; background: var(--unity-bg-header);
                border: 1px solid var(--unity-border); color: var(--unity-text);
                cursor: pointer; font-size: 10px; border-radius: 2px;
            `;
            btn.onclick = () => {
                applyMaskCommand(`Set Camera Culling Mask ${label}`, nextMaskFactory());
                renderCheckboxes();
            };
            return btn;
        };

        btnRow.appendChild(makeQuickBtn('Everything', () => -1));
        btnRow.appendChild(makeQuickBtn('Nothing', () => 0));
        btnRow.appendChild(makeQuickBtn('Default Only', () => (1 << 0)));
        btnRow.appendChild(makeQuickBtn('UI Only', () => {
            const uiLayer = lm.nameToLayer('UI');
            return uiLayer >= 0 ? (1 << uiLayer) : 0;
        }));
        section.appendChild(btnRow);

        const checkboxContainer = document.createElement('div');
        checkboxContainer.style.cssText = `
            background: var(--unity-bg-dark); border: 1px solid var(--unity-border);
            border-radius: 3px; padding: 4px;
        `;
        section.appendChild(checkboxContainer);

        const renderCheckboxes = () => {
            checkboxContainer.innerHTML = '';
            namedLayers.forEach(layer => {
                const row = document.createElement('div');
                row.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-bottom: 2px;';

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = camera.cullingMask === -1 || (camera.cullingMask & (1 << layer.index)) !== 0;
                cb.style.cursor = 'pointer';
                cb.onchange = () => {
                    let nextMask = camera.cullingMask ?? -1;
                    if (nextMask === -1) {
                        // Start from Everything, then remove this layer
                        nextMask = 0xFFFFFFFF;
                    }
                    if (cb.checked) {
                        nextMask |= (1 << layer.index);
                    } else {
                        nextMask &= ~(1 << layer.index);
                    }
                    applyMaskCommand(`Toggle Camera Culling Layer ${layer.name}`, nextMask);
                };

                const lbl = document.createElement('label');
                lbl.innerText = layer.name;
                lbl.style.cssText = 'font-size: 11px; cursor: pointer;';
                lbl.onclick = () => { cb.click(); };

                row.appendChild(cb);
                row.appendChild(lbl);
                checkboxContainer.appendChild(row);
            });

            if (namedLayers.length === 0) {
                const msg = document.createElement('div');
                msg.innerText = 'No named layers. Add layers in Project Settings.';
                msg.style.cssText = 'font-size: 10px; color: var(--unity-text-dim); font-style: italic;';
                checkboxContainer.appendChild(msg);
            }
        };
        renderCheckboxes();

        parent.appendChild(section);
    }

    public createLightInspector(parent: HTMLElement, light: any): void {
        // Type
        this.createUnityDropdown(parent, 'Type',
            ['Directional', 'Point', 'Spot', 'Ambient'],
            light.lightType || 'Directional',
            (value) => {
                const oldVal = light.lightType;
                CommandHistory.execute({
                    name: 'Change Light Type',
                    execute: () => {
                        light.setLightType(value);
                        this.recordOverride(light, 'lightType');
                        this.notifyChange(light);
                    },
                    undo: () => {
                        light.setLightType(oldVal);
                        this.notifyChange(light);
                    }
                });
            },
            light, 'lightType'
        );

        // Color
        this.createUnityColorField(parent, 'Color', '#ffffff', (color) => {
            const oldVal = '#' + light.light.color.getHexString();
            CommandHistory.execute({
                name: 'Change Light Color',
                execute: () => {
                    light.setColor(new (window as any).THREE.Color(color));
                    this.recordOverride(light, 'color');
                    this.notifyChange(light);
                },
                undo: () => {
                    light.setColor(new (window as any).THREE.Color(oldVal));
                    this.notifyChange(light);
                }
            });
        }, light, 'color');

        // Intensity
        this.createUnitySlider(parent, 'Intensity', light.intensity || 1, 0, 8, (v) => {
            const oldVal = light.intensity;
            CommandHistory.execute({
                name: 'Change Light Intensity',
                execute: () => {
                    light.setIntensity(v);
                    this.recordOverride(light, 'intensity');
                    this.notifyChange(light);
                },
                undo: () => {
                    light.setIntensity(oldVal);
                    this.notifyChange(light);
                }
            });
        }, light, 'intensity');

        // Range (Point and Spot only)
        if (light.lightType === 'Point' || light.lightType === 'Spot') {
            this.createUnityField(parent, 'Range', 'number', light.range || 10, (v) => {
                const oldVal = light.range;
                const newVal = parseFloat(v);
                CommandHistory.execute({
                    name: 'Change Light Range',
                    execute: () => {
                        light.setRange(newVal);
                        this.recordOverride(light, 'range');
                        this.notifyChange(light);
                    },
                    undo: () => {
                        light.setRange(oldVal);
                        this.notifyChange(light);
                    }
                });
            }, light, 'range');
        }

        // Spot Angle (Spot only)
        if (light.lightType === 'Spot') {
            this.createUnitySlider(parent, 'Spot Angle', light.spotAngle || 30, 1, 179, (v) => {
                const oldVal = light.spotAngle;
                CommandHistory.execute({
                    name: 'Change Spot Angle',
                    execute: () => {
                        light.setSpotAngle(v);
                        this.recordOverride(light, 'spotAngle');
                        this.notifyChange(light);
                    },
                    undo: () => {
                        light.setSpotAngle(oldVal);
                        this.notifyChange(light);
                    }
                });
            }, light, 'spotAngle');
        }

        // Shadows
        this.createUnityCheckbox(parent, 'Cast Shadows', light.castShadows || false, (checked: boolean) => {
            const oldVal = light.castShadows;
            CommandHistory.execute({
                name: 'Toggle Light Shadows',
                execute: () => {
                    light.setCastShadows(checked);
                    this.recordOverride(light, 'castShadows');
                    this.notifyChange(light);
                },
                undo: () => {
                    light.setCastShadows(oldVal);
                    this.notifyChange(light);
                }
            });
        }, light, 'castShadows');

        if (light.castShadows) {
            const shadowGroup = document.createElement('div');
            shadowGroup.style.paddingLeft = '15px';
            shadowGroup.style.borderLeft = '1px solid var(--unity-border)';
            shadowGroup.style.marginTop = '5px';
            parent.appendChild(shadowGroup);

            this.createUnityDropdown(shadowGroup, 'Resolution', ['512', '1024', '2048', '4096'], light.shadowResolution.toString(), (v) => {
                const oldVal = light.shadowResolution;
                const newVal = parseInt(v);
                CommandHistory.execute({
                    name: 'Change Shadow Resolution',
                    execute: () => {
                        light.shadowResolution = newVal;
                        light.updateLight();
                        this.recordOverride(light, 'shadowResolution');
                        this.notifyChange(light);
                    },
                    undo: () => {
                        light.shadowResolution = oldVal;
                        light.updateLight();
                        this.notifyChange(light);
                    }
                });
            }, light, 'shadowResolution');

            this.createUnitySlider(shadowGroup, 'Shadow Bias', light.shadowBias, -0.01, 0.01, (v) => {
                const oldVal = light.shadowBias;
                CommandHistory.execute({
                    name: 'Change Shadow Bias',
                    execute: () => {
                        light.shadowBias = v;
                        if (light.light && light.light.shadow) light.light.shadow.bias = v;
                        this.recordOverride(light, 'shadowBias');
                        this.notifyChange(light);
                    },
                    undo: () => {
                        light.shadowBias = oldVal;
                        if (light.light && light.light.shadow) light.light.shadow.bias = oldVal;
                        this.notifyChange(light);
                    }
                });
            }, light, 'shadowBias');

            this.createUnitySlider(shadowGroup, 'Normal Bias', light.shadowNormalBias, 0, 0.1, (v) => {
                const oldVal = light.shadowNormalBias;
                CommandHistory.execute({
                    name: 'Change Normal Bias',
                    execute: () => {
                        light.shadowNormalBias = v;
                        if (light.light && light.light.shadow) light.light.shadow.normalBias = v;
                        this.recordOverride(light, 'shadowNormalBias');
                        this.notifyChange(light);
                    },
                    undo: () => {
                        light.shadowNormalBias = oldVal;
                        if (light.light && light.light.shadow) light.light.shadow.normalBias = oldVal;
                        this.notifyChange(light);
                    }
                });
            }, light, 'shadowNormalBias');

            this.createUnitySlider(shadowGroup, 'Shadow Radius', light.shadowRadius, 0, 10, (v) => {
                const oldVal = light.shadowRadius;
                CommandHistory.execute({
                    name: 'Change Shadow Radius',
                    execute: () => {
                        light.shadowRadius = v;
                        if (light.light && light.light.shadow) light.light.shadow.radius = v;
                        this.recordOverride(light, 'shadowRadius');
                        this.notifyChange(light);
                    },
                    undo: () => {
                        light.shadowRadius = oldVal;
                        if (light.light && light.light.shadow) light.light.shadow.radius = oldVal;
                        this.notifyChange(light);
                    }
                });
            }, light, 'shadowRadius');
        }

        this.createLightCullingMaskField(parent, light);
    }

    public createLightCullingMaskField(parent: HTMLElement, light: any): void {
        const lm = LayerManager.getInstance();
        const namedLayers = lm.getNamedLayers();
        const applyMaskCommand = (label: string, nextMask: number) => {
            const oldMask = light.cullingMask ?? -1;
            if (oldMask === nextMask) return;
            CommandHistory.execute({
                name: label,
                execute: () => {
                    light.setCullingMask?.(nextMask);
                    this.recordOverride(light, 'cullingMask');
                    this.notifyChange(light);
                },
                undo: () => {
                    light.setCullingMask?.(oldMask);
                    this.notifyChange(light);
                }
            });
        };

        const section = document.createElement('div');
        section.style.cssText = 'margin-top: 8px;';

        const header = document.createElement('div');
        header.style.cssText = `
            font-size: 11px; font-weight: bold; color: var(--unity-text-dim);
            margin-bottom: 4px; padding-top: 6px;
            border-top: 1px solid var(--unity-border);
        `;
        header.innerText = 'Light Culling Mask';
        section.appendChild(header);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; gap: 4px; margin-bottom: 6px;';

        const makeQuickBtn = (label: string, nextMaskFactory: () => number) => {
            const btn = document.createElement('button');
            btn.innerText = label;
            btn.style.cssText = `
                padding: 2px 6px; background: var(--unity-bg-header);
                border: 1px solid var(--unity-border); color: var(--unity-text);
                cursor: pointer; font-size: 10px; border-radius: 2px;
            `;
            btn.onclick = () => {
                applyMaskCommand(`Set Light Culling Mask ${label}`, nextMaskFactory());
                renderCheckboxes();
            };
            return btn;
        };

        btnRow.appendChild(makeQuickBtn('Everything', () => -1));
        btnRow.appendChild(makeQuickBtn('Nothing', () => 0));
        btnRow.appendChild(makeQuickBtn('Default Only', () => (1 << 0)));
        btnRow.appendChild(makeQuickBtn('UI Only', () => {
            const uiLayer = lm.nameToLayer('UI');
            return uiLayer >= 0 ? (1 << uiLayer) : 0;
        }));
        section.appendChild(btnRow);

        const checkboxContainer = document.createElement('div');
        checkboxContainer.style.cssText = `
            background: var(--unity-bg-dark); border: 1px solid var(--unity-border);
            border-radius: 3px; padding: 4px;
        `;
        section.appendChild(checkboxContainer);

        const renderCheckboxes = () => {
            checkboxContainer.innerHTML = '';
            namedLayers.forEach((layer) => {
                const row = document.createElement('div');
                row.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-bottom: 2px;';

                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.checked = light.cullingMask === -1 || (light.cullingMask & (1 << layer.index)) !== 0;
                cb.style.cursor = 'pointer';
                cb.onchange = () => {
                    let nextMask = light.cullingMask ?? -1;
                    if (nextMask === -1) {
                        nextMask = 0xFFFFFFFF;
                    }
                    if (cb.checked) {
                        nextMask |= (1 << layer.index);
                    } else {
                        nextMask &= ~(1 << layer.index);
                    }
                    applyMaskCommand(`Toggle Light Culling Layer ${layer.name}`, nextMask);
                };

                const lbl = document.createElement('label');
                lbl.innerText = layer.name;
                lbl.style.cssText = 'font-size: 11px; cursor: pointer;';
                lbl.onclick = () => { cb.click(); };

                row.appendChild(cb);
                row.appendChild(lbl);
                checkboxContainer.appendChild(row);
            });

            if (namedLayers.length === 0) {
                const msg = document.createElement('div');
                msg.innerText = 'No named layers. Add layers in Project Settings.';
                msg.style.cssText = 'font-size: 10px; color: var(--unity-text-dim); font-style: italic;';
                checkboxContainer.appendChild(msg);
            }
        };

        renderCheckboxes();
        parent.appendChild(section);
    }


    // Collider Inspector
    public createColliderInspector(parent: HTMLElement, collider: any): void {
        const isBox = collider.constructor.name === 'BoxCollider';
        const isSphere = collider.constructor.name === 'SphereCollider';

        // Is Trigger
        this.createUnityCheckbox(parent, 'Is Trigger', collider.isTrigger || false, (checked: boolean) => {
            const oldVal = collider.isTrigger;
            CommandHistory.execute({
                name: 'Toggle Is Trigger',
                execute: () => {
                    collider.isTrigger = checked;
                    this.recordOverride(collider, 'isTrigger');
                    this.notifyChange(collider);
                },
                undo: () => {
                    collider.isTrigger = oldVal;
                    this.notifyChange(collider);
                }
            });
        }, collider, 'isTrigger');

        // Center
        this.createVector3Field(parent, 'Center', collider.center, (axis, val) => {
            const oldVal = (collider.center as any)[axis];
            CommandHistory.execute({
                name: `Change Collider Center ${axis}`,
                execute: () => {
                    (collider.center as any)[axis] = val;
                    collider.setCenter(collider.center);
                    this.recordOverride(collider, 'center');
                    this.notifyChange(collider);
                },
                undo: () => {
                    (collider.center as any)[axis] = oldVal;
                    collider.setCenter(collider.center);
                    this.notifyChange(collider);
                }
            });
        }, collider, 'center');

        // Size or Radius
        if (isBox) {
            this.createVector3Field(parent, 'Size', collider.size, (axis, val) => {
                const oldVal = (collider.size as any)[axis];
                CommandHistory.execute({
                    name: `Change Collider Size ${axis}`,
                    execute: () => {
                        (collider.size as any)[axis] = val;
                        collider.setSize(collider.size);
                        this.recordOverride(collider, 'size');
                        this.notifyChange(collider);
                    },
                    undo: () => {
                        (collider.size as any)[axis] = oldVal;
                        collider.setSize(collider.size);
                        this.notifyChange(collider);
                    }
                });
            }, collider, 'size');
        } else if (isSphere) {
            this.createUnityField(parent, 'Radius', 'number', collider.radius || 0.5, (v) => {
                const oldVal = collider.radius;
                const newVal = parseFloat(v);
                CommandHistory.execute({
                    name: 'Change Collider Radius',
                    execute: () => {
                        collider.setRadius(newVal);
                        this.recordOverride(collider, 'radius');
                        this.notifyChange(collider);
                    },
                    undo: () => {
                        collider.setRadius(oldVal);
                        this.notifyChange(collider);
                    }
                });
            }, collider, 'radius');
        }
    }

    // RigidBody Inspector
    public createRigidBodyInspector(parent: HTMLElement, rb: any): void {
        // Mass
        this.createUnityField(parent, 'Mass', 'number', rb.mass, (v) => {
            const oldVal = rb.mass;
            const newVal = parseFloat(v);
            CommandHistory.execute({
                name: 'Change RigidBody Mass',
                execute: () => {
                    rb.setMass(newVal);
                    this.recordOverride(rb, 'mass');
                    this.notifyChange(rb);
                },
                undo: () => {
                    rb.setMass(oldVal);
                    this.notifyChange(rb);
                }
            });
        }, rb, 'mass');

        // Velocity
        const vel = rb.getVelocity();
        this.createVector3Field(parent, 'Velocity', vel, (axis, val) => {
            const oldVel = rb.getVelocity();
            const oldVal = (oldVel as any)[axis];
            CommandHistory.execute({
                name: `Change Velocity ${axis}`,
                execute: () => {
                    const current = rb.getVelocity();
                    (current as any)[axis] = val;
                    rb.setVelocity(current.x, current.y, current.z);
                    this.recordOverride(rb, 'velocity');
                    this.notifyChange(rb);
                },
                undo: () => {
                    const current = rb.getVelocity();
                    (current as any)[axis] = oldVal;
                    rb.setVelocity(current.x, current.y, current.z);
                    this.notifyChange(rb);
                }
            });
        }, rb, 'velocity');

        this.createUnityCheckbox(parent, 'Is Kinematic', rb.isKinematic ?? false, (checked: boolean) => {
            const oldVal = rb.isKinematic ?? false;
            CommandHistory.execute({
                name: 'Toggle RigidBody Is Kinematic',
                execute: () => {
                    rb.setKinematic?.(checked);
                    this.recordOverride(rb, 'isKinematic');
                    this.notifyChange(rb);
                },
                undo: () => {
                    rb.setKinematic?.(oldVal);
                    this.notifyChange(rb);
                }
            });
        }, rb, 'isKinematic');

        this.createUnityCheckbox(parent, 'Use Gravity', rb.useGravity ?? true, (checked: boolean) => {
            const oldVal = rb.useGravity ?? true;
            CommandHistory.execute({
                name: 'Toggle RigidBody Use Gravity',
                execute: () => {
                    rb.setUseGravity?.(checked);
                    this.recordOverride(rb, 'useGravity');
                    this.notifyChange(rb);
                },
                undo: () => {
                    rb.setUseGravity?.(oldVal);
                    this.notifyChange(rb);
                }
            });
        }, rb, 'useGravity');

        this.createUnityField(parent, 'Drag', 'number', rb.drag ?? 0, (v) => {
            const oldVal = rb.drag ?? 0;
            const nextVal = Math.max(0, Number.isFinite(v) ? v : oldVal);
            CommandHistory.execute({
                name: 'Change RigidBody Drag',
                execute: () => {
                    rb.setDrag?.(nextVal);
                    this.recordOverride(rb, 'drag');
                    this.notifyChange(rb);
                },
                undo: () => {
                    rb.setDrag?.(oldVal);
                    this.notifyChange(rb);
                }
            });
        }, rb, 'drag');

        this.createUnityField(parent, 'Angular Drag', 'number', rb.angularDrag ?? 0.05, (v) => {
            const oldVal = rb.angularDrag ?? 0.05;
            const nextVal = Math.max(0, Number.isFinite(v) ? v : oldVal);
            CommandHistory.execute({
                name: 'Change RigidBody Angular Drag',
                execute: () => {
                    rb.setAngularDrag?.(nextVal);
                    this.recordOverride(rb, 'angularDrag');
                    this.notifyChange(rb);
                },
                undo: () => {
                    rb.setAngularDrag?.(oldVal);
                    this.notifyChange(rb);
                }
            });
        }, rb, 'angularDrag');

        this.createUnityCheckbox(parent, 'Freeze Rot X', rb.freezeRotationX ?? false, (checked: boolean) => {
            const oldX = rb.freezeRotationX ?? false;
            CommandHistory.execute({
                name: 'Toggle RigidBody Freeze Rot X',
                execute: () => {
                    rb.setFreezeRotation?.(checked, rb.freezeRotationY ?? false, rb.freezeRotationZ ?? false);
                    this.recordOverride(rb, 'freezeRotationX');
                    this.notifyChange(rb);
                },
                undo: () => {
                    rb.setFreezeRotation?.(oldX, rb.freezeRotationY ?? false, rb.freezeRotationZ ?? false);
                    this.notifyChange(rb);
                }
            });
        }, rb, 'freezeRotationX');

        this.createUnityCheckbox(parent, 'Freeze Pos X', rb.freezePositionX ?? false, (checked: boolean) => {
            const oldX = rb.freezePositionX ?? false;
            CommandHistory.execute({
                name: 'Toggle RigidBody Freeze Pos X',
                execute: () => {
                    rb.setFreezePosition?.(checked, rb.freezePositionY ?? false, rb.freezePositionZ ?? false);
                    this.recordOverride(rb, 'freezePositionX');
                    this.notifyChange(rb);
                },
                undo: () => {
                    rb.setFreezePosition?.(oldX, rb.freezePositionY ?? false, rb.freezePositionZ ?? false);
                    this.notifyChange(rb);
                }
            });
        }, rb, 'freezePositionX');

        this.createUnityCheckbox(parent, 'Freeze Pos Y', rb.freezePositionY ?? false, (checked: boolean) => {
            const oldY = rb.freezePositionY ?? false;
            CommandHistory.execute({
                name: 'Toggle RigidBody Freeze Pos Y',
                execute: () => {
                    rb.setFreezePosition?.(rb.freezePositionX ?? false, checked, rb.freezePositionZ ?? false);
                    this.recordOverride(rb, 'freezePositionY');
                    this.notifyChange(rb);
                },
                undo: () => {
                    rb.setFreezePosition?.(rb.freezePositionX ?? false, oldY, rb.freezePositionZ ?? false);
                    this.notifyChange(rb);
                }
            });
        }, rb, 'freezePositionY');

        this.createUnityCheckbox(parent, 'Freeze Pos Z', rb.freezePositionZ ?? false, (checked: boolean) => {
            const oldZ = rb.freezePositionZ ?? false;
            CommandHistory.execute({
                name: 'Toggle RigidBody Freeze Pos Z',
                execute: () => {
                    rb.setFreezePosition?.(rb.freezePositionX ?? false, rb.freezePositionY ?? false, checked);
                    this.recordOverride(rb, 'freezePositionZ');
                    this.notifyChange(rb);
                },
                undo: () => {
                    rb.setFreezePosition?.(rb.freezePositionX ?? false, rb.freezePositionY ?? false, oldZ);
                    this.notifyChange(rb);
                }
            });
        }, rb, 'freezePositionZ');

        this.createUnityCheckbox(parent, 'Freeze Rot Y', rb.freezeRotationY ?? false, (checked: boolean) => {
            const oldY = rb.freezeRotationY ?? false;
            CommandHistory.execute({
                name: 'Toggle RigidBody Freeze Rot Y',
                execute: () => {
                    rb.setFreezeRotation?.(rb.freezeRotationX ?? false, checked, rb.freezeRotationZ ?? false);
                    this.recordOverride(rb, 'freezeRotationY');
                    this.notifyChange(rb);
                },
                undo: () => {
                    rb.setFreezeRotation?.(rb.freezeRotationX ?? false, oldY, rb.freezeRotationZ ?? false);
                    this.notifyChange(rb);
                }
            });
        }, rb, 'freezeRotationY');

        this.createUnityCheckbox(parent, 'Freeze Rot Z', rb.freezeRotationZ ?? false, (checked: boolean) => {
            const oldZ = rb.freezeRotationZ ?? false;
            CommandHistory.execute({
                name: 'Toggle RigidBody Freeze Rot Z',
                execute: () => {
                    rb.setFreezeRotation?.(rb.freezeRotationX ?? false, rb.freezeRotationY ?? false, checked);
                    this.recordOverride(rb, 'freezeRotationZ');
                    this.notifyChange(rb);
                },
                undo: () => {
                    rb.setFreezeRotation?.(rb.freezeRotationX ?? false, rb.freezeRotationY ?? false, oldZ);
                    this.notifyChange(rb);
                }
            });
        }, rb, 'freezeRotationZ');

        this.createUnityDropdown(
            parent,
            'Interpolation',
            ['None', 'Interpolate', 'Extrapolate'],
            rb.interpolation ?? 'None',
            (value) => {
                const oldVal = rb.interpolation ?? 'None';
                CommandHistory.execute({
                    name: 'Change RigidBody Interpolation',
                    execute: () => {
                        rb.setInterpolation?.(value);
                        this.recordOverride(rb, 'interpolation');
                        this.notifyChange(rb);
                    },
                    undo: () => {
                        rb.setInterpolation?.(oldVal);
                        this.notifyChange(rb);
                    }
                });
            },
            rb,
            'interpolation'
        );

        this.createUnityDropdown(
            parent,
            'Collision Detection',
            ['Discrete', 'Continuous', 'Continuous Dynamic', 'Continuous Speculative'],
            rb.collisionDetectionMode ?? 'Discrete',
            (value) => {
                const oldVal = rb.collisionDetectionMode ?? 'Discrete';
                CommandHistory.execute({
                    name: 'Change RigidBody Collision Detection',
                    execute: () => {
                        rb.setCollisionDetectionMode?.(value);
                        this.recordOverride(rb, 'collisionDetectionMode');
                        this.notifyChange(rb);
                    },
                    undo: () => {
                        rb.setCollisionDetectionMode?.(oldVal);
                        this.notifyChange(rb);
                    }
                });
            },
            rb,
            'collisionDetectionMode'
        );
    }

    // Helper: Unity-style checkbox
    public createUnityCheckbox(parent: HTMLElement, label: string, checked: boolean, onChange: (checked: boolean) => void, target: any = null, propertyKey?: string): void {
        const field = document.createElement('div');
        field.className = 'unity-field';
        field.style.marginBottom = '2px';
        field.style.display = 'flex';
        field.style.alignItems = 'center';
        field.style.minHeight = '18px';

        const lbl = document.createElement('label');
        lbl.innerText = label;
        lbl.style.fontSize = '12px';
        lbl.style.width = '120px';
        lbl.style.paddingLeft = '4px';
        lbl.style.userSelect = 'none';

        // Check for override
        if (target) {
            this.setLabelOverrideStyle(lbl, target, propertyKey || label.toLowerCase().replace(' ', ''));
        } else {
            lbl.style.color = 'var(--unity-text-dim)';
        }

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked;
        input.style.margin = '0';
        input.style.cursor = 'pointer';

        input.onchange = () => onChange(input.checked);

        field.appendChild(lbl);
        field.appendChild(input);
        parent.appendChild(field);
    }

    // Helper: Unity-style dropdown
    private createUnityDropdown(parent: HTMLElement, label: string, options: string[], defaultValue: string, onChange: (value: string) => void, target: any = null, propertyKey?: string): void {
        const field = document.createElement('div');
        field.className = 'unity-field';
        field.style.marginBottom = '8px';

        const lbl = document.createElement('label');
        lbl.innerText = label;
        lbl.style.fontSize = '11px';

        // Check for override
        if (target) {
            this.setLabelOverrideStyle(lbl, target, propertyKey || label.toLowerCase().replace(' ', ''));
        } else {
            lbl.style.color = 'var(--unity-text-dim)';
        }

        const select = document.createElement('select');
        select.style.flex = '1';
        select.style.background = 'var(--unity-bg-dark)';
        select.style.color = 'var(--unity-text)';
        select.style.border = '1px solid var(--unity-border)';
        select.style.padding = '2px 4px';
        select.style.fontSize = '11px';

        options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt;
            option.innerText = opt;
            if (opt === defaultValue) option.selected = true;
            select.appendChild(option);
        });
        select.onchange = () => {
            const newValue = select.value;
            onChange(newValue);
        };

        field.appendChild(lbl);
        field.appendChild(select);
        parent.appendChild(field);
    }

    // Helper: Unity-style slider
    public createUnitySlider(parent: HTMLElement, label: string, value: number, min: number, max: number, onChange: (value: number) => void, target: any = null, propertyKey?: string): void {
        const field = document.createElement('div');
        field.className = 'unity-field';
        field.style.marginBottom = '2px';
        field.style.display = 'flex';
        field.style.alignItems = 'center';
        field.style.minHeight = '18px';

        const lbl = document.createElement('label');
        lbl.innerText = label;
        lbl.style.fontSize = '12px';
        lbl.style.width = '120px'; // Fixed width
        lbl.style.paddingLeft = '4px';
        lbl.style.userSelect = 'none';

        // Check for override
        if (target) {
            this.setLabelOverrideStyle(lbl, target, propertyKey || label.toLowerCase().replace(' ', ''));
        } else {
            lbl.style.color = 'var(--unity-text-dim)';
        }

        const sliderContainer = document.createElement('div');
        sliderContainer.style.flex = '1';
        sliderContainer.style.display = 'flex';
        sliderContainer.style.alignItems = 'center';
        sliderContainer.style.gap = '4px';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = min.toString();
        slider.max = max.toString();
        slider.step = '0.01';
        slider.value = value.toString();
        slider.style.flex = '2';
        slider.style.cursor = 'pointer';

        const valueDisplay = document.createElement('input');
        valueDisplay.type = 'number';
        valueDisplay.value = value.toFixed(2);
        valueDisplay.style.flex = '1';
        valueDisplay.style.minWidth = '40px';
        valueDisplay.style.background = 'var(--unity-bg-input)';
        valueDisplay.style.color = 'var(--unity-text)';
        valueDisplay.style.border = '1px solid var(--unity-border-light)';
        valueDisplay.style.fontSize = '11px';
        valueDisplay.style.padding = '2px';
        valueDisplay.step = '0.01';

        let initialValue = value;

        const updateValues = (val: number) => {
            slider.value = val.toString();
            valueDisplay.value = val.toFixed(2);
        };

        slider.oninput = () => {
            const val = parseFloat(slider.value);
            valueDisplay.value = val.toFixed(2);
            onChange(val);
        };

        slider.onchange = () => {
            const newValue = parseFloat(slider.value);
            const oldValue = initialValue;
            CommandHistory.execute({
                name: `Change ${label}`,
                execute: () => {
                    onChange(newValue);
                    updateValues(newValue);
                },
                undo: () => {
                    onChange(oldValue);
                    updateValues(oldValue);
                }
            });
            initialValue = newValue;
        };

        valueDisplay.onchange = () => {
            const newValue = parseFloat(valueDisplay.value);
            const oldValue = initialValue;
            CommandHistory.execute({
                name: `Change ${label}`,
                execute: () => {
                    onChange(newValue);
                    updateValues(newValue);
                },
                undo: () => {
                    onChange(oldValue);
                    updateValues(oldValue);
                }
            });
            initialValue = newValue;
        };

        sliderContainer.appendChild(slider);
        sliderContainer.appendChild(valueDisplay);

        field.appendChild(lbl);
        field.appendChild(sliderContainer);
        parent.appendChild(field);
    }

    // Helper: Unity-style color field
    private createUnityColorField(parent: HTMLElement, label: string, defaultColor: string, onChange: (color: string) => void, target: any = null, propertyKey?: string): void {
        const field = document.createElement('div');
        field.className = 'unity-field';
        field.style.marginBottom = '2px';
        field.style.display = 'flex';
        field.style.alignItems = 'center';
        field.style.minHeight = '18px';

        const lbl = document.createElement('label');
        lbl.innerText = label;
        lbl.style.fontSize = '12px';
        lbl.style.width = '120px'; // Fixed width
        lbl.style.paddingLeft = '4px';
        lbl.style.userSelect = 'none';

        // Check for override
        if (target) {
            this.setLabelOverrideStyle(lbl, target, propertyKey || label.toLowerCase().replace(' ', ''));
        } else {
            lbl.style.color = 'var(--unity-text-dim)';
        }

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = defaultColor;
        colorInput.style.flex = '1';
        colorInput.style.height = '18px';
        colorInput.style.border = '1px solid var(--unity-border-light)';
        colorInput.style.padding = '1px';
        colorInput.style.background = 'var(--unity-bg-input)';
        colorInput.style.cursor = 'pointer';

        colorInput.onchange = () => onChange(colorInput.value);

        field.appendChild(lbl);
        field.appendChild(colorInput);
        parent.appendChild(field);
    }

    // Helper: Style Unity button
    private styleUnityButton(btn: HTMLButtonElement): void {
        btn.style.padding = '4px 8px';
        btn.style.background = 'var(--unity-bg-header)';
        btn.style.border = '1px solid var(--unity-border)';
        btn.style.color = 'var(--unity-text)';
        btn.style.cursor = 'pointer';
        btn.style.fontSize = '11px';
        btn.style.borderRadius = '2px';
        btn.onmouseenter = () => btn.style.background = 'var(--unity-bg-hover)';
        btn.onmouseleave = () => btn.style.background = 'var(--unity-bg-header)';
    }

    // Helper: Unity-style text/number field
    public createUnityField(parent: HTMLElement, label: string, type: string, value: any, onChange: (value: any) => void, target: any = null, propertyKey?: string): void {
        const field = document.createElement('div');
        field.className = 'unity-field';
        field.style.marginBottom = '2px';
        field.style.display = 'flex';
        field.style.alignItems = 'center';
        field.style.minHeight = '18px';

        const lbl = document.createElement('label');
        lbl.innerText = label;
        lbl.style.fontSize = '12px';
        lbl.style.width = '120px'; // Fixed width
        lbl.style.paddingLeft = '4px';
        lbl.style.userSelect = 'none';

        // Check for override
        if (target) {
            this.setLabelOverrideStyle(lbl, target, propertyKey || label.toLowerCase().replace(' ', ''));
        } else {
            lbl.style.color = 'var(--unity-text-dim)';
        }

        const input = document.createElement('input');
        if (type === 'number') {
            input.type = 'number';
            input.step = '0.1';
            input.value = value.toString();
        } else {
            input.type = 'text';
            input.value = value.toString();
        }

        // Drag and drop for file paths
        if (type === 'text') {
            input.ondragover = (e) => {
                e.preventDefault();
                input.style.border = '1px solid var(--unity-accent)';
            };
            input.ondragleave = () => {
                input.style.border = '1px solid var(--unity-border-light)';
            };
            input.ondrop = (e) => {
                e.preventDefault();
                input.style.border = '1px solid var(--unity-border-light)';
                const data = e.dataTransfer?.getData('text/plain');
                if (data) {
                    try {
                        const payload = JSON.parse(data);
                        if (payload.fullPath) {
                            // Extract relative path if inside Assets
                            const assetsIndex = payload.fullPath.indexOf('Assets');
                            let relPath = payload.fullPath;
                            if (assetsIndex !== -1) {
                                relPath = payload.fullPath.substring(assetsIndex).replace(/\\/g, '/');
                            }
                            input.value = relPath;
                            onChange(relPath);
                        }
                    } catch (err) { }
                }
            };
        }

        input.style.flex = '1';
        input.style.background = 'var(--unity-bg-input)';
        input.style.color = 'var(--unity-text)';
        input.style.border = '1px solid var(--unity-border-light)';
        input.style.padding = '2px 4px 2px 2px';
        input.style.fontSize = '11px';
        input.style.borderRadius = '2px';

        input.onfocus = () => input.style.borderColor = 'var(--unity-accent)';
        input.onblur = () => input.style.borderColor = 'var(--unity-border-light)';

        input.onchange = () => {
            if (type === 'number') {
                onChange(parseFloat(input.value));
            } else {
                onChange(input.value);
            }
        };

        field.appendChild(lbl);
        field.appendChild(input);
        parent.appendChild(field);
    }

    // Helper: Vector3 Field
    public createVector3Field(parent: HTMLElement, label: string, value: any, onChange: (axis: string, val: number) => void, target: any = null, propertyKey?: string): void {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.marginBottom = '2px';
        row.style.minHeight = '18px';

        const lbl = document.createElement('label');
        lbl.innerText = label;
        lbl.style.width = '120px'; // Fixed width for alignment
        lbl.style.fontSize = '12px';
        lbl.style.paddingLeft = '4px';
        lbl.style.userSelect = 'none';
        lbl.style.cursor = 'default';

        // Check for override
        if (target) {
            this.setLabelOverrideStyle(lbl, target, propertyKey || label.toLowerCase().replace(' ', ''));
        } else {
            lbl.style.color = 'var(--unity-text-dim)';
        }

        const inputContainer = document.createElement('div');
        inputContainer.style.flex = '1';
        inputContainer.style.display = 'flex';
        inputContainer.style.gap = '4px';

        const axes = ['x', 'y', 'z'];
        // const colors = ['#ff3c3c', '#46bf00', '#2d73ff']; // Removed unused

        axes.forEach((axis) => {
            const axisContainer = document.createElement('div');
            axisContainer.style.flex = '1';
            axisContainer.style.display = 'flex';
            axisContainer.style.alignItems = 'center';
            axisContainer.style.minWidth = '0';

            // Draggable Label
            const axisLabel = document.createElement('div');
            axisLabel.innerText = axis.toUpperCase();
            axisLabel.style.width = '12px';
            axisLabel.style.textAlign = 'center';
            axisLabel.style.fontSize = '10px';
            axisLabel.style.fontWeight = 'bold';
            axisLabel.style.color = '#fff'; // White text?
            axisLabel.style.textShadow = '0px 1px 2px rgba(0,0,0,0.5)'; // Shadow for visibility
            axisLabel.style.cursor = 'ew-resize';
            axisLabel.style.userSelect = 'none';
            // Custom label styling to match Unity's "Label over Input" or "Label beside Input"
            // Unity has the label inside the input field area usually on the left.
            // We'll mimic the "Label beside input" look but tight.
            axisLabel.style.position = 'relative';

            // Drag Logic
            let isDragging = false;
            let startX = 0;
            let startValue = 0;

            axisLabel.onmousedown = (e) => {
                isDragging = true;
                startX = e.clientX;
                startValue = parseFloat(input.value) || 0;
                document.body.style.cursor = 'ew-resize';

                const onMove = (mv: MouseEvent) => {
                    if (!isDragging) return;
                    const delta = mv.clientX - startX;
                    const val = startValue + delta * 0.1; // Sensitivity
                    input.value = val.toFixed(2);
                    onChange(axis, val);
                };

                const onUp = () => {
                    isDragging = false;
                    document.body.style.cursor = 'default';
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    // Add undo command here if needed
                };

                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            };

            const input = document.createElement('input');
            input.type = 'number';
            input.step = '0.01'; // Finer step
            input.value = (value && value[axis] !== undefined) ? Number(value[axis]).toFixed(2) : '0';
            input.style.flex = '1';
            input.style.minWidth = '0';
            input.style.background = 'var(--unity-bg-input)';
            input.style.color = 'var(--unity-text)';
            input.style.border = '1px solid var(--unity-border-light)';
            input.style.padding = '2px 4px 2px 2px';
            input.style.fontSize = '11px';
            input.style.borderRadius = '2px';
            input.style.marginLeft = '2px'; // Gap between label and input

            // Highlight on hover
            input.onfocus = () => input.style.borderColor = 'var(--unity-accent)';
            input.onblur = () => input.style.borderColor = 'var(--unity-border-light)';

            input.onchange = () => {
                const val = parseFloat(input.value);
                onChange(axis, val);
                // Undo logic...
            };

            axisContainer.appendChild(axisLabel); // Helper label
            axisContainer.appendChild(input);
            inputContainer.appendChild(axisContainer);
        });

        row.appendChild(lbl);
        row.appendChild(inputContainer);
        parent.appendChild(row);
    }

    // Helper: Vector2 Field
    public createVector2Field(parent: HTMLElement, label: string, value: any, onChange: (axis: string, val: number) => void, target: any = null): void {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.marginBottom = '2px';
        row.style.minHeight = '18px';

        const lbl = document.createElement('label');
        lbl.innerText = label;
        lbl.style.width = '120px';
        lbl.style.fontSize = '12px';
        lbl.style.paddingLeft = '4px';
        lbl.style.userSelect = 'none';

        // Check for override
        if (target) {
            this.setLabelOverrideStyle(lbl, target, label.toLowerCase().replace(' ', ''));
        } else {
            lbl.style.color = 'var(--unity-text-dim)';
        }

        const inputContainer = document.createElement('div');
        inputContainer.style.flex = '1';
        inputContainer.style.display = 'flex';
        inputContainer.style.gap = '4px';

        ['x', 'y'].forEach((axis) => {
            const axisContainer = document.createElement('div');
            axisContainer.style.flex = '1';
            axisContainer.style.display = 'flex';
            axisContainer.style.alignItems = 'center';

            const axisLabel = document.createElement('div');
            axisLabel.innerText = axis.toUpperCase();
            axisLabel.style.width = '12px';
            axisLabel.style.fontSize = '10px';
            axisLabel.style.fontWeight = 'bold';
            axisLabel.style.color = '#fff';
            axisLabel.style.cursor = 'ew-resize';

            const input = document.createElement('input');
            input.type = 'number';
            input.step = '0.01';
            input.value = (value && (value as any)[axis] !== undefined) ? Number((value as any)[axis]).toFixed(2) : '0';
            input.style.flex = '1';
            input.style.minWidth = '0';
            input.style.background = 'var(--unity-bg-input)';
            input.style.color = 'var(--unity-text)';
            input.style.border = '1px solid var(--unity-border-light)';
            input.style.fontSize = '11px';
            input.style.borderRadius = '2px';
            input.style.marginLeft = '2px';

            input.onchange = () => onChange(axis, parseFloat(input.value));

            axisContainer.appendChild(axisLabel);
            axisContainer.appendChild(input);
            inputContainer.appendChild(axisContainer);
        });

        row.appendChild(lbl);
        row.appendChild(inputContainer);
        parent.appendChild(row);
    }

    // Auto Inspector using reflection (Decorators)
    public createAutoInspector(parent: HTMLElement, target: any): void {
        const fields = target.constructor._serializableFields || [];

        if (fields.length === 0) {
            const msg = document.createElement('div');
            msg.innerText = "No serializable fields found.";
            msg.style.padding = "10px";
            msg.style.fontSize = "11px";
            msg.style.color = "var(--unity-text-dim)";
            parent.appendChild(msg);
            return;
        }

        for (const field of fields) {
            const value = target[field];
            const type = typeof value;

            if (type === 'number') {
                this.createUnityField(parent, field, 'number', value, (nv) => {
                    const oldValue = target[field];
                    const newValue = parseFloat(nv);
                    CommandHistory.execute({
                        name: `Change ${field}`,
                        execute: () => {
                            target[field] = newValue;
                            this.recordOverride(target, field);
                            this.notifyChange(target);
                        },
                        undo: () => {
                            target[field] = oldValue;
                            this.notifyChange(target);
                        }
                    });
                }, target);
            } else if (type === 'string') {
                this.createUnityField(parent, field, 'text', value, (nv) => {
                    const oldValue = target[field];
                    CommandHistory.execute({
                        name: `Change ${field}`,
                        execute: () => {
                            target[field] = nv;
                            this.recordOverride(target, field);
                            this.notifyChange(target);
                        },
                        undo: () => {
                            target[field] = oldValue;
                            this.notifyChange(target);
                        }
                    });
                }, target);
            } else if (type === 'boolean') {
                this.createUnityCheckbox(parent, field, value, (nv: boolean) => {
                    const oldValue = target[field];
                    CommandHistory.execute({
                        name: `Change ${field}`,
                        execute: () => {
                            target[field] = nv;
                            this.recordOverride(target, field);
                            this.notifyChange(target);
                        },
                        undo: () => {
                            target[field] = oldValue;
                            this.notifyChange(target);
                        }
                    });
                }, target, field);
            } else if (value && typeof value === 'object' && value.x !== undefined && value.y !== undefined) {
                this.createVector3Field(parent, field, value, (axis, nv) => {
                    const oldValue = value[axis];
                    CommandHistory.execute({
                        name: `Change ${field}.${axis}`,
                        execute: () => {
                            (value as any)[axis] = nv;
                            this.recordOverride(target, field);
                            this.notifyChange(target);
                        },
                        undo: () => {
                            (value as any)[axis] = oldValue;
                            this.notifyChange(target);
                        }
                    });
                }, target);
            } else if (value !== undefined) {
                // Potential Object Reference (GameObject/Component)
                this.createUnityObjectField(parent, field, value, (nv) => {
                    const oldValue = target[field];
                    CommandHistory.execute({
                        name: `Change ${field}`,
                        execute: () => {
                            target[field] = nv;
                            this.recordOverride(target, field);
                            this.notifyChange(target);
                        },
                        undo: () => {
                            target[field] = oldValue;
                            this.notifyChange(target);
                        }
                    });
                }, target);
            }
        }
    }
    public createTextureSlot(parent: HTMLElement, label: string, value: THREE.Texture | null, onChange: (tex: THREE.Texture | null) => void, target: any = null): void {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.marginBottom = '5px';
        row.style.paddingTop = '5px';

        const slot = document.createElement('div');
        slot.style.width = '48px';
        slot.style.height = '48px';
        slot.style.background = '#1a1a1a';
        slot.style.border = '1px solid #555';
        slot.style.borderRadius = '3px';
        slot.style.marginRight = '8px';
        slot.style.display = 'flex';
        slot.style.alignItems = 'center';
        slot.style.justifyContent = 'center';
        slot.style.fontSize = '9px';
        slot.style.color = '#777';
        slot.style.cursor = 'pointer';
        slot.style.position = 'relative';

        const updateSlotVisual = () => {
            if (value && (value as any).image) {
                const image = (value as any).image as { src?: string; currentSrc?: string; toDataURL?: () => string };
                const previewUrl = image.currentSrc || image.src || image.toDataURL?.() || '';
                slot.innerText = '';
                slot.style.backgroundImage = previewUrl ? `url(${previewUrl})` : 'none';
                slot.style.backgroundSize = 'contain';
                slot.style.backgroundRepeat = 'no-repeat';
                slot.style.backgroundPosition = 'center';
            } else {
                slot.innerText = 'None (Tex)';
                slot.style.backgroundImage = 'none';
            }
        };
        updateSlotVisual();

        const labelAndInfo = document.createElement('div');
        labelAndInfo.style.flex = '1';

        const lbl = document.createElement('div');
        lbl.innerText = label;
        lbl.style.fontSize = '12px';
        if (target) this.setLabelOverrideStyle(lbl, target, label.toLowerCase().replace(' ', ''));

        const pathInfo = document.createElement('div');
        pathInfo.innerText = value ? (value as any).name || 'Unknown' : 'Select...';
        pathInfo.style.fontSize = '10px';
        pathInfo.style.color = '#777';
        pathInfo.style.marginTop = '2px';

        labelAndInfo.appendChild(lbl);
        labelAndInfo.appendChild(pathInfo);

        row.appendChild(slot);
        row.appendChild(labelAndInfo);
        parent.appendChild(row);

        // Drag & Drop for textures
        slot.ondragover = (e) => { e.preventDefault(); slot.style.borderColor = 'var(--unity-accent)'; };
        slot.ondragleave = () => { slot.style.borderColor = '#555'; };
        slot.ondrop = (e) => {
            e.preventDefault();
            slot.style.borderColor = '#555';
            const data = e.dataTransfer?.getData('text/plain');
            if (data) {
                try {
                    const payload = JSON.parse(data);
                    if (payload.type === 'texture') {
                        AssetImporter.importTexture(payload.fullPath, (t) => {
                            t.name = payload.name;
                            onChange(t);
                            value = t;
                            updateSlotVisual();
                            pathInfo.innerText = t.name;
                        });
                    }
                } catch (e) { }
            }
        };
    }

    // Helper: Unity-style Object field (for references)
    public createUnityObjectField(parent: HTMLElement, label: string, value: any, onChange: (value: any) => void, target: any = null, propertyKey?: string): void {
        const field = document.createElement('div');
        field.className = 'unity-field';
        field.style.marginBottom = '2px';
        field.style.display = 'flex';
        field.style.alignItems = 'center';
        field.style.minHeight = '18px';

        const lbl = document.createElement('label');
        lbl.innerText = label;
        lbl.style.fontSize = '12px';
        lbl.style.width = '120px';
        lbl.style.paddingLeft = '4px';

        // Check for override
        if (target) {
            this.setLabelOverrideStyle(lbl, target, propertyKey || label.toLowerCase().replace(' ', ''));
        } else {
            lbl.style.color = 'var(--unity-text-dim)';
        }

        const objSlot = document.createElement('div');
        objSlot.className = 'unity-object-slot';
        objSlot.style.flex = '1';
        objSlot.style.background = 'var(--unity-bg-input)';
        objSlot.style.border = '1px solid var(--unity-border-light)';
        objSlot.style.borderRadius = '2px';
        objSlot.style.height = '18px';
        objSlot.style.display = 'flex';
        objSlot.style.alignItems = 'center';
        objSlot.style.padding = '0 6px';
        objSlot.style.fontSize = '11px';
        objSlot.style.cursor = 'pointer';
        objSlot.style.overflow = 'hidden';

        const updateSlot = () => {
            if (value && value.name) {
                objSlot.innerText = `${value.name} (${value.constructor.name})`;
                objSlot.style.color = '#fff';
            } else {
                objSlot.innerText = 'None (Object)';
                objSlot.style.color = 'var(--unity-text-dim)';
            }
        };
        updateSlot();

        // Drag and Drop
        objSlot.ondragover = (e) => {
            e.preventDefault();
            objSlot.style.borderColor = 'var(--unity-accent)';
        };
        objSlot.ondragleave = () => {
            objSlot.style.borderColor = 'var(--unity-border-light)';
        };
        objSlot.ondrop = (e) => {
            e.preventDefault();
            objSlot.style.borderColor = 'var(--unity-border-light)';
            const data = e.dataTransfer?.getData('text/plain');
            if (data) {
                try {
                    const payload = JSON.parse(data);
                    // @ts-ignore
                    const scene = window.Editor?.instance?.scene;
                    if (scene) {
                        if (payload.type === 'gameobject') {
                            const targetGO = scene.findGameObjectByID(payload.id);
                            if (targetGO) {
                                onChange(targetGO);
                                value = targetGO;
                                updateSlot();
                            }
                        } else if (payload.type === 'material') {
                            const mat = MaterialManager.getMaterial(payload.fullPath || payload.name);
                            if (mat) {
                                onChange(mat);
                                value = mat;
                                updateSlot();
                            }
                        } else if (payload.type === 'prefab') {
                            // Link to prefab asset path?
                            // For now maybe we don't have a Prefab asset type to assign to fields easily
                            // unless it's a GameObject field.
                            console.log("Dropped prefab into object slot:", payload.name);
                        }
                    }
                } catch (e) { }
            }
        };

        field.appendChild(lbl);
        field.appendChild(objSlot);
        parent.appendChild(field);
    }

    /**
     * ScriptableObject Inspector - auto-generates editable fields
     * for all public, non-function properties of a ScriptableObject.
     */
    public createScriptableObjectInspector(parent: HTMLElement, so: any): void {
        const titleStyle = 'font-size: 11px; font-weight: bold; margin-bottom: 8px; color: #ccc; border-bottom: 1px solid #444; padding-bottom: 4px;';

        const header = document.createElement('div');
        header.style.cssText = titleStyle;
        header.innerText = `${so.typeName} Configuration`;
        parent.appendChild(header);

        // Asset name
        this.createUnityField(parent, 'Asset Name', 'text', so.assetName || '', (v) => {
            so.assetName = v;
        });

        const hr = document.createElement('hr');
        hr.style.cssText = 'border: 0; border-top: 1px solid var(--unity-border); margin: 8px 0;';
        parent.appendChild(hr);

        // Auto-generate fields for all own properties
        const skipKeys = new Set(['typeName', 'assetName']);
        for (const key of Object.keys(so)) {
            if (skipKeys.has(key)) continue;
            const val = (so as any)[key];
            if (typeof val === 'function') continue;

            const label = key.charAt(0).toUpperCase() + key.slice(1);

            if (typeof val === 'number') {
                this.createUnityField(parent, label, 'number', val, (v) => {
                    (so as any)[key] = parseFloat(v);
                });
            } else if (typeof val === 'string') {
                if (val.startsWith('#') && (val.length === 4 || val.length === 7)) {
                    this.createUnityColorField(parent, label, val, (v) => {
                        (so as any)[key] = v;
                    });
                } else {
                    this.createUnityField(parent, label, 'text', val, (v) => {
                        (so as any)[key] = v;
                    });
                }
            } else if (typeof val === 'boolean') {
                this.createUnityCheckbox(parent, label, val, (checked: boolean) => {
                    (so as any)[key] = checked;
                });
            } else if (val && typeof val === 'object' && val.x !== undefined) {
                this.createVector3Field(parent, label, val, (axis, nv) => {
                    (val as any)[axis] = nv;
                });
            }
        }

        // Action Buttons
        const actions = document.createElement('div');
        actions.style.cssText = 'margin-top: 20px; display: flex; gap: 8px;';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'unity-button';
        saveBtn.innerText = 'Save Asset Changes';
        saveBtn.style.flex = '1';
        saveBtn.onclick = () => {
            // @ts-ignore
            window.Editor?.instance?.projectWindow?.saveScriptableObject(so);
            console.log(`Saved ScriptableObject: ${so.assetName}`);
            saveBtn.innerText = 'Saved! ✓';
            setTimeout(() => saveBtn.innerText = 'Save Asset Changes', 2000);
        };

        const exportBtn = document.createElement('button');
        exportBtn.innerText = '📋 Copy JSON';
        this.styleUnityButton(exportBtn);
        exportBtn.style.flex = '0';
        exportBtn.onclick = () => {
            navigator.clipboard.writeText(so.toAssetJSON()).then(() => {
                const oldTxt = exportBtn.innerText;
                exportBtn.innerText = '✓';
                setTimeout(() => exportBtn.innerText = oldTxt, 1500);
            });
        };

        actions.appendChild(saveBtn);
        actions.appendChild(exportBtn);
        parent.appendChild(actions);
    }

    public createUIButtonInspector(parent: HTMLElement, btn: any): void {
        this.createUnityDropdown(parent, 'Navigation', ['Automatic', 'Explicit', 'None'], btn.navigationMode || 'Automatic', (v) => {
            const oldVal = btn.navigationMode || 'Automatic';
            CommandHistory.execute({
                name: 'Change Button Navigation Mode',
                execute: () => {
                    btn.navigationMode = v;
                    this.recordOverride(btn, 'navigationMode');
                    this.notifyChange(btn);
                    this.refreshSelected?.();
                },
                undo: () => {
                    btn.navigationMode = oldVal;
                    this.notifyChange(btn);
                    this.refreshSelected?.();
                }
            });
        }, btn, 'navigationMode');

        if ((btn.navigationMode || 'Automatic') === 'Explicit') {
            this.createUnityObjectField(parent, 'Nav Up', btn.navigationUp || null, (value) => {
                const oldVal = btn.navigationUp || null;
                CommandHistory.execute({
                    name: 'Change Button Nav Up',
                    execute: () => {
                        btn.navigationUp = value || null;
                        this.recordOverride(btn, 'navigationUp');
                        this.notifyChange(btn);
                    },
                    undo: () => {
                        btn.navigationUp = oldVal;
                        this.notifyChange(btn);
                    }
                });
            }, btn, 'navigationUp');

            this.createUnityObjectField(parent, 'Nav Down', btn.navigationDown || null, (value) => {
                const oldVal = btn.navigationDown || null;
                CommandHistory.execute({
                    name: 'Change Button Nav Down',
                    execute: () => {
                        btn.navigationDown = value || null;
                        this.recordOverride(btn, 'navigationDown');
                        this.notifyChange(btn);
                    },
                    undo: () => {
                        btn.navigationDown = oldVal;
                        this.notifyChange(btn);
                    }
                });
            }, btn, 'navigationDown');

            this.createUnityObjectField(parent, 'Nav Left', btn.navigationLeft || null, (value) => {
                const oldVal = btn.navigationLeft || null;
                CommandHistory.execute({
                    name: 'Change Button Nav Left',
                    execute: () => {
                        btn.navigationLeft = value || null;
                        this.recordOverride(btn, 'navigationLeft');
                        this.notifyChange(btn);
                    },
                    undo: () => {
                        btn.navigationLeft = oldVal;
                        this.notifyChange(btn);
                    }
                });
            }, btn, 'navigationLeft');

            this.createUnityObjectField(parent, 'Nav Right', btn.navigationRight || null, (value) => {
                const oldVal = btn.navigationRight || null;
                CommandHistory.execute({
                    name: 'Change Button Nav Right',
                    execute: () => {
                        btn.navigationRight = value || null;
                        this.recordOverride(btn, 'navigationRight');
                        this.notifyChange(btn);
                    },
                    undo: () => {
                        btn.navigationRight = oldVal;
                        this.notifyChange(btn);
                    }
                });
            }, btn, 'navigationRight');
        }

        this.createUnityField(parent, 'Label', 'text', btn.label, (v) => {
            const oldVal = btn.label;
            CommandHistory.execute({
                name: 'Change Button Label',
                execute: () => {
                    btn.label = v;
                    this.recordOverride(btn, 'label');
                    this.notifyChange(btn);
                },
                undo: () => {
                    btn.label = oldVal;
                    this.notifyChange(btn);
                }
            });
        }, btn);

        this.createUnityCheckbox(parent, 'Interactable', btn.interactable ?? true, (checked: boolean) => {
            const oldVal = btn.interactable ?? true;
            CommandHistory.execute({
                name: 'Toggle Button Interactable',
                execute: () => {
                    btn.interactable = checked;
                    this.recordOverride(btn, 'interactable');
                    this.notifyChange(btn);
                },
                undo: () => {
                    btn.interactable = oldVal;
                    this.notifyChange(btn);
                }
            });
        }, btn, 'interactable');

        this.createUnityColorField(parent, 'Selected Color', btn.selectedColor || '#666666', (v) => {
            const oldVal = btn.selectedColor || '#666666';
            CommandHistory.execute({
                name: 'Change Button Selected Color',
                execute: () => {
                    btn.selectedColor = v;
                    this.recordOverride(btn, 'selectedColor');
                    this.notifyChange(btn);
                },
                undo: () => {
                    btn.selectedColor = oldVal;
                    this.notifyChange(btn);
                }
            });
        }, btn, 'selectedColor');

        this.createUnityColorField(parent, 'Normal Color', btn.normalColor || '#4a4a4a', (v) => {
            const oldVal = btn.normalColor || '#4a4a4a';
            CommandHistory.execute({
                name: 'Change Button Normal Color',
                execute: () => {
                    btn.normalColor = v;
                    this.recordOverride(btn, 'normalColor');
                    this.notifyChange(btn);
                },
                undo: () => {
                    btn.normalColor = oldVal;
                    this.notifyChange(btn);
                }
            });
        }, btn, 'normalColor');

        this.createUnityColorField(parent, 'Highlight Color', btn.highlightedColor || '#5a5a5a', (v) => {
            const oldVal = btn.highlightedColor || '#5a5a5a';
            CommandHistory.execute({
                name: 'Change Button Highlight Color',
                execute: () => {
                    btn.highlightedColor = v;
                    this.recordOverride(btn, 'highlightedColor');
                    this.notifyChange(btn);
                },
                undo: () => {
                    btn.highlightedColor = oldVal;
                    this.notifyChange(btn);
                }
            });
        }, btn, 'highlightedColor');

        this.createUnityColorField(parent, 'Pressed Color', btn.pressedColor || '#2f6ea1', (v) => {
            const oldVal = btn.pressedColor || '#2f6ea1';
            CommandHistory.execute({
                name: 'Change Button Pressed Color',
                execute: () => {
                    btn.pressedColor = v;
                    this.recordOverride(btn, 'pressedColor');
                    this.notifyChange(btn);
                },
                undo: () => {
                    btn.pressedColor = oldVal;
                    this.notifyChange(btn);
                }
            });
        }, btn, 'pressedColor');

        this.createUnityColorField(parent, 'Disabled Color', btn.disabledColor || '#2b2b2b', (v) => {
            const oldVal = btn.disabledColor || '#2b2b2b';
            CommandHistory.execute({
                name: 'Change Button Disabled Color',
                execute: () => {
                    btn.disabledColor = v;
                    this.recordOverride(btn, 'disabledColor');
                    this.notifyChange(btn);
                },
                undo: () => {
                    btn.disabledColor = oldVal;
                    this.notifyChange(btn);
                }
            });
        }, btn, 'disabledColor');
    }

    public createUIInputFieldInspector(parent: HTMLElement, inputField: any): void {
        this.createUnityDropdown(parent, 'Navigation', ['Automatic', 'Explicit', 'None'], inputField.navigationMode || 'Automatic', (v) => {
            const oldVal = inputField.navigationMode || 'Automatic';
            CommandHistory.execute({
                name: 'Change Input Field Navigation Mode',
                execute: () => {
                    inputField.navigationMode = v;
                    this.recordOverride(inputField, 'navigationMode');
                    this.notifyChange(inputField);
                    this.refreshSelected?.();
                },
                undo: () => {
                    inputField.navigationMode = oldVal;
                    this.notifyChange(inputField);
                    this.refreshSelected?.();
                }
            });
        }, inputField, 'navigationMode');

        if ((inputField.navigationMode || 'Automatic') === 'Explicit') {
            this.createUnityObjectField(parent, 'Nav Up', inputField.navigationUp || null, (value) => {
                const oldVal = inputField.navigationUp || null;
                CommandHistory.execute({
                    name: 'Change Input Field Nav Up',
                    execute: () => {
                        inputField.navigationUp = value || null;
                        this.recordOverride(inputField, 'navigationUp');
                        this.notifyChange(inputField);
                    },
                    undo: () => {
                        inputField.navigationUp = oldVal;
                        this.notifyChange(inputField);
                    }
                });
            }, inputField, 'navigationUp');

            this.createUnityObjectField(parent, 'Nav Down', inputField.navigationDown || null, (value) => {
                const oldVal = inputField.navigationDown || null;
                CommandHistory.execute({
                    name: 'Change Input Field Nav Down',
                    execute: () => {
                        inputField.navigationDown = value || null;
                        this.recordOverride(inputField, 'navigationDown');
                        this.notifyChange(inputField);
                    },
                    undo: () => {
                        inputField.navigationDown = oldVal;
                        this.notifyChange(inputField);
                    }
                });
            }, inputField, 'navigationDown');

            this.createUnityObjectField(parent, 'Nav Left', inputField.navigationLeft || null, (value) => {
                const oldVal = inputField.navigationLeft || null;
                CommandHistory.execute({
                    name: 'Change Input Field Nav Left',
                    execute: () => {
                        inputField.navigationLeft = value || null;
                        this.recordOverride(inputField, 'navigationLeft');
                        this.notifyChange(inputField);
                    },
                    undo: () => {
                        inputField.navigationLeft = oldVal;
                        this.notifyChange(inputField);
                    }
                });
            }, inputField, 'navigationLeft');

            this.createUnityObjectField(parent, 'Nav Right', inputField.navigationRight || null, (value) => {
                const oldVal = inputField.navigationRight || null;
                CommandHistory.execute({
                    name: 'Change Input Field Nav Right',
                    execute: () => {
                        inputField.navigationRight = value || null;
                        this.recordOverride(inputField, 'navigationRight');
                        this.notifyChange(inputField);
                    },
                    undo: () => {
                        inputField.navigationRight = oldVal;
                        this.notifyChange(inputField);
                    }
                });
            }, inputField, 'navigationRight');
        }

        this.createUnityField(parent, 'Text', 'text', inputField.text || '', (v) => {
            const oldVal = inputField.text || '';
            CommandHistory.execute({
                name: 'Change Input Field Text',
                execute: () => {
                    inputField.setText?.(v, false);
                    this.recordOverride(inputField, 'text');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.setText?.(oldVal, false);
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'text');

        this.createUnityField(parent, 'Placeholder', 'text', inputField.placeholder || 'Enter text...', (v) => {
            const oldVal = inputField.placeholder || 'Enter text...';
            CommandHistory.execute({
                name: 'Change Input Field Placeholder',
                execute: () => {
                    inputField.placeholder = v;
                    this.recordOverride(inputField, 'placeholder');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.placeholder = oldVal;
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'placeholder');

        this.createUnityCheckbox(parent, 'Select All On Focus', inputField.selectAllOnFocus ?? false, (checked: boolean) => {
            const oldVal = inputField.selectAllOnFocus ?? false;
            CommandHistory.execute({
                name: 'Toggle Input Field Select All On Focus',
                execute: () => {
                    inputField.selectAllOnFocus = checked;
                    this.recordOverride(inputField, 'selectAllOnFocus');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.selectAllOnFocus = oldVal;
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'selectAllOnFocus');

        this.createUnityCheckbox(parent, 'Restore On Escape', inputField.restoreTextOnEscape ?? true, (checked: boolean) => {
            const oldVal = inputField.restoreTextOnEscape ?? true;
            CommandHistory.execute({
                name: 'Toggle Input Field Restore On Escape',
                execute: () => {
                    inputField.restoreTextOnEscape = checked;
                    this.recordOverride(inputField, 'restoreTextOnEscape');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.restoreTextOnEscape = oldVal;
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'restoreTextOnEscape');

        this.createUnityDropdown(parent, 'Line Type', ['SingleLine', 'MultiLineSubmit', 'MultiLineNewline'], inputField.lineType || 'SingleLine', (v) => {
            const oldVal = inputField.lineType || 'SingleLine';
            CommandHistory.execute({
                name: 'Change Input Field Line Type',
                execute: () => {
                    inputField.lineType = v;
                    inputField.setText?.(inputField.text || '', false);
                    this.recordOverride(inputField, 'lineType');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.lineType = oldVal;
                    inputField.setText?.(inputField.text || '', false);
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'lineType');

        this.createUnityDropdown(parent, 'Content Type', ['Standard', 'IntegerNumber', 'DecimalNumber', 'Password'], inputField.contentType || 'Standard', (v) => {
            const oldVal = inputField.contentType || 'Standard';
            CommandHistory.execute({
                name: 'Change Input Field Content Type',
                execute: () => {
                    inputField.contentType = v;
                    inputField.setText?.(inputField.text || '', false);
                    this.recordOverride(inputField, 'contentType');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.contentType = oldVal;
                    inputField.setText?.(inputField.text || '', false);
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'contentType');

        this.createUnityDropdown(parent, 'Character Validation', ['None', 'Alphanumeric', 'Name', 'EmailAddress'], inputField.characterValidation || 'None', (v) => {
            const oldVal = inputField.characterValidation || 'None';
            CommandHistory.execute({
                name: 'Change Input Field Character Validation',
                execute: () => {
                    inputField.characterValidation = v;
                    inputField.setText?.(inputField.text || '', false);
                    this.recordOverride(inputField, 'characterValidation');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.characterValidation = oldVal;
                    inputField.setText?.(inputField.text || '', false);
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'characterValidation');

        this.createUnityDropdown(parent, 'Text Alignment', ['Left', 'Center', 'Right'], inputField.textAlignment || 'Left', (v) => {
            const oldVal = inputField.textAlignment || 'Left';
            CommandHistory.execute({
                name: 'Change Input Field Text Alignment',
                execute: () => {
                    inputField.textAlignment = v;
                    this.recordOverride(inputField, 'textAlignment');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.textAlignment = oldVal;
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'textAlignment');

        this.createUnityField(parent, 'Character Limit', 'number', inputField.characterLimit ?? 0, (v) => {
            const oldVal = inputField.characterLimit ?? 0;
            const nextVal = parseInt(v, 10);
            CommandHistory.execute({
                name: 'Change Input Field Character Limit',
                execute: () => {
                    inputField.characterLimit = Number.isFinite(nextVal) ? Math.max(0, nextVal) : oldVal;
                    inputField.setText?.(inputField.text || '', false);
                    this.recordOverride(inputField, 'characterLimit');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.characterLimit = oldVal;
                    inputField.setText?.(inputField.text || '', false);
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'characterLimit');

        this.createUnityCheckbox(parent, 'Interactable', inputField.interactable ?? true, (checked: boolean) => {
            const oldVal = inputField.interactable ?? true;
            CommandHistory.execute({
                name: 'Toggle Input Field Interactable',
                execute: () => {
                    inputField.interactable = checked;
                    this.recordOverride(inputField, 'interactable');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.interactable = oldVal;
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'interactable');

        this.createUnityCheckbox(parent, 'Read Only', inputField.readOnly ?? false, (checked: boolean) => {
            const oldVal = inputField.readOnly ?? false;
            CommandHistory.execute({
                name: 'Toggle Input Field Read Only',
                execute: () => {
                    inputField.readOnly = checked;
                    this.recordOverride(inputField, 'readOnly');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.readOnly = oldVal;
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'readOnly');

        this.createUnityColorField(parent, 'Background', inputField.backgroundColor || '#2f2f2f', (v) => {
            const oldVal = inputField.backgroundColor || '#2f2f2f';
            CommandHistory.execute({
                name: 'Change Input Field Background',
                execute: () => {
                    inputField.backgroundColor = v;
                    this.recordOverride(inputField, 'backgroundColor');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.backgroundColor = oldVal;
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'backgroundColor');

        this.createUnityColorField(parent, 'Text Color', inputField.textColor || '#ffffff', (v) => {
            const oldVal = inputField.textColor || '#ffffff';
            CommandHistory.execute({
                name: 'Change Input Field Text Color',
                execute: () => {
                    inputField.textColor = v;
                    this.recordOverride(inputField, 'textColor');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.textColor = oldVal;
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'textColor');

        this.createUnityColorField(parent, 'Placeholder Color', inputField.placeholderColor || '#7f7f7f', (v) => {
            const oldVal = inputField.placeholderColor || '#7f7f7f';
            CommandHistory.execute({
                name: 'Change Input Field Placeholder Color',
                execute: () => {
                    inputField.placeholderColor = v;
                    this.recordOverride(inputField, 'placeholderColor');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.placeholderColor = oldVal;
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'placeholderColor');

        this.createUnityColorField(parent, 'Selected Color', inputField.selectedColor || '#3a3a3a', (v) => {
            const oldVal = inputField.selectedColor || '#3a3a3a';
            CommandHistory.execute({
                name: 'Change Input Field Selected Color',
                execute: () => {
                    inputField.selectedColor = v;
                    this.recordOverride(inputField, 'selectedColor');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.selectedColor = oldVal;
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'selectedColor');

        this.createUnityColorField(parent, 'Highlight Color', inputField.highlightedColor || '#454545', (v) => {
            const oldVal = inputField.highlightedColor || '#454545';
            CommandHistory.execute({
                name: 'Change Input Field Highlight Color',
                execute: () => {
                    inputField.highlightedColor = v;
                    this.recordOverride(inputField, 'highlightedColor');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.highlightedColor = oldVal;
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'highlightedColor');

        this.createUnityColorField(parent, 'Pressed Color', inputField.pressedColor || '#2f6ea1', (v) => {
            const oldVal = inputField.pressedColor || '#2f6ea1';
            CommandHistory.execute({
                name: 'Change Input Field Pressed Color',
                execute: () => {
                    inputField.pressedColor = v;
                    this.recordOverride(inputField, 'pressedColor');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.pressedColor = oldVal;
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'pressedColor');

        this.createUnityColorField(parent, 'Disabled Color', inputField.disabledColor || '#232323', (v) => {
            const oldVal = inputField.disabledColor || '#232323';
            CommandHistory.execute({
                name: 'Change Input Field Disabled Color',
                execute: () => {
                    inputField.disabledColor = v;
                    this.recordOverride(inputField, 'disabledColor');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.disabledColor = oldVal;
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'disabledColor');

        this.createUnityColorField(parent, 'Caret Color', inputField.caretColor || '#ffffff', (v) => {
            const oldVal = inputField.caretColor || '#ffffff';
            CommandHistory.execute({
                name: 'Change Input Field Caret Color',
                execute: () => {
                    inputField.caretColor = v;
                    this.recordOverride(inputField, 'caretColor');
                    this.notifyChange(inputField);
                },
                undo: () => {
                    inputField.caretColor = oldVal;
                    this.notifyChange(inputField);
                }
            });
        }, inputField, 'caretColor');
    }

    public createUIDropdownInspector(parent: HTMLElement, dropdown: any): void {
        this.createUnityDropdown(parent, 'Navigation', ['Automatic', 'Explicit', 'None'], dropdown.navigationMode || 'Automatic', (v) => {
            const oldVal = dropdown.navigationMode || 'Automatic';
            CommandHistory.execute({
                name: 'Change Dropdown Navigation Mode',
                execute: () => {
                    dropdown.navigationMode = v;
                    this.recordOverride(dropdown, 'navigationMode');
                    this.notifyChange(dropdown);
                    this.refreshSelected?.();
                },
                undo: () => {
                    dropdown.navigationMode = oldVal;
                    this.notifyChange(dropdown);
                    this.refreshSelected?.();
                }
            });
        }, dropdown, 'navigationMode');

        if ((dropdown.navigationMode || 'Automatic') === 'Explicit') {
            this.createUnityObjectField(parent, 'Nav Up', dropdown.navigationUp || null, (value) => {
                const oldVal = dropdown.navigationUp || null;
                CommandHistory.execute({
                    name: 'Change Dropdown Nav Up',
                    execute: () => {
                        dropdown.navigationUp = value || null;
                        this.recordOverride(dropdown, 'navigationUp');
                        this.notifyChange(dropdown);
                    },
                    undo: () => {
                        dropdown.navigationUp = oldVal;
                        this.notifyChange(dropdown);
                    }
                });
            }, dropdown, 'navigationUp');

            this.createUnityObjectField(parent, 'Nav Down', dropdown.navigationDown || null, (value) => {
                const oldVal = dropdown.navigationDown || null;
                CommandHistory.execute({
                    name: 'Change Dropdown Nav Down',
                    execute: () => {
                        dropdown.navigationDown = value || null;
                        this.recordOverride(dropdown, 'navigationDown');
                        this.notifyChange(dropdown);
                    },
                    undo: () => {
                        dropdown.navigationDown = oldVal;
                        this.notifyChange(dropdown);
                    }
                });
            }, dropdown, 'navigationDown');

            this.createUnityObjectField(parent, 'Nav Left', dropdown.navigationLeft || null, (value) => {
                const oldVal = dropdown.navigationLeft || null;
                CommandHistory.execute({
                    name: 'Change Dropdown Nav Left',
                    execute: () => {
                        dropdown.navigationLeft = value || null;
                        this.recordOverride(dropdown, 'navigationLeft');
                        this.notifyChange(dropdown);
                    },
                    undo: () => {
                        dropdown.navigationLeft = oldVal;
                        this.notifyChange(dropdown);
                    }
                });
            }, dropdown, 'navigationLeft');

            this.createUnityObjectField(parent, 'Nav Right', dropdown.navigationRight || null, (value) => {
                const oldVal = dropdown.navigationRight || null;
                CommandHistory.execute({
                    name: 'Change Dropdown Nav Right',
                    execute: () => {
                        dropdown.navigationRight = value || null;
                        this.recordOverride(dropdown, 'navigationRight');
                        this.notifyChange(dropdown);
                    },
                    undo: () => {
                        dropdown.navigationRight = oldVal;
                        this.notifyChange(dropdown);
                    }
                });
            }, dropdown, 'navigationRight');
        }

        this.createUnityField(parent, 'Options', 'text', Array.isArray(dropdown.options) ? dropdown.options.join(' | ') : '', (v) => {
            const oldVal = Array.isArray(dropdown.options) ? [...dropdown.options] : [];
            const nextOptions = v
                .split('|')
                .map((entry: string) => entry.trim())
                .filter((entry: string) => entry.length > 0);
            CommandHistory.execute({
                name: 'Change Dropdown Options',
                execute: () => {
                    dropdown.options = nextOptions.length > 0 ? nextOptions : ['Option'];
                    dropdown.setSelectedIndex?.(dropdown.selectedIndex ?? 0, false);
                    this.recordOverride(dropdown, 'options');
                    this.notifyChange(dropdown);
                },
                undo: () => {
                    dropdown.options = oldVal;
                    dropdown.setSelectedIndex?.(dropdown.selectedIndex ?? 0, false);
                    this.notifyChange(dropdown);
                }
            });
        }, dropdown, 'options');

        this.createUnityField(parent, 'Selected Index', 'number', dropdown.selectedIndex ?? 0, (v) => {
            const oldVal = dropdown.selectedIndex ?? 0;
            const nextVal = parseInt(v, 10);
            CommandHistory.execute({
                name: 'Change Dropdown Selected Index',
                execute: () => {
                    dropdown.setSelectedIndex?.(Number.isFinite(nextVal) ? nextVal : oldVal, false);
                    this.recordOverride(dropdown, 'selectedIndex');
                    this.notifyChange(dropdown);
                },
                undo: () => {
                    dropdown.setSelectedIndex?.(oldVal, false);
                    this.notifyChange(dropdown);
                }
            });
        }, dropdown, 'selectedIndex');

        this.createUnityField(parent, 'Max Visible', 'number', dropdown.maxVisibleItems ?? 6, (v) => {
            const oldVal = dropdown.maxVisibleItems ?? 6;
            const nextVal = parseInt(v, 10);
            CommandHistory.execute({
                name: 'Change Dropdown Max Visible',
                execute: () => {
                    dropdown.maxVisibleItems = Number.isFinite(nextVal) ? Math.max(1, nextVal) : oldVal;
                    this.recordOverride(dropdown, 'maxVisibleItems');
                    this.notifyChange(dropdown);
                },
                undo: () => {
                    dropdown.maxVisibleItems = oldVal;
                    this.notifyChange(dropdown);
                }
            });
        }, dropdown, 'maxVisibleItems');

        this.createUnityField(parent, 'Disabled Indices', 'text', Array.isArray(dropdown.disabledOptionIndices) ? dropdown.disabledOptionIndices.join(', ') : '', (v) => {
            const oldVal = Array.isArray(dropdown.disabledOptionIndices) ? [...dropdown.disabledOptionIndices] : [];
            const nextIndices = v
                .split(',')
                .map((entry: string) => parseInt(entry.trim(), 10))
                .filter((entry: number) => Number.isFinite(entry));
            CommandHistory.execute({
                name: 'Change Dropdown Disabled Indices',
                execute: () => {
                    dropdown.disabledOptionIndices = nextIndices;
                    dropdown.setSelectedIndex?.(dropdown.selectedIndex ?? 0, false);
                    this.recordOverride(dropdown, 'disabledOptionIndices');
                    this.notifyChange(dropdown);
                },
                undo: () => {
                    dropdown.disabledOptionIndices = oldVal;
                    dropdown.setSelectedIndex?.(dropdown.selectedIndex ?? 0, false);
                    this.notifyChange(dropdown);
                }
            });
        }, dropdown, 'disabledOptionIndices');

        this.createUnityDropdown(parent, 'Popup Direction', ['Auto', 'Down', 'Up'], dropdown.popupDirection || 'Auto', (v) => {
            const oldVal = dropdown.popupDirection || 'Auto';
            CommandHistory.execute({
                name: 'Change Dropdown Popup Direction',
                execute: () => {
                    dropdown.popupDirection = v;
                    this.recordOverride(dropdown, 'popupDirection');
                    this.notifyChange(dropdown);
                },
                undo: () => {
                    dropdown.popupDirection = oldVal;
                    this.notifyChange(dropdown);
                }
            });
        }, dropdown, 'popupDirection');

        this.createUnityCheckbox(parent, 'Interactable', dropdown.interactable ?? true, (checked: boolean) => {
            const oldVal = dropdown.interactable ?? true;
            CommandHistory.execute({
                name: 'Toggle Dropdown Interactable',
                execute: () => {
                    dropdown.interactable = checked;
                    this.recordOverride(dropdown, 'interactable');
                    this.notifyChange(dropdown);
                },
                undo: () => {
                    dropdown.interactable = oldVal;
                    this.notifyChange(dropdown);
                }
            });
        }, dropdown, 'interactable');

        this.createUnityColorField(parent, 'Normal Color', dropdown.normalColor || '#3f3f3f', (v) => {
            const oldVal = dropdown.normalColor || '#3f3f3f';
            CommandHistory.execute({
                name: 'Change Dropdown Normal Color',
                execute: () => {
                    dropdown.normalColor = v;
                    this.recordOverride(dropdown, 'normalColor');
                    this.notifyChange(dropdown);
                },
                undo: () => {
                    dropdown.normalColor = oldVal;
                    this.notifyChange(dropdown);
                }
            });
        }, dropdown, 'normalColor');

        this.createUnityColorField(parent, 'Selected Color', dropdown.selectedColor || '#565656', (v) => {
            const oldVal = dropdown.selectedColor || '#565656';
            CommandHistory.execute({
                name: 'Change Dropdown Selected Color',
                execute: () => {
                    dropdown.selectedColor = v;
                    this.recordOverride(dropdown, 'selectedColor');
                    this.notifyChange(dropdown);
                },
                undo: () => {
                    dropdown.selectedColor = oldVal;
                    this.notifyChange(dropdown);
                }
            });
        }, dropdown, 'selectedColor');

        this.createUnityColorField(parent, 'Highlight Color', dropdown.highlightedColor || '#4e4e4e', (v) => {
            const oldVal = dropdown.highlightedColor || '#4e4e4e';
            CommandHistory.execute({
                name: 'Change Dropdown Highlight Color',
                execute: () => {
                    dropdown.highlightedColor = v;
                    this.recordOverride(dropdown, 'highlightedColor');
                    this.notifyChange(dropdown);
                },
                undo: () => {
                    dropdown.highlightedColor = oldVal;
                    this.notifyChange(dropdown);
                }
            });
        }, dropdown, 'highlightedColor');

        this.createUnityColorField(parent, 'Pressed Color', dropdown.pressedColor || '#2f6ea1', (v) => {
            const oldVal = dropdown.pressedColor || '#2f6ea1';
            CommandHistory.execute({
                name: 'Change Dropdown Pressed Color',
                execute: () => {
                    dropdown.pressedColor = v;
                    this.recordOverride(dropdown, 'pressedColor');
                    this.notifyChange(dropdown);
                },
                undo: () => {
                    dropdown.pressedColor = oldVal;
                    this.notifyChange(dropdown);
                }
            });
        }, dropdown, 'pressedColor');

        this.createUnityColorField(parent, 'Disabled Color', dropdown.disabledColor || '#2b2b2b', (v) => {
            const oldVal = dropdown.disabledColor || '#2b2b2b';
            CommandHistory.execute({
                name: 'Change Dropdown Disabled Color',
                execute: () => {
                    dropdown.disabledColor = v;
                    this.recordOverride(dropdown, 'disabledColor');
                    this.notifyChange(dropdown);
                },
                undo: () => {
                    dropdown.disabledColor = oldVal;
                    this.notifyChange(dropdown);
                }
            });
        }, dropdown, 'disabledColor');

        this.createUnityColorField(parent, 'Item Background', dropdown.itemBackgroundColor || '#2f2f2f', (v) => {
            const oldVal = dropdown.itemBackgroundColor || '#2f2f2f';
            CommandHistory.execute({
                name: 'Change Dropdown Item Background',
                execute: () => {
                    dropdown.itemBackgroundColor = v;
                    this.recordOverride(dropdown, 'itemBackgroundColor');
                    this.notifyChange(dropdown);
                },
                undo: () => {
                    dropdown.itemBackgroundColor = oldVal;
                    this.notifyChange(dropdown);
                }
            });
        }, dropdown, 'itemBackgroundColor');

        this.createUnityColorField(parent, 'Item Selected', dropdown.itemSelectedColor || '#355f86', (v) => {
            const oldVal = dropdown.itemSelectedColor || '#355f86';
            CommandHistory.execute({
                name: 'Change Dropdown Item Selected',
                execute: () => {
                    dropdown.itemSelectedColor = v;
                    this.recordOverride(dropdown, 'itemSelectedColor');
                    this.notifyChange(dropdown);
                },
                undo: () => {
                    dropdown.itemSelectedColor = oldVal;
                    this.notifyChange(dropdown);
                }
            });
        }, dropdown, 'itemSelectedColor');

        this.createUnityColorField(parent, 'Item Highlight', dropdown.itemHighlightedColor || '#4a4a4a', (v) => {
            const oldVal = dropdown.itemHighlightedColor || '#4a4a4a';
            CommandHistory.execute({
                name: 'Change Dropdown Item Highlight',
                execute: () => {
                    dropdown.itemHighlightedColor = v;
                    this.recordOverride(dropdown, 'itemHighlightedColor');
                    this.notifyChange(dropdown);
                },
                undo: () => {
                    dropdown.itemHighlightedColor = oldVal;
                    this.notifyChange(dropdown);
                }
            });
        }, dropdown, 'itemHighlightedColor');

        this.createUnityColorField(parent, 'Text Color', dropdown.textColor || '#ffffff', (v) => {
            const oldVal = dropdown.textColor || '#ffffff';
            CommandHistory.execute({
                name: 'Change Dropdown Text Color',
                execute: () => {
                    dropdown.textColor = v;
                    this.recordOverride(dropdown, 'textColor');
                    this.notifyChange(dropdown);
                },
                undo: () => {
                    dropdown.textColor = oldVal;
                    this.notifyChange(dropdown);
                }
            });
        }, dropdown, 'textColor');
    }

    public createUIToggleInspector(parent: HTMLElement, toggle: any): void {
        this.createUnityDropdown(parent, 'Navigation', ['Automatic', 'Explicit', 'None'], toggle.navigationMode || 'Automatic', (v) => {
            const oldVal = toggle.navigationMode || 'Automatic';
            CommandHistory.execute({
                name: 'Change Toggle Navigation Mode',
                execute: () => {
                    toggle.navigationMode = v;
                    this.recordOverride(toggle, 'navigationMode');
                    this.notifyChange(toggle);
                    this.refreshSelected?.();
                },
                undo: () => {
                    toggle.navigationMode = oldVal;
                    this.notifyChange(toggle);
                    this.refreshSelected?.();
                }
            });
        }, toggle, 'navigationMode');

        if ((toggle.navigationMode || 'Automatic') === 'Explicit') {
            this.createUnityObjectField(parent, 'Nav Up', toggle.navigationUp || null, (value) => {
                const oldVal = toggle.navigationUp || null;
                CommandHistory.execute({
                    name: 'Change Toggle Nav Up',
                    execute: () => {
                        toggle.navigationUp = value || null;
                        this.recordOverride(toggle, 'navigationUp');
                        this.notifyChange(toggle);
                    },
                    undo: () => {
                        toggle.navigationUp = oldVal;
                        this.notifyChange(toggle);
                    }
                });
            }, toggle, 'navigationUp');

            this.createUnityObjectField(parent, 'Nav Down', toggle.navigationDown || null, (value) => {
                const oldVal = toggle.navigationDown || null;
                CommandHistory.execute({
                    name: 'Change Toggle Nav Down',
                    execute: () => {
                        toggle.navigationDown = value || null;
                        this.recordOverride(toggle, 'navigationDown');
                        this.notifyChange(toggle);
                    },
                    undo: () => {
                        toggle.navigationDown = oldVal;
                        this.notifyChange(toggle);
                    }
                });
            }, toggle, 'navigationDown');

            this.createUnityObjectField(parent, 'Nav Left', toggle.navigationLeft || null, (value) => {
                const oldVal = toggle.navigationLeft || null;
                CommandHistory.execute({
                    name: 'Change Toggle Nav Left',
                    execute: () => {
                        toggle.navigationLeft = value || null;
                        this.recordOverride(toggle, 'navigationLeft');
                        this.notifyChange(toggle);
                    },
                    undo: () => {
                        toggle.navigationLeft = oldVal;
                        this.notifyChange(toggle);
                    }
                });
            }, toggle, 'navigationLeft');

            this.createUnityObjectField(parent, 'Nav Right', toggle.navigationRight || null, (value) => {
                const oldVal = toggle.navigationRight || null;
                CommandHistory.execute({
                    name: 'Change Toggle Nav Right',
                    execute: () => {
                        toggle.navigationRight = value || null;
                        this.recordOverride(toggle, 'navigationRight');
                        this.notifyChange(toggle);
                    },
                    undo: () => {
                        toggle.navigationRight = oldVal;
                        this.notifyChange(toggle);
                    }
                });
            }, toggle, 'navigationRight');
        }

        this.createUnityField(parent, 'Label', 'text', toggle.label || 'Toggle', (v) => {
            const oldVal = toggle.label || 'Toggle';
            CommandHistory.execute({
                name: 'Change Toggle Label',
                execute: () => {
                    toggle.label = v;
                    this.recordOverride(toggle, 'label');
                    this.notifyChange(toggle);
                },
                undo: () => {
                    toggle.label = oldVal;
                    this.notifyChange(toggle);
                }
            });
        }, toggle, 'label');

        this.createUnityObjectField(parent, 'Toggle Group', toggle.group || null, (value) => {
            const oldVal = toggle.group || null;
            CommandHistory.execute({
                name: 'Change Toggle Group',
                execute: () => {
                    toggle.group = value || null;
                    this.recordOverride(toggle, 'group');
                    this.notifyChange(toggle);
                },
                undo: () => {
                    toggle.group = oldVal;
                    this.notifyChange(toggle);
                }
            });
        }, toggle, 'group');

        this.createUnityCheckbox(parent, 'Is On', toggle.isOn ?? false, (checked: boolean) => {
            const oldVal = toggle.isOn ?? false;
            CommandHistory.execute({
                name: 'Toggle UI Toggle Value',
                execute: () => {
                    toggle.isOn = checked;
                    this.recordOverride(toggle, 'isOn');
                    this.notifyChange(toggle);
                },
                undo: () => {
                    toggle.isOn = oldVal;
                    this.notifyChange(toggle);
                }
            });
        }, toggle, 'isOn');

        this.createUnityCheckbox(parent, 'Interactable', toggle.interactable ?? true, (checked: boolean) => {
            const oldVal = toggle.interactable ?? true;
            CommandHistory.execute({
                name: 'Toggle UI Toggle Interactable',
                execute: () => {
                    toggle.interactable = checked;
                    this.recordOverride(toggle, 'interactable');
                    this.notifyChange(toggle);
                },
                undo: () => {
                    toggle.interactable = oldVal;
                    this.notifyChange(toggle);
                }
            });
        }, toggle, 'interactable');

        this.createUnityColorField(parent, 'Off Background', toggle.offBackgroundColor || '#3f3f3f', (v) => {
            const oldVal = toggle.offBackgroundColor || '#3f3f3f';
            CommandHistory.execute({
                name: 'Change Toggle Off Background',
                execute: () => {
                    toggle.offBackgroundColor = v;
                    this.recordOverride(toggle, 'offBackgroundColor');
                    this.notifyChange(toggle);
                },
                undo: () => {
                    toggle.offBackgroundColor = oldVal;
                    this.notifyChange(toggle);
                }
            });
        }, toggle, 'offBackgroundColor');

        this.createUnityColorField(parent, 'On Background', toggle.onBackgroundColor || '#2f6ea1', (v) => {
            const oldVal = toggle.onBackgroundColor || '#2f6ea1';
            CommandHistory.execute({
                name: 'Change Toggle On Background',
                execute: () => {
                    toggle.onBackgroundColor = v;
                    this.recordOverride(toggle, 'onBackgroundColor');
                    this.notifyChange(toggle);
                },
                undo: () => {
                    toggle.onBackgroundColor = oldVal;
                    this.notifyChange(toggle);
                }
            });
        }, toggle, 'onBackgroundColor');

        this.createUnityColorField(parent, 'Highlight Color', toggle.highlightedColor || '#5a5a5a', (v) => {
            const oldVal = toggle.highlightedColor || '#5a5a5a';
            CommandHistory.execute({
                name: 'Change Toggle Highlight Color',
                execute: () => {
                    toggle.highlightedColor = v;
                    this.recordOverride(toggle, 'highlightedColor');
                    this.notifyChange(toggle);
                },
                undo: () => {
                    toggle.highlightedColor = oldVal;
                    this.notifyChange(toggle);
                }
            });
        }, toggle, 'highlightedColor');

        this.createUnityColorField(parent, 'Pressed Color', toggle.pressedColor || '#7a7a7a', (v) => {
            const oldVal = toggle.pressedColor || '#7a7a7a';
            CommandHistory.execute({
                name: 'Change Toggle Pressed Color',
                execute: () => {
                    toggle.pressedColor = v;
                    this.recordOverride(toggle, 'pressedColor');
                    this.notifyChange(toggle);
                },
                undo: () => {
                    toggle.pressedColor = oldVal;
                    this.notifyChange(toggle);
                }
            });
        }, toggle, 'pressedColor');

        this.createUnityColorField(parent, 'Disabled Color', toggle.disabledColor || '#2b2b2b', (v) => {
            const oldVal = toggle.disabledColor || '#2b2b2b';
            CommandHistory.execute({
                name: 'Change Toggle Disabled Color',
                execute: () => {
                    toggle.disabledColor = v;
                    this.recordOverride(toggle, 'disabledColor');
                    this.notifyChange(toggle);
                },
                undo: () => {
                    toggle.disabledColor = oldVal;
                    this.notifyChange(toggle);
                }
            });
        }, toggle, 'disabledColor');

        this.createUnityColorField(parent, 'Checkmark Color', toggle.checkmarkColor || '#ffffff', (v) => {
            const oldVal = toggle.checkmarkColor || '#ffffff';
            CommandHistory.execute({
                name: 'Change Toggle Checkmark Color',
                execute: () => {
                    toggle.checkmarkColor = v;
                    this.recordOverride(toggle, 'checkmarkColor');
                    this.notifyChange(toggle);
                },
                undo: () => {
                    toggle.checkmarkColor = oldVal;
                    this.notifyChange(toggle);
                }
            });
        }, toggle, 'checkmarkColor');

        this.createUnityColorField(parent, 'Text Color', toggle.textColor || '#ffffff', (v) => {
            const oldVal = toggle.textColor || '#ffffff';
            CommandHistory.execute({
                name: 'Change Toggle Text Color',
                execute: () => {
                    toggle.textColor = v;
                    this.recordOverride(toggle, 'textColor');
                    this.notifyChange(toggle);
                },
                undo: () => {
                    toggle.textColor = oldVal;
                    this.notifyChange(toggle);
                }
            });
        }, toggle, 'textColor');
    }

    public createToggleGroupInspector(parent: HTMLElement, group: any): void {
        this.createUnityCheckbox(parent, 'Allow Switch Off', group.allowSwitchOff ?? false, (checked: boolean) => {
            const oldVal = group.allowSwitchOff ?? false;
            CommandHistory.execute({
                name: 'Toggle Allow Switch Off',
                execute: () => {
                    group.allowSwitchOff = checked;
                    this.recordOverride(group, 'allowSwitchOff');
                    this.notifyChange(group);
                },
                undo: () => {
                    group.allowSwitchOff = oldVal;
                    this.notifyChange(group);
                }
            });
        }, group, 'allowSwitchOff');
    }

    public createUISliderInspector(parent: HTMLElement, slider: any): void {
        this.createUnityDropdown(parent, 'Navigation', ['Automatic', 'Explicit', 'None'], slider.navigationMode || 'Automatic', (v) => {
            const oldVal = slider.navigationMode || 'Automatic';
            CommandHistory.execute({
                name: 'Change Slider Navigation Mode',
                execute: () => {
                    slider.navigationMode = v;
                    this.recordOverride(slider, 'navigationMode');
                    this.notifyChange(slider);
                    this.refreshSelected?.();
                },
                undo: () => {
                    slider.navigationMode = oldVal;
                    this.notifyChange(slider);
                    this.refreshSelected?.();
                }
            });
        }, slider, 'navigationMode');

        if ((slider.navigationMode || 'Automatic') === 'Explicit') {
            this.createUnityObjectField(parent, 'Nav Up', slider.navigationUp || null, (value) => {
                const oldVal = slider.navigationUp || null;
                CommandHistory.execute({
                    name: 'Change Slider Nav Up',
                    execute: () => {
                        slider.navigationUp = value || null;
                        this.recordOverride(slider, 'navigationUp');
                        this.notifyChange(slider);
                    },
                    undo: () => {
                        slider.navigationUp = oldVal;
                        this.notifyChange(slider);
                    }
                });
            }, slider, 'navigationUp');

            this.createUnityObjectField(parent, 'Nav Down', slider.navigationDown || null, (value) => {
                const oldVal = slider.navigationDown || null;
                CommandHistory.execute({
                    name: 'Change Slider Nav Down',
                    execute: () => {
                        slider.navigationDown = value || null;
                        this.recordOverride(slider, 'navigationDown');
                        this.notifyChange(slider);
                    },
                    undo: () => {
                        slider.navigationDown = oldVal;
                        this.notifyChange(slider);
                    }
                });
            }, slider, 'navigationDown');

            this.createUnityObjectField(parent, 'Nav Left', slider.navigationLeft || null, (value) => {
                const oldVal = slider.navigationLeft || null;
                CommandHistory.execute({
                    name: 'Change Slider Nav Left',
                    execute: () => {
                        slider.navigationLeft = value || null;
                        this.recordOverride(slider, 'navigationLeft');
                        this.notifyChange(slider);
                    },
                    undo: () => {
                        slider.navigationLeft = oldVal;
                        this.notifyChange(slider);
                    }
                });
            }, slider, 'navigationLeft');

            this.createUnityObjectField(parent, 'Nav Right', slider.navigationRight || null, (value) => {
                const oldVal = slider.navigationRight || null;
                CommandHistory.execute({
                    name: 'Change Slider Nav Right',
                    execute: () => {
                        slider.navigationRight = value || null;
                        this.recordOverride(slider, 'navigationRight');
                        this.notifyChange(slider);
                    },
                    undo: () => {
                        slider.navigationRight = oldVal;
                        this.notifyChange(slider);
                    }
                });
            }, slider, 'navigationRight');
        }

        this.createUnityField(parent, 'Min Value', 'number', slider.minValue ?? 0, (v) => {
            const oldVal = slider.minValue ?? 0;
            const nextVal = parseFloat(v);
            CommandHistory.execute({
                name: 'Change Slider Min Value',
                execute: () => {
                    slider.minValue = Number.isFinite(nextVal) ? nextVal : oldVal;
                    slider.value = Math.max(slider.minValue, Math.min(slider.maxValue, slider.value));
                    this.recordOverride(slider, 'minValue');
                    this.notifyChange(slider);
                },
                undo: () => {
                    slider.minValue = oldVal;
                    this.notifyChange(slider);
                }
            });
        }, slider, 'minValue');

        this.createUnityField(parent, 'Max Value', 'number', slider.maxValue ?? 1, (v) => {
            const oldVal = slider.maxValue ?? 1;
            const nextVal = parseFloat(v);
            CommandHistory.execute({
                name: 'Change Slider Max Value',
                execute: () => {
                    slider.maxValue = Number.isFinite(nextVal) ? nextVal : oldVal;
                    slider.value = Math.max(slider.minValue, Math.min(slider.maxValue, slider.value));
                    this.recordOverride(slider, 'maxValue');
                    this.notifyChange(slider);
                },
                undo: () => {
                    slider.maxValue = oldVal;
                    this.notifyChange(slider);
                }
            });
        }, slider, 'maxValue');

        this.createUnityField(parent, 'Value', 'number', slider.value ?? 0.5, (v) => {
            const oldVal = slider.value ?? 0.5;
            const nextVal = parseFloat(v);
            CommandHistory.execute({
                name: 'Change Slider Value',
                execute: () => {
                    slider.setValue(Number.isFinite(nextVal) ? nextVal : oldVal, false);
                    this.recordOverride(slider, 'value');
                    this.notifyChange(slider);
                },
                undo: () => {
                    slider.setValue(oldVal, false);
                    this.notifyChange(slider);
                }
            });
        }, slider, 'value');

        this.createUnityCheckbox(parent, 'Whole Numbers', slider.wholeNumbers ?? false, (checked: boolean) => {
            const oldVal = slider.wholeNumbers ?? false;
            CommandHistory.execute({
                name: 'Toggle Slider Whole Numbers',
                execute: () => {
                    slider.wholeNumbers = checked;
                    slider.setValue(slider.value, false);
                    this.recordOverride(slider, 'wholeNumbers');
                    this.notifyChange(slider);
                },
                undo: () => {
                    slider.wholeNumbers = oldVal;
                    slider.setValue(slider.value, false);
                    this.notifyChange(slider);
                }
            });
        }, slider, 'wholeNumbers');

        this.createUnityField(parent, 'Keyboard Step', 'number', slider.keyboardStep ?? 0, (v) => {
            const oldVal = slider.keyboardStep ?? 0;
            const nextVal = parseFloat(v);
            CommandHistory.execute({
                name: 'Change Slider Keyboard Step',
                execute: () => {
                    slider.keyboardStep = Number.isFinite(nextVal) ? Math.max(0, nextVal) : oldVal;
                    this.recordOverride(slider, 'keyboardStep');
                    this.notifyChange(slider);
                },
                undo: () => {
                    slider.keyboardStep = oldVal;
                    this.notifyChange(slider);
                }
            });
        }, slider, 'keyboardStep');

        this.createUnityField(parent, 'Keyboard Page Step', 'number', slider.keyboardPageStep ?? 0, (v) => {
            const oldVal = slider.keyboardPageStep ?? 0;
            const nextVal = parseFloat(v);
            CommandHistory.execute({
                name: 'Change Slider Keyboard Page Step',
                execute: () => {
                    slider.keyboardPageStep = Number.isFinite(nextVal) ? Math.max(0, nextVal) : oldVal;
                    this.recordOverride(slider, 'keyboardPageStep');
                    this.notifyChange(slider);
                },
                undo: () => {
                    slider.keyboardPageStep = oldVal;
                    this.notifyChange(slider);
                }
            });
        }, slider, 'keyboardPageStep');

        this.createUnityDropdown(parent, 'Direction', ['LeftToRight', 'RightToLeft', 'BottomToTop', 'TopToBottom'], slider.direction || 'LeftToRight', (v) => {
            const oldVal = slider.direction || 'LeftToRight';
            CommandHistory.execute({
                name: 'Change Slider Direction',
                execute: () => {
                    slider.direction = v;
                    this.recordOverride(slider, 'direction');
                    this.notifyChange(slider);
                },
                undo: () => {
                    slider.direction = oldVal;
                    this.notifyChange(slider);
                }
            });
        }, slider, 'direction');

        this.createUnityCheckbox(parent, 'Interactable', slider.interactable ?? true, (checked: boolean) => {
            const oldVal = slider.interactable ?? true;
            CommandHistory.execute({
                name: 'Toggle Slider Interactable',
                execute: () => {
                    slider.interactable = checked;
                    this.recordOverride(slider, 'interactable');
                    this.notifyChange(slider);
                },
                undo: () => {
                    slider.interactable = oldVal;
                    this.notifyChange(slider);
                }
            });
        }, slider, 'interactable');

        this.createUnityColorField(parent, 'Background', slider.backgroundColor || '#3f3f3f', (v) => {
            const oldVal = slider.backgroundColor || '#3f3f3f';
            CommandHistory.execute({
                name: 'Change Slider Background',
                execute: () => {
                    slider.backgroundColor = v;
                    this.recordOverride(slider, 'backgroundColor');
                    this.notifyChange(slider);
                },
                undo: () => {
                    slider.backgroundColor = oldVal;
                    this.notifyChange(slider);
                }
            });
        }, slider, 'backgroundColor');

        this.createUnityColorField(parent, 'Fill', slider.fillColor || '#2f6ea1', (v) => {
            const oldVal = slider.fillColor || '#2f6ea1';
            CommandHistory.execute({
                name: 'Change Slider Fill Color',
                execute: () => {
                    slider.fillColor = v;
                    this.recordOverride(slider, 'fillColor');
                    this.notifyChange(slider);
                },
                undo: () => {
                    slider.fillColor = oldVal;
                    this.notifyChange(slider);
                }
            });
        }, slider, 'fillColor');

        this.createUnityColorField(parent, 'Handle', slider.handleColor || '#f2f2f2', (v) => {
            const oldVal = slider.handleColor || '#f2f2f2';
            CommandHistory.execute({
                name: 'Change Slider Handle Color',
                execute: () => {
                    slider.handleColor = v;
                    this.recordOverride(slider, 'handleColor');
                    this.notifyChange(slider);
                },
                undo: () => {
                    slider.handleColor = oldVal;
                    this.notifyChange(slider);
                }
            });
        }, slider, 'handleColor');

        this.createUnityColorField(parent, 'Highlight Color', slider.highlightedColor || '#5a5a5a', (v) => {
            const oldVal = slider.highlightedColor || '#5a5a5a';
            CommandHistory.execute({
                name: 'Change Slider Highlight Color',
                execute: () => {
                    slider.highlightedColor = v;
                    this.recordOverride(slider, 'highlightedColor');
                    this.notifyChange(slider);
                },
                undo: () => {
                    slider.highlightedColor = oldVal;
                    this.notifyChange(slider);
                }
            });
        }, slider, 'highlightedColor');

        this.createUnityColorField(parent, 'Pressed Color', slider.pressedColor || '#7a7a7a', (v) => {
            const oldVal = slider.pressedColor || '#7a7a7a';
            CommandHistory.execute({
                name: 'Change Slider Pressed Color',
                execute: () => {
                    slider.pressedColor = v;
                    this.recordOverride(slider, 'pressedColor');
                    this.notifyChange(slider);
                },
                undo: () => {
                    slider.pressedColor = oldVal;
                    this.notifyChange(slider);
                }
            });
        }, slider, 'pressedColor');

        this.createUnityColorField(parent, 'Disabled Color', slider.disabledColor || '#2b2b2b', (v) => {
            const oldVal = slider.disabledColor || '#2b2b2b';
            CommandHistory.execute({
                name: 'Change Slider Disabled Color',
                execute: () => {
                    slider.disabledColor = v;
                    this.recordOverride(slider, 'disabledColor');
                    this.notifyChange(slider);
                },
                undo: () => {
                    slider.disabledColor = oldVal;
                    this.notifyChange(slider);
                }
            });
        }, slider, 'disabledColor');
    }

    public createUIScrollbarInspector(parent: HTMLElement, scrollbar: any): void {
        this.createUnityDropdown(parent, 'Navigation', ['Automatic', 'Explicit', 'None'], scrollbar.navigationMode || 'Automatic', (v) => {
            const oldVal = scrollbar.navigationMode || 'Automatic';
            CommandHistory.execute({
                name: 'Change Scrollbar Navigation Mode',
                execute: () => {
                    scrollbar.navigationMode = v;
                    this.recordOverride(scrollbar, 'navigationMode');
                    this.notifyChange(scrollbar);
                    this.refreshSelected?.();
                },
                undo: () => {
                    scrollbar.navigationMode = oldVal;
                    this.notifyChange(scrollbar);
                    this.refreshSelected?.();
                }
            });
        }, scrollbar, 'navigationMode');

        if ((scrollbar.navigationMode || 'Automatic') === 'Explicit') {
            this.createUnityObjectField(parent, 'Nav Up', scrollbar.navigationUp || null, (value) => {
                const oldVal = scrollbar.navigationUp || null;
                CommandHistory.execute({
                    name: 'Change Scrollbar Nav Up',
                    execute: () => {
                        scrollbar.navigationUp = value || null;
                        this.recordOverride(scrollbar, 'navigationUp');
                        this.notifyChange(scrollbar);
                    },
                    undo: () => {
                        scrollbar.navigationUp = oldVal;
                        this.notifyChange(scrollbar);
                    }
                });
            }, scrollbar, 'navigationUp');

            this.createUnityObjectField(parent, 'Nav Down', scrollbar.navigationDown || null, (value) => {
                const oldVal = scrollbar.navigationDown || null;
                CommandHistory.execute({
                    name: 'Change Scrollbar Nav Down',
                    execute: () => {
                        scrollbar.navigationDown = value || null;
                        this.recordOverride(scrollbar, 'navigationDown');
                        this.notifyChange(scrollbar);
                    },
                    undo: () => {
                        scrollbar.navigationDown = oldVal;
                        this.notifyChange(scrollbar);
                    }
                });
            }, scrollbar, 'navigationDown');

            this.createUnityObjectField(parent, 'Nav Left', scrollbar.navigationLeft || null, (value) => {
                const oldVal = scrollbar.navigationLeft || null;
                CommandHistory.execute({
                    name: 'Change Scrollbar Nav Left',
                    execute: () => {
                        scrollbar.navigationLeft = value || null;
                        this.recordOverride(scrollbar, 'navigationLeft');
                        this.notifyChange(scrollbar);
                    },
                    undo: () => {
                        scrollbar.navigationLeft = oldVal;
                        this.notifyChange(scrollbar);
                    }
                });
            }, scrollbar, 'navigationLeft');

            this.createUnityObjectField(parent, 'Nav Right', scrollbar.navigationRight || null, (value) => {
                const oldVal = scrollbar.navigationRight || null;
                CommandHistory.execute({
                    name: 'Change Scrollbar Nav Right',
                    execute: () => {
                        scrollbar.navigationRight = value || null;
                        this.recordOverride(scrollbar, 'navigationRight');
                        this.notifyChange(scrollbar);
                    },
                    undo: () => {
                        scrollbar.navigationRight = oldVal;
                        this.notifyChange(scrollbar);
                    }
                });
            }, scrollbar, 'navigationRight');
        }

        this.createUnitySlider(parent, 'Value', scrollbar.value ?? 0, 0, 1, (value) => {
            const oldVal = scrollbar.value ?? 0;
            CommandHistory.execute({
                name: 'Change Scrollbar Value',
                execute: () => {
                    scrollbar.setValue(value, false);
                    this.recordOverride(scrollbar, 'value');
                    this.notifyChange(scrollbar);
                },
                undo: () => {
                    scrollbar.setValue(oldVal, false);
                    this.notifyChange(scrollbar);
                }
            });
        }, scrollbar, 'value');

        this.createUnitySlider(parent, 'Handle Size', scrollbar.size ?? 0.2, 0.05, 1, (value) => {
            const oldVal = scrollbar.size ?? 0.2;
            CommandHistory.execute({
                name: 'Change Scrollbar Handle Size',
                execute: () => {
                    scrollbar.setSize?.(value);
                    this.recordOverride(scrollbar, 'size');
                    this.notifyChange(scrollbar);
                },
                undo: () => {
                    scrollbar.setSize?.(oldVal);
                    this.notifyChange(scrollbar);
                }
            });
        }, scrollbar, 'size');

        this.createUnityField(parent, 'Steps', 'number', scrollbar.numberOfSteps ?? 0, (v) => {
            const oldVal = scrollbar.numberOfSteps ?? 0;
            const nextVal = parseInt(v, 10);
            CommandHistory.execute({
                name: 'Change Scrollbar Steps',
                execute: () => {
                    scrollbar.numberOfSteps = Number.isFinite(nextVal) ? Math.max(0, nextVal) : oldVal;
                    scrollbar.setValue(scrollbar.value, false);
                    this.recordOverride(scrollbar, 'numberOfSteps');
                    this.notifyChange(scrollbar);
                },
                undo: () => {
                    scrollbar.numberOfSteps = oldVal;
                    scrollbar.setValue(scrollbar.value, false);
                    this.notifyChange(scrollbar);
                }
            });
        }, scrollbar, 'numberOfSteps');

        this.createUnityField(parent, 'Keyboard Step', 'number', scrollbar.keyboardStep ?? 0, (v) => {
            const oldVal = scrollbar.keyboardStep ?? 0;
            const nextVal = parseFloat(v);
            CommandHistory.execute({
                name: 'Change Scrollbar Keyboard Step',
                execute: () => {
                    scrollbar.keyboardStep = Number.isFinite(nextVal) ? Math.max(0, nextVal) : oldVal;
                    this.recordOverride(scrollbar, 'keyboardStep');
                    this.notifyChange(scrollbar);
                },
                undo: () => {
                    scrollbar.keyboardStep = oldVal;
                    this.notifyChange(scrollbar);
                }
            });
        }, scrollbar, 'keyboardStep');

        this.createUnityField(parent, 'Keyboard Page Step', 'number', scrollbar.keyboardPageStep ?? 0, (v) => {
            const oldVal = scrollbar.keyboardPageStep ?? 0;
            const nextVal = parseFloat(v);
            CommandHistory.execute({
                name: 'Change Scrollbar Keyboard Page Step',
                execute: () => {
                    scrollbar.keyboardPageStep = Number.isFinite(nextVal) ? Math.max(0, nextVal) : oldVal;
                    this.recordOverride(scrollbar, 'keyboardPageStep');
                    this.notifyChange(scrollbar);
                },
                undo: () => {
                    scrollbar.keyboardPageStep = oldVal;
                    this.notifyChange(scrollbar);
                }
            });
        }, scrollbar, 'keyboardPageStep');

        this.createUnityDropdown(parent, 'Direction', ['LeftToRight', 'RightToLeft', 'BottomToTop', 'TopToBottom'], scrollbar.direction || 'LeftToRight', (v) => {
            const oldVal = scrollbar.direction || 'LeftToRight';
            CommandHistory.execute({
                name: 'Change Scrollbar Direction',
                execute: () => {
                    scrollbar.direction = v;
                    this.recordOverride(scrollbar, 'direction');
                    this.notifyChange(scrollbar);
                },
                undo: () => {
                    scrollbar.direction = oldVal;
                    this.notifyChange(scrollbar);
                }
            });
        }, scrollbar, 'direction');

        this.createUnityCheckbox(parent, 'Interactable', scrollbar.interactable ?? true, (checked: boolean) => {
            const oldVal = scrollbar.interactable ?? true;
            CommandHistory.execute({
                name: 'Toggle Scrollbar Interactable',
                execute: () => {
                    scrollbar.interactable = checked;
                    this.recordOverride(scrollbar, 'interactable');
                    this.notifyChange(scrollbar);
                },
                undo: () => {
                    scrollbar.interactable = oldVal;
                    this.notifyChange(scrollbar);
                }
            });
        }, scrollbar, 'interactable');

        this.createUnityColorField(parent, 'Background', scrollbar.backgroundColor || '#3f3f3f', (v) => {
            const oldVal = scrollbar.backgroundColor || '#3f3f3f';
            CommandHistory.execute({
                name: 'Change Scrollbar Background',
                execute: () => {
                    scrollbar.backgroundColor = v;
                    this.recordOverride(scrollbar, 'backgroundColor');
                    this.notifyChange(scrollbar);
                },
                undo: () => {
                    scrollbar.backgroundColor = oldVal;
                    this.notifyChange(scrollbar);
                }
            });
        }, scrollbar, 'backgroundColor');

        this.createUnityColorField(parent, 'Handle', scrollbar.handleColor || '#d9d9d9', (v) => {
            const oldVal = scrollbar.handleColor || '#d9d9d9';
            CommandHistory.execute({
                name: 'Change Scrollbar Handle Color',
                execute: () => {
                    scrollbar.handleColor = v;
                    this.recordOverride(scrollbar, 'handleColor');
                    this.notifyChange(scrollbar);
                },
                undo: () => {
                    scrollbar.handleColor = oldVal;
                    this.notifyChange(scrollbar);
                }
            });
        }, scrollbar, 'handleColor');

        this.createUnityColorField(parent, 'Highlight Color', scrollbar.highlightedColor || '#f0f0f0', (v) => {
            const oldVal = scrollbar.highlightedColor || '#f0f0f0';
            CommandHistory.execute({
                name: 'Change Scrollbar Highlight Color',
                execute: () => {
                    scrollbar.highlightedColor = v;
                    this.recordOverride(scrollbar, 'highlightedColor');
                    this.notifyChange(scrollbar);
                },
                undo: () => {
                    scrollbar.highlightedColor = oldVal;
                    this.notifyChange(scrollbar);
                }
            });
        }, scrollbar, 'highlightedColor');

        this.createUnityColorField(parent, 'Pressed Color', scrollbar.pressedColor || '#2f6ea1', (v) => {
            const oldVal = scrollbar.pressedColor || '#2f6ea1';
            CommandHistory.execute({
                name: 'Change Scrollbar Pressed Color',
                execute: () => {
                    scrollbar.pressedColor = v;
                    this.recordOverride(scrollbar, 'pressedColor');
                    this.notifyChange(scrollbar);
                },
                undo: () => {
                    scrollbar.pressedColor = oldVal;
                    this.notifyChange(scrollbar);
                }
            });
        }, scrollbar, 'pressedColor');

        this.createUnityColorField(parent, 'Disabled Color', scrollbar.disabledColor || '#2b2b2b', (v) => {
            const oldVal = scrollbar.disabledColor || '#2b2b2b';
            CommandHistory.execute({
                name: 'Change Scrollbar Disabled Color',
                execute: () => {
                    scrollbar.disabledColor = v;
                    this.recordOverride(scrollbar, 'disabledColor');
                    this.notifyChange(scrollbar);
                },
                undo: () => {
                    scrollbar.disabledColor = oldVal;
                    this.notifyChange(scrollbar);
                }
            });
        }, scrollbar, 'disabledColor');
    }

    public createUIScrollRectInspector(parent: HTMLElement, scrollRect: any): void {
        this.createUnityObjectField(parent, 'Viewport', scrollRect.viewport || null, (value) => {
            const oldVal = scrollRect.viewport || null;
            CommandHistory.execute({
                name: 'Change ScrollRect Viewport',
                execute: () => {
                    scrollRect.viewport = value || null;
                    this.recordOverride(scrollRect, 'viewport');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.viewport = oldVal;
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'viewport');

        this.createUnityObjectField(parent, 'Content', scrollRect.content || null, (value) => {
            const oldVal = scrollRect.content || null;
            CommandHistory.execute({
                name: 'Change ScrollRect Content',
                execute: () => {
                    scrollRect.content = value || null;
                    this.recordOverride(scrollRect, 'content');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.content = oldVal;
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'content');

        this.createUnityCheckbox(parent, 'Horizontal', scrollRect.horizontal ?? true, (checked: boolean) => {
            const oldVal = scrollRect.horizontal ?? true;
            CommandHistory.execute({
                name: 'Toggle ScrollRect Horizontal',
                execute: () => {
                    scrollRect.horizontal = checked;
                    this.recordOverride(scrollRect, 'horizontal');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.horizontal = oldVal;
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'horizontal');

        this.createUnityCheckbox(parent, 'Vertical', scrollRect.vertical ?? true, (checked: boolean) => {
            const oldVal = scrollRect.vertical ?? true;
            CommandHistory.execute({
                name: 'Toggle ScrollRect Vertical',
                execute: () => {
                    scrollRect.vertical = checked;
                    this.recordOverride(scrollRect, 'vertical');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.vertical = oldVal;
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'vertical');

        this.createUnityDropdown(parent, 'Movement Type', ['Unrestricted', 'Elastic', 'Clamped'], scrollRect.movementType || 'Clamped', (v) => {
            const oldVal = scrollRect.movementType || 'Clamped';
            CommandHistory.execute({
                name: 'Change ScrollRect Movement Type',
                execute: () => {
                    scrollRect.movementType = v;
                    this.recordOverride(scrollRect, 'movementType');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.movementType = oldVal;
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'movementType');

        this.createUnityCheckbox(parent, 'Inertia', scrollRect.inertia ?? true, (checked: boolean) => {
            const oldVal = scrollRect.inertia ?? true;
            CommandHistory.execute({
                name: 'Toggle ScrollRect Inertia',
                execute: () => {
                    scrollRect.inertia = checked;
                    this.recordOverride(scrollRect, 'inertia');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.inertia = oldVal;
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'inertia');

        this.createUnitySlider(parent, 'Deceleration Rate', scrollRect.decelerationRate ?? 0.135, 0, 1, (value) => {
            const oldVal = scrollRect.decelerationRate ?? 0.135;
            CommandHistory.execute({
                name: 'Change ScrollRect Deceleration Rate',
                execute: () => {
                    scrollRect.decelerationRate = Math.max(0, Math.min(1, value));
                    this.recordOverride(scrollRect, 'decelerationRate');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.decelerationRate = oldVal;
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'decelerationRate');

        this.createUnitySlider(parent, 'Elasticity', scrollRect.elasticity ?? 0.1, 0.01, 1, (value) => {
            const oldVal = scrollRect.elasticity ?? 0.1;
            CommandHistory.execute({
                name: 'Change ScrollRect Elasticity',
                execute: () => {
                    scrollRect.elasticity = Math.max(0.01, Math.min(1, value));
                    this.recordOverride(scrollRect, 'elasticity');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.elasticity = oldVal;
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'elasticity');

        this.createUnitySlider(parent, 'Horizontal Pos', scrollRect.horizontalNormalizedPosition ?? 0, 0, 1, (value) => {
            const oldVal = scrollRect.horizontalNormalizedPosition ?? 0;
            CommandHistory.execute({
                name: 'Change ScrollRect Horizontal Position',
                execute: () => {
                    scrollRect.setHorizontalNormalizedPosition?.(value, true);
                    this.recordOverride(scrollRect, 'horizontalNormalizedPosition');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.setHorizontalNormalizedPosition?.(oldVal, true);
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'horizontalNormalizedPosition');

        this.createUnitySlider(parent, 'Vertical Pos', scrollRect.verticalNormalizedPosition ?? 1, 0, 1, (value) => {
            const oldVal = scrollRect.verticalNormalizedPosition ?? 1;
            CommandHistory.execute({
                name: 'Change ScrollRect Vertical Position',
                execute: () => {
                    scrollRect.setVerticalNormalizedPosition?.(value, true);
                    this.recordOverride(scrollRect, 'verticalNormalizedPosition');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.setVerticalNormalizedPosition?.(oldVal, true);
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'verticalNormalizedPosition');

        this.createUnityField(parent, 'Scroll Sensitivity', 'number', scrollRect.scrollSensitivity ?? 20, (v) => {
            const oldVal = scrollRect.scrollSensitivity ?? 20;
            const nextVal = parseFloat(v);
            CommandHistory.execute({
                name: 'Change ScrollRect Sensitivity',
                execute: () => {
                    scrollRect.scrollSensitivity = Number.isFinite(nextVal) ? nextVal : oldVal;
                    this.recordOverride(scrollRect, 'scrollSensitivity');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.scrollSensitivity = oldVal;
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'scrollSensitivity');

        this.createUnityField(parent, 'Keyboard Step', 'number', scrollRect.keyboardScrollStep ?? 0, (v) => {
            const oldVal = scrollRect.keyboardScrollStep ?? 0;
            const nextVal = parseFloat(v);
            CommandHistory.execute({
                name: 'Change ScrollRect Keyboard Step',
                execute: () => {
                    scrollRect.keyboardScrollStep = Number.isFinite(nextVal) ? Math.max(0, nextVal) : oldVal;
                    this.recordOverride(scrollRect, 'keyboardScrollStep');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.keyboardScrollStep = oldVal;
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'keyboardScrollStep');

        this.createUnityField(parent, 'Keyboard Page Step', 'number', scrollRect.keyboardPageStep ?? 0, (v) => {
            const oldVal = scrollRect.keyboardPageStep ?? 0;
            const nextVal = parseFloat(v);
            CommandHistory.execute({
                name: 'Change ScrollRect Keyboard Page Step',
                execute: () => {
                    scrollRect.keyboardPageStep = Number.isFinite(nextVal) ? Math.max(0, nextVal) : oldVal;
                    this.recordOverride(scrollRect, 'keyboardPageStep');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.keyboardPageStep = oldVal;
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'keyboardPageStep');

        this.createUnityObjectField(parent, 'Horizontal Scrollbar', scrollRect.horizontalScrollbar || null, (value) => {
            const oldVal = scrollRect.horizontalScrollbar || null;
            CommandHistory.execute({
                name: 'Change Horizontal Scrollbar',
                execute: () => {
                    scrollRect.horizontalScrollbar = value || null;
                    this.recordOverride(scrollRect, 'horizontalScrollbar');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.horizontalScrollbar = oldVal;
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'horizontalScrollbar');

        this.createUnityDropdown(parent, 'Horizontal Visibility', ['Permanent', 'AutoHide', 'AutoHideAndExpandViewport'], scrollRect.horizontalScrollbarVisibility || 'Permanent', (v) => {
            const oldVal = scrollRect.horizontalScrollbarVisibility || 'Permanent';
            CommandHistory.execute({
                name: 'Change Horizontal Scrollbar Visibility',
                execute: () => {
                    scrollRect.horizontalScrollbarVisibility = v;
                    this.recordOverride(scrollRect, 'horizontalScrollbarVisibility');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.horizontalScrollbarVisibility = oldVal;
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'horizontalScrollbarVisibility');

        this.createUnityObjectField(parent, 'Vertical Scrollbar', scrollRect.verticalScrollbar || null, (value) => {
            const oldVal = scrollRect.verticalScrollbar || null;
            CommandHistory.execute({
                name: 'Change Vertical Scrollbar',
                execute: () => {
                    scrollRect.verticalScrollbar = value || null;
                    this.recordOverride(scrollRect, 'verticalScrollbar');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.verticalScrollbar = oldVal;
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'verticalScrollbar');

        this.createUnityDropdown(parent, 'Vertical Visibility', ['Permanent', 'AutoHide', 'AutoHideAndExpandViewport'], scrollRect.verticalScrollbarVisibility || 'Permanent', (v) => {
            const oldVal = scrollRect.verticalScrollbarVisibility || 'Permanent';
            CommandHistory.execute({
                name: 'Change Vertical Scrollbar Visibility',
                execute: () => {
                    scrollRect.verticalScrollbarVisibility = v;
                    this.recordOverride(scrollRect, 'verticalScrollbarVisibility');
                    this.notifyChange(scrollRect);
                },
                undo: () => {
                    scrollRect.verticalScrollbarVisibility = oldVal;
                    this.notifyChange(scrollRect);
                }
            });
        }, scrollRect, 'verticalScrollbarVisibility');
    }



    // RectTransform Inspector
    public createRectTransformInspector(parent: HTMLElement, rt: any): void {
        type AnchorPreset = {
            label: string;
            title: string;
            anchorMin: { x: number; y: number };
            anchorMax: { x: number; y: number };
            pivot: { x: number; y: number };
            keepPosition?: boolean;
        };

        const readVec2 = (value: any, fallbackX: number, fallbackY: number) => ({
            x: Number.isFinite(value?.x) ? value.x : fallbackX,
            y: Number.isFinite(value?.y) ? value.y : fallbackY
        });
        let preservePositionOnPreset = false;
        let preservePivotOnPreset = false;

        const applyAnchorPreset = (preset: AnchorPreset) => {
            const oldAnchorMin = readVec2(rt.anchorMin, 0.5, 0.5);
            const oldAnchorMax = readVec2(rt.anchorMax, 0.5, 0.5);
            const oldPivot = readVec2(rt.pivot, 0.5, 0.5);
            const oldAnchoredPos = readVec2(rt.anchoredPosition, 0, 0);
            const shouldPreservePosition = preservePositionOnPreset || Boolean(preset.keepPosition);
            const shouldPreservePivot = preservePivotOnPreset;

            CommandHistory.execute({
                name: `RectTransform Preset ${preset.title}${shouldPreservePosition ? ' (KeepPos)' : ''}${shouldPreservePivot ? ' (KeepPivot)' : ''}`,
                execute: () => {
                    if (!rt.anchorMin) rt.anchorMin = { x: 0.5, y: 0.5 };
                    if (!rt.anchorMax) rt.anchorMax = { x: 0.5, y: 0.5 };
                    if (!rt.pivot) rt.pivot = { x: 0.5, y: 0.5 };
                    if (!rt.anchoredPosition) rt.anchoredPosition = { x: 0, y: 0 };

                    rt.anchorMin.x = preset.anchorMin.x;
                    rt.anchorMin.y = preset.anchorMin.y;
                    rt.anchorMax.x = preset.anchorMax.x;
                    rt.anchorMax.y = preset.anchorMax.y;
                    if (!shouldPreservePivot) {
                        rt.pivot.x = preset.pivot.x;
                        rt.pivot.y = preset.pivot.y;
                    }
                    if (!shouldPreservePosition) {
                        rt.anchoredPosition.x = 0;
                        rt.anchoredPosition.y = 0;
                    }

                    this.recordOverride(rt, 'anchorMin');
                    this.recordOverride(rt, 'anchorMax');
                    this.recordOverride(rt, 'pivot');
                    this.recordOverride(rt, 'anchoredPosition');
                    this.refreshSelected?.();
                    this.notifyChange(rt);
                },
                undo: () => {
                    if (!rt.anchorMin) rt.anchorMin = { x: 0.5, y: 0.5 };
                    if (!rt.anchorMax) rt.anchorMax = { x: 0.5, y: 0.5 };
                    if (!rt.pivot) rt.pivot = { x: 0.5, y: 0.5 };
                    if (!rt.anchoredPosition) rt.anchoredPosition = { x: 0, y: 0 };

                    rt.anchorMin.x = oldAnchorMin.x;
                    rt.anchorMin.y = oldAnchorMin.y;
                    rt.anchorMax.x = oldAnchorMax.x;
                    rt.anchorMax.y = oldAnchorMax.y;
                    rt.pivot.x = oldPivot.x;
                    rt.pivot.y = oldPivot.y;
                    rt.anchoredPosition.x = oldAnchoredPos.x;
                    rt.anchoredPosition.y = oldAnchoredPos.y;

                    this.refreshSelected?.();
                    this.notifyChange(rt);
                }
            });
        };

        const presetLabel = document.createElement('div');
        presetLabel.innerText = 'Anchor Presets';
        presetLabel.style.cssText = 'font-size: 11px; color: var(--unity-text-dim); margin: 0 0 4px 4px;';
        parent.appendChild(presetLabel);

        const presetOptionsRow = document.createElement('div');
        presetOptionsRow.style.cssText = 'display:flex; gap:10px; margin: 0 0 6px 2px; align-items:center;';
        const makePresetOption = (label: string, onChange: (checked: boolean) => void) => {
            const wrap = document.createElement('label');
            wrap.style.cssText = 'font-size:10px; color: var(--unity-text-dim); display:flex; align-items:center; gap:4px; user-select:none; cursor:pointer;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.style.margin = '0';
            cb.onchange = () => onChange(cb.checked);
            wrap.appendChild(cb);
            const text = document.createElement('span');
            text.innerText = label;
            wrap.appendChild(text);
            return wrap;
        };
        presetOptionsRow.appendChild(makePresetOption('Preserve Position', (checked) => { preservePositionOnPreset = checked; }));
        presetOptionsRow.appendChild(makePresetOption('Preserve Pivot', (checked) => { preservePivotOnPreset = checked; }));
        parent.appendChild(presetOptionsRow);

        const presetGrid = document.createElement('div');
        presetGrid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 4px;
            margin: 0 0 8px 0;
        `;
        parent.appendChild(presetGrid);

        const presets: AnchorPreset[] = [
            { label: 'TL', title: 'Top Left', anchorMin: { x: 0, y: 1 }, anchorMax: { x: 0, y: 1 }, pivot: { x: 0, y: 1 } },
            { label: 'TC', title: 'Top Center', anchorMin: { x: 0.5, y: 1 }, anchorMax: { x: 0.5, y: 1 }, pivot: { x: 0.5, y: 1 } },
            { label: 'TR', title: 'Top Right', anchorMin: { x: 1, y: 1 }, anchorMax: { x: 1, y: 1 }, pivot: { x: 1, y: 1 } },
            { label: 'TH', title: 'Top Stretch', anchorMin: { x: 0, y: 1 }, anchorMax: { x: 1, y: 1 }, pivot: { x: 0.5, y: 1 } },

            { label: 'ML', title: 'Middle Left', anchorMin: { x: 0, y: 0.5 }, anchorMax: { x: 0, y: 0.5 }, pivot: { x: 0, y: 0.5 } },
            { label: 'MC', title: 'Middle Center', anchorMin: { x: 0.5, y: 0.5 }, anchorMax: { x: 0.5, y: 0.5 }, pivot: { x: 0.5, y: 0.5 } },
            { label: 'MR', title: 'Middle Right', anchorMin: { x: 1, y: 0.5 }, anchorMax: { x: 1, y: 0.5 }, pivot: { x: 1, y: 0.5 } },
            { label: 'MH', title: 'Middle Stretch', anchorMin: { x: 0, y: 0.5 }, anchorMax: { x: 1, y: 0.5 }, pivot: { x: 0.5, y: 0.5 } },

            { label: 'BL', title: 'Bottom Left', anchorMin: { x: 0, y: 0 }, anchorMax: { x: 0, y: 0 }, pivot: { x: 0, y: 0 } },
            { label: 'BC', title: 'Bottom Center', anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0 } },
            { label: 'BR', title: 'Bottom Right', anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
            { label: 'BH', title: 'Bottom Stretch', anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 0.5, y: 0 } },

            { label: 'VL', title: 'Left Stretch', anchorMin: { x: 0, y: 0 }, anchorMax: { x: 0, y: 1 }, pivot: { x: 0, y: 0.5 } },
            { label: 'VC', title: 'Vertical Stretch Center', anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 1 }, pivot: { x: 0.5, y: 0.5 } },
            { label: 'VR', title: 'Right Stretch', anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 1 }, pivot: { x: 1, y: 0.5 } },
            { label: 'ST', title: 'Stretch', anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: 1 }, pivot: { x: 0.5, y: 0.5 } }
        ];

        presets.forEach((preset) => {
            const btn = document.createElement('button');
            btn.className = 'unity-button';
            btn.innerText = preset.label;
            btn.title = preset.title;
            btn.style.cssText = 'padding: 3px 0; font-size: 10px;';
            btn.onclick = () => applyAnchorPreset(preset);
            presetGrid.appendChild(btn);
        });

        const quickActions = document.createElement('div');
        quickActions.style.cssText = 'display: flex; gap: 6px; margin: 0 0 8px 0;';
        parent.appendChild(quickActions);

        const pivotCenterBtn = document.createElement('button');
        pivotCenterBtn.className = 'unity-button';
        pivotCenterBtn.innerText = 'Pivot->Center';
        pivotCenterBtn.style.cssText = 'flex:1; padding: 3px 0; font-size: 10px;';
        pivotCenterBtn.onclick = () => {
            const oldPivot = readVec2(rt.pivot, 0.5, 0.5);
            const anchorMin = readVec2(rt.anchorMin, 0.5, 0.5);
            const anchorMax = readVec2(rt.anchorMax, 0.5, 0.5);
            const nextPivot = {
                x: (anchorMin.x + anchorMax.x) * 0.5,
                y: (anchorMin.y + anchorMax.y) * 0.5
            };
            CommandHistory.execute({
                name: 'RectTransform Pivot To Anchor Center',
                execute: () => {
                    if (!rt.pivot) rt.pivot = { x: 0.5, y: 0.5 };
                    rt.pivot.x = nextPivot.x;
                    rt.pivot.y = nextPivot.y;
                    this.recordOverride(rt, 'pivot');
                    this.refreshSelected?.();
                    this.notifyChange(rt);
                },
                undo: () => {
                    if (!rt.pivot) rt.pivot = { x: 0.5, y: 0.5 };
                    rt.pivot.x = oldPivot.x;
                    rt.pivot.y = oldPivot.y;
                    this.refreshSelected?.();
                    this.notifyChange(rt);
                }
            });
        };
        quickActions.appendChild(pivotCenterBtn);

        const resetPosBtn = document.createElement('button');
        resetPosBtn.className = 'unity-button';
        resetPosBtn.innerText = 'Reset Pos';
        resetPosBtn.style.cssText = 'flex:1; padding: 3px 0; font-size: 10px;';
        resetPosBtn.onclick = () => {
            const oldPos = readVec2(rt.anchoredPosition, 0, 0);
            CommandHistory.execute({
                name: 'RectTransform Reset Anchored Position',
                execute: () => {
                    if (!rt.anchoredPosition) rt.anchoredPosition = { x: 0, y: 0 };
                    rt.anchoredPosition.x = 0;
                    rt.anchoredPosition.y = 0;
                    this.recordOverride(rt, 'anchoredPosition');
                    this.refreshSelected?.();
                    this.notifyChange(rt);
                },
                undo: () => {
                    if (!rt.anchoredPosition) rt.anchoredPosition = { x: 0, y: 0 };
                    rt.anchoredPosition.x = oldPos.x;
                    rt.anchoredPosition.y = oldPos.y;
                    this.refreshSelected?.();
                    this.notifyChange(rt);
                }
            });
        };
        quickActions.appendChild(resetPosBtn);

        this.createVector2Field(parent, 'Anchored Pos', rt.anchoredPosition || { x: 0, y: 0 }, (axis, v) => {
            const oldVal = rt.anchoredPosition ? rt.anchoredPosition[axis] : 0;
            CommandHistory.execute({
                name: `Change Anchored Pos ${axis}`,
                execute: () => {
                    if (!rt.anchoredPosition) rt.anchoredPosition = { x: 0, y: 0 };
                    rt.anchoredPosition[axis] = v;
                    this.recordOverride(rt, 'anchoredPosition');
                    this.notifyChange(rt);
                },
                undo: () => {
                    if (rt.anchoredPosition) rt.anchoredPosition[axis] = oldVal;
                    this.notifyChange(rt);
                }
            });
        }, rt);

        this.createVector2Field(parent, 'Size Delta', rt.sizeDelta || { x: 100, y: 100 }, (axis, v) => {
            const oldVal = rt.sizeDelta ? rt.sizeDelta[axis] : 100;
            CommandHistory.execute({
                name: `Change Size Delta ${axis}`,
                execute: () => {
                    if (!rt.sizeDelta) rt.sizeDelta = { x: 100, y: 100 };
                    rt.sizeDelta[axis] = v;
                    this.recordOverride(rt, 'sizeDelta');
                    this.notifyChange(rt);
                },
                undo: () => {
                    if (rt.sizeDelta) rt.sizeDelta[axis] = oldVal;
                    this.notifyChange(rt);
                }
            });
        }, rt);

        this.createVector2Field(parent, 'Anchor Min', rt.anchorMin || { x: 0.5, y: 0.5 }, (axis, v) => {
            const oldVal = rt.anchorMin ? rt.anchorMin[axis] : 0.5;
            const newVal = Math.max(0, Math.min(1, v));
            CommandHistory.execute({
                name: `Change Anchor Min ${axis}`,
                execute: () => {
                    if (!rt.anchorMin) rt.anchorMin = { x: 0.5, y: 0.5 };
                    rt.anchorMin[axis] = newVal;
                    this.recordOverride(rt, 'anchorMin');
                    this.notifyChange(rt);
                },
                undo: () => {
                    if (rt.anchorMin) rt.anchorMin[axis] = oldVal;
                    this.notifyChange(rt);
                }
            });
        }, rt);

        this.createVector2Field(parent, 'Anchor Max', rt.anchorMax || { x: 0.5, y: 0.5 }, (axis, v) => {
            const oldVal = rt.anchorMax ? rt.anchorMax[axis] : 0.5;
            const newVal = Math.max(0, Math.min(1, v));
            CommandHistory.execute({
                name: `Change Anchor Max ${axis}`,
                execute: () => {
                    if (!rt.anchorMax) rt.anchorMax = { x: 0.5, y: 0.5 };
                    rt.anchorMax[axis] = newVal;
                    this.recordOverride(rt, 'anchorMax');
                    this.notifyChange(rt);
                },
                undo: () => {
                    if (rt.anchorMax) rt.anchorMax[axis] = oldVal;
                    this.notifyChange(rt);
                }
            });
        }, rt);

        this.createVector2Field(parent, 'Pivot', rt.pivot || { x: 0.5, y: 0.5 }, (axis, v) => {
            const oldVal = rt.pivot ? rt.pivot[axis] : 0.5;
            const newVal = Math.max(0, Math.min(1, v));
            CommandHistory.execute({
                name: `Change Pivot ${axis}`,
                execute: () => {
                    if (!rt.pivot) rt.pivot = { x: 0.5, y: 0.5 };
                    rt.pivot[axis] = newVal;
                    this.recordOverride(rt, 'pivot');
                    this.notifyChange(rt);
                },
                undo: () => {
                    if (rt.pivot) rt.pivot[axis] = oldVal;
                    this.notifyChange(rt);
                }
            });
        }, rt);
    }

    // Canvas Inspector
    public createCanvasInspector(parent: HTMLElement, canvas: any): void {
        this.createUnityDropdown(parent, 'Render Mode', ['ScreenSpaceOverlay', 'ScreenSpaceCamera', 'WorldSpace'], canvas.renderMode, (v) => {
            const oldVal = canvas.renderMode;
            CommandHistory.execute({
                name: 'Change Render Mode',
                execute: () => {
                    canvas.setRenderMode(v);
                    this.recordOverride(canvas, 'renderMode');
                    this.refreshSelected?.();
                },
                undo: () => {
                    canvas.setRenderMode(oldVal);
                    this.refreshSelected?.();
                }
            });
        }, canvas);

        this.createUnityDropdown(parent, 'Scale Mode', ['ScaleWithScreenSize', 'ConstantPixelSize'], canvas.scaleMode || 'ScaleWithScreenSize', (v) => {
            const oldVal = canvas.scaleMode || 'ScaleWithScreenSize';
            CommandHistory.execute({
                name: 'Change Canvas Scale Mode',
                execute: () => {
                    canvas.setScaleMode(v);
                    this.recordOverride(canvas, 'scaleMode');
                    this.refreshSelected?.();
                },
                undo: () => {
                    canvas.setScaleMode(oldVal);
                    this.refreshSelected?.();
                }
            });
        }, canvas, 'scaleMode');

        this.createUnityField(parent, 'Sorting Order', 'number', canvas.sortingOrder, (v) => {
            const oldVal = canvas.sortingOrder;
            const newVal = parseInt(v);
            CommandHistory.execute({
                name: 'Change Sorting Order',
                execute: () => {
                    canvas.setSortingOrder(newVal);
                    this.recordOverride(canvas, 'sortingOrder');
                    this.refreshSelected?.();
                },
                undo: () => {
                    canvas.setSortingOrder(oldVal);
                    this.refreshSelected?.();
                }
            });
        }, canvas);

        this.createUnityCheckbox(parent, 'Pixel Perfect', canvas.pixelPerfect || false, (checked: boolean) => {
            const oldVal = canvas.pixelPerfect;
            CommandHistory.execute({
                name: 'Toggle Pixel Perfect',
                execute: () => {
                    canvas.setPixelPerfect(checked);
                    this.recordOverride(canvas, 'pixelPerfect');
                    this.refreshSelected?.();
                },
                undo: () => {
                    canvas.setPixelPerfect(oldVal);
                    this.refreshSelected?.();
                }
            });
        }, canvas, 'pixelPerfect');

        this.createUnityObjectField(parent, 'Target Camera', canvas.targetCamera || null, (value) => {
            const oldVal = canvas.targetCamera || null;
            CommandHistory.execute({
                name: 'Change Canvas Target Camera',
                execute: () => {
                    canvas.setTargetCamera(value || null);
                    this.recordOverride(canvas, 'targetCamera');
                    this.notifyChange(canvas);
                },
                undo: () => {
                    canvas.setTargetCamera(oldVal);
                    this.notifyChange(canvas);
                }
            });
        }, canvas, 'targetCamera');

        this.createVector2Field(parent, 'Reference Res', canvas.referenceResolution || { x: 1920, y: 1080 }, (axis, v) => {
            const oldX = canvas.referenceResolution?.x ?? 1920;
            const oldY = canvas.referenceResolution?.y ?? 1080;
            const nextX = axis === 'x' ? Math.max(1, v) : oldX;
            const nextY = axis === 'y' ? Math.max(1, v) : oldY;
            CommandHistory.execute({
                name: `Change Canvas Reference ${axis.toUpperCase()}`,
                execute: () => {
                    canvas.setReferenceResolution(nextX, nextY);
                    this.recordOverride(canvas, 'referenceResolution');
                    this.notifyChange(canvas);
                },
                undo: () => {
                    canvas.setReferenceResolution(oldX, oldY);
                    this.notifyChange(canvas);
                }
            });
        }, canvas);

        this.createUnitySlider(parent, 'Match Width/Height', canvas.matchWidthOrHeight ?? 0.5, 0, 1, (v) => {
            const oldVal = canvas.matchWidthOrHeight ?? 0.5;
            CommandHistory.execute({
                name: 'Change Canvas Match Width/Height',
                execute: () => {
                    canvas.setMatchWidthOrHeight(v);
                    this.recordOverride(canvas, 'matchWidthOrHeight');
                    this.notifyChange(canvas);
                },
                undo: () => {
                    canvas.setMatchWidthOrHeight(oldVal);
                    this.notifyChange(canvas);
                }
            });
        }, canvas, 'matchWidthOrHeight');

        if (canvas.renderMode === 'WorldSpace') {
            this.createUnityField(parent, 'Plane Distance', 'number', canvas.planeDistance ?? 100, (v) => {
                const oldVal = canvas.planeDistance ?? 100;
                const newVal = parseFloat(v);
                CommandHistory.execute({
                    name: 'Change Canvas Plane Distance',
                    execute: () => {
                        canvas.setPlaneDistance(newVal);
                        this.recordOverride(canvas, 'planeDistance');
                        this.notifyChange(canvas);
                    },
                    undo: () => {
                        canvas.setPlaneDistance(oldVal);
                        this.notifyChange(canvas);
                    }
                });
            }, canvas, 'planeDistance');

            this.createUnityField(parent, 'Pixels Per Unit', 'number', canvas.worldSpacePixelsPerUnit ?? 100, (v) => {
                const oldVal = canvas.worldSpacePixelsPerUnit ?? 100;
                const newVal = parseFloat(v);
                CommandHistory.execute({
                    name: 'Change Canvas Pixels Per Unit',
                    execute: () => {
                        canvas.setWorldSpacePixelsPerUnit(newVal);
                        this.recordOverride(canvas, 'worldSpacePixelsPerUnit');
                        this.notifyChange(canvas);
                    },
                    undo: () => {
                        canvas.setWorldSpacePixelsPerUnit(oldVal);
                        this.notifyChange(canvas);
                    }
                });
            }, canvas, 'worldSpacePixelsPerUnit');
        }
    }

    public createCanvasGroupInspector(parent: HTMLElement, canvasGroup: any): void {
        this.createUnitySlider(parent, 'Alpha', canvasGroup.alpha ?? 1, 0, 1, (v) => {
            const oldVal = canvasGroup.alpha ?? 1;
            CommandHistory.execute({
                name: 'Change CanvasGroup Alpha',
                execute: () => {
                    canvasGroup.alpha = v;
                    this.recordOverride(canvasGroup, 'alpha');
                    this.notifyChange(canvasGroup);
                },
                undo: () => {
                    canvasGroup.alpha = oldVal;
                    this.notifyChange(canvasGroup);
                }
            });
        }, canvasGroup, 'alpha');

        this.createUnityCheckbox(parent, 'Interactable', canvasGroup.interactable ?? true, (checked: boolean) => {
            const oldVal = canvasGroup.interactable ?? true;
            CommandHistory.execute({
                name: 'Toggle CanvasGroup Interactable',
                execute: () => {
                    canvasGroup.interactable = checked;
                    this.recordOverride(canvasGroup, 'interactable');
                    this.notifyChange(canvasGroup);
                },
                undo: () => {
                    canvasGroup.interactable = oldVal;
                    this.notifyChange(canvasGroup);
                }
            });
        }, canvasGroup, 'interactable');

        this.createUnityCheckbox(parent, 'Blocks Raycasts', canvasGroup.blocksRaycasts ?? true, (checked: boolean) => {
            const oldVal = canvasGroup.blocksRaycasts ?? true;
            CommandHistory.execute({
                name: 'Toggle CanvasGroup Blocks Raycasts',
                execute: () => {
                    canvasGroup.blocksRaycasts = checked;
                    this.recordOverride(canvasGroup, 'blocksRaycasts');
                    this.notifyChange(canvasGroup);
                },
                undo: () => {
                    canvasGroup.blocksRaycasts = oldVal;
                    this.notifyChange(canvasGroup);
                }
            });
        }, canvasGroup, 'blocksRaycasts');

        this.createUnityCheckbox(parent, 'Ignore Parents', canvasGroup.ignoreParentGroups ?? false, (checked: boolean) => {
            const oldVal = canvasGroup.ignoreParentGroups ?? false;
            CommandHistory.execute({
                name: 'Toggle CanvasGroup Ignore Parents',
                execute: () => {
                    canvasGroup.ignoreParentGroups = checked;
                    this.recordOverride(canvasGroup, 'ignoreParentGroups');
                    this.notifyChange(canvasGroup);
                },
                undo: () => {
                    canvasGroup.ignoreParentGroups = oldVal;
                    this.notifyChange(canvasGroup);
                }
            });
        }, canvasGroup, 'ignoreParentGroups');
    }

    public createGraphicRaycasterInspector(parent: HTMLElement, raycaster: any): void {
        this.createUnityCheckbox(parent, 'Ignore Reversed', raycaster.ignoreReversedGraphics ?? true, (checked: boolean) => {
            const oldVal = raycaster.ignoreReversedGraphics ?? true;
            CommandHistory.execute({
                name: 'Toggle Ignore Reversed Graphics',
                execute: () => {
                    raycaster.ignoreReversedGraphics = checked;
                    this.recordOverride(raycaster, 'ignoreReversedGraphics');
                    this.notifyChange(raycaster);
                },
                undo: () => {
                    raycaster.ignoreReversedGraphics = oldVal;
                    this.notifyChange(raycaster);
                }
            });
        }, raycaster, 'ignoreReversedGraphics');

        this.createUnityDropdown(parent, 'Blocking Objects', ['None', 'TwoD', 'ThreeD', 'All'], raycaster.blockingObjects || 'None', (v) => {
            const oldVal = raycaster.blockingObjects || 'None';
            CommandHistory.execute({
                name: 'Change Raycaster Blocking Objects',
                execute: () => {
                    raycaster.blockingObjects = v;
                    this.recordOverride(raycaster, 'blockingObjects');
                    this.notifyChange(raycaster);
                },
                undo: () => {
                    raycaster.blockingObjects = oldVal;
                    this.notifyChange(raycaster);
                }
            });
        }, raycaster, 'blockingObjects');

        this.createUnityField(parent, 'Blocking Mask', 'number', raycaster.blockingMask ?? -1, (v) => {
            const oldVal = raycaster.blockingMask ?? -1;
            const newVal = parseInt(v, 10);
            CommandHistory.execute({
                name: 'Change Raycaster Blocking Mask',
                execute: () => {
                    raycaster.blockingMask = Number.isFinite(newVal) ? newVal : oldVal;
                    this.recordOverride(raycaster, 'blockingMask');
                    this.notifyChange(raycaster);
                },
                undo: () => {
                    raycaster.blockingMask = oldVal;
                    this.notifyChange(raycaster);
                }
            });
        }, raycaster, 'blockingMask');
    }

    public createEventSystemInspector(parent: HTMLElement, eventSystem: any): void {
        this.createUnityObjectField(parent, 'First Selected', eventSystem.firstSelectedGameObject || null, (value) => {
            const oldVal = eventSystem.firstSelectedGameObject || null;
            CommandHistory.execute({
                name: 'Change First Selected',
                execute: () => {
                    eventSystem.firstSelectedGameObject = value || null;
                    this.recordOverride(eventSystem, 'firstSelectedGameObject');
                    this.notifyChange(eventSystem);
                },
                undo: () => {
                    eventSystem.firstSelectedGameObject = oldVal;
                    this.notifyChange(eventSystem);
                }
            });
        }, eventSystem, 'firstSelectedGameObject');

        this.createUnityCheckbox(parent, 'Send Navigation', eventSystem.sendNavigationEvents ?? true, (checked: boolean) => {
            const oldVal = eventSystem.sendNavigationEvents ?? true;
            CommandHistory.execute({
                name: 'Toggle Send Navigation Events',
                execute: () => {
                    eventSystem.sendNavigationEvents = checked;
                    this.recordOverride(eventSystem, 'sendNavigationEvents');
                    this.notifyChange(eventSystem);
                },
                undo: () => {
                    eventSystem.sendNavigationEvents = oldVal;
                    this.notifyChange(eventSystem);
                }
            });
        }, eventSystem, 'sendNavigationEvents');

        this.createUnityField(parent, 'Drag Threshold', 'number', eventSystem.pixelDragThreshold ?? 10, (v) => {
            const oldVal = eventSystem.pixelDragThreshold ?? 10;
            const newVal = parseInt(v, 10);
            CommandHistory.execute({
                name: 'Change Drag Threshold',
                execute: () => {
                    eventSystem.pixelDragThreshold = Number.isFinite(newVal) ? Math.max(0, newVal) : oldVal;
                    this.recordOverride(eventSystem, 'pixelDragThreshold');
                    this.notifyChange(eventSystem);
                },
                undo: () => {
                    eventSystem.pixelDragThreshold = oldVal;
                    this.notifyChange(eventSystem);
                }
            });
        }, eventSystem, 'pixelDragThreshold');
    }

    // UIImage Inspector
    public createUIImageInspector(parent: HTMLElement, image: any): void {
        this.createUnityColorField(parent, 'Color', image.color || '#ffffff', (v) => {
            const oldVal = image.color;
            CommandHistory.execute({
                name: 'Change UI Image Color',
                execute: () => {
                    image.color = v;
                    this.recordOverride(image, 'color');
                    this.notifyChange(image);
                },
                undo: () => {
                    image.color = oldVal;
                    this.notifyChange(image);
                }
            });
        }, image);

        this.createUnityCheckbox(parent, 'Raycast Target', image.raycastTarget ?? true, (checked: boolean) => {
            const oldVal = image.raycastTarget ?? true;
            CommandHistory.execute({
                name: 'Toggle UI Image Raycast Target',
                execute: () => {
                    image.raycastTarget = checked;
                    this.recordOverride(image, 'raycastTarget');
                    this.notifyChange(image);
                },
                undo: () => {
                    image.raycastTarget = oldVal;
                    this.notifyChange(image);
                }
            });
        }, image, 'raycastTarget');

        this.createUnityField(parent, 'Sprite Path', 'text', image.spritePath || '', (v) => {
            const oldVal = image.spritePath;
            CommandHistory.execute({
                name: 'Change UI Image Sprite',
                execute: () => {
                    image.spritePath = v;
                    this.recordOverride(image, 'spritePath');
                    this.notifyChange(image);
                },
                undo: () => {
                    image.spritePath = oldVal;
                    this.notifyChange(image);
                }
            });
        }, image);
    }

    // UIText Inspector
    public createUITextInspector(parent: HTMLElement, textComp: any): void {
        this.createUnityField(parent, 'Text', 'text', textComp.text || '', (v) => {
            const oldVal = textComp.text;
            CommandHistory.execute({
                name: 'Change UI Text Content',
                execute: () => {
                    textComp.text = v;
                    this.recordOverride(textComp, 'text');
                    this.notifyChange(textComp);
                },
                undo: () => {
                    textComp.text = oldVal;
                    this.notifyChange(textComp);
                }
            });
        }, textComp);

        this.createUnityField(parent, 'Font Size', 'number', textComp.fontSize || 14, (v) => {
            const oldVal = textComp.fontSize;
            const newVal = parseInt(v);
            CommandHistory.execute({
                name: 'Change UI Text Font Size',
                execute: () => {
                    textComp.fontSize = newVal;
                    this.recordOverride(textComp, 'fontSize');
                    this.notifyChange(textComp);
                },
                undo: () => {
                    textComp.fontSize = oldVal;
                    this.notifyChange(textComp);
                }
            });
        }, textComp);

        this.createUnityColorField(parent, 'Color', textComp.color || '#ffffff', (v) => {
            const oldVal = textComp.color;
            CommandHistory.execute({
                name: 'Change UI Text Color',
                execute: () => {
                    textComp.color = v;
                    this.recordOverride(textComp, 'color');
                    this.notifyChange(textComp);
                },
                undo: () => {
                    textComp.color = oldVal;
                    this.notifyChange(textComp);
                }
            });
        }, textComp);

        this.createUnityDropdown(parent, 'Alignment', ['left', 'center', 'right'], textComp.alignment || 'left', (v) => {
            const oldVal = textComp.alignment;
            CommandHistory.execute({
                name: 'Change UI Text Alignment',
                execute: () => {
                    textComp.alignment = v;
                    this.recordOverride(textComp, 'alignment');
                    this.notifyChange(textComp);
                },
                undo: () => {
                    textComp.alignment = oldVal;
                    this.notifyChange(textComp);
                }
            });
        }, textComp);

        this.createUnityCheckbox(parent, 'Raycast Target', textComp.raycastTarget ?? false, (checked: boolean) => {
            const oldVal = textComp.raycastTarget ?? false;
            CommandHistory.execute({
                name: 'Toggle UI Text Raycast Target',
                execute: () => {
                    textComp.raycastTarget = checked;
                    this.recordOverride(textComp, 'raycastTarget');
                    this.notifyChange(textComp);
                },
                undo: () => {
                    textComp.raycastTarget = oldVal;
                    this.notifyChange(textComp);
                }
            });
        }, textComp, 'raycastTarget');
    }

    public createVerticalLayoutGroupInspector(parent: HTMLElement, group: any): void {
        this.createLayoutPaddingInspector(parent, group, 'Vertical');
    }

    public createHorizontalLayoutGroupInspector(parent: HTMLElement, group: any): void {
        this.createLayoutPaddingInspector(parent, group, 'Horizontal');
    }

    public createContentSizeFitterInspector(parent: HTMLElement, fitter: any): void {
        this.createUnityDropdown(parent, 'Horizontal Fit', ['Unconstrained', 'PreferredSize'], fitter.horizontalFit || 'Unconstrained', (v) => {
            const oldVal = fitter.horizontalFit || 'Unconstrained';
            CommandHistory.execute({
                name: 'Change Horizontal Fit',
                execute: () => {
                    fitter.horizontalFit = v;
                    this.recordOverride(fitter, 'horizontalFit');
                    this.notifyChange(fitter);
                },
                undo: () => {
                    fitter.horizontalFit = oldVal;
                    this.notifyChange(fitter);
                }
            });
        }, fitter, 'horizontalFit');

        this.createUnityDropdown(parent, 'Vertical Fit', ['Unconstrained', 'PreferredSize'], fitter.verticalFit || 'PreferredSize', (v) => {
            const oldVal = fitter.verticalFit || 'PreferredSize';
            CommandHistory.execute({
                name: 'Change Vertical Fit',
                execute: () => {
                    fitter.verticalFit = v;
                    this.recordOverride(fitter, 'verticalFit');
                    this.notifyChange(fitter);
                },
                undo: () => {
                    fitter.verticalFit = oldVal;
                    this.notifyChange(fitter);
                }
            });
        }, fitter, 'verticalFit');

        this.createLayoutPaddingFields(parent, fitter);
    }

    private createLayoutPaddingInspector(parent: HTMLElement, group: any, axisLabel: 'Vertical' | 'Horizontal'): void {
        this.createUnityDropdown(parent, 'Child Align', [
            'UpperLeft', 'UpperCenter', 'UpperRight',
            'MiddleLeft', 'MiddleCenter', 'MiddleRight',
            'LowerLeft', 'LowerCenter', 'LowerRight'
        ], group.childAlignment || 'UpperLeft', (v) => {
            const oldVal = group.childAlignment || 'UpperLeft';
            CommandHistory.execute({
                name: `Change ${axisLabel} Alignment`,
                execute: () => {
                    group.childAlignment = v;
                    this.recordOverride(group, 'childAlignment');
                    this.notifyChange(group);
                },
                undo: () => {
                    group.childAlignment = oldVal;
                    this.notifyChange(group);
                }
            });
        }, group, 'childAlignment');

        this.createUnityField(parent, 'Spacing', 'number', group.spacing ?? 0, (v) => {
            const oldVal = group.spacing ?? 0;
            const newVal = parseFloat(v);
            CommandHistory.execute({
                name: `Change ${axisLabel} Spacing`,
                execute: () => {
                    group.spacing = Number.isFinite(newVal) ? newVal : oldVal;
                    this.recordOverride(group, 'spacing');
                    this.notifyChange(group);
                },
                undo: () => {
                    group.spacing = oldVal;
                    this.notifyChange(group);
                }
            });
        }, group, 'spacing');

        this.createUnityCheckbox(parent, 'Control Width', group.childControlWidth ?? true, (checked: boolean) => {
            const oldVal = group.childControlWidth ?? true;
            CommandHistory.execute({
                name: `Toggle ${axisLabel} Control Width`,
                execute: () => {
                    group.childControlWidth = checked;
                    this.recordOverride(group, 'childControlWidth');
                    this.notifyChange(group);
                },
                undo: () => {
                    group.childControlWidth = oldVal;
                    this.notifyChange(group);
                }
            });
        }, group, 'childControlWidth');

        this.createUnityCheckbox(parent, 'Control Height', group.childControlHeight ?? true, (checked: boolean) => {
            const oldVal = group.childControlHeight ?? true;
            CommandHistory.execute({
                name: `Toggle ${axisLabel} Control Height`,
                execute: () => {
                    group.childControlHeight = checked;
                    this.recordOverride(group, 'childControlHeight');
                    this.notifyChange(group);
                },
                undo: () => {
                    group.childControlHeight = oldVal;
                    this.notifyChange(group);
                }
            });
        }, group, 'childControlHeight');

        this.createUnityCheckbox(parent, 'Expand Width', group.childForceExpandWidth ?? false, (checked: boolean) => {
            const oldVal = group.childForceExpandWidth ?? false;
            CommandHistory.execute({
                name: `Toggle ${axisLabel} Expand Width`,
                execute: () => {
                    group.childForceExpandWidth = checked;
                    this.recordOverride(group, 'childForceExpandWidth');
                    this.notifyChange(group);
                },
                undo: () => {
                    group.childForceExpandWidth = oldVal;
                    this.notifyChange(group);
                }
            });
        }, group, 'childForceExpandWidth');

        this.createUnityCheckbox(parent, 'Expand Height', group.childForceExpandHeight ?? false, (checked: boolean) => {
            const oldVal = group.childForceExpandHeight ?? false;
            CommandHistory.execute({
                name: `Toggle ${axisLabel} Expand Height`,
                execute: () => {
                    group.childForceExpandHeight = checked;
                    this.recordOverride(group, 'childForceExpandHeight');
                    this.notifyChange(group);
                },
                undo: () => {
                    group.childForceExpandHeight = oldVal;
                    this.notifyChange(group);
                }
            });
        }, group, 'childForceExpandHeight');

        this.createLayoutPaddingFields(parent, group);
    }

    private createLayoutPaddingFields(parent: HTMLElement, target: any): void {
        this.createUnityField(parent, 'Padding Left', 'number', target.paddingLeft ?? 0, (v) => {
            this.executeNumericFieldChange(target, 'paddingLeft', v, 'Change Padding Left');
        }, target, 'paddingLeft');
        this.createUnityField(parent, 'Padding Right', 'number', target.paddingRight ?? 0, (v) => {
            this.executeNumericFieldChange(target, 'paddingRight', v, 'Change Padding Right');
        }, target, 'paddingRight');
        this.createUnityField(parent, 'Padding Top', 'number', target.paddingTop ?? 0, (v) => {
            this.executeNumericFieldChange(target, 'paddingTop', v, 'Change Padding Top');
        }, target, 'paddingTop');
        this.createUnityField(parent, 'Padding Bottom', 'number', target.paddingBottom ?? 0, (v) => {
            this.executeNumericFieldChange(target, 'paddingBottom', v, 'Change Padding Bottom');
        }, target, 'paddingBottom');
    }

    private executeNumericFieldChange(target: any, key: string, incoming: any, commandName: string): void {
        const oldVal = target[key] ?? 0;
        const parsed = parseFloat(incoming);
        const nextVal = Number.isFinite(parsed) ? parsed : oldVal;
        CommandHistory.execute({
            name: commandName,
            execute: () => {
                target[key] = nextVal;
                this.recordOverride(target, key);
                this.notifyChange(target);
            },
            undo: () => {
                target[key] = oldVal;
                this.notifyChange(target);
            }
        });
    }
}
